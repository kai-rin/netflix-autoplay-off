# Netflix Autoplay Off

Netflixのトップページで自動再生されるプレビュー動画を無効化し、再生画面に字幕付きPiP（小窓）・イントロ自動スキップ・再生速度変更などを追加するChrome拡張機能です。

A Chrome extension that disables autoplay preview videos on Netflix, and adds Picture-in-Picture with subtitles, auto skip intro, speed control and more to the player.

## なぜ作ったか / Why

Netflixトップページの自動再生プレビューをずっと煩わしく感じていました。既存の拡張機能も多数ありますが、不要な権限を要求するものや出所が不明瞭なものが多く、安心して使えるものを探す手間のほうが大きかったため、自分で作りました。本拡張は余計な権限の要求や、機能の実現に不要な実装は一切含んでいません。

I've always found Netflix's autoplay previews on the top page annoying. There are plenty of existing extensions, but many request unnecessary permissions or come from unclear sources — and vetting them felt like more effort than just building my own. This extension requests no unnecessary permissions and contains no code beyond what is needed to do its job.

---

## 日本語

### 対応ブラウザ

Chrome / Edge / Opera / Brave / Vivaldi など、Chromium系ブラウザ（Chrome 116 相当以降）で動作します。

### 機能

- Netflixトップページのプレビュー動画の自動再生をブロック（バッジでON/OFFを表示）
- **PiP（小窓）**: 再生画面で `Alt+P`。字幕・操作バー（再生/停止、10秒送り戻し、シークバー、音量、再生速度、次のエピソード）付きの小窓で再生。小窓の大きさを覚える。字幕が要らなければブラウザ標準の PiP ボタンも使える（Netflix が付けている PiP 禁止を外す。小窓で10秒送り戻し・次のエピソードが使える）
- **イントロ・前回のあらすじを自動スキップ**
- **「視聴を続けますか？」を自動で閉じる**
- **エピソードの終わり**: Netflix の標準どおり／エンドクレジットですぐ次へ／次へ自動で進まない
- **再生速度とショートカット**: `[` `]` で 0.25〜3 倍、`\` で標準速度、`N` で次のエピソード
- 各機能は拡張アイコンのポップアップでON/OFF
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
- 拡張アイコンをクリックすると設定のポップアップが開きます（自動再生ブロックは右クリック →「自動再生をブロック」でも切り替え可）
- ON（緑バッジ）: ブロック有効 / OFF（灰バッジ）: ブロック無効
- 再生画面で `Alt+P` を押すと小窓で開き、もう一度 `Alt+P` で元に戻ります
- 小窓の中のキー: `Space` 再生/停止、`←` `→` 10秒、`↑` `↓` 音量、`M` ミュート、`C` 黒帯を詰める、`[` `]` 速度、`N` 次のエピソード

### 仕組み

`HTMLVideoElement.prototype.play()` をオーバーライドし、Netflixが動画を再生しようとする呼び出しをインターセプトします。さらに `MutationObserver` で動的に追加される動画要素も監視・停止します。`/watch/` ページ（実際の動画視聴ページ）ではブロックを行わないため、通常の視聴には影響しません。

PiP は Document Picture-in-Picture API で小窓を開き、Netflix の動画要素をそのまま小窓へ移します（再エンコードしないので画質は元のまま）。字幕は Netflix の字幕表示を小窓の大きさで描き直し、シークは Netflix のプレイヤー API で行います。ブラウザ標準の PiP は、Netflix が動画に付けている `disablePictureInPicture` を外して使えるようにし、Media Session API で10秒送り戻しと次のエピソードを登録します（標準 PiP は映像だけを映すため字幕は出ません）。スキップ等は Netflix 自身のボタンを押す方式です。すべて Netflix のページ内で動き、外部への通信はしません。

### テスト

依存パッケージ不要のE2Eテストを同梱しています（Node 24以降と、Chromium系ブラウザ、netflix.comへのネットワーク接続が必要）。ヘッドレスブラウザに拡張を読み込み、実際のNetflixページ上でブロック動作・トグル・バッジ表示を検証します。再生画面の機能（PiP・スキップ・ショートカット）は、ログインとDRM再生が要るため、`/watch/` の通信を模擬プレイヤーに差し替えて検証します。

```
node tests/e2e.mjs
```

---

## English

### Supported browsers

Works on Chromium-based browsers: Chrome / Edge / Opera / Brave / Vivaldi, etc. (Chrome 116 equivalent or later).

### Features

- Blocks autoplay preview videos on the Netflix top page (ON/OFF shown on the badge)
- **Picture-in-Picture**: press `Alt+P` on the player. A floating window with subtitles and controls (play/pause, ±10s, seek bar, volume, speed, next episode) that remembers its size. Without subtitles, the browser's own PiP button also works (Netflix's PiP block is removed; ±10s and next episode in the PiP window)
- **Auto skip intros and recaps**
- **Auto dismiss "Are you still watching?"**
- **At the end of an episode**: Netflix default / go to the next episode as soon as credits start / don't continue
- **Speed and shortcuts**: `[` `]` for 0.25–3x, `\` for normal speed, `N` for the next episode
- Every feature can be switched on/off from the extension popup
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
- Click the extension icon to open the settings popup (autoplay blocking can also be toggled via right-click → "Block autoplay")
- ON (green badge): blocking enabled / OFF (gray badge): blocking disabled
- Press `Alt+P` on the player to open the floating window, and `Alt+P` again to return
- Keys in the window: `Space` play/pause, `←` `→` 10s, `↑` `↓` volume, `M` mute, `C` fit to video, `[` `]` speed, `N` next episode

### How it works

Overrides `HTMLVideoElement.prototype.play()` to intercept Netflix's video playback calls. A `MutationObserver` also watches for dynamically added video elements and pauses them. Blocking is skipped on `/watch/` pages so that normal video playback is unaffected.

Picture-in-Picture opens a window with the Document Picture-in-Picture API and moves Netflix's own video element into it (no re-encoding, so quality is unchanged). Subtitles are redrawn at the window's size from Netflix's subtitle display, and seeking goes through Netflix's player API. The browser's own PiP is enabled by removing the `disablePictureInPicture` flag Netflix sets, and ±10s / next episode are registered via the Media Session API (native PiP shows video frames only, so no subtitles). Skipping works by pressing Netflix's own buttons. Everything runs inside the Netflix page; nothing is sent anywhere.

### Testing

A dependency-free E2E test is included (requires Node 24+, a Chromium-based browser, and network access to netflix.com). It loads the extension into a headless browser and verifies blocking, toggling, and the badge on the real Netflix page. Player features (PiP, skipping, shortcuts) need a login and DRM playback, so they are verified against a mock player served in place of `/watch/`.

```
node tests/e2e.mjs
```

---

## License

[MIT](LICENSE)
