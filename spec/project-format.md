# ZweTag project file format

Version 1. A ZweTag project is one UTF-8 JSON file, `zwetag.json` by default. The desktop program
writes it next to itself (or where `--file` points); the online version keeps the same JSON in the
browser's local storage and can save it to a file. This document describes every field and the rules
the program enforces when it opens a file.

## Example

```json
{
  "format": "zwetag-project",
  "version": 1,
  "name": "My server room",
  "settings": {
    "roomPrefix": "auto",
    "cablePrefix": "C",
    "nextCableNumber": 2,
    "seq": {"room": 2, "rack": 3, "dev": 3, "cab": 2},
    "label": {
      "preset": "a4-3x8", "repeat": 1, "thirdLine": true, "outlines": false,
      "single": {"labelW": 60, "labelH": 25},
      "custom": {"pageW": 210, "pageH": 297, "cols": 3, "rows": 8, "labelW": 63.5, "labelH": 33.9,
                 "marginTop": 12.9, "marginLeft": 7.25, "gapX": 2.5, "gapY": 0}
    },
    "theme": "system"
  },
  "rooms":   [{"id": "room-1", "code": "SR1", "name": "Server room"}],
  "racks":   [{"id": "rack-1", "roomId": "room-1", "code": "A01", "units": 42},
              {"id": "rack-2", "roomId": "room-1", "code": "A02", "units": 42}],
  "devices": [{"id": "dev-1", "rackId": "rack-1", "type": "patch-panel", "name": "", "u": 42, "height": 1,
               "ports": 24, "passThrough": true, "portNames": {}},
              {"id": "dev-2", "rackId": "rack-2", "type": "switch", "name": "SW-A02", "u": 38, "height": 1,
               "ports": 48, "passThrough": false, "portNames": {"48": "uplink"}}],
  "cables":  [{"id": "cab-1", "code": "C0001",
               "a": {"deviceId": "dev-1", "port": 12, "face": "front"},
               "b": {"deviceId": "dev-2", "port": 12, "face": "front"},
               "media": "cat6", "lengthM": 2, "taggedAs": ""}]
}
```

## Top level

| Field | Type | Meaning |
|---|---|---|
| `format` | string | Always `"zwetag-project"`. |
| `version` | integer | Format version, `1`. A file with a higher version is refused: it was written by a newer ZweTag. |
| `name` | string | Project name, up to 100 characters. |
| `settings` | object | See below. Missing settings take their defaults. |
| `rooms`, `racks`, `devices`, `cables` | arrays | The inventory. All four are required, even when empty. |

## Settings

| Field | Default | Meaning |
|---|---|---|
| `roomPrefix` | `"auto"` | Room prefix mode of the tag format: `auto`, `always` or `never` ([tag-format.md](tag-format.md)). |
| `cablePrefix` | `"C"` | Prefix of new cable codes, up to 8 characters, no whitespace. May be empty. |
| `nextCableNumber` | `1` | Number of the next cable code. Only ever goes up. |
| `seq` | all `1` | Next number for each kind of id: `room`, `rack`, `dev`, `cab`. Only ever go up. |
| `label` | see below | Label sheet settings used by Print. |
| `theme` | `"system"` | `system`, `light` or `dark`. |

`label`:

| Field | Default | Meaning |
|---|---|---|
| `preset` | `"a4-3x8"` | `a4-3x8`, `letter-3x10`, `single` or `custom`. |
| `repeat` | `1` | How many times the text block is printed on each label, 1 to 3. |
| `thirdLine` | `true` | Print the third line (cable code, type, length) on cable labels. |
| `outlines` | `false` | Print a thin outline around each label. |
| `single` | 60 x 25 | `labelW`, `labelH` in millimeters for the `single` preset. |
| `custom` | A4 3 x 8 | Every dimension of the `custom` preset, in millimeters: `pageW`, `pageH`, `cols`, `rows`, `labelW`, `labelH`, `marginTop`, `marginLeft`, `gapX`, `gapY`. |

The two fixed presets:

| Preset | Page | Columns x rows | Label | Top, left margin | Column, row gap |
|---|---|---|---|---|---|
| `a4-3x8` | 210 x 297 | 3 x 8 | 63.5 x 33.9 | 12.9, 7.25 | 2.5, 0 |
| `letter-3x10` | 215.9 x 279.4 | 3 x 10 | 66.7 x 25.4 | 12.7, 4.8 | 3.2, 0 |

## Ids

Ids are `room-N`, `rack-N`, `dev-N` and `cab-N`, where N comes from `settings.seq`. An id is never
used again, even after the item is deleted. When a file is opened, each counter is raised above the
highest id of its kind if needed. Ids must be unique across the whole file.

## Rooms

| Field | Meaning |
|---|---|
| `id` | Room id. |
| `code` | Room code used in tags, unique in the project ignoring letter case. Stored without whitespace. Default `SR1`, `SR2`, ... |
| `name` | Optional description. |

## Racks

| Field | Meaning |
|---|---|
| `id` | Rack id. |
| `roomId` | The room the rack stands in. |
| `code` | Rack code used in tags, unique in the whole project ignoring letter case. Stored without whitespace. Default: a row letter per room and two digits, `A01`, `A02` in the first room, `B01` in the second. |
| `units` | Height in rack units, 1 to 60. |

## Devices

| Field | Meaning |
|---|---|
| `id` | Device id. |
| `rackId` | The rack the device is mounted in. |
| `type` | One of the types below. |
| `name` | Optional name, up to 100 characters. Not part of tags. |
| `u` | The **top** unit of the device. Units count from the bottom of the rack, so a 2U device with `u = 40` occupies units 39 and 40. |
| `height` | Height in units, at least 1. |
| `ports` | Number of ports, 1 to 288. |
| `passThrough` | `true` when the device has a front and a rear side, like a patch panel. Only such devices take cables on `rear`. |
| `portNames` | Optional names by port number, used in tags instead of the number (`{"4": "iLO"}`). |

A device must lie inside its rack (`u <= units`, `u - height + 1 >= 1`) and may not overlap another
device in the same rack. No two ports of a device may end up with the same tag text; a port named
`"7"` and port 7 would.

| `type` | Name | Default height | Default ports | Default `passThrough` |
|---|---|---|---|---|
| `patch-panel` | Patch panel | 1 | 24 | true |
| `switch` | Switch | 1 | 48 | false |
| `router` | Router / firewall | 1 | 8 | false |
| `server` | Server | 2 | 4 | false |
| `storage` | Storage | 2 | 4 | false |
| `san-switch` | SAN switch | 1 | 24 | false |
| `kvm` | KVM / console | 1 | 16 | false |
| `other` | Other | 1 | 8 | false |

## Cables

| Field | Meaning |
|---|---|
| `id` | Cable id. |
| `code` | Cable code, unique in the file. New cables get `cablePrefix` and a four-digit number (`C0001`). |
| `a`, `b` | The two ends: `deviceId`, `port` (1 to the device's `ports`) and `face` (`front` or `rear`). |
| `media` | Cable type, see below. |
| `lengthM` | Length in meters; `0` means unknown. |
| `taggedAs` | The tag the cable carried when it was last marked as labeled, or `""`. |

Each end position (device, port, face) takes at most one cable, and a cable cannot join a position
to itself. `rear` is allowed only on `passThrough` devices.

Cable types: `cat5e` Cat5e, `cat6` Cat6, `cat6a` Cat6A, `cat8` Cat8, `om3` Fiber OM3, `om4` Fiber OM4,
`om5` Fiber OM5, `os2` Fiber OS2, `dac` DAC, `aoc` AOC, `coax` Coax, `other` Other.

### Label state

The current tag of a cable follows [tag-format.md](tag-format.md) from its two ends. The state is:

- `unlabeled` when `taggedAs` is empty,
- `labeled` when `taggedAs` equals the current tag,
- `relabel` otherwise: something that is part of the tag changed after the label was printed (the
  device moved, a rack or room code changed, a port was renamed, or the room prefix mode changed).

## Limits

200 racks, 5,000 devices and 20,000 cables per project. The program refuses changes and files beyond
these limits.

## Opening a file

The program checks, in this order, and refuses the file with the first problem it finds: the format
and version, the four lists, rooms (codes), racks (room, code, height), devices (rack, type, position
inside the rack, overlap, ports, port names), and cables (code, ends, ports, faces, positions used
twice, type, length).
