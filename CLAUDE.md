# sb-param-card — session notes

HACS dashboard card (born 2026-09-19): wraps ANY card config and deep-substitutes
a card-local parameter (`$name$`, transforms `:slug|:lower|:upper|:title`) into
every string before building the child. Value comes from `?seb-<storage_id>=`
(what SB Filter Select writes), ALLOWLISTED against configured choices — the
security boundary, since substitution splices text into templates HA executes.

| | |
|---|---|
| Repo | github.com/snadboy/sb-param-card — local `~/projects/git/sb-param-card` |
| Card | `custom:sb-param-card` + `sb-param-card-editor` |
| File | `dist/sb-param-card.js` — vanilla JS, no build |
| Why | user asked whether the parameter idea was coupled to markdown; a WRAPPER decouples it (markdown today, grid/map tomorrow) |

## Design

- Substitution is CLIENT-SIDE into the child's config, so it needs no
  `render_template` variables and works on non-template fields too.
- Child built via `window.loadCardHelpers().createCardElement()`. On a value
  change with the SAME card type we call `setConfig` in place rather than
  rebuilding — rebuilding resets child view state (map zoom, scroll position).
- `this._sbFilterTarget = {id, title}` marks the card for SB Filter Select's
  generic target discovery.
- Editor embeds HA's own `hui-card-picker` / `hui-card-element-editor`; both
  are lazily defined, so `loadHuiEditors()` forces the bundle first (same class
  of trap as ha-textfield outside ha-form). The editor also receives `.lovelace`
  from HA, which those elements require.

## Status

- [ ] v0.1.0 initial
