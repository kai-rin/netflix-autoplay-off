// content.js -- ISOLATED world, document_start
// chrome.storage と DOM dataset 属性の橋渡し + MutationObserver バックアップ

(function () {
  'use strict';

  const ROOT = document.documentElement;
  const WATCH_PATH_RE = /^\/watch\//;

  // 設定キーとデフォルト値（popup.js と揃える）
  const DEFAULTS = {
    enabled: true,
    skipIntro: true,
    skipStillWatching: true,
    nextEpisode: 'netflix',
    shortcuts: true
  };

  // --- 動画を停止 ---
  function stopVideo(video) {
    video.pause();
    video.autoplay = false;
  }

  // /watch/ ページかどうか判定（動画視聴ページではブロックしない）
  function isWatchPage() {
    return WATCH_PATH_RE.test(window.location.pathname);
  }

  function onOff(value) {
    return value ? 'on' : 'off';
  }

  // --- 状態を DOM に反映 ---
  // dataset.nao* は inject.js / player.js (MAIN world) が参照するクロスワールドブリッジキー
  function applyState(enabled) {
    ROOT.dataset.nao = onOff(enabled);
    if (enabled) {
      pauseAllVideos();
    }
  }

  function applySettings(settings) {
    if (settings.enabled !== undefined) applyState(settings.enabled);
    if (settings.skipIntro !== undefined) ROOT.dataset.naoSkipIntro = onOff(settings.skipIntro);
    if (settings.skipStillWatching !== undefined) ROOT.dataset.naoStill = onOff(settings.skipStillWatching);
    if (settings.nextEpisode !== undefined) ROOT.dataset.naoNext = settings.nextEpisode;
    if (settings.shortcuts !== undefined) ROOT.dataset.naoKeys = onOff(settings.shortcuts);
    if (settings.pipSize !== undefined) ROOT.dataset.naoPipSize = settings.pipSize;
  }

  // --- 全動画を停止（/watch/ ページ以外のみ） ---
  function pauseAllVideos() {
    if (isWatchPage()) return;
    document.querySelectorAll('video').forEach(stopVideo);
  }

  // --- 初期状態を読み込み ---
  chrome.storage.local.get(null, function (result) {
    applySettings(Object.assign({}, DEFAULTS, result));
  });

  // --- リアルタイムトグル反映 ---
  chrome.storage.onChanged.addListener(function (changes, areaName) {
    if (areaName !== 'local') return;
    var settings = {};
    Object.keys(changes).forEach(function (key) {
      // キー削除時は newValue が undefined → デフォルトに揃える
      var newValue = changes[key].newValue;
      settings[key] = newValue !== undefined ? newValue : DEFAULTS[key];
    });
    applySettings(settings);
  });

  // --- PiP ウィンドウの大きさを保存（player.js から "幅x高さ" が届く） ---
  document.addEventListener('nao-pip-size', function (event) {
    if (typeof event.detail === 'string' && /^\d+x\d+$/.test(event.detail)) {
      chrome.storage.local.set({ pipSize: event.detail });
    }
  });

  // --- MutationObserver（バックアップ） ---
  function startObserver() {
    var observer = new MutationObserver(function (mutations) {
      // dataset.nao === 'off' → ブロック無効（inject.js と同じ極性）
      if (ROOT.dataset.nao === 'off' || isWatchPage()) return;

      for (var i = 0; i < mutations.length; i++) {
        var addedNodes = mutations[i].addedNodes;
        for (var j = 0; j < addedNodes.length; j++) {
          var node = addedNodes[j];
          if (node.nodeType !== Node.ELEMENT_NODE) continue;

          if (node.tagName === 'VIDEO') {
            stopVideo(node);
          }

          var videos = node.querySelectorAll('video');
          for (var k = 0; k < videos.length; k++) {
            stopVideo(videos[k]);
          }
        }
      }
    });

    observer.observe(ROOT, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startObserver, { once: true });
  } else {
    startObserver();
  }
})();
