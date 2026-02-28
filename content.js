// content.js -- ISOLATED world, document_start
// chrome.storage と DOM dataset 属性の橋渡し + MutationObserver バックアップ

(function () {
  'use strict';

  const ROOT = document.documentElement;

  // --- 状態を DOM に反映 ---
  function applyState(enabled) {
    ROOT.dataset.nao = enabled ? 'on' : 'off';
    if (enabled) {
      pauseAllVideos();
    }
  }

  // /watch/ ページかどうか判定（動画視聴ページではブロックしない）
  function isWatchPage() {
    return /^\/watch\//.test(window.location.pathname);
  }

  // --- 全動画を停止（/watch/ ページ以外のみ） ---
  function pauseAllVideos() {
    if (isWatchPage()) return;
    document.querySelectorAll('video').forEach(function (video) {
      video.pause();
      video.autoplay = false;
    });
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
      if (ROOT.dataset.nao !== 'on' || isWatchPage()) return;

      for (var i = 0; i < mutations.length; i++) {
        var addedNodes = mutations[i].addedNodes;
        for (var j = 0; j < addedNodes.length; j++) {
          var node = addedNodes[j];
          if (node.nodeType !== Node.ELEMENT_NODE) continue;

          if (node.tagName === 'VIDEO') {
            node.pause();
            node.autoplay = false;
          }

          if (node.querySelectorAll) {
            var videos = node.querySelectorAll('video');
            for (var k = 0; k < videos.length; k++) {
              videos[k].pause();
              videos[k].autoplay = false;
            }
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
