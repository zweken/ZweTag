// Connect: two racks side by side (A and B, possibly the same rack). Open a device in each, click
// a port in A and a port in B, then Connect. Dragging from one port to another only fills the two
// ends; the Connect button is the only thing that creates cables.

import { h, field, numberInput, select, segmented, toast, plural, badge, icon } from "../ui.js";
import { address, endAddresses } from "../engine.js";
import * as model from "../model.js";
import { rackElevation } from "./devices.js";

const SIDES = ["a", "b"];
const MEDIA_OPTIONS = model.MEDIA.map((m) => ({ value: m.key, label: m.name }));
const STATE_LABEL = { unlabeled: "Unlabeled", labeled: "Labeled", relabel: "Relabel" };
const STATE_BADGE = { unlabeled: "neutral", labeled: "ok", relabel: "warn" };

let drag = null;
let suppressClick = false;

function topDevice(app, rackId) {
  const list = app.index().devicesByRack.get(rackId) || [];
  return list.length ? list[0].id : "";
}

function state(app) {
  const p = app.project;
  const ix = app.index();
  const s = app.viewState("connect", () => ({
    panels: [{ rackId: "", deviceId: "", face: "front" }, { rackId: "", deviceId: "", face: "front" }],
    sel: [null, null],
    lines: "all",
    media: model.DEFAULT_MEDIA,
    lengthM: "",
    count: 1,
    hot: "",
  }));
  s.panels.forEach((panel, i) => {
    if (!ix.racks.has(panel.rackId)) {
      const rack = p.racks[Math.min(i, p.racks.length - 1)];
      panel.rackId = rack ? rack.id : "";
      panel.deviceId = "";
    }
    const d = ix.devices.get(panel.deviceId);
    if (!d || d.rackId !== panel.rackId) panel.deviceId = topDevice(app, panel.rackId);
    const open = ix.devices.get(panel.deviceId);
    if (!open || !open.passThrough) panel.face = "front";
  });
  s.sel = s.sel.map((slot) => {
    if (!slot) return null;
    const d = ix.devices.get(slot.deviceId);
    return d && slot.port <= d.ports && (slot.face === "front" || d.passThrough) ? slot : null;
  });
  if (s.hot && !ix.cables.has(s.hot)) s.hot = "";
  return s;
}

function sameSlot(x, y) {
  return Boolean(x && y && x.deviceId === y.deviceId && x.port === y.port && x.face === y.face);
}

function onPanel(end, panel) {
  return end.deviceId === panel.deviceId && end.face === panel.face;
}

function rackOptions(app) {
  const ix = app.index();
  const several = app.project.rooms.length > 1;
  return app.project.racks.map((r) => {
    const room = ix.rooms.get(r.roomId);
    return { value: r.id, label: several && room ? `${room.code} · ${r.code}` : r.code };
  });
}

function portGrid(app, s, i, device) {
  const p = app.project;
  const ix = app.index();
  const panel = s.panels[i];
  const t = model.deviceType(device.type);
  const grid = h("div", { class: "port-grid", style: { "--cols": Math.min(24, device.ports) } });
  for (let port = 1; port <= device.ports; port++) {
    const slot = { deviceId: device.id, port, face: panel.face };
    const cable = ix.slots.get(model.slotKey(slot));
    const name = model.portLabel(device, port);
    let title = name === String(port) ? `Port ${port}` : `Port ${port} · ${name}`;
    if (cable) {
      const ends = model.cableAddresses(p, ix, cable);
      const other = model.slotKey(cable.a) === model.slotKey(slot) ? ends.b : ends.a;
      title = `${cable.code} → ${other}`;
    }
    const cls = ["port", cable ? "used" : "", sameSlot(s.sel[i], slot) ? "selected" : "", cable && cable.id === s.hot ? "hot" : ""];
    grid.append(h("button", {
      class: cls.filter(Boolean).join(" "),
      title,
      "aria-label": title,
      "aria-pressed": String(sameSlot(s.sel[i], slot)),
      dataset: { side: SIDES[i], port: String(port), cable: cable ? cable.id : "" },
      onclick: () => {
        if (suppressClick) {
          suppressClick = false;
          return;
        }
        s.sel[i] = sameSlot(s.sel[i], slot) ? null : slot;
        app.render();
      },
      onpointerdown: (e) => startDrag(app, s, i, slot, e),
      onmouseenter: () => setHot(app, s, cable ? cable.id : ""),
      onmouseleave: () => setHot(app, s, ""),
    }, String(port)));
  }
  return h("div", { class: "ports" },
    h("div", { class: "device-head" },
      h("strong", {}, model.deviceAddress(ix, device)),
      h("span", { class: "muted" }, ` ${t.name}${device.name ? ` · ${device.name}` : ""}`),
      h("div", { class: "spacer" }),
      device.passThrough ? segmented(
        [{ value: "front", label: "Front" }, { value: "rear", label: "Rear" }],
        panel.face,
        (v) => {
          panel.face = v;
          app.render();
        },
        { label: "Face" },
      ) : null,
    ),
    grid,
  );
}

function panelView(app, s, i) {
  const ix = app.index();
  const panel = s.panels[i];
  const rack = ix.racks.get(panel.rackId);
  const device = ix.devices.get(panel.deviceId);
  return h("section", { class: "panel", dataset: { side: SIDES[i] } },
    h("div", { class: "panel-head" },
      h("span", { class: "side-badge" }, SIDES[i].toUpperCase()),
      select(rackOptions(app), panel.rackId, (v) => {
        panel.rackId = v;
        panel.deviceId = topDevice(app, v);
        panel.face = "front";
        app.render();
      }, { id: `rack-${SIDES[i]}`, label: `Rack ${SIDES[i].toUpperCase()}` }),
    ),
    h("div", { class: "panel-rack" }, rackElevation(app, rack, {
      compact: true,
      selectedId: panel.deviceId,
      onDevice: (d) => {
        panel.deviceId = d.id;
        panel.face = "front";
        app.render();
      },
    })),
    device ? portGrid(app, s, i, device) : null,
  );
}

function endText(app, s) {
  const ix = app.index();
  const [a, b] = s.sel;
  if (a && b) return endAddresses(model.endParts(ix, a), model.endParts(ix, b), app.project.settings.roomPrefix);
  return { a: a ? address(model.endParts(ix, a)) : "", b: b ? address(model.endParts(ix, b)) : "" };
}

function pendingBar(app, s) {
  const [a, b] = s.sel;
  const reason = a && b ? model.connectProblem(app.project, a, b, s.count) : "";
  const ready = Boolean(a && b && reason === "");
  const ends = endText(app, s);
  const go = () => {
    const created = app.act((p) => model.connect(p, a, b, s.count, { media: s.media, lengthM: s.lengthM }));
    if (!created) return;
    s.sel = [null, null];
    s.count = 1;
    app.render();
    toast(`${plural(created.length, "cable")} added`);
  };
  return h("div", { class: "pending-bar", role: "group", "aria-label": "New cable" },
    h("div", { class: "pending-end" }, h("span", { class: "side-badge" }, "A"), h("code", { id: "pending-a" }, ends.a || "—")),
    h("div", { class: "pending-end" }, h("span", { class: "side-badge" }, "B"), h("code", { id: "pending-b" }, ends.b || "—")),
    field("Cable", select(MEDIA_OPTIONS, s.media, (v) => { s.media = v; }, { id: "pending-media" })),
    field("Length (m)", numberInput({ value: s.lengthM, min: 0, step: 0.1, id: "pending-length", onCommit: (v) => { s.lengthM = v; } })),
    field("Count", numberInput({
      value: s.count,
      min: 1,
      max: 288,
      id: "pending-count",
      onCommit: (v) => {
        s.count = Number.isInteger(v) && v >= 1 ? v : 1;
        app.render();
      },
    })),
    h("button", { class: "btn primary", id: "connect-button", disabled: !ready, onclick: go }, s.count > 1 ? `Connect ${s.count}` : "Connect"),
    reason ? h("span", { class: "reason", id: "connect-reason" }, reason) : null,
  );
}

function cableList(app, s) {
  const p = app.project;
  const ix = app.index();
  const ids = new Set(s.panels.map((x) => x.deviceId).filter(Boolean));
  const cables = [];
  const seen = new Set();
  for (const id of ids) {
    for (const c of ix.cablesByDevice.get(id) || []) {
      if (!seen.has(c.id)) {
        seen.add(c.id);
        cables.push(c);
      }
    }
  }
  if (cables.length === 0) return null;
  cables.sort((x, y) => x.code.localeCompare(y.code, undefined, { numeric: true }));
  return h("div", { class: "card table-card" },
    h("table", { class: "table" },
      h("thead", {}, h("tr", {}, ["Code", "End A", "End B", "Cable", "Status", ""].map((t) => h("th", {}, t)))),
      h("tbody", {}, cables.map((c) => {
        const ends = model.cableAddresses(p, ix, c);
        const st = model.labelState(p, ix, c);
        return h("tr", {
          class: c.id === s.hot ? "hot" : "",
          dataset: { cable: c.id },
          onmouseenter: () => setHot(app, s, c.id),
          onmouseleave: () => setHot(app, s, ""),
        },
        h("td", { class: "mono" }, c.code),
        h("td", { class: "mono" }, ends.a),
        h("td", { class: "mono" }, ends.b),
        h("td", {}, model.mediaName(c.media)),
        h("td", {}, badge(STATE_LABEL[st], STATE_BADGE[st])),
        h("td", { class: "actions" }, h("button", {
          class: "icon-btn",
          title: "Delete cable",
          "aria-label": `Delete cable ${c.code}`,
          onclick: () => app.act((proj) => model.deleteCables(proj, [c.id])),
        }, icon("trash", 15))));
      }))));
}

export function render(app) {
  const p = app.project;
  const head = h("div", { class: "view-head" }, h("h1", {}, "Connect"));
  if (p.racks.length === 0) {
    return h("div", { class: "view" }, head,
      h("div", { class: "card empty" }, h("button", { class: "btn primary", onclick: () => app.navigate("racks") }, "Racks")));
  }
  const s = state(app);
  head.append(h("div", { class: "spacer" }), h("span", { class: "muted small" }, "Lines"),
    segmented([{ value: "all", label: "All" }, { value: "selected", label: "Selected" }], s.lines, (v) => {
      s.lines = v;
      app.render();
    }, { label: "Lines" }));
  return h("div", { class: "view connect-view" },
    head,
    h("div", { class: "connect-stage" },
      panelView(app, s, 0),
      panelView(app, s, 1),
      h("svg:svg", { class: "wires", "aria-hidden": "true" }),
    ),
    pendingBar(app, s),
    cableList(app, s),
  );
}

// ---------------------------------------------------------------------------------------------
// Wires

function setHot(app, s, id) {
  if (s.hot === id) return;
  s.hot = id;
  const root = app.main;
  for (const el of root.querySelectorAll(".hot")) el.classList.remove("hot");
  if (id) for (const el of root.querySelectorAll(`[data-cable="${id}"]`)) el.classList.add("hot");
  drawWires(app, root);
}

function portCenter(stage, box, side, port) {
  const el = stage.querySelector(`.panel[data-side="${side}"] .port[data-port="${port}"]`);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2 - box.left, y: r.top + r.height / 2 - box.top, bottom: r.bottom - box.top };
}

function wirePath(a, b) {
  const sag = 56 + Math.abs(b.x - a.x) * 0.06;
  return `M ${a.x} ${a.bottom} C ${a.x} ${a.bottom + sag} ${b.x} ${b.bottom + sag} ${b.x} ${b.bottom}`;
}

function drawWires(app, root) {
  const stage = root.querySelector(".connect-stage");
  if (!stage) return;
  const svg = stage.querySelector("svg.wires");
  const s = app.viewState("connect", () => ({}));
  const box = stage.getBoundingClientRect();
  svg.setAttribute("width", String(box.width));
  svg.setAttribute("height", String(box.height));
  svg.setAttribute("viewBox", `0 0 ${box.width} ${box.height}`);
  svg.replaceChildren();
  const [pa, pb] = s.panels;
  if (!pa.deviceId || !pb.deviceId) return;
  const ix = app.index();
  const selectedEnds = s.sel.filter(Boolean).map(model.slotKey);
  for (const c of ix.cablesByDevice.get(pa.deviceId) || []) {
    let ea = null;
    let eb = null;
    if (onPanel(c.a, pa) && onPanel(c.b, pb)) {
      ea = c.a;
      eb = c.b;
    } else if (onPanel(c.b, pa) && onPanel(c.a, pb)) {
      ea = c.b;
      eb = c.a;
    } else {
      continue;
    }
    const hot = c.id === s.hot || selectedEnds.includes(model.slotKey(c.a)) || selectedEnds.includes(model.slotKey(c.b));
    if (s.lines === "selected" && !hot) continue;
    const a = portCenter(stage, box, "a", ea.port);
    const b = portCenter(stage, box, "b", eb.port);
    if (!a || !b) continue;
    svg.append(h("svg:path", { class: hot ? "wire hot" : "wire", d: wirePath(a, b), "data-cable": c.id }));
  }
  if (drag && drag.moved) {
    const a = portCenter(stage, box, SIDES[drag.side], drag.slot.port);
    if (a) {
      const x = drag.x - box.left;
      const y = drag.y - box.top;
      svg.append(h("svg:path", { class: "wire drag", d: `M ${a.x} ${a.y} L ${x} ${y}` }));
    }
  }
}

function startDrag(app, s, side, slot, e) {
  if (e.button !== 0) return;
  drag = { side, slot, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, moved: false };
  const move = (ev) => {
    drag.x = ev.clientX;
    drag.y = ev.clientY;
    if (!drag.moved && Math.hypot(drag.x - drag.x0, drag.y - drag.y0) > 6) drag.moved = true;
    if (drag.moved) drawWires(app, app.main);
  };
  const up = (ev) => {
    document.removeEventListener("pointermove", move);
    document.removeEventListener("pointerup", up);
    const d = drag;
    drag = null;
    if (!d || !d.moved) return;
    suppressClick = true;
    setTimeout(() => {
      suppressClick = false;
    }, 0);
    const target = document.elementFromPoint(ev.clientX, ev.clientY);
    const port = target && target.closest(".port");
    if (port && port.dataset.side && port.dataset.side !== SIDES[d.side]) {
      const other = SIDES.indexOf(port.dataset.side);
      const panel = s.panels[other];
      s.sel[d.side] = d.slot;
      s.sel[other] = { deviceId: panel.deviceId, port: Number(port.dataset.port), face: panel.face };
    }
    app.render();
  };
  document.addEventListener("pointermove", move);
  document.addEventListener("pointerup", up);
}

let resizeBound = false;

export function mounted(app, root) {
  for (const el of root.querySelectorAll(".panel-rack .rack-dev.selected")) {
    const box = el.closest(".panel-rack");
    if (el.offsetTop < box.scrollTop || el.offsetTop + el.offsetHeight > box.scrollTop + box.clientHeight) {
      box.scrollTop = Math.max(0, el.offsetTop - box.clientHeight / 3);
    }
  }
  drawWires(app, root);
  if (!resizeBound) {
    resizeBound = true;
    window.addEventListener("resize", () => {
      if (app.viewKey() === "connect") drawWires(app, app.main);
    });
  }
}

export function keydown(app, e, typing) {
  if (e.key !== "Escape" || typing) return;
  const s = app.viewState("connect", () => ({}));
  if (s.sel && (s.sel[0] || s.sel[1])) {
    s.sel = [null, null];
    app.render();
  }
}
