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

  // keys referenced from the manifest (__MSG_key__) plus keys used via
  // chrome.i18n.getMessage in background.js — all must exist in every locale
  const msgKeys = [...new Set([
    ...[...JSON.stringify(manifest).matchAll(/__MSG_(\w+)__/g)].map((m) => m[1]),
    'menuToggle'
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
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { res, rej } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        msg.error ? rej(new Error(`${msg.error.message} (${msg.error.data ?? ''})`)) : res(msg.result);
      }
    });
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
  } finally {
    await kill(cdp);
    cdp.close();
  }
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
