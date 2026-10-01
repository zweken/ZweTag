#!/usr/bin/env bash
# Builds the four release binaries into dist/:
#
#   scripts/build.sh <version>
#
#   dist/ZweTag.exe            windows/amd64, a GUI program (no console)
#   dist/zwetag-linux-amd64    linux/amd64
#   dist/zwetag-darwin-arm64   darwin/arm64
#   dist/zwetag-darwin-amd64   darwin/amd64
#
# Every binary is pure Go and statically linked (CGO_ENABLED=0), built with
# -trimpath so no path of the build machine ends up inside it. Needs Go 1.25
# or later on PATH.
set -euo pipefail

if [ "$#" -ne 1 ]; then
	echo "usage: scripts/build.sh <version>" >&2
	exit 2
fi
version=$1
if ! [[ $version =~ ^[0-9A-Za-z][0-9A-Za-z.+-]*$ ]]; then
	echo "build.sh: invalid version \"$version\"" >&2
	exit 2
fi

cd "$(dirname "${BASH_SOURCE[0]}")/.."
export CGO_ENABLED=0
mkdir -p dist

build() {
	local goos=$1 goarch=$2 out=dist/$3 ldflags=$4
	rm -f "$out"
	echo "building $out ($goos/$goarch, $version)"
	GOOS=$goos GOARCH=$goarch go build -trimpath -ldflags "$ldflags" -o "$out" ./cmd/zwetag
}

build windows amd64 ZweTag.exe "-s -w -H windowsgui -X main.Version=$version"
build linux amd64 zwetag-linux-amd64 "-s -w -X main.Version=$version"
build darwin arm64 zwetag-darwin-arm64 "-s -w -X main.Version=$version"
build darwin amd64 zwetag-darwin-amd64 "-s -w -X main.Version=$version"
