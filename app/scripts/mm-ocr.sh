#!/usr/bin/env bash
# Re-OCR the Monster Manual scan column by column with Tesseract (in Docker) and write the page-lines JSON the
# server prefers over the scan's own, much noisier text layer. One-time job: ~5–10 minutes on a multi-core box.
#   usage: app/scripts/mm-ocr.sh "<Monster Manual.pdf>" "<out.json>"
set -euo pipefail
PDF=${1:?Monster Manual PDF}
OUT=${2:?output json}
IMAGE=jitesoft/tesseract-ocr:latest
JOBS=$(nproc)
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$WORK/col" "$WORK/hocr"

pages=$(pdfinfo "$PDF" | awk '/^Pages:/{print $2}')
echo "Rendering $pages pages as left/right column images…"
# The book is two-column throughout (wide stat blocks split down the middle too), so OCR each half on its own:
# Tesseract's page segmentation otherwise runs the columns together.
seq 1 "$pages" | xargs -P "$JOBS" -I{} sh -c '
  n=$(printf %03d {})
  read w h <<EOF
$(pdfinfo -f {} -l {} "$1" | awk "/^Page.*size:/{printf \"%d %d\", \$4*300/72, \$6*300/72}")
EOF
  half=$((w / 2))
  pdftoppm -r 300 -gray -png -f {} -l {} -singlefile -x 0 -y 0 -W $half -H $h "$1" "$2/col/p$n-L"
  pdftoppm -r 300 -gray -png -f {} -l {} -singlefile -x $half -y 0 -W $((w - half)) -H $h "$1" "$2/col/p$n-R"
' _ "$PDF" "$WORK"

echo "OCR with Tesseract ($JOBS at a time)…"
docker run --rm --user "$(id -u):$(id -g)" -e OMP_THREAD_LIMIT=1 -v "$WORK:/w" -w /w --entrypoint sh "$IMAGE" -c "
  ls col | sed 's/\.png$//' | xargs -P $JOBS -I{} tesseract col/{}.png hocr/{} --psm 4 hocr >/dev/null 2>&1"

node "$(dirname "$0")/mm-ocr-json.mjs" "$WORK/hocr" "$OUT"
