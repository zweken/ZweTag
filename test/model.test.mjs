// Rules of the project model (web/assets/model.js).
import { test } from "node:test";
import assert from "node:assert/strict";

import * as m from "../web/assets/model.js";

function project({ rooms = 1, racks = 2, height = 42 } = {}) {
  const p = m.newProject("Test");
  m.createLayout(p, { rooms, racksPerRoom: racks, rackHeight: height });
  return p;
}

function rack(p, code) {
  return p.racks.find((r) => r.code === code);
}

function add(p, rackCode, type, opts = {}) {
  return m.addDevices(p, rack(p, rackCode).id, { type, ...opts }, opts.count ?? 1, opts.top ?? 0);
}

function end(device, port, face = "front") {
  return { deviceId: device.id, port, face };
}

function state(p, cable) {
  return m.labelState(p, m.indexProject(p), cable);
}

test("layout: default room and rack codes", () => {
  const p = project({ rooms: 2, racks: 3 });
  assert.deepEqual(p.rooms.map((r) => r.code), ["SR1", "SR2"]);
  assert.deepEqual(p.racks.map((r) => r.code), ["A01", "A02", "A03", "B01", "B02", "B03"]);
  assert.ok(p.racks.every((r) => r.units === 42));
  assert.deepEqual(p.racks.map((r) => r.id), ["rack-1", "rack-2", "rack-3", "rack-4", "rack-5", "rack-6"]);
});

test("rack codes are unique in the whole project, ignoring case", () => {
  const p = project({ rooms: 2, racks: 1 });
  assert.throws(() => m.addRack(p, p.rooms[1].id, { code: "a01" }), /Rack a01 already exists/);
  assert.throws(() => m.updateRack(p, rack(p, "B01").id, { code: " A 01 " }), /Rack A01 already exists/);
  assert.throws(() => m.addRack(p, p.rooms[0].id, { code: "  " }), /cannot be empty/);
  assert.equal(m.updateRack(p, rack(p, "B01").id, { code: " C 7 " }).code, "C7", "codes are stored cleaned");
  assert.throws(() => m.addRoom(p, { code: "sr1" }), /Room sr1 already exists/);
});

test("rack height is 1 to 60 units", () => {
  const p = project({ racks: 1 });
  assert.throws(() => m.addRack(p, p.rooms[0].id, { units: 61 }), /Rack height/);
  assert.throws(() => m.addRack(p, p.rooms[0].id, { units: 0 }), /Rack height/);
  assert.equal(m.addRack(p, p.rooms[0].id, { units: 60 }).units, 60);
});

test("device types bring their defaults", () => {
  const p = project({ racks: 1 });
  for (const t of m.DEVICE_TYPES) {
    const d = add(p, "A01", t.key).devices[0];
    assert.equal(d.height, t.height, t.key);
    assert.equal(d.ports, t.ports, t.key);
    assert.equal(d.passThrough, t.passThrough, t.key);
  }
});

test("automatic placement takes the highest free space", () => {
  const p = project({ racks: 1 });
  assert.equal(add(p, "A01", "patch-panel").devices[0].u, 42);
  assert.equal(add(p, "A01", "switch").devices[0].u, 41);
  const server = add(p, "A01", "server").devices[0];
  assert.equal(server.u, 40, "a 2U device at U40 covers U39 and U40");
  assert.equal(add(p, "A01", "switch", { top: 20 }).devices[0].u, 20, "chosen unit");
  assert.equal(add(p, "A01", "storage").devices[0].u, 38);
});

test("a device needs a free space inside the rack", () => {
  const p = project({ racks: 1, height: 10 });
  add(p, "A01", "switch", { top: 5 });
  assert.throws(() => add(p, "A01", "server", { top: 6 }), /No free space for a 2U device in A01/, "overlaps U5");
  assert.throws(() => add(p, "A01", "server", { top: 11 }), /No free space/, "above the rack");
  assert.throws(() => add(p, "A01", "server", { top: 1 }), /No free space/, "below the rack");
  assert.equal(add(p, "A01", "server", { top: 7 }).devices[0].u, 7);
});

test("moving a device cannot overlap another device", () => {
  const p = project({ racks: 1 });
  const a = add(p, "A01", "switch").devices[0];
  const b = add(p, "A01", "server").devices[0];
  assert.equal(b.u, 41);
  assert.throws(() => m.updateDevice(p, b.id, { u: 42 }), /No free space for a 2U device at U42 in A01/);
  assert.throws(() => m.updateDevice(p, a.id, { height: 2 }), /No free space/, "growing into the server");
  assert.equal(m.updateDevice(p, b.id, { u: 30 }).u, 30);
});

test("adding N devices stops when the rack is full and keeps the ones placed", () => {
  const p = project({ racks: 1, height: 7 });
  const r = add(p, "A01", "server", { count: 5 });
  assert.equal(r.devices.length, 3);
  assert.deepEqual(r.devices.map((d) => d.u), [7, 5, 3]);
  assert.equal(r.message, "No free space for a 2U device in A01");
  assert.equal(p.devices.length, 3);
  assert.throws(() => add(p, "A01", "server"), /No free space for a 2U device in A01/);
});

test("adding N devices from a chosen unit stacks them downwards", () => {
  const p = project({ racks: 1 });
  const r = add(p, "A01", "server", { count: 3, top: 30, name: "SRV-09" });
  assert.deepEqual(r.devices.map((d) => d.u), [30, 28, 26]);
  assert.deepEqual(r.devices.map((d) => d.name), ["SRV-09", "SRV-10", "SRV-11"]);
  assert.equal(r.message, null);
});

test("ports are 1 to 288", () => {
  const p = project({ racks: 1 });
  assert.throws(() => add(p, "A01", "switch", { ports: 289 }), /Ports/);
  assert.throws(() => add(p, "A01", "switch", { ports: 0 }), /Ports/);
  assert.equal(add(p, "A01", "switch", { ports: 288 }).devices[0].ports, 288);
});

test("bulk connect 24 ports between two devices in one rack", () => {
  const p = project({ racks: 1 });
  const panel = add(p, "A01", "patch-panel").devices[0];
  const sw = add(p, "A01", "switch").devices[0];
  const cables = m.connect(p, end(panel, 1), end(sw, 1), 24, { media: "cat6", lengthM: 0.5 });
  assert.equal(cables.length, 24);
  assert.equal(cables[0].code, "C0001");
  assert.equal(cables[23].code, "C0024");
  const ix = m.indexProject(p);
  assert.equal(m.currentTag(p, ix, cables[0]), "A01-42:01 / A01-41:01");
  assert.equal(m.currentTag(p, ix, cables[23]), "A01-42:24 / A01-41:24");
  assert.equal(cables[5].lengthM, 0.5);
});

test("bulk connect is all or nothing and names the first taken slot", () => {
  const p = project({ racks: 2 });
  const panel = add(p, "A01", "patch-panel").devices[0];
  const sw = add(p, "A02", "switch", { top: 38 }).devices[0];
  m.connect(p, end(panel, 14), end(sw, 40));
  assert.throws(() => m.connect(p, end(panel, 1), end(sw, 1), 24), /Port 14 on A01-42 is in use/);
  assert.equal(p.cables.length, 1, "nothing was added");
  assert.throws(() => m.connect(p, end(sw, 30), end(panel, 20), 10), /Port 25 does not exist on A01-42/);
  assert.equal(p.cables.length, 1);
  assert.equal(m.connectProblem(p, end(panel, 1), end(sw, 30), 11), "Port 40 on A02-38 is in use");
  assert.equal(m.connectProblem(p, end(panel, 1), end(sw, 1), 13), "");
});

test("a bulk connection cannot use the same port twice", () => {
  const p = project({ racks: 1 });
  const sw = add(p, "A01", "switch").devices[0];
  assert.throws(() => m.connect(p, end(sw, 1), end(sw, 1)), /cannot connect a port to itself/);
  assert.throws(() => m.connect(p, end(sw, 1), end(sw, 5), 8), /Port 5 on A01-42 is in use/);
  assert.equal(p.cables.length, 0);
});

test("rear ports exist only on pass-through devices", () => {
  const p = project({ racks: 2 });
  const panelA = add(p, "A01", "patch-panel").devices[0];
  const panelB = add(p, "A02", "patch-panel").devices[0];
  const sw = add(p, "A01", "switch").devices[0];
  assert.throws(() => m.connect(p, end(sw, 1, "rear"), end(panelA, 1, "rear")), /A01-41 has no rear ports/);
  const rear = m.connect(p, end(panelA, 1, "rear"), end(panelB, 1, "rear"), 4);
  assert.equal(rear.length, 4);
  m.connect(p, end(panelA, 1, "front"), end(sw, 1));
  assert.throws(() => m.connect(p, end(panelA, 2, "rear"), end(sw, 2)), /Rear port 2 on A01-42 is in use/);
  assert.throws(() => m.updateDevice(p, panelA.id, { passThrough: false }), /Rear ports have cables/);
});

test("cascade delete: device, rack, room", () => {
  const p = project({ rooms: 2, racks: 1 });
  const a = add(p, "A01", "patch-panel").devices[0];
  const b = add(p, "A01", "switch").devices[0];
  const c = add(p, "B01", "switch").devices[0];
  m.connect(p, end(a, 1), end(b, 1), 3);
  m.connect(p, end(b, 10), end(c, 10), 2);
  assert.deepEqual(m.deviceDeleteImpact(p, b.id), { cables: 5 });
  assert.deepEqual(m.rackDeleteImpact(p, rack(p, "A01").id), { devices: 2, cables: 5 });
  m.deleteDevice(p, b.id);
  assert.equal(p.cables.length, 0);
  m.connect(p, end(a, 1), end(c, 1));
  m.deleteRack(p, rack(p, "A01").id);
  assert.deepEqual(p.devices.map((d) => d.id), [c.id]);
  assert.equal(p.cables.length, 0);
  m.deleteRoom(p, p.rooms[1].id);
  assert.equal(p.racks.length, 0);
  assert.equal(p.devices.length, 0);
});

test("fewer ports than a cabled port is refused", () => {
  const p = project({ racks: 1 });
  const sw = add(p, "A01", "switch").devices[0];
  const panel = add(p, "A01", "patch-panel").devices[0];
  m.connect(p, end(sw, 30), end(panel, 3));
  assert.throws(() => m.updateDevice(p, sw.id, { ports: 24 }), /Port 30 has a cable/);
  assert.equal(m.updateDevice(p, sw.id, { ports: 30 }).ports, 30);
});

test("cable codes and ids are never used again", () => {
  const p = project({ racks: 1 });
  const sw = add(p, "A01", "switch").devices[0];
  const panel = add(p, "A01", "patch-panel").devices[0];
  const first = m.connect(p, end(sw, 1), end(panel, 1), 2);
  m.deleteCables(p, first.map((c) => c.id));
  const next = m.connect(p, end(sw, 1), end(panel, 1))[0];
  assert.equal(next.code, "C0003");
  assert.equal(next.id, "cab-3");
  m.deleteDevice(p, sw.id);
  assert.equal(add(p, "A01", "switch").devices[0].id, "dev-3");
  m.updateSettings(p, { cablePrefix: "PC" });
  assert.equal(m.connect(p, end(panel, 5), end(panel, 6))[0].code, "PC0004");
});

test("label state: unlabeled, labeled, relabel after a move", () => {
  const p = project({ racks: 2 });
  const panel = add(p, "A01", "patch-panel").devices[0];
  const sw = add(p, "A01", "switch").devices[0];
  const [c] = m.connect(p, end(panel, 12), end(sw, 12));
  assert.equal(state(p, c), "unlabeled");
  m.setLabeled(p, [c.id], true);
  assert.equal(c.taggedAs, "A01-42:12 / A01-41:12");
  assert.equal(state(p, c), "labeled");
  m.updateDevice(p, sw.id, { u: 30 });
  assert.equal(state(p, c), "relabel", "moved within the rack");
  m.setLabeled(p, [c.id], true);
  m.updateDevice(p, sw.id, { rackId: rack(p, "A02").id });
  assert.equal(state(p, c), "relabel", "moved to another rack");
  m.setLabeled(p, [c.id], true);
  m.updateRack(p, rack(p, "A01").id, { code: "R1" });
  assert.equal(state(p, c), "relabel", "rack code changed");
  m.setLabeled(p, [c.id], true);
  m.updateDevice(p, panel.id, { portNames: { 12: "X12" } });
  assert.equal(state(p, c), "relabel", "port renamed");
  m.setLabeled(p, [c.id], false);
  assert.equal(state(p, c), "unlabeled");
});

test("room prefix follows the setting", () => {
  const p = project({ rooms: 2, racks: 1 });
  const a = add(p, "A01", "switch").devices[0];
  const b = add(p, "B01", "switch").devices[0];
  const [c] = m.connect(p, end(a, 1), end(b, 1));
  const ix = m.indexProject(p);
  assert.equal(m.currentTag(p, ix, c), "SR1.A01-42:01 / SR2.B01-42:01");
  m.updateSettings(p, { roomPrefix: "never" });
  assert.equal(m.currentTag(p, ix, c), "A01-42:01 / B01-42:01");
});

test("port names are used in tags and must stay distinguishable", () => {
  const p = project({ racks: 1 });
  const server = add(p, "A01", "server").devices[0];
  m.updateDevice(p, server.id, { portNames: { 4: "iLO" } });
  const sw = add(p, "A01", "switch").devices[0];
  const [c] = m.connect(p, end(server, 4), end(sw, 7));
  assert.equal(m.currentTag(p, m.indexProject(p), c), "A01-42:iLO / A01-40:07");
  assert.throws(() => m.updateDevice(p, server.id, { portNames: { 1: "2" } }), /Ports 1 and 2 would get the same label/);
  assert.throws(() => m.updateDevice(p, server.id, { portNames: { 9: "x" } }), /Port 9 does not exist/);
});

test("limits: 200 racks", () => {
  const p = project({ rooms: 1, racks: 200 });
  assert.equal(p.racks.length, 200);
  assert.throws(() => m.addRack(p, p.rooms[0].id), /at most 200 racks/);
  assert.throws(() => m.createLayout(m.newProject(), { rooms: 2, racksPerRoom: 101 }), /at most 200 racks/);
});

test("limits: 20000 cables", () => {
  const p = project({ racks: 1 });
  const sw = add(p, "A01", "switch").devices[0];
  const panel = add(p, "A01", "patch-panel").devices[0];
  for (let i = 0; i < m.LIMITS.cables; i++) p.cables.push({ id: `x-${i}` });
  assert.throws(() => m.connect(p, end(sw, 1), end(panel, 1)), /at most 20000 cables/);
});

test("duplicate places the copy directly below", () => {
  const p = project({ racks: 1 });
  const s = add(p, "A01", "server", { top: 30, name: "DB-1" }).devices[0];
  m.updateDevice(p, s.id, { portNames: { 4: "iLO" } });
  const copy = m.duplicateDevice(p, s.id);
  assert.equal(copy.u, 28);
  assert.equal(copy.name, "DB-2");
  assert.deepEqual(copy.portNames, { 4: "iLO" });
});

// ---------------------------------------------------------------------------------------------
// Loading files

function validFile() {
  const p = project({ rooms: 1, racks: 2 });
  const panel = add(p, "A01", "patch-panel").devices[0];
  const sw = add(p, "A01", "switch").devices[0];
  const panel2 = add(p, "A02", "patch-panel").devices[0];
  m.connect(p, end(panel, 1), end(sw, 1), 2);
  m.connect(p, end(panel, 1, "rear"), end(panel2, 1, "rear"));
  return JSON.parse(JSON.stringify(p));
}

test("a valid file loads unchanged", () => {
  const f = validFile();
  assert.deepEqual(m.validateProject(f), f);
  assert.deepEqual(m.parseProject(m.serializeProject(f)), f);
});

const broken = [
  ["not JSON", null, /not valid JSON/],
  ["wrong format", (f) => { f.format = "other"; }, /not a ZweTag project file/],
  ["newer version", (f) => { f.version = 2; }, /newer version of ZweTag/],
  ["missing list", (f) => { delete f.cables; }, /no cables list/],
  ["rack without room", (f) => { f.racks[0].roomId = "room-9"; }, /Rack A01: its room room-9 does not exist/],
  ["duplicate rack code", (f) => { f.racks[1].code = "a01"; }, /Rack a01 already exists/],
  ["device without rack", (f) => { f.devices[0].rackId = "rack-9"; }, /Device dev-1: its rack rack-9 does not exist/],
  ["device outside rack", (f) => { f.devices[0].u = 43; }, /Device dev-1: U43 is outside rack A01/],
  ["overlap", (f) => { f.devices[1].u = 42; }, /Device dev-2 overlaps device dev-1 in A01 at U42/],
  ["unknown device type", (f) => { f.devices[0].type = "toaster"; }, /unknown type toaster/],
  ["cable to missing device", (f) => { f.cables[0].b.deviceId = "dev-9"; }, /Cable C0001: device dev-9 does not exist/],
  ["port out of range", (f) => { f.cables[0].b.port = 49; }, /Cable C0001: Port 49 does not exist on A01-41/],
  ["rear face on a switch", (f) => { f.cables[0].b.face = "rear"; }, /Cable C0001: A01-41 has no rear ports/],
  ["unknown face", (f) => { f.cables[0].b.face = "side"; }, /Cable C0001: Unknown port face/],
  ["port used twice", (f) => { f.cables[1].a.port = 1; }, /Cable C0002: Port 1 on A01-42 is also used by C0001/],
  ["cable to itself", (f) => { f.cables[0].b = { ...f.cables[0].a }; }, /Cable C0001: Port 1 on A01-42 is also used by C0001/],
  ["duplicate cable code", (f) => { f.cables[1].code = "C0001"; }, /Cable code C0001 is used twice/],
  ["duplicate id", (f) => { f.cables[1].id = "dev-1"; }, /The id dev-1 is used twice/],
  ["unknown cable type", (f) => { f.cables[0].media = "string"; }, /unknown cable type string/],
];

for (const [name, mutate, message] of broken) {
  test(`file check: ${name}`, () => {
    if (mutate === null) {
      assert.throws(() => m.parseProject("{not json"), message);
      return;
    }
    const f = validFile();
    mutate(f);
    assert.throws(() => m.validateProject(f), (e) => e instanceof m.ModelError && message.test(e.message));
  });
}

test("file check: counters never go back", () => {
  const f = validFile();
  f.settings.seq = { room: 1, rack: 1, dev: 1, cab: 1 };
  f.settings.nextCableNumber = 1;
  const p = m.validateProject(f);
  assert.deepEqual(p.settings.seq, { room: 2, rack: 3, dev: 4, cab: 4 });
  assert.equal(p.settings.nextCableNumber, 4);
});

// ---------------------------------------------------------------------------------------------
// Undo and redo

test("undo and redo", () => {
  const h = new m.History(m.newProject(), 50);
  h.apply((p) => m.createLayout(p, { rooms: 1, racksPerRoom: 2 }));
  h.apply((p) => m.addDevices(p, p.racks[0].id, { type: "switch" }));
  assert.equal(h.project.devices.length, 1);
  assert.ok(h.undo());
  assert.equal(h.project.devices.length, 0);
  assert.ok(h.undo());
  assert.equal(h.project.racks.length, 0);
  assert.equal(h.undo(), false);
  assert.ok(h.redo());
  assert.ok(h.redo());
  assert.equal(h.project.devices.length, 1);
  assert.equal(h.redo(), false);
  h.undo();
  h.apply((p) => m.addDevices(p, p.racks[1].id, { type: "server" }));
  assert.equal(h.canRedo, false, "a new change drops the redo steps");
});

test("undo keeps 50 steps", () => {
  const h = new m.History(m.newProject(), 50);
  h.apply((p) => m.createLayout(p, { rooms: 1, racksPerRoom: 1 }));
  for (let i = 0; i < 60; i++) h.apply((p) => m.setProjectName(p, `Name ${i}`));
  let steps = 0;
  while (h.undo()) steps++;
  assert.equal(steps, 50);
  assert.equal(h.project.name, "Name 9");
});

test("a failed change is rolled back and records no step", () => {
  const h = new m.History(m.newProject(), 50);
  h.apply((p) => m.createLayout(p, { rooms: 1, racksPerRoom: 1, rackHeight: 3 }));
  assert.throws(() => h.apply((p) => {
    m.addDevices(p, p.racks[0].id, { type: "switch" });
    m.addDevices(p, p.racks[0].id, { type: "toaster" });
  }), /Unknown device type/);
  assert.equal(h.project.devices.length, 0);
  assert.equal(h.index, 1);
});

test("theme and label layout are not undo steps", () => {
  const h = new m.History(m.newProject(), 50);
  h.apply((p) => m.createLayout(p, { rooms: 1, racksPerRoom: 1 }));
  h.patchPreferences((p) => m.updateSettings(p, { theme: "dark", label: { preset: "single" } }));
  assert.equal(h.canRedo, false);
  h.undo();
  assert.equal(h.project.racks.length, 0);
  assert.equal(h.project.settings.theme, "dark");
  assert.equal(h.project.settings.label.preset, "single");
});
