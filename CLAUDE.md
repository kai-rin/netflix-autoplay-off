# CLAUDE.md

Guidance for AI coding agents and contributors working on this repository.

Chrome MV3 extension that blocks Netflix's autoplay previews. Single purpose,
minimal permissions, no-bloat policy (see README) — do not add features,
permissions, or dependencies beyond what the stated purpose requires.

## Testing

- `node tests/e2e.mjs` — zero-dependency E2E (Node 24+, headless browser + CDP,
  needs network access to netflix.com)
- Branded Google Chrome 137+ ignores `--load-extension`; the test auto-falls
  back to Edge / Chromium. Set `CHROME_PATH` to force a specific binary.
- Run the E2E after any behavior change. New i18n keys must be added to every
  locale under `_locales/` (enforced by the static checks in the test).

## Architecture

- `inject.js` (MAIN world) overrides `play()` / `autoplay`; `content.js`
  (ISOLATED world) bridges `chrome.storage` to `documentElement.dataset.nao`.
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
- `chrome.storage` get→set is not serialized by Chrome; keep the promise-chain
  serialization in the `action.onClicked` handler to avoid lost toggles.

## Style

- Extension source comments are Japanese (existing style); `tests/` uses
  English.
- README is bilingual (ja/en) — update both sections together.
