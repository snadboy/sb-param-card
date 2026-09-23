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

## Options

| Option | Meaning |
|---|---|
| `storage_id` | The **key**: cards sharing it share the value (URL `seb-<key>`). Auto-generated; copy it to the other cards |
| `parameter` | The name used in `$name$` (default `value`) |
| `show_selector` | This card draws the dropdown — it is the knob |
| `title` / `placeholder` | Dropdown label and its "nothing chosen" text (knob) |
| `choices` | The knob's choices: `label` + `value` per row |
| `choices_source` | `static` (default) or `entity` — choices read live from an entity attribute (`source_entity` / `source_attribute`; a dictionary contributes its keys, a list its entries) |
| `all_label` | Optional first choice that clears the value, e.g. "All lines" |
| `default` | Value used before a choice is made, or when a link carries a value the knob does not offer. With no default the parameter is empty |
| `card` | The wrapped card config (any card; `$name$` anywhere in it) |
| `show_value` | Socket only: a one-line header with the current value and a ✕ that clears it |


On a value change the wrapped card is rebuilt (HA cards are not built to be
reconfigured twice; the calendar card, for one, stops fetching). A `map` is
reconfigured in place instead so its zoom survives.

A link or a `navigate` action to `/dashboard/view?seb-line=BNSF` lands on a view with its parameter preset — handy for buttons that jump straight to one line.

## Installation (HACS)

HACS → custom repositories → `snadboy/sb-param-card`, category **Dashboard**.

MIT licensed.
