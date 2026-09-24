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

## v0.3.0 — a pure socket (2026-09-23)

The choice list is gone from this card. The allowlist comes from the knob
(SB Filter Select) sharing this key via `window.__sbKnobs`; the card
re-evaluates on `sb-knob-changed`. `_choices()` = knob values, then `default`.
(v0.3.1: the pre-0.3.0 fallback for a list typed into this card, and the
editor's "Remove the copy" link, were deleted — user: the cards are too new
to carry legacy paths. `resolveItems` went with it.) With no knob, only the default is used.
`show_value` renders a one-line header (parameter: label ✕); a rejected URL
value says so instead of showing an empty label. The editor is parameter /
default (a dropdown of the knob's choices when a knob is on the page, else
text) / show_value / card.

The Metra views' seven table sockets and two map sockets lost their nine
duplicate lists; card-lab's three browsers are now wrapped sockets with
`filter: $q$`. Verified headless (`knob_socket_test.js`): choices 11 from the
knob on Metra, wrapped browsers filter 275→13 rows, ✕ clears, an un-offered
URL value falls back to default, no page errors.

## v0.4.0 — one card, two switches (2026-09-23)

The user kept asking why two cards existed for one parameter. Answer: they
did not need to. Filter Select's filter mode moved in here as
`show_selector`: a Param Card with the dropdown on is the KNOB (carries
`choices` / `choices_source`, draws the `<select>`, writes the URL,
publishes to `window.__sbKnobs` + `sb-knob-changed`); a Param Card with a
`card` is a SOCKET; a card can be both. `sb-nav-select` is a pure
navigation menu again. Rules: `_value()` = URL value if the knob offers it,
else `default`, else "" (NOT the first choice — the knob and every socket
must agree). The knob's dropdown shows the placeholder until a choice is
made unless a default is set. Rendering is light DOM in this order:
`<style>`, `ha-card.sbp-knob` (selector), `.sbp-bar` (socket-only value
header), the child. Editor: parameter, key, show_selector → (title,
placeholder, choices…), default (dropdown of the choices when known), card
picker with "No card (dropdown only)". Views migrated by
`merge_knobs.py` (scratchpad): Metra tables/maps, card-lab, demo. Verified
headless (`onecard_test.js`): real `<select>` pick → URL → 3 sockets
rebuild; 7/7 Metra tables follow the knob; no page errors.

## v0.5.0 — the editor is an overview with dialogs (2026-09-23)

User complaint: HA card editors are a wall of fields. The Param Card editor
is now an OVERVIEW of three read-only groups — Parameter (key, name,
default, "this card is knob / socket / both", "shared with N other cards"),
Dropdown (choice count and source, label), Wrapped card (type, `$token$`
usage count, unknown tokens flagged) — each with an Edit button opening one
focused native `<dialog>` (`showModal()`, top layer, stacks over HA's own
card-editor dialog from inside its shadow tree). Edits apply LIVE so HA's
preview follows; a snapshot is taken on open; Cancel restores it; Done / ✕
/ Escape keep. The Wrapped-card dialog embeds HA's `hui-card-element-editor`
/ `hui-card-picker` as before.

Two bugs found only by running it inside the real editor:
- **HA's preview is a second knob.** Two knobs with one key ping-ponged
  `sb-knob-changed` → `_publish` → announce until the stack overflowed. A
  knob now only refreshes its own dropdown on that event, and `_publish`
  yields when a live knob already publishes the same list.
- **`_renderCardEditor` is async**; the dialog body could be rebuilt while
  it awaited `loadHuiEditors()`, so it appended HA's editor into a detached
  box. It now renders only into the box that is still on screen and never
  reuses an editor that is not inside it.

Headless harness (`editor_live_test.js` / `preview_probe.js`): enter edit
mode with `hui-root.lovelace.setEditMode(true)`, open a card's editor with
`hui-card-edit-mode._editCard()`; the preview card lives under
`ha-dialog < hui-dialog-edit-card`; HA's dialogs are native `<dialog>`s
too, so exclude ours with `closest("dialog.sped")`, not `closest("dialog")`.
Verified: overview text, dialog `:modal`, live edit changes the preview
only, Cancel restores, nested HA editor renders the Entity Browser editor.
Not done: a wheel-over-backdrop scroll guard (the scheduler card has one).
Next: multi-parameter, then the same shell for Entity Browser.

## v0.6.0 — up to 8 parameters per card (2026-09-23)

Config is `parameters: [{name, key, default, dropdown, title, placeholder,
choices | choices_source…, all_label}]` + `card` + `show_value`. `normalise()`
folds the 0.5.x single-parameter fields into one entry on read;
`denormalise()` writes only the new shape. `MAX_PARAMS = 8` — the user asked
for 5–10; past a handful the overview and the URL stop being readable.
Per parameter the card is knob (`dropdown: true`) or socket; the registry is
keyed per parameter (`seb-<key>`) and now carries the knob's **default**, so a
socket with no default of its own follows the knob's — otherwise a knob with
`default: Workday` showed Workday while its silent socket showed "" (seen on
the demo's ④ section before the fix). Substitution runs once per parameter;
the child rebuilds when the JSON of all values changes. The knob card draws
one dropdown row per `dropdown` parameter in one `ha-card`. Editor: the
Parameters dialog is rows of name/key/default with add (up to the cap) and
remove (never below one); the Dropdowns dialog has a tab per parameter. Peer
count excludes HA's editor preview by walking shadow hosts — `closest()`
does not cross them. Demo view section ④ is the two-parameter example
(`add_multiparam_section.py`); `multiparam_test.js` drives it and the editor.

## v0.6.1 — one visual card (2026-09-23)

User: the demo's ④ items "bleed into one another" — the socket's value
header was a bare div floating between cards, and a knob's dropdown sat in
its own ha-card above the wrapped card. `_layout()` now joins whatever is
stacked above the child into one outline: `.sbp-knob.cap` / `.sbp-bar.cap`
take the theme's card background and border with the bottom edge open and
radius only on the top corners; the child gets
`--ha-card-border-radius: 0 0 var(--sbp-radius) var(--sbp-radius)` and no
shadow (custom properties inherit INTO the wrapped card's ha-card — the one
way to style it from outside). `--sbp-radius` is captured on the host from
`--ha-card-border-radius` before the child overrides it. Bare knob (no card)
and bare socket are unchanged.

## v0.7.0 — `text` above the dropdowns (2026-09-23)

User request: text (string or Jinja) above the dropdown, shown even when
there is no dropdown. `text` lives in the head block (`ha-card.sbp-knob`)
before the dropdown rows; the head now exists when EITHER text or a knob
parameter is present, so a silent socket can carry a caption. Rendering:
`$name$` substituted first, then — if the string contains `{{` / `{%` — a
`render_template` WebSocket subscription (what the markdown card does),
output into an `ha-markdown`; plain text goes straight to `ha-markdown`.
The subscription is re-made when the substituted source changes
(`_textSrc`) and dropped on disconnect / setConfig. `_update` re-renders the
text when the values signature changes even if the child is kept. Editor:
the field sits at the top of the Dropdowns dialog; the overview's Dropdowns
group shows "Text above" (with a Jinja chip). A card with only `text` is
allowed (a caption card).

## v0.8.0 — apply to a field, registry choices (2026-09-24)

User's motivating case: drive an Entity Browser by AREA from a dropdown. The
browser's `areas`/`labels` are HA pickers in its editor — a `$token$` has
nowhere to live — and `filter` only knows ids/names/states. The user's
better idea, instead of new browser fields: let the wrapper WRITE the field
behind the scenes. Per parameter, `apply: {field, mode}` — `applyField()`
writes the value into a dotted path of the built config (`set` replaces,
`append` adds to a list, creating it); an EMPTY value leaves the field
alone, so "Everywhere" means no narrowing. Runs after `$name$` substitution
in `_update`. The stored card config never changes (`tokenInStored: false`
in `apply_test.js`).

`choices_source: areas | labels | floors` fills the knob from HA's
registries (label = name, value = id). Areas and floors are on the `hass`
object; the LABEL registry is not — fetched once over WS
(`config/label_registry/list`), cached module-wide, and announced with a
`sb-registry-ready` window event so cards re-publish/re-render when it lands.

Editor: Wrapped-card dialog gains an "Apply parameters to fields" table
(field text + replace/append select per parameter); the overview's Uses
row reads `$area$ → areas (append)`, and a parameter with an `apply` is not
flagged unused. Demo ⑤ (`add_apply_demo.py`): 22 areas + Everywhere; Kitchen
→ built `areas: ["kitchen"]`, 76 → 1 rows; bogus URL → default. Caveat
documented in README: EB `areas` is the BASE tier — appending to a card that
already has areas widens.

## v0.8.2 — the dropdown closed by itself (2026-09-24)

User: an area/label dropdown "shows all the options, then loses focus and
disappears". Cause: for registry/entity-sourced knobs `set hass` called
`_publishAll()`, which ended with an unconditional `_renderSelector(true)`
— rebuilding the `<select>`'s innerHTML on EVERY hass tick (several per
second), which closes an open native popup. Fix: `_publishAll` re-renders
only when a list actually changed, and `_renderSelector` never rebuilds
while a `select` inside it has focus (`_selDirty` → catch up on blur).
Measured: 51 hass ticks with the area select focused, same element, still
focused. General rule for any card: never rebuild a native control from a
hass setter unless its content changed, and never while it is focused.

## v0.9.0 — `multiple`: a dropdown of checkboxes (2026-09-24)

User: areas and labels need several selections. Per parameter `multiple:
true`: the knob renders a custom control (`.msel`: a button that reads like
a select + an absolutely positioned `.mpanel` of checkboxes with Clear /
Done) — a native `<select multiple>` is unusable on a dashboard. Ticks apply
LIVE (each change → `_pick(p, list)`), the panel stays open (the head's
"never rebuild while in use" guard now also checks `.mpanel.open`), closes
on Done / outside click. Value model: `_valueOf` returns a list (URL
`a,b`, `_splitList`, only offered choices kept; `[]` = nothing chosen);
`transform` joins lists with "," and `:json` gives a JSON array;
`applyField` writes the list (set) or concatenates (append); an empty list
leaves the field alone. The registry entry carries `multiple` so a silent
socket parses the URL the same way. Editor: "Allow several choices" toggle
under the dropdown switch; overview chip "multi". Demo ⑤ is multiple now
with a silent socket showing `$area$` and `$area:json$` in Jinja
(`multi_test.js`: kitchen → office ticked live, builtAreas [kitchen,office],
1 → 13 rows, panel survives 6 s of hass ticks, bogus URL entry dropped,
Clear → 76 rows).

## Demo ⑥ — word + areas + labels on one wrapper (2026-09-24)

No code change: three parameters (word → pattern substitution; multi areas
and multi labels → `apply` set) on one card over a plain browser. Measured:
battery 284 → + Kitchen/Office 35 → + label Matter Thread Relay 1 → all
three 0 (no such entity). Trap found: a blank word parameter substitutes an
empty pattern, which the browser ignores → EVERY entity (~9,000 rows, the
first screenshot came back with 0 rows still rendering). Give the word a
`default`, or a base word in the pattern ("sensor $kind$"). README says so.

## v0.10.0 — `only`: any area/label, or just these (2026-09-24)

User: area/label dropdowns should offer either everything or a chosen
subset. `only: [ids]` on a registry-sourced parameter filters
`registryChoices`; empty = all. Editor: a real HA picker — `selector:
{area|label|floor: {multiple: true}}` chosen by `choices_source` — labelled
"Only these areas/labels/floors"; the picker shows names and flags an
unknown id as "Unknown area selected" (seen with a made-up `family_room`).
Overview reads "2 of HA's areas (only these)" vs "all 60 of HA's labels".
A URL value outside the subset is dropped like any non-choice
(`?seb-combo-area=kitchen,backyard` → [kitchen]). Demo ⑥'s Areas is
restricted to three.

## v0.10.1 — "no entities match" on a label dropdown (2026-09-24)

User's Home-view card: a labels knob (`only: [matter_hub, matter_relay]`)
over a browser → 0 rows. Three causes, read from the live config: (1) the
parameter had NO `apply` — the dropdown fed nothing (the overview said
"$p2$ unused", in the group the screenshot cut off); (2) the browser's own
base pattern was `hub` (my `filter: hub` → `patterns: [hub]` rewire of the
day before) and the Nest plugs carrying the label have no "hub" in their
names; (3) `___no_items_available___` in the browser's `labels` — HA's
label picker emits that placeholder when its list is empty.
Fixes: `only` and (EB 0.14.1) `labels`/`areas` drop `___*` placeholders;
choosing an areas/labels/floors source in the editor now DEFAULTS
`apply: {field: <that>, mode: set}` when nothing consumes the parameter; the
Dropdowns dialog says where the value goes ("Value goes to the wrapped
card's `labels` field") or warns that nothing uses it. Verified in the real
editor (`autoapply_test.js`). The `hub` pattern is the user's to remove.

## v0.10.2 — "areas still don't filter" (2026-09-24)

The user's card: `choices_source: labels` (only matter_hub/matter_relay)
but `apply: {field: areas}` — a LABEL id written into the AREAS field can
never match. Cause: v0.10.1's auto-default set `apply` once (areas) and
did not follow when the source was switched to labels, because "apply
already exists" suppressed it. Now a source change moves a still-default
apply to the new source's field (labels → labels), keeping the mode; and
both the Dropdowns dialog and the overview flag a registry source applied
to a different registry field ("offers labels!"). EB's `entityAreaId`
does resolve an entity's area via its device (1,935 entities have an area
only that way; 34 directly) — areas matching itself was fine.
