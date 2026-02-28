// inject.js -- MAIN world, document_start
// HTMLVideoElement.prototype.play() をオーバーライドしてNetflixの自動再生をブロック
// 状態は document.documentElement.dataset.nao で判定（content.js が設定）

(function () {
  'use strict';

  const originalPlay = HTMLVideoElement.prototype.play;
  const WATCH_PATH_RE = /^\/watch\//;

  // autoplay プロパティのオリジナル descriptor を取得
  const autoplayDesc =
    Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'autoplay') ||
    Object.getOwnPropertyDescriptor(HTMLVideoElement.prototype, 'autoplay');

  // /watch/ ページかどうか判定（実際の動画視聴ページではブロックしない）
  function isWatchPage() {
    return WATCH_PATH_RE.test(window.location.pathname);
  }

  // ブロック対象かどうか判定
  function shouldBlock() {
    return document.documentElement.dataset.nao !== 'off' && !isWatchPage();
  }

  // --- play() オーバーライド ---
  HTMLVideoElement.prototype.play = function () {
    if (shouldBlock()) {
      this.pause();
      return Promise.resolve();
    }
    return originalPlay.call(this);
  };

  // --- autoplay プロパティ setter オーバーライド ---
  if (autoplayDesc && autoplayDesc.set) {
    Object.defineProperty(HTMLVideoElement.prototype, 'autoplay', {
      get: function () {
        return autoplayDesc.get.call(this);
      },
      set: function (value) {
        if (shouldBlock()) {
          return autoplayDesc.set.call(this, false);
        }
        return autoplayDesc.set.call(this, value);
      },
      configurable: true,
      enumerable: true
    });
  }
})();
