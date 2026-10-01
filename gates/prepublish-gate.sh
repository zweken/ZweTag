#!/usr/bin/env bash
# Gate: run over a tree that is about to be published, before anything is pushed.
#
# Publishing is one-way. This checks what cannot be taken back: required files, files that must
# never leave the machine, keys, private network addresses, private names and non-English text.
#
# Usage:  prepublish-gate.sh <tree> <private-terms-file>
#
# The private-terms file (one term per line, '#' comments) names what must never appear in public.
# It lives outside the published tree, so the public repository never carries the list of what to
# hide. When ZWETAG_TAG is set (for example v1.0.0), the newest version in CHANGELOG.md and the
# version of the online build must match it.
set -uo pipefail

tree="${1:-}"
terms="${2:-}"
pass=0
fail=0
self=$(basename "${BASH_SOURCE[0]}")

say() { printf '%s\n' "$*"; }
ok() { pass=$((pass + 1)); say "  PASS  $*"; }
bad() { fail=$((fail + 1)); say "  FAIL  $*"; }

say "== ZweTag pre-publish gate over: $tree"
[ -n "$tree" ] && [ -d "$tree" ] || { say "  FAIL  not a directory: $tree"; exit 1; }

# ---- files that must exist -----------------------------------------------
for f in README.md LICENSE NOTICE THIRD-PARTY-NOTICES.md SECURITY.md CONTRIBUTING.md CHANGELOG.md \
         go.mod web/index.html logo/icon/ZweTag.ico; do
  if [ -f "$tree/$f" ]; then ok "$f present"; else bad "$f is missing"; fi
done

# ---- files that must NOT exist -------------------------------------------
forbidden=$(cd "$tree" && find . -not -path './.git/*' \( \
  -path './Documents' -o -path './dist' -o -name 'zwetag.json' -o -name '*.bak' -o -name '*.log' \
  -o -name 'exports' -o -name '.claude' -o -name 'id_*' -o -name '*.pem' -o -name '*.key' \) -print 2>/dev/null)
if [ -z "$forbidden" ]; then
  ok "no internal documents, build output, project data, logs or keys"
else
  bad "these must not be published:"; printf '        %s\n' $forbidden
fi

# ---- generic secrets -----------------------------------------------------
scan() { grep -rIn --exclude-dir=.git --exclude="$self" -e "$1" "$tree" 2>/dev/null || true; }
for p in 'BEGIN OPENSSH PRIVATE KEY' 'BEGIN RSA PRIVATE KEY' 'BEGIN EC PRIVATE KEY' 'BEGIN PRIVATE KEY' \
         'PRIVATE KEY-----' 'AWS_SECRET' 'ghp_' 'github_pat_'; do
  hits=$(scan "$p")
  if [ -z "$hits" ]; then ok "no '$p'"; else bad "'$p' appears:"; printf '        %s\n' "$(printf '%s' "$hits" | head -5)"; fi
done

# ---- private network addresses (127.0.0.1 is the only address the program uses) ----
hits=$(grep -rInE --exclude-dir=.git --exclude="$self" \
  '\b(192\.168\.[0-9]{1,3}\.[0-9]{1,3}|10\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}|172\.(1[6-9]|2[0-9]|3[01])\.[0-9]{1,3}\.[0-9]{1,3}|169\.254\.[0-9]{1,3}\.[0-9]{1,3}|100\.(6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\.[0-9]{1,3}\.[0-9]{1,3})\b' \
  "$tree" 2>/dev/null || true)
if [ -z "$hits" ]; then ok "no private network addresses"; else bad "private network addresses:"; printf '        %s\n' "$(printf '%s' "$hits" | head -5)"; fi

# ---- private terms -------------------------------------------------------
if [ -n "$terms" ] && [ -f "$terms" ]; then
  n=0
  found=0
  while IFS= read -r term; do
    case "$term" in '' | '#'*) continue ;; esac
    n=$((n + 1))
    hits=$(grep -rIni --exclude-dir=.git -F -e "$term" "$tree" 2>/dev/null || true)
    if [ -n "$hits" ]; then
      bad "a private term appears in the tree (term withheld from this output)"
      printf '        %s\n' "$(printf '%s' "$hits" | head -3 | sed 's/:.*/: <line withheld>/')"
      found=$((found + 1))
    fi
  done < "$terms"
  [ "$found" -eq 0 ] && ok "none of the $n private terms appear"
else
  bad "no private-terms file given: private names were NOT checked"
fi

# ---- English only --------------------------------------------------------
hits=$(cd "$tree" && find . -type f -not -path './.git/*' -print0 | python3 -c '
import re, sys
bad = re.compile("[%s-%s%s-%s%s-%s%s-%s]" % tuple(map(chr, (0x600, 0x6FF, 0x750, 0x77F, 0xFB50, 0xFDFF, 0xFE70, 0xFEFF))))
for name in sys.stdin.buffer.read().split(b"\0"):
    if not name:
        continue
    data = open(name, "rb").read()
    if b"\0" in data:
        continue
    if bad.search(data.decode("utf-8", "replace")):
        print(name.decode("utf-8", "replace"))
')
if [ -z "$hits" ]; then ok "no Persian or Arabic text"; else bad "Persian or Arabic text in:"; printf '        %s\n' $hits; fi

# ---- release version -----------------------------------------------------
if [ -n "${ZWETAG_TAG:-}" ]; then
  want="${ZWETAG_TAG#v}"
  top=$(grep -m1 -oE '^## \[[0-9]+\.[0-9]+\.[0-9]+\]' "$tree/CHANGELOG.md" 2>/dev/null | tr -d '#[] ')
  if [ "$top" = "$want" ]; then ok "CHANGELOG.md newest version is $want"; else bad "CHANGELOG.md newest version is '${top:-none}', not $want"; fi
  web=$(sed -n 's/^export const VERSION = "\(.*\)";$/\1/p' "$tree/web/assets/about.js" 2>/dev/null)
  if [ "$web" = "$want" ]; then ok "online build says $want"; else bad "web/assets/about.js says '${web:-none}', not $want"; fi
fi

say ""
say "== pass=$pass fail=$fail"
[ "$fail" -eq 0 ]
