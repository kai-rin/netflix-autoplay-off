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

// --- PiP ボタン ---
// PiP はページ側のユーザー操作が無いと開けない。ポップアップのクリック中に
// scripting.executeScript で注入したスクリプトはユーザー操作扱いで動くため、
// そこから player.js（MAIN world）へ開く指示のイベントを送る
const WATCH_URL_RE = /^https:\/\/www\.netflix\.com\/watch\//;

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function initPipButtons() {
  const tab = await activeTab();
  const onWatch = !!tab && WATCH_URL_RE.test(tab.url || '');
  const buttons = document.querySelectorAll('[data-pip]');
  buttons.forEach((button) => {
    button.disabled = !onWatch;
    button.addEventListener('click', async () => {
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          world: 'MAIN',
          func: (kind) => document.dispatchEvent(new CustomEvent('nao-pip-request', { detail: kind })),
          args: [button.dataset.pip]
        });
        window.close();
      } catch (e) {
        console.error('PiP request failed', e);
      }
    });
  });
  document.getElementById('pip-status').hidden = onWatch;
  if (onWatch) buttons[0].focus();
}

initPipButtons().catch((e) => console.error('PiP buttons init failed', e));
