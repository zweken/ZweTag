// Label sheets: geometry of the label layouts, placement of labels on sheets, font fitting and the
// printable pages. All geometry is in millimeters. Only buildPages and the measuring helpers touch
// the DOM, through the document passed in, so the rest runs under `node --test`.

import { labelLines } from "./engine.js";
import { indexProject, cableAddresses, mediaName, deviceAddress, deviceTitle } from "./model.js";

export const LAYOUTS = [
  { key: "a4-3x8", name: "A4 · 3 × 8 · 63.5 × 33.9 mm" },
  { key: "letter-3x10", name: "Letter · 3 × 10 · 66.7 × 25.4 mm" },
  { key: "single", name: "Single label" },
  { key: "custom", name: "Custom" },
];

const PRESETS = {
  "a4-3x8": {
    pageW: 210, pageH: 297, cols: 3, rows: 8, labelW: 63.5, labelH: 33.9,
    marginTop: 12.9, marginLeft: 7.25, gapX: 2.5, gapY: 0,
  },
  "letter-3x10": {
    pageW: 215.9, pageH: 279.4, cols: 3, rows: 10, labelW: 66.7, labelH: 25.4,
    marginTop: 12.7, marginLeft: 4.8, gapX: 3.2, gapY: 0,
  },
};

export const FONT_MIN = 6;
export const FONT_MAX = 14;
export const LABEL_FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
const MM_PER_PT = 25.4 / 72;
const MM_PER_PX = 25.4 / 96;
const LINE_HEIGHT = 1.2;
const SMALL_LINE = 0.8;

function round(v) {
  return Math.round(v * 1000) / 1000;
}

/** Page and label geometry of the layout chosen in the label settings. */
export function sheetGeometry(label) {
  if (label.preset === "single") {
    const w = label.single.labelW;
    const h = label.single.labelH;
    return { pageW: w, pageH: h, cols: 1, rows: 1, labelW: w, labelH: h, marginTop: 0, marginLeft: 0, gapX: 0, gapY: 0 };
  }
  if (label.preset === "custom") return { ...label.custom };
  return { ...PRESETS[label.preset] };
}

export function labelsPerPage(g) {
  return g.cols * g.rows;
}

/** Clamps "Skip first labels" to the first sheet. */
export function clampSkip(g, skip) {
  const n = Math.floor(Number(skip)) || 0;
  return Math.max(0, Math.min(n, labelsPerPage(g) - 1));
}

/** Where label slot `slot` sits, counting slots from the first label of the first sheet. */
export function cellAt(g, slot) {
  const n = labelsPerPage(g);
  const page = Math.floor(slot / n);
  const i = slot % n;
  const row = Math.floor(i / g.cols);
  const col = i % g.cols;
  return {
    page,
    row,
    col,
    x: round(g.marginLeft + col * (g.labelW + g.gapX)),
    y: round(g.marginTop + row * (g.labelH + g.gapY)),
    w: g.labelW,
    h: g.labelH,
  };
}

/** Cells for `count` labels, leaving the first `skip` slots of the first sheet empty. */
export function placeLabels(g, count, skip = 0) {
  const s = clampSkip(g, skip);
  return Array.from({ length: count }, (_, i) => cellAt(g, s + i));
}

export function pageCount(g, count, skip = 0) {
  if (count <= 0) return 0;
  return Math.floor((clampSkip(g, skip) + count - 1) / labelsPerPage(g)) + 1;
}

/** Two labels per cable, end A first; each label is {lines: [three lines]}. */
export function cableLabelItems(p, cables, { thirdLine = true } = {}) {
  const ix = indexProject(p);
  const items = [];
  for (const c of cables) {
    const ends = cableAddresses(p, ix, c);
    const lines = labelLines({ code: c.code, media: mediaName(c.media), lengthM: c.lengthM, a: ends.a, b: ends.b });
    const keep = (l) => (thirdLine ? l : l.slice(0, 2)).filter((t) => t !== "");
    items.push({ lines: keep(lines.a) }, { lines: keep(lines.b) });
  }
  return items;
}

/** One label per rack (its code), then one per device in it ("A01-40" and its type or name). */
export function rackDeviceItems(p) {
  const ix = indexProject(p);
  const items = [];
  for (const room of p.rooms) {
    for (const rack of ix.racksByRoom.get(room.id) || []) {
      items.push({ lines: [rack.code] });
      for (const d of ix.devicesByRack.get(rack.id) || []) {
        items.push({ lines: [deviceAddress(ix, d), deviceTitle(d)] });
      }
    }
  }
  return items;
}

function lineScale(i) {
  return i >= 2 ? SMALL_LINE : 1;
}

/**
 * The largest font size, in points from 14 down to 6 in half points, at which every line fits the
 * label width minus 2 mm and the text block, repeated `repeat` times, fits the label height minus
 * 2 mm. Line 1 is bold and line 3 is smaller. measure(text, points, bold) returns millimeters.
 */
export function fitFont(lines, g, repeat, measure) {
  const maxW = g.labelW - 2;
  const maxH = g.labelH - 2;
  for (let size = FONT_MAX; size >= FONT_MIN; size -= 0.5) {
    const block = lines.reduce((h, _, i) => h + size * lineScale(i) * LINE_HEIGHT * MM_PER_PT, 0);
    if (block * repeat > maxH) continue;
    if (lines.every((t, i) => measure(t, size * lineScale(i), i === 0) <= maxW)) return { size, fits: true };
  }
  return { size: FONT_MIN, fits: false };
}

/** A measure function for fitFont backed by a canvas of the given document. */
export function canvasMeasure(doc) {
  const ctx = doc.createElement("canvas").getContext("2d");
  return (text, points, bold) => {
    ctx.font = `${bold ? 700 : 400} ${points}pt ${LABEL_FONT}`;
    return ctx.measureText(text).width * MM_PER_PX;
  };
}

function mm(v) {
  return `${round(v)}mm`;
}

/**
 * Printable sheets. Returns {pages, overflow}: the page elements, and how many labels do not fit
 * their label even at the smallest font size.
 */
export function buildPages(doc, items, g, { repeat = 1, outlines = false, skip = 0, measure }) {
  const cells = placeLabels(g, items.length, skip);
  const pages = [];
  let overflow = 0;
  const pageAt = (n) => {
    while (pages.length <= n) {
      const page = doc.createElement("div");
      page.className = "sheet-page";
      page.style.width = mm(g.pageW);
      page.style.height = mm(g.pageH);
      pages.push(page);
    }
    return pages[n];
  };
  pageAt(Math.max(0, pageCount(g, items.length, skip) - 1));
  items.forEach((item, i) => {
    const cell = cells[i];
    const label = doc.createElement("div");
    label.className = outlines ? "sheet-label outlined" : "sheet-label";
    label.style.left = mm(cell.x);
    label.style.top = mm(cell.y);
    label.style.width = mm(cell.w);
    label.style.height = mm(cell.h);
    const fit = fitFont(item.lines, g, repeat, measure);
    if (!fit.fits) {
      overflow += 1;
      label.classList.add("overflow");
    }
    for (let r = 0; r < repeat; r++) {
      const block = doc.createElement("div");
      block.className = "sheet-block";
      item.lines.forEach((text, n) => {
        const line = doc.createElement("div");
        line.className = n === 0 ? "sheet-line strong" : "sheet-line";
        line.style.fontSize = `${fit.size * lineScale(n)}pt`;
        line.textContent = text;
        block.append(line);
      });
      label.append(block);
    }
    pageAt(cell.page).append(label);
  });
  return { pages, overflow };
}

/** Replaces the @page rule in the application style sheet (CSSOM, so no inline style is needed). */
export function setPageRule(doc, size, margin) {
  const sheet = [...doc.styleSheets].find((s) => (s.href || "").endsWith("/app.css"));
  if (!sheet) return;
  for (let i = sheet.cssRules.length - 1; i >= 0; i--) {
    if (sheet.cssRules[i].type === 6) sheet.deleteRule(i);
  }
  sheet.insertRule(`@page { size: ${size}; margin: ${margin}; }`, sheet.cssRules.length);
}
