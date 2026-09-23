# SB Param Card

A Home Assistant dashboard card that gives **any card a runtime parameter** —
**the socket**.

Wrap a card and write `$name$` wherever the value belongs — inside a Jinja
template, an entity id, a map's `geo_location_sources`, an Entity Browser's
`filter`, a title. The value comes from the URL (`?seb-<storage_id>=…`),
which an [SB Filter Select](https://github.com/snadboy/sb-nav-select) — the
knob — writes, so **one card plus one dropdown replaces N near-identical
cards**. This card has no UI of its own (optionally a one-line header showing
the current value with a ✕).

## The three SB cards — one wire, three roles

| Card | Role | URL |
|---|---|---|
| **SB Filter Select** (`sb-nav-select`) | the **knob** — the only card that offers a choice; renders nothing else | **writes** `?seb-<target>=value` |
| **SB Param Card** (`sb-param-card`) | the **socket** — the only card that reads a value; wraps any card and substitutes `$parameter$` into it | **reads** `seb-<storage_id>` |
| **SB Entity Browser** (`sb-entity-browser`) | just a card — wrapped in a socket like a map or a markdown card would be | — |

A knob and a socket are wired by sharing a key (`target` on the knob =
`storage_id` on the socket). The socket accepts from the URL only the values
the knob offers, so the knob's list is the single source of truth; a link
carrying anything else falls back to the socket's `default`. One knob can
drive many sockets; two knobs on a view use two keys.

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

The value taken from the URL is **allowlisted against the choices the knob
sharing this key publishes** (plus the `default`). A link someone sends you
can only select a value the knob offers — arbitrary text never reaches a
template that Home Assistant executes. With no knob on the view, only the
default is ever used. (Choices typed into this card before 0.3.0 are still
honoured; the editor offers to remove the redundant copy.)

## Options

| Option | Meaning |
|---|---|
| `parameter` | The name used in `$name$` (default `value`) |
| `default` | Value used before a choice is made, when a link carries a value the knob does not offer, or with no knob on the view |
| `show_value` | Show a one-line header with the current value and a ✕ that clears it (default off) |
| `card` | The wrapped card config |
| `storage_id` | URL key (`seb-<storage_id>`), auto-generated; the knob's `target` must match |

On a value change the wrapped card is rebuilt (HA cards are not built to be
reconfigured twice; the calendar card, for one, stops fetching). A `map` is
reconfigured in place instead so its zoom survives.

## Installation (HACS)

HACS → custom repositories → `snadboy/sb-param-card`, category **Dashboard**.

MIT licensed.
