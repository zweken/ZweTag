#!/usr/bin/env bash
# Brings the logo kit in logo/ into the program:
#   - web/brand/: every file of logo/favicon/, the SVG marks of logo/mark/ and the two lockups,
#     replacing web/brand/ as a whole so nothing stale stays behind (gate step 11 checks the copy)
#   - web/index.html: the lines of logo/favicon/head-snippet.html between the brand markers, with
#     the paths made relative (brand/favicon/...), because the online version lives in a subfolder
#   - cmd/zwetag/rsrc_windows_amd64.syso: the Windows icon resource, made from logo/icon/ZweTag.ico
#     by rsrc (go install github.com/akavel/rsrc@latest); without rsrc the committed file stays
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."
for d in logo/favicon logo/mark logo/lockup logo/icon; do
  [ -d "$d" ] || { echo "sync-brand: $d is missing" >&2; exit 1; }
done

rm -rf web/brand
mkdir -p web/brand/favicon web/brand/mark web/brand/lockup
cp -p logo/favicon/* web/brand/favicon/
cp -p logo/mark/*.svg web/brand/mark/
cp -p logo/lockup/lockup.svg logo/lockup/lockup-dark.svg web/brand/lockup/
echo "web/brand: $(find web/brand -type f | wc -l) files from logo/"

python3 - <<'PY'
import re
snippet = open("logo/favicon/head-snippet.html", encoding="utf-8").read()
lines = [l.strip() for l in snippet.splitlines() if l.strip() and not l.strip().startswith("<!--")]
lines = [re.sub(r'(href|content)="/', r'\1="brand/favicon/', l) for l in lines]
page = open("web/index.html", encoding="utf-8").read()
begin, end = "<!-- brand:begin -->", "<!-- brand:end -->"
if page.count(begin) != 1 or page.count(end) != 1:
    raise SystemExit("sync-brand: web/index.html needs one brand:begin and one brand:end marker")
head, rest = page.split(begin)
_, tail = rest.split(end)
page = head + begin + "\n" + "\n".join(lines) + "\n" + end + tail
open("web/index.html", "w", encoding="utf-8").write(page)
print(f"web/index.html: {len(lines)} head lines from logo/favicon/head-snippet.html")
PY

RSRC="$(command -v rsrc || echo "$HOME/go/bin/rsrc")"
if [ -x "$RSRC" ]; then
  "$RSRC" -ico logo/icon/ZweTag.ico -arch amd64 -o cmd/zwetag/rsrc_windows_amd64.syso
  echo "cmd/zwetag/rsrc_windows_amd64.syso: from logo/icon/ZweTag.ico"
else
  echo "rsrc not found: cmd/zwetag/rsrc_windows_amd64.syso not refreshed"
fi
