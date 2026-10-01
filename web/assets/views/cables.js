// Cables: every cable with its two addresses and label state; search, filters, bulk marking,
// CSV export.

import { h, icon, select, numberInput, segmented, confirmDialog, badge, plural } from "../ui.js";
import * as model from "../model.js";
import { cablesCsv, labelsCsv } from "../csv.js";

const PAGE = 100;
const MEDIA_OPTIONS = model.MEDIA.map((m) => ({ value: m.key, label: m.name }));
const STATE_LABEL = { unlabeled: "Unlabeled", labeled: "Labeled", relabel: "Relabel" };
const STATE_BADGE = { unlabeled: "neutral", labeled: "ok", relabel: "warn" };

function state(app) {
  const s = app.viewState("cables", () => ({ q: "", filter: "all", rackId: "", page: 0 }));
  if (s.rackId && !app.project.racks.some((r) => r.id === s.rackId)) s.rackId = "";
  return s;
}

/** All cables with their addresses and state, sorted by code. */
function rows(app) {
  const p = app.project;
  const ix = app.index();
  const out = p.cables.map((c) => {
    const ends = model.cableAddresses(p, ix, c);
    const racks = [c.a, c.b].map((e) => ix.devices.get(e.deviceId)?.rackId);
    return { cable: c, a: ends.a, b: ends.b, state: model.labelState(p, ix, c), racks };
  });
  out.sort((x, y) => x.cable.code.localeCompare(y.cable.code, undefined, { numeric: true }));
  return out;
}

function filtered(all, s) {
  const q = s.q.trim().toLowerCase();
  return all.filter((r) => {
    if (s.filter === "needs" && r.state === "labeled") return false;
    if (s.filter === "labeled" && r.state !== "labeled") return false;
    if (s.rackId && !r.racks.includes(s.rackId)) return false;
    if (q && !`${r.cable.code}\n${r.a}\n${r.b}`.toLowerCase().includes(q)) return false;
    return true;
  });
}

/** Cables for an export: the selection when there is one, otherwise everything the filters show. */
export function exportSet(app) {
  const s = state(app);
  const list = filtered(rows(app), s).map((r) => r.cable);
  if (app.selection.size === 0) return list;
  return app.project.cables.filter((c) => app.selection.has(c.id));
}

function toolbar(app, s, all) {
  const needs = all.filter((r) => r.state !== "labeled").length;
  const search = h("input", {
    class: "input search",
    type: "search",
    id: "cable-search",
    placeholder: "Search",
    value: s.q,
    autocomplete: "off",
    spellcheck: false,
    "aria-label": "Search cables",
  });
  search.addEventListener("input", () => {
    s.q = search.value;
    s.page = 0;
    app.render();
  });
  const racks = [{ value: "", label: "All racks" }, ...app.project.racks.map((r) => ({ value: r.id, label: r.code }))];
  return h("div", { class: "toolbar" },
    h("div", { class: "search-wrap" }, icon("search", 16), search),
    segmented([
      { value: "all", label: `All ${all.length}` },
      { value: "needs", label: `Needs label ${needs}` },
      { value: "labeled", label: `Labeled ${all.length - needs}` },
    ], s.filter, (v) => {
      s.filter = v;
      s.page = 0;
      app.render();
    }, { label: "Filter" }),
    select(racks, s.rackId, (v) => {
      s.rackId = v;
      s.page = 0;
      app.render();
    }, { id: "cable-rack", label: "Rack" }),
    h("div", { class: "spacer" }),
    h("button", { class: "btn", id: "print-labels", onclick: () => printSelected(app) }, icon("print", 16), "Print labels"),
    h("button", { class: "btn", id: "cables-csv", onclick: () => app.exportText("zwetag-cables.csv", cablesCsv(app.project, exportSet(app))) }, "Cables CSV"),
    h("button", { class: "btn", id: "labels-csv", onclick: () => app.exportText("zwetag-labels.csv", labelsCsv(app.project, exportSet(app))) }, "Labels CSV"),
  );
}

function printSelected(app) {
  const ps = app.viewState("print", () => ({}));
  ps.what = "cables";
  ps.which = app.selection.size ? "selected" : "needs";
  app.navigate("print");
}

function selectionBar(app) {
  const ids = [...app.selection];
  if (ids.length === 0) return null;
  const remove = async () => {
    if (await confirmDialog(`Delete ${plural(ids.length, "cable")}?`, { ok: "Delete", danger: true })) {
      app.selection.clear();
      app.act((p) => model.deleteCables(p, ids));
    }
  };
  return h("div", { class: "selection-bar" },
    h("strong", {}, `${ids.length} selected`),
    h("button", { class: "btn small", id: "mark-labeled", onclick: () => app.act((p) => model.setLabeled(p, ids, true)) }, "Mark labeled"),
    h("button", { class: "btn small", id: "mark-unlabeled", onclick: () => app.act((p) => model.setLabeled(p, ids, false)) }, "Mark unlabeled"),
    h("button", { class: "btn small danger-ghost", id: "delete-selected", onclick: remove }, icon("trash", 14), "Delete"),
    h("div", { class: "spacer" }),
    h("button", { class: "icon-btn", title: "Clear selection", "aria-label": "Clear selection", onclick: () => { app.selection.clear(); app.render(); } }, icon("close", 16)),
  );
}

function row(app, r) {
  const c = r.cable;
  const selected = app.selection.has(c.id);
  const pick = h("input", { type: "checkbox", checked: selected, "aria-label": `Select ${c.code}` });
  pick.addEventListener("change", () => {
    if (pick.checked) app.selection.add(c.id);
    else app.selection.delete(c.id);
    app.render();
  });
  const labeled = h("input", { type: "checkbox", checked: r.state === "labeled", "aria-label": `${c.code} labeled` });
  labeled.addEventListener("change", () => app.act((p) => model.setLabeled(p, [c.id], labeled.checked)));
  return h("tr", { class: selected ? "selected" : "" },
    h("td", { class: "check-cell" }, pick),
    h("td", { class: "mono" }, c.code),
    h("td", { class: "mono" }, r.a),
    h("td", { class: "mono" }, r.b),
    h("td", {}, select(MEDIA_OPTIONS, c.media, (v) => app.act((p) => model.updateCable(p, c.id, { media: v })), {
      className: "input cell-input",
      label: `${c.code} cable`,
    })),
    h("td", {}, numberInput({
      value: c.lengthM > 0 ? c.lengthM : "",
      min: 0,
      step: 0.1,
      className: "input num cell-input",
      label: `${c.code} length`,
      onCommit: (v) => app.act((p) => model.updateCable(p, c.id, { lengthM: v })),
    })),
    h("td", {}, badge(STATE_LABEL[r.state], STATE_BADGE[r.state])),
    h("td", { class: "check-cell" }, labeled),
  );
}

export function render(app) {
  const s = state(app);
  const all = rows(app);
  const list = filtered(all, s);
  const pages = Math.max(1, Math.ceil(list.length / PAGE));
  s.page = Math.min(s.page, pages - 1);
  const shown = list.slice(s.page * PAGE, s.page * PAGE + PAGE);
  const allShownSelected = shown.length > 0 && shown.every((r) => app.selection.has(r.cable.id));
  const pickAll = h("input", { type: "checkbox", checked: allShownSelected, "aria-label": "Select all shown" });
  pickAll.addEventListener("change", () => {
    for (const r of shown) {
      if (pickAll.checked) app.selection.add(r.cable.id);
      else app.selection.delete(r.cable.id);
    }
    app.render();
  });
  const from = list.length ? s.page * PAGE + 1 : 0;
  const to = Math.min(list.length, (s.page + 1) * PAGE);
  return h("div", { class: "view cables-view" },
    h("div", { class: "view-head" }, h("h1", {}, "Cables")),
    toolbar(app, s, all),
    selectionBar(app),
    h("div", { class: "card table-card" },
      h("table", { class: "table" },
        h("thead", {}, h("tr", {},
          h("th", { class: "check-cell" }, pickAll),
          ["Code", "End A", "End B", "Cable", "Length", "Status", "Labeled"].map((t) => h("th", {}, t)))),
        h("tbody", {}, shown.map((r) => row(app, r)))),
    ),
    pages > 1 || list.length > 0 ? h("div", { class: "pager" },
      h("span", { class: "muted" }, `${from}–${to} of ${list.length}`),
      h("button", { class: "icon-btn", disabled: s.page === 0, title: "Previous", "aria-label": "Previous page", onclick: () => { s.page -= 1; app.render(); } }, icon("left", 16)),
      h("button", { class: "icon-btn", disabled: s.page >= pages - 1, title: "Next", "aria-label": "Next page", onclick: () => { s.page += 1; app.render(); } }, icon("right", 16)),
    ) : null,
  );
}

export function keydown(app, e, typing) {
  if (e.key === "Escape" && !typing && app.selection.size) {
    app.selection.clear();
    app.render();
  }
}
