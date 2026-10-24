// tests/e2e.mjs -- zero-dependency E2E test
//
// Launches a real Chromium browser (headless) with the extension loaded,
// navigates to https://www.netflix.com/ and verifies the blocking behavior
// over the Chrome DevTools Protocol. Requires Node 24+ (global WebSocket)
// and network access to netflix.com.
//
// Usage: node tests/e2e.mjs
//   CHROME_PATH=<path to chrome/msedge/chromium> to force a browser binary.
//
// NOTE: Google Chrome (branded) 137+ ignores --load-extension. The candidate
// list therefore includes Edge and Chromium; the script auto-falls-back to
// the next candidate when the extension's service worker never appears.

import { spawn } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, rmSync, mkdtempSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MENU_ID = 'toggle-autoplay-block';

let passed = 0;
let failed = 0;

function check(name, ok, detail) {
  if (ok) {
    passed++;
    console.log(`  PASS  ${name}`);
  } else {
    failed++;
    console.error(`  FAIL  ${name}${detail ? ` -- ${detail}` : ''}`);
  }
}

// ---------------------------------------------------------------------------
// Static checks (manifest / locales consistency)
// ---------------------------------------------------------------------------

async function staticChecks() {
  console.log('[static] manifest / _locales');
  const manifest = JSON.parse(await readFile(join(ROOT, 'manifest.json'), 'utf8'));

  check('manifest_version is 3', manifest.manifest_version === 3);

  const scripts = [
    manifest.background?.service_worker,
    manifest.action?.default_popup,
    ...(manifest.content_scripts ?? []).flatMap((cs) => cs.js ?? []),
    ...Object.values(manifest.icons ?? {})
  ].filter(Boolean);
  for (const f of scripts) {
    check(`referenced file exists: ${f}`, existsSync(join(ROOT, f)));
  }

  const mainWorld = (manifest.content_scripts ?? []).some((cs) => cs.world === 'MAIN');
  check(
    'world:MAIN requires minimum_chrome_version >= 111',
    !mainWorld || parseInt(manifest.minimum_chrome_version, 10) >= 111
  );

  // keys referenced from the manifest (__MSG_key__), via chrome.i18n.getMessage
  // in background.js, and via data-i18n in popup.html — all must exist in every locale
  const popupHtml = await readFile(join(ROOT, 'popup.html'), 'utf8');
  const msgKeys = [...new Set([
    ...[...JSON.stringify(manifest).matchAll(/__MSG_(\w+)__/g)].map((m) => m[1]),
    'menuToggle',
    ...[...popupHtml.matchAll(/data-i18n="(\w+)"/g)].map((m) => m[1])
  ])];
  check('default_locale is set when __MSG__ used', msgKeys.length === 0 || !!manifest.default_locale);
  for (const locale of readdirSync(join(ROOT, '_locales'))) {
    const messages = JSON.parse(await readFile(join(ROOT, '_locales', locale, 'messages.json'), 'utf8'));
    for (const key of msgKeys) {
      check(`_locales/${locale} has "${key}"`, typeof messages[key]?.message === 'string');
    }
  }
}

// ---------------------------------------------------------------------------
// Minimal CDP client
// ---------------------------------------------------------------------------

class CDP {
  static async connect(wsUrl) {
    const ws = new WebSocket(wsUrl);
    await new Promise((res, rej) => {
      ws.addEventListener('open', res, { once: true });
      ws.addEventListener('error', () => rej(new Error(`WebSocket failed: ${wsUrl}`)), { once: true });
    });
    return new CDP(ws);
  }

  constructor(ws) {
    this.ws = ws;
    this.nextId = 1;
    this.pending = new Map();
    this.handlers = new Map();
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.method && this.handlers.has(msg.method)) {
        for (const fn of this.handlers.get(msg.method)) fn(msg.params, msg.sessionId);
      }
      if (msg.id && this.pending.has(msg.id)) {
        const { res, rej } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        msg.error ? rej(new Error(`${msg.error.message} (${msg.error.data ?? ''})`)) : res(msg.result);
      }
    });
  }

  on(method, fn) {
    if (!this.handlers.has(method)) this.handlers.set(method, []);
    this.handlers.get(method).push(fn);
  }

  send(method, params = {}, sessionId) {
    const id = this.nextId++;
    return new Promise((res, rej) => {
      this.pending.set(id, { res, rej });
      this.ws.send(JSON.stringify({ id, method, params, ...(sessionId && { sessionId }) }));
    });
  }

  // Evaluate an expression in the browser via CDP Runtime.evaluate, await
  // promises, return the JSON value. This is NOT JavaScript eval() in this
  // process: all expressions are fixed test-harness strings executed inside
  // the sandboxed test browser, so arbitrary-code-execution risk is confined
  // to the throwaway browser profile.
  async eval(sessionId, expression) {
    const r = await this.send(
      'Runtime.evaluate',
      { expression, awaitPromise: true, returnByValue: true },
      sessionId
    );
    if (r.exceptionDetails) {
      throw new Error(`eval failed: ${r.exceptionDetails.text} ${r.result?.description ?? ''}`);
    }
    return r.result.value;
  }

  close() {
    try { this.ws.close(); } catch { /* ignore */ }
  }
}

async function pollFor(fn, timeoutMs, intervalMs = 250) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = await fn();
    if (last) return last;
    await sleep(intervalMs);
  }
  return last;
}

// ---------------------------------------------------------------------------
// Browser launch
// ---------------------------------------------------------------------------

function browserCandidates() {
  const pf = process.env['ProgramFiles'] ?? 'C:\\Program Files';
  const pf86 = process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)';
  const local = process.env['LOCALAPPDATA'] ?? '';
  return [
    process.env.CHROME_PATH,
    // Edge first: branded Chrome 137+ silently ignores --load-extension
    join(pf86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    join(pf, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    join(pf, 'Chromium', 'Application', 'chrome.exe'),
    local && join(local, 'Chromium', 'Application', 'chrome.exe'),
    join(pf, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    local && join(local, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    '/usr/bin/chromium',
    '/usr/bin/google-chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  ].filter((p) => p && existsSync(p));
}

async function launch(bin) {
  const userDataDir = mkdtempSync(join(tmpdir(), 'nao-e2e-'));
  const child = spawn(bin, [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-sync',
    `--user-data-dir=${userDataDir}`,
    `--load-extension=${ROOT}`,
    `--disable-extensions-except=${ROOT}`,
    '--remote-debugging-port=0',
    'about:blank'
  ], { stdio: 'ignore' });

  const portFile = join(userDataDir, 'DevToolsActivePort');
  const wsUrl = await pollFor(() => {
    if (!existsSync(portFile)) return null;
    const [port, path] = readFileSync(portFile, 'utf8').split('\n');
    return port && path ? `ws://127.0.0.1:${port.trim()}${path.trim()}` : null;
  }, 15000);

  // Shut the browser down, wait for the process to actually exit, then remove
  // the profile dir. Must be awaited by callers — a fire-and-forget cleanup
  // dies with process.exit() and leaks a profile dir on every run.
  // Prefers a graceful CDP Browser.close (pass the connected client): the
  // browser then tears down its own process tree and releases profile locks.
  // Hard kills (child.kill / taskkill) are the fallback — on Windows they can
  // leave helper processes holding locks inside the profile dir.
  const kill = async (cdp) => {
    const exited = new Promise((res) => child.once('exit', res));
    if (cdp) {
      try {
        await Promise.race([cdp.send('Browser.close'), sleep(3000)]);
      } catch { /* ignore */ }
    }
    const graceful = await Promise.race([exited.then(() => true), sleep(3000).then(() => false)]);
    if (!graceful) {
      if (process.platform === 'win32') {
        // child.kill() only terminates the spawned process on Windows; use
        // taskkill /T to terminate the whole tree.
        spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
      } else {
        try { child.kill(); } catch { /* ignore */ }
      }
      await Promise.race([exited, sleep(5000)]);
    }
    // lingering helpers may release profile locks slightly after exit
    for (let i = 0; ; i++) {
      try {
        rmSync(userDataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
        return;
      } catch {
        if (i >= 9) break;
        await sleep(500);
      }
    }
    console.log(`[cleanup] profile dir left behind: ${userDataDir}`);
  };

  if (!wsUrl) {
    await kill();
    throw new Error(`DevToolsActivePort not found for ${bin}`);
  }
  return { child, wsUrl, kill };
}

// Returns {cdp, kill, swSession} for the first candidate whose extension
// service worker shows up (proof that --load-extension worked).
async function launchWithExtension() {
  for (const bin of browserCandidates()) {
    console.log(`[launch] trying: ${bin}`);
    let session;
    try {
      session = await launch(bin);
    } catch (e) {
      console.log(`[launch] ${e.message}`);
      continue;
    }
    const cdp = await CDP.connect(session.wsUrl);
    const sw = await pollFor(async () => {
      const { targetInfos } = await cdp.send('Target.getTargets');
      return targetInfos.find(
        (t) => t.type === 'service_worker' && t.url.endsWith('/background.js')
      );
    }, 8000);
    if (sw) {
      const { sessionId } = await cdp.send('Target.attachToTarget', { targetId: sw.targetId, flatten: true });
      console.log(`[launch] extension service worker attached (${sw.url})`);
      return { cdp, kill: session.kill, swSession: sessionId };
    }
    console.log('[launch] extension service worker never appeared (--load-extension likely ignored), trying next browser');
    await session.kill(cdp);
    cdp.close();
  }
  throw new Error('拡張を読み込める Chromium 系ブラウザが見つかりません。CHROME_PATH で Chromium / Edge / Chrome for Testing を指定してください。');
}

// ---------------------------------------------------------------------------
// E2E assertions
// ---------------------------------------------------------------------------

// Creates a fresh <video> (no src) and calls play().
// Blocked   -> play() resolves (stubbed) and the video stays paused.
// Unblocked -> native play() rejects (NotSupportedError for a src-less video,
//              or NotAllowedError from the autoplay policy) — either name
//              proves the call fell through to the native implementation.
const PLAY_PROBE = `(async () => {
  const v = document.createElement('video');
  (document.body || document.documentElement).appendChild(v);
  let outcome;
  try { await v.play(); outcome = 'resolved'; } catch (e) { outcome = 'rejected:' + e.name; }
  const paused = v.paused;
  v.autoplay = true;
  const autoplay = v.autoplay;
  v.remove();
  return { outcome, paused, autoplay };
})()`;

const BADGE_EXPR = `chrome.action.getBadgeText({})`;
const NAO_EXPR = `document.documentElement.dataset.nao`;
// Probes menu existence: update({}) fails with lastError iff the menu is absent.
const MENU_EXPR = `new Promise((res) => {
  chrome.contextMenus.update('${MENU_ID}', {}, () => {
    res(chrome.runtime.lastError ? chrome.runtime.lastError.message : 'ok');
  });
})`;

async function e2e() {
  console.log('[e2e] launching browser');
  const { cdp, kill, swSession } = await launchWithExtension();
  try {
    // Poll until `expr` evaluates to `expected` in the given session.
    // Evaluation errors count as "not yet": right after SW attach the global
    // may still be initializing, and page contexts can be destroyed briefly
    // by SPA navigations — both are transient, not test failures.
    const pollEval = (sessionId, expr, expected, timeoutMs) =>
      pollFor(async () => (await cdp.eval(sessionId, expr).catch(() => null)) === expected, timeoutMs);

    // -- service worker side --------------------------------------------------
    // Badge and menu are both set up asynchronously at SW startup; poll both.
    check('badge shows ON by default', await pollEval(swSession, BADGE_EXPR, 'ON', 8000));
    check('context menu was created', await pollEval(swSession, MENU_EXPR, 'ok', 8000));

    // -- page side ------------------------------------------------------------
    console.log('[e2e] opening https://www.netflix.com/');
    const { targetId } = await cdp.send('Target.createTarget', { url: 'https://www.netflix.com/' });
    const { sessionId: page } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });

    check('dataset.nao is "on" (content script ran)', await pollEval(page, NAO_EXPR, 'on', 20000));

    let probe = await cdp.eval(page, PLAY_PROBE);
    check('browse page: play() is stubbed to a resolved promise', probe.outcome === 'resolved', JSON.stringify(probe));
    check('browse page: video stays paused', probe.paused === true, JSON.stringify(probe));
    check('browse page: autoplay setter is forced to false', probe.autoplay === false, JSON.stringify(probe));

    // -- /watch/ pages must not be blocked (SPA navigation simulated) --------
    await cdp.eval(page, `history.pushState({}, '', '/watch/12345678')`);
    probe = await cdp.eval(page, PLAY_PROBE);
    check('/watch/ page: play() falls through to native', probe.outcome.startsWith('rejected:'), JSON.stringify(probe));
    check('/watch/ page: autoplay setter works normally', probe.autoplay === true, JSON.stringify(probe));
    await cdp.eval(page, `history.pushState({}, '', '/')`);

    // -- runtime toggle OFF ---------------------------------------------------
    console.log('[e2e] toggling OFF via chrome.storage');
    await cdp.eval(swSession, `chrome.storage.local.set({ enabled: false })`);

    check('toggle OFF propagates to page (dataset.nao = "off")', await pollEval(page, NAO_EXPR, 'off', 8000));

    probe = await cdp.eval(page, PLAY_PROBE);
    check('disabled: play() falls through to native', probe.outcome.startsWith('rejected:'), JSON.stringify(probe));
    check('disabled: autoplay setter works normally', probe.autoplay === true, JSON.stringify(probe));

    check('badge shows OFF after toggle', await pollEval(swSession, BADGE_EXPR, 'OFF', 5000));

    // -- runtime toggle back ON ------------------------------------------------
    console.log('[e2e] toggling ON via chrome.storage');
    await cdp.eval(swSession, `chrome.storage.local.set({ enabled: true })`);

    check('toggle ON propagates to page (dataset.nao = "on")', await pollEval(page, NAO_EXPR, 'on', 8000));

    probe = await cdp.eval(page, PLAY_PROBE);
    check('re-enabled: play() is stubbed again', probe.outcome === 'resolved', JSON.stringify(probe));

    await watchPageE2E(cdp, swSession, pollEval);
    await popupE2E(cdp, swSession, pollEval);
  } finally {
    await kill(cdp);
    cdp.close();
  }
}

// ---------------------------------------------------------------------------
// /watch/ page features (mock player)
// ---------------------------------------------------------------------------
//
// Real /watch/ pages need a logged-in account and DRM playback, so the test
// intercepts https://www.netflix.com/watch/* via CDP Fetch and serves a mock
// player that mimics the Netflix DOM (data-uia buttons, .player-timedtext) and
// the player API used for seeking. The content scripts still inject because
// the URL matches. This verifies the extension's logic, not Netflix's current
// markup — that needs a manual check on the real site.

const WATCH_URL = 'https://www.netflix.com/watch/80000001';

const MOCK_WATCH_HTML = `<!doctype html>
<html><head><title>Mock watch</title></head>
<body style="margin:0;background:#000">
<div data-uia="player" class="watch-video" style="position:relative;width:960px;height:540px">
  <div id="video-home"><video id="v" muted width="960" height="540"></video></div>
  <div class="player-timedtext" style="position:absolute;inset:0">
    <div class="player-timedtext-text-container" style="position:absolute;left:300px;top:400px">
      <span id="cue">Hello<br>World</span>
    </div>
  </div>
</div>
<script>
  // 60 s of silent WAV: a finite, seekable media whose playbackRate can change
  // (a MediaStream source would pin playbackRate to 1)
  function silentWav(seconds) {
    const rate = 8000, n = rate * seconds, buf = new ArrayBuffer(44 + n), d = new DataView(buf);
    const tag = (o, s) => [...s].forEach((c, i) => d.setUint8(o + i, c.charCodeAt(0)));
    tag(0, 'RIFF'); d.setUint32(4, 36 + n, true); tag(8, 'WAVE'); tag(12, 'fmt ');
    d.setUint32(16, 16, true); d.setUint16(20, 1, true); d.setUint16(22, 1, true);
    d.setUint32(24, rate, true); d.setUint32(28, rate, true); d.setUint16(32, 1, true); d.setUint16(34, 8, true);
    tag(36, 'data'); d.setUint32(40, n, true); new Uint8Array(buf, 44).fill(128);
    return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
  }
  const v = document.getElementById('v');
  v.disablePictureInPicture = true; // Netflix blocks native PiP the same way
  v.src = silentWav(60);
  // record media session handlers so the test can invoke them
  window.__mediaSession = {};
  navigator.mediaSession.setActionHandler = (action, handler) => { window.__mediaSession[action] = handler; };
  v.play().catch(() => {});
  // A tiny second video with a real video track (the WAV one has none, and
  // the browser refuses PiP for track-less media). Also PiP-blocked.
  const canvas = document.createElement('canvas');
  canvas.width = 16; canvas.height = 9;
  canvas.getContext('2d').fillRect(0, 0, 16, 9);
  const v2 = document.createElement('video');
  v2.id = 'v2'; v2.muted = true; v2.width = 16; v2.height = 9;
  v2.disablePictureInPicture = true;
  v2.srcObject = canvas.captureStream(1);
  document.body.append(v2);
  v2.play().catch(() => {});
  window.__seeks = [];
  window.__clicks = [];
  const player = { seek: (ms) => window.__seeks.push(ms), play: () => v.play(), pause: () => v.pause() };
  window.netflix = { appContext: { state: { playerApp: { getAPI: () => ({ videoPlayer: {
    getAllPlayerSessionIds: () => ['s1'], getVideoPlayerBySessionId: () => player } }) } } } };
  window.addButton = (uia) => {
    const b = document.createElement('button');
    b.dataset.uia = uia;
    b.textContent = uia;
    b.addEventListener('click', () => window.__clicks.push(uia));
    document.querySelector('[data-uia="player"]').append(b);
    return true;
  };
</script>
</body></html>`;

function keyEvent(key, code, keyCode, modifiers = 0) {
  return { key, code, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode, modifiers };
}

async function pressKey(cdp, session, ev) {
  await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...ev }, session);
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...ev }, session);
}

const clicksOf = (uia) => `window.__clicks.filter((c) => c === '${uia}').length`;

async function watchPageE2E(cdp, swSession, pollEval) {
  console.log(`[e2e] opening mock ${WATCH_URL}`);
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId: page } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  cdp.on('Fetch.requestPaused', (params, sessionId) => {
    if (sessionId !== page) return;
    cdp.send('Fetch.fulfillRequest', {
      requestId: params.requestId,
      responseCode: 200,
      responseHeaders: [{ name: 'Content-Type', value: 'text/html; charset=utf-8' }],
      body: Buffer.from(MOCK_WATCH_HTML).toString('base64')
    }, page).catch(() => {});
  });
  await cdp.send('Fetch.enable', { patterns: [{ urlPattern: 'https://www.netflix.com/watch/*' }] }, page);
  await cdp.send('Page.navigate', { url: WATCH_URL }, page);
  await cdp.send('Page.bringToFront', {}, page);

  check('watch: mock player loaded with settings bridged',
    await pollEval(page, `!!window.addButton && document.documentElement.dataset.naoSkipIntro === 'on'`, true, 20000));

  // -- auto skip / still watching -----------------------------------------
  await cdp.eval(page, `addButton('player-skip-intro')`);
  check('watch: skip intro is pressed', await pollEval(page, `${clicksOf('player-skip-intro')} >= 1`, true, 3000));
  await sleep(1000);
  check('watch: skip intro is pressed only once', await cdp.eval(page, clicksOf('player-skip-intro')) === 1);
  check('watch: toast is shown', await cdp.eval(page, `!!document.getElementById('nao-toast')`) === true);

  await cdp.eval(page, `addButton('interrupt-autoplay-continue')`);
  check('watch: "still watching" is dismissed',
    await pollEval(page, `${clicksOf('interrupt-autoplay-continue')} >= 1`, true, 3000));

  await cdp.eval(swSession, `chrome.storage.local.set({ skipIntro: false })`);
  await pollEval(page, `document.documentElement.dataset.naoSkipIntro`, 'off', 5000);
  await cdp.eval(page, `addButton('player-skip-recap')`);
  await sleep(1200);
  check('watch: skip disabled -> recap is not pressed', await cdp.eval(page, clicksOf('player-skip-recap')) === 0);
  await cdp.eval(swSession, `chrome.storage.local.set({ skipIntro: true })`);
  check('watch: skip re-enabled -> recap is pressed',
    await pollEval(page, `${clicksOf('player-skip-recap')} >= 1`, true, 5000));

  // -- next episode modes ---------------------------------------------------
  await cdp.eval(page, `addButton('next-episode-seamless-button')`);
  await sleep(1200);
  check('next: "netflix" mode leaves the countdown alone',
    await cdp.eval(page, clicksOf('next-episode-seamless-button')) === 0);
  await cdp.eval(swSession, `chrome.storage.local.set({ nextEpisode: 'immediate' })`);
  check('next: "immediate" mode presses next episode',
    await pollEval(page, `${clicksOf('next-episode-seamless-button')} >= 1`, true, 5000));
  await cdp.eval(swSession, `chrome.storage.local.set({ nextEpisode: 'stop' })`);
  await cdp.eval(page, `addButton('watch-credits-seamless-button')`);
  check('next: "stop" mode presses watch credits',
    await pollEval(page, `${clicksOf('watch-credits-seamless-button')} >= 1`, true, 5000));
  await cdp.eval(swSession, `chrome.storage.local.remove('nextEpisode')`);
  await pollEval(page, `document.documentElement.dataset.naoNext`, 'netflix', 5000);

  // -- shortcuts ------------------------------------------------------------
  const RATE = `document.querySelector('video').playbackRate`;
  await pressKey(cdp, page, keyEvent(']', 'BracketRight', 221));
  check('keys: ] speeds up to 1.25x', await pollEval(page, RATE, 1.25, 2000));
  await pressKey(cdp, page, keyEvent(']', 'BracketRight', 221));
  await pressKey(cdp, page, keyEvent('[', 'BracketLeft', 219));
  check('keys: [ slows down', await pollEval(page, RATE, 1.25, 2000));
  await pressKey(cdp, page, keyEvent('\\', 'Backslash', 220));
  check('keys: \\ resets to 1x', await pollEval(page, RATE, 1, 2000));
  await cdp.eval(swSession, `chrome.storage.local.set({ shortcuts: false })`);
  await pollEval(page, `document.documentElement.dataset.naoKeys`, 'off', 5000);
  await pressKey(cdp, page, keyEvent(']', 'BracketRight', 221));
  await sleep(300);
  check('keys: disabled -> ] does nothing', await cdp.eval(page, RATE) === 1);
  await cdp.eval(swSession, `chrome.storage.local.remove('shortcuts')`);
  await pollEval(page, `document.documentElement.dataset.naoKeys`, 'on', 5000);

  // -- native (browser) Picture-in-Picture ----------------------------------
  check('native pip: disablePictureInPicture is removed',
    await pollEval(page, `[...document.querySelectorAll('video')].every((v) => !v.disablePictureInPicture)`, true, 3000));
  const native = await cdp.send('Runtime.evaluate', {
    expression: `document.getElementById('v2').requestPictureInPicture()
      .then(() => document.pictureInPictureElement?.id)
      .catch((e) => 'error:' + e.name)`,
    awaitPromise: true, returnByValue: true, userGesture: true
  }, page);
  check('native pip: browser PiP opens', native.result.value === 'v2', native.result.value);
  await cdp.eval(page, `document.pictureInPictureElement ? document.exitPictureInPicture().then(() => true) : true`);
  check('native pip: media session handlers are registered',
    await pollEval(page, `['seekbackward', 'seekforward', 'nexttrack'].every((a) => typeof window.__mediaSession[a] === 'function')`, true, 3000));
  await cdp.eval(page, `window.__seeks = []; window.__mediaSession.seekforward(); window.__seeks.length === 1 && window.__seeks[0] >= 10000`);
  check('native pip: seekforward handler seeks through the player API',
    await pollEval(page, `window.__seeks.length === 1 && window.__seeks[0] >= 10000`, true, 2000));
  await cdp.eval(page, `window.__seeks = []`);

  // -- Document Picture-in-Picture -----------------------------------------
  // Alt+P via CDP is a trusted key press, which grants the user activation
  // that documentPictureInPicture.requestWindow() requires.
  const PIP_DOC = `documentPictureInPicture.window.document`;
  await pressKey(cdp, page, keyEvent('p', 'KeyP', 80, 1));
  const opened = await pollEval(page, `!!documentPictureInPicture.window`, true, 5000);
  check('pip: Alt+P opens a Document PiP window', opened);
  if (!opened) return;

  check('pip: video moved out of the page', await pollEval(page, `document.querySelector('[data-uia="player"] video')`, null, 2000));
  check('pip: video is inside the PiP window', await pollEval(page, `${PIP_DOC}.querySelector('video')?.id`, 'v', 2000));
  check('pip: subtitles are mirrored',
    await pollEval(page, `${PIP_DOC}.querySelector('.nao-caption').textContent.replace(/\\s+/g, ' ').trim()`, 'Hello World', 3000));
  await cdp.eval(page, `document.getElementById('cue').textContent = 'Second cue'`);
  check('pip: subtitle changes follow',
    await pollEval(page, `${PIP_DOC}.querySelector('.nao-caption').textContent.trim()`, 'Second cue', 3000));
  check('pip: control bar has buttons',
    await cdp.eval(page, `${PIP_DOC}.querySelectorAll('.nao-bar button').length >= 7`) === true);

  await cdp.eval(page, `documentPictureInPicture.window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))`);
  check('pip: → seeks forward through the player API',
    await pollEval(page, `window.__seeks.length === 1 && window.__seeks[0] >= 10000`, true, 2000));
  await cdp.eval(page, `documentPictureInPicture.window.dispatchEvent(new KeyboardEvent('keydown', { key: ']', bubbles: true }))`);
  check('pip: ] changes speed inside the window', await pollEval(page, `${PIP_DOC}.querySelector('video').playbackRate`, 1.25, 2000));

  await cdp.eval(page, `documentPictureInPicture.window.close()`);
  check('pip: closing restores the video to its original place',
    await pollEval(page, `document.querySelector('#video-home > video')?.id`, 'v', 3000));
  check('pip: restored video keeps playing', await pollEval(page, `!document.querySelector('video').paused`, true, 3000));
}

// ---------------------------------------------------------------------------
// Popup
// ---------------------------------------------------------------------------

async function popupE2E(cdp, swSession, pollEval) {
  const id = await cdp.eval(swSession, 'chrome.runtime.id');
  console.log('[e2e] opening popup.html');
  const { targetId } = await cdp.send('Target.createTarget', { url: `chrome-extension://${id}/popup.html` });
  const { sessionId: popup } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });

  check('popup: settings are rendered',
    await pollEval(popup, `document.querySelectorAll('input[type=checkbox]').length`, 4, 5000));
  check('popup: labels are localized',
    await cdp.eval(popup, `[...document.querySelectorAll('[data-i18n]')].every((n) => n.textContent.trim() !== '')`) === true);
  check('popup: reflects stored state',
    await pollEval(popup, `document.querySelector('[data-key=enabled]').checked`, true, 3000));

  await cdp.eval(popup, `document.querySelector('[data-key=skipIntro]').click()`);
  check('popup: toggling writes to storage',
    await pollEval(swSession, `chrome.storage.local.get('skipIntro').then((r) => r.skipIntro)`, false, 3000));
  await cdp.eval(popup, `document.querySelector('[data-key=nextEpisode]').value = 'stop'; document.querySelector('[data-key=nextEpisode]').dispatchEvent(new Event('change'))`);
  check('popup: select writes to storage',
    await pollEval(swSession, `chrome.storage.local.get('nextEpisode').then((r) => r.nextEpisode)`, 'stop', 3000));
  await cdp.eval(swSession, `chrome.storage.local.remove(['skipIntro', 'nextEpisode'])`);
}

// ---------------------------------------------------------------------------

try {
  await staticChecks();
  await e2e();
} catch (e) {
  failed++;
  console.error(`  FAIL  (fatal) ${e.message}`);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
