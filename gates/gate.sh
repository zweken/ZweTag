#!/usr/bin/env bash
#
# ZweTag checks. Run from anywhere; works on the repository root.
#
#   gates/gate.sh          all checks; steps that need README.md or logo/ say SKIP until they exist
#   gates/gate.sh --full   the same, but a SKIP counts as a failure (CI and releases)
#
# Needs Go 1.25 or newer and Node 22 or newer on PATH.
set -uo pipefail

cd "$(dirname "$0")/.." || exit 2
FULL=0
[ "${1:-}" = "--full" ] && FULL=1

failed=0
skipped=0
pass() { printf 'ok    %2s  %s\n' "$1" "$2"; }
fail() { printf 'FAIL  %2s  %s\n' "$1" "$2"; failed=$((failed + 1)); }
skip() {
  printf 'SKIP  %2s  %s\n' "$1" "$2"
  skipped=$((skipped + 1))
  [ "$FULL" = 1 ] && failed=$((failed + 1))
}
show() { sed 's/^/        /' | head -n 40; }

# Files of the publishable tree: tracked or new files that are not ignored, minus Documents/.
tree_files() {
  if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    git ls-files --cached --others --exclude-standard -- . | while IFS= read -r f; do [ -f "$f" ] && printf '%s\n' "$f"; done
  else
    find . -type f -not -path './.git/*' -not -path './dist/*' | sed 's|^\./||'
  fi | grep -v '^Documents/' | sort -u
}

# 1. gofmt
out=$(gofmt -l . 2>&1)
if [ -z "$out" ]; then pass 1 "gofmt"; else fail 1 "gofmt: files need formatting"; printf '%s\n' "$out" | show; fi

# 2. go vet, for this system and for Windows
out=$( { go vet ./... && GOOS=windows GOARCH=amd64 go vet ./...; } 2>&1 )
if [ $? -eq 0 ]; then pass 2 "go vet (host and windows)"; else fail 2 "go vet"; printf '%s\n' "$out" | show; fi

# 3. go test
out=$(go test -race -count=1 ./... 2>&1)
if [ $? -eq 0 ]; then pass 3 "go test -race"; else fail 3 "go test"; printf '%s\n' "$out" | show; fi

# 4. interface tests
out=$(node --test 'test/*.test.mjs' 2>&1)
if [ $? -eq 0 ]; then
  pass 4 "node --test ($(printf '%s\n' "$out" | sed -n 's/^.*pass \([0-9]*\)$/\1/p' | tail -n 1) passed)"
else
  fail 4 "node --test"; printf '%s\n' "$out" | grep -E 'not ok|fail|Error' | show
fi

# 5. every interface module parses
bad=""
while IFS= read -r f; do
  node --input-type=module --check < "$f" >/dev/null 2>&1 || bad="$bad $f"
done < <(find web/assets -name '*.js' | sort)
if [ -z "$bad" ]; then pass 5 "module syntax (web/assets)"; else fail 5 "module syntax:$bad"; fi

# 6. English only: no Arabic-script characters outside Documents/
out=$(tree_files | python3 -c '
import re, sys
bad = re.compile("[%s-%s%s-%s%s-%s%s-%s]" % tuple(map(chr, (0x600, 0x6FF, 0x750, 0x77F, 0xFB50, 0xFDFF, 0xFE70, 0xFEFF))))
skip = (".png", ".ico", ".syso", ".exe", ".gz", ".zip", ".woff", ".woff2")
for name in sys.stdin.read().split("\n"):
    if not name or name.endswith(skip):
        continue
    data = open(name, "rb").read()
    if b"\0" in data:
        continue
    for n, line in enumerate(data.decode("utf-8", "replace").split("\n"), 1):
        if bad.search(line):
            print(f"{name}:{n}")
')
if [ -z "$out" ]; then pass 6 "English only"; else fail 6 "Arabic-script characters found"; printf '%s\n' "$out" | show; fi

# 7. the interface makes no outside requests
out=$(grep -rhoE 'https?://[^"'"'"' <>)`]*' web 2>/dev/null | sort -u | grep -vxE 'https://github\.com/zweken/ZweTag|https://www\.zweken\.com|http://www\.w3\.org/.*')
if [ -z "$out" ]; then pass 7 "no outside addresses in web/"; else fail 7 "outside addresses in web/"; printf '%s\n' "$out" | show; fi

# 8. no placeholders
words="TO""DO|FIX""ME|X""XX"
out=$(tree_files | grep -v '\.\(png\|ico\|syso\|exe\)$' | xargs -d '\n' grep -nE "\\b($words)\\b|[Ll]orem" 2>/dev/null)
if [ -z "$out" ]; then pass 8 "no placeholders"; else fail 8 "placeholders found"; printf '%s\n' "$out" | show; fi

# 9. the license is the unmodified Apache License 2.0
want=cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30
got=$(sha256sum LICENSE 2>/dev/null | cut -d' ' -f1)
if [ "$got" = "$want" ]; then pass 9 "LICENSE is Apache-2.0"; else fail 9 "LICENSE sha256 ${got:-missing}"; fi

# 10. every image the README shows exists
if [ ! -f README.md ]; then
  skip 10 "README images (no README.md yet)"
else
  missing=""
  while IFS= read -r ref; do
    case "$ref" in http://*|https://*|"") continue ;; esac
    [ -f "$ref" ] || missing="$missing $ref"
  done < <(grep -oE '(src|srcset)="[^"]+"|!\[[^]]*\]\([^)]+\)' README.md | sed -E 's/^(src|srcset)="([^"]+)"$/\2/; s/^!\[[^]]*\]\(([^)]+)\)$/\1/')
  if [ -z "$missing" ]; then pass 10 "README images exist"; else fail 10 "README images missing:$missing"; fi
fi

# 11. web/brand/ is the copy of logo/ that scripts/sync-brand.sh makes
if [ ! -d logo ]; then
  skip 11 "web/brand matches logo/ (no logo/ yet)"
else
  want=$( { (cd logo && find favicon -type f; find mark -type f -name '*.svg'; ls lockup/lockup.svg lockup/lockup-dark.svg) 2>/dev/null; } | sort)
  have=$( (cd web/brand && find . -type f | sed 's|^\./||') | sort)
  diffs=""
  [ "$want" = "$have" ] || diffs="file lists differ"
  if [ -z "$diffs" ]; then
    while IFS= read -r f; do cmp -s "logo/$f" "web/brand/$f" || diffs="$diffs $f"; done <<< "$want"
  fi
  if [ -z "$diffs" ]; then pass 11 "web/brand matches logo/"; else fail 11 "web/brand differs from logo/: $diffs"; fi
fi

# 12. ZweTag.exe gets its icon and version information that matches the online build
version=$(sed -n 's/^export const VERSION = "\(.*\)";$/\1/p' web/assets/about.js)
out=$(python3 gates/check-winres.py cmd/zwetag/rsrc_windows_amd64.syso "$version" 2>&1)
if [ $? -eq 0 ]; then pass 12 "Windows resources: $out"; else fail 12 "Windows resources (scripts/winres.sh makes them)"; printf '%s\n' "$out" | show; fi

if [ "$failed" -ne 0 ]; then
  echo "gate: RED ($failed failed)"
  exit 1
fi
if [ "$skipped" -ne 0 ]; then echo "gate: GREEN ($skipped skipped)"; else echo "gate: GREEN"; fi
