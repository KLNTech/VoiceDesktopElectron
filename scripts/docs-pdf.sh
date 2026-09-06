#!/usr/bin/env bash
# Render repository documents to one PDF, from the Markdown that is the source of truth.
#
#   scripts/docs-pdf.sh <out.pdf> "<title>" <in.md> [in.md ...]
#
# The PDF is a RENDER, never an original. Regenerate it and commit it in the SAME change as the
# Markdown it came from, or the repository carries two documents that disagree and only one of
# them is read.
#
# Exit: 0 rendered, 2 could not act (no renderer, missing input).

set -euo pipefail

[ "$#" -ge 3 ] || { echo "usage: $(basename "$0") <out.pdf> <title> <in.md>..." >&2; exit 2; }
OUT="$1"; TITLE="$2"; shift 2
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

for f in "$@"; do [ -r "$f" ] || { echo "CANNOT ACT: unreadable input: $f" >&2; exit 2; }; done

CHROME=""
for c in "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
         "/Applications/Chromium.app/Contents/MacOS/Chromium" \
         "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"; do
  [ -x "$c" ] && { CHROME="$c"; break; }
done
[ -n "$CHROME" ] || { echo "CANNOT ACT: no Chromium-based browser found to print with" >&2; exit 2; }

TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
python3 "$HERE/md2html.py" "$TMP/doc.html" "$TITLE" "$@"

# Headless Chrome writes the PDF and then, on some versions, does not exit - the file is
# complete and the process simply stays. So the browser is not waited on: it is started, the
# OUTPUT is watched, and the process is stopped as soon as the file has stopped growing. The
# deadline below is the failure case, not the normal path.
rm -f "$OUT"
"$CHROME" --headless=new --disable-gpu --no-sandbox --no-first-run \
          --no-default-browser-check --disable-extensions --no-pdf-header-footer \
          --virtual-time-budget=10000 --user-data-dir="$TMP/profile" \
          --print-to-pdf="$OUT" "file://$TMP/doc.html" >/dev/null 2>&1 &
pid=$!
size=0
for _ in $(seq 1 120); do
  sleep 0.5
  if [ -s "$OUT" ]; then
    now=$(wc -c < "$OUT")
    [ "$now" = "$size" ] && break        # two reads the same: writing has finished
    size=$now
  fi
  kill -0 "$pid" 2>/dev/null || break    # it exited on its own
done
kill "$pid" 2>/dev/null || true
wait "$pid" 2>/dev/null || true

[ -s "$OUT" ] || { echo "CANNOT ACT: renderer produced no output within its deadline" >&2; exit 2; }
echo "rendered $OUT  ($(du -h "$OUT" | cut -f1), from: $*)"
