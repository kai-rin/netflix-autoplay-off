# Netflix Autoplay Off

Netflixのトップページで自動再生されるプレビュー動画を無効化するChrome拡張機能です。

A Chrome extension that disables autoplay preview videos on Netflix.

---

## 日本語

### 機能

- Netflixトップページのプレビュー動画の自動再生をブロック
- 拡張アイコンのバッジでON/OFFを表示
- 右クリックメニューからワンクリックで切り替え

### インストール

1. このリポジトリをダウンロードまたはクローン
   ```
   git clone https://github.com/kai-rin/netflix-autoplay-off.git
   ```
2. Chromeで `chrome://extensions` を開く
3. 右上の「デベロッパーモード」をONにする
4. 「パッケージ化されていない拡張機能を読み込む」をクリック
5. ダウンロードしたフォルダを選択

### 使い方

- インストール後、Netflixを開くと自動的にプレビュー動画がブロックされます
- 拡張アイコンを右クリック →「自動再生をブロック」のチェックでON/OFFを切り替え
- ON（緑バッジ）: ブロック有効 / OFF（灰バッジ）: ブロック無効

### 仕組み

`HTMLVideoElement.prototype.play()` をオーバーライドし、Netflixが動画を再生しようとする呼び出しをインターセプトします。さらに `MutationObserver` で動的に追加される動画要素も監視・停止します。`/watch/` ページ（実際の動画視聴ページ）ではブロックを行わないため、通常の視聴には影響しません。

---

## English

### Features

- Blocks autoplay preview videos on the Netflix top page
- Shows ON/OFF status via extension badge
- Toggle with one click from the context menu

### Installation

1. Download or clone this repository
   ```
   git clone https://github.com/kai-rin/netflix-autoplay-off.git
   ```
2. Open `chrome://extensions` in Chrome
3. Enable "Developer mode" in the top right
4. Click "Load unpacked"
5. Select the downloaded folder

### Usage

- After installation, preview videos on Netflix are automatically blocked
- Right-click the extension icon → toggle "自動再生をブロック" (Block autoplay)
- ON (green badge): blocking enabled / OFF (gray badge): blocking disabled

### How it works

Overrides `HTMLVideoElement.prototype.play()` to intercept Netflix's video playback calls. A `MutationObserver` also watches for dynamically added video elements and pauses them. Blocking is skipped on `/watch/` pages so that normal video playback is unaffected.

---

## License

[MIT](LICENSE)
