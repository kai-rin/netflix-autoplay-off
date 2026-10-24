# CLAUDE.md

Guidance for AI coding agents and contributors working on this repository.

Chrome MV3 extension that blocks Netflix's autoplay previews and adds player
tools on `/watch/` pages (Document PiP with subtitles and controls, auto skip
intro/recap, next-episode control, "still watching" dismissal, speed and
shortcuts). Netflix-only, minimal permissions, no external requests, no
dependencies (see README) — do not add permissions, host access, network
calls, or dependencies without the owner's explicit request.

## Testing

- `node tests/e2e.mjs` — zero-dependency E2E (Node 24+, headless browser + CDP,
  needs network access to netflix.com). `/watch/` features are tested against a
  mock player served via CDP `Fetch` (real playback needs login + DRM), so
  Netflix markup changes (data-uia names) are only caught by a manual check.
- Branded Google Chrome 137+ ignores `--load-extension`; the test auto-falls
  back to Edge / Chromium. Set `CHROME_PATH` to force a specific binary.
- Run the E2E after any behavior change. New i18n keys must be added to every
  locale under `_locales/` (enforced by the static checks in the test).

## Architecture

- `inject.js` (MAIN world) overrides `play()` / `autoplay`; `content.js`
  (ISOLATED world) bridges `chrome.storage` to `documentElement.dataset.nao*`
  (`nao`, `naoSkipIntro`, `naoStill`, `naoNext`, `naoKeys`, `naoPipSize`).
- `player.js` (MAIN world) holds all `/watch/` features. It runs in MAIN
  because seeking must go through `window.netflix...videoPlayer.seek(ms)` —
  writing `video.currentTime` breaks Netflix playback. PiP window size goes back
  to `content.js` as a `nao-pip-size` CustomEvent (MAIN world has no
  `chrome.storage`).
- Settings defaults are duplicated in `content.js` and `popup.js`; keep them
  in sync.
- `minimum_chrome_version` is 116 (Document Picture-in-Picture).
- `/watch/` pages are excluded by checking `location.pathname` at call time —
  Netflix is an SPA, so never cache the result of that check.
- `world: "MAIN"` in static content scripts requires Chrome 111+; do not lower
  `minimum_chrome_version`.

## Deliberate design decisions (do not "fix")

- The context menu is created inside `onInstalled` — the documented-correct
  pattern; Chrome persists menu registrations and restores them when the
  extension is re-enabled. Do not move creation to service-worker top level.
- `contextMenus.onClicked` writes `info.checked` (the state the user actually
  saw), not a toggle of the stored value.
- The action has a popup, so `action.onClicked` never fires; toggles live in
  `popup.js` and write the checkbox state directly (no get→set race).
- PiP moves Netflix's own `<video>` (no capture/re-encode, so DRM and quality
  are kept) and restores it to its original parent on `pagehide`. Subtitles are
  mirrored, not moved, so Netflix's own subtitle layout is untouched.
- Native browser PiP is enabled by clearing `disablePictureInPicture` on every
  tick, and Media Session handlers (seekbackward/seekforward/nexttrack) are
  re-registered every tick because Netflix may overwrite them. Native PiP
  cannot show subtitles (DOM overlay; DRM frames can't be drawn to a canvas),
  hence the Document PiP as well.
- Keys: `Alt+P` toggles native PiP, `Alt+Shift+P` toggles Document PiP.
- Both PiP kinds need user activation in the page. They open from in-page key
  presses, or from the popup buttons: `popup.js` calls
  `scripting.executeScript` (MAIN world) during the click, which runs with a
  user gesture, and dispatches `nao-pip-request` to `player.js`. That is why
  the extension has `activeTab` + `scripting`. A plain `tabs.sendMessage` does
  not carry the gesture.
- Auto-pressed buttons are remembered in a WeakSet so a lingering countdown
  button is never pressed twice (double next-episode skips).

## Style

- Extension source comments are Japanese (existing style); `tests/` uses
  English.
- README is bilingual (ja/en) — update both sections together.
