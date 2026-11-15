// Monster stat blocks read from the owner's own Monster Manual (2024) PDF at runtime, like the PHB spells:
// nothing from the book is committed to the repo, and without the PDF the DM monster tab simply has no
// catalog (custom monsters still work). The PDF is an OCR scan: small-caps headings come out garbled
// ("Arurxec" for Ankheg) and digits get confused with letters ("l0" for 10), so names come from the book's
// "Index of Stat Blocks" matched by page, and numbers are repaired and cross-checked (HP vs. its dice).
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const dec = (s) => s.replace(/&apos;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
const letters = (s) => String(s).toLowerCase().replace(/[^a-z]/g, '');

/**
 * Tesseract hOCR of one column image → [{ text, h }]. Heights are converted from 300 dpi pixels to points so they
 * match pdftotext's; a wide gap between words becomes two spaces (index and list columns rely on it).
 */
export function hocrLines(hocr, dpi = 300) {
  const out = [];
  const lineRe = /<span class=['"](?:ocr_line|ocr_header|ocr_caption|ocr_textfloat)['"][^>]*title=['"]bbox (\d+) (\d+) (\d+) (\d+)[^'"]*['"][^>]*>([\s\S]*?)<\/span>\s*(?=<span class=['"]ocr_(?:line|header|caption|textfloat)|<\/p>|<\/div>)/g;
  for (const m of hocr.matchAll(lineRe)) {
    const words = [...m[5].matchAll(/<span class=['"]ocrx_word['"][^>]*title=['"]bbox (\d+) \d+ (\d+) \d+[^'"]*['"][^>]*>([\s\S]*?)<\/span>/g)]
      .map((w) => ({ x: Number(w[1]), x2: Number(w[2]), t: dec(w[3].replace(/<[^>]+>/g, '')) })).filter((w) => w.t.trim());
    if (!words.length) continue;
    let text = words[0].t;
    for (let i = 1; i < words.length; i++) text += (words[i].x - words[i - 1].x2 > 30 ? '   ' : ' ') + words[i].t;
    text = text.replace(/^[\s|_\[\]{}]+/, '').replace(/[\s|_]+$/, '').trim(); // stat-block box borders read as "|" / "_"
    if (text) out.push({ text, h: ((Number(m[4]) - Number(m[2])) * 72) / dpi });
  }
  return out;
}

/** pdftotext -bbox-layout → [{ page, lines: [{ text, h }] }] in reading order (left column, then right). */
export function pageLines(html) {
  return html.split('<page ').slice(1).map((pg, i) => {
    const width = Number(/width="([\d.]+)"/.exec(pg)?.[1] || 600);
    const blocks = [...pg.matchAll(/<block xMin="([\d.]+)" yMin="([\d.]+)" xMax="[\d.]+" yMax="[\d.]+">([\s\S]*?)<\/block>/g)].map((m) => ({
      col: Number(m[1]) < width / 2 - 20 ? 0 : 1, y: Number(m[2]),
      lines: [...m[3].matchAll(/<line [^>]*yMin="([\d.]+)"[^>]*yMax="([\d.]+)">([\s\S]*?)<\/line>/g)].map((l) => ({
        h: Number(l[2]) - Number(l[1]),
        text: [...l[3].matchAll(/<word[^>]*>([^<]*)<\/word>/g)].map((w) => dec(w[1])).join(' ').trim(),
      })).filter((l) => l.text),
    }));
    blocks.sort((a, b) => a.col - b.col || a.y - b.y);
    return { page: i + 1, lines: blocks.flatMap((b) => b.lines) };
  });
}

// ---------- OCR repair ----------
const DIGIT = { r: '1', ']': '1', '[': '1', l: '1', I: '1', i: '1', '|': '1', O: '0', o: '0', s: '5', S: '5', a: '4', B: '8', Z: '2', z: '2', g: '9', q: '9', b: '6', G: '6', t: '1' };
/** A token that should be a number ("l7s" → 175, "I 39" handled by callers). NaN when hopeless. */
export function ocrNum(tok) {
  const t = String(tok ?? '').replace(/[−–]/g, '-').replace(/[^\w+\-|\]\[]/g, '');
  const fixed = t.replace(/[A-Za-z|\]\[]/g, (c) => DIGIT[c] ?? c);
  return /^[+-]?\d+$/.test(fixed) ? Number(fixed) : NaN;
}
/** Fix digits inside numeric words and the common I/l confusion at the start of words ("lf", "lmmunity"). */
export function fixText(s) {
  return String(s)
    .replace(/(?<=[\d+\-−(/])[lI|](?=[\d\s).,;:/]|$)|(?<![A-Za-z])[lI|](?=\d)/g, '1')
    .replace(/(?<=\d)[oO](?=[\d\s).,;]|$)|(?<![A-Za-z])[oO](?=\d)/g, '0')
    .replace(/\bl(?=[fnmtd][a-z]*\b)/g, 'I')
    .replace(/\bHit:(?=\S)/g, 'Hit: ')
    .replace(/(?<=\s|\+)['.](?=\d)/g, '')
    .replace(/\s+([.,;:])/g, '$1')
    .replace(/[−–]/g, '-')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function lev(a, b) {
  if (a === b) return 0;
  const d = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = d[0];
    d[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const t = d[j];
      d[j] = Math.min(d[j] + 1, d[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = t;
    }
  }
  return d[b.length];
}
// Small caps come out of this OCR as look-alikes: i→r/l/t, n→N/u/r, b→e, G→C… Letters in the same group
// count as a match when comparing a garbled heading with a real name.
const LOOK = {};
for (const g of ['irltfj1', 'nuhmr', 'aoecbs', 'gc', 'kx', 'vwy', 'dop']) for (const c of g) (LOOK[c] ||= new Set()).add(g);
const alike = (a, b) => a === b || [...(LOOK[a] || [])].some((g) => g.includes(b));
/** Edit distance where look-alike letters substitute for free. */
export function ocrLev(a, b) {
  const d = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = d[0];
    d[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const t = d[j];
      d[j] = Math.min(d[j] + 1, d[j - 1] + 1, prev + (alike(a[i - 1], b[j - 1]) ? 0 : 1));
      prev = t;
    }
  }
  return d[b.length];
}
/** Drop illustration/drop-cap debris in front of a heading: "\\Lnceooru Gnoul", "kGeurrNous", "ffiMvcor.r". */
export const cleanHeading = (t) => String(t).replace(/^[^A-Za-z]+/, '').replace(/^ffi/, '').replace(/^[A-Za-z]-(?=[A-Z])/, '')
  .replace(/^[A-Za-z](?=[A-Z][A-Za-z.]{3,})(?![A-Z]{4,}\b)/, (c, o, str) => (/^[A-Z]{4,}\b/.test(str) ? c : '')).replace(/^[^A-Za-z]+/, '').trim();

/** 0..1 how well a garbled heading fits a real name: look-alike letters, and each word's first letter. */
export function nameFit(garbled, name) {
  const g = letters(garbled), n = letters(name);
  if (!g || !n) return 0;
  let fit = 1 - ocrLev(g, n) / Math.max(g.length, n.length);
  const gw = String(garbled).split(/[\s-]+/).map(letters).filter((w) => w.length > 1);
  const nw = String(name).split(/[\s-]+/).map(letters).filter((w) => w.length > 1 && !['of', 'the'].includes(w));
  // Word initials are capitals, which the OCR mostly gets right: one that cannot be a look-alike rules the name out.
  if (gw.length === nw.length) for (let i = 0; i < gw.length; i++) { if (!alike(gw[i][0], nw[i][0])) return 0; fit += 0.05; }
  return fit;
}

/** 0..1 similarity of two garbled strings by their letters. */
export const similarity = (a, b) => { const x = letters(a), y = letters(b); return x && y ? 1 - lev(x, y) / Math.max(x.length, y.length) : 0; };

// ---------- index of stat blocks ----------
const NAME_DIGIT = { 1: 'l', 0: 'o', 2: 'z', 9: 'g', 5: 's', 4: 'a', 6: 'G', 8: 'B', 3: 'e' };
/**
 * `pdftotext -layout` text of the "Index of Stat Blocks" pages → [{ name, page }]. Several columns share a line,
 * so every "Name......page" (or "Name      page") on a line is an entry.
 */
export function parseIndex(text) {
  const out = [];
  const re = /([A-Z0-9][A-Za-z0-9'’\-(),<^\\]*(?: [A-Za-z0-9'’\-(),<^\\]+)*)\s*(?:[.,]{2,}[.,\s]*|\s{3,})([0-9lIOot]{1,3}(?: ?[0-9lIOot]){0,2})(?=\s|$)/g;
  for (const line of text.split('\n')) {
    for (const m of line.matchAll(re)) {
      let page = ocrNum(m[2].replace(/\s/g, ''));
      if (page > 390 && page < 600) page -= 200; // "561" is a misread "361"
      const name = m[1]
        .replace(/(?<![A-Za-z])8(?=[a-z])/g, 'B').replace(/(?<![A-Za-z])2(?=[a-z])/g, 'Z').replace(/(?<![A-Za-z])4(?=[a-z])/g, 'A')
        .replace(/(?<=[A-Za-z])[0-9]|[0-9](?=[a-z])/g, (d) => NAME_DIGIT[d] ?? d)
        .replace(/(?<=[a-z])I(?=[a-z])|(?<=[a-z])I\b/g, 'l')
        .replace(/^w(?=[a-z])/, 'W').replace(/’/g, "'").trim();
      if (!Number.isFinite(page) || page < 5 || page > 390 || !/^[A-Z][A-Za-z' ()\-,]+$/.test(name) || name.length < 3) continue;
      out.push({ name, page });
    }
  }
  return out;
}

/** Names from the appendix lists ("Monsters by Creature Type"…): every 2+-space-separated cell of a layout line. */
export function parseNameList(text) {
  const out = new Set();
  for (const line of text.split('\n')) {
    for (const raw of line.trim().split(/\s{2,}/)) {
      // Index cells carry dot leaders and page numbers ("Goblin Minion.......142", "Fiend Cultist....."): keep the name.
      const cell = raw.replace(/\s*[.…,]{2,}.*$/, '').replace(/[\s.,]+$/, '');
      const c = cell.replace(/\s+(?=[a-z]{1,3}\b)/g, (m, o, str) => (/[a-z]$/.test(str.slice(0, o)) ? '' : m)).trim(); // "Plesiosau rus"
      if (/^[A-Z][A-Za-z'\- ]{2,40}$/.test(c) && !/^(The|This|In|Monsters?)\b/.test(c) && c.split(' ').length <= 5) out.add(c);
    }
  }
  return [...out];
}

/**
 * A heading no index entry fits ("GoeLrN MrNroN"): rebuild each word from a common book word of the same
 * length that is a letter-for-letter look-alike ("goblin", "minion"), else keep the OCR text.
 */
export function rebuildName(garbled, vocab) {
  const words = String(garbled).replace(/[^A-Za-z' -]/g, '').replace(/^[\s'-]+/, '').split(/\s+/).filter(Boolean);
  return titleCase(words.map((w) => {
    const lw = w.toLowerCase();
    if (lw.length < 3 || (vocab.get(lw) || 0) >= 5) return lw;
    let best = null;
    for (const [c, n] of vocab) {
      if (n < 3 || Math.abs(c.length - lw.length) > 1 || !alike(lw[0], c[0])) continue;
      const d = ocrLev(lw, c);
      const exact = c[0] === lw[0] ? 1 : 0; // "goblin" beats the misread "coblin"
      if (d <= (lw.length >= 7 ? 1 : 0) && (!best || d < best.d || (d === best.d && (exact > best.exact || (exact === best.exact && n > best.n))))) best = { c, d, n, exact };
    }
    return best ? best.c : lw;
  }).join(' '));
}

/** Tidy a monster name: "GiantBadger", "Fang ofYeenoghu", "Lege nd,", "Will-olWisp". */
export function cleanName(name, vocab) {
  const n = name.replace(/\bof(?=[A-Z])/g, 'of ').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/Will-o-?l? ?Wisp/i, "Will-o'-Wisp")
    .replace(/[\s,.;:]+$/, '').replace(/\s*-\s+/g, '-').replace(/\s{2,}/g, ' ').trim();
  return repairName(n, vocab);
}

/** Repair index names against the book vocabulary: "Infi ltrator" → "Infiltrator", "Air Flempntel" → "Air Elemental". */
export function repairName(name, vocab) {
  const known = (w) => (vocab.get(w.toLowerCase()) || 0) >= 3;
  const words = name.split(' ');
  for (let i = 0; i < words.length - 1; i++) {
    const j = words[i] + words[i + 1];
    if ((!known(words[i]) || !known(words[i + 1])) && (vocab.get(j.toLowerCase()) || 0) >= 1 && /^[a-z]/.test(words[i + 1])) { words.splice(i, 2, j); i--; }
  }
  return words.map((w) => {
    const core = w.replace(/[^A-Za-z]/g, '');
    if (core.length < 3 || known(core)) return w;
    const max = Math.max(1, Math.floor(core.length / 3));
    let best = null;
    for (const [c, n] of vocab) {
      if (n < 5 || Math.abs(c.length - core.length) > max) continue;
      const d = lev(core.toLowerCase(), c);
      if (d <= max && (!best || d < best.d || (d === best.d && n > best.n))) best = { c, d, n };
    }
    return best ? w.replace(core, best.c[0].toUpperCase() + best.c.slice(1)) : w;
  }).join(' ');
}

/** Book page number of each PDF page, from footers like "ARCANALOTH 19" (gaps filled from neighbours). */
export function bookPages(pages) {
  const known = pages.map(({ lines }) => {
    for (const l of [lines.at(-1), lines[0]]) {
      const m = l && /^(?:[A-Z][A-Z'’\- ]{2,}\s+([0-9lIO ]{1,5})|([0-9lIO]{1,3})\s+[A-Z][A-Z'’\- ]{2,})$/.exec(l.text);
      const n = m && ocrNum((m[1] || m[2]).replace(/\s/g, ''));
      if (Number.isFinite(n)) return n;
    }
    return null;
  });
  // Single footers are often misread, so use the median PDF→book offset of the footers around each page.
  const offs = known.map((n, i) => (n == null ? null : i + 1 - n));
  return known.map((_, i) => {
    const near = offs.slice(Math.max(0, i - 15), i + 16).filter((o) => o != null && o >= 0 && o <= 12).sort((a, b) => a - b);
    return i + 1 - (near.length ? near[Math.floor(near.length / 2)] : 4);
  });
}

// ---------- stat blocks ----------
const TYPES = 'aberration|beast|celestial|construct|dragon|elemental|fey|fiend|giant|humanoid|monstrosity|ooze|plant|undead';
/** "CR 2 (XP 450; PB +2)" — the XP part may be split off onto other lines (dragons: "in lair" values). */
const isCrLine = (t) => /^[Cc]\s?[Rr]\s+[0-9lIOti/]{1,4}\s*(\(|$)/.test(t);
const SECTIONS = ['Traits', 'Actions', 'Bonus Actions', 'Reactions', 'Legendary Actions'];
const FIELDS = [['skills', 'Skills'], ['vulnerabilities', 'Vulnerabilities'], ['resistances', 'Resistances'], ['immunities', 'Immunities'], ['gear', 'Gear'], ['senses', 'Senses'], ['languages', 'Languages']];
const ABIL = ['str', 'dex', 'con', 'int', 'wis', 'cha'];

function sectionOf(t) {
  if (t.split(/\s+/).length > 3 || /\d/.test(t) || t.length > 24) return null;
  let best = null;
  for (const s of SECTIONS) {
    const sim = similarity(t, s);
    const close = sim >= 0.45 || (sim >= 0.3 && Math.abs(letters(t).length - letters(s).length) <= 1);
    if (letters(t)[0] === letters(s)[0] && close && (!best || sim > best.sim)) best = { s, sim };
  }
  return best?.s || null;
}

const ALIGNMENTS = ['Unaligned', 'Lawful Good', 'Neutral Good', 'Chaotic Good', 'Lawful Neutral', 'Neutral', 'Chaotic Neutral', 'Lawful Evil', 'Neutral Evil', 'Chaotic Evil', 'Any Alignment'];
const cap1 = (w) => (w ? w[0].toUpperCase() + w.slice(1) : '');
/** "La rge Co nstru ct, U n a I igned" → { size, creature_type, alignment, type: 'Large Construct, Unaligned' }. */
export function typeInfo(text) {
  const head = letters(String(text).split(',')[0].replace(/\([^)]*\)/g, ''));
  const take = (str, list, min) => {
    let best = null;
    for (const w of list) { const sim = similarity(str.slice(0, w.length), w); if (sim >= min && (!best || sim > best.sim)) best = { w, sim }; }
    return best?.w;
  };
  const SZ = ['tiny', 'small', 'medium', 'large', 'huge', 'gargantuan'];
  let rest = head;
  const size = take(rest, SZ, 0.7);
  if (!size) return { size: '', creature_type: '', alignment: '', type: '' };
  rest = rest.slice(size.length);
  let size2 = null;
  if (rest.startsWith('or')) { size2 = take(rest.slice(2), SZ, 0.7); if (size2) rest = rest.slice(2 + size2.length); }
  let swarm = null;
  if (similarity(rest.slice(0, 7), 'swarmof') >= 0.7) { swarm = take(rest.slice(7), SZ, 0.7); rest = rest.slice(7 + (swarm || '').length); }
  const ct = cap1(take(rest, TYPES.split('|'), 0.6) || '');
  const tag = /\(([^)]{2,40})\)/.exec(String(text).split(',')[0])?.[1];
  const alignText = text.includes(',') ? text.slice(text.indexOf(',') + 1) : '';
  const alignment = alignText ? ALIGNMENTS.map((a) => [a, similarity(alignText, a)]).sort((x, y) => y[1] - x[1])[0][0] : '';
  const sizes = size2 ? `${cap1(size)} or ${cap1(size2)}` : cap1(size);
  const kind = swarm ? `Swarm of ${cap1(swarm)} ${ct}s` : ct;
  return { size: cap1(size), creature_type: ct, alignment, type: `${sizes} ${kind}${tag ? ` (${fixText(tag)})` : ''}${alignment ? `, ${alignment}` : ''}`.replace(/\s+,/, ',') };
}

const LABEL = { str: /^s+t+r+/, dex: /^d+e+x+/, con: /^c+o+n+/, int: /^[il1]+n+t+/, wis: /^w+i+s+/, cha: /^c+h+a+/ };
const asMod = (t) => {
  const x = String(t ?? '').replace(/^=/, '-').replace(/^4(?=\d$)/, '+'); // "=2" is -2, "42" is +2
  return /^[+\-−][0-9lIOoZz\]]{1,2}$/.test(x) ? ocrNum(x) : NaN;
};
/** "Str 17 +3 +3 Dex20 +5 +5 COoNnN14 +2 +2 … CHa6é =2 -2": scores (checked against their modifiers) and saves. */
export function labelledAbilities(text) {
  const toks = String(text).replace(/([+\-−=])['’.]/g, '$1').split(/\s+/).filter(Boolean);
  const abilities = {}, saves = {};
  for (let i = 0; i < toks.length; i++) {
    const low = toks[i].toLowerCase().replace(/^[(\[{]/, '');
    const key = Object.keys(LABEL).find((k) => LABEL[k].test(low));
    if (!key || abilities[key] != null) continue;
    const suffix = low.slice(LABEL[key].exec(low)[0].length).replace(/[^a-z0-9|\]]/g, '');
    let j = i + 1;
    let cands = [];
    if (suffix) cands = [suffix.slice(-2), suffix.slice(0, 2), suffix.slice(-1)];
    else if (/^[0-9lIOoSs\]|]{1,2}$/.test(toks[j] || '')) { cands = [toks[j]]; j++; }
    const mod = asMod(toks[j]);
    if (!Number.isFinite(mod)) continue;
    // The score must agree with its modifier; when no reading does, the modifier decides (10 + 2 × mod).
    const score = cands.map(ocrNum).find((n) => Number.isFinite(n) && n >= 1 && n <= 30 && Math.floor((n - 10) / 2) === mod) ?? 10 + 2 * mod;
    abilities[key] = score;
    const save = asMod(toks[j + 1]);
    if (Number.isFinite(save) && save !== mod) saves[key] = save;
  }
  return { abilities, saves };
}

const avgHp = (dice) => {
  const m = /(\d+)d(\d+)\s*(?:([+-])\s*(\d+))?/.exec(dice || '');
  return m ? Math.floor(Number(m[1]) * (Number(m[2]) + 1) / 2 + (m[3] === '-' ? -1 : 1) * Number(m[4] || 0)) : null;
};
const CR_XP = { '0': 10, '1/8': 25, '1/4': 50, '1/2': 100, 1: 200, 2: 450, 3: 700, 4: 1100, 5: 1800, 6: 2300, 7: 2900, 8: 3900, 9: 5000, 10: 5900, 11: 7200, 12: 8400, 13: 10000, 14: 11500, 15: 13000, 16: 15000, 17: 18000, 18: 20000, 19: 22000, 20: 25000, 21: 33000, 22: 41000, 23: 50000, 24: 62000, 25: 75000, 26: 90000, 27: 105000, 28: 120000, 29: 135000, 30: 155000 };

/** Parse one stat block: lines from its name to its end. */
export function parseBlock(lines) {
  const [nameLine, typeLine, ...rest] = lines;
  const crIdx = rest.findIndex((l) => isCrLine(l.text));
  const head = crIdx >= 0 ? rest.slice(0, crIdx + 1) : rest.slice(0, 14);
  const body = crIdx >= 0 ? rest.slice(crIdx + 1) : rest.slice(14);
  const headText = head.map((l) => l.text).join('\n');
  const m = { garbled: nameLine.text, ...typeInfo(typeLine.text) };

  // AC: "AC 17" or the number on its own line next to "AC"
  const ac = /\bAC\s*['’.]?\s*([0-9lIOSt]{1,2})\b/.exec(headText) || /^([0-9lIOS]{1,2})$/m.exec(headText);
  m.ac = ac ? ocrNum(ac[1]) : null;
  const ini = /[lI]nitiative\s*([+-−]?\s?[0-9lIOa]{1,2})/.exec(headText);
  m.initiative = ini ? ocrNum(ini[1].replace(/\s/g, '')) : null;
  const hp = /\bHP\s*['’.]?\s*([0-9A-Za-z]{1,4})\s*[($]['’.]?([^)]*)\)/.exec(headText);
  if (hp) {
    // Repair each number of "27d8 + 5a" on its own ("r0d8" → 10d8, "5a" → 54).
    const num1 = (t) => { const n = ocrNum(t); return Number.isFinite(n) ? n : t; };
    m.hp_dice = fixText(hp[2].replace(/['’]/g, ''))
      .replace(/([0-9A-Za-z]{1,3})\s*d\s*([0-9A-Za-z]{1,3})/, (_, a, b) => `${num1(a)}d${num1(b)}`)
      .replace(/\s*([+-])\s*([0-9A-Za-z]{1,3})/g, (_, sg, v) => ` ${sg} ${num1(v)}`).trim();
    let avg = avgHp(m.hp_dice);
    const n = ocrNum(hp[1]);
    // "HP 315 ($2d8 + 126)": the bracket swallowed a digit of the dice count. Restore it if that makes them agree.
    if (Number.isFinite(n) && avg != null && Math.abs(n - avg) > 1) {
      for (let k = 1; k <= 9; k++) {
        const fixed = m.hp_dice.replace(/^(\d+)d/, `${k}$1d`);
        if (Math.abs(avgHp(fixed) - n) <= 1) { m.hp_dice = fixed; avg = avgHp(fixed); break; }
      }
    }
    m.hp = avg != null && (!Number.isFinite(n) || Math.abs(n - avg) > 1) ? avg : n;
  } else {
    const flat = /\bHP\s+([0-9lIOoSsa]{1,4})/.exec(headText);
    m.hp = flat ? ocrNum(flat[1]) : null;
  }
  const speed = /\bspeed\s+(.+)/i.exec(headText);
  m.speed = speed ? fixText(speed[1]) : '';

  // Ability scores: find the six labels by shape (Srn/Str, Dex/Drx, Cott/Con, lrr/Int, Wts/Wis, Cxr/Cha) and read
  // "score mod save" after each. Rows can be split over lines, so work on the joined header tokens.
  m.abilities = {}; m.saves = {};
  let toks = head.filter((l) => !/^(Skills|Senses|Languages|C\s?R|Resist|[lI]mmun|Vulner|Gear)\b/.test(l.text)).map((l) => l.text).join(' ')
    .replace(/([+\-−])['’.]/g, '$1')
    .replace(/\b([A-Z][A-Za-z]{2})([lI]\d)\b/g, '$1 $2') // "Conl0" → "Con l0\"
    .replace(/(?<=\s|^)([A-Za-z.]{2,5})['’.,]?([\]\[]?\d{1,2})(?=\s)/g, '$1 $2')
    .replace(/(?<=\s)['’.,](?=[\dlI\]])/g, '').split(/\s+/);
  // "+" is often read as "4": in a modifier/save position "42" means +2, "49" +9, "40" +0.
  for (let i = 1; i < toks.length; i++) if (/^4\d$/.test(toks[i]) && (/^[+\-−]/.test(toks[i - 1]) || /^[0-9lI]{1,2}$/.test(toks[i - 1]) || /^4\d$/.test(toks[i - 1]))) toks[i] = `+${toks[i][1]}`;
  const isNum = (t) => /^[0-9lIOoSs\]]{1,2}$/.test(t) && Number.isFinite(ocrNum(t));
  const isMod = (t) => /^[+\-−][0-9lIOoZz\]]{1,2}$/.test(t);
  // Clean-OCR pass first: labels found even when stretched or glued ("COoNnN14", "Conl8s", "CHA]", "CHAY").
  Object.assign(m, labelledAbilities(head.filter((l) => !/^(Skills|Senses|Languages|C\s?R|Resist|[lI]mmun|Vulner|Gear)\b/.test(l.text)).map((l) => l.text).join(' ')));
  let cSeen = 0;
  for (let i = 0; i < toks.length - 2; i++) {
    const lab = toks[i].toLowerCase().replace(/[^a-z]/g, '');
    if (lab.length < 2 || lab.length > 5 || !isNum(toks[i + 1]) || !isMod(toks[i + 2])) continue;
    let key = { s: 'str', d: 'dex', w: 'wis', i: 'int', l: 'int' }[lab[0]];
    if (lab[0] === 'c') key = lab[1] === 'o' ? 'con' : 'hxn'.includes(lab[1]) ? 'cha' : cSeen ? 'cha' : 'con';
    // An unreadable or duplicate label ("l9ts" for Wis) is most likely the score still missing.
    if (key && m.abilities[key] != null && toks[i].toLowerCase().startsWith(key)) continue; // already read by the first pass
    if (!key || m.abilities[key] != null) key = ABIL.find((k) => m.abilities[k] == null);
    if (!key) continue;
    if (key === 'con' || key === 'cha') cSeen++;
    let score = ocrNum(toks[i + 1]);
    const mod = ocrNum(toks[i + 2]);
    // The modifier is the more reliable OCR read (fewer glyphs); keep the score only if it agrees.
    if (Number.isFinite(mod) && Math.floor((score - 10) / 2) !== mod) score = 10 + 2 * mod;
    m.abilities[key] = score;
    const save = isMod(toks[i + 3] || '') ? ocrNum(toks[i + 3]) : NaN;
    if (Number.isFinite(save) && save !== mod) m.saves[key] = save;
  }
  m.abilities = Object.fromEntries(ABIL.filter((k) => m.abilities[k] != null).map((k) => [k, m.abilities[k]]));

  // Named fields (Skills, Immunities…) with continuation lines.
  let field = null;
  for (const l of head) {
    const t = l.text;
    const f = FIELDS.find(([, label]) => similarity(t.split(/\s+/)[0], label) >= 0.75);
    if (f) { field = f[0]; m[field] = fixText(t.slice(t.indexOf(' ') + 1)); continue; }
    if (/^(C\s?R|AC|HP|Speed|[lI]nitiative|MOD)\b/.test(t) || (l.text.match(/[+\-−][0-9lIOo]/g) || []).length >= 2 || /^[0-9lIOS]{1,2}$/.test(t)) { field = null; continue; }
    if (/PB\s*\+|^or$|^[.,\dlIO\s]+$|in lair/.test(t)) continue; // split-off "XP 11,500, or 13,000 in lair" pieces
    if (field && /^[a-z.,;0-9(]|^[A-Z][a-z]+,/.test(t)) m[field] += ` ${fixText(t)}`;
  }
  if (m.senses) m.senses = m.senses.replace(/\.?\s*1?20 ft\.;/, (s) => s); // keep as read

  const crLine = crIdx >= 0 ? rest[crIdx].text : '';
  const crRaw = (/^[Cc]\s?[Rr]\s+([0-9lIOti/]{1,4})/.exec(crLine)?.[1] || '').replace(/(?<=.)i(?=\d)/g, '/').replace(/[lIti]/g, '1').replace(/O/g, '0');
  const xpM = /XP\s*([0-9lIO][0-9lIO,.]*)/.exec(crLine);
  const xp = xpM ? ocrNum(xpM[1].replace(/[,.]/g, '')) : NaN;
  // XP → CR is unambiguous, so it settles an unreadable CR.
  const fromXp = Object.entries(CR_XP).find(([, v]) => v === xp)?.[0];
  if (crRaw || fromXp) {
    m.cr = CR_XP[crRaw] != null ? crRaw : fromXp ?? crRaw;
    m.xp = CR_XP[m.cr] ?? null;
    const pb = /PB\s*\+\s*([0-9lI])/.exec(headText + '\n' + body.slice(0, 3).map((l) => l.text).join(' '));
    m.pb = pb ? ocrNum(pb[1]) : null;
  }

  // Sections and their entries ("Bite. Melee Attack Roll: +5…").
  m.sections = [];
  let sec = null;
  let entry = null;
  let prevEnded = true;
  for (const l of body) {
    const t = l.text;
    if (l.h >= 11.5 && /^[^a-z]*\d[^a-z]*$/.test(t)) continue; // art debris / page numbers
    if (l.h > 0 && l.h < 6.5) continue; // tiny caption text under an illustration
    if (letters(t).length < 2 && !/\d/.test(t)) continue;
    const s = sectionOf(t);
    if (s) { sec = { name: s, entries: [] }; m.sections.push(sec); entry = null; prevEnded = true; continue; }
    if (!sec) { sec = { name: 'Traits', entries: [] }; m.sections.push(sec); }
    const head2 = /^([A-Z][A-Za-z'’\- ]{1,40}?(?:\s?\([^)]{1,40}\))?)[.,]\s*(.*)$/.exec(t);
    if (prevEnded && head2 && head2[1].split(/\s+/).length <= 6) {
      entry = { name: fixText(head2[1]).replace(/^[A-Z][a-z]+(?=[A-Z])/, (w) => `${w} `), text: head2[2] };
      sec.entries.push(entry);
    } else if (entry) {
      entry.text = /-$/.test(entry.text) && /^[a-z]/.test(t) ? entry.text.slice(0, -1) + t : `${entry.text}${entry.text ? ' ' : ''}${t}`;
    } else {
      entry = { name: '', text: t };
      sec.entries.push(entry);
    }
    prevEnded = /[.:)]$/.test(t);
  }
  for (const s of m.sections) for (const e of s.entries) e.text = fixText(e.text);
  m.sections = m.sections.filter((s) => s.entries.length);
  return m;
}

/** Split the whole book into stat blocks: [{ page, lines }]. */
export function findBlocks(pages) {
  const stream = pages.flatMap(({ page, lines }) => lines.map((l) => ({ ...l, page })));
  // Anchor on the HP line: it survives the OCR far better than the name or the type line.
  const isHp = (t) => /^HP\s*['’.]?\s*[0-9A-Za-z]{1,4}(\s*[($]|\s*$)/.test(t); // "(" is sometimes scanned as "$\"
  const isHeaderish = (t) => /MOD|SAVE|nitiative|^[Ss]peed\b|^AC\b/.test(t);
  const isTitle = (l) => l.h >= 10.5 && letters(l.text).length >= 3 && !/^(AC|HP|MOD|[Ss]peed|[lI]nitiative)\b/.test(l.text) && !/\d/.test(l.text);
  const starts = [];
  for (let i = 1; i < stream.length; i++) {
    if (!isHp(stream[i].text)) continue;
    if (!stream.slice(Math.max(0, i - 8), i + 10).some((l) => l !== stream[i] && isHeaderish(l.text))) continue;
    const prevHp = starts.at(-1)?.hp ?? -1;
    const floor = Math.max(prevHp, i - 9) + 1;
    let type = -1;
    for (let j = i - 1; j >= floor; j--) if (typeInfo(stream[j].text).size && stream[j].text.length < 70) { type = j; break; }
    let name = type - 1 > prevHp ? type - 1 : -1;
    if (name < 0) for (let j = (type >= 0 ? type : i) - 1; j >= floor; j--) if (isTitle(stream[j])) { name = j; break; }
    if (name < 0) continue;
    starts.push({ s: name, type, hp: i });
  }
  return starts.map(({ s, type }, k) => {
    const limit = k + 1 < starts.length ? starts[k + 1].s : stream.length;
    let end = s + 2;
    let pastCr = false;
    for (; end < limit; end++) {
      const l = stream[end];
      if (isCrLine(l.text)) pastCr = true;
      // The block ends at the next big heading (the following monster's lore entry or a sidebar).
      const lt = letters(l.text).length;
      if (pastCr && l.h >= 15.5 && lt >= 4 && lt / l.text.replace(/\s/g, '').length >= 0.7 && !sectionOf(l.text)) break;
      if (pastCr && /^H\S*\s.*\bTreasure\b/.test(l.text)) { end = Math.max(s + 2, end - 2); break; }
      // An all-caps line that is not a section header ("GOBLIN HEXER" lore heading, an art caption) ends the block.
      if (pastCr && /^[A-Z][A-Z'’\-,. ]{5,}$/.test(l.text.trim()) && letters(l.text).length >= 6 && !sectionOf(l.text)) break;
      // Running footer ("ARCANALOTH 19") between pages.
    }
    // parseBlock expects [name, type, …]: give it an empty type line when the OCR lost it.
    const raw = type === s + 1 ? stream.slice(s, end) : [stream[s], { text: '', h: 0, page: stream[s].page }, ...stream.slice(s + 1, end)];
    const lines = raw.filter((l) => !/^[A-Z][A-Z'’\- ]{2,}\s+[0-9lIO ]{1,5}$/.test(l.text) && !/^[0-9lIO]{1,3}\s+[A-Z][A-Z'’\- ]{2,}$/.test(l.text));
    // A drop-cap name splits into two lines ("Ar" + "rcrENT BLAcK DRAGoN").
    const pre = stream[s - 1];
    if (pre && pre.h >= 11 && letters(pre.text).length <= 3 && pre.page === stream[s].page) lines[0] = { ...lines[0], text: `${pre.text}${lines[0].text}` };
    return { page: stream[s].page, lines };
  });
}

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const titleCase = (s) => s.toLowerCase().replace(/(^|[\s(-])([a-z])/g, (_, a, b) => a + b.toUpperCase());

// ---------- word repair ----------
/** Lower-case word → count over the whole book; correct spellings dominate the OCR noise. */
export function bookVocab(pages) {
  const v = new Map();
  for (const { lines } of pages) for (const { text } of lines) for (const w of text.toLowerCase().match(/[a-z']{3,}/g) || []) v.set(w, (v.get(w) || 0) + 1);
  return v;
}
const FIXED = { 'ro//': 'Roll', 'ro//:': 'Roll:', 'ro//;': 'Roll:' };
/** "Legendory Resistonce" → "Legendary Resistance": unknown words snap to a common book word ≤ 1–2 edits away. */
export function wordFixer(vocab) {
  const common = [...vocab].filter(([w, n]) => n >= 6 && w.length >= 4);
  const byLen = new Map();
  for (const [w, n] of common) { const a = byLen.get(w.length) || []; a.push([w, n]); byLen.set(w.length, a); }
  const memo = new Map();
  // OCR swaps look-alike letters; only same-length swaps within these groups count as a likely misread.
  const GROUP = {};
  for (const g of ['aoec', 'ritlfj', 'nuhm']) for (const c of g) GROUP[c] = g;
  const ocrDist = (a, b) => {
    let d = 0;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) { if (!GROUP[a[i]] || GROUP[a[i]] !== GROUP[b[i]]) return 99; d++; }
    return d;
  };
  const fixWord = (w) => {
    const lw = w.toLowerCase();
    const own = vocab.get(lw) || 0;
    if (lw.length < 5) return w;
    if (memo.has(lw)) return memo.get(lw) ? keepCase(w, memo.get(lw)) : w;
    const maxD = lw.length >= 8 ? 2 : 1;
    let best = null;
    for (const [c, n] of byLen.get(lw.length) || []) {
      const d = ocrDist(lw, c);
      if (d <= maxD && (!best || d < best.d || (d === best.d && n > best.n))) best = { c, d, n };
    }
    // A word the book uses a lot is real ("covers"), unless a look-alike is used far more ("legendory" → "legendary").
    if (best && own >= 3 && best.n < 10 * own) best = null;
    memo.set(lw, best?.c || null);
    return best ? keepCase(w, best.c) : w;
  };
  const keepCase = (orig, w) => (/^[A-Z]/.test(orig) ? w[0].toUpperCase() + w.slice(1) : w);
  return (text) => String(text)
    .replace(/\b[Rr]o\/\/[:;]?/g, (t) => FIXED[t.toLowerCase()] || 'Roll')
    .replace(/\b([A-Z][a-z]{3,})([A-Z][a-z]{3,})\b/g, '$1 $2') // "SavingThrow" → "Saving Throw"
    .replace(/[A-Za-z]{5,}/g, fixWord);
}

/** Whole pipeline: the book's page lines (pageLines / OCR json) + text of its index and list pages → [monster]. */
export function parseMonsterManual(pages, indexText, listText = '') {
  const book = bookPages(pages);
  const vocab = bookVocab(pages);
  const seenNames = new Set();
  const index = parseIndex(indexText).map((e) => ({ ...e, name: repairName(e.name, vocab) }))
    .filter((e) => !seenNames.has(e.name) && seenNames.add(e.name));
  const blocks = findBlocks(pages.slice(8));
  const fix = wordFixer(vocab);
  // Match stat blocks to index names: by page (±2) and similarity of the garbled heading, best pairs first.
  const parsed = blocks.map((b) => {
    const m = parseBlock(b.lines);
    // A sentence where the heading should be ("their ends.", "consumed by the lich. A Humanoid…") means it was lost.
    const prose = /\b[a-z]{2,}\s+[a-z]{2,}\b/.test(m.garbled) || /^[a-z].*\.$/.test(m.garbled.trim());
    m.garbled = prose ? '' : cleanHeading(m.garbled);
    return { b, m, bp: book[b.page - 1] };
  });
  // Exact spelling counts most (clean OCR: "GHAST" is the Ghast, not the Ghost); look-alikes rescue garbled text.
  const score = (g, name) => { const f = nameFit(g, name); return f <= 0 ? 0 : 0.6 * similarity(g, name) + 0.4 * f - 0.03 * Math.abs(letters(g).length - letters(name).length); };
  const nameOf = new Map();
  const usedE = new Set();
  // Clean OCR: a heading spelled like a known name (index or appendix lists) is that monster, wherever it is.
  const known = [...new Set([...index.map((e) => e.name), ...parseNameList(`${listText}\n${indexText}`).map((n) => repairName(n, vocab))])];
  const exact = [];
  parsed.forEach((p, bi) => { if (letters(p.m.garbled).length >= 3) known.forEach((n) => { const sim = similarity(p.m.garbled, n); if (sim >= 0.88) exact.push({ bi, n, sim }); }); });
  exact.sort((x, y) => y.sim - x.sim);
  const usedNames = new Set();
  for (const e of exact) if (!nameOf.has(e.bi) && !usedNames.has(e.n)) { nameOf.set(e.bi, e.n); usedNames.add(e.n); }
  index.forEach((e, ei) => { if (usedNames.has(e.name)) usedE.add(ei); });
  const pairs = [];
  // Index page numbers are OCR too: "56" can be 36. One look-alike digit off counts as close.
  const LOOK = { 3: '58', 5: '36', 8: '036', 6: '58', 0: '86', 1: '7', 7: '1' };
  const pageClose = (a, b) => {
    if (Math.abs(a - b) <= 2) return Math.abs(a - b);
    const x = String(a), y = String(b);
    if (x.length !== y.length) return null;
    const diff = [...x].map((c, i) => [c, y[i]]).filter(([c, d]) => c !== d);
    return diff.length === 1 && (LOOK[diff[0][0]] || '').includes(diff[0][1]) ? 1.5 : null;
  };
  parsed.forEach((p, bi) => index.forEach((e, ei) => {
    if (nameOf.has(bi) || usedE.has(ei)) return;
    const dp = pageClose(e.page, p.bp);
    const sc = score(p.m.garbled, e.name);
    if (dp != null) pairs.push({ bi, ei, s: sc - 0.05 * dp });
    else if (sc >= 0.92) pairs.push({ bi, ei, s: sc - 0.3 }); // a near-exact name anywhere in the book
  }));
  pairs.sort((x, y) => y.s - x.s);
  for (const pr of pairs) if (pr.s >= 0.5 && !nameOf.has(pr.bi) && !usedE.has(pr.ei)) { nameOf.set(pr.bi, index[pr.ei].name); usedE.add(pr.ei); }
  // A heading lost to the artwork ("I", "m"): if exactly one unclaimed index entry belongs on that page, it is this one.
  parsed.forEach((p, bi) => {
    if (nameOf.has(bi)) return;
    const free = index.map((e, ei) => ({ e, ei })).filter(({ e, ei }) => !usedE.has(ei) && Math.abs(e.page - p.bp) <= 1);
    const sameBlocks = parsed.filter((q, qi) => !nameOf.has(qi) && Math.abs(q.bp - p.bp) <= 1).length;
    if (free.length === 1 && sameBlocks === 1) { nameOf.set(bi, free[0].e.name); usedE.add(free[0].ei); }
  });
  // Still unnamed blocks whose heading is mostly debris: an unclaimed index entry on the very same page is the
  // best guess (several → the best fit). A wrong-ish name with the right page beats "Kpnlzrr".
  const weak = (bi) => !nameOf.has(bi) && (letters(parsed[bi].m.garbled).length < 4 || !/[aeiouy]{1}.*[aeiouy]/i.test(rebuildName(parsed[bi].m.garbled, vocab)));
  const samePage = [];
  parsed.forEach((p, bi) => { if (weak(bi)) index.forEach((e, ei) => { if (!usedE.has(ei) && e.page === p.bp) samePage.push({ bi, ei, s: nameFit(p.m.garbled, e.name) }); }); });
  samePage.sort((x, y) => y.s - x.s);
  for (const pr of samePage) if (!nameOf.has(pr.bi) && !usedE.has(pr.ei)) { nameOf.set(pr.bi, index[pr.ei].name); usedE.add(pr.ei); }
  // Blocks the index could not name: try the appendix name lists (no pages, so a stricter match).
  const taken = new Set(nameOf.values());
  const extra = parseNameList(`${listText}\n${indexText}`).map((n) => repairName(n, vocab)).filter((n) => !taken.has(n));
  const pairs2 = [];
  parsed.forEach((p, bi) => { if (!nameOf.has(bi)) extra.forEach((n, ni) => pairs2.push({ bi, ni, s: score(p.m.garbled, n) })); });
  pairs2.sort((x, y) => y.s - x.s);
  const usedN = new Set();
  for (const pr of pairs2) {
    const g = letters(parsed[pr.bi].m.garbled);
    if (pr.s >= 0.6 && g[0] === letters(extra[pr.ni])[0] && !nameOf.has(pr.bi) && !usedN.has(pr.ni)) { nameOf.set(pr.bi, extra[pr.ni]); usedN.add(pr.ni); }
  }
  const out = [];
  parsed.forEach(({ m, bp }, bi) => {
    if (m.ac == null && m.hp == null) return; // a sidebar or list that merely looked like a stat block
    let name = cleanName(nameOf.get(bi) || rebuildName(m.garbled, vocab), vocab);
    if (letters(name).length < 3) name = `Unknown monster (p. ${bp})`; // heading lost to the artwork: the page helps find it
    const { garbled, ...rest } = m;
    for (const sec of rest.sections) for (const e of sec.entries) { e.name = fix(e.name.replace(/^([a-z]{1,2}|[A-Za-z]{1,2}\s)\s*(?=[A-Z])/, '')); e.text = fix(e.text); }
    for (const k of ['speed', 'skills', 'vulnerabilities', 'resistances', 'immunities', 'gear', 'senses', 'languages']) if (rest[k]) rest[k] = fix(rest[k]);
    out.push({ index: `mm-${slug(name)}`, name, page: bp, pdf_page: parsed[bi].b.page, ...rest, source: 'MM', _bi: bi });
  });
  out.known = known;
  // One name, one block: the block nearest that name's index page keeps it; the others fall back to their own heading.
  const pageOf = new Map(index.map((e) => [e.name, e.page]));
  const byName = new Map();
  out.forEach((m, i) => byName.set(m.name, [...(byName.get(m.name) || []), i]));
  for (const [name, list] of byName) {
    if (list.length < 2 || !pageOf.has(name)) continue;
    const keep = list.reduce((a, b) => (Math.abs(out[a].page - pageOf.get(name)) <= Math.abs(out[b].page - pageOf.get(name)) ? a : b));
    for (const i of list) if (i !== keep) {
      const n = cleanName(rebuildName(parsed[out[i]._bi].m.garbled, vocab), vocab);
      out[i].name = n && n !== name && letters(n).length >= 3 ? n : `Unknown monster (p. ${out[i].page})`;
      out[i].index = `mm-${slug(out[i].name)}`;
    }
  }
  for (const m of out) delete m._bi;
  // Unique indexes (two stat blocks can share a name, e.g. variants).
  const seen = new Map();
  for (const m of out) { const n = seen.get(m.index) || 0; seen.set(m.index, n + 1); if (n) m.index += `-${n + 1}`; }
  const sorted = out.sort((a, b) => a.name.localeCompare(b.name));
  Object.defineProperty(sorted, 'knownNames', { value: out.known, enumerable: false });
  Object.defineProperty(sorted, 'indexEntries', { value: index, enumerable: false });
  return sorted;
}

// ---------- ChatGPT fixes ----------
/**
 * Merge stat blocks that ChatGPT transcribed from page images (`make mm-fix`) into the parsed ones: per PDF page,
 * a transcription replaces the header values and name of the block it matches (same HP / AC / name), and its
 * sections when it has at least as many entries. Blocks the parser missed altogether are added.
 */
export function applyFixes(monsters, fixes) {
  const out = monsters.map((m) => ({ ...m }));
  for (const [pdfPage, list] of Object.entries(fixes?.pages || {})) {
    const here = out.filter((m) => String(m.pdf_page) === String(pdfPage));
    const bookPage = here[0]?.page ?? Number(pdfPage) - 3;
    const used = new Set();
    for (const f of list || []) {
      if (!f?.name) continue;
      let best = null;
      for (const m of here) {
        if (used.has(m)) continue;
        const sc = (f.hp != null && f.hp === m.hp ? 2 : 0) + (f.ac != null && f.ac === m.ac ? 1 : 0) + similarity(f.name, m.name);
        if ((f.hp === m.hp || similarity(f.name, m.name) >= 0.8) && (!best || sc > best.sc)) best = { m, sc };
      }
      const t = best?.m || { page: bookPage, pdf_page: Number(pdfPage), abilities: {}, saves: {}, sections: [], source: 'MM' };
      if (best) used.add(t); else out.push(t);
      const name = f.name.trim().toLowerCase().replace(/(^|[\s(-])([a-z])/g, (_, a, b) => a + b.toUpperCase()).replace(/\b(Of|The|And)\b/g, (w) => w.toLowerCase());
      Object.assign(t, { name, index: `mm-${slug(name)}`, ...typeInfo(f.type || t.type || '') });
      for (const k of ['ac', 'initiative', 'hp', 'xp', 'pb']) if (Number.isFinite(f[k])) t[k] = f[k];
      for (const k of ['hp_dice', 'speed', 'skills', 'vulnerabilities', 'resistances', 'immunities', 'gear', 'senses', 'languages', 'cr']) if (f[k]) t[k] = String(f[k]);
      if (f.type) t.type = f.type;
      for (const a of ABIL) if (Number.isFinite(f.abilities?.[a])) t.abilities = { ...t.abilities, [a]: f.abilities[a] };
      t.abilities = Object.fromEntries(ABIL.filter((a) => t.abilities?.[a] != null).map((a) => [a, t.abilities[a]]));
      // Only real proficiencies count as saves (a save equal to the modifier is just the modifier).
      const saves = {};
      for (const a of ABIL) if (Number.isFinite(f.saves?.[a]) && t.abilities[a] != null && f.saves[a] !== Math.floor((t.abilities[a] - 10) / 2)) saves[a] = f.saves[a];
      if (Object.keys(saves).length || ABIL.every((a) => Number.isFinite(f.saves?.[a]))) t.saves = saves;
      const count = (secs) => (secs || []).reduce((n, x) => n + (x.entries?.length || 0), 0);
      if (count(f.sections) >= count(t.sections)) t.sections = (f.sections || []).filter((x) => x.entries?.length);
      t.fixed = true;
    }
  }
  const seen = new Map();
  for (const m of out) { const n = seen.get(m.index) || 0; seen.set(m.index, n + 1); if (n) m.index += `-${n + 1}`; }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** Layout-ish text of some PDF pages from page lines (for the index and appendix lists). */
const pagesText = (pages, from, to) => pages.filter((p) => p.page >= from && p.page <= to).flatMap((p) => p.lines.map((l) => l.text)).join('\n');

let cached = null;
/**
 * Monster Manual stat blocks, or [] without the book. Parsed once and cached in DATA_DIR. Text comes from our own
 * column-by-column Tesseract OCR (`make mm-ocr` → MM_OCR_JSON) when present, else from the scan's built-in text layer.
 */
export function loadMonsters(dataDir) {
  if (cached) return cached;
  cached = [];
  const usable = (f) => f && fs.existsSync(f) && fs.statSync(f).size > 0; // /dev/null is mounted when a file is missing
  const ocr = process.env.MM_OCR_JSON || path.resolve('..', 'Monster Manual 2024 - OCR.json');
  const fixFile = process.env.MM_FIXES_JSON || path.resolve('..', 'Monster Manual 2024 - ChatGPT fixes.json');
  const fixes = usable(fixFile) ? JSON.parse(fs.readFileSync(fixFile, 'utf8')) : null;
  const nFix = Object.keys(fixes?.pages || {}).length;
  const book = process.env.MM_PDF || path.resolve('..', 'D&D 5e - Monster Manual 2024.pdf');
  const src = usable(ocr) ? 'ocr' : usable(book) ? 'scan' : null;
  // Bump the version when the parser improves; the source is part of the name so adding the OCR re-parses.
  const cache = dataDir && src && path.join(dataDir, `mm-monsters-v3-${src}${nFix ? `-fix${nFix}` : ''}.json`);
  try {
    if (!src) return cached;
    if (fs.existsSync(cache)) return (cached = JSON.parse(fs.readFileSync(cache, 'utf8')));
    if (src === 'ocr') {
      const { pages } = JSON.parse(fs.readFileSync(ocr, 'utf8'));
      cached = parseMonsterManual(pages, pagesText(pages, 5, 10), pagesText(pages, 376, 390));
    } else {
      const html = execFileSync('pdftotext', ['-bbox-layout', book, '-'], { maxBuffer: 256 * 1024 * 1024 }).toString();
      // The "Index of Stat Blocks" sits on the first PDF pages; layout mode keeps "Name.....page" on one line.
      const indexText = execFileSync('pdftotext', ['-layout', '-f', '5', '-l', '10', book, '-'], { maxBuffer: 16 * 1024 * 1024 }).toString();
      // Appendix B lists every stat block by habitat, creature type and CR: a second source of clean names.
      const listText = execFileSync('pdftotext', ['-layout', '-f', '376', '-l', '390', book, '-'], { maxBuffer: 16 * 1024 * 1024 }).toString();
      cached = parseMonsterManual(pageLines(html), indexText, listText);
    }
    if (fixes) cached = applyFixes(cached, fixes);
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(cache, JSON.stringify(cached));
  } catch (e) {
    console.warn('Monster Manual extraction failed:', e.message);
  }
  return cached;
}
