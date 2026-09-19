/* SB Param Card — a runtime parameter for any card.
 *
 * Wraps ANY card config and substitutes a card-local parameter into it
 * before the card is built: "$line$" in a markdown template, an entity id,
 * a map's geo_location_sources — anything. The value comes from the URL
 * (?seb-<storage_id>=…, what SB Filter Select writes), so one card plus one
 * dropdown replaces N near-identical cards. No helper entities.
 *
 * The URL value is ALLOWLISTED against the configured choices: a link
 * someone sends you can only select a value you configured, never splice
 * arbitrary text into a template Home Assistant will execute.
 */

const CARD = "sb-param-card";
const VERSION = "0.2.0";

const fire = (node, type, detail) =>
  node.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));

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
      items: [{ label: "Example", value: "example" }],
      card: { type: "markdown", content: "Parameter is **$value$**" },
    };
  }

  setConfig(config) {
    if (!config) throw new Error("Invalid configuration");
    this._config = { parameter: "value", items: [], ...config };
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
    window.addEventListener("location-changed", this._onNav);
    window.addEventListener("popstate", this._onNav);
    this._update();
  }

  disconnectedCallback() {
    window.removeEventListener("location-changed", this._onNav);
    window.removeEventListener("popstate", this._onNav);
  }

  _choices() {
    return resolveItems(this._hass, this._config).map((i) => String(i?.value ?? ""));
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
    if (this._child && value === this._lastValue) {
      this._child.hass = this._hass;
      return;
    }
    this._lastValue = value;
    const cfg = substitute(this._config.card, this._config.parameter, value);

    // Same card type? Re-configure in place — rebuilding would reset a
    // child's own view state (a map's zoom, a scrolled list).
    if (this._child && this._childType === cfg.type) {
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
      this.innerHTML = "";
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
    this._config = { parameter: "value", items: [], ...config };
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

  _renderDynamicPreview() {
    const items = resolveItems(this._hass, this._config);
    this._wrap.innerHTML = "";
    this._rows = null;
    const box = document.createElement("div");
    box.style.cssText =
      "padding:10px 12px; border:1px dashed var(--divider-color); border-radius:8px; color:var(--secondary-text-color); font-size:.85em;";
    box.textContent = items.length
      ? `${items.length} choice${items.length === 1 ? "" : "s"}: ` +
        items.slice(0, 12).map((i) => i.label).join(", ") + (items.length > 12 ? "…" : "")
      : "No choices yet — pick an entity and an attribute that holds a list or a dictionary.";
    this._wrap.appendChild(box);
  }

  // Rows rebuild only on add/delete so typing never loses focus.
  _renderItems() {
    if (this._config.items_source === "entity") {
      this._renderDynamicPreview();
      return;
    }
    const items = this._config.items || [];
    if (this._rows && this._rows.length === items.length) return;
    this._wrap.innerHTML = "";
    this._rows = [];
    items.forEach((item, i) => {
      const row = document.createElement("div");
      row.style.cssText = "display:flex; align-items:center; gap:6px; margin-bottom:8px;";
      const label = this._input(item.label, "Display text", "1", () => {
        this._config.items[i] = { ...this._config.items[i], label: label.value };
        this._emit();
      });
      const val = this._input(item.value, "Value substituted into the card", "1.4", () => {
        this._config.items[i] = { ...this._config.items[i], value: val.value };
        this._emit();
      });
      const del = document.createElement("ha-icon");
      del.icon = "mdi:delete-outline";
      del.title = "Remove";
      del.style.cssText = "cursor:pointer; color:var(--secondary-text-color); padding:6px;";
      del.addEventListener("click", () => {
        this._config.items = items.filter((_, n) => n !== i);
        this._rows = null;
        this._renderItems();
        this._emit();
      });
      row.append(label, val, del);
      this._wrap.appendChild(row);
      this._rows.push(row);
    });
    const add = document.createElement("div");
    add.style.cssText =
      "display:inline-flex; align-items:center; gap:4px; cursor:pointer; color:var(--primary-color); padding:2px 4px 10px;";
    add.innerHTML = `<ha-icon icon="mdi:plus"></ha-icon>Add choice`;
    add.addEventListener("click", () => {
      this._config.items = [...(this._config.items || []), { label: "", value: "" }];
      this._rows = null;
      this._renderItems();
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

  _dynamicSchema() {
    const st = this._hass?.states?.[this._config.source_entity];
    const attrs = Object.keys(st?.attributes || {}).filter(
      (k) => !["friendly_name", "icon", "device_class", "unit_of_measurement", "state_class"].includes(k)
    );
    const raw = st?.attributes?.[this._config.source_attribute];
    const objFields =
      Array.isArray(raw) && raw[0] && typeof raw[0] === "object" ? Object.keys(raw[0]) : [];
    const fieldSel = (name) => ({
      name,
      selector: { select: { mode: "dropdown", options: objFields.map((f) => ({ value: f, label: f })) } },
    });
    return [
      { name: "source_entity", selector: { entity: {} } },
      {
        name: "source_attribute",
        selector: {
          select: {
            mode: "dropdown",
            options: attrs.length
              ? attrs.map((a) => ({ value: a, label: a }))
              : [{ value: this._config.source_attribute || "", label: "(pick an entity first)" }],
          },
        },
      },
      ...(objFields.length ? [fieldSel("source_label_field"), fieldSel("source_value_field")] : []),
    ];
  }

  _render() {
    if (!this._form) {
      this._form = document.createElement("ha-form");
      this._form.computeLabel = (s) =>
        ({ parameter: "Parameter name", default: "Default choice", items_source: "Choices",
           source_entity: "Entity", source_attribute: "Attribute",
           source_label_field: "Label field", source_value_field: "Value field" }[s.name] || s.name);
      this._form.computeHelper = (s) =>
        ({
          parameter: "Write $name$ anywhere in the card below — including inside a template — and it is replaced by the chosen value. Transforms: $name:slug$, $name:lower$, $name:upper$, $name:title$.",
          default: "Used until a choice is made (or when a link carries an unknown value).",
          source_attribute: "An attribute holding a list or a dictionary \u2014 a dictionary contributes its keys.",
        }[s.name]);
      this._form.addEventListener("value-changed", (e) => {
        const sourceChanged =
          e.detail.value.items_source !== this._config.items_source ||
          e.detail.value.source_entity !== this._config.source_entity ||
          e.detail.value.source_attribute !== this._config.source_attribute;
        this._config = { ...this._config, ...e.detail.value };
        if (sourceChanged) this._rows = null;
        this._emit();
        this._render();
      });
      this.appendChild(this._form);

      const itemsLbl = document.createElement("div");
      itemsLbl.textContent = "Choices";
      itemsLbl.style.cssText = "padding:16px 0 8px; color:var(--primary-text-color);";
      this.appendChild(itemsLbl);
      this._wrap = document.createElement("div");
      this.appendChild(this._wrap);
      const hint = document.createElement("div");
      hint.textContent =
        "Point an SB Filter Select card at this card to switch between the choices. Only these values are ever accepted from a link.";
      hint.style.cssText = "color:var(--secondary-text-color); font-size:.8em; padding:2px 4px 8px;";
      this.appendChild(hint);

      const cardLbl = document.createElement("div");
      cardLbl.textContent = "Card";
      cardLbl.style.cssText = "padding:8px 0; color:var(--primary-text-color);";
      this.appendChild(cardLbl);
      this._cardBox = document.createElement("div");
      this.appendChild(this._cardBox);
    }
    this._form.hass = this._hass;
    this._form.schema = [
      { name: "parameter", selector: { text: {} } },
      {
        name: "items_source",
        selector: {
          select: {
            mode: "dropdown",
            options: [
              { value: "static", label: "Typed in below" },
              { value: "entity", label: "From an entity attribute" },
            ],
          },
        },
      },
      ...(this._config.items_source === "entity" ? this._dynamicSchema() : []),
      {
        name: "default",
        selector: {
          select: {
            mode: "dropdown",
            options: resolveItems(this._hass, this._config)
              .filter((i) => i?.value)
              .map((i) => ({ value: String(i.value), label: i.label || String(i.value) })),
          },
        },
      },
    ];
    this._form.data = { items_source: "static", ...this._config };
    this._renderItems();
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
    "Wraps any card and substitutes a runtime parameter into it ($name$) — one card plus a dropdown instead of one card per value.",
  preview: false,
  documentationURL: "https://github.com/snadboy/sb-param-card",
});
console.info(`%c SB-PARAM-CARD %c v${VERSION} `, "background:#455a64;color:#fff", "background:#90a4ae;color:#000");
