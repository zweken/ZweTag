# ZweTag cable tag format

Version 1. This document is the reference for the identifiers ZweTag prints on cable labels. Anyone
may implement it; [tag-vectors.json](tag-vectors.json) holds the test vectors an implementation
must pass.

The scheme is modeled on the identifier style of ANSI/TIA-606: a cable end is named by where it is,
so the label on either end of a cable says where that end is and where the other end is. This
document is ZweTag's own description. It is not part of that standard, and ZweTag makes no claim of
conformance with it.

## Endpoint

Each end of a cable is described by these parts:

| Field | Type | Meaning |
|---|---|---|
| `kind` | `"rack"` \| `"free"` \| `"external"` | A device mounted in a rack, a device or outlet outside any rack, or an outside end such as a carrier circuit (WAN). |
| `room` | string | Room code. May be empty. |
| `rack` | string | Rack code. Used by `rack` only. |
| `u` | integer | The rack unit of the device's **top edge**. Units are counted from the bottom of the rack, the usual convention. A value below 1 means the unit is unknown. |
| `name` | string | Device or outlet name (`free`), or the name of the outside end (`external`). |
| `port` | string | Port number or port name. |

Missing fields default to `kind = "rack"`, `room = ""`, `rack = ""`, `u = 0`, `name = ""`,
`port = ""`.

## Functions

### clean(s)

Removes every whitespace character from anywhere in `s`. Whitespace means the Unicode
`White_Space` property, exactly these code points:

    U+0009..U+000D  U+0020  U+0085  U+00A0  U+1680  U+2000..U+200A
    U+2028  U+2029  U+202F  U+205F  U+3000

Letter case is kept as it is.

### padNum(s)

If `s` consists of digits only (`^[0-9]+$`), it is padded on the left with `0` to a length of 2.
Longer digit strings and anything that is not all digits are returned unchanged.

    padNum("1") = "01"    padNum("12") = "12"    padNum("144") = "144"
    padNum("0") = "00"    padNum("Gi1/0/12") = "Gi1/0/12"

### address(p)

The bare address of one end, without a room:

- `external`: `clean(name)`
- `free`: `clean(name)`, then `":" + padNum(clean(port))` when `clean(port)` is not empty
- `rack`: `clean(rack)`, then `"-" + padNum(u)` when `u >= 1`, then `":" + padNum(clean(port))`
  when `clean(port)` is not empty

Examples: `A01-40:12`, `A01-04:01`, `A02-38:Gi1/0/12`, `WO-12:01`, `A01-40`, `A01:03`, `ISP1`.

Rack codes are never padded: rack `7` stays `7`. A port name keeps its letters, so a chassis that
holds several servers can name its ports after them: `A01-30:N2-1`.

### Room prefix

An address may be prefixed with its room: `clean(room) + "." + address(p)`, for example
`SR1.A01-40:01`. The prefix mode decides when:

| Mode | Rule |
|---|---|
| `auto` (default) | Both ends get the prefix only when both rooms are non-empty and different from each other. Rooms are compared after `clean`, case-sensitively. |
| `always` | Every end with a non-empty room gets the prefix. |
| `never` | No end gets the prefix. |

An `external` end never gets a room prefix, in any mode.

### cableTag(a, b)

    cableTag(a, b) = A + " / " + B

where `A` and `B` are the addresses of end A and end B after the room prefix rule. End A always comes
first. Example: `A01-40:12 / A02-38:12`.

### topUnit(position, size)

For inventories that store the **lowest** unit a device occupies together with its height:

    topUnit(position, size) = position + max(1, size) - 1     when position >= 1
    topUnit(position, size) = 0                               when position < 1

## Printed label

The label on each end has three lines:

1. the address of this end
2. `"→ "` (U+2192, then a space) followed by the address of the other end
3. the cable code, the cable type and the length, joined by `" · "` (U+00B7 with a space on each
   side). Empty parts are left out. A length of zero means unknown and is left out; a known length
   is written as the number followed by `" m"`.

The label for end B is the same with lines 1 and 2 swapped.

    A01-40:12                  A02-38:12
    → A02-38:12                → A01-40:12
    C0017 · Cat6 · 2 m         C0017 · Cat6 · 2 m

## Test vectors

[tag-vectors.json](tag-vectors.json) has four arrays:

| Array | Checks |
|---|---|
| `cables` | `a` and `b` are endpoints, `roomPrefix` is the mode (default `auto`). `expect.a` and `expect.b` are the two addresses after the room prefix rule, `expect.tag` is `cableTag(a, b)`. |
| `topUnit` | `topUnit(u_position, size_u)`. |
| `endpoints` | Mapping from a typical inventory record to the endpoint parts above (see below). |
| `labelLines` | The three printed lines for each end, from the cable code, cable type, length in meters and the two addresses. |

Every implementation must pass `cables` and `topUnit` in full. `endpoints` applies to
implementations that read an inventory database, and `labelLines` to implementations that print
labels.

### Inventory records (`endpoints`)

Some inventories store each cable end as a flat record. The `endpoints` vectors map such a record
(`raw`) to the endpoint parts:

- `raw.kind = "external"`: `kind = "external"`, `name = raw.external_name`; every other part is
  empty (`u = 0`). The rules below apply to the other records.
- `raw.mount_type = "rack"`: `kind = "rack"`, `rack = raw.rack_code`,
  `u = topUnit(raw.u_position, raw.size_u)`.
- any other `mount_type`: `kind = "free"`, `name = raw.owner`.
- `port`: `raw.port_label` when it is not empty, otherwise `raw.absolute_index` as a decimal string.
- `room`: `raw.room_code` when it is not empty, otherwise `raw.room_name`.

This mapping does not apply `clean`; cleaning is part of `address`.
