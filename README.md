# SB Param Card

A Home Assistant dashboard card that gives **any card a runtime parameter**.

Wrap a card, define the choices, and write `$name$` wherever the value
belongs — inside a Jinja template, an entity id, a map's
`geo_location_sources`, a title. The value comes from the URL
(`?seb-<storage_id>=…`, what
[SB Filter Select](https://github.com/snadboy/sb-nav-select) writes), so
**one card plus one dropdown replaces N near-identical cards**.

No helper entities, no YAML: the parameter and its choices are configured
visually, and the wrapped card uses Home Assistant's own card editor.

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

## Safety

The value taken from the URL is **allowlisted against the configured
choices**. A link someone sends you can only select a value you configured —
arbitrary text never reaches a template that Home Assistant executes.

## Options

| Option | Meaning |
|---|---|
| `parameter` | The name used in `$name$` (default `value`) |
| `items` | The choices: `label` + `value` per row |
| `default` | Choice used before one is made |
| `card` | The wrapped card config |
| `storage_id` | URL key (`seb-<storage_id>`), auto-generated |

## Installation (HACS)

HACS → custom repositories → `snadboy/sb-param-card`, category **Dashboard**.

MIT licensed.
