// player.js -- MAIN world, document_start
// /watch/ ページの再生補助: Document PiP（字幕・操作バー付き）、ブラウザ標準 PiP の解禁、
// 自動スキップ、次エピソード制御、ショートカット、再生速度
// 設定は document.documentElement.dataset.nao* で判定（content.js が設定）

(function () {
  'use strict';

  const ROOT = document.documentElement;
  const WATCH_PATH_RE = /^\/watch\//;
  const SEEK_STEP = 10;
  const VOLUME_STEP = 0.1;
  const RATE_STEP = 0.25;
  const RATE_MIN = 0.25;
  const RATE_MAX = 3;
  const RATES = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3];
  const DEFAULT_PIP_SIZE = [480, 270];
  const CONTROLS_HIDE_MS = 2500;
  const AUTO_INTERVAL_MS = 400;
  const PIP_TICK_MS = 250;

  // Netflix プレイヤーの要素（data-uia は Netflix 側の名前）
  const SEL = {
    skipIntro: [
      '[data-uia="player-skip-intro"]',
      '[data-uia="player-skip-recap"]',
      '[data-uia="player-skip-preplay"]'
    ],
    stillWatching: ['[data-uia="interrupt-autoplay-continue"]'],
    nextSeamless: ['[data-uia^="next-episode-seamless-button"]'],
    watchCredits: ['[data-uia^="watch-credits-seamless-button"]'],
    nextControl: ['[data-uia="control-next"]'],
    playerRoot: '[data-uia="player"], .watch-video',
    timedText: '.player-timedtext'
  };

  const T = (navigator.language || '').startsWith('ja') ? {
    speed: '再生速度', next: '次のエピソード', noNext: '次のエピソードが見つかりません',
    skipped: 'スキップしました', continued: '再生を続けます', stoppedNext: '次のエピソードへ進みません',
    noPip: 'この環境では PiP を開けません', noVideo: '動画が見つかりません',
    play: '再生 / 一時停止 (Space)', back: '10秒戻る (←)', forward: '10秒進む (→)',
    mute: 'ミュート (M)', volume: '音量 (↑↓)', rate: '再生速度 ([ ])', fit: '黒帯を詰める (C)',
    close: 'タブに戻す (Alt+Shift+P)', nextTitle: '次のエピソード (N)'
  } : {
    speed: 'Speed', next: 'Next episode', noNext: 'No next episode found',
    skipped: 'Skipped', continued: 'Continuing playback', stoppedNext: 'Auto next episode stopped',
    noPip: 'Picture-in-Picture is not available', noVideo: 'No video found',
    play: 'Play / Pause (Space)', back: 'Back 10s (←)', forward: 'Forward 10s (→)',
    mute: 'Mute (M)', volume: 'Volume (↑↓)', rate: 'Speed ([ ])', fit: 'Fit to video (C)',
    close: 'Back to tab (Alt+Shift+P)', nextTitle: 'Next episode (N)'
  };

  // 開いている PiP の状態（閉じている間は null）
  let pip = null;

  function isWatchPage() {
    return WATCH_PATH_RE.test(window.location.pathname);
  }

  // dataset が未設定（content.js の読み込み前）ならデフォルト有効
  function flagOn(name) {
    return ROOT.dataset[name] !== 'off';
  }

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  function formatTime(seconds) {
    if (!Number.isFinite(seconds)) return '0:00';
    const s = Math.floor(seconds % 60).toString().padStart(2, '0');
    const m = Math.floor(seconds / 60) % 60;
    const h = Math.floor(seconds / 3600);
    return h ? `${h}:${m.toString().padStart(2, '0')}:${s}` : `${m}:${s}`;
  }

  // --- 動画と Netflix プレイヤー API ---

  // メイン文書の動画（プレイヤー内を優先し、プレビューとの取り違えを避けて最大のもの）
  function findMainVideo() {
    const root = document.querySelector(SEL.playerRoot) || document;
    let best = null;
    let bestArea = -1;
    root.querySelectorAll('video').forEach((v) => {
      const area = v.clientWidth * v.clientHeight;
      if (area > bestArea) {
        best = v;
        bestArea = area;
      }
    });
    return best;
  }

  function currentVideo() {
    return pip ? pip.video : findMainVideo();
  }

  function netflixPlayer() {
    try {
      const vp = window.netflix.appContext.state.playerApp.getAPI().videoPlayer;
      return vp.getVideoPlayerBySessionId(vp.getAllPlayerSessionIds()[0]) || null;
    } catch (e) {
      return null;
    }
  }

  function seekTo(video, seconds) {
    const duration = Number.isFinite(video.duration) ? video.duration : seconds;
    const target = clamp(seconds, 0, duration);
    const player = netflixPlayer();
    // Netflix は video.currentTime を直接書くと再生エラーになるため API でシークする
    if (player && typeof player.seek === 'function') {
      player.seek(Math.round(target * 1000));
    } else {
      video.currentTime = target;
    }
  }

  function togglePlay(video) {
    const player = netflixPlayer();
    if (video.paused) {
      if (player && typeof player.play === 'function') player.play();
      else video.play().catch(() => {});
    } else if (player && typeof player.pause === 'function') {
      player.pause();
    } else {
      video.pause();
    }
  }

  function setRate(video, rate, doc) {
    video.playbackRate = clamp(Math.round(rate * 100) / 100, RATE_MIN, RATE_MAX);
    toast(doc, `${T.speed} ${video.playbackRate}x`);
  }

  function changeVolume(video, delta) {
    video.muted = false;
    video.volume = clamp(Math.round((video.volume + delta) * 100) / 100, 0, 1);
  }

  // --- Netflix のボタン操作 ---

  // Netflix のボタンは pointerdown で反応するものがあるため、実クリックと同じ順でイベントを送る
  function press(el) {
    const opts = { bubbles: true, cancelable: true, view: window };
    const pointer = Object.assign({ pointerType: 'mouse', isPrimary: true }, opts);
    el.dispatchEvent(new PointerEvent('pointerdown', pointer));
    el.dispatchEvent(new MouseEvent('mousedown', opts));
    el.dispatchEvent(new PointerEvent('pointerup', pointer));
    el.dispatchEvent(new MouseEvent('mouseup', opts));
    el.click();
  }

  function queryFirst(selectors) {
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) return el;
    }
    return null;
  }

  function goNextEpisode(doc) {
    const seamless = queryFirst(SEL.nextSeamless);
    if (seamless) {
      press(seamless);
      toast(doc, T.next);
      return;
    }
    // 操作バーは隠れている間は描画されないことがあるため、マウス移動で表示させてから探す
    const root = document.querySelector(SEL.playerRoot);
    if (root) root.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, view: window }));
    setTimeout(() => {
      const button = queryFirst(SEL.nextControl);
      if (button) {
        press(button);
        toast(doc, T.next);
      } else {
        toast(doc, T.noNext);
      }
    }, 150);
  }

  // --- 自動スキップ・次エピソード制御・視聴確認の自動解除 ---

  // 同じボタンを二度押さない（次エピソードの二重送りを防ぐ）
  const autoPressed = new WeakSet();

  function autoPress(selectors, message) {
    // 押し済みのボタンが残っていても、後から出た別のボタンは押す
    for (const sel of selectors) {
      for (const el of document.querySelectorAll(sel)) {
        if (autoPressed.has(el)) continue;
        autoPressed.add(el);
        press(el);
        toast(activeDoc(), message);
        return;
      }
    }
  }

  // --- ブラウザ標準の PiP ---

  // Netflix が動画に付ける disablePictureInPicture を外し、ブラウザ標準の PiP ボタンを使えるようにする
  function allowNativePip() {
    document.querySelectorAll('video').forEach((v) => {
      if (v.disablePictureInPicture) v.disablePictureInPicture = false;
    });
  }

  async function toggleNativePip() {
    if (document.pictureInPictureElement) {
      await document.exitPictureInPicture().catch(() => {});
      return;
    }
    const video = currentVideo();
    if (!video) {
      toast(document, T.noVideo);
      return;
    }
    video.disablePictureInPicture = false;
    try {
      await video.requestPictureInPicture();
    } catch (e) {
      toast(document, T.noPip);
    }
  }

  // 標準 PiP の小窓に 10 秒送り戻し・次のエピソードのボタンを出す
  // Netflix が後から上書きすることがあるため、定期的に登録し直す
  function setMediaSessionHandlers() {
    if (!('mediaSession' in navigator)) return;
    const handlers = {
      seekbackward: () => {
        const v = currentVideo();
        if (v) seekTo(v, v.currentTime - SEEK_STEP);
      },
      seekforward: () => {
        const v = currentVideo();
        if (v) seekTo(v, v.currentTime + SEEK_STEP);
      },
      nexttrack: () => goNextEpisode(activeDoc())
    };
    for (const [action, handler] of Object.entries(handlers)) {
      try {
        navigator.mediaSession.setActionHandler(action, handler);
      } catch (e) {
        // 未対応の action は無視する
      }
    }
  }

  function runAutoActions() {
    if (!isWatchPage()) return;
    allowNativePip();
    setMediaSessionHandlers();
    if (flagOn('naoSkipIntro')) autoPress(SEL.skipIntro, T.skipped);
    if (flagOn('naoStill')) autoPress(SEL.stillWatching, T.continued);
    const mode = ROOT.dataset.naoNext || 'netflix';
    if (mode === 'immediate') autoPress(SEL.nextSeamless, T.next);
    else if (mode === 'stop') autoPress(SEL.watchCredits, T.stoppedNext);
  }

  setInterval(runAutoActions, AUTO_INTERVAL_MS);

  // --- トースト表示 ---

  const toastTimers = new WeakMap();

  function activeDoc() {
    return pip ? pip.doc : document;
  }

  function toast(doc, text) {
    // 全画面中は全画面要素の中に置かないと見えない
    const host = doc.fullscreenElement || doc.body;
    if (!host) return;
    let el = doc.getElementById('nao-toast');
    if (!el) {
      el = doc.createElement('div');
      el.id = 'nao-toast';
      Object.assign(el.style, {
        position: 'fixed', top: '12%', left: '50%', transform: 'translateX(-50%)',
        background: 'rgba(0, 0, 0, 0.78)', color: '#fff', padding: '8px 16px',
        borderRadius: '8px', font: '600 16px/1.4 system-ui, sans-serif',
        zIndex: '2147483647', pointerEvents: 'none', transition: 'opacity 0.2s'
      });
    }
    if (el.parentNode !== host) host.appendChild(el);
    el.textContent = text;
    el.style.opacity = '1';
    clearTimeout(toastTimers.get(el));
    toastTimers.set(el, setTimeout(() => { el.style.opacity = '0'; }, 1200));
  }

  // --- キーボード ---

  function isTyping(event) {
    const t = event.target;
    return !!t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
  }

  // 処理したキーなら true（Netflix 側の同じキー処理を止める）
  function handleKey(event, inPip) {
    if (!isWatchPage() || isTyping(event)) return false;
    // Alt+P: ブラウザ標準の PiP、Alt+Shift+P: 字幕・操作バー付きの Document PiP
    if (event.altKey && event.code === 'KeyP') {
      if (event.shiftKey) togglePip();
      else if (!inPip) toggleNativePip();
      return true;
    }
    if (event.altKey || event.ctrlKey || event.metaKey) return false;
    // PiP 内の操作キーは常に有効、メイン画面の追加キーは設定で切り替え
    if (!inPip && !flagOn('naoKeys')) return false;

    const video = currentVideo();
    if (!video) return false;
    const doc = inPip ? pip.doc : document;
    const key = event.key;

    if (key === ']') setRate(video, video.playbackRate + RATE_STEP, doc);
    else if (key === '[') setRate(video, video.playbackRate - RATE_STEP, doc);
    else if (key === '\\') setRate(video, 1, doc);
    else if (key === 'n' && !event.shiftKey) goNextEpisode(doc);
    else if (!inPip) return false;
    else if (key === ' ' || key === 'k') togglePlay(video);
    else if (key === 'ArrowLeft') seekTo(video, video.currentTime - SEEK_STEP);
    else if (key === 'ArrowRight') seekTo(video, video.currentTime + SEEK_STEP);
    else if (key === 'ArrowUp') changeVolume(video, VOLUME_STEP);
    else if (key === 'ArrowDown') changeVolume(video, -VOLUME_STEP);
    else if (key === 'm') video.muted = !video.muted;
    else if (key === 'c') fitWindow();
    else return false;
    return true;
  }

  function onKeyDown(event, inPip) {
    if (handleKey(event, inPip)) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }

  window.addEventListener('keydown', (event) => onKeyDown(event, false), true);

  // ポップアップの PiP ボタン（popup.js が scripting.executeScript で送る）
  document.addEventListener('nao-pip-request', (event) => {
    if (!isWatchPage()) return;
    if (event.detail === 'document') togglePip();
    else toggleNativePip();
  });

  // --- Document Picture-in-Picture ---

  const PIP_CSS = `
    html, body { margin: 0; height: 100%; background: #000; overflow: hidden; }
    body { font: 13px/1.2 system-ui, sans-serif; color: #fff; user-select: none; }
    .nao-stage { position: fixed; inset: 0; }
    .nao-stage video { width: 100% !important; height: 100% !important; object-fit: contain;
      position: static !important; transform: none !important; }
    .nao-caption { position: fixed; left: 4%; right: 4%; bottom: 6%; display: flex;
      flex-direction: column; align-items: center; gap: 0.2em; pointer-events: none;
      font: 600 clamp(12px, 5.5vh, 48px)/1.3 system-ui, sans-serif; text-align: center;
      white-space: pre-line; text-shadow: 0 0 4px #000, 0 0 2px #000; transition: bottom 0.2s; }
    .nao-caption .nao-line { background: rgba(0, 0, 0, 0.45); padding: 0.05em 0.35em; border-radius: 0.2em; }
    .nao-caption-image { position: fixed; inset: 0; width: 100%; height: 100%; pointer-events: none; }
    .nao-show .nao-caption { bottom: 72px; }
    .nao-bar { position: fixed; left: 0; right: 0; bottom: 0; padding: 18px 10px 8px;
      background: linear-gradient(transparent, rgba(0, 0, 0, 0.85)); opacity: 0;
      transition: opacity 0.2s; display: flex; flex-direction: column; gap: 6px; }
    .nao-show .nao-bar { opacity: 1; }
    .nao-row { display: flex; align-items: center; gap: 4px; }
    .nao-row .nao-spacer { flex: 1; }
    .nao-bar button { background: none; border: 0; color: #fff; font: inherit; font-size: 15px;
      min-width: 28px; height: 28px; border-radius: 4px; cursor: pointer; padding: 0 4px; }
    .nao-bar button:hover { background: rgba(255, 255, 255, 0.18); }
    .nao-bar select { background: rgba(0, 0, 0, 0.6); color: #fff; border: 1px solid #666;
      border-radius: 4px; font: inherit; }
    .nao-seek { width: 100%; margin: 0; accent-color: #e50914; }
    .nao-volume { width: 64px; accent-color: #fff; }
    .nao-time { font-variant-numeric: tabular-nums; padding: 0 4px; white-space: nowrap; }
  `;

  function pipSize() {
    const m = /^(\d+)x(\d+)$/.exec(ROOT.dataset.naoPipSize || '');
    return m ? [Number(m[1]), Number(m[2])] : DEFAULT_PIP_SIZE;
  }

  async function togglePip() {
    if (pip) {
      pip.win.close();
      return;
    }
    if (!('documentPictureInPicture' in window)) {
      toast(document, T.noPip);
      return;
    }
    const video = findMainVideo();
    if (!video) {
      toast(document, T.noVideo);
      return;
    }
    const [width, height] = pipSize();
    let win;
    try {
      win = await window.documentPictureInPicture.requestWindow({ width, height });
    } catch (e) {
      toast(document, T.noPip);
      return;
    }
    openPip(win, video);
  }

  function el(doc, tag, className, props) {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (props) Object.assign(node, props);
    return node;
  }

  function buildControls(doc) {
    const button = (text, title, onClick) => {
      const b = el(doc, 'button', '', { type: 'button', textContent: text, title, tabIndex: -1 });
      b.addEventListener('click', onClick);
      return b;
    };
    const video = () => pip.video;

    const seek = el(doc, 'input', 'nao-seek', { type: 'range', min: 0, max: 1000, value: 0, tabIndex: -1 });
    const playBtn = button('▶', T.play, () => togglePlay(video()));
    const time = el(doc, 'span', 'nao-time', { textContent: '0:00 / 0:00' });
    const muteBtn = button('🔊', T.mute, () => { video().muted = !video().muted; });
    const volume = el(doc, 'input', 'nao-volume', { type: 'range', min: 0, max: 100, title: T.volume, tabIndex: -1 });
    const rate = el(doc, 'select', '', { title: T.rate, tabIndex: -1 });
    RATES.forEach((r) => rate.append(el(doc, 'option', '', { value: String(r), textContent: `${r}x` })));

    seek.addEventListener('input', () => {
      pip.seeking = true;
      time.textContent = `${formatTime(video().duration * seek.value / 1000)} / ${formatTime(video().duration)}`;
    });
    seek.addEventListener('change', () => {
      seekTo(video(), video().duration * seek.value / 1000);
      pip.seeking = false;
      seek.blur();
    });
    volume.addEventListener('input', () => {
      video().muted = false;
      video().volume = volume.value / 100;
    });
    volume.addEventListener('change', () => volume.blur());
    rate.addEventListener('change', () => {
      setRate(video(), Number(rate.value), doc);
      rate.blur();
    });

    const row = el(doc, 'div', 'nao-row');
    row.append(
      button('−10', T.back, () => seekTo(video(), video().currentTime - SEEK_STEP)),
      playBtn,
      button('+10', T.forward, () => seekTo(video(), video().currentTime + SEEK_STEP)),
      time,
      el(doc, 'span', 'nao-spacer'),
      muteBtn,
      volume,
      rate,
      button('⏭', T.nextTitle, () => goNextEpisode(doc)),
      button('▭', T.fit, fitWindow),
      button('⧉', T.close, () => pip.win.close())
    );
    const root = el(doc, 'div', 'nao-bar');
    root.append(seek, row);
    // ボタンがフォーカスを持つと Space がボタン押下と二重に効くため、フォーカスさせない
    root.addEventListener('mousedown', (event) => {
      if (event.target.tagName === 'BUTTON') event.preventDefault();
    });

    return {
      root,
      update() {
        const v = video();
        playBtn.textContent = v.paused ? '▶' : '❚❚';
        muteBtn.textContent = v.muted || v.volume === 0 ? '🔇' : '🔊';
        if (!pip.seeking) {
          seek.value = v.duration ? Math.round(v.currentTime / v.duration * 1000) : 0;
          time.textContent = `${formatTime(v.currentTime)} / ${formatTime(v.duration)}`;
        }
        if (doc.activeElement !== volume) volume.value = Math.round((v.muted ? 0 : v.volume) * 100);
        if (doc.activeElement !== rate && rate.value !== String(v.playbackRate)) rate.value = String(v.playbackRate);
      }
    };
  }

  function openPip(win, video) {
    const doc = win.document;
    // ページの CSP に左右されないよう、<style> ではなく構築可能スタイルシートを使う
    const sheet = new win.CSSStyleSheet();
    sheet.replaceSync(PIP_CSS);
    doc.adoptedStyleSheets = [sheet];
    doc.title = document.title;

    const stage = el(doc, 'div', 'nao-stage');
    const caption = el(doc, 'div', 'nao-caption');
    pip = {
      win, doc, stage, caption,
      video: null, home: null, seeking: false,
      captionSource: null, captionKey: '', hideTimer: 0, sizeTimer: 0, tick: 0,
      captionObserver: new MutationObserver(syncCaption)
    };
    pip.controls = buildControls(doc);
    doc.body.append(stage, caption, pip.controls.root);
    attachVideo(video);

    const showControls = () => {
      doc.body.classList.add('nao-show');
      clearTimeout(pip.hideTimer);
      pip.hideTimer = setTimeout(() => {
        if (pip && !pip.video.paused) doc.body.classList.remove('nao-show');
      }, CONTROLS_HIDE_MS);
    };
    doc.addEventListener('mousemove', showControls);
    doc.addEventListener('mouseleave', () => {
      if (pip && !pip.video.paused) doc.body.classList.remove('nao-show');
    });
    stage.addEventListener('click', () => togglePlay(pip.video));
    win.addEventListener('keydown', (event) => onKeyDown(event, true), true);
    win.addEventListener('resize', () => {
      clearTimeout(pip.sizeTimer);
      pip.sizeTimer = setTimeout(() => {
        // 保存は content.js（chrome.storage）に任せる
        document.dispatchEvent(new CustomEvent('nao-pip-size', { detail: `${win.innerWidth}x${win.innerHeight}` }));
      }, 500);
    });
    win.addEventListener('pagehide', closePip, { once: true });

    pip.tick = setInterval(pipTick, PIP_TICK_MS);
    pipTick();
    showControls();
  }

  // 動画を PiP へ移す。元の位置を覚えておき、閉じたら戻す
  function attachVideo(video) {
    if (pip.video) restoreVideo();
    pip.video = video;
    pip.home = { parent: video.parentNode, next: video.nextSibling };
    pip.stage.append(video);
  }

  function restoreVideo() {
    const { video, home } = pip;
    if (home && home.parent && home.parent.isConnected) {
      const next = home.next && home.next.parentNode === home.parent ? home.next : null;
      home.parent.insertBefore(video, next);
    } else {
      video.remove();
    }
  }

  function pipTick() {
    if (!pip) return;
    // メイン画面が視聴ページから離れたら PiP も閉じる
    if (!isWatchPage()) {
      pip.win.close();
      return;
    }
    // 次エピソード等で Netflix が新しい動画要素を作ったら、それを PiP に移し直す
    const fresh = findMainVideo();
    if (fresh && fresh !== pip.video) attachVideo(fresh);

    // 字幕要素は作り直されることがあるため、つながりが切れたら探し直す
    if (!pip.captionSource || !pip.captionSource.isConnected) {
      pip.captionObserver.disconnect();
      pip.captionSource = document.querySelector(SEL.timedText);
      if (pip.captionSource) {
        pip.captionObserver.observe(pip.captionSource, { childList: true, subtree: true, characterData: true });
      }
      syncCaption();
    }

    if (pip.video.paused) pip.doc.body.classList.add('nao-show');
    pip.controls.update();
  }

  // Netflix の字幕を PiP に写す（元の字幕要素は動かさず、文字だけ PiP の大きさで描き直す）
  function syncCaption() {
    if (!pip) return;
    const src = pip.captionSource;
    const svg = src && src.querySelector('svg');
    const lines = src && !svg
      ? [...src.querySelectorAll('.player-timedtext-text-container')].map((box) => box.innerText.trim()).filter(Boolean)
      : [];
    const key = svg ? `svg:${svg.outerHTML.length}:${svg.querySelectorAll('image').length}` : lines.join('\n');
    if (key === pip.captionKey) return;
    pip.captionKey = key;

    if (svg) {
      // 画像字幕（一部の言語）は SVG ごと複製し、PiP の大きさに合わせて重ねる
      const copy = svg.cloneNode(true);
      copy.removeAttribute('style');
      copy.setAttribute('class', 'nao-caption-image');
      pip.caption.replaceChildren(copy);
    } else {
      pip.caption.replaceChildren(...lines.map((text) => el(pip.doc, 'div', 'nao-line', { textContent: text })));
    }
  }

  function fitWindow() {
    if (!pip || !pip.video.videoWidth) return;
    const { win, video } = pip;
    const height = Math.round(win.innerWidth * video.videoHeight / video.videoWidth);
    try {
      win.resizeBy(0, height - win.innerHeight);
    } catch (e) {
      // ユーザー操作の直後でないと拒否される。次の操作で再試行できるので無視する
    }
  }

  function closePip() {
    if (!pip) return;
    clearInterval(pip.tick);
    clearTimeout(pip.hideTimer);
    pip.captionObserver.disconnect();
    restoreVideo();
    pip = null;
    window.focus();
  }
})();
