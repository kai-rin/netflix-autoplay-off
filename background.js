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
    // 更新時は旧メニューが残り duplicate id になり得るため removeAll してから作る
    chrome.contextMenus.removeAll(function () {
      chrome.contextMenus.create({
        id: MENU_ID,
        title: chrome.i18n.getMessage('menuToggle'),
        type: 'checkbox',
        checked: currentEnabled,
        contexts: ['action']
      });
    });
  });
});

// --- アイコン左クリックでトグル ---
// get→set を直列化し、連打時に両クリックが同じ旧値を読んでトグルが
// 1回分失われるのを防ぐ
var toggleQueue = Promise.resolve();
chrome.action.onClicked.addListener(function () {
  toggleQueue = toggleQueue.then(function () {
    return chrome.storage.local.get('enabled').then(function (result) {
      return chrome.storage.local.set({ enabled: !getEnabled(result) });
    });
  });
});

// --- コンテキストメニュークリック ---
chrome.contextMenus.onClicked.addListener(function (info) {
  if (info.menuItemId === MENU_ID) {
    chrome.storage.local.set({ enabled: info.checked });
  }
});

// --- ストレージ変更時のバッジ・メニュー同期 ---
chrome.storage.onChanged.addListener(function (changes, areaName) {
  if (areaName === 'local' && changes.enabled !== undefined) {
    // キー削除時は newValue が undefined → デフォルト（有効）に揃える
    var enabled = getEnabled({ enabled: changes.enabled.newValue });
    updateBadge(enabled);
    // アイコン左クリック等メニュー外からの変更にチェック状態を追従させる
    chrome.contextMenus.update(MENU_ID, { checked: enabled }, function () {
      // メニュー未作成のタイミングでは失敗し得るが無害（onInstalled で正しく作られる）
      void chrome.runtime.lastError;
    });
  }
});
