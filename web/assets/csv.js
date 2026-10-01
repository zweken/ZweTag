// CSV export: UTF-8 with a byte order mark, CRLF line ends, RFC 4180 quoting, and a guard
// against spreadsheet formulas (a cell starting with = + - or @ gets a leading apostrophe).

import { labelLines } from "./engine.js";
import { indexProject, cableAddresses, labelState, mediaName, portLabel } from "./model.js";

const BOM = String.fromCharCode(0xfeff);

export function csvCell(value) {
  let s = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@]/.test(s)) s = "'" + s;
  if (/[",\r\n]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
  return s;
}

export function toCsv(rows) {
  return BOM + rows.map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

export const CABLE_COLUMNS = [
  "code", "end_a", "end_b", "media", "length_m", "status",
  "room_a", "rack_a", "unit_a", "port_a", "face_a",
  "room_b", "rack_b", "unit_b", "port_b", "face_b",
];

export const LABEL_COLUMNS = ["code", "side", "line1", "line2", "line3"];

function endColumns(ix, end) {
  const d = ix.devices.get(end.deviceId);
  const rack = d ? ix.racks.get(d.rackId) : null;
  const room = rack ? ix.rooms.get(rack.roomId) : null;
  return [room ? room.code : "", rack ? rack.code : "", d ? d.u : "", d ? portLabel(d, end.port) : end.port, end.face];
}

function lengthCell(lengthM) {
  return lengthM > 0 ? lengthM : "";
}

/** One row per cable, in the order given. */
export function cablesCsv(p, cables) {
  const ix = indexProject(p);
  const rows = [CABLE_COLUMNS];
  for (const c of cables) {
    const ends = cableAddresses(p, ix, c);
    rows.push([
      c.code, ends.a, ends.b, mediaName(c.media), lengthCell(c.lengthM), labelState(p, ix, c),
      ...endColumns(ix, c.a), ...endColumns(ix, c.b),
    ]);
  }
  return toCsv(rows);
}

/** Two rows per cable, end A then end B, with the three printed lines of each label. */
export function labelsCsv(p, cables) {
  const ix = indexProject(p);
  const rows = [LABEL_COLUMNS];
  for (const c of cables) {
    const ends = cableAddresses(p, ix, c);
    const lines = labelLines({ code: c.code, media: mediaName(c.media), lengthM: c.lengthM, a: ends.a, b: ends.b });
    rows.push([c.code, "A", ...lines.a]);
    rows.push([c.code, "B", ...lines.b]);
  }
  return toCsv(rows);
}

