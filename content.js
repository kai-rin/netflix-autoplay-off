// content.js -- ISOLATED world, document_start
// chrome.storage と DOM dataset 属性の橋渡し + MutationObserver バックアップ

(function () {
  'use strict';

  const ROOT = document.documentElement;
  const WATCH_PATH_RE = /^\/watch\//;

  // --- 動画を停止 ---
  function stopVideo(video) {
    video.pause();
    video.autoplay = false;
  }

  // /watch/ ページかどうか判定（動画視聴ページではブロックしない）
  function isWatchPage() {
    return WATCH_PATH_RE.test(window.location.pathname);
  }

  // --- 状態を DOM に反映 ---
  // dataset.nao は inject.js (MAIN world) が参照するクロスワールドブリッジキー
  function applyState(enabled) {
    ROOT.dataset.nao = enabled ? 'on' : 'off';
    if (enabled) {
      pauseAllVideos();
    }
  }

  // --- 全動画を停止（/watch/ ページ以外のみ） ---
  function pauseAllVideos() {
    if (isWatchPage()) return;
    document.querySelectorAll('video').forEach(stopVideo);
  }

  // --- 初期状態を読み込み ---
  chrome.storage.local.get('enabled', function (result) {
    var enabled = result.enabled !== undefined ? result.enabled : true;
    applyState(enabled);
  });

  // --- リアルタイムトグル反映 ---
  chrome.storage.onChanged.addListener(function (changes, areaName) {
    if (areaName === 'local' && changes.enabled !== undefined) {
      applyState(changes.enabled.newValue);
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
