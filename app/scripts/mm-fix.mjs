// Send the Monster Manual pages whose stat blocks the OCR parse got wrong (unnamed, or missing AC / HP / CR /
// ability scores) to ChatGPT through the app's linked Codex CLI, and save its transcriptions as a fixes file the
// server merges in (MM_FIXES_JSON). Resumable: pages already in the fixes file are skipped.
//   usage: node scripts/mm-fix.mjs <book.pdf> <ocr.json> <fixes.json> [container] [parallel]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { parseMonsterManual, parseIndex } from '../server/monsterManual.js';

const run = promisify(execFile);
const [book, ocrFile, outFile, container = 'dnd-table-app-1', parallel = '1'] = process.argv.slice(2);
if (!book || !ocrFile || !outFile) { console.error('usage: node scripts/mm-fix.mjs <book.pdf> <ocr.json> <fixes.json> [container] [parallel]'); process.exit(1); }
const schema = path.join(path.dirname(new URL(import.meta.url).pathname), 'mm-statblock.schema.json');

const { pages } = JSON.parse(fs.readFileSync(ocrFile, 'utf8'));
const text = (a, b) => pages.filter((p) => p.page >= a && p.page <= b).flatMap((p) => p.lines.map((l) => l.text)).join('\n');
const monsters = parseMonsterManual(pages, text(5, 10), text(376, 390));
const known = new Set(monsters.knownNames);
const failed = monsters.filter((m) => m.name.startsWith('Unknown') || !known.has(m.name) || m.ac == null || m.hp == null || !m.cr || Object.keys(m.abilities).length < 6);
// Monsters in the book's index that the parse never found: send their page too (book page → PDF page via nearby blocks).
const have = new Set(monsters.map((m) => m.name));
const toPdf = (bp) => {
  const near = monsters.filter((m) => Math.abs(m.page - bp) <= 15).map((m) => m.pdf_page - m.page).sort((a, b) => a - b);
  return bp + (near.length ? near[Math.floor(near.length / 2)] : 3);
};
// Tesseract often loses index page numbers; the scan's own (noisier) index text has most of them.
const { stdout: scanIndex } = await run('pdftotext', ['-layout', '-f', '5', '-l', '10', book, '-']);
const entries = [...monsters.indexEntries, ...parseIndex(scanIndex)];
const missing = [...new Map(entries.filter((e) => !have.has(e.name) && e.page >= 10 && e.page <= 373).map((e) => [e.name, e])).values()];
const todoAll = [...new Set([...failed.map((m) => m.pdf_page), ...missing.map((e) => toPdf(e.page))])].sort((a, b) => a - b);
console.log(`${missing.length} index entries are missing from the catalog: ${missing.map((e) => e.name).join(', ')}`);

const fixes = fs.existsSync(outFile) ? JSON.parse(fs.readFileSync(outFile, 'utf8')) : { source: 'ChatGPT (Codex) transcription of page images', pages: {} };
const todo = todoAll.filter((p) => !fixes.pages[p]);
console.log(`${failed.length} stat blocks need help on ${todoAll.length} pages; ${todo.length} still to send.`);

const PROMPT = "This image is one page of the user's own copy of the D&D Monster Manual (2024). Transcribe every creature stat block "
  + 'whose name and AC/HP header appear on this page into the JSON schema, exactly as printed. Do not paraphrase or invent values; use null '
  + '(numbers) or an empty string for anything unreadable, missing or cut off. saves: the numbers in the SAVE column. sections: Traits, '
  + 'Actions, Bonus Actions, Reactions, Legendary Actions in printed order, each entry as {name, text} without the trailing period on the '
  + 'name. Ignore lore text, tables, captions and sidebars. If the page has no stat block header, return {"monsters": []}.';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-fix-'));
await run('docker', ['exec', container, 'mkdir', '-p', '/tmp/mmfix']);
await run('docker', ['cp', schema, `${container}:/tmp/mmfix/schema.json`]);

const save = () => fs.writeFileSync(outFile, JSON.stringify(fixes, null, 1));
let done = 0;
async function page(p) {
  // ChatGPT rate-limits bursts (429): wait and retry, backing off, before giving up on the page.
  const codex = async (attempt = 0) => {
    try {
      return await run('docker', ['exec', '-e', 'CODEX_HOME=/data/codex', container, 'codex', 'exec', '--skip-git-repo-check', '--ephemeral', '-s', 'read-only',
      '-C', '/tmp/mmfix', '-i', `/tmp/mmfix/p${p}.jpg`, '--output-schema', '/tmp/mmfix/schema.json', '-o', `/tmp/mmfix/p${p}.out`, PROMPT],
    { timeout: 300000, maxBuffer: 16 * 1024 * 1024 });
    } catch (e) {
      if (attempt < 6 && /429|Too Many Requests|rate limit/i.test(String(e.stderr || e.message))) {
        const wait = 30 * 2 ** attempt;
        console.log(`  page ${p}: rate-limited, waiting ${wait}s…`);
        await new Promise((r) => setTimeout(r, wait * 1000));
        return codex(attempt + 1);
      }
      throw e;
    }
  };
  try {
    const img = path.join(tmp, `p${p}.jpg`);
    await run('pdftoppm', ['-r', '150', '-jpeg', '-f', String(p), '-l', String(p), '-singlefile', book, img.replace(/\.jpg$/, '')]);
    await run('docker', ['cp', img, `${container}:/tmp/mmfix/p${p}.jpg`]);
    await codex();
    const { stdout } = await run('docker', ['exec', container, 'cat', `/tmp/mmfix/p${p}.out`], { maxBuffer: 16 * 1024 * 1024 });
    fixes.pages[p] = JSON.parse(stdout).monsters;
    save();
    console.log(`[${++done}/${todo.length}] page ${p}: ${fixes.pages[p].map((m) => m.name).join(', ') || '(no stat block)'}`);
  } catch (e) {
    console.log(`[${++done}/${todo.length}] page ${p}: FAILED (${String(e.stderr || e.message).split('\n').filter(Boolean).slice(-1)[0]}) — run again to retry`);
  } finally {
    await run('docker', ['exec', container, 'rm', '-f', `/tmp/mmfix/p${p}.jpg`, `/tmp/mmfix/p${p}.out`]).catch(() => {});
  }
}
const queue = [...todo];
await Promise.all(Array.from({ length: Number(parallel) }, async () => { while (queue.length) await page(queue.shift()); }));
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`Done: ${Object.keys(fixes.pages).length} pages in ${outFile}. Run 'make up' so the app re-reads the monsters.`);
