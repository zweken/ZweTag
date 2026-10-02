#!/usr/bin/env python3
"""Checks the Windows resources of ZweTag in the .syso file linked into ZweTag.exe, or in
ZweTag.exe itself.

    check-winres.py <file> <version>

Passes when the file has icon group 1 (the icon the window loads) and version information that
names the product ZweTag, its publisher and the given version. Prints what it found and exits 0,
or prints the problems and exits 1.
"""
import struct
import sys

RT_GROUP_ICON = 14
RT_VERSION = 16
FIXED_SIGNATURE = 0xFEEF04BD
EXPECTED = {
    "ProductName": "ZweTag",
    "CompanyName": "Zweken Technology",
    "OriginalFilename": "ZweTag.exe",
}


def resource_section(data):
    """Returns the .rsrc section and the address its data entries count from."""
    image = data[:2] == b"MZ"
    if image:
        pe = struct.unpack_from("<I", data, 0x3C)[0]
        if data[pe:pe + 4] != b"PE\0\0":
            raise ValueError("not a PE file")
        header = pe + 4
    else:
        header = 0
    count = struct.unpack_from("<H", data, header + 2)[0]
    optional = struct.unpack_from("<H", data, header + 16)[0]
    table = header + 20 + optional
    for i in range(count):
        name, _, address, size, raw = struct.unpack_from("<8sIIII", data, table + 40 * i)
        if name.rstrip(b"\0") == b".rsrc":
            # In a program the data entries hold addresses in memory; in an object file
            # (.syso) they hold offsets in the section, which the linker relocates.
            return data[raw:raw + size], address if image else 0
    raise ValueError("no .rsrc section")


def entries(section, offset):
    named, numbered = struct.unpack_from("<HH", section, offset + 12)
    for i in range(named + numbered):
        yield struct.unpack_from("<II", section, offset + 16 + 8 * i)


def resources(section):
    """Maps (type, id) to the offset of the data entry of its first language."""
    found = {}
    for kind, below in entries(section, 0):
        if not below & 0x80000000:
            continue
        for ident, node in entries(section, below & 0x7FFFFFFF):
            while node & 0x80000000:
                node = next(entries(section, node & 0x7FFFFFFF))[1]
            found[(kind, ident)] = node
    return found


def version_info(block):
    """Returns the strings and the fixed part (13 numbers) of a VS_VERSIONINFO block."""
    strings, fixed = {}, None

    def walk(offset, end):
        nonlocal fixed
        while offset + 6 <= end:
            length, value_length, kind = struct.unpack_from("<HHH", block, offset)
            if length == 0:
                return
            stop = offset + length
            key_end = offset + 6
            while block[key_end:key_end + 2] != b"\0\0":
                key_end += 2
            key = block[offset + 6:key_end].decode("utf-16-le")
            value = (key_end + 2 + 3) & ~3
            if key == "VS_VERSION_INFO":
                if value_length >= 52:
                    fixed = struct.unpack_from("<13I", block, value)
                walk((value + value_length + 3) & ~3, stop)
            elif value_length == 0:
                walk(value, stop)
            elif kind == 1:
                strings[key] = block[value:stop].decode("utf-16-le").split("\0")[0]
            offset = (stop + 3) & ~3

    walk(0, len(block))
    return strings, fixed


def main():
    if len(sys.argv) != 3:
        print("usage: check-winres.py <file> <version>")
        return 2
    path, version = sys.argv[1], sys.argv[2]
    try:
        section, base = resource_section(open(path, "rb").read())
        found = resources(section)
    except (OSError, ValueError, struct.error, StopIteration) as err:
        print(f"{path}: {err}")
        return 1

    problems = []
    if (RT_GROUP_ICON, 1) not in found:
        problems.append("no icon group 1, the icon the window loads")
    if (RT_VERSION, 1) not in found:
        problems.append("no version information")
        strings, fixed = {}, None
    else:
        address, size = struct.unpack_from("<II", section, found[(RT_VERSION, 1)])
        strings, fixed = version_info(section[address - base:address - base + size])
        want = dict(EXPECTED, FileVersion=version, ProductVersion=version)
        for key, value in want.items():
            if strings.get(key) != value:
                problems.append(f"{key} is {strings.get(key)!r}, not {value!r}")
        parts = version.split(".")
        if fixed is None or fixed[0] != FIXED_SIGNATURE:
            problems.append("the fixed version block is missing")
        elif len(parts) != 3 or not all(p.isdigit() for p in parts):
            problems.append(f"{version!r} is not an x.y.z version")
        else:
            major, minor, patch = map(int, parts)
            high, low = major << 16 | minor, patch << 16
            if fixed[2:6] != (high, low, high, low):
                problems.append(f"the fixed file and product versions are not {version}.0")

    if problems:
        for problem in problems:
            print(f"{path}: {problem}")
        return 1
    print(f"icon group 1, {strings['ProductName']} {strings['ProductVersion']} by {strings['CompanyName']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
