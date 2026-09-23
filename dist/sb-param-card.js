/* SB Param Card — one card, two switches.
 *
 * A runtime PARAMETER shared through the page URL (?seb-<storage_id>=value):
 *
 *   show_selector: true   the card is the KNOB — it carries the choices, draws
 *                         the dropdown, writes the URL and publishes its
 *                         choices for the other cards sharing its key
 *   card: {...}           the card is a SOCKET — it substitutes $parameter$
 *                         into the wrapped card before that card is built
 *
 * Either, or both: a bare dropdown; a dropdown with the card it drives right
 * underneath; or a silent socket taking its choices from the knob elsewhere
 * on the view. One knob can drive any number of sockets. No helper entities.
 *
 * A socket accepts from the URL only the values the knob offers (plus its
 * default), so a link someone sends you can never splice arbitrary text into
 * a template Home Assistant will execute.
 */

const CARD = "sb-param-card";
const VERSION = "0.4.0";
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

const STYLE = `
  .sbp-knob { padding: 12px 16px; display: flex; align-items: center; gap: 12px; margin-bottom: var(--sbp-gap, 8px); }
  .sbp-knob .title { font-weight: 500; color: var(--primary-text-color); white-space: nowrap; }
  .sbp-knob select { flex: 1; min-width: 0; font: inherit; color: var(--primary-text-color);
    background: var(--mdc-text-field-fill-color, rgba(127,127,127,.12)); border: none;
    border-bottom: 1px solid var(--divider-color); border-radius: 4px 4px 0 0; padding: 10px 12px;
    cursor: pointer; outline-color: var(--primary-color); color-scheme: light dark; }
  /* The native popup ignores the page theme: without explicit option colors,
     dark themes get light-gray text on a white popup. */
  .sbp-knob option { background: var(--card-background-color, Canvas); color: var(--primary-text-color, CanvasText); }
  .sbp-knob .warn { color: var(--warning-color, orange); font-size: .85em; }
  .sbp-bar { display: flex; align-items: center; gap: 8px; padding: 4px 12px 6px; font-size: .85em; color: var(--secondary-text-color); }
  .sbp-bar b { color: var(--primary-text-color); }
  .sbp-bar .sbp-clear { cursor: pointer; color: var(--primary-color); }
`;

class SbParamCard extends HTMLElement {
  static getConfigElement() {
    return document.createElement("sb-param-card-editor");
  }

  static getStubConfig() {
    return {
      parameter: "value",
      storage_id: "seb-" + Math.random().toString(36).slice(2, 8),
      show_selector: true,
      title: "Choose",
      choices: [{ label: "One", value: "one" }, { label: "Two", value: "two" }],
      default: "one",
      card: { type: "markdown", content: "Parameter is **$value$**" },
    };
  }

  setConfig(config) {
    if (!config) throw new Error("Invalid configuration");
    this._config = { parameter: "value", ...config };
    this._child?.remove();
    this._child = null;
    this._childType = null;
    this._lastValue = undefined;
    this._sel?.remove(); this._sel = null;
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
    if (this._isKnob() && this._config.choices_source === "entity") this._publish();
    if (this._child) this._child.hass = hass;
    else this._update();
  }

  getCardSize() {
    return (this._isKnob() ? 1 : 0) + (this._child?.getCardSize?.() ?? (this._config?.card ? 3 : 0));
  }

  connectedCallback() {
    this._onNav = () => this._update();
    this._onKnob = (e) => { if (e.detail?.key === this._key()) this._update(); };
    window.addEventListener("location-changed", this._onNav);
    window.addEventListener("popstate", this._onNav);
    window.addEventListener("sb-knob-changed", this._onKnob);
    // HA builds cards detached and re-attaches them during layout.
    if (this._config && this._hass) this._publish();
    this._update();
  }

  disconnectedCallback() {
    window.removeEventListener("location-changed", this._onNav);
    window.removeEventListener("popstate", this._onNav);
    window.removeEventListener("sb-knob-changed", this._onKnob);
    const key = this._key();
    if (KNOBS.get(key)?.el === this) {
      KNOBS.delete(key);
      announce(key);
    }
  }

  _key() {
    return `seb-${this._config?.storage_id || ""}`;
  }

  _isKnob() {
    return !!this._config?.show_selector;
  }

  /** The knob publishes its choices for the sockets sharing its key. */
  _publish() {
    if (!this._isKnob() || !this._config) return;
    const items = resolveChoices(this._hass, this._config);
    const sig = choicesSignature(items);
    const key = this._key();
    const prev = KNOBS.get(key);
    if (prev && prev.el === this && prev.sig === sig) return;
    KNOBS.set(key, { el: this, items, sig });
    announce(key);
    if (this._sel) this._renderSelector(this._value(), true);
  }

  _items() {
    if (this._isKnob()) return resolveChoices(this._hass, this._config);
    return KNOBS.get(this._key())?.items || [];
  }

  // The allowlist: the choices (own, or the knob's), then the default.
  _choices() {
    const out = [];
    const push = (v) => { const s = String(v ?? ""); if (!out.includes(s)) out.push(s); };
    for (const i of this._items()) push(i.value);
    if (this._config.default != null) push(this._config.default);
    return out;
  }

  _labelFor(value) {
    return this._items().find((i) => String(i.value ?? "") === value)?.label || value;
  }

  _live() {
    try { return new URLSearchParams(location.search).get(this._key()); } catch (e) { return null; }
  }

  _value() {
    const url = this._live();
    const choices = this._choices();
    if (url != null && choices.includes(url)) return url;
    if (this._config.default != null && choices.includes(String(this._config.default)))
      return String(this._config.default);
    // Nothing chosen and no default: the parameter is EMPTY — the same on the
    // knob and on every socket, rather than silently the first choice.
    return "";
  }

  /** Write a choice to the URL — the wire every socket on the page listens to. */
  _pick(value) {
    const params = new URLSearchParams(location.search);
    value ? params.set(this._key(), value) : params.delete(this._key());
    const q = params.toString();
    history.pushState(null, "", location.pathname + (q ? "?" + q : "") + location.hash);
    fire(this, "location-changed", {});
  }

  _renderSelector(value, force = false) {
    const items = this._items();
    const sig = choicesSignature(items) + "\u0001" + value;
    if (this._sel && this._selSig === sig && !force) return;
    this._selSig = sig;
    if (!this._sel) {
      this._sel = document.createElement("ha-card");
      this._sel.className = "sbp-knob";
      const style = this.querySelector(":scope > style");
      style ? style.after(this._sel) : this.prepend(this._sel);
    }
    const cur = items.findIndex((i) => i.value === value);
    const live = this._live();
    // Placeholder shows until a choice is made; a default counts as a choice
    // only when it is one of the items (then the dropdown shows it).
    const sel = live == null && this._config.default == null ? -1 : cur;
    this._sel.innerHTML = `
      ${this._config.title ? `<div class="title">${esc(this._config.title)}</div>` : ""}
      ${items.length ? `<select>
        <option value="-1" ${sel === -1 ? "selected" : ""} disabled hidden>${esc(this._config.placeholder || "Select…")}</option>
        ${items.map((i, n) => `<option value="${n}" ${n === sel ? "selected" : ""}>${esc(i.label || i.value)}</option>`).join("")}
      </select>` : `<div class="warn">No choices yet — add some in the editor</div>`}`;
    this._sel.querySelector("select")?.addEventListener("change", (e) => {
      const item = items[Number(e.target.value)];
      if (item) this._pick(item.value);
    });
  }

  // Optional header for a SOCKET: the current value and a ✕ that clears it.
  // Off by default — seven sockets on one view do not want seven headers.
  _renderBar(value) {
    const live = this._live();
    const want = !this._isKnob() && !!this._config.show_value && live != null && live !== "";
    if (!want) { this._bar?.remove(); this._bar = null; return; }
    if (!this._bar) {
      this._bar = document.createElement("div");
      this._bar.className = "sbp-bar";
      (this._sel || this.querySelector(":scope > style") || this).after
        ? (this._sel || this.querySelector(":scope > style")).after(this._bar) : this.prepend(this._bar);
    }
    const shown = live === value ? esc(this._labelFor(value))
      : `<span style="color:var(--warning-color, orange)">“${esc(live)}” is not a choice — showing default</span>`;
    this._bar.innerHTML = `<span>${esc(this._config.parameter)}: <b>${shown}</b></span>` +
      `<span class="sbp-clear" title="Clear">✕</span>`;
    this._bar.querySelector(".sbp-clear").addEventListener("click", () => {
      const params = new URLSearchParams(location.search);
      params.delete(this._key());
      const q = params.toString();
      history.replaceState(null, "", location.pathname + (q ? "?" + q : "") + location.hash);
      fire(this, "location-changed", {});
    });
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
    if (!this._config.show_selector && !this._config.card) {
      this._error("turn on the selector, pick a card to wrap, or both");
      return;
    }
    if (this._isKnob()) this._publish();
    const value = this._value();
    if (this._isKnob()) this._renderSelector(value);
    this._renderBar(value);
    if (!this._config.card) return;

    if (this._child && value === this._lastValue) {
      this._child.hass = this._hass;
      return;
    }
    this._lastValue = value;
    const cfg = substitute(this._config.card, this._config.parameter, value);

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

class SbParamCardEditor extends HTMLElement {
  setConfig(config) {
    this._config = { parameter: "value", ...config };
    if (!this._config.storage_id)
      this._config.storage_id = "seb-" + Math.random().toString(36).slice(2, 8);
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
    fire(this, "config-changed", { config: this._config });
  }

  _input(value, placeholder, flex, onInput) {
    const el = document.createElement("input");
    el.type = "text";
    el.value = value || "";
    el.placeholder = placeholder;
    el.autocomplete = "off";
    el.style.cssText =
      `flex:${flex}; min-width:0; box-sizing:border-box; font:inherit; color:var(--primary-text-color);` +
      "background:var(--mdc-text-field-fill-color, rgba(127,127,127,.12));" +
      "border:none; border-bottom:1px solid var(--divider-color);" +
      "border-radius:4px 4px 0 0; padding:12px 10px; outline-color:var(--primary-color);";
    el.addEventListener("input", onInput);
    return el;
  }

  // Choice rows rebuild only on add/delete so typing never loses focus.
  _renderChoices() {
    if (!this._config.show_selector) { this._wrap.innerHTML = ""; this._rows = null; return; }
    if (this._config.choices_source === "entity") {
      const items = resolveChoices(this._hass, this._config);
      this._wrap.innerHTML = "";
      this._rows = null;
      const box = document.createElement("div");
      box.style.cssText = "padding:10px 12px; border:1px dashed var(--divider-color); border-radius:8px; color:var(--secondary-text-color); font-size:.85em;";
      box.textContent = items.length
        ? `${items.length} choice${items.length === 1 ? "" : "s"}: ` + items.slice(0, 12).map((i) => i.label).join(", ") + (items.length > 12 ? "…" : "")
        : "No choices yet — pick an entity and an attribute that holds a list or a dictionary.";
      this._wrap.appendChild(box);
      return;
    }
    const items = this._config.choices || [];
    if (this._rows && this._rows.length === items.length) return;
    this._wrap.innerHTML = "";
    this._rows = [];
    items.forEach((item, i) => {
      const row = document.createElement("div");
      row.style.cssText = "display:flex; align-items:center; gap:6px; margin-bottom:8px;";
      const label = this._input(item.label, "Display text", "1", () => {
        this._config.choices[i] = { ...this._config.choices[i], label: label.value };
        this._emit();
      });
      const val = this._input(item.value, "Value ($parameter$)", "1.4", () => {
        this._config.choices[i] = { ...this._config.choices[i], value: val.value };
        this._emit();
      });
      const del = document.createElement("ha-icon");
      del.icon = "mdi:delete-outline";
      del.title = "Remove";
      del.style.cssText = "cursor:pointer; color:var(--secondary-text-color); padding:6px;";
      del.addEventListener("click", () => {
        this._config.choices = items.filter((_, n) => n !== i);
        this._rows = null;
        this._renderChoices();
        this._emit();
      });
      row.append(label, val, del);
      this._wrap.appendChild(row);
      this._rows.push(row);
    });
    const add = document.createElement("div");
    add.style.cssText = "display:inline-flex; align-items:center; gap:4px; cursor:pointer; color:var(--primary-color); padding:2px 4px 10px;";
    add.innerHTML = `<ha-icon icon="mdi:plus"></ha-icon>Add choice`;
    add.addEventListener("click", () => {
      this._config.choices = [...(this._config.choices || []), { label: "", value: "" }];
      this._rows = null;
      this._renderChoices();
      this._emit();
      this._wrap.querySelector("div:nth-last-child(2) input")?.focus();
    });
    this._wrap.appendChild(add);
  }

  async _renderCardEditor() {
    const ok = await loadHuiEditors();
    if (!ok) {
      this._cardBox.innerHTML =
        `<div style="color:var(--warning-color, orange); font-size:.85em;">Home Assistant's card editor could not be loaded here — reload the page and reopen this editor.</div>`;
      return;
    }
    if (this._config.card) {
      if (!this._cardEd) {
        this._cardBox.innerHTML = "";
        const bar = document.createElement("div");
        bar.style.cssText = "display:flex; justify-content:flex-end; gap:16px; padding-bottom:6px;";
        const link = (text, fn) => {
          const a = document.createElement("span");
          a.textContent = text;
          a.style.cssText = "cursor:pointer; color:var(--primary-color); font-size:.85em;";
          a.addEventListener("click", fn);
          return a;
        };
        bar.append(
          link("Change card type", () => {
            this._config = { ...this._config, card: undefined };
            this._cardEd = null; this._picker = null;
            this._emit(); this._render();
          }),
          link("No card (dropdown only)", () => {
            const { card, ...rest } = this._config;
            this._config = { ...rest, show_selector: true };
            this._cardEd = null; this._picker = null; this._noCard = true;
            this._emit(); this._render();
          }),
        );
        this._cardEd = document.createElement("hui-card-element-editor");
        this._cardEd.hass = this._hass;
        this._cardEd.lovelace = this._lovelace;
        this._cardEd.addEventListener("config-changed", (e) => {
          e.stopPropagation();
          this._config = { ...this._config, card: e.detail.config };
          this._emit();
        });
        this._cardBox.append(bar, this._cardEd);
      }
      this._cardEd.hass = this._hass;
      this._cardEd.lovelace = this._lovelace;
      this._cardEd.value = this._config.card;
    } else if (this._noCard && this._config.show_selector) {
      this._cardEd = null; this._picker = null;
      this._cardBox.innerHTML = "";
      const add = document.createElement("span");
      add.textContent = "Wrap a card under the dropdown";
      add.style.cssText = "cursor:pointer; color:var(--primary-color); font-size:.85em;";
      add.addEventListener("click", () => { this._noCard = false; this._render(); });
      this._cardBox.appendChild(add);
    } else if (!this._picker) {
      this._cardBox.innerHTML = "";
      this._cardEd = null;
      this._picker = document.createElement("hui-card-picker");
      this._picker.hass = this._hass;
      this._picker.lovelace = this._lovelace;
      this._picker.addEventListener("config-changed", (e) => {
        e.stopPropagation();
        this._config = { ...this._config, card: e.detail.config };
        this._picker = null;
        this._emit();
        this._render();
      });
      this._cardBox.appendChild(this._picker);
    }
  }

  _dynamicSchema() {
    const st = this._hass?.states?.[this._config.source_entity];
    const attrs = Object.keys(st?.attributes || {}).filter(
      (k) => !["friendly_name", "icon", "device_class", "unit_of_measurement", "state_class"].includes(k)
    );
    const raw = st?.attributes?.[this._config.source_attribute];
    const objFields = Array.isArray(raw) && raw[0] && typeof raw[0] === "object" ? Object.keys(raw[0]) : [];
    const fieldSel = (name) => ({
      name, selector: { select: { mode: "dropdown", options: objFields.map((f) => ({ value: f, label: f })) } },
    });
    return [
      { name: "source_entity", selector: { entity: {} } },
      { name: "source_attribute", selector: { select: { mode: "dropdown",
          options: attrs.length ? attrs.map((a) => ({ value: a, label: a }))
            : [{ value: this._config.source_attribute || "", label: "(pick an entity first)" }] } } },
      ...(objFields.length ? [fieldSel("source_label_field"), fieldSel("source_value_field")] : []),
    ];
  }

  _render() {
    if (!this._form) {
      this._form = document.createElement("ha-form");
      this._form.computeLabel = (s) =>
        ({ parameter: "Parameter name", storage_id: "Key (shared by the knob and its sockets)", show_selector: "Show a dropdown (this card is the knob)",
           title: "Dropdown label", placeholder: "Placeholder (before a choice)",
           choices_source: "Choices", source_entity: "Entity", source_attribute: "Attribute",
           source_label_field: "Label field", source_value_field: "Value field",
           all_label: "Extra “show all” choice", default: "Default value",
           show_value: "Show the current value with a clear (✕) button" }[s.name] || s.name);
      this._form.computeHelper = (s) =>
        ({ parameter: "Write $name$ anywhere in the wrapped card — including inside a template — and it is replaced by the chosen value. Transforms: $name:slug$, $name:lower$, $name:upper$, $name:title$.",
           show_selector: "Off: this card is a silent socket, taking its choices from the dropdown card on this view that shares its key.",
           choices_source: "Typed in below, or read live from an entity attribute (a dictionary contributes its keys, a list its entries).",
           all_label: "Optional first choice that clears the value, e.g. “All lines”.",
           default: "Used until a choice is made, or when a link carries a value that is not a choice.",
           show_value: "A small header above the wrapped card. Leave off when several sockets share one knob." }[s.name]);
      this._form.addEventListener("value-changed", (e) => {
        const v = e.detail.value;
        const structural = v.show_selector !== this._config.show_selector || v.choices_source !== this._config.choices_source ||
          v.source_entity !== this._config.source_entity || v.source_attribute !== this._config.source_attribute;
        this._config = { ...this._config, ...v };
        if (structural) this._rows = null;
        this._emit();
        this._render();
      });
      this.appendChild(this._form);
      this._wrap = document.createElement("div");
      this.appendChild(this._wrap);
      const hint = document.createElement("div");
      hint.innerHTML = "Cards sharing a <b>key</b> (the storage id below) share the value: the one with the dropdown is the <b>knob</b>, the others are <b>sockets</b>. Only the knob's choices are ever accepted from a link.";
      hint.style.cssText = "color:var(--secondary-text-color); font-size:.8em; padding:8px 4px;";
      this.appendChild(hint);
      const cardLbl = document.createElement("div");
      cardLbl.textContent = "Card";
      cardLbl.style.cssText = "padding:8px 0; color:var(--primary-text-color);";
      this.appendChild(cardLbl);
      this._cardBox = document.createElement("div");
      this.appendChild(this._cardBox);
    }
    this._form.hass = this._hass;
    const knob = !!this._config.show_selector;
    const other = KNOBS.get(`seb-${this._config.storage_id || ""}`);
    const choices = knob ? resolveChoices(this._hass, this._config) : (other?.items || []);
    const nonEmpty = choices.filter((i) => i.value !== "");
    this._form.schema = [
      { name: "parameter", selector: { text: {} } },
      { name: "storage_id", selector: { text: {} } },
      { name: "show_selector", selector: { boolean: {} } },
      ...(knob ? [
        { name: "title", selector: { text: {} } },
        { name: "placeholder", selector: { text: {} } },
        { name: "choices_source", selector: { select: { mode: "dropdown", options: [
            { value: "static", label: "Typed in below" }, { value: "entity", label: "From an entity attribute" } ] } } },
        ...(this._config.choices_source === "entity" ? this._dynamicSchema() : []),
        { name: "all_label", selector: { text: {} } },
      ] : []),
      nonEmpty.length
        ? { name: "default", selector: { select: { mode: "dropdown", custom_value: true,
            options: nonEmpty.map((i) => ({ value: i.value, label: i.label || i.value })) } } }
        : { name: "default", selector: { text: {} } },
      ...(knob ? [] : [{ name: "show_value", selector: { boolean: {} } }]),
    ];
    this._form.computeLabel = this._form.computeLabel;   // unchanged
    this._form.data = { choices_source: "static", show_value: false, show_selector: false, ...this._config };
    if (!this._config.card && this._config.show_selector) this._noCard = this._noCard ?? true;
    this._renderChoices();
    this._renderCardEditor();
  }
}

customElements.define(CARD, SbParamCard);
customElements.define("sb-param-card-editor", SbParamCardEditor);
window.customCards = window.customCards || [];
window.customCards.push({
  type: CARD,
  name: "SB Param Card",
  description:
    "A runtime parameter shared through the URL: a dropdown (the knob), a wrapped card with $name$ substituted (a socket), or both — one card plus a dropdown instead of one card per value.",
  preview: false,
  documentationURL: "https://github.com/snadboy/sb-param-card",
});
console.info(`%c SB-PARAM-CARD %c v${VERSION} `, "background:#455a64;color:#fff", "background:#90a4ae;color:#000");
