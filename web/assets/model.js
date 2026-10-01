// ZweTag project model: rooms, racks, devices and cables, with every rule of the project format
// (spec/project-format.md). No DOM access, so it is fully testable under `node --test`.
// Operations mutate the project in place and throw ModelError with a user-facing message when a
// rule would be broken; they check everything before changing anything.

import { clean, padNum, address, endAddresses, cableTag, ROOM_PREFIX_MODES } from "./engine.js";

export const FORMAT = "zwetag-project";
export const FORMAT_VERSION = 1;
export const LIMITS = { racks: 200, devices: 5000, cables: 20000, ports: 288, units: 60, name: 100 };

export const DEVICE_TYPES = [
  { key: "patch-panel", name: "Patch panel", height: 1, ports: 24, passThrough: true },
  { key: "switch", name: "Switch", height: 1, ports: 48, passThrough: false },
  { key: "router", name: "Router / firewall", height: 1, ports: 8, passThrough: false },
  { key: "server", name: "Server", height: 2, ports: 4, passThrough: false },
  { key: "storage", name: "Storage", height: 2, ports: 4, passThrough: false },
  { key: "san-switch", name: "SAN switch", height: 1, ports: 24, passThrough: false },
  { key: "kvm", name: "KVM / console", height: 1, ports: 16, passThrough: false },
  { key: "other", name: "Other", height: 1, ports: 8, passThrough: false },
];

export const MEDIA = [
  { key: "cat5e", name: "Cat5e" },
  { key: "cat6", name: "Cat6" },
  { key: "cat6a", name: "Cat6A" },
  { key: "cat8", name: "Cat8" },
  { key: "om3", name: "Fiber OM3" },
  { key: "om4", name: "Fiber OM4" },
  { key: "om5", name: "Fiber OM5" },
  { key: "os2", name: "Fiber OS2" },
  { key: "dac", name: "DAC" },
  { key: "aoc", name: "AOC" },
  { key: "coax", name: "Coax" },
  { key: "other", name: "Other" },
];
export const DEFAULT_MEDIA = "cat6";
export const THEMES = ["system", "light", "dark"];
export const FACES = ["front", "rear"];

const TYPE_BY_KEY = new Map(DEVICE_TYPES.map((t) => [t.key, t]));
const MEDIA_BY_KEY = new Map(MEDIA.map((m) => [m.key, m]));

export class ModelError extends Error {
  constructor(message) {
    super(message);
    this.name = "ModelError";
  }
}

function fail(message) {
  throw new ModelError(message);
}

export function deviceType(key) {
  return TYPE_BY_KEY.get(key) || null;
}

export function mediaName(key) {
  const m = MEDIA_BY_KEY.get(key);
  return m ? m.name : String(key ?? "");
}

// ---------------------------------------------------------------------------------------------
// Project

export function defaultLabelSettings() {
  return {
    preset: "a4-3x8",
    repeat: 1,
    thirdLine: true,
    outlines: false,
    single: { labelW: 60, labelH: 25 },
    custom: {
      pageW: 210, pageH: 297, cols: 3, rows: 8, labelW: 63.5, labelH: 33.9,
      marginTop: 12.9, marginLeft: 7.25, gapX: 2.5, gapY: 0,
    },
  };
}

export function defaultSettings() {
  return {
    roomPrefix: "auto",
    cablePrefix: "C",
    nextCableNumber: 1,
    seq: { room: 1, rack: 1, dev: 1, cab: 1 },
    label: defaultLabelSettings(),
    theme: "system",
  };
}

export function newProject(name = "New project") {
  return {
    format: FORMAT,
    version: FORMAT_VERSION,
    name,
    settings: defaultSettings(),
    rooms: [],
    racks: [],
    devices: [],
    cables: [],
  };
}

function nextId(p, kind) {
  const n = p.settings.seq[kind];
  p.settings.seq[kind] = n + 1;
  return `${kind}-${n}`;
}

// ---------------------------------------------------------------------------------------------
// Index and derived values

export function slotKey(end) {
  return `${end.deviceId}|${end.port}|${end.face}`;
}

/** Lookup tables for one state of the project. Rebuild after every change. */
export function indexProject(p) {
  const rooms = new Map(p.rooms.map((r) => [r.id, r]));
  const racks = new Map(p.racks.map((r) => [r.id, r]));
  const devices = new Map(p.devices.map((d) => [d.id, d]));
  const cables = new Map(p.cables.map((c) => [c.id, c]));
  const racksByRoom = new Map(p.rooms.map((r) => [r.id, []]));
  for (const r of p.racks) racksByRoom.get(r.roomId)?.push(r);
  const devicesByRack = new Map(p.racks.map((r) => [r.id, []]));
  for (const d of p.devices) devicesByRack.get(d.rackId)?.push(d);
  for (const list of devicesByRack.values()) list.sort((x, y) => y.u - x.u);
  const slots = new Map();
  const cablesByDevice = new Map();
  for (const c of p.cables) {
    slots.set(slotKey(c.a), c);
    slots.set(slotKey(c.b), c);
    for (const id of new Set([c.a.deviceId, c.b.deviceId])) {
      if (!cablesByDevice.has(id)) cablesByDevice.set(id, []);
      cablesByDevice.get(id).push(c);
    }
  }
  return { rooms, racks, devices, cables, racksByRoom, devicesByRack, slots, cablesByDevice };
}

/** The name a port carries in tags: its custom name, or its number. */
export function portLabel(device, port) {
  const name = device.portNames ? device.portNames[String(port)] : undefined;
  return name ? name : String(port);
}

/** "A01-40": rack code and top unit of a device. */
export function deviceAddress(ix, device) {
  const rack = ix.racks.get(device.rackId);
  return address({ kind: "rack", rack: rack ? rack.code : "", u: device.u });
}

export function deviceTitle(device) {
  const t = deviceType(device.type);
  return device.name || (t ? t.name : device.type);
}

/** Engine parts (spec/tag-format.md) for one cable end. */
export function endParts(ix, end) {
  const d = ix.devices.get(end.deviceId);
  const rack = d ? ix.racks.get(d.rackId) : null;
  const room = rack ? ix.rooms.get(rack.roomId) : null;
  return {
    kind: "rack",
    room: room ? room.code : "",
    rack: rack ? rack.code : "",
    u: d ? d.u : 0,
    name: d ? d.name : "",
    port: d ? portLabel(d, end.port) : String(end.port),
  };
}

export function cableAddresses(p, ix, cable) {
  return endAddresses(endParts(ix, cable.a), endParts(ix, cable.b), p.settings.roomPrefix);
}

export function currentTag(p, ix, cable) {
  return cableTag(endParts(ix, cable.a), endParts(ix, cable.b), p.settings.roomPrefix);
}

/** "unlabeled", "labeled", or "relabel" when the cable was labeled and its tag changed since. */
export function labelState(p, ix, cable) {
  if (!cable.taggedAs) return "unlabeled";
  return cable.taggedAs === currentTag(p, ix, cable) ? "labeled" : "relabel";
}

/** Addresses of one end as shown in messages: "Port 14 on A01-38", "Rear port 3 on A01-42". */
function slotName(ix, end) {
  const d = ix.devices.get(end.deviceId);
  const where = d ? deviceAddress(ix, d) : end.deviceId;
  const port = d ? portLabel(d, end.port) : String(end.port);
  return `${end.face === "rear" ? "Rear port" : "Port"} ${port} on ${where}`;
}

// ---------------------------------------------------------------------------------------------
// Codes

function sameCode(a, b) {
  return a.toLowerCase() === b.toLowerCase();
}

/** "A", "B", ... "Z", "AA", "AB", ... for rack rows. */
export function rowLetters(i) {
  let s = "";
  let n = i;
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}

export function defaultRoomCode(p) {
  for (let n = 1; ; n++) {
    const code = `SR${n}`;
    if (!p.rooms.some((r) => sameCode(r.code, code))) return code;
  }
}

export function defaultRackCode(p, roomId) {
  const roomIndex = Math.max(0, p.rooms.findIndex((r) => r.id === roomId));
  const letters = rowLetters(roomIndex);
  for (let n = 1; ; n++) {
    const code = letters + padNum(String(n));
    if (!p.racks.some((r) => sameCode(r.code, code))) return code;
  }
}

function checkRoomCode(p, code, exceptId) {
  const c = clean(code);
  if (c === "") fail("Room code cannot be empty");
  if (c.length > 16) fail("Room code is too long");
  if (p.rooms.some((r) => r.id !== exceptId && sameCode(r.code, c))) fail(`Room ${c} already exists`);
  return c;
}

function checkRackCode(p, code, exceptId) {
  const c = clean(code);
  if (c === "") fail("Rack code cannot be empty");
  if (c.length > 16) fail("Rack code is too long");
  if (p.racks.some((r) => r.id !== exceptId && sameCode(r.code, c))) fail(`Rack ${c} already exists`);
  return c;
}

function checkInt(value, min, max, what) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) fail(`${what} must be a whole number from ${min} to ${max}`);
  return n;
}

function cleanName(name) {
  const s = String(name ?? "").trim();
  if (s.length > LIMITS.name) fail("Name is too long");
  return s;
}

// ---------------------------------------------------------------------------------------------
// Rooms and racks

export function setProjectName(p, name) {
  const s = cleanName(name);
  if (s === "") fail("Project name cannot be empty");
  p.name = s;
}

/** First layout of an empty project: `rooms` rooms with `racksPerRoom` racks of `rackHeight` units. */
export function createLayout(p, { rooms = 1, racksPerRoom = 4, rackHeight = 42 } = {}) {
  const nRooms = checkInt(rooms, 1, LIMITS.racks, "Rooms");
  const nRacks = checkInt(racksPerRoom, 1, LIMITS.racks, "Racks per room");
  const units = checkInt(rackHeight, 1, LIMITS.units, "Rack height");
  if (p.racks.length + nRooms * nRacks > LIMITS.racks) fail(`A project can have at most ${LIMITS.racks} racks`);
  for (let i = 0; i < nRooms; i++) {
    const room = addRoom(p);
    for (let j = 0; j < nRacks; j++) addRack(p, room.id, { units });
  }
}

export function addRoom(p, { code, name = "" } = {}) {
  const c = checkRoomCode(p, code ?? defaultRoomCode(p));
  const room = { id: nextId(p, "room"), code: c, name: cleanName(name) };
  p.rooms.push(room);
  return room;
}

export function updateRoom(p, id, patch) {
  const room = p.rooms.find((r) => r.id === id) || fail("Room not found");
  const code = "code" in patch ? checkRoomCode(p, patch.code, id) : room.code;
  const name = "name" in patch ? cleanName(patch.name) : room.name;
  room.code = code;
  room.name = name;
  return room;
}

export function roomDeleteImpact(p, id) {
  const rackIds = new Set(p.racks.filter((r) => r.roomId === id).map((r) => r.id));
  const devIds = new Set(p.devices.filter((d) => rackIds.has(d.rackId)).map((d) => d.id));
  const cables = p.cables.filter((c) => devIds.has(c.a.deviceId) || devIds.has(c.b.deviceId)).length;
  return { racks: rackIds.size, devices: devIds.size, cables };
}

export function deleteRoom(p, id) {
  if (!p.rooms.some((r) => r.id === id)) fail("Room not found");
  for (const rack of p.racks.filter((r) => r.roomId === id)) deleteRack(p, rack.id);
  p.rooms = p.rooms.filter((r) => r.id !== id);
}

export function addRack(p, roomId, { code, units = 42 } = {}) {
  if (!p.rooms.some((r) => r.id === roomId)) fail("Room not found");
  if (p.racks.length >= LIMITS.racks) fail(`A project can have at most ${LIMITS.racks} racks`);
  const c = checkRackCode(p, code ?? defaultRackCode(p, roomId));
  const rack = { id: nextId(p, "rack"), roomId, code: c, units: checkInt(units, 1, LIMITS.units, "Rack height") };
  p.racks.push(rack);
  return rack;
}

export function updateRack(p, id, patch) {
  const rack = p.racks.find((r) => r.id === id) || fail("Rack not found");
  const code = "code" in patch ? checkRackCode(p, patch.code, id) : rack.code;
  const units = "units" in patch ? checkInt(patch.units, 1, LIMITS.units, "Rack height") : rack.units;
  const roomId = "roomId" in patch ? patch.roomId : rack.roomId;
  if (!p.rooms.some((r) => r.id === roomId)) fail("Room not found");
  const highest = Math.max(0, ...p.devices.filter((d) => d.rackId === id).map((d) => d.u));
  if (highest > units) fail(`${code} has a device at U${highest}`);
  rack.code = code;
  rack.units = units;
  rack.roomId = roomId;
  return rack;
}

export function rackDeleteImpact(p, id) {
  const devIds = new Set(p.devices.filter((d) => d.rackId === id).map((d) => d.id));
  const cables = p.cables.filter((c) => devIds.has(c.a.deviceId) || devIds.has(c.b.deviceId)).length;
  return { devices: devIds.size, cables };
}

export function deleteRack(p, id) {
  if (!p.racks.some((r) => r.id === id)) fail("Rack not found");
  const devIds = new Set(p.devices.filter((d) => d.rackId === id).map((d) => d.id));
  p.cables = p.cables.filter((c) => !devIds.has(c.a.deviceId) && !devIds.has(c.b.deviceId));
  p.devices = p.devices.filter((d) => d.rackId !== id);
  p.racks = p.racks.filter((r) => r.id !== id);
}

// ---------------------------------------------------------------------------------------------
// Devices

function occupied(p, rackId, exceptId) {
  const used = new Set();
  for (const d of p.devices) {
    if (d.rackId !== rackId || d.id === exceptId) continue;
    for (let u = d.u - d.height + 1; u <= d.u; u++) used.add(u);
  }
  return used;
}

function fits(used, units, top, height) {
  if (top > units || top - height + 1 < 1) return false;
  for (let u = top - height + 1; u <= top; u++) if (used.has(u)) return false;
  return true;
}

/** The highest top unit where a device of `height` units fits, or 0 when there is no room. */
export function highestFreeTop(p, rackId, height, exceptId) {
  const rack = p.racks.find((r) => r.id === rackId);
  if (!rack) return 0;
  const used = occupied(p, rackId, exceptId);
  for (let top = rack.units; top >= height; top--) if (fits(used, rack.units, top, height)) return top;
  return 0;
}

function checkSpec(spec, units) {
  const type = deviceType(spec.type) || fail("Unknown device type");
  const height = checkInt(spec.height ?? type.height, 1, units, "Height");
  const ports = checkInt(spec.ports ?? type.ports, 1, LIMITS.ports, "Ports");
  const passThrough = spec.passThrough === undefined ? type.passThrough : Boolean(spec.passThrough);
  return { type: type.key, name: cleanName(spec.name), height, ports, passThrough };
}

/** Names for a series of identical devices: a trailing number counts up ("SRV-09", "SRV-10"). */
export function seriesName(name, i) {
  if (!name || i === 0) return name;
  const m = /^(.*?)(\d+)$/.exec(name);
  if (!m) return name;
  const n = String(Number(m[2]) + i);
  return m[1] + n.padStart(m[2].length, "0");
}

/**
 * Adds `count` identical devices to a rack. With `top` (a unit number) the first device goes there
 * and the rest stack directly below it; without, each goes to the highest free space that fits.
 * Stops at the first device that does not fit and keeps the ones already placed:
 * returns {devices, message} where message is null when all were placed.
 */
export function addDevices(p, rackId, spec, count = 1, top = 0) {
  const rack = p.racks.find((r) => r.id === rackId) || fail("Rack not found");
  const n = checkInt(count, 1, LIMITS.devices, "Count");
  const s = checkSpec(spec, rack.units);
  const portNames = checkPortNames(spec.portNames, s.ports);
  if (p.devices.length + n > LIMITS.devices) fail(`A project can have at most ${LIMITS.devices} devices`);
  const start = Number(top) || 0;
  const added = [];
  let message = null;
  for (let i = 0; i < n; i++) {
    const used = occupied(p, rackId);
    let u = 0;
    if (start >= 1) {
      const want = start - i * s.height;
      if (fits(used, rack.units, want, s.height)) u = want;
    } else {
      u = highestFreeTop(p, rackId, s.height);
    }
    if (!u) {
      message = `No free space for a ${s.height}U device in ${rack.code}`;
      break;
    }
    const device = {
      id: nextId(p, "dev"),
      rackId,
      type: s.type,
      name: seriesName(s.name, i),
      u,
      height: s.height,
      ports: s.ports,
      passThrough: s.passThrough,
      portNames: { ...portNames },
    };
    p.devices.push(device);
    added.push(device);
  }
  if (added.length === 0) fail(message);
  return { devices: added, message };
}

function checkPortNames(names, ports) {
  const out = {};
  for (const [key, value] of Object.entries(names || {})) {
    const port = Number(key);
    if (!Number.isInteger(port) || port < 1 || port > ports) fail(`Port ${key} does not exist`);
    const name = String(value ?? "").trim();
    if (name === "") continue;
    if (name.length > 32) fail(`Port name ${name} is too long`);
    if (clean(name) === "") fail("Port name cannot be only spaces");
    out[String(port)] = name;
  }
  const owner = new Map();
  for (let port = 1; port <= ports; port++) {
    const id = padNum(clean(out[String(port)] ?? String(port)));
    const other = owner.get(id);
    if (other !== undefined) fail(`Ports ${other} and ${port} would get the same label`);
    owner.set(id, port);
  }
  return out;
}

/**
 * Changes a device. Moving it (rackId, u) keeps its cables; their tags change, so labeled cables
 * turn to "relabel" by themselves.
 */
export function updateDevice(p, id, patch) {
  const d = p.devices.find((x) => x.id === id) || fail("Device not found");
  const rackId = "rackId" in patch ? patch.rackId : d.rackId;
  const rack = p.racks.find((r) => r.id === rackId) || fail("Rack not found");
  const s = checkSpec({
    type: "type" in patch ? patch.type : d.type,
    name: "name" in patch ? patch.name : d.name,
    height: "height" in patch ? patch.height : d.height,
    ports: "ports" in patch ? patch.ports : d.ports,
    passThrough: "passThrough" in patch ? patch.passThrough : d.passThrough,
  }, rack.units);
  const u = "u" in patch ? checkInt(patch.u, 1, rack.units, "Top unit") : d.u;
  if (!fits(occupied(p, rackId, id), rack.units, u, s.height)) {
    fail(`No free space for a ${s.height}U device at U${u} in ${rack.code}`);
  }
  const mine = p.cables.flatMap((c) => [c.a, c.b]).filter((e) => e.deviceId === id);
  const highestPort = Math.max(0, ...mine.map((e) => e.port));
  if (highestPort > s.ports) fail(`Port ${highestPort} has a cable`);
  if (!s.passThrough && mine.some((e) => e.face === "rear")) fail("Rear ports have cables");
  const portNames = checkPortNames("portNames" in patch ? patch.portNames : d.portNames, s.ports);
  Object.assign(d, s, { rackId, u, portNames });
  return d;
}

export function deviceDeleteImpact(p, id) {
  return { cables: p.cables.filter((c) => c.a.deviceId === id || c.b.deviceId === id).length };
}

export function deleteDevice(p, id) {
  if (!p.devices.some((d) => d.id === id)) fail("Device not found");
  p.cables = p.cables.filter((c) => c.a.deviceId !== id && c.b.deviceId !== id);
  p.devices = p.devices.filter((d) => d.id !== id);
}

/** A copy of a device without its cables, directly below it when there is room, else highest free. */
export function duplicateDevice(p, id) {
  const d = p.devices.find((x) => x.id === id) || fail("Device not found");
  const rack = p.racks.find((r) => r.id === d.rackId);
  const below = d.u - d.height;
  const spec = { ...d, name: seriesName(d.name, 1), portNames: d.portNames };
  const top = fits(occupied(p, d.rackId), rack.units, below, d.height) ? below : 0;
  return addDevices(p, d.rackId, spec, 1, top).devices[0];
}

// ---------------------------------------------------------------------------------------------
// Cables

function checkMedia(media) {
  if (!MEDIA_BY_KEY.has(media)) fail("Unknown cable type");
  return media;
}

function checkLength(lengthM) {
  if (lengthM === "" || lengthM === null || lengthM === undefined) return 0;
  const n = Number(lengthM);
  if (!Number.isFinite(n) || n < 0 || n > 100000) fail("Length must be a number of meters");
  return Math.round(n * 100) / 100;
}

export function cableCode(p, number) {
  return p.settings.cablePrefix + String(number).padStart(4, "0");
}

function checkSlot(ix, end) {
  const d = ix.devices.get(end.deviceId);
  if (!d) fail("Device not found");
  if (!Number.isInteger(end.port) || end.port < 1 || end.port > d.ports) {
    fail(`Port ${end.port} does not exist on ${deviceAddress(ix, d)}`);
  }
  if (end.face !== "front" && end.face !== "rear") fail("Unknown port face");
  if (end.face === "rear" && !d.passThrough) fail(`${deviceAddress(ix, d)} has no rear ports`);
  if (ix.slots.has(slotKey(end))) fail(`${slotName(ix, end)} is in use`);
}

/** The 2 x count ends of a bulk connection, checked; throws on the first missing or taken slot. */
function planConnection(p, a, b, count) {
  const n = checkInt(count, 1, LIMITS.ports, "Count");
  if (p.cables.length + n > LIMITS.cables) fail(`A project can have at most ${LIMITS.cables} cables`);
  const ix = indexProject(p);
  const planned = [];
  for (let i = 0; i < n; i++) {
    const ea = { deviceId: a.deviceId, port: a.port + i, face: a.face || "front" };
    const eb = { deviceId: b.deviceId, port: b.port + i, face: b.face || "front" };
    if (slotKey(ea) === slotKey(eb)) fail("A cable cannot connect a port to itself");
    for (const end of [ea, eb]) {
      checkSlot(ix, end);
      ix.slots.set(slotKey(end), null);
    }
    planned.push([ea, eb]);
  }
  return planned;
}

/**
 * Bulk connect: cable i joins port (a.port + i) to port (b.port + i) on the same faces, for
 * i = 0 .. count-1. Either every cable is created or none is; the error names the first slot
 * that is missing or already taken. Returns the new cables.
 */
export function connect(p, a, b, count = 1, opts = {}) {
  const media = checkMedia(opts.media ?? DEFAULT_MEDIA);
  const lengthM = checkLength(opts.lengthM);
  const planned = planConnection(p, a, b, count);
  const created = [];
  for (const [ea, eb] of planned) {
    const number = p.settings.nextCableNumber;
    p.settings.nextCableNumber = number + 1;
    const cable = { id: nextId(p, "cab"), code: cableCode(p, number), a: ea, b: eb, media, lengthM, taggedAs: "" };
    p.cables.push(cable);
    created.push(cable);
  }
  return created;
}

/** The reason a pending connection cannot be made, or "" when it can. */
export function connectProblem(p, a, b, count = 1) {
  try {
    planConnection(p, a, b, count);
    return "";
  } catch (e) {
    if (e instanceof ModelError) return e.message;
    throw e;
  }
}

export function updateCable(p, id, patch) {
  const c = p.cables.find((x) => x.id === id) || fail("Cable not found");
  const media = "media" in patch ? checkMedia(patch.media) : c.media;
  const lengthM = "lengthM" in patch ? checkLength(patch.lengthM) : c.lengthM;
  c.media = media;
  c.lengthM = lengthM;
  return c;
}

export function deleteCables(p, ids) {
  const drop = new Set(ids);
  p.cables = p.cables.filter((c) => !drop.has(c.id));
}

/** Records the current tag as the one on the cable ("labeled"), or clears it ("unlabeled"). */
export function setLabeled(p, ids, labeled) {
  const ix = indexProject(p);
  const want = new Set(ids);
  for (const c of p.cables) {
    if (want.has(c.id)) c.taggedAs = labeled ? currentTag(p, ix, c) : "";
  }
}

// ---------------------------------------------------------------------------------------------
// Settings

const PRESETS = ["a4-3x8", "letter-3x10", "single", "custom"];
const CUSTOM_FIELDS = {
  pageW: [10, 1000], pageH: [10, 1000], cols: [1, 50], rows: [1, 100], labelW: [5, 1000], labelH: [5, 1000],
  marginTop: [0, 500], marginLeft: [0, 500], gapX: [0, 500], gapY: [0, 500],
};

function checkNumber(value, min, max, what) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < min || n > max) fail(`${what} must be a number from ${min} to ${max}`);
  return Math.round(n * 100) / 100;
}

export function checkLabelSettings(label) {
  const d = defaultLabelSettings();
  const l = label || {};
  const preset = l.preset ?? d.preset;
  if (!PRESETS.includes(preset)) fail("Unknown label layout");
  const custom = {};
  for (const [key, [min, max]] of Object.entries(CUSTOM_FIELDS)) {
    const value = l.custom && key in l.custom ? l.custom[key] : d.custom[key];
    custom[key] = key === "cols" || key === "rows" ? checkInt(value, min, max, key) : checkNumber(value, min, max, key);
  }
  const single = {
    labelW: checkNumber(l.single?.labelW ?? d.single.labelW, 5, 1000, "labelW"),
    labelH: checkNumber(l.single?.labelH ?? d.single.labelH, 5, 1000, "labelH"),
  };
  return {
    preset,
    repeat: checkInt(l.repeat ?? d.repeat, 1, 3, "Repeat text"),
    thirdLine: l.thirdLine === undefined ? d.thirdLine : Boolean(l.thirdLine),
    outlines: l.outlines === undefined ? d.outlines : Boolean(l.outlines),
    single,
    custom,
  };
}

export function updateSettings(p, patch) {
  const s = p.settings;
  const next = { ...s };
  if ("roomPrefix" in patch) {
    if (!ROOM_PREFIX_MODES.includes(patch.roomPrefix)) fail("Unknown room prefix mode");
    next.roomPrefix = patch.roomPrefix;
  }
  if ("cablePrefix" in patch) {
    const prefix = clean(patch.cablePrefix);
    if (prefix.length > 8) fail("Cable code prefix is too long");
    next.cablePrefix = prefix;
  }
  if ("theme" in patch) {
    if (!THEMES.includes(patch.theme)) fail("Unknown theme");
    next.theme = patch.theme;
  }
  if ("label" in patch) next.label = checkLabelSettings({ ...s.label, ...patch.label });
  Object.assign(s, next);
}

// ---------------------------------------------------------------------------------------------
// Loading a project file

function isObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function idNumber(id, kind) {
  const m = new RegExp(`^${kind}-(\\d+)$`).exec(id);
  return m ? Number(m[1]) : 0;
}

/**
 * Checks a parsed project file against every rule and returns a clean copy. Throws ModelError
 * naming the first problem found.
 */
export function validateProject(data) {
  if (!isObject(data) || data.format !== FORMAT) fail("This is not a ZweTag project file");
  if (!Number.isInteger(data.version) || data.version < 1) fail("This is not a ZweTag project file");
  if (data.version > FORMAT_VERSION) fail("This file is from a newer version of ZweTag");
  for (const key of ["rooms", "racks", "devices", "cables"]) {
    if (!Array.isArray(data[key])) fail(`The file has no ${key} list`);
  }
  const p = newProject();
  p.name = typeof data.name === "string" && data.name.trim() !== "" ? data.name.trim().slice(0, LIMITS.name) : p.name;

  const s = isObject(data.settings) ? data.settings : {};
  if (s.roomPrefix !== undefined && !ROOM_PREFIX_MODES.includes(s.roomPrefix)) fail("Unknown room prefix mode");
  p.settings.roomPrefix = s.roomPrefix ?? "auto";
  if (s.cablePrefix !== undefined && (typeof s.cablePrefix !== "string" || clean(s.cablePrefix).length > 8)) {
    fail("Cable code prefix is not valid");
  }
  p.settings.cablePrefix = s.cablePrefix === undefined ? "C" : clean(s.cablePrefix);
  p.settings.theme = THEMES.includes(s.theme) ? s.theme : "system";
  p.settings.label = checkLabelSettings(isObject(s.label) ? s.label : undefined);

  if (data.racks.length > LIMITS.racks) fail(`A project can have at most ${LIMITS.racks} racks`);
  if (data.devices.length > LIMITS.devices) fail(`A project can have at most ${LIMITS.devices} devices`);
  if (data.cables.length > LIMITS.cables) fail(`A project can have at most ${LIMITS.cables} cables`);

  const ids = new Set();
  const takeId = (id, what) => {
    if (typeof id !== "string" || id === "" || id.length > 40) fail(`${what} has no valid id`);
    if (ids.has(id)) fail(`The id ${id} is used twice`);
    ids.add(id);
  };
  const seq = { room: 1, rack: 1, dev: 1, cab: 1 };

  for (const r of data.rooms) {
    if (!isObject(r)) fail("A room entry is not valid");
    takeId(r.id, "A room");
    if (typeof r.code !== "string") fail(`Room ${r.id} has no code`);
    const room = { id: r.id, code: checkRoomCode(p, r.code), name: typeof r.name === "string" ? r.name.trim().slice(0, LIMITS.name) : "" };
    p.rooms.push(room);
    seq.room = Math.max(seq.room, idNumber(r.id, "room") + 1);
  }
  for (const r of data.racks) {
    if (!isObject(r)) fail("A rack entry is not valid");
    takeId(r.id, "A rack");
    if (typeof r.code !== "string") fail(`Rack ${r.id} has no code`);
    const code = checkRackCode(p, r.code);
    if (!p.rooms.some((room) => room.id === r.roomId)) fail(`Rack ${code}: its room ${r.roomId} does not exist`);
    const units = Number(r.units);
    if (!Number.isInteger(units) || units < 1 || units > LIMITS.units) fail(`Rack ${code}: height must be 1 to ${LIMITS.units} units`);
    p.racks.push({ id: r.id, roomId: r.roomId, code, units });
    seq.rack = Math.max(seq.rack, idNumber(r.id, "rack") + 1);
  }
  const used = new Map();
  for (const d of data.devices) {
    if (!isObject(d)) fail("A device entry is not valid");
    takeId(d.id, "A device");
    const rack = p.racks.find((r) => r.id === d.rackId);
    if (!rack) fail(`Device ${d.id}: its rack ${d.rackId} does not exist`);
    if (!deviceType(d.type)) fail(`Device ${d.id}: unknown type ${d.type}`);
    const height = Number(d.height);
    const u = Number(d.u);
    const ports = Number(d.ports);
    if (!Number.isInteger(height) || height < 1) fail(`Device ${d.id}: height is not valid`);
    if (!Number.isInteger(u) || u > rack.units || u - height + 1 < 1) fail(`Device ${d.id}: U${d.u} is outside rack ${rack.code}`);
    if (!Number.isInteger(ports) || ports < 1 || ports > LIMITS.ports) fail(`Device ${d.id}: ports must be 1 to ${LIMITS.ports}`);
    for (let x = u - height + 1; x <= u; x++) {
      const key = `${rack.id}|${x}`;
      if (used.has(key)) fail(`Device ${d.id} overlaps device ${used.get(key)} in ${rack.code} at U${x}`);
      used.set(key, d.id);
    }
    let portNames;
    try {
      portNames = checkPortNames(isObject(d.portNames) ? d.portNames : {}, ports);
    } catch (e) {
      fail(`Device ${d.id}: ${e.message}`);
    }
    p.devices.push({
      id: d.id,
      rackId: rack.id,
      type: d.type,
      name: typeof d.name === "string" ? d.name.trim().slice(0, LIMITS.name) : "",
      u,
      height,
      ports,
      passThrough: Boolean(d.passThrough),
      portNames,
    });
    seq.dev = Math.max(seq.dev, idNumber(d.id, "dev") + 1);
  }
  const ix = indexProject(p);
  const codes = new Set();
  let maxNumber = 0;
  for (const c of data.cables) {
    if (!isObject(c)) fail("A cable entry is not valid");
    takeId(c.id, "A cable");
    const code = typeof c.code === "string" ? c.code : "";
    const name = code || c.id;
    if (code === "") fail(`Cable ${c.id} has no code`);
    if (codes.has(code)) fail(`Cable code ${code} is used twice`);
    codes.add(code);
    const ends = [];
    for (const side of ["a", "b"]) {
      const e = c[side];
      if (!isObject(e)) fail(`Cable ${name}: end ${side.toUpperCase()} is missing`);
      const end = { deviceId: e.deviceId, port: Number(e.port), face: e.face === undefined ? "front" : e.face };
      const d = ix.devices.get(end.deviceId);
      if (!d) fail(`Cable ${name}: device ${e.deviceId} does not exist`);
      try {
        checkSlot(ix, end);
      } catch (err) {
        const other = ix.slots.get(slotKey(end));
        if (other) fail(`Cable ${name}: ${slotName(ix, end)} is also used by ${other.code}`);
        fail(`Cable ${name}: ${err.message}`);
      }
      ix.slots.set(slotKey(end), { code });
      ends.push(end);
    }
    if (slotKey(ends[0]) === slotKey(ends[1])) fail(`Cable ${name} connects a port to itself`);
    if (c.media !== undefined && !MEDIA_BY_KEY.has(c.media)) fail(`Cable ${name}: unknown cable type ${c.media}`);
    let lengthM = 0;
    try {
      lengthM = checkLength(c.lengthM);
    } catch (e) {
      fail(`Cable ${name}: ${e.message}`);
    }
    p.cables.push({
      id: c.id,
      code,
      a: ends[0],
      b: ends[1],
      media: c.media ?? DEFAULT_MEDIA,
      lengthM,
      taggedAs: typeof c.taggedAs === "string" ? c.taggedAs : "",
    });
    seq.cab = Math.max(seq.cab, idNumber(c.id, "cab") + 1);
    const m = /(\d+)$/.exec(code);
    if (m) maxNumber = Math.max(maxNumber, Number(m[1]));
  }
  const fileSeq = isObject(s.seq) ? s.seq : {};
  for (const kind of Object.keys(seq)) {
    const n = Number(fileSeq[kind]);
    p.settings.seq[kind] = Number.isInteger(n) && n > seq[kind] ? n : seq[kind];
  }
  const next = Number(s.nextCableNumber);
  p.settings.nextCableNumber = Math.max(Number.isInteger(next) && next > 0 ? next : 1, maxNumber + 1);
  return p;
}

/** Parses project file text; throws ModelError with a readable message. */
export function parseProject(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    fail("This file is not valid JSON");
  }
  return validateProject(data);
}

export function serializeProject(p) {
  return JSON.stringify(p, null, 2) + "\n";
}

// ---------------------------------------------------------------------------------------------
// Undo and redo

/**
 * Keeps a snapshot of the project after every change, up to `limit` steps back. Theme and label
 * layout are preferences: they are kept as they are when stepping back and forward.
 */
export class History {
  constructor(project, limit = 50) {
    this.limit = limit;
    this.reset(project);
  }

  reset(project) {
    this.project = project;
    this.states = [JSON.stringify(project)];
    this.index = 0;
  }

  /** Runs fn(project); records a step when the project changed; rolls back when fn throws. */
  apply(fn) {
    let result;
    try {
      result = fn(this.project);
    } catch (e) {
      this.project = this.#restore(this.index);
      throw e;
    }
    this.commit();
    return result;
  }

  commit() {
    const s = JSON.stringify(this.project);
    if (s === this.states[this.index]) return false;
    this.states.length = this.index + 1;
    this.states.push(s);
    while (this.states.length > this.limit + 1) this.states.shift();
    this.index = this.states.length - 1;
    return true;
  }

  /** Changes preferences without recording an undo step. */
  patchPreferences(fn) {
    fn(this.project);
    this.states[this.index] = JSON.stringify(this.project);
  }

  get canUndo() {
    return this.index > 0;
  }

  get canRedo() {
    return this.index < this.states.length - 1;
  }

  undo() {
    if (!this.canUndo) return false;
    this.index -= 1;
    this.project = this.#restore(this.index);
    return true;
  }

  redo() {
    if (!this.canRedo) return false;
    this.index += 1;
    this.project = this.#restore(this.index);
    return true;
  }

  #restore(i) {
    const p = JSON.parse(this.states[i]);
    if (this.project) {
      p.settings.theme = this.project.settings.theme;
      p.settings.label = this.project.settings.label;
    }
    return p;
  }
}
