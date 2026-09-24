# SB Param Card

A Home Assistant dashboard card that gives **any card a runtime parameter** — and the dropdown that sets it.

## One card, two switches

**SB Param Card** is a runtime parameter shared through the page URL
(`?seb-<key>=value`). Cards that share a **key** (`storage_id`) share the
value; each card is one or both of:

| Switch | The card is… | What it does |
|---|---|---|
| **Show a dropdown** (`show_selector`) | the **knob** | carries the choices, draws the dropdown, **writes** the URL, publishes its choices for the sockets |
| **Wrap a card** (`card`) | a **socket** | substitutes `$parameter$` into the wrapped card — an entity id, a Jinja template, a map source, an Entity Browser's `filter` |

A knob with no card is a bare dropdown; a knob with a card drives that card
directly; a socket with no dropdown is silent and takes its choices from the
knob on the view. A socket accepts from the URL only what the knob offers
(plus its `default`) — one list, one source of truth, and a link someone
sends you can never splice arbitrary text into a template.

## Why

Eleven per-line timetable cards, or eleven map cards that differ only in one
source name, are eleven copies to keep in step. With a parameter they are one
card:

```
{{ metra_timetable_grid('$line$', 'inbound') }}
geo_location_sources: [metra_$line:slug$]
```

## Transforms

| Token | "UP-W" becomes |
|---|---|
| `$line$` | `UP-W` |
| `$line:slug$` | `up_w` |
| `$line:lower$` | `up-w` |
| `$line:upper$` | `UP-W` |
| `$line:title$` | `Up-w` |

`:slug` follows Home Assistant's entity-id convention, so one choice can feed
both a friendly name and an entity/source id.

## Editing

The editor shows three groups — **Parameter**, **Dropdown**, **Wrapped card** —
as a read-only overview (what the card is, how many choices, which `$tokens$`
the wrapped card actually uses), each with an *Edit* button that opens one
focused dialog. Edits apply live to the preview; *Cancel* restores.

## Options

A card holds up to **8 parameters**. Each is one `$name$` in the wrapped card
and one key in the URL:

```yaml
type: custom:sb-param-card
parameters:
  - name: line            # $line$
    key: metra-line       # URL ?seb-metra-line=…  — cards sharing it share the value
    default: UP-W
    dropdown: true        # this card is the knob for $line$
    title: Line
    choices_source: entity
    source_entity: sensor.metra_schedule
    source_attribute: lines
  - name: dir             # $dir$ — a second dropdown on the same card
    key: metra-dir
    dropdown: true
    choices: [{label: Inbound, value: inbound}, {label: Outbound, value: outbound}]
card:
  type: markdown
  content: "{{ metra_timetable_grid('$line$', '$dir$') }}"
```

| Per parameter | Meaning |
|---|---|
| `name` | The name used in `$name$` |
| `key` | The URL key (`seb-<key>`); auto-generated, copy it into the other cards |
| `default` | Value before a choice is made, or when a link carries a value the knob does not offer. A socket without one follows the knob's default; with none anywhere the parameter is empty |
| `dropdown` | This card draws the dropdown for this parameter — it is the knob |
| `title` / `placeholder` | Dropdown label and its "nothing chosen" text |
| `choices` | Typed choices: `label` + `value` per row |
| `choices_source` | `static` (default) or `entity` — choices read live from `source_entity` / `source_attribute` (a dictionary contributes its keys, a list its entries) |
| `all_label` | Optional first choice that clears the value, e.g. "All lines" |

| Card | Meaning |
|---|---|
| `text` | Markdown or a Jinja template shown above the dropdowns — and with none, as a caption over a silent socket. Every `$name$` is substituted first, then Jinja is rendered live |
| `card` | The wrapped card config (any card; `$name$` anywhere in it) |
| `show_value` | Socket only: a one-line header with each parameter's current value and a ✕ that clears it |

The 0.5.x single-parameter shape (`parameter`, `storage_id`, `show_selector`, …) is still read.



On a value change the wrapped card is rebuilt (HA cards are not built to be
reconfigured twice; the calendar card, for one, stops fetching). A `map` is
reconfigured in place instead so its zoom survives.

A link or a `navigate` action to `/dashboard/view?seb-line=BNSF` lands on a view with its parameter preset — handy for buttons that jump straight to one line.

## Installation (HACS)

HACS → custom repositories → `snadboy/sb-param-card`, category **Dashboard**.

MIT licensed.
