// popup.js -- 拡張アイコンのポップアップ
// 各設定を chrome.storage.local に読み書きする（content.js が Netflix のページへ反映）

// 設定キーとデフォルト値（content.js と揃える）
const DEFAULTS = {
  enabled: true,
  skipIntro: true,
  skipStillWatching: true,
  nextEpisode: 'netflix',
  shortcuts: true
};

document.querySelectorAll('[data-i18n]').forEach((node) => {
  node.textContent = chrome.i18n.getMessage(node.dataset.i18n);
});

async function init() {
  const stored = await chrome.storage.local.get(Object.keys(DEFAULTS));
  const settings = Object.assign({}, DEFAULTS, stored);

  document.querySelectorAll('[data-key]').forEach((input) => {
    const key = input.dataset.key;
    if (input.type === 'checkbox') {
      input.checked = settings[key];
      input.addEventListener('change', () => chrome.storage.local.set({ [key]: input.checked }));
    } else {
      input.value = settings[key];
      input.addEventListener('change', () => chrome.storage.local.set({ [key]: input.value }));
    }
  });
}

init().catch((e) => console.error('popup init failed', e));
