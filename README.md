# Netflix Autoplay Off

Netflixのトップページで自動再生されるプレビュー動画を無効化するChrome拡張機能です。

A Chrome extension that disables autoplay preview videos on Netflix.

## なぜ作ったか / Why

Netflixトップページの自動再生プレビューをずっと煩わしく感じていました。既存の拡張機能も多数ありますが、不要な権限を要求するものや出所が不明瞭なものが多く、安心して使えるものを探す手間のほうが大きかったため、自分で作りました。本拡張は余計な権限の要求や、機能の実現に不要な実装は一切含んでいません。

I've always found Netflix's autoplay previews on the top page annoying. There are plenty of existing extensions, but many request unnecessary permissions or come from unclear sources — and vetting them felt like more effort than just building my own. This extension requests no unnecessary permissions and contains no code beyond what is needed to do its job.

---

## 日本語

### 対応ブラウザ

Chrome / Edge / Opera / Brave / Vivaldi など、Chromium系ブラウザ（Chrome 111 相当以降）で動作します。

### 機能

- Netflixトップページのプレビュー動画の自動再生をブロック
- 拡張アイコンのバッジでON/OFFを表示
- 拡張アイコンのクリック、または右クリックメニューでワンクリック切り替え
- 日本語 / 英語の表示に対応

### インストール

1. このリポジトリをダウンロードする
   - **ZIPダウンロード（簡単）**: ページ上部の緑色の「Code」ボタン →「Download ZIP」をクリックし、展開する
   - **git clone**: `git clone https://github.com/kai-rin/netflix-autoplay-off.git`
2. Chromeで `chrome://extensions` を開く
3. 右上の「デベロッパーモード」をONにする
4. 「パッケージ化されていない拡張機能を読み込む」をクリック
5. ダウンロード・展開したフォルダを選択

### 使い方

- インストール後、Netflixを開くと自動的にプレビュー動画がブロックされます
- 拡張アイコンをクリックするとON/OFFが切り替わります（右クリック →「自動再生をブロック」でも可）
- ON（緑バッジ）: ブロック有効 / OFF（灰バッジ）: ブロック無効

### 仕組み

`HTMLVideoElement.prototype.play()` をオーバーライドし、Netflixが動画を再生しようとする呼び出しをインターセプトします。さらに `MutationObserver` で動的に追加される動画要素も監視・停止します。`/watch/` ページ（実際の動画視聴ページ）ではブロックを行わないため、通常の視聴には影響しません。

### テスト

依存パッケージ不要のE2Eテストを同梱しています（Node 24以降と、Chromium系ブラウザ、netflix.comへのネットワーク接続が必要）。ヘッドレスブラウザに拡張を読み込み、実際のNetflixページ上でブロック動作・トグル・バッジ表示を検証します。

```
node tests/e2e.mjs
```

---

## English

### Supported browsers

Works on Chromium-based browsers: Chrome / Edge / Opera / Brave / Vivaldi, etc. (Chrome 111 equivalent or later).

### Features

- Blocks autoplay preview videos on the Netflix top page
- Shows ON/OFF status via extension badge
- Toggle by clicking the extension icon, or from the context menu
- Localized UI (Japanese / English)

### Installation

1. Download this repository
   - **ZIP download (easy)**: Click the green "Code" button at the top of the page → "Download ZIP", then extract it
   - **git clone**: `git clone https://github.com/kai-rin/netflix-autoplay-off.git`
2. Open `chrome://extensions` in Chrome
3. Enable "Developer mode" in the top right
4. Click "Load unpacked"
5. Select the downloaded/extracted folder

### Usage

- After installation, preview videos on Netflix are automatically blocked
- Click the extension icon to toggle ON/OFF (or right-click → "Block autoplay")
- ON (green badge): blocking enabled / OFF (gray badge): blocking disabled

### How it works

Overrides `HTMLVideoElement.prototype.play()` to intercept Netflix's video playback calls. A `MutationObserver` also watches for dynamically added video elements and pauses them. Blocking is skipped on `/watch/` pages so that normal video playback is unaffected.

### Testing

A dependency-free E2E test is included (requires Node 24+, a Chromium-based browser, and network access to netflix.com). It loads the extension into a headless browser and verifies blocking, toggling, and the badge on the real Netflix page.

```
node tests/e2e.mjs
```

---

## License

[MIT](LICENSE)
