// Devices: one rack at a time, its elevation on the left and the device form on the right.

import { h, icon, field, numberInput, textInput, select, checkbox, confirmDialog, toast, plural } from "../ui.js";
import * as model from "../model.js";

const TYPE_OPTIONS = model.DEVICE_TYPES.map((t) => ({ value: t.key, label: t.name }));

function defaults(type = "patch-panel") {
  const t = model.deviceType(type);
  return { type, name: "", height: t.height, ports: t.ports, passThrough: t.passThrough, count: 1 };
}

function state(app) {
  const s = app.viewState("devices", () => ({}));
  if (!s.form) s.form = defaults();
  if (!app.project.racks.some((r) => r.id === s.rackId)) s.rackId = app.project.racks[0] ? app.project.racks[0].id : "";
  if (s.selectedId && !app.project.devices.some((d) => d.id === s.selectedId)) s.selectedId = "";
  return s;
}

/** Rack chips, grouped by room when there is more than one room. */
export function rackChips(app, currentId, onPick) {
  const ix = app.index();
  const several = app.project.rooms.length > 1;
  return h("div", { class: "chips", role: "tablist", "aria-label": "Racks" },
    app.project.rooms.map((room) => {
      const racks = ix.racksByRoom.get(room.id) || [];
      if (racks.length === 0) return null;
      return h("div", { class: "chip-group" },
        several ? h("span", { class: "chip-room" }, room.code) : null,
        racks.map((r) => h("button", {
          class: r.id === currentId ? "chip active" : "chip",
          role: "tab",
          "aria-selected": String(r.id === currentId),
          onclick: () => onPick(r.id),
        }, r.code)));
    }));
}

/**
 * Rack elevation: unit rows numbered from the bottom, highest at the top, each device a block of
 * its own height. Options: compact, selectedId, onDevice(device), onUnit(u), placeAt.
 */
export function rackElevation(app, rack, { compact = false, selectedId = "", onDevice, onUnit, placeAt = 0 } = {}) {
  const ix = app.index();
  const devices = ix.devicesByRack.get(rack.id) || [];
  const covered = new Set();
  for (const d of devices) for (let u = d.u - d.height + 1; u <= d.u; u++) covered.add(u);
  const grid = h("div", { class: compact ? "rack compact" : "rack", style: { "--units": rack.units } });
  for (let u = rack.units; u >= 1; u--) {
    const row = String(rack.units - u + 1);
    grid.append(h("div", { class: "rack-u", style: { gridRow: row } }, String(u)));
    if (covered.has(u)) continue;
    if (onUnit) {
      grid.append(h("button", {
        class: placeAt === u ? "rack-slot target" : "rack-slot",
        style: { gridRow: row },
        title: `U${u}`,
        "aria-label": `Empty unit ${u}`,
        dataset: { u: String(u) },
        onclick: () => onUnit(u),
      }));
    } else {
      grid.append(h("div", { class: "rack-slot", style: { gridRow: row } }));
    }
  }
  for (const d of devices) {
    const t = model.deviceType(d.type);
    const text = compact ? `U${d.u} ${t.name}` : `U${d.u} · ${t.name} · ${plural(d.ports, "port")}`;
    const cls = ["rack-dev", `t-${d.type}`, d.height > 1 ? "tall" : "", d.id === selectedId ? "selected" : ""].filter(Boolean).join(" ");
    grid.append(h("button", {
      class: cls,
      style: { gridRow: `${rack.units - d.u + 1} / span ${d.height}` },
      dataset: { device: d.id, u: String(d.u) },
      title: `${model.deviceAddress(ix, d)} · ${t.name}${d.name ? ` · ${d.name}` : ""}`,
      onclick: () => onDevice && onDevice(d),
    },
    h("span", { class: "dev-text" }, text),
    d.name ? h("span", { class: "dev-name" }, d.name) : null));
  }
  return grid;
}

function addForm(app, s, rack) {
  const f = s.form;
  const add = () => {
    const spec = { type: f.type, name: f.name, height: f.height, ports: f.ports, passThrough: f.passThrough };
    const result = app.act((p) => model.addDevices(p, rack.id, spec, f.count, s.placeAt || 0));
    if (!result) return;
    s.placeAt = 0;
    app.render();
    if (result.message) toast(result.message, { kind: "error" });
  };
  return h("div", { class: "card side-form" },
    h("h2", {}, "Add device"),
    field("Type", select(TYPE_OPTIONS, f.type, (v) => {
      s.form = { ...defaults(v), name: f.name, count: f.count };
      app.render();
    }, { id: "add-type" })),
    field("Name", textInput({ value: f.name, id: "add-name", maxLength: 100, onCommit: (v) => { f.name = v; } })),
    h("div", { class: "form-row" },
      field("Height (U)", numberInput({ value: f.height, min: 1, max: rack.units, id: "add-height", onCommit: (v) => { f.height = v; } })),
      field("Ports", numberInput({ value: f.ports, min: 1, max: 288, id: "add-ports", onCommit: (v) => { f.ports = v; } })),
    ),
    checkbox("Front and rear ports", f.passThrough, (v) => { f.passThrough = v; }, { id: "add-rear" }),
    h("div", { class: "form-row" },
      field("Count", numberInput({ value: f.count, min: 1, max: 60, id: "add-count", onCommit: (v) => { f.count = v; } })),
    ),
    h("div", { class: "form-actions" },
      s.placeAt ? h("span", { class: "place-badge" },
        `Place at U${s.placeAt}`,
        h("button", { class: "icon-btn tiny", title: "Clear", "aria-label": "Clear", onclick: () => { s.placeAt = 0; app.render(); } }, icon("close", 12)),
      ) : null,
      h("div", { class: "spacer" }),
      h("button", { class: "btn primary", id: "add-device", onclick: add }, "Add"),
    ),
  );
}

function moveToRack(app, d, rackId) {
  const p = app.project;
  const target = p.racks.find((r) => r.id === rackId);
  app.act((proj) => {
    let u = d.u;
    const free = model.highestFreeTop(proj, rackId, d.height, d.id);
    if (u > target.units || !fitsAt(proj, rackId, d, u)) u = free;
    if (!u) throw new model.ModelError(`No free space for a ${d.height}U device in ${target.code}`);
    return model.updateDevice(proj, d.id, { rackId, u });
  });
}

function fitsAt(p, rackId, d, u) {
  const top = u;
  const bottom = u - d.height + 1;
  if (bottom < 1) return false;
  return !p.devices.some((x) => x.rackId === rackId && x.id !== d.id && x.u - x.height + 1 <= top && x.u >= bottom);
}

function portNamesEditor(app, d) {
  const names = d.portNames || {};
  const commit = (port, value) => {
    const next = { ...names };
    if (value.trim() === "") delete next[String(port)];
    else next[String(port)] = value;
    app.act((p) => model.updateDevice(p, d.id, { portNames: next }));
  };
  const count = Object.keys(names).length;
  return h("details", { class: "port-names", open: count > 0 || undefined },
    h("summary", {}, "Port names", count ? h("span", { class: "muted" }, ` ${count}`) : null),
    h("div", { class: "port-name-grid" },
      Array.from({ length: d.ports }, (_, i) => {
        const port = i + 1;
        return h("label", { class: "port-name" },
          h("span", { class: "muted" }, String(port)),
          textInput({
            value: names[String(port)] || "",
            className: "input",
            placeholder: String(port),
            id: `port-name-${d.id}-${port}`,
            maxLength: 32,
            label: `Port ${port} name`,
            onCommit: (v) => commit(port, v),
          }));
      })));
}

function editForm(app, s, d) {
  const ix = app.index();
  const update = (patch) => app.act((p) => model.updateDevice(p, d.id, patch));
  const racks = app.project.racks.map((r) => {
    const room = ix.rooms.get(r.roomId);
    return { value: r.id, label: app.project.rooms.length > 1 && room ? `${room.code} · ${r.code}` : r.code };
  });
  const cables = (ix.cablesByDevice.get(d.id) || []).length;
  const remove = async () => {
    const message = cables ? `Delete this device and its ${plural(cables, "cable")}?` : "Delete this device?";
    if (await confirmDialog(message, { ok: "Delete", danger: true })) {
      s.selectedId = "";
      app.act((p) => model.deleteDevice(p, d.id));
    }
  };
  const duplicate = () => {
    const copy = app.act((p) => model.duplicateDevice(p, d.id));
    if (copy) {
      s.selectedId = copy.id;
      app.render();
    }
  };
  return h("div", { class: "card side-form" },
    h("div", { class: "side-head" },
      h("h2", {}, model.deviceAddress(ix, d)),
      h("div", { class: "spacer" }),
      h("button", { class: "icon-btn", title: "Close", "aria-label": "Close", onclick: () => { s.selectedId = ""; app.render(); } }, icon("close", 16)),
    ),
    field("Type", select(TYPE_OPTIONS, d.type, (v) => update({ type: v }), { id: "edit-type" })),
    field("Name", textInput({ value: d.name, id: "edit-name", maxLength: 100, onCommit: (v) => update({ name: v }) })),
    h("div", { class: "form-row" },
      field("Height (U)", numberInput({ value: d.height, min: 1, max: 60, id: "edit-height", onCommit: (v) => update({ height: v }) })),
      field("Ports", numberInput({ value: d.ports, min: 1, max: 288, id: "edit-ports", onCommit: (v) => update({ ports: v }) })),
    ),
    checkbox("Front and rear ports", d.passThrough, (v) => update({ passThrough: v }), { id: "edit-rear" }),
    h("div", { class: "form-row" },
      field("Rack", select(racks, d.rackId, (v) => moveToRack(app, d, v), { id: "edit-rack" })),
      field("Top unit", numberInput({ value: d.u, min: 1, max: 60, id: "edit-u", onCommit: (v) => update({ u: v }) })),
    ),
    portNamesEditor(app, d),
    h("div", { class: "form-actions" },
      h("button", { class: "btn", id: "duplicate-device", onclick: duplicate }, icon("copy", 15), "Duplicate"),
      h("div", { class: "spacer" }),
      h("button", { class: "btn danger-ghost", id: "delete-device", onclick: remove }, icon("trash", 15), "Delete"),
    ),
  );
}

export function render(app) {
  const s = state(app);
  const p = app.project;
  const head = h("div", { class: "view-head" }, h("h1", {}, "Devices"));
  if (p.racks.length === 0) {
    return h("div", { class: "view" }, head,
      h("div", { class: "card empty" }, h("button", { class: "btn primary", onclick: () => app.navigate("racks") }, "Racks")));
  }
  const rack = p.racks.find((r) => r.id === s.rackId);
  const selected = p.devices.find((d) => d.id === s.selectedId && d.rackId === rack.id);
  const elevation = rackElevation(app, rack, {
    selectedId: selected ? selected.id : "",
    placeAt: s.placeAt || 0,
    onDevice: (d) => {
      s.selectedId = d.id;
      s.placeAt = 0;
      app.render();
    },
    onUnit: (u) => {
      s.selectedId = "";
      s.placeAt = s.placeAt === u ? 0 : u;
      app.render();
    },
  });
  return h("div", { class: "view devices-view" },
    head,
    rackChips(app, rack.id, (id) => {
      s.rackId = id;
      s.selectedId = "";
      s.placeAt = 0;
      app.render();
    }),
    h("div", { class: "devices-body" },
      h("div", { class: "card rack-card-large" }, h("div", { class: "rack-title" }, rack.code, h("span", { class: "muted" }, ` ${rack.units}U`)), elevation),
      selected ? editForm(app, s, selected) : addForm(app, s, rack),
    ),
  );
}

export function keydown(app, e, typing) {
  if (e.key !== "Escape" || typing) return;
  const s = state(app);
  if (s.selectedId || s.placeAt) {
    s.selectedId = "";
    s.placeAt = 0;
    app.render();
  }
}
