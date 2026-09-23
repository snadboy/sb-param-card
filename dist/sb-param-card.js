/* SB Param Card — the SOCKET: a runtime parameter for any card.
 *
 * Wraps ANY card config and substitutes a parameter into it before the card
 * is built: "$line$" in a markdown template, an entity id, a map's
 * geo_location_sources, an Entity Browser's filter — anything. The value
 * comes from the URL (?seb-<storage_id>=…), which SB Filter Select — the
 * KNOB — writes. One knob drives every socket sharing its key.
 *
 * This card has no UI of its own. The URL value is ALLOWLISTED against the
 * choices the knob sharing this key publishes (window.__sbKnobs), so a link
 * someone sends you can only select a value the knob offers — never splice
 * arbitrary text into a template Home Assistant will execute. With no knob
 * on the page only `default` is ever used.
 */

const CARD = "sb-param-card";
const VERSION = "0.3.0";
// The knob registry SB Filter Select fills (key -> {items, el}); see there.
const KNOBS = (window.__sbKnobs = window.__sbKnobs || new Map());
// Card types whose element is re-configured in place on a value change
// instead of rebuilt (see _update). Add a type only after checking that its
// setConfig really is idempotent.
const REUSE_IN_PLACE = new Set(["map"]);

const fire = (node, type, detail) =>
  node.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
const esc = (v) =>
  String(v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// $name$ with optional :transform — matches the integration's slug rule for
// :slug so "UP-W" lands as up_w wherever an entity/source id is needed.
const TOKEN = /\$([a-zA-Z_][\w-]*)(?::(slug|lower|upper|title))?\$/g;

const transform = (value, how) => {
  const s = String(value ?? "");
  if (how === "slug") return s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  if (how === "lower") return s.toLowerCase();
  if (how === "upper") return s.toUpperCase();
  if (how === "title") return s.replace(/\w\S*/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase());
  return s;
};

// Deep-substitute through every string in a card config (arrays, nested
// objects, template bodies) without touching its structure.
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


// ---- choices from live state -------------------------------------------
// Keeps the allowlist in step with reality: a dict attribute
// (sensor.metra_schedule -> lines) yields its keys, a list yields its
// entries, a list of objects yields label/value fields. Resolved
// synchronously from hass so the allowlist is never momentarily empty.
const resolveItems = (hass, config) => {
  if (config.items_source !== "entity") return config.items || [];
  const st = hass?.states?.[config.source_entity];
  const raw = st?.attributes?.[config.source_attribute];
  let out = [];
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
  return out;
};

class SbParamCard extends HTMLElement {
  static getConfigElement() {
    return document.createElement("sb-param-card-editor");
  }

  static getStubConfig() {
    return {
      parameter: "value",
      storage_id: "seb-" + Math.random().toString(36).slice(2, 8),
      default: "example",
      card: { type: "markdown", content: "Parameter is **$value$**" },
    };
  }

  setConfig(config) {
    if (!config) throw new Error("Invalid configuration");
    this._config = { parameter: "value", ...config };
    // Announce ourselves to SB Filter Select's target discovery.
    this._sbFilterTarget = {
      id: this._config.storage_id,
      title: this._config.title || this._config.card?.title || `Parameter: ${this._config.parameter}`,
    };
    this._child = null;
    this._childType = null;
    this._lastValue = undefined;
    this.innerHTML = "";
    if (this._hass) this._update();
  }

  set hass(hass) {
    this._hass = hass;
    if (this._child) this._child.hass = hass;
    else this._update();
  }

  getCardSize() {
    return this._child?.getCardSize?.() ?? 3;
  }

  connectedCallback() {
    this._onNav = () => this._update();
    this._onKnob = (e) => { if (e.detail?.key === `seb-${this._config?.storage_id || ""}`) this._update(); };
    window.addEventListener("location-changed", this._onNav);
    window.addEventListener("popstate", this._onNav);
    window.addEventListener("sb-knob-changed", this._onKnob);
    this._update();
  }

  disconnectedCallback() {
    window.removeEventListener("location-changed", this._onNav);
    window.removeEventListener("popstate", this._onNav);
    window.removeEventListener("sb-knob-changed", this._onKnob);
  }

  _knob() {
    return KNOBS.get(`seb-${this._config?.storage_id || ""}`);
  }

  // The allowlist: the knob's choices first, then any choices still typed
  // into this card (legacy, pre-0.3.0), then the default. Ordered, unique.
  _choices() {
    const knob = this._knob();
    const out = [];
    const push = (v) => { const s = String(v ?? ""); if (!out.includes(s)) out.push(s); };
    for (const i of knob?.items || []) push(i.value);
    for (const i of resolveItems(this._hass, this._config)) push(i?.value);
    if (this._config.default != null) push(this._config.default);
    return out;
  }

  _labelFor(value) {
    const all = [...(this._knob()?.items || []), ...resolveItems(this._hass, this._config)];
    return all.find((i) => String(i.value ?? "") === value)?.label || value;
  }

  // Optional header: the current value and a ✕ that clears it from the URL.
  // Off by default — seven sockets on one view do not want seven headers.
  _renderBar(value) {
    const key = `seb-${this._config.storage_id || ""}`;
    let live = null;
    try { live = new URLSearchParams(location.search).get(key); } catch (e) { live = null; }
    const want = !!this._config.show_value && live != null && live !== "";
    let bar = this.querySelector(":scope > .sbp-bar");
    if (!want) { bar?.remove(); return; }
    if (!bar) {
      bar = document.createElement("div");
      bar.className = "sbp-bar";
      bar.style.cssText = "display:flex; align-items:center; gap:8px; padding:4px 12px 6px; font-size:.85em; color:var(--secondary-text-color);";
      this.prepend(bar);
    }
    // A value the knob does not offer was rejected (default applies); say so
    // rather than showing an empty label, and still offer the ✕.
    const shown = live === value ? esc(this._labelFor(value))
      : `<span style="color:var(--warning-color, orange)">“${esc(live)}” is not a choice — showing default</span>`;
    bar.innerHTML = `<span>${esc(this._config.parameter)}: <b style="color:var(--primary-text-color)">${shown}</b></span>` +
      `<span class="sbp-clear" title="Clear" style="cursor:pointer; color:var(--primary-color);">✕</span>`;
    bar.querySelector(".sbp-clear").addEventListener("click", () => {
      const params = new URLSearchParams(location.search);
      params.delete(key);
      const q = params.toString();
      history.replaceState(null, "", location.pathname + (q ? "?" + q : "") + location.hash);
      fire(this, "location-changed", {});
    });
  }

  // ALLOWLIST: a URL value is honoured only when it is one of the configured
  // choices. Anything else falls back to the default.
  _value() {
    let url = null;
    try {
      url = new URLSearchParams(location.search).get(`seb-${this._config.storage_id || ""}`);
    } catch (e) {
      url = null;
    }
    const choices = this._choices();
    if (url != null && choices.includes(url)) return url;
    if (this._config.default != null && choices.includes(String(this._config.default)))
      return String(this._config.default);
    return choices[0] ?? "";
  }

  async _update() {
    if (!this._hass || !this._config) return;
    if (!this._config.card) {
      this.innerHTML =
        `<ha-card style="padding:16px; color:var(--warning-color, orange);">SB Param Card: pick a card in the editor</ha-card>`;
      return;
    }
    const value = this._value();
    this._renderBar(value);
    if (this._child && value === this._lastValue) {
      this._child.hass = this._hass;
      return;
    }
    this._lastValue = value;
    const cfg = substitute(this._config.card, this._config.parameter, value);

    // Same card type? Only a few cards are re-configured IN PLACE, to keep
    // their view state (a map's zoom). Everything else is rebuilt: HA's own
    // hui-card never calls setConfig twice on an element, so a second
    // setConfig is an untested path in every card — the calendar card, for
    // one, sits on its spinner for a long and variable time after it.
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
      this.querySelectorAll(":scope > ha-card").forEach((n) => n.remove());   // an earlier error card
      this.appendChild(el);
      this._child = el;
      this._childType = cfg.type;
    } catch (e) {
      this.innerHTML = `<ha-card style="padding:16px; color:var(--error-color);">SB Param Card: ${String(e.message || e)}</ha-card>`;
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
        bar.style.cssText = "display:flex; justify-content:flex-end; padding-bottom:6px;";
        const change = document.createElement("span");
        change.textContent = "Change card type";
        change.style.cssText = "cursor:pointer; color:var(--primary-color); font-size:.85em;";
        change.addEventListener("click", () => {
          this._config = { ...this._config, card: undefined };
          this._cardEd = null;
          this._picker = null;
          this._emit();
          this._render();
        });
        bar.appendChild(change);
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

  _render() {
    if (!this._form) {
      this._form = document.createElement("ha-form");
      this._form.computeLabel = (s) =>
        ({ parameter: "Parameter name", default: "Default value", show_value: "Show the current value with a clear (✕) button" }[s.name] || s.name);
      this._form.computeHelper = (s) =>
        ({
          parameter: "Write $name$ anywhere in the card below — including inside a template — and it is replaced by the chosen value. Transforms: $name:slug$, $name:lower$, $name:upper$, $name:title$.",
          default: "Used until a choice is made, when a link carries a value the knob does not offer, or when there is no knob on the view.",
          show_value: "A small header above the wrapped card. Leave off when several sockets share one knob.",
        }[s.name]);
      this._form.addEventListener("value-changed", (e) => {
        this._config = { ...this._config, ...e.detail.value };
        this._emit();
        this._render();
      });
      this.appendChild(this._form);

      this._wrap = document.createElement("div");
      this.appendChild(this._wrap);
      const hint = document.createElement("div");
      hint.innerHTML =
        "This card is a <b>socket</b>: it shows nothing of its own. Add an <b>SB Filter Select</b> (the knob) on this view and point it here — its choices are the only values ever accepted from a link. Without a knob, only the default is used.";
      hint.style.cssText = "color:var(--secondary-text-color); font-size:.8em; padding:8px 4px 8px;";
      this.appendChild(hint);

      const cardLbl = document.createElement("div");
      cardLbl.textContent = "Card";
      cardLbl.style.cssText = "padding:8px 0; color:var(--primary-text-color);";
      this.appendChild(cardLbl);
      this._cardBox = document.createElement("div");
      this.appendChild(this._cardBox);
    }
    this._form.hass = this._hass;
    // Default: a dropdown of the knob's choices when a knob for this key is
    // on the page, otherwise free text (the knob may not be placed yet).
    const knob = KNOBS.get(`seb-${this._config.storage_id || ""}`);
    const knobChoices = (knob?.items || []).filter((i) => i.value !== "");
    const hasLegacy = (this._config.items || []).length || this._config.items_source === "entity";
    this._form.schema = [
      { name: "parameter", selector: { text: {} } },
      knobChoices.length
        ? { name: "default", selector: { select: { mode: "dropdown", custom_value: true,
            options: knobChoices.map((i) => ({ value: String(i.value), label: i.label || String(i.value) })) } } }
        : { name: "default", selector: { text: {} } },
      { name: "show_value", selector: { boolean: {} } },
    ];
    this._form.data = { show_value: false, ...this._config };
    // Legacy (pre-0.3.0) choices typed into this card: still honoured, but the
    // knob supplies them now — offer to drop the copy.
    this._wrap.innerHTML = "";
    if (hasLegacy) {
      const box = document.createElement("div");
      box.style.cssText = "padding:10px 12px; border:1px dashed var(--divider-color); border-radius:8px; color:var(--secondary-text-color); font-size:.85em;";
      box.innerHTML = `This card still carries its own choice list (from before 0.3.0). The Filter Select sharing this key supplies the choices now, so the copy is redundant. <span class="drop" style="cursor:pointer; color:var(--primary-color);">Remove the copy</span>`;
      box.querySelector(".drop").addEventListener("click", () => {
        const { items, items_source, source_entity, source_attribute, source_label_field, source_value_field, source_sort, ...rest } = this._config;
        this._config = rest;
        this._emit();
        this._render();
      });
      this._wrap.appendChild(box);
    }
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
    "The socket: wraps any card and substitutes a runtime parameter ($name$) chosen by an SB Filter Select on the same view — one card plus a dropdown instead of one card per value.",
  preview: false,
  documentationURL: "https://github.com/snadboy/sb-param-card",
});
console.info(`%c SB-PARAM-CARD %c v${VERSION} `, "background:#455a64;color:#fff", "background:#90a4ae;color:#000");
