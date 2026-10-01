// ZweTag label engine: the cable tag format of spec/tag-format.md.
// Pure functions with no DOM access and no dependencies, so the same module runs in the
// browser and under `node --test`. spec/tag-vectors.json is the conformance suite.

// Unicode White_Space, exactly the code points listed in spec/tag-format.md.
const WHITESPACE = new RegExp(
  "[\\u0009-\\u000D\\u0020\\u0085\\u00A0\\u1680\\u2000-\\u200A\\u2028\\u2029\\u202F\\u205F\\u3000]",
  "g",
);

export const ROOM_PREFIX_MODES = ["auto", "always", "never"];

/** Removes every whitespace character from anywhere in the string. Letter case is kept. */
export function clean(s) {
  return String(s ?? "").replace(WHITESPACE, "");
}

/** Pads an all-digit string to two digits ("1" -> "01"). Anything else is returned unchanged. */
export function padNum(s) {
  const t = String(s ?? "");
  return /^[0-9]+$/.test(t) && t.length < 2 ? t.padStart(2, "0") : t;
}

function unitOf(u) {
  const n = Math.trunc(Number(u));
  return Number.isFinite(n) ? n : 0;
}

/**
 * The bare address of one cable end, without a room prefix.
 * p: {kind: "rack"|"free"|"external", room, rack, u, name, port}; missing fields take the defaults
 * of the spec (kind "rack", empty strings, u 0).
 */
export function address(p) {
  const kind = p?.kind || "rack";
  if (kind === "external") return clean(p.name);
  const port = clean(p.port);
  const portPart = port === "" ? "" : ":" + padNum(port);
  if (kind === "free") return clean(p.name) + portPart;
  const u = unitOf(p.u);
  return clean(p.rack) + (u >= 1 ? "-" + padNum(String(u)) : "") + portPart;
}

/**
 * Both addresses of a cable after the room prefix rule, end A first.
 * mode: "auto" (default) prefixes both ends only when both rooms are set and differ,
 * "always" prefixes every end that has a room, "never" prefixes nothing.
 * An external end is never prefixed.
 */
export function endAddresses(a, b, mode = "auto") {
  const roomA = a?.kind === "external" ? "" : clean(a?.room);
  const roomB = b?.kind === "external" ? "" : clean(b?.room);
  let prefixA = false;
  let prefixB = false;
  if (mode === "always") {
    prefixA = roomA !== "";
    prefixB = roomB !== "";
  } else if (mode !== "never") {
    prefixA = prefixB = roomA !== "" && roomB !== "" && roomA !== roomB;
  }
  return {
    a: (prefixA ? roomA + "." : "") + address(a),
    b: (prefixB ? roomB + "." : "") + address(b),
  };
}

/** The tag of a cable: "<end A> / <end B>". */
export function cableTag(a, b, mode = "auto") {
  const ends = endAddresses(a, b, mode);
  return ends.a + " / " + ends.b;
}

/** The top unit of a device stored as its lowest unit and its height; 0 when the unit is unknown. */
export function topUnit(position, size) {
  const pos = unitOf(position);
  if (pos < 1) return 0;
  return pos + Math.max(1, unitOf(size)) - 1;
}

/** "2" for 2, "2.5" for 2.5; empty for zero, negative or unparsable lengths (unknown). */
export function formatLength(lengthM) {
  const n = Number(lengthM);
  if (!Number.isFinite(n) || n <= 0) return "";
  return String(Math.round(n * 100) / 100) + " m";
}

/**
 * The three printed lines for each end of a cable.
 * c: {code, media, lengthM, a, b} where media is the display name of the cable type and a, b are
 * the two addresses (see endAddresses). Returns {a: [3 lines], b: [3 lines]}.
 */
export function labelLines(c) {
  const third = [String(c.code ?? ""), String(c.media ?? ""), formatLength(c.lengthM)]
    .filter((s) => s !== "")
    .join(" \u00b7 ");
  return {
    a: [c.a, "\u2192 " + c.b, third],
    b: [c.b, "\u2192 " + c.a, third],
  };
}
