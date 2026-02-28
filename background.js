// background.js -- Service Worker
// コンテキストメニュー管理、バッジ更新、状態永続化

var MENU_ID = 'toggle-autoplay-block';

// --- デフォルト値付きで enabled を取得 ---
function getEnabled(result) {
  return result.enabled !== undefined ? result.enabled : true;
}

// --- バッジ更新 ---
function updateBadge(enabled) {
  chrome.action.setBadgeText({ text: enabled ? 'ON' : 'OFF' });
  chrome.action.setBadgeBackgroundColor({
    color: enabled ? '#4CAF50' : '#9E9E9E'
  });
}

// --- トップレベル: Service Worker 起動時にバッジ復元 ---
chrome.storage.local.get('enabled', function (result) {
  updateBadge(getEnabled(result));
});

// --- インストール / 更新時 ---
chrome.runtime.onInstalled.addListener(function () {
  chrome.storage.local.get('enabled', function (result) {
    var currentEnabled = getEnabled(result);

    if (result.enabled === undefined) {
      chrome.storage.local.set({ enabled: true });
      // set が onChanged を発火させ updateBadge するので、ここでは呼ばない
    } else {
      updateBadge(currentEnabled);
    }

    // コンテキストメニュー作成（拡張アイコン右クリック専用）
    chrome.contextMenus.create({
      id: MENU_ID,
      title: '自動再生をブロック',
      type: 'checkbox',
      checked: currentEnabled,
      contexts: ['action']
    });
  });
});

// --- コンテキストメニュークリック ---
chrome.contextMenus.onClicked.addListener(function (info) {
  if (info.menuItemId === MENU_ID) {
    chrome.storage.local.set({ enabled: info.checked });
  }
});

// --- ストレージ変更時のバッジ更新 ---
chrome.storage.onChanged.addListener(function (changes, areaName) {
  if (areaName === 'local' && changes.enabled !== undefined) {
    updateBadge(changes.enabled.newValue);
  }
});
