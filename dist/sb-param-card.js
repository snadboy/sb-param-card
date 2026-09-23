/* SB Param Card — one card, two switches, up to MAX_PARAMS parameters.
 *
 * Each PARAMETER is shared through the page URL (?seb-<key>=value):
 *
 *   dropdown: true   for that parameter this card is the KNOB — it carries
 *                    the choices, draws the dropdown, writes the URL and
 *                    publishes its choices for the other cards sharing the key
 *   card: {...}      the card is a SOCKET — every $name$ is substituted into
 *                    the wrapped card before that card is built
 *
 * Either, or both: a bare dropdown (or several); dropdowns with the card they
 * drive right underneath; or a silent socket taking its choices from the
 * knobs elsewhere on the view. No helper entities.
 *
 * A socket accepts from the URL only the values the knob offers (plus the
 * parameter's default), so a link someone sends you can never splice
 * arbitrary text into a template Home Assistant will execute.
 *
 * Config (0.6.0):
 *   parameters: [{ name, key, default, dropdown, title, placeholder,
 *                  choices | choices_source/source_entity/source_attribute, all_label }]
 *   card, show_value
 * The 0.5.x single-parameter shape (parameter, storage_id, show_selector, …)
 * is still read and folded into one entry.
 */

const CARD = "sb-param-card";
const VERSION = "0.6.0";
// A card is a parameter BLOCK, not a form: past a handful the overview stops
// being readable and the URL stops being shareable by eye.
const MAX_PARAMS = 8;
// Card types whose element is re-configured in place on a value change
// instead of rebuilt (see _update). HA's own hui-card never calls setConfig
// twice on an element, so a second setConfig is an untested path in every
// card — the calendar card, for one, stops fetching. Add a type only after
// checking that its setConfig really is idempotent.
const REUSE_IN_PLACE = new Set(["map"]);

// The knob registry: key -> {el, items, sig}. Page-global on purpose — cards
// cannot see each other, and the URL (the wire between them) is global too.
const KNOBS = (window.__sbKnobs = window.__sbKnobs || new Map());
const announce = (key) =>
  window.dispatchEvent(new CustomEvent("sb-knob-changed", { detail: { key } }));

const fire = (node, type, detail) =>
  node.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
const esc = (v) =>
  String(v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// $name$ with optional :transform — :slug matches the integration's rule so
// "UP-W" lands as up_w wherever an entity/source id is needed.
const TOKEN = /\$([a-zA-Z_][\w-]*)(?::(slug|lower|upper|title))?\$/g;
const transform = (value, how) => {
  const s = String(value ?? "");
  if (how === "slug") return s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  if (how === "lower") return s.toLowerCase();
  if (how === "upper") return s.toUpperCase();
  if (how === "title") return s.replace(/\w\S*/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase());
  return s;
};
// Deep-substitute through every string in a card config without touching
// its structure.
const substitute = (node, name, value) => {
  if (typeof node === "string")
    return node.replace(TOKEN, (m, n, how) => (n === name ? transform(value, how) : m));
  if (Array.isArray(node)) return node.map((n) => substitute(n, name, value));
  if (node && typeof node === "object") {
    const out = {};
    for (const k of Object.keys(node)) out[k] = substitute(node[k], name, value);
    return out;
  }
  return node;
};

// ---- the knob's choices ---------------------------------------------------
// Typed in (label + value), or live from an entity attribute: a dict yields
// its keys, a list its entries, a list of objects its label/value fields.
// Resolved synchronously from hass so the list is never momentarily empty.
const resolveChoices = (hass, config) => {
  let out;
  if (config.choices_source === "entity") {
    const st = hass?.states?.[config.source_entity];
    const raw = st?.attributes?.[config.source_attribute];
    out = [];
    if (Array.isArray(raw)) {
      out = raw.map((item) => {
        if (item && typeof item === "object") {
          const value = config.source_value_field ? item[config.source_value_field]
            : item.value ?? item.id ?? item.name;
          const label = config.source_label_field ? item[config.source_label_field]
            : item.label ?? item.name ?? value;
          return { label: String(label ?? ""), value: String(value ?? "") };
        }
        return { label: String(item), value: String(item) };
      });
    } else if (raw && typeof raw === "object") {
      out = Object.keys(raw).map((k) => ({ label: k, value: k }));
    }
    out = out.filter((i) => i.value !== "");
    if (config.source_sort !== false)
      out.sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
  } else {
    out = (config.choices || [])
      .filter((i) => i && (i.label || i.value))
      .map((i) => ({ label: String(i.label ?? i.value ?? ""), value: String(i.value ?? "").trim() }));
  }
  if (config.all_label) out.unshift({ label: String(config.all_label), value: "" });
  return out;
};
const choicesSignature = (items) => items.map((i) => i.label + "\u0000" + i.value).join("|");


// ---- config shape -----------------------------------------------------------
const PARAM_FIELDS = ["name", "key", "default", "dropdown", "title", "placeholder", "choices",
  "choices_source", "source_entity", "source_attribute", "source_label_field", "source_value_field",
  "source_sort", "all_label"];
const newKey = () => "seb-" + Math.random().toString(36).slice(2, 8);

// One shape inside the card whatever was written: 0.6.0 `parameters` or the
// 0.5.x single-parameter fields. Never mutates the input.
const normalise = (config) => {
  const c = { ...config };
  let params;
  if (Array.isArray(c.parameters) && c.parameters.length) {
    params = c.parameters.map((p, i) => ({ name: p.name || `p${i + 1}`, key: p.key || newKey(), ...p }));
  } else {
    const p = { name: c.parameter || "value", key: c.storage_id || newKey(), dropdown: !!c.show_selector };
    for (const f of ["default", "title", "placeholder", "choices", "choices_source", "source_entity",
      "source_attribute", "source_label_field", "source_value_field", "source_sort", "all_label"])
      if (c[f] !== undefined) p[f] = c[f];
    params = [p];
  }
  return { ...c, parameters: params.slice(0, MAX_PARAMS) };
};

// What the editor writes: the 0.6.0 shape only, legacy fields dropped.
const denormalise = (config) => {
  const { parameter, storage_id, show_selector, title, placeholder, choices, choices_source,
    source_entity, source_attribute, source_label_field, source_value_field, source_sort, all_label, default: d, ...rest } = config;
  return { ...rest, parameters: (config.parameters || []).map((p) => {
    const q = {}; for (const f of PARAM_FIELDS) if (p[f] !== undefined && p[f] !== "" && p[f] !== null) q[f] = p[f]; return q; }) };
};

const STYLE = `
  .sbp-knob { padding: 12px 16px; display: flex; flex-direction: column; gap: 10px; margin-bottom: var(--sbp-gap, 8px); }
  .sbp-knob .krow { display: flex; align-items: center; gap: 12px; }
  .sbp-knob .title { font-weight: 500; color: var(--primary-text-color); white-space: nowrap; }
  .sbp-knob select { flex: 1; min-width: 0; font: inherit; color: var(--primary-text-color);
    background: var(--mdc-text-field-fill-color, rgba(127,127,127,.12)); border: none;
    border-bottom: 1px solid var(--divider-color); border-radius: 4px 4px 0 0; padding: 10px 12px;
    cursor: pointer; outline-color: var(--primary-color); color-scheme: light dark; }
  /* The native popup ignores the page theme: without explicit option colors,
     dark themes get light-gray text on a white popup. */
  .sbp-knob option { background: var(--card-background-color, Canvas); color: var(--primary-text-color, CanvasText); }
  .sbp-knob .warn { color: var(--warning-color, orange); font-size: .85em; }
  .sbp-bar { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 14px; padding: 4px 12px 6px; font-size: .85em; color: var(--secondary-text-color); }
  .sbp-bar b { color: var(--primary-text-color); }
  .sbp-bar .sbp-clear { cursor: pointer; color: var(--primary-color); margin-left: 4px; }
`;

class SbParamCard extends HTMLElement {
  static getConfigElement() {
    return document.createElement("sb-param-card-editor");
  }

  static getStubConfig() {
    return {
      parameters: [{ name: "value", key: newKey(), dropdown: true, title: "Choose", default: "one",
        choices: [{ label: "One", value: "one" }, { label: "Two", value: "two" }] }],
      card: { type: "markdown", content: "Parameter is **$value$**" },
    };
  }

  setConfig(config) {
    if (!config) throw new Error("Invalid configuration");
    this._config = normalise(config);
    this._child?.remove();
    this._child = null;
    this._childType = null;
    this._lastSig = undefined;
    this._sel?.remove(); this._sel = null; this._selSig = null;
    this._bar?.remove(); this._bar = null;
    this.querySelectorAll(":scope > ha-card.sbp-error").forEach((n) => n.remove());
    if (!this.querySelector(":scope > style")) {
      const st = document.createElement("style");
      st.textContent = STYLE;
      this.prepend(st);
    }
    if (this._hass) this._update();
  }

  set hass(hass) {
    this._hass = hass;
    if (this._knobs().some((p) => p.choices_source === "entity")) this._publishAll();
    if (this._child) this._child.hass = hass;
    else this._update();
  }

  getCardSize() {
    return (this._knobs().length ? 1 : 0) + (this._child?.getCardSize?.() ?? (this._config?.card ? 3 : 0));
  }

  connectedCallback() {
    this._onNav = () => this._update();
    // A knob only refreshes its dropdowns on this event; re-publishing here
    // would ping-pong with a second knob on the same key (HA's editor
    // preview IS a second knob) until the stack overflows. Verified.
    this._onKnob = (e) => {
      const p = this._params().find((q) => `seb-${q.key}` === e.detail?.key);
      if (!p) return;
      if (p.dropdown) { if (this._sel) this._renderSelector(true); return; }
      this._update();
    };
    window.addEventListener("location-changed", this._onNav);
    window.addEventListener("popstate", this._onNav);
    window.addEventListener("sb-knob-changed", this._onKnob);
    if (this._config && this._hass) this._publishAll();     // HA re-attaches cards during layout
    this._update();
  }

  disconnectedCallback() {
    window.removeEventListener("location-changed", this._onNav);
    window.removeEventListener("popstate", this._onNav);
    window.removeEventListener("sb-knob-changed", this._onKnob);
    for (const p of this._knobs()) {
      const key = `seb-${p.key}`;
      if (KNOBS.get(key)?.el === this) { KNOBS.delete(key); announce(key); }
    }
  }

  _params() { return this._config?.parameters || []; }
  _knobs() { return this._params().filter((p) => p.dropdown); }

  /** Publish every dropdown's choices for the sockets sharing its key. */
  _publishAll() {
    for (const p of this._knobs()) {
      const items = resolveChoices(this._hass, p);
      const sig = choicesSignature(items);
      const key = `seb-${p.key}`;
      const prev = KNOBS.get(key);
      const sigd = sig + "\u0003" + (p.default ?? "");
      if (prev && prev.sig === sigd && (prev.el === this || prev.el.isConnected)) continue;   // same list already published by a live knob
      KNOBS.set(key, { el: this, items, sig: sigd, default: p.default });
      announce(key);
    }
    if (this._sel) this._renderSelector(true);
  }

  _items(p) {
    if (p.dropdown) return resolveChoices(this._hass, p);
    return KNOBS.get(`seb-${p.key}`)?.items || [];
  }

  // The allowlist for one parameter: its choices (own, or the knob's), then its default.
  _choices(p) {
    const out = [];
    const push = (v) => { const s = String(v ?? ""); if (!out.includes(s)) out.push(s); };
    for (const i of this._items(p)) push(i.value);
    const def = this._default(p);
    if (def != null) push(def);
    return out;
  }

  _labelFor(p, value) {
    return this._items(p).find((i) => String(i.value ?? "") === value)?.label || value;
  }

  _live(p) {
    try { return new URLSearchParams(location.search).get(`seb-${p.key}`); } catch (e) { return null; }
  }

  _default(p) {
    // A socket without a default of its own follows the knob's, so the knob
    // and its sockets show the same thing before anything is chosen.
    if (p.default != null && p.default !== "") return String(p.default);
    if (!p.dropdown) { const k = KNOBS.get(`seb-${p.key}`); if (k && k.default != null && k.default !== "") return String(k.default); }
    return null;
  }

  _valueOf(p) {
    const url = this._live(p);
    const choices = this._choices(p);
    if (url != null && choices.includes(url)) return url;
    const def = this._default(p);
    if (def != null && choices.includes(def)) return def;
    // Nothing chosen and no default anywhere: EMPTY — never silently the
    // first choice.
    return "";
  }

  _values() {
    const out = {};
    for (const p of this._params()) out[p.name] = this._valueOf(p);
    return out;
  }

  /** Write a choice to the URL — the wire every socket on the page listens to. */
  _pick(p, value) {
    const params = new URLSearchParams(location.search);
    value ? params.set(`seb-${p.key}`, value) : params.delete(`seb-${p.key}`);
    const q = params.toString();
    history.pushState(null, "", location.pathname + (q ? "?" + q : "") + location.hash);
    fire(this, "location-changed", {});
  }

  _renderSelector(force = false) {
    const knobs = this._knobs();
    if (!knobs.length) { this._sel?.remove(); this._sel = null; return; }
    const rows = knobs.map((p) => ({ p, items: this._items(p), value: this._valueOf(p), live: this._live(p) }));
    const sig = rows.map((r) => choicesSignature(r.items) + "\u0001" + r.value + "\u0001" + (r.live == null)).join("\u0002");
    if (this._sel && this._selSig === sig && !force) return;
    this._selSig = sig;
    if (!this._sel) {
      this._sel = document.createElement("ha-card");
      this._sel.className = "sbp-knob";
      const style = this.querySelector(":scope > style");
      style ? style.after(this._sel) : this.prepend(this._sel);
    }
    this._sel.innerHTML = rows.map(({ p, items, value, live }, n) => {
      const cur = items.findIndex((i) => i.value === value);
      // Placeholder until a choice is made; a default counts as a choice only
      // when it is one of the items (then the dropdown shows it).
      const sel = live == null && this._default(p) == null ? -1 : cur;
      return `<div class="krow" data-n="${n}">
        ${p.title ? `<div class="title">${esc(p.title)}</div>` : ""}
        ${items.length ? `<select>
          <option value="-1" ${sel === -1 ? "selected" : ""} disabled hidden>${esc(p.placeholder || "Select…")}</option>
          ${items.map((i, k) => `<option value="${k}" ${k === sel ? "selected" : ""}>${esc(i.label || i.value)}</option>`).join("")}
        </select>` : `<div class="warn">No choices for $${esc(p.name)}$ yet — add some in the editor</div>`}
      </div>`;
    }).join("");
    this._sel.querySelectorAll(".krow").forEach((row) => {
      const r = rows[Number(row.dataset.n)];
      row.querySelector("select")?.addEventListener("change", (e) => {
        const item = r.items[Number(e.target.value)];
        if (item) this._pick(r.p, item.value);
      });
    });
  }

  // Optional header for a SOCKET: every parameter that has a URL value, each
  // with a ✕ that clears it. Off by default — seven sockets on one view do
  // not want seven headers.
  _renderBar() {
    const socketParams = this._params().filter((p) => !p.dropdown);
    const live = socketParams.map((p) => ({ p, live: this._live(p), value: this._valueOf(p) })).filter((x) => x.live != null && x.live !== "");
    const want = !!this._config.show_value && live.length > 0;
    if (!want) { this._bar?.remove(); this._bar = null; return; }
    if (!this._bar) {
      this._bar = document.createElement("div");
      this._bar.className = "sbp-bar";
      const anchor = this._sel || this.querySelector(":scope > style");
      anchor ? anchor.after(this._bar) : this.prepend(this._bar);
    }
    this._bar.innerHTML = live.map(({ p, live, value }, n) => {
      const shown = live === value ? esc(this._labelFor(p, value))
        : `<span style="color:var(--warning-color, orange)">“${esc(live)}” is not a choice — showing default</span>`;
      return `<span>${esc(p.name)}: <b>${shown}</b><span class="sbp-clear" data-n="${n}" title="Clear">✕</span></span>`;
    }).join("");
    this._bar.querySelectorAll(".sbp-clear").forEach((x) => x.addEventListener("click", () => {
      const { p } = live[Number(x.dataset.n)];
      const params = new URLSearchParams(location.search);
      params.delete(`seb-${p.key}`);
      const q = params.toString();
      history.replaceState(null, "", location.pathname + (q ? "?" + q : "") + location.hash);
      fire(this, "location-changed", {});
    }));
  }

  _error(msg) {
    this.querySelectorAll(":scope > ha-card.sbp-error").forEach((n) => n.remove());
    const el = document.createElement("ha-card");
    el.className = "sbp-error";
    el.style.cssText = "padding:16px; color:var(--warning-color, orange);";
    el.textContent = `SB Param Card: ${msg}`;
    this.appendChild(el);
  }

  async _update() {
    if (!this._hass || !this._config) return;
    if (!this._knobs().length && !this._config.card) {
      this._error("turn on a dropdown, wrap a card, or both");
      return;
    }
    this._publishAll();
    this._renderSelector();
    this._renderBar();
    if (!this._config.card) return;

    const values = this._values();
    const sig = JSON.stringify(values);
    if (this._child && sig === this._lastSig) {
      this._child.hass = this._hass;
      return;
    }
    this._lastSig = sig;
    let cfg = this._config.card;
    for (const [name, value] of Object.entries(values)) cfg = substitute(cfg, name, value);

    // Same card type? Only a few cards are re-configured IN PLACE, to keep
    // their view state (a map's zoom). Everything else is rebuilt.
    if (this._child && this._childType === cfg.type && REUSE_IN_PLACE.has(cfg.type)) {
      try {
        this._child.setConfig(cfg);
        this._child.hass = this._hass;
        return;
      } catch (e) {
        /* fall through to a rebuild */
      }
    }
    try {
      const helpers = await window.loadCardHelpers();
      const el = helpers.createCardElement(cfg);
      el.hass = this._hass;
      this._child?.remove();
      this.querySelectorAll(":scope > ha-card.sbp-error").forEach((n) => n.remove());
      this.appendChild(el);
      this._child = el;
      this._childType = cfg.type;
    } catch (e) {
      this._error(String(e.message || e));
    }
  }
}

// HA lazy-loads its card editor elements; force them in before we use them
// (the same class of trap as ha-textfield outside ha-form).
const loadHuiEditors = async () => {
  if (customElements.get("hui-card-element-editor") && customElements.get("hui-card-picker")) return true;
  try {
    const helpers = await window.loadCardHelpers();
    const card = helpers.createCardElement({ type: "entities", entities: [] });
    if (card?.constructor?.getConfigElement) await card.constructor.getConfigElement();
  } catch (e) {
    /* ignore — we report unavailability to the user instead */
  }
  return !!customElements.get("hui-card-element-editor");
};

const pretty = (v) => (v == null || v === "" ? "" : String(v));
const CARD_TYPE_NAMES = { markdown: "Markdown", entity: "Entity", entities: "Entities", calendar: "Calendar",
  map: "Map", tile: "Tile", button: "Button", gauge: "Gauge", history_graph: "History graph",
  "custom:sb-entity-browser": "SB Entity Browser", "custom:sb-scheduler-card": "SB Scheduler Card" };
const cardTypeName = (t) => CARD_TYPE_NAMES[t] || (t || "").replace(/^custom:/, "");

// Which $tokens$ a card config actually uses — the overview shows the count
// for THIS parameter and flags any other token, which is almost always a typo.
const tokenUsage = (card) => {
  const counts = {};
  const scan = (node) => {
    if (typeof node === "string") { for (const m of node.matchAll(TOKEN)) counts[m[1]] = (counts[m[1]] || 0) + 1; }
    else if (Array.isArray(node)) node.forEach(scan);
    else if (node && typeof node === "object") Object.values(node).forEach(scan);
  };
  scan(card || {});
  return counts;
};


const EDITOR_STYLE = `
  .spe { color: var(--primary-text-color); }
  .spe .sec { background: var(--secondary-background-color, rgba(127,127,127,.08)); border: 1px solid var(--divider-color); border-radius: 10px; margin-bottom: 12px; }
  .spe .sec h3 { margin: 0; padding: 10px 14px; font-size: .95em; font-weight: 500; display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid var(--divider-color); }
  .spe .sec h3 button { font: inherit; font-size: .8em; color: var(--primary-color); background: none; border: 1px solid var(--primary-color); border-radius: 14px; padding: 3px 12px; cursor: pointer; }
  .spe .rows { padding: 8px 14px 10px; }
  .spe .row { display: flex; justify-content: space-between; gap: 12px; padding: 5px 0; font-size: .9em; }
  .spe .row .k { color: var(--secondary-text-color); white-space: nowrap; }
  .spe .row .v { text-align: right; min-width: 0; overflow-wrap: anywhere; }
  .spe code { background: rgba(127,127,127,.2); padding: 1px 6px; border-radius: 4px; font-size: .9em; }
  .spe .chip { display: inline-block; background: rgba(127,127,127,.2); border-radius: 10px; padding: 1px 8px; margin-left: 4px; font-size: .85em; }
  .spe .off { color: var(--secondary-text-color); font-style: italic; }
  .spe .warn { color: var(--warning-color, orange); }
  .spe .note { color: var(--secondary-text-color); font-size: .8em; padding: 2px 4px 6px; }
  dialog.sped { border: 1px solid var(--divider-color); border-radius: 12px; padding: 0; width: min(600px, 92vw); max-height: 85vh;
    background: var(--card-background-color, var(--ha-card-background, #fff)); color: var(--primary-text-color); box-shadow: 0 12px 40px rgba(0,0,0,.5); }
  dialog.sped::backdrop { background: rgba(0,0,0,.45); }
  dialog.sped .ph { display: flex; justify-content: space-between; align-items: center; padding: 14px 18px; border-bottom: 1px solid var(--divider-color); font-weight: 500; }
  dialog.sped .ph button { font: inherit; background: none; border: none; color: var(--secondary-text-color); font-size: 1.2em; cursor: pointer; }
  dialog.sped .pb { padding: 14px 18px; max-height: calc(85vh - 130px); overflow: auto; }
  dialog.sped .pf { display: flex; justify-content: flex-end; gap: 10px; padding: 10px 18px 16px; border-top: 1px solid var(--divider-color); }
  dialog.sped .pf button { font: inherit; font-size: .9em; padding: 8px 18px; border-radius: 20px; border: none; cursor: pointer; background: none; color: var(--primary-color); }
  dialog.sped .pf button.done { background: var(--primary-color); color: var(--text-primary-color, #fff); }
  dialog.sped .hint { color: var(--secondary-text-color); font-size: .8em; padding: 6px 2px 10px; }
  dialog.sped .sub { color: var(--secondary-text-color); font-size: .75em; letter-spacing: .04em; text-transform: uppercase; margin: 10px 0 6px; }
  dialog.sped .links { display: flex; justify-content: flex-end; gap: 16px; padding-bottom: 6px; }
  dialog.sped .links span, dialog.sped .link { cursor: pointer; color: var(--primary-color); font-size: .85em; }
  dialog.sped .prow { display: flex; align-items: center; gap: 6px; margin-bottom: 8px; }
  dialog.sped .prow input { flex: 1; min-width: 0; box-sizing: border-box; font: inherit; color: var(--primary-text-color);
    background: var(--mdc-text-field-fill-color, rgba(127,127,127,.12)); border: none; border-bottom: 1px solid var(--divider-color);
    border-radius: 4px 4px 0 0; padding: 12px 10px; outline-color: var(--primary-color); }
  dialog.sped .prow .del { cursor: pointer; color: var(--secondary-text-color); padding: 6px; }
  dialog.sped .tabs { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 10px; }
  dialog.sped .tabs span { border: 1px solid var(--divider-color); border-radius: 12px; padding: 3px 10px; cursor: pointer; font-size: .85em; }
  dialog.sped .tabs span.on { background: var(--primary-color); color: var(--text-primary-color, #fff); border-color: transparent; }
`;

class SbParamCardEditor extends HTMLElement {
  setConfig(config) {
    this._config = normalise(config);
    if (this._tab == null || this._tab >= this._config.parameters.length) this._tab = 0;
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    if (this._form) this._form.hass = hass;
    if (this._cardEd) this._cardEd.hass = hass;
    if (this._picker) this._picker.hass = hass;
  }

  set lovelace(lovelace) {
    this._lovelace = lovelace;
    if (this._cardEd) this._cardEd.lovelace = lovelace;
    if (this._picker) this._picker.lovelace = lovelace;
  }

  _emit() {
    fire(this, "config-changed", { config: denormalise(this._config) });
  }

  _set(patch) {
    this._config = { ...this._config, ...patch };
    this._emit();
    this._renderOverview();
  }

  _setParam(i, patch) {
    const parameters = this._config.parameters.map((p, n) => (n === i ? { ...p, ...patch } : p));
    this._set({ parameters });
  }

  _params() { return this._config.parameters; }

  // ---- overview -----------------------------------------------------------
  _peers(key) {
    // Other Param Cards on the page sharing this key — the dashboard is
    // behind HA's editor dialog, so they are there to count.
    let n = 0;
    const inEditor = (el) => { let x = el; while (x) { if (x.tagName === "HUI-DIALOG-EDIT-CARD") return true; x = x.parentElement || (x.getRootNode && x.getRootNode().host); } return false; };
    const walk = (root) => {
      for (const el of root.querySelectorAll("*")) {
        if (el.tagName === "SB-PARAM-CARD" && (el._config?.parameters || []).some((p) => p.key === key) && !inEditor(el)) n++;
        if (el.shadowRoot) walk(el.shadowRoot);
      }
    };
    try { walk(document); } catch (e) { /* ignore */ }
    return Math.max(0, n - 1);   // minus the card being edited
  }

  _summaryParameters() {
    const ps = this._params();
    const rows = ps.map((p) => {
      const peers = this._peers(p.key);
      const role = p.dropdown ? "knob" : "socket";
      return [`<code>$${esc(p.name)}$</code>`, `<code>${esc(p.key)}</code> <span class="chip">${role}</span>${peers ? `<span class="chip">${peers} other card${peers > 1 ? "s" : ""}</span>` : ""}${p.default != null && p.default !== "" ? `<span class="chip">default ${esc(p.default)}</span>` : ""}`];
    });
    const dups = new Set(ps.map((p) => p.name).filter((n, i, a) => a.indexOf(n) !== i));
    if (dups.size) rows.push(["", `<span class="warn">duplicate name: ${[...dups].map((d) => `<code>$${esc(d)}$</code>`).join(" ")}</span>`]);
    rows.push(["This card is", ps.some((p) => p.dropdown) && this._config.card ? "knob and socket" : ps.some((p) => p.dropdown) ? "knob (dropdown only)" : this._config.card ? "socket" : `<span class="warn">nothing yet — turn on a dropdown, wrap a card, or both</span>`]);
    return rows;
  }

  _summaryDropdowns() {
    const knobs = this._params().filter((p) => p.dropdown);
    if (!knobs.length) return [["Dropdowns", `<span class="off">none — choices come from the knobs sharing the keys</span>`]];
    return knobs.map((p) => {
      const items = resolveChoices(this._hass, p);
      const src = p.choices_source === "entity"
        ? `${items.length} from <code>${esc(p.source_entity || "?")}</code> · ${esc(p.source_attribute || "?")}`
        : items.length ? `${items.length}: ${esc(items.slice(0, 4).map((i) => i.label).join(", "))}${items.length > 4 ? "…" : ""}`
        : `<span class="warn">no choices yet</span>`;
      return [`<code>$${esc(p.name)}$</code>${p.title ? ` “${esc(p.title)}”` : ""}`, src];
    });
  }

  _summaryCard() {
    const c = this._config;
    if (!c.card) return [["Card", this._params().some((p) => p.dropdown) ? `<span class="off">none — dropdown only</span>` : `<span class="warn">none</span>`]];
    const use = tokenUsage(c.card);
    const names = this._params().map((p) => p.name);
    const mine = names.map((n) => (use[n] ? `<code>$${esc(n)}$</code> ×${use[n]}` : `<span class="warn">$${esc(n)}$ unused</span>`)).join(" ");
    const others = Object.keys(use).filter((k) => !names.includes(k));
    return [
      ["Type", esc(cardTypeName(c.card.type))],
      ["Uses", mine + (others.length ? ` <span class="warn">unknown: ${others.map((o) => `<code>$${esc(o)}$</code>`).join(" ")}</span>` : "")],
      ...(this._params().every((p) => p.dropdown) ? [] : [["Value header", c.show_value ? "on" : `<span class="off">off</span>`]]),
    ];
  }

  _renderOverview() {
    if (!this._ov) return;
    const n = this._params().length;
    const sec = (id, title, rows) => `<div class="sec"><h3>${title}<button data-sec="${id}">Edit</button></h3>
      <div class="rows">${rows.map(([k, v]) => `<div class="row"><span class="k">${k}</span><span class="v">${v}</span></div>`).join("")}</div></div>`;
    this._ov.innerHTML =
      sec("parameters", `Parameter${n === 1 ? "" : "s"}${n > 1 ? ` <span class="chip">${n} of ${MAX_PARAMS}</span>` : ""}`, this._summaryParameters()) +
      sec("dropdowns", "Dropdowns", this._summaryDropdowns()) +
      sec("card", "Wrapped card", this._summaryCard()) +
      `<div class="note">Cards sharing a key share that value. The one with the dropdown is its knob; the others are sockets and accept only the knob's choices.</div>`;
    this._ov.querySelectorAll("button[data-sec]").forEach((b) => b.addEventListener("click", () => this._openDialog(b.dataset.sec)));
  }

  _render() {
    if (!this._ov) {
      this.classList.add("spe");
      const st = document.createElement("style");
      st.textContent = EDITOR_STYLE;
      this.appendChild(st);
      this._ov = document.createElement("div");
      this.appendChild(this._ov);
    }
    this._renderOverview();
  }

  // ---- dialogs -------------------------------------------------------------
  _openDialog(id) {
    this._closeDialog(false);
    this._open = id;
    this._snap = JSON.parse(JSON.stringify(this._config));
    const d = document.createElement("dialog");
    d.className = "sped";
    d.innerHTML = `<div class="ph"><span>${{ parameters: "Parameters", dropdowns: "Dropdowns", card: "Wrapped card" }[id]}</span><button class="x" title="Close">✕</button></div>
      <div class="pb"></div>
      <div class="pf"><button class="cancel">Cancel</button><button class="done">Done</button></div>`;
    this.appendChild(d);
    this._dlg = d;
    d.querySelector(".x").addEventListener("click", () => this._closeDialog(false));
    d.querySelector(".done").addEventListener("click", () => this._closeDialog(false));
    d.querySelector(".cancel").addEventListener("click", () => this._closeDialog(true));
    d.addEventListener("cancel", (e) => { e.preventDefault(); this._closeDialog(false); });   // Escape keeps (edits are live)
    d.addEventListener("close", () => { if (this._dlg === d) this._closeDialog(false); });
    this._renderDialogBody();
    d.showModal();
  }

  _closeDialog(restore) {
    const d = this._dlg;
    if (!d) return;
    this._dlg = null; this._open = null; this._form = null; this._cardEd = null; this._picker = null;
    if (restore && this._snap) { this._config = this._snap; this._emit(); }
    this._snap = null;
    try { d.close(); } catch (e) { /* already closed */ }
    d.remove();
    this._renderOverview();
  }

  _mkForm(schema, data, labels, helpers, onChange) {
    const f = document.createElement("ha-form");
    f.hass = this._hass;
    f.computeLabel = (s) => labels[s.name] || s.name;
    f.computeHelper = (s) => helpers[s.name];
    f.schema = schema;
    f.data = data;
    f.addEventListener("value-changed", (e) => { e.stopPropagation(); onChange(e.detail.value); });
    return f;
  }

  _renderDialogBody() {
    const d = this._dlg;
    if (!d) return;
    const body = d.querySelector(".pb");
    body.innerHTML = "";
    if (this._open === "parameters") this._bodyParameters(body);
    else if (this._open === "dropdowns") this._bodyDropdowns(body);
    else this._bodyCard(body);
  }

  _input(value, placeholder, onInput) {
    const el = document.createElement("input");
    el.type = "text";
    el.value = value || "";
    el.placeholder = placeholder;
    el.autocomplete = "off";
    el.addEventListener("input", onInput);
    return el;
  }

  // One row per parameter: name, key, default. Rows rebuild only on
  // add/remove so typing never loses focus.
  _bodyParameters(body) {
    const ps = this._params();
    const hint = document.createElement("div"); hint.className = "hint";
    hint.innerHTML = `Each parameter is one <b>$name$</b> in the wrapped card and one <b>key</b> in the URL. Cards sharing a key share that value — copy the key into the other cards. Up to ${MAX_PARAMS}.`;
    body.appendChild(hint);
    const head = document.createElement("div"); head.className = "prow";
    head.innerHTML = `<span class="sub" style="flex:1">Name</span><span class="sub" style="flex:1">Key</span><span class="sub" style="flex:1">Default</span><span style="width:34px"></span>`;
    body.appendChild(head);
    ps.forEach((p, i) => {
      const row = document.createElement("div"); row.className = "prow";
      const name = this._input(p.name, "name", () => this._setParam(i, { name: name.value.trim() }));
      const key = this._input(p.key, "key", () => this._setParam(i, { key: key.value.trim() }));
      const def = this._input(p.default, "empty", () => this._setParam(i, { default: def.value }));
      const del = document.createElement("ha-icon"); del.icon = "mdi:delete-outline"; del.className = "del"; del.title = ps.length > 1 ? "Remove" : "A card needs at least one parameter";
      if (ps.length > 1) del.addEventListener("click", () => { this._set({ parameters: ps.filter((_, n) => n !== i) }); this._tab = 0; this._renderDialogBody(); });
      else del.style.opacity = ".3";
      row.append(name, key, def, del);
      body.appendChild(row);
    });
    const add = document.createElement("div");
    add.style.cssText = "display:inline-flex; align-items:center; gap:4px; padding:2px 4px 10px;";
    if (ps.length < MAX_PARAMS) {
      add.className = "link";
      add.innerHTML = `<ha-icon icon="mdi:plus"></ha-icon>Add parameter`;
      add.addEventListener("click", () => {
        const n = ps.length + 1;
        this._set({ parameters: [...ps, { name: `p${n}`, key: newKey(), dropdown: false }] });
        this._renderDialogBody();
        body.querySelectorAll(".prow input")[(ps.length) * 3]?.focus();
      });
    } else {
      add.className = "hint";
      add.textContent = `That is the limit — ${MAX_PARAMS} parameters.`;
    }
    body.appendChild(add);
  }

  _tabsHtml() {
    return `<div class="tabs">${this._params().map((p, i) => `<span class="${i === this._tab ? "on" : ""}" data-i="${i}">$${esc(p.name)}$${p.dropdown ? " ▾" : ""}</span>`).join("")}</div>`;
  }

  _wireTabs(body) {
    body.querySelectorAll(".tabs span").forEach((t) => t.addEventListener("click", () => { this._tab = Number(t.dataset.i); this._renderDialogBody(); }));
  }

  _bodyDropdowns(body) {
    const ps = this._params();
    if (ps.length > 1) { body.insertAdjacentHTML("beforeend", this._tabsHtml()); this._wireTabs(body); }
    const i = Math.min(this._tab, ps.length - 1); this._tab = i;
    const p = ps[i];
    const schema = [
      { name: "dropdown", selector: { boolean: {} } },
      ...(p.dropdown ? [
        { name: "title", selector: { text: {} } },
        { name: "placeholder", selector: { text: {} } },
        { name: "choices_source", selector: { select: { mode: "dropdown", options: [
            { value: "static", label: "Typed in below" }, { value: "entity", label: "From an entity attribute" } ] } } },
        ...(p.choices_source === "entity" ? this._dynamicSchema(p) : []),
        { name: "all_label", selector: { text: {} } },
      ] : []),
    ];
    this._form = this._mkForm(schema, { choices_source: "static", dropdown: false, ...p },
      { dropdown: `Show a dropdown for $${p.name}$ (this card is its knob)`, title: "Label", placeholder: "Placeholder (before a choice)",
        choices_source: "Choices", source_entity: "Entity", source_attribute: "Attribute",
        source_label_field: "Label field", source_value_field: "Value field", all_label: "Extra “show all” choice" },
      { dropdown: "Off: for this parameter the card is a silent socket and takes its choices from the knob sharing the key.",
        choices_source: "Typed in, or read live from an entity attribute (a dictionary contributes its keys, a list its entries).",
        all_label: "Optional first choice that clears the value, e.g. “All lines”." },
      (v) => {
        const cur = this._params()[i];
        const structural = v.dropdown !== !!cur.dropdown || v.choices_source !== (cur.choices_source || "static") ||
          v.source_entity !== cur.source_entity || v.source_attribute !== cur.source_attribute;
        const { name, key, default: d, choices, ...rest } = v;      // the form never owns those
        this._setParam(i, rest);
        if (structural) { this._rows = null; this._renderDialogBody(); }
      },
    );
    body.appendChild(this._form);
    if (p.dropdown && (p.choices_source || "static") === "static") {
      const sub = document.createElement("div"); sub.className = "sub"; sub.textContent = "Choices"; body.appendChild(sub);
      this._wrap = document.createElement("div"); body.appendChild(this._wrap);
      this._rows = null;
      this._renderChoices(i);
    } else if (p.dropdown) {
      const items = resolveChoices(this._hass, p);
      const h = document.createElement("div"); h.className = "hint";
      h.textContent = items.length ? `${items.length} choice${items.length === 1 ? "" : "s"} now: ${items.slice(0, 12).map((x) => x.label).join(", ")}${items.length > 12 ? "…" : ""}`
        : "No choices yet — pick an entity and an attribute that holds a list or a dictionary.";
      body.appendChild(h);
    }
  }

  // Choice rows for parameter i; rebuild only on add/delete so typing never loses focus.
  _renderChoices(i) {
    const p = this._params()[i];
    const items = p.choices || [];
    if (this._rows && this._rows.length === items.length) return;
    this._wrap.innerHTML = "";
    this._rows = [];
    const setChoices = (choices) => this._setParam(i, { choices });
    items.forEach((item, k) => {
      const row = document.createElement("div"); row.className = "prow";
      const label = this._input(item.label, "Display text", () => setChoices(items.map((c, n) => (n === k ? { ...c, label: label.value } : c))));
      const val = this._input(item.value, `Value ($${p.name}$)`, () => setChoices(items.map((c, n) => (n === k ? { ...c, value: val.value } : c))));
      const del = document.createElement("ha-icon"); del.icon = "mdi:delete-outline"; del.className = "del"; del.title = "Remove";
      del.addEventListener("click", () => { setChoices(items.filter((_, n) => n !== k)); this._rows = null; this._renderChoices(i); });
      row.append(label, val, del);
      this._wrap.appendChild(row);
      this._rows.push(row);
    });
    const add = document.createElement("div"); add.className = "link";
    add.style.cssText = "display:inline-flex; align-items:center; gap:4px; padding:2px 4px 10px;";
    add.innerHTML = `<ha-icon icon="mdi:plus"></ha-icon>Add choice`;
    add.addEventListener("click", () => {
      setChoices([...items, { label: "", value: "" }]);
      this._rows = null; this._renderChoices(i);
      this._wrap.querySelector("div:nth-last-child(2) input")?.focus();
    });
    this._wrap.appendChild(add);
  }

  _bodyCard(body) {
    const c = this._config;
    const anyKnob = this._params().some((p) => p.dropdown);
    const links = document.createElement("div"); links.className = "links";
    const link = (text, fn) => { const a = document.createElement("span"); a.textContent = text; a.addEventListener("click", fn); return a; };
    if (c.card) {
      links.append(
        link("Change card type", () => { this._set({ card: undefined }); this._cardEd = null; this._noCard = false; this._renderDialogBody(); }),
        link("No card (dropdown only)", () => { const { card, ...rest } = this._config; this._config = rest; this._emit(); this._cardEd = null; this._noCard = true; this._renderDialogBody(); }),
      );
    } else if (this._noCard || (anyKnob && this._noCard !== false)) {
      links.append(link("Wrap a card", () => { this._noCard = false; this._renderDialogBody(); }));
    }
    body.appendChild(links);
    if (c.card && !this._params().every((p) => p.dropdown)) {
      this._form = this._mkForm([{ name: "show_value", selector: { boolean: {} } }], { show_value: false, ...c },
        { show_value: "Show the current value(s) with a clear (✕) button" },
        { show_value: "A small header above the wrapped card. Leave off when several sockets share one knob." },
        (v) => this._set({ show_value: !!v.show_value }));
      body.appendChild(this._form);
    }
    this._cardBox = document.createElement("div");
    body.appendChild(this._cardBox);
    if (c.card || !(this._noCard || (anyKnob && this._noCard !== false))) this._renderCardEditor();
    else { const h = document.createElement("div"); h.className = "hint"; h.textContent = "This card is a dropdown only."; this._cardBox.appendChild(h); }
  }

  async _renderCardEditor() {
    const box = this._cardBox;
    const ok = await loadHuiEditors();
    // The dialog body may have been rebuilt while we awaited: render into
    // the box that is on screen now, and never reuse an editor that is not.
    if (!this._cardBox || !this._cardBox.isConnected || this._cardBox !== box) return;
    if (this._cardEd && !this._cardBox.contains(this._cardEd)) this._cardEd = null;
    if (this._picker && !this._cardBox.contains(this._picker)) this._picker = null;
    if (!ok) {
      this._cardBox.innerHTML =
        `<div style="color:var(--warning-color, orange); font-size:.85em;">Home Assistant's card editor could not be loaded here — reload the page and reopen this editor.</div>`;
      return;
    }
    if (this._config.card) {
      if (!this._cardEd) {
        this._cardBox.innerHTML = "";
        this._cardEd = document.createElement("hui-card-element-editor");
        this._cardEd.hass = this._hass;
        this._cardEd.lovelace = this._lovelace;
        this._cardEd.addEventListener("config-changed", (e) => {
          e.stopPropagation();
          this._config = { ...this._config, card: e.detail.config };
          this._emit();
          this._renderOverview();
        });
        this._cardBox.append(this._cardEd);
      }
      this._cardEd.hass = this._hass;
      this._cardEd.lovelace = this._lovelace;
      this._cardEd.value = this._config.card;
    } else if (!this._picker) {
      this._cardBox.innerHTML = "";
      this._cardEd = null;
      this._picker = document.createElement("hui-card-picker");
      this._picker.hass = this._hass;
      this._picker.lovelace = this._lovelace;
      this._picker.addEventListener("config-changed", (e) => {
        e.stopPropagation();
        this._config = { ...this._config, card: e.detail.config };
        this._picker = null; this._noCard = false;
        this._emit();
        this._renderDialogBody();
        this._renderOverview();
      });
      this._cardBox.appendChild(this._picker);
    }
  }

  _dynamicSchema(p) {
    const st = this._hass?.states?.[p.source_entity];
    const attrs = Object.keys(st?.attributes || {}).filter(
      (k) => !["friendly_name", "icon", "device_class", "unit_of_measurement", "state_class"].includes(k)
    );
    const raw = st?.attributes?.[p.source_attribute];
    const objFields = Array.isArray(raw) && raw[0] && typeof raw[0] === "object" ? Object.keys(raw[0]) : [];
    const fieldSel = (name) => ({
      name, selector: { select: { mode: "dropdown", options: objFields.map((f) => ({ value: f, label: f })) } },
    });
    return [
      { name: "source_entity", selector: { entity: {} } },
      { name: "source_attribute", selector: { select: { mode: "dropdown",
          options: attrs.length ? attrs.map((a) => ({ value: a, label: a }))
            : [{ value: p.source_attribute || "", label: "(pick an entity first)" }] } } },
      ...(objFields.length ? [fieldSel("source_label_field"), fieldSel("source_value_field")] : []),
    ];
  }
}

customElements.define(CARD, SbParamCard);
customElements.define("sb-param-card-editor", SbParamCardEditor);
window.customCards = window.customCards || [];
window.customCards.push({
  type: CARD,
  name: "SB Param Card",
  description:
    "Runtime parameters shared through the URL: dropdowns (the knob), a wrapped card with $name$ substituted (a socket), or both — one card plus a dropdown instead of one card per value.",
  preview: false,
  documentationURL: "https://github.com/snadboy/sb-param-card",
});
console.info(`%c SB-PARAM-CARD %c v${VERSION} `, "background:#455a64;color:#fff", "background:#90a4ae;color:#000");
