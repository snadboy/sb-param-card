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
  change the child is REBUILT, except for types in `REUSE_IN_PLACE` (`map`),
  which get `setConfig` in place to keep their view state (zoom). See
  "In-place setConfig is an untested path" below for why the default flipped.
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
- [x] v0.2.0 DYNAMIC CHOICES: `items_source: entity` + source_entity/source_attribute — a dict
      attribute contributes its KEYS (sensor.metra_schedule -> lines = the 11 Metra lines), a
      list its entries, a list of objects its label/value fields. Resolved SYNCHRONOUSLY from
      hass (no async gap = allowlist never momentarily empty, default always honoured).
      Same resolver duplicated in sb-nav-select v0.5.0 (keep the two copies identical).
      Verified: dropdown + both allowlists show 11 from live state; a hostile link
      (?...={{ states }}) is REJECTED by the allowlist and the cards fall back to the default —
      the security property holds with dynamic choices too.
      CORRECTION 2026-09-19: an earlier note here claimed the card-lab demo carried zero
      hand-typed lines. It does not — the SAVED card-lab config still uses static `items`.
      card-lab is GUI-owned; that edit never landed. The dynamic form is live on the REAL
      views (below), which is what matters.

## Production conversion (2026-09-19)

The real `/dashboard-monitor/metra-tables` and `/dashboard-monitor/metra-maps` views each
carried **11 hand-cloned Bubble pop-ups** (a button grid + one pop-up per line). Proved
they were mechanical clones — normalising `'BNSF'` -> `'$line$'` and `metra_bnsf` ->
`metra_$line:slug$` makes all 11 byte-identical in both views — then replaced each set with
one `sb-nav-select` + param cards.

- tables: 7 param cards (the 6 markdown macro samples + the data-macro card), headings pass
  through unchanged (they carry no line name). 97,795 -> 16,303 chars.
- maps: 2 param cards (per-line map + active-trains list); the all-lines map is untouched.
  11,358 -> 2,423 chars. Whole dashboard 321,267 -> 240,936 bytes.
- Distinct storage_ids per view (`metra-tables-line` / `metra-maps-line`) so the two
  dropdowns don't cross-talk; both default to UP-W.
- Verified headless: 7/2 param cards mount, zero bubble-cards remain, content genuinely
  differs per line (MD-N renders Fox Lake<->Union Station), no unsubstituted tokens, and a
  hostile URL value still falls back to UP-W.

### Gotchas from the conversion

- **`python_transform` in ha-mcp is an AST-restricted sandbox**: no `import`, no `assert`
  (`raise` untested). Rely on `config_hash` as the structural guard instead — it pins the
  config to exactly what you inspected. Plain string `.replace` beat needing `re` anyway,
  because the line name only ever appears quoted (`'BNSF'`) in the Jinja.
- **Check `max_columns`/`column_span` before rebuilding a section.** These views are
  `max_columns: 2` with `column_span: 2`; copying card-lab's `4` would have silently
  changed the layout.
- **The user edits these dashboards in the GUI concurrently.** A mid-task `config_hash`
  conflict turned out to be them resizing a Card Lab card. `python_transform` edits the
  live config server-side, so surgical edits preserve such changes — re-read, don't force.


## In-place setConfig is an untested path in every HA card (v0.2.1, 2026-09-22)

v0.2.0 reconfigured a same-type child in place on a value change, to keep a
map's zoom. Wrapping HA's **calendar card** showed why that is wrong in
general: after `setConfig` the card flips to `ha-full-calendar.loading` with
a spinner and **never sends a new `calendar/event/subscribe`** — it
subscribes when created, not when reconfigured — so it sits on the spinner
until something unrelated makes it resubscribe (seen: ~14 s; the user saw
"a long delay"). It looked random because a change fired *before* the
card's first subscription happened to work. Measured with Playwright's own
WS frame capture (HA coalesces messages into JSON arrays — parse both).

HA's own `hui-card` never calls `setConfig` twice on an element; it
rebuilds on any config change. So the card now rebuilds by default and
reuses in place only for `REUSE_IN_PLACE = {"map"}`. Add a type there only
after checking its `setConfig` really is idempotent.

Probe gotcha that cost an hour: `deep(el, sel)` must start from
`el.shadowRoot`, not `el` — a custom element's light DOM is empty, so every
"no spinner / no grid" reading from a probe rooted at the element was blind.
