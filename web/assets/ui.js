// Small DOM helpers shared by the views: an element builder, icons, toasts, dialogs and form
// controls. Styles are only ever set through the CSSOM (el.style), never as style attributes,
// because the Content-Security-Policy does not allow inline styles.

const SVG_NS = "http://www.w3.org/2000/svg";

function appendChildren(el, children) {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false || child === "") continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

/**
 * Creates an element. props: class, style (object), dataset (object), on<event> handlers, and
 * any other property or attribute. Tags prefixed with "svg:" are created in the SVG namespace.
 */
export function h(tag, props, ...children) {
  const svg = tag.startsWith("svg:");
  const el = svg ? document.createElementNS(SVG_NS, tag.slice(4)) : document.createElement(tag);
  for (const [key, value] of Object.entries(props || {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key === "class") {
      if (svg) el.setAttribute("class", value);
      else el.className = value;
    } else if (key === "style") {
      for (const [name, v] of Object.entries(value)) {
        if (name.startsWith("--")) el.style.setProperty(name, v);
        else el.style[name] = v;
      }
    } else if (key === "dataset") {
      Object.assign(el.dataset, value);
    } else if (key.startsWith("on") && typeof value === "function") {
      el.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (!svg && key in el && key !== "list" && key !== "form") {
      el[key] = value;
    } else {
      el.setAttribute(key, value === true ? "" : String(value));
    }
  }
  appendChildren(el, children);
  return el;
}

// ---------------------------------------------------------------------------------------------
// Icons: 24 x 24 outline drawings; "c x y r" is a circle, anything else a path.

const ICONS = {
  racks: ["M6 3h12v18H6z", "M6 8h12", "M6 13h12", "M6 18h12", "M9 5.5h2", "M9 10.5h2", "M9 15.5h2"],
  devices: ["M3 8h18v8H3z", "M6 12h1", "M9 12h1", "M12 12h1", "M15 12h1", "M18 12h0.01"],
  connect: ["c 5 7 2", "c 19 17 2", "M7 7h3a3 3 0 0 1 3 3v4a3 3 0 0 0 3 3h1"],
  cables: ["M9 6h11", "M9 12h11", "M9 18h11", "M4 6h1", "M4 12h1", "M4 18h1"],
  print: ["M7 9V3h10v6", "M7 17H4v-7a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v7h-3", "M7 14h10v7H7z"],
  settings: ["M4 7h9", "M17 7h3", "M4 17h3", "M11 17h9", "M15 5v4", "M9 15v4", "M4 12h13", "M20 12h0.01"],
  undo: ["M9 5 4 10l5 5", "M4 10h10a6 6 0 0 1 0 12h-3"],
  redo: ["M15 5l5 5-5 5", "M20 10H10a6 6 0 0 0 0 12h3"],
  sun: ["c 12 12 4", "M12 2v2", "M12 20v2", "M4.9 4.9l1.4 1.4", "M17.7 17.7l1.4 1.4", "M2 12h2", "M20 12h2", "M4.9 19.1l1.4-1.4", "M17.7 6.3l1.4-1.4"],
  moon: ["M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"],
  monitor: ["M3 4h18v12H3z", "M8 20h8", "M12 16v4"],
  file: ["M6 3h8l4 4v14H6z", "M14 3v4h4"],
  chevron: ["M7 10l5 5 5-5"],
  plus: ["M12 5v14", "M5 12h14"],
  close: ["M6 6l12 12", "M18 6 6 18"],
  trash: ["M4 7h16", "M9 7V4h6v3", "M6 7l1 14h10l1-14", "M10 11v6", "M14 11v6"],
  search: ["c 10.5 10.5 6.5", "M20 20l-4.8-4.8"],
  folder: ["M3 6h6l2 2h10v11H3z"],
  copy: ["M8 8h12v12H8z", "M4 16V4h12"],
  left: ["M15 6l-6 6 6 6"],
  "win-min": ["M6 12h12"],
  "win-max": ["M6.5 6.5h11v11h-11z"],
  "win-restore": ["M6.5 9.5h8v8h-8z", "M9.5 6.5h8v8"],
  right: ["M9 6l6 6-6 6"],
};

export function icon(name, size = 18) {
  const svg = h("svg:svg", {
    class: "icon",
    viewBox: "0 0 24 24",
    width: size,
    height: size,
    fill: "none",
    stroke: "currentColor",
    "stroke-width": "1.8",
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
    "aria-hidden": "true",
  });
  for (const d of ICONS[name] || []) {
    if (d.startsWith("c ")) {
      const [cx, cy, r] = d.slice(2).split(" ");
      svg.append(h("svg:circle", { cx, cy, r }));
    } else {
      svg.append(h("svg:path", { d }));
    }
  }
  return svg;
}

// ---------------------------------------------------------------------------------------------
// Toasts

let toastBox = null;

/** Shows a short message. actions: [{label, run}]. kind: "info" or "error". */
export function toast(message, { kind = "info", actions = [], timeout } = {}) {
  if (!toastBox) {
    toastBox = h("div", { class: "toasts", role: "status", "aria-live": "polite" });
    document.body.append(toastBox);
  }
  const close = () => item.remove();
  const item = h("div", { class: `toast ${kind}` },
    h("span", { class: "toast-text" }, message),
    actions.map((a) => h("button", { class: "btn small", onclick: () => { close(); a.run(); } }, a.label)),
    h("button", { class: "icon-btn small", title: "Close", "aria-label": "Close", onclick: close }, icon("close", 14)),
  );
  toastBox.append(item);
  const ms = timeout ?? (actions.length ? 10000 : kind === "error" ? 6000 : 3500);
  setTimeout(close, ms);
  return close;
}

// ---------------------------------------------------------------------------------------------
// Dialogs

/** A modal question. Resolves true when confirmed. */
export function confirmDialog(message, { ok = "OK", danger = false } = {}) {
  return new Promise((resolve) => {
    const finish = (value) => {
      dialog.close();
      dialog.remove();
      resolve(value);
    };
    const okButton = h("button", { class: danger ? "btn danger" : "btn primary", onclick: () => finish(true) }, ok);
    const dialog = h("dialog", { class: "dialog" },
      h("p", { class: "dialog-text" }, message),
      h("div", { class: "dialog-actions" },
        h("button", { class: "btn", onclick: () => finish(false) }, "Cancel"),
        okButton,
      ),
    );
    dialog.addEventListener("cancel", (e) => {
      e.preventDefault();
      finish(false);
    });
    document.body.append(dialog);
    dialog.showModal();
    okButton.focus();
  });
}

/** Opens the file picker and resolves with the chosen file's text, or null. */
export function pickTextFile(accept = ".json,application/json") {
  return new Promise((resolve) => {
    const input = h("input", { type: "file", accept, class: "hidden" });
    input.addEventListener("change", async () => {
      const file = input.files && input.files[0];
      input.remove();
      resolve(file ? await file.text() : null);
    });
    input.addEventListener("cancel", () => {
      input.remove();
      resolve(null);
    });
    document.body.append(input);
    input.click();
  });
}

/** Saves text as a download. */
export function downloadText(name, text, type = "text/plain") {
  const url = URL.createObjectURL(new Blob([text], { type: `${type};charset=utf-8` }));
  const a = h("a", { href: url, download: name, class: "hidden" });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

// ---------------------------------------------------------------------------------------------
// Controls

export function field(label, control, { wide = false } = {}) {
  return h("label", { class: wide ? "field wide" : "field" }, h("span", { class: "field-label" }, label), control);
}

/** Buttons that act as one choice. options: [{value, label, title?}]. */
export function segmented(options, value, onChange, { label } = {}) {
  return h("div", { class: "segmented", role: "radiogroup", "aria-label": label },
    options.map((o) => h("button", {
      type: "button",
      class: o.value === value ? "seg active" : "seg",
      role: "radio",
      "aria-checked": String(o.value === value),
      title: o.title,
      onclick: () => {
        if (o.value !== value) onChange(o.value);
      },
    }, o.label)),
  );
}

/** A text input that commits on change (blur or Enter) and reverts on Escape. */
export function textInput({ value = "", onCommit, placeholder = "", className = "input", id, maxLength, label }) {
  const input = h("input", {
    class: className,
    type: "text",
    value,
    placeholder,
    id,
    maxLength,
    spellcheck: false,
    autocomplete: "off",
    "aria-label": label,
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") input.blur();
    if (e.key === "Escape") {
      input.value = value;
      input.blur();
    }
  });
  input.addEventListener("change", () => {
    if (input.value !== value) onCommit(input.value);
  });
  return input;
}

/** A number input that commits on change. An empty field commits "". */
export function numberInput({ value, min, max, step = 1, onCommit, className = "input num", id, label, placeholder = "" }) {
  const input = h("input", {
    class: className,
    type: "number",
    value: value === "" || value === null || value === undefined ? "" : String(value),
    min,
    max,
    step,
    id,
    placeholder,
    "aria-label": label,
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") input.blur();
  });
  input.addEventListener("change", () => onCommit(input.value === "" ? "" : Number(input.value)));
  return input;
}

export function select(options, value, onChange, { id, label, className = "input" } = {}) {
  const el = h("select", { class: className, id, "aria-label": label },
    options.map((o) => h("option", { value: o.value, selected: o.value === value }, o.label)));
  el.addEventListener("change", () => onChange(el.value));
  return el;
}

export function checkbox(labelText, checked, onChange, { id } = {}) {
  const input = h("input", { type: "checkbox", checked, id });
  input.addEventListener("change", () => onChange(input.checked));
  return h("label", { class: "check" }, input, h("span", {}, labelText));
}

export function badge(text, kind) {
  return h("span", { class: `badge ${kind}` }, text);
}

/** "1 cable", "2 cables". */
export function plural(n, word) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}
