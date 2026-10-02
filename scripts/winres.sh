#!/usr/bin/env bash
# Makes cmd/zwetag/rsrc_windows_amd64.syso, the Windows resources linked into ZweTag.exe:
#   - the program icon from logo/icon/ZweTag.ico, as icon group 1 (the one the window loads)
#   - the version information Windows shows in the file's properties: product name, version,
#     publisher and copyright. The version is the one in web/assets/about.js.
#
#   scripts/winres.sh
#
# Run it after changing the icon or the version; gate step 12 checks the committed file against
# web/assets/about.js. Uses goversioninfo (github.com/josephspurrier/goversioninfo) through go run.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."
version=$(sed -n 's/^export const VERSION = "\(.*\)";$/\1/p' web/assets/about.js)
if ! [[ $version =~ ^([0-9]+)\.([0-9]+)\.([0-9]+)$ ]]; then
	echo "winres.sh: web/assets/about.js has no x.y.z version" >&2
	exit 1
fi
major=${BASH_REMATCH[1]} minor=${BASH_REMATCH[2]} patch=${BASH_REMATCH[3]}

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
cat >"$tmp/versioninfo.json" <<EOF
{
  "FixedFileInfo": {
    "FileVersion": {"Major": $major, "Minor": $minor, "Patch": $patch, "Build": 0},
    "ProductVersion": {"Major": $major, "Minor": $minor, "Patch": $patch, "Build": 0},
    "FileFlagsMask": "3f",
    "FileFlags": "00",
    "FileOS": "040004",
    "FileType": "01",
    "FileSubType": "00"
  },
  "StringFileInfo": {
    "CompanyName": "Zweken Technology",
    "FileDescription": "ZweTag",
    "FileVersion": "$version",
    "InternalName": "zwetag",
    "LegalCopyright": "Copyright 2026 Zweken Technology",
    "OriginalFilename": "ZweTag.exe",
    "ProductName": "ZweTag",
    "ProductVersion": "$version"
  },
  "VarFileInfo": {
    "Translation": {"LangID": "0409", "CharsetID": "04B0"}
  }
}
EOF

go run github.com/josephspurrier/goversioninfo/cmd/goversioninfo@v1.7.0 \
	-64 -arm=false -icon logo/icon/ZweTag.ico -o cmd/zwetag/rsrc_windows_amd64.syso "$tmp/versioninfo.json"
echo "cmd/zwetag/rsrc_windows_amd64.syso: icon from logo/icon/ZweTag.ico, version $version"
