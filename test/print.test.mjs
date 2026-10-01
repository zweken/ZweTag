// Label sheet geometry and font fitting (web/assets/print.js).
import { test } from "node:test";
import assert from "node:assert/strict";

import { sheetGeometry, cellAt, placeLabels, pageCount, clampSkip, fitFont, cableLabelItems } from "../web/assets/print.js";
import * as m from "../web/assets/model.js";

const label = (preset) => ({ ...m.defaultLabelSettings(), preset });

test("A4 3 x 8: first and last cell", () => {
  const g = sheetGeometry(label("a4-3x8"));
  assert.deepEqual(cellAt(g, 0), { page: 0, row: 0, col: 0, x: 7.25, y: 12.9, w: 63.5, h: 33.9 });
  assert.deepEqual(cellAt(g, 23), { page: 0, row: 7, col: 2, x: 139.25, y: 250.2, w: 63.5, h: 33.9 });
  assert.deepEqual(cellAt(g, 24), { page: 1, row: 0, col: 0, x: 7.25, y: 12.9, w: 63.5, h: 33.9 });
  assert.ok(139.25 + 63.5 <= g.pageW && 250.2 + 33.9 <= g.pageH, "inside the page");
});

test("Letter 3 x 10: first and last cell", () => {
  const g = sheetGeometry(label("letter-3x10"));
  assert.deepEqual(cellAt(g, 0), { page: 0, row: 0, col: 0, x: 4.8, y: 12.7, w: 66.7, h: 25.4 });
  assert.deepEqual(cellAt(g, 29), { page: 0, row: 9, col: 2, x: 144.6, y: 241.3, w: 66.7, h: 25.4 });
  assert.ok(144.6 + 66.7 <= g.pageW && 241.3 + 25.4 <= g.pageH, "inside the page");
});

test("skip first labels", () => {
  const g = sheetGeometry(label("a4-3x8"));
  const cells = placeLabels(g, 20, 5);
  assert.deepEqual(cells[0], cellAt(g, 5));
  assert.equal(cells[0].row, 1);
  assert.equal(cells[0].col, 2);
  assert.equal(cells[19].page, 1);
  assert.deepEqual([cells[19].row, cells[19].col], [0, 0]);
  assert.equal(pageCount(g, 20, 5), 2);
  assert.equal(pageCount(g, 19, 5), 1);
  assert.equal(pageCount(g, 0, 5), 0);
  assert.equal(clampSkip(g, 100), 23, "never more than one sheet");
  assert.equal(clampSkip(g, -3), 0);
});

test("single labels: one per page", () => {
  const g = sheetGeometry({ ...label("single"), single: { labelW: 60, labelH: 25 } });
  assert.deepEqual([g.pageW, g.pageH, g.cols, g.rows], [60, 25, 1, 1]);
  assert.deepEqual(cellAt(g, 3), { page: 3, row: 0, col: 0, x: 0, y: 0, w: 60, h: 25 });
  assert.equal(pageCount(g, 4, 0), 4);
});

test("font fitting: widest line decides, 6 to 14 points", () => {
  const g = { labelW: 63.5, labelH: 33.9 };
  const measure = (text, pt) => text.length * pt * 0.2;
  assert.deepEqual(fitFont(["A01-40:12", "> A02-38:12", "C0017"], g, 1, measure), { size: 14, fits: true });
  assert.deepEqual(fitFont(["x".repeat(40)], g, 1, measure), { size: 7.5, fits: true });
  assert.deepEqual(fitFont(["x".repeat(80)], g, 1, measure), { size: 6, fits: false });
  const flat = { labelW: 63.5, labelH: 8 };
  assert.equal(fitFont(["a", "b", "c"], flat, 1, measure).fits, false, "three lines do not fit 8 mm");
  assert.ok(fitFont(["a", "b", "c"], g, 3, measure).size < fitFont(["a", "b", "c"], g, 1, measure).size, "repeat shrinks");
});

test("two labels per cable, third line optional", () => {
  const p = m.newProject();
  m.createLayout(p, { rooms: 1, racksPerRoom: 2 });
  const a = m.addDevices(p, p.racks[0].id, { type: "switch" }).devices[0];
  const b = m.addDevices(p, p.racks[1].id, { type: "switch" }).devices[0];
  m.connect(p, { deviceId: a.id, port: 12, face: "front" }, { deviceId: b.id, port: 12, face: "front" }, 1, { lengthM: 2 });
  const items = cableLabelItems(p, p.cables);
  assert.equal(items.length, 2);
  assert.equal(items[0].lines[0], "A01-42:12");
  assert.equal(items[1].lines[0], "A02-42:12");
  assert.equal(items[0].lines.length, 3);
  assert.equal(cableLabelItems(p, p.cables, { thirdLine: false })[0].lines.length, 2);
});
