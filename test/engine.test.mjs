// Conformance of web/assets/engine.js with spec/tag-vectors.json, one test per vector.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  clean,
  padNum,
  address,
  endAddresses,
  cableTag,
  topUnit,
  labelLines,
} from "../web/assets/engine.js";

const vectors = JSON.parse(readFileSync(new URL("../spec/tag-vectors.json", import.meta.url), "utf8"));

const DEFAULTS = { kind: "rack", room: "", rack: "", u: 0, name: "", port: "" };

test("vector file header", () => {
  assert.equal(vectors.format, "zwetag-vectors");
  assert.equal(vectors.version, 1);
  assert.ok(vectors.cables.length > 0 && vectors.topUnit.length > 0 && vectors.labelLines.length > 0);
});

for (const v of vectors.cables) {
  test(`cables: ${v.name}`, () => {
    const a = { ...DEFAULTS, ...v.a };
    const b = { ...DEFAULTS, ...v.b };
    const mode = v.roomPrefix ?? "auto";
    const ends = endAddresses(a, b, mode);
    assert.equal(ends.a, v.expect.a, "end A");
    assert.equal(ends.b, v.expect.b, "end B");
    assert.equal(cableTag(a, b, mode), v.expect.tag, "tag");
  });
}

for (const v of vectors.topUnit) {
  test(`topUnit(${v.u_position}, ${v.size_u})`, () => {
    assert.equal(topUnit(v.u_position, v.size_u), v.expect);
  });
}

for (const v of vectors.labelLines) {
  test(`labelLines: ${v.code}`, () => {
    const lines = labelLines(v);
    assert.deepEqual(lines.a, v.expectA, "end A");
    assert.deepEqual(lines.b, v.expectB, "end B");
  });
}

test("clean removes every Unicode whitespace and keeps case", () => {
  const ws = "\t\n\u000b\f\r \u0085\u00a0\u1680\u2000\u2005\u200a\u2028\u2029\u202f\u205f\u3000";
  assert.equal(clean(ws + "A" + ws + "b" + ws), "Ab");
  assert.equal(clean("\u200bX"), "\u200bX", "zero width space is not whitespace");
  assert.equal(clean(undefined), "");
});

test("padNum", () => {
  assert.equal(padNum("1"), "01");
  assert.equal(padNum("12"), "12");
  assert.equal(padNum("144"), "144");
  assert.equal(padNum("0"), "00");
  assert.equal(padNum(""), "");
  assert.equal(padNum("Gi1/0/12"), "Gi1/0/12");
  assert.equal(padNum("1a"), "1a");
});

test("address defaults to a rack end", () => {
  assert.equal(address({ rack: "A01", u: 40, port: "12" }), "A01-40:12");
  assert.equal(address({ rack: "A01", u: 40, port: 12 }), "A01-40:12", "numeric port");
});
