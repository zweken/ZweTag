// The sample project: one server room, two racks, a few devices and cables.

import { newProject, createLayout, addDevices, updateDevice, updateRoom, connect, setLabeled } from "./model.js";

export function sampleProject() {
  const p = newProject("Sample server room");
  createLayout(p, { rooms: 1, racksPerRoom: 2, rackHeight: 42 });
  updateRoom(p, p.rooms[0].id, { name: "Server room" });
  const [a01, a02] = p.racks;
  const add = (rack, type, u, name = "") => addDevices(p, rack.id, { type, name }, 1, u).devices[0];
  const end = (device, port, face = "front") => ({ deviceId: device.id, port, face });

  const panelA = add(a01, "patch-panel", 42);
  const switchA = add(a01, "switch", 40, "SW-A01");
  const server = add(a01, "server", 20, "APP-01");
  updateDevice(p, server.id, { portNames: { 4: "iLO" } });
  const panelB = add(a02, "patch-panel", 42);
  add(a02, "switch", 40, "SW-A02");
  add(a02, "storage", 10, "NAS-01");

  connect(p, end(panelA, 1), end(switchA, 1), 8, { media: "cat6", lengthM: 0.5 });
  connect(p, end(panelA, 1, "rear"), end(panelB, 1, "rear"), 4, { media: "cat6a", lengthM: 3 });
  connect(p, end(server, 1), end(switchA, 47), 2, { media: "cat6", lengthM: 2 });
  setLabeled(p, p.cables.slice(0, 6).map((c) => c.id), true);
  return p;
}
