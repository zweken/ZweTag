// CSV export (web/assets/csv.js).
import { test } from "node:test";
import assert from "node:assert/strict";

import { csvCell, toCsv, cablesCsv, labelsCsv, CABLE_COLUMNS } from "../web/assets/csv.js";
import * as m from "../web/assets/model.js";

const BOM = String.fromCharCode(0xfeff);

test("quoting follows RFC 4180", () => {
  assert.equal(csvCell("plain"), "plain");
  assert.equal(csvCell("a,b"), '"a,b"');
  assert.equal(csvCell('say "hi"'), '"say ""hi"""');
  assert.equal(csvCell("two\nlines"), '"two\nlines"');
  assert.equal(csvCell("cr\rhere"), '"cr\rhere"');
  assert.equal(csvCell(""), "");
  assert.equal(csvCell(null), "");
  assert.equal(csvCell(2.5), "2.5");
});

test("formula guard", () => {
  assert.equal(csvCell("=SUM(A1)"), "'=SUM(A1)");
  assert.equal(csvCell("+1"), "'+1");
  assert.equal(csvCell("-1"), "'-1");
  assert.equal(csvCell("@cmd"), "'@cmd");
  assert.equal(csvCell("=a,b"), '"\'=a,b"', "guarded, then quoted");
  assert.equal(csvCell("A01-40:12"), "A01-40:12", "a dash inside is fine");
});

test("byte order mark and CRLF", () => {
  const out = toCsv([["a", "b"], ["1", "2"]]);
  assert.ok(out.startsWith(BOM + "a,b\r\n"));
  assert.equal(out, BOM + "a,b\r\n1,2\r\n");
  assert.ok(!/[^\r]\n/.test(out), "no bare LF");
});

function sample() {
  const p = m.newProject();
  m.createLayout(p, { rooms: 2, racksPerRoom: 1 });
  const a = m.addDevices(p, p.racks[0].id, { type: "patch-panel" }).devices[0];
  const b = m.addDevices(p, p.racks[1].id, { type: "switch" }).devices[0];
  m.updateDevice(p, b.id, { portNames: { 3: "Gi1/0/3" } });
  m.connect(p, { deviceId: a.id, port: 1, face: "rear" }, { deviceId: b.id, port: 3, face: "front" }, 1, { media: "om4", lengthM: 12.5 });
  m.connect(p, { deviceId: a.id, port: 2, face: "front" }, { deviceId: b.id, port: 4, face: "front" });
  m.setLabeled(p, [p.cables[0].id], true);
  return p;
}

test("cables CSV", () => {
  const p = sample();
  const lines = cablesCsv(p, p.cables).slice(1).split("\r\n");
  assert.equal(lines[0], CABLE_COLUMNS.join(","));
  assert.equal(lines[1], "C0001,SR1.A01-42:01,SR2.B01-42:Gi1/0/3,Fiber OM4,12.5,labeled,SR1,A01,42,1,rear,SR2,B01,42,Gi1/0/3,front");
  assert.equal(lines[2], "C0002,SR1.A01-42:02,SR2.B01-42:04,Cat6,,unlabeled,SR1,A01,42,2,front,SR2,B01,42,4,front");
  assert.equal(lines[3], "");
});

test("labels CSV: one row per end", () => {
  const p = sample();
  const lines = labelsCsv(p, [p.cables[0]]).slice(1).split("\r\n");
  const arrow = String.fromCharCode(0x2192);
  const dot = String.fromCharCode(0xb7);
  assert.equal(lines[0], "code,side,line1,line2,line3");
  assert.equal(lines[1], `C0001,A,SR1.A01-42:01,${arrow} SR2.B01-42:Gi1/0/3,C0001 ${dot} Fiber OM4 ${dot} 12.5 m`);
  assert.equal(lines[2], `C0001,B,SR2.B01-42:Gi1/0/3,${arrow} SR1.A01-42:01,C0001 ${dot} Fiber OM4 ${dot} 12.5 m`);
});
