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
const DIGIT = { ']': '1', '[': '1', l: '1', I: '1', i: '1', '|': '1', O: '0', o: '0', s: '5', S: '5', a: '4', B: '8', Z: '2', z: '2', g: '9', q: '9', b: '6', G: '6', t: '1' };
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
    for (const cell of line.trim().split(/\s{2,}/)) {
      const c = cell.replace(/\s+(?=[a-z]{1,3}\b)/g, (m, o, str) => (/[a-z]$/.test(str.slice(0, o)) ? '' : m)).trim(); // "Plesiosau rus"
      if (/^[A-Z][A-Za-z'\- ]{2,40}$/.test(c) && !/^(The|This|In|Monsters?)\b/.test(c) && c.split(' ').length <= 5) out.add(c);
    }
  }
  return [...out];
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
const SIZES = 'tiny|small|medium|large|huge|[a-z]argantuan';
const TYPES = 'aberration|beast|celestial|construct|dragon|elemental|fey|fiend|giant|humanoid|monstrosity|ooze|plant|undead';
const TYPE_LINE = new RegExp(`^(${SIZES})(or(${SIZES}))?(swarmof(${SIZES}))?(${TYPES})`);
/** "CR 2 (XP 450; PB +2)" — the XP part may be split off onto other lines (dragons: "in lair" values). */
const isCrLine = (t) => /^[Cc]\s?[Rr]\s+[0-9lIOti/]{1,4}\s*(\(|$)/.test(t);
const SECTIONS = ['Traits', 'Actions', 'Bonus Actions', 'Reactions', 'Legendary Actions'];
const FIELDS = [['skills', 'Skills'], ['vulnerabilities', 'Vulnerabilities'], ['resistances', 'Resistances'], ['immunities', 'Immunities'], ['gear', 'Gear'], ['senses', 'Senses'], ['languages', 'Languages']];
const ABIL = ['str', 'dex', 'con', 'int', 'wis', 'cha'];

const isTypeLine = (t) => TYPE_LINE.test(letters(t));
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
  const t = TYPE_LINE.exec(letters(text)) || [];
  const size = cap1((t[1] || '').replace(/^.argantuan$/, 'gargantuan'));
  const sizes = t[3] ? `${size} or ${cap1(t[3].replace(/^.argantuan$/, 'gargantuan'))}` : size;
  const ct = cap1(t[6] || '');
  const tag = /\(([^)]{2,40})\)/.exec(text.split(',')[0])?.[1];
  const alignText = text.includes(',') ? text.slice(text.indexOf(',') + 1) : '';
  const alignment = alignText ? ALIGNMENTS.map((a) => [a, similarity(alignText, a)]).sort((x, y) => y[1] - x[1])[0][0] : '';
  const kind = t[4] ? `Swarm of ${cap1(t[5])} ${ct}s` : ct;
  return { size, creature_type: ct, alignment, type: `${sizes} ${kind}${tag ? ` (${fixText(tag)})` : ''}${alignment ? `, ${alignment}` : ''}` };
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
  const hp = /\bHP\s*['’.]?\s*([0-9A-Za-z]{1,4})\s*\(['’.]?([^)]*)\)/.exec(headText);
  if (hp) {
    m.hp_dice = fixText(hp[2].replace(/['’]/g, '')).replace(/(?<=d\d*)[a-zA-Z]|(?<=[+-]\s?\d*)[a-zA-Z]/g, (c) => DIGIT[c] ?? c).replace(/\s*([+-])\s*/g, ' $1 ');
    const avg = avgHp(m.hp_dice);
    const n = ocrNum(hp[1]);
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
  const toks = head.filter((l) => !/^(Skills|Senses|Languages|C\s?R|Resist|[lI]mmun|Vulner|Gear)\b/.test(l.text)).map((l) => l.text).join(' ')
    .replace(/([+\-−])['’.]/g, '$1')
    .replace(/(?<=\s|^)([A-Za-z.]{2,5})['’.,]?([\]\[]?\d{1,2})(?=\s)/g, '$1 $2')
    .replace(/(?<=\s)['’.,](?=[\dlI\]])/g, '').split(/\s+/);
  const isNum = (t) => /^[0-9lIOoSs\]]{1,2}$/.test(t) && Number.isFinite(ocrNum(t));
  const isMod = (t) => /^[+\-−][0-9lIOoZz\]]{1,2}$/.test(t);
  let cSeen = 0;
  for (let i = 0; i < toks.length - 2; i++) {
    const lab = toks[i].toLowerCase().replace(/[^a-z]/g, '');
    if (lab.length < 2 || lab.length > 5 || !isNum(toks[i + 1]) || !isMod(toks[i + 2])) continue;
    let key = { s: 'str', d: 'dex', w: 'wis', i: 'int', l: 'int' }[lab[0]];
    if (lab[0] === 'c') key = lab[1] === 'o' ? 'con' : 'hxn'.includes(lab[1]) ? 'cha' : cSeen ? 'cha' : 'con';
    // An unreadable or duplicate label ("l9ts" for Wis) is most likely the score still missing.
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
  const starts = [];
  for (let i = 1; i < stream.length; i++) {
    if (isTypeLine(stream[i].text) && stream[i - 1].h >= 11 && letters(stream[i - 1].text).length >= 3) {
      // The next few lines must look like a stat block header.
      const ahead = stream.slice(i + 1, i + 8).map((l) => l.text).join(' ');
      if (/\bAC\b|HP\s/.test(ahead)) starts.push(i - 1);
    }
  }
  return starts.map((s, k) => {
    const limit = k + 1 < starts.length ? starts[k + 1] : stream.length;
    let end = s + 2;
    let pastCr = false;
    for (; end < limit; end++) {
      const l = stream[end];
      if (isCrLine(l.text)) pastCr = true;
      // The block ends at the next big heading (the following monster's lore entry or a sidebar).
      const lt = letters(l.text).length;
      if (pastCr && l.h >= 15.5 && lt >= 4 && lt / l.text.replace(/\s/g, '').length >= 0.7 && !sectionOf(l.text)) break;
      if (pastCr && /^H\S*\s.*\bTreasure\b/.test(l.text)) { end = Math.max(s + 2, end - 2); break; }
      // Running footer ("ARCANALOTH 19") between pages.
    }
    const lines = stream.slice(s, end).filter((l) => !/^[A-Z][A-Z'’\- ]{2,}\s+[0-9lIO ]{1,5}$/.test(l.text) && !/^[0-9lIO]{1,3}\s+[A-Z][A-Z'’\- ]{2,}$/.test(l.text));
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

/** Whole pipeline: bbox html of the book + layout text of its index pages → [monster]. */
export function parseMonsterManual(html, indexText, listText = '') {
  const pages = pageLines(html);
  const book = bookPages(pages);
  const vocab = bookVocab(pages);
  const seenNames = new Set();
  const index = parseIndex(indexText).map((e) => ({ ...e, name: repairName(e.name, vocab) }))
    .filter((e) => !seenNames.has(e.name) && seenNames.add(e.name));
  const blocks = findBlocks(pages.slice(8));
  const fix = wordFixer(vocab);
  // Match stat blocks to index names: by page (±2) and similarity of the garbled heading, best pairs first.
  const parsed = blocks.map((b) => ({ b, m: parseBlock(b.lines), bp: book[b.page - 1] }));
  const score = (g, name) => similarity(g, name) + (letters(g)[0] === letters(name)[0] ? 0.15 : 0) - 0.04 * Math.abs(letters(g).length - letters(name).length);
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
    const dp = pageClose(e.page, p.bp);
    const sc = score(p.m.garbled, e.name);
    if (dp != null) pairs.push({ bi, ei, s: sc - 0.05 * dp });
    else if (sc >= 0.75) pairs.push({ bi, ei, s: sc - 0.3 }); // a near-exact name anywhere in the book
  }));
  pairs.sort((x, y) => y.s - x.s);
  const nameOf = new Map();
  const usedE = new Set();
  for (const pr of pairs) if (pr.s >= 0.25 && !nameOf.has(pr.bi) && !usedE.has(pr.ei)) { nameOf.set(pr.bi, index[pr.ei].name); usedE.add(pr.ei); }
  // Blocks the index could not name: try the appendix name lists (no pages, so a stricter match).
  const taken = new Set(nameOf.values());
  const extra = parseNameList(listText).map((n) => repairName(n, vocab)).filter((n) => !taken.has(n));
  const pairs2 = [];
  parsed.forEach((p, bi) => { if (!nameOf.has(bi)) extra.forEach((n, ni) => pairs2.push({ bi, ni, s: score(p.m.garbled, n) })); });
  pairs2.sort((x, y) => y.s - x.s);
  const usedN = new Set();
  for (const pr of pairs2) {
    const g = letters(parsed[pr.bi].m.garbled);
    if (pr.s >= 0.45 && g[0] === letters(extra[pr.ni])[0] && !nameOf.has(pr.bi) && !usedN.has(pr.ni)) { nameOf.set(pr.bi, extra[pr.ni]); usedN.add(pr.ni); }
  }
  const out = [];
  parsed.forEach(({ m, bp }, bi) => {
    if (m.ac == null && m.hp == null) return; // a sidebar or list that merely looked like a stat block
    const name = cleanName(nameOf.get(bi) || titleCase(fixText(m.garbled).replace(/[^A-Za-z' -]/g, '').replace(/^[\s'-]+/, '')), vocab) || 'Unknown Monster';
    const { garbled, ...rest } = m;
    for (const sec of rest.sections) for (const e of sec.entries) { e.name = fix(e.name.replace(/^([a-z]{1,2}|[A-Za-z]{1,2}\s)\s*(?=[A-Z])/, '')); e.text = fix(e.text); }
    for (const k of ['speed', 'skills', 'vulnerabilities', 'resistances', 'immunities', 'gear', 'senses', 'languages']) if (rest[k]) rest[k] = fix(rest[k]);
    out.push({ index: `mm-${slug(name)}`, name, page: bp, ...rest, source: 'MM' });
  });
  // Unique indexes (two stat blocks can share a name, e.g. variants).
  const seen = new Map();
  for (const m of out) { const n = seen.get(m.index) || 0; seen.set(m.index, n + 1); if (n) m.index += `-${n + 1}`; }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

let cached = null;
/** Monster Manual stat blocks, or [] without the PDF. Parsed once and cached in DATA_DIR. */
export function loadMonsters(dataDir) {
  if (cached) return cached;
  cached = [];
  const pdf = process.env.MM_PDF || path.resolve('..', 'D&D 5e - Monster Manual 2024.pdf');
  const cache = dataDir && path.join(dataDir, 'mm-monsters-v1.json'); // bump the version when the parser improves
  try {
    if (cache && fs.existsSync(cache)) return (cached = JSON.parse(fs.readFileSync(cache, 'utf8')));
    if (!fs.existsSync(pdf) || fs.statSync(pdf).size === 0) return cached; // no book (or /dev/null mounted in its place)
    const html = execFileSync('pdftotext', ['-bbox-layout', pdf, '-'], { maxBuffer: 256 * 1024 * 1024 }).toString();
    // The "Index of Stat Blocks" sits on the first PDF pages; layout mode keeps "Name.....page" on one line.
    const indexText = execFileSync('pdftotext', ['-layout', '-f', '5', '-l', '10', pdf, '-'], { maxBuffer: 16 * 1024 * 1024 }).toString();
    // Appendix B lists every stat block by habitat, creature type and CR: a second source of clean names.
    const listText = execFileSync('pdftotext', ['-layout', '-f', '376', '-l', '390', pdf, '-'], { maxBuffer: 16 * 1024 * 1024 }).toString();
    cached = parseMonsterManual(html, indexText, listText);
    if (cache) { fs.mkdirSync(dataDir, { recursive: true }); fs.writeFileSync(cache, JSON.stringify(cached)); }
  } catch (e) {
    console.warn('Monster Manual extraction failed:', e.message);
  }
  return cached;
}
