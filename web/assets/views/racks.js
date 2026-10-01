// Racks: rooms and the racks in them. An empty project starts with a small layout form.

import { h, icon, field, numberInput, textInput, confirmDialog, plural } from "../ui.js";
import * as model from "../model.js";

function emptyState(app) {
  const form = app.viewState("racks-new", () => ({ rooms: 1, racksPerRoom: 4, rackHeight: 42 }));
  const create = () => app.act((p) => model.createLayout(p, form));
  return h("div", { class: "view" },
    h("div", { class: "view-head" }, h("h1", {}, "Racks")),
    h("div", { class: "card start-card" },
      h("div", { class: "form-row" },
        field("Rooms", numberInput({ value: form.rooms, min: 1, max: 200, id: "new-rooms", onCommit: (v) => { form.rooms = v; } })),
        field("Racks per room", numberInput({ value: form.racksPerRoom, min: 1, max: 200, id: "new-racks", onCommit: (v) => { form.racksPerRoom = v; } })),
        field("Rack height", numberInput({ value: form.rackHeight, min: 1, max: 60, id: "new-height", onCommit: (v) => { form.rackHeight = v; } })),
      ),
      h("div", { class: "form-actions" },
        h("button", { class: "btn primary", id: "create-layout", onclick: create }, "Create"),
        h("button", { class: "btn", id: "load-sample", onclick: () => app.loadSample() }, "Load sample"),
      ),
    ),
  );
}

/** A thin elevation of a rack: one bar per device. */
function thumb(rack, devices) {
  const el = h("div", { class: "rack-thumb", style: { "--units": rack.units } });
  for (const d of devices) {
    el.append(h("div", {
      class: `thumb-dev t-${d.type}`,
      style: { gridRow: `${rack.units - d.u + 1} / span ${d.height}` },
    }));
  }
  return el;
}

async function removeRack(app, rack) {
  const impact = model.rackDeleteImpact(app.project, rack.id);
  const ok = await confirmDialog(
    `Delete rack ${rack.code}, its ${plural(impact.devices, "device")} and ${plural(impact.cables, "cable")}?`,
    { ok: "Delete", danger: true },
  );
  if (ok) app.act((p) => model.deleteRack(p, rack.id));
}

async function removeRoom(app, room) {
  const impact = model.roomDeleteImpact(app.project, room.id);
  const ok = await confirmDialog(
    `Delete room ${room.code}, its ${plural(impact.racks, "rack")}, ${plural(impact.devices, "device")} and ${plural(impact.cables, "cable")}?`,
    { ok: "Delete", danger: true },
  );
  if (ok) app.act((p) => model.deleteRoom(p, room.id));
}

function rackCard(app, rack, ix) {
  const devices = ix.devicesByRack.get(rack.id) || [];
  const cables = new Set();
  for (const d of devices) for (const c of ix.cablesByDevice.get(d.id) || []) cables.add(c.id);
  const open = () => {
    app.viewState("devices", () => ({})).rackId = rack.id;
    app.navigate("devices");
  };
  return h("div", { class: "card rack-card" },
    h("button", { class: "thumb-btn", title: `Open ${rack.code}`, "aria-label": `Open ${rack.code}`, onclick: open }, thumb(rack, devices)),
    h("div", { class: "rack-card-body" },
      h("div", { class: "rack-card-row" },
        textInput({
          value: rack.code,
          className: "input code-input",
          id: `rack-code-${rack.id}`,
          label: "Rack code",
          maxLength: 16,
          onCommit: (v) => app.act((p) => model.updateRack(p, rack.id, { code: v })),
        }),
        h("button", { class: "icon-btn", title: "Delete rack", "aria-label": `Delete rack ${rack.code}`, onclick: () => removeRack(app, rack) }, icon("trash", 16)),
      ),
      h("div", { class: "rack-card-row" },
        numberInput({
          value: rack.units,
          min: 1,
          max: 60,
          className: "input num small-num",
          id: `rack-units-${rack.id}`,
          label: "Rack height",
          onCommit: (v) => app.act((p) => model.updateRack(p, rack.id, { units: v })),
        }),
        h("span", { class: "muted" }, "U"),
      ),
      h("div", { class: "muted small" }, `${plural(devices.length, "device")} · ${plural(cables.size, "cable")}`),
    ),
  );
}

function roomSection(app, room, ix) {
  const racks = ix.racksByRoom.get(room.id) || [];
  return h("section", { class: "room" },
    h("div", { class: "room-head" },
      textInput({
        value: room.code,
        className: "input code-input room-code",
        id: `room-code-${room.id}`,
        label: "Room code",
        maxLength: 16,
        onCommit: (v) => app.act((p) => model.updateRoom(p, room.id, { code: v })),
      }),
      textInput({
        value: room.name,
        className: "input room-name",
        placeholder: "Name",
        id: `room-name-${room.id}`,
        label: "Room name",
        maxLength: 100,
        onCommit: (v) => app.act((p) => model.updateRoom(p, room.id, { name: v })),
      }),
      h("div", { class: "spacer" }),
      h("button", { class: "btn small", onclick: () => app.act((p) => model.addRack(p, room.id)) }, icon("plus", 14), "Rack"),
      h("button", { class: "icon-btn", title: "Delete room", "aria-label": `Delete room ${room.code}`, onclick: () => removeRoom(app, room) }, icon("trash", 16)),
    ),
    h("div", { class: "rack-grid" }, racks.map((r) => rackCard(app, r, ix))),
  );
}

export function render(app) {
  const p = app.project;
  if (p.rooms.length === 0) return emptyState(app);
  const ix = app.index();
  return h("div", { class: "view" },
    h("div", { class: "view-head" },
      h("h1", {}, "Racks"),
      h("div", { class: "spacer" }),
      h("button", { class: "btn", onclick: () => app.act((p2) => model.addRoom(p2)) }, icon("plus", 16), "Room"),
    ),
    p.rooms.map((room) => roomSection(app, room, ix)),
  );
}
