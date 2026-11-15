// Rules lookup for the AI assistant: the owner's PHB PDF (text extracted once with pdftotext)
// plus the bundled SRD data. Simple term-frequency scoring over pages — fine for ~300 pages;
// switch to SQLite FTS5 if the reference library grows a lot.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { DATA_DIR } from './db.js';
import srd from './data/srd.json' with { type: 'json' };

let pages = null;

function loadPhb() {
  if (pages) return pages;
  pages = [];
  const pdf = process.env.PHB_PDF || path.resolve('..', 'PHB-5e.pdf');
  const cache = path.join(DATA_DIR, 'phb-pages.json');
  try {
    if (fs.existsSync(cache)) pages = JSON.parse(fs.readFileSync(cache, 'utf8'));
    else if (fs.existsSync(pdf)) {
      const txt = execFileSync('pdftotext', ['-layout', pdf, '-'], { maxBuffer: 64 * 1024 * 1024 }).toString();
      // OCR'd headings come out letter-spaced ("C h a p t e r"); collapse those runs so they are searchable.
      pages = txt.split('\f').map((t, i) => ({ page: i + 1, text: t.replace(/\b(?:\w ){3,}\w\b/g, (s) => s.replace(/ /g, '')).replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim() }));
      fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(cache, JSON.stringify(pages));
    }
  } catch (e) {
    console.warn('PHB text extraction failed:', e.message);
  }
  return pages;
}

export const phbAvailable = () => loadPhb().length > 0;

const terms = (q) => String(q).toLowerCase().split(/[^a-z0-9']+/).filter((w) => w.length > 2);

export function lookupRules(query, limit = 3) {
  const t = terms(query);
  const q = String(query).toLowerCase().trim();
  const out = [];
  for (const s of srd.spells) if (s.name.toLowerCase() === q) out.push({ source: 'SRD spell', title: s.name, text: `Level ${s.level} ${s.school}; ${s.casting_time}; range ${s.range}; ${s.components}${s.material ? ` (${s.material})` : ''}; ${s.duration}${s.concentration ? ' (concentration)' : ''}\n${s.desc}${s.higher_level ? `\nAt higher levels: ${s.higher_level}` : ''}` });
  for (const c of srd.conditions) if (c.name.toLowerCase() === q) out.push({ source: 'PHB Appendix A', title: c.name, text: c.desc });
  if (!t.length) return out;
  const scored = loadPhb().map((p) => {
    const lower = p.text.toLowerCase();
    let score = lower.includes(q) ? 10 : 0;
    for (const w of t) score += Math.min(5, lower.split(w).length - 1);
    return { p, score };
  }).filter((x) => x.score > 0).sort((a, b) => b.score - a.score).slice(0, limit);
  for (const { p } of scored) out.push({ source: 'PHB (PDF page)', title: `page ${p.page}`, text: p.text.slice(0, 4000) });
  return out;
}
