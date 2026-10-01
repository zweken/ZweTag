// Print: cable labels, rack and device labels, or the cable schedule, with a page preview.

import { h, icon, field, numberInput, select, segmented, checkbox, plural } from "../ui.js";
import * as model from "../model.js";
import {
  LAYOUTS, sheetGeometry, buildPages, cableLabelItems, rackDeviceItems, canvasMeasure, setPageRule,
  pageCount, clampSkip,
} from "../print.js";

const WHAT = [
  { value: "cables", label: "Cable labels" },
  { value: "racks", label: "Rack and device labels" },
  { value: "schedule", label: "Cable schedule" },
];
const PREVIEW_WIDTH = 520;

let measure = null;

function state(app) {
  return app.viewState("print", () => ({ what: "cables", which: "needs", skip: 0, markIds: null }));
}

function sortedCables(p) {
  return [...p.cables].sort((x, y) => x.code.localeCompare(y.code, undefined, { numeric: true }));
}

function cableSet(app, which) {
  const p = app.project;
  const ix = app.index();
  const all = sortedCables(p);
  if (which === "all") return all;
  if (which === "selected") return all.filter((c) => app.selection.has(c.id));
  return all.filter((c) => model.labelState(p, ix, c) !== "labeled");
}

function setLabel(app, patch) {
  app.prefs((p) => model.updateSettings(p, { label: patch }));
}

function layoutFields(app, label) {
  const num = (key, name, value, onCommit, opts = {}) => field(name, numberInput({
    value, min: opts.min ?? 0, max: opts.max ?? 1000, step: opts.step ?? 0.1, id: `layout-${key}`, onCommit,
  }));
  if (label.preset === "single") {
    const sz = label.single;
    return h("div", { class: "form-row" },
      num("single-w", "Label width (mm)", sz.labelW, (v) => setLabel(app, { single: { ...sz, labelW: v } }), { min: 5 }),
      num("single-h", "Label height (mm)", sz.labelH, (v) => setLabel(app, { single: { ...sz, labelH: v } }), { min: 5 }),
    );
  }
  if (label.preset !== "custom") return null;
  const c = label.custom;
  const set = (key) => (v) => setLabel(app, { custom: { ...c, [key]: v } });
  return h("div", { class: "custom-grid" },
    num("pageW", "Page width (mm)", c.pageW, set("pageW"), { min: 10 }),
    num("pageH", "Page height (mm)", c.pageH, set("pageH"), { min: 10 }),
    num("cols", "Columns", c.cols, set("cols"), { min: 1, max: 50, step: 1 }),
    num("rows", "Rows", c.rows, set("rows"), { min: 1, max: 100, step: 1 }),
    num("labelW", "Label width (mm)", c.labelW, set("labelW"), { min: 5 }),
    num("labelH", "Label height (mm)", c.labelH, set("labelH"), { min: 5 }),
    num("marginTop", "Top margin (mm)", c.marginTop, set("marginTop")),
    num("marginLeft", "Left margin (mm)", c.marginLeft, set("marginLeft")),
    num("gapX", "Column gap (mm)", c.gapX, set("gapX")),
    num("gapY", "Row gap (mm)", c.gapY, set("gapY")),
  );
}

function scheduleTable(app) {
  const p = app.project;
  const ix = app.index();
  return h("table", { class: "schedule" },
    h("thead", {}, h("tr", {}, ["Code", "End A", "End B", "Cable", "Length"].map((t) => h("th", {}, t)))),
    h("tbody", {}, sortedCables(p).map((c) => {
      const ends = model.cableAddresses(p, ix, c);
      return h("tr", {},
        h("td", {}, c.code), h("td", {}, ends.a), h("td", {}, ends.b),
        h("td", {}, model.mediaName(c.media)), h("td", {}, c.lengthM > 0 ? `${c.lengthM} m` : ""));
    })));
}

/** The printable content for the current options: {pages, overflow, labels, geometry, cables}. */
function content(app, s) {
  const p = app.project;
  const label = p.settings.label;
  if (s.what === "schedule") {
    const page = h("div", { class: "schedule-page" }, h("h1", {}, p.name), scheduleTable(app));
    return { pages: [page], overflow: 0, labels: 0, geometry: null, cables: [] };
  }
  const g = sheetGeometry(label);
  const cables = s.what === "cables" ? cableSet(app, s.which) : [];
  const items = s.what === "cables" ? cableLabelItems(p, cables, { thirdLine: label.thirdLine }) : rackDeviceItems(p);
  if (!measure) measure = canvasMeasure(document);
  const built = buildPages(document, items, g, { repeat: label.repeat, outlines: label.outlines, skip: s.skip, measure });
  return { ...built, labels: items.length, geometry: g, cables };
}

function doPrint(app, s, out) {
  if (s.what === "schedule") setPageRule(document, "210mm 297mm", "12mm");
  else setPageRule(document, `${out.geometry.pageW}mm ${out.geometry.pageH}mm`, "0");
  let root = document.getElementById("print-root");
  if (!root) {
    root = h("div", { id: "print-root" });
    document.body.append(root);
  }
  root.replaceChildren(...out.pages.map((page) => page.cloneNode(true)));
  const ids = out.cables.map((c) => c.id);
  const after = () => {
    window.removeEventListener("afterprint", after);
    root.replaceChildren();
    if (s.what === "cables" && ids.length) {
      s.markIds = ids;
      app.render();
    }
  };
  window.addEventListener("afterprint", after);
  window.print();
}

function markBar(app, s) {
  const p = app.project;
  const live = new Set(p.cables.map((c) => c.id));
  const ids = (s.markIds || []).filter((id) => live.has(id));
  if (ids.length === 0) return null;
  return h("div", { class: "mark-bar", role: "alert" },
    h("span", {}, `Mark ${plural(ids.length, "cable")} as labeled?`),
    h("button", { class: "btn primary small", id: "mark-printed", onclick: () => {
      s.markIds = null;
      app.act((proj) => model.setLabeled(proj, ids, true));
    } }, "Mark labeled"),
    h("button", { class: "btn small", onclick: () => {
      s.markIds = null;
      app.render();
    } }, "Not yet"),
  );
}

export function render(app) {
  const s = state(app);
  const p = app.project;
  const label = p.settings.label;
  const out = content(app, s);
  const counts = {
    needs: cableSet(app, "needs").length,
    selected: cableSet(app, "selected").length,
    all: p.cables.length,
  };
  const options = h("div", { class: "card print-options" },
    field("What", select(WHAT, s.what, (v) => { s.what = v; app.render(); }, { id: "print-what" })),
    s.what === "cables" ? field("Which", segmented([
      { value: "needs", label: `Needs label ${counts.needs}` },
      { value: "selected", label: `Selected ${counts.selected}` },
      { value: "all", label: `All ${counts.all}` },
    ], s.which, (v) => { s.which = v; app.render(); }, { label: "Which" })) : null,
    s.what !== "schedule" ? [
      field("Layout", select(LAYOUTS.map((l) => ({ value: l.key, label: l.name })), label.preset, (v) => setLabel(app, { preset: v }), { id: "print-layout" })),
      layoutFields(app, label),
      h("div", { class: "form-row" },
        field("Repeat text", select([1, 2, 3].map((n) => ({ value: String(n), label: String(n) })), String(label.repeat),
          (v) => setLabel(app, { repeat: Number(v) }), { id: "print-repeat" })),
        field("Skip first labels", numberInput({
          value: s.skip, min: 0, max: 999, id: "print-skip",
          onCommit: (v) => { s.skip = out.geometry ? clampSkip(out.geometry, v) : 0; app.render(); },
        })),
      ),
      s.what === "cables" ? checkbox("Third line", label.thirdLine, (v) => setLabel(app, { thirdLine: v }), { id: "print-third" }) : null,
      checkbox("Outlines", label.outlines, (v) => setLabel(app, { outlines: v }), { id: "print-outlines" }),
    ] : null,
    h("div", { class: "print-summary" },
      out.geometry
        ? `${plural(out.labels, "label")} · ${plural(pageCount(out.geometry, out.labels, s.skip), "page")}`
        : plural(p.cables.length, "cable")),
    out.overflow ? h("div", { class: "warning", id: "print-overflow" }, "Text does not fit this label size") : null,
    h("button", {
      class: "btn primary wide",
      id: "print-button",
      disabled: out.geometry ? out.labels === 0 : p.cables.length === 0,
      onclick: () => doPrint(app, s, out),
    }, icon("print", 16), "Print"),
  );
  const preview = h("div", { class: "print-preview", id: "print-preview" });
  const scale = out.geometry ? Math.min(1, PREVIEW_WIDTH / ((out.geometry.pageW * 96) / 25.4)) : 0.62;
  for (const page of out.pages) {
    const holder = h("div", { class: "preview-page" });
    holder.style.zoom = String(scale);
    holder.append(page);
    preview.append(holder);
  }
  return h("div", { class: "view print-view" },
    h("div", { class: "view-head" }, h("h1", {}, "Print")),
    markBar(app, s),
    h("div", { class: "print-body" }, options, preview),
  );
}
