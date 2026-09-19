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

- [x] v0.1.0 released + installed via HACS (repo id 1377138869). Demo: card-lab section 4 —
      one sb-nav-select (target lab-metra-line) + two sb-param-cards wrapping the Metra
      timetable markdown with '$line$'. Verified headless: UP-W→BNSF→ME re-renders real
      timetables (UP-W Saturday 1325 chars, BNSF Modified 2107, ME Saturday 5745), child stays
      HUI-MARKDOWN-CARD (setConfig in place, no rebuild), zero page errors.
      Probe gotcha: markdown output lives in ha-markdown's SHADOW root — textContent on the
      wrapper returns "" and looks like a failure; walk the shadow roots.
- Collapses the 11 per-line clones the user maintained by hand (tables + maps views).
- [x] MAP VERIFIED 2026-09-19: one sb-param-card wrapping `type: map` with
      `geo_location_sources: [metra_$line:slug$]`, sharing storage_id `lab-metra-line` with the
      timetable cards — ONE dropdown drives name-form ('UP-W' in the macro) and slug-form
      ('metra_up_w' in the map source) simultaneously, which is what the :slug transform exists
      for. hui-map-card is REUSED across switches (same element identity, `setConfig` path —
      no rebuild), sources update, engine markers render (BNSF train near Westmont, Leaflet
      path since headless has no WebGL2). Zero page errors.
      Zoom preservation across setConfig therefore has the best possible shape, but was NOT
      isolated as a test (demo uses auto_fit: true, which refits deliberately when switching
      lines); if a user wants sticky zoom, turn auto_fit off and re-check.
