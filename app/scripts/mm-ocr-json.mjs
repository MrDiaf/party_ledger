// Assemble Tesseract hOCR files (one per page column: p<NNN>-L.hocr / p<NNN>-R.hocr) into the page-lines JSON the
// server reads (MM_OCR_JSON). Usage: node scripts/mm-ocr-json.mjs <hocr dir> <out.json>
import fs from 'node:fs';
import path from 'node:path';
import { hocrLines } from '../server/monsterManual.js';

const [dir, out] = process.argv.slice(2);
if (!dir || !out) { console.error('usage: node scripts/mm-ocr-json.mjs <hocr dir> <out.json>'); process.exit(1); }
const files = fs.readdirSync(dir).filter((f) => /^p\d+-[LR]\.hocr$/.test(f));
const nums = [...new Set(files.map((f) => Number(/^p(\d+)/.exec(f)[1])))].sort((a, b) => a - b);
const read = (n, side) => { const f = path.join(dir, `p${String(n).padStart(3, '0')}-${side}.hocr`); return fs.existsSync(f) ? hocrLines(fs.readFileSync(f, 'utf8')) : []; };
const pages = nums.map((n) => ({ page: n, lines: [...read(n, 'L'), ...read(n, 'R')] }));
fs.writeFileSync(out, JSON.stringify({ source: 'tesseract hOCR, column by column', pages }));
console.log(`${pages.length} pages, ${pages.reduce((s, p) => s + p.lines.length, 0)} lines → ${out}`);
