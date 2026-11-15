// Player's Handbook spells that are not in the SRD (Hex, Armor of Agathys, Chromatic Orb…), read from the
// owner's own PHB PDF at runtime. Nothing from the PHB is committed to the repo: if the PDF is missing,
// the app simply has the SRD spell list. The PDF is an OCR scan, so words come out split ("cu rse",
// "W h en"); fragments are re-joined using a vocabulary built from the SRD texts.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const SCHOOLS = ['abjuration', 'conjuration', 'divination', 'enchantment', 'evocation', 'illusion', 'necromancy', 'transmutation'];

// The 42 PHB (2014) spells that are not in the SRD, with the classes whose PHB spell list has them.
// Names and class lists only; descriptions come from the owner's PDF.
export const PHB_ONLY_SPELLS = {
  'Blade Ward': ['bard', 'sorcerer', 'warlock', 'wizard'], Friends: ['bard', 'sorcerer', 'warlock', 'wizard'], 'Thorn Whip': ['druid'],
  'Armor of Agathys': ['warlock'], 'Arms of Hadar': ['warlock'], 'Chromatic Orb': ['sorcerer', 'wizard'], 'Compelled Duel': ['paladin'],
  'Dissonant Whispers': ['bard'], 'Ensnaring Strike': ['ranger'], 'Hail of Thorns': ['ranger'], Hex: ['warlock'], 'Searing Smite': ['paladin'],
  'Thunderous Smite': ['paladin'], 'Witch Bolt': ['sorcerer', 'warlock', 'wizard'], 'Wrathful Smite': ['paladin'], 'Ray of Sickness': ['sorcerer', 'wizard'],
  'Beast Sense': ['druid', 'ranger'], 'Cloud of Daggers': ['bard', 'sorcerer', 'warlock', 'wizard'], 'Cordon of Arrows': ['ranger'],
  'Crown of Madness': ['bard', 'sorcerer', 'warlock', 'wizard'], 'Phantasmal Force': ['bard', 'sorcerer', 'wizard'],
  'Aura of Vitality': ['paladin'], 'Blinding Smite': ['paladin'], 'Conjure Barrage': ['ranger'], "Crusader's Mantle": ['paladin'],
  'Elemental Weapon': ['paladin'], 'Feign Death': ['bard', 'cleric', 'druid', 'wizard'], 'Hunger of Hadar': ['warlock'], 'Lightning Arrow': ['ranger'],
  'Aura of Life': ['paladin'], 'Aura of Purity': ['paladin'], 'Grasping Vine': ['druid', 'ranger'], 'Staggering Smite': ['paladin'],
  'Banishing Smite': ['paladin'], 'Circle of Power': ['paladin'], 'Conjure Volley': ['ranger'], 'Destructive Wave': ['paladin'], 'Swift Quiver': ['ranger'],
  'Arcane Gate': ['sorcerer', 'warlock', 'wizard'], Telepathy: ['wizard'], Tsunami: ['druid'], 'Power Word Heal': ['bard'],
};
const norm = (s) => String(s).toLowerCase().replace(/[^a-z]/g, '');
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/** Vocabulary (lower-case word → count) from any strings, used to repair OCR word splits. */
export function buildVocab(texts) {
  const v = new Map();
  for (const t of texts) for (const w of String(t).toLowerCase().match(/[a-z']+/g) || []) v.set(w, (v.get(w) || 0) + 1);
  return v;
}

// Real one- and two-letter words; any other short token ("th", "d", "cu") is an OCR fragment.
const SHORT = new Set('a i an as at be by do go he if in is it me my no of on or so to up us we'.split(' '));

/** Re-join OCR fragments: "W h en you u se" → "When you use". Greedy, longest known join first. */
export function repairWords(line, vocab) {
  const toks = line.split(/ +/).filter(Boolean);
  const out = [];
  let i = 0;
  // single letters other than "a"/"I" are OCR debris, never words of their own
  const known = (w) => { const k = w.toLowerCase().replace(/[^a-z']/g, ''); return (k.length > 2 || SHORT.has(k)) && vocab.has(k); };
  while (i < toks.length) {
    let best = 1;
    // Try joining up to 6 tokens; accept when the join is a known word and at least one part was not.
    for (let n = Math.min(6, toks.length - i); n >= 2; n--) {
      const parts = toks.slice(i, i + n);
      // only join pieces that are letters (keep punctuation on the last piece)
      if (parts.slice(0, -1).some((p) => /[^A-Za-z']/.test(p))) continue;
      const joined = parts.join('');
      const core = joined.replace(/[^A-Za-z']+$/, '');
      if (!known(core)) continue;
      // "for up" stays two words; "cu rse", "W h en", "at tack" get joined.
      if (parts.every((p) => known(p.replace(/[^A-Za-z']+$/, '')))) continue;
      best = n;
      break;
    }
    out.push(toks.slice(i, i + best).join(''));
    i += best;
  }
  return out.join(' ');
}

/**
 * Text in true reading order from `pdftotext -bbox-layout` output: per page, the left column top→bottom,
 * then the right column. Plain pdftotext sometimes interleaves the two columns of the scan.
 */
export function columnText(bboxHtml) {
  const out = [];
  const dec = (t) => t.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  for (const page of bboxHtml.split(/<page /).slice(1)) {
    const lines = [];
    for (const m of page.matchAll(/<line xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([\s\S]*?)<\/line>/g)) {
      const words = [...m[5].matchAll(/<word[^>]*>([^<]*)<\/word>/g)].map((w) => dec(w[1]));
      lines.push({ x0: Number(m[1]), x1: Number(m[3]), y: Number(m[2]), text: words.join(' ') });
    }
    // Scanned pages are shifted by different amounts, so find this page's left margin; anything starting
    // well right of it (a column is ~230pt wide) belongs to the right-hand column.
    const left = Math.min(...lines.map((l) => l.x0));
    for (const l of lines) l.col = l.x0 > left + 150 ? 1 : 0;
    lines.sort((a, b) => a.col - b.col || a.y - b.y);
    out.push(lines.map((l) => l.text).join('\n'));
  }
  return out.join('\n\f');
}

const JUNK = /^(C\s*h\s*a\s*p\s*t\s*e\s*r.*|\d{1,3}|S\s*p\s*e\s*l\s*l\s*s?)$/i;

/**
 * Parse spell entries from the PHB text (pdftotext, reading order).
 * Returns [{ name, level, school, ritual, casting_time, range, components, material, duration, concentration, desc, higher_level }].
 */
export function parsePhbSpells(txt, vocab, wanted = PHB_ONLY_SPELLS) {
  const lines = txt.split(/\r?\n/).map((l) => l.replace(/\f/g, '').trim());
  const starts = [];
  for (let i = 0; i < lines.length; i++) if (/^Casting\s*Tim\s*e\s*:/i.test(lines[i])) starts.push(i);
  const fix = (s) => repairWords(s.replace(/(\d) (?=\d)/g, '$1').replace(/ ?['’] ?(re|s|t|ll|ve|d)\b/g, "'$1"), vocab).replace(/\s+([,.;:)])/g, '$1').replace(/\(\s+/g, '(')
    .replace(/([a-z])(\d)/g, '$1 $2').replace(/’/g, "'")
    // dice and numbers mangled by OCR: "1d 6", "1dlO", "2 d 4", "a+1", "30 -foot"
    .replace(/(\d) ?d ?(\d)/g, '$1d$2').replace(/(\d)d ?l ?[oO0]\b/g, '$1d10').replace(/(\d)d ?l ?2\b/g, '$1d12').replace(/ (\+\d)/g, ' $1').replace(/([a-z])\+(\d)/g, '$1 +$2')
    .replace(/(\d) -(foot|feet|mile|inch)/g, '$1-$2').trim();
  // Big spell-name headings can wrap or come out word-shuffled ("C loud" / "D aggers" / "of"), so match the
  // last 1-4 lines before the level line by their letters, ignoring order.
  const sig = (t) => norm(t).split('').sort().join('');
  const bySig = new Map(Object.keys(wanted).map((n) => [sig(n), n]));
  const nameAt = (hIdx) => {
    let idx = hIdx, acc = '';
    for (let n = 1; n <= 4; n++) {
      idx = prevNonBlank(idx);
      if (idx < 0 || lines[idx].length > 40) break;
      acc += lines[idx];
      if (bySig.has(sig(acc))) return { name: bySig.get(sig(acc)), from: idx };
    }
    const a = prevNonBlank(hIdx), b = prevNonBlank(a);
    return { name: null, from: lines[b]?.length < 28 && !/[.,:;]$/.test(lines[b]) && /^[A-Z]/.test(lines[b]) ? b : a };
  };
  const prevNonBlank = (i) => { let j = i - 1; while (j >= 0 && !lines[j]) j--; return j; };
  const spells = [];
  for (let k = 0; k < starts.length; k++) {
    const ct = starts[k];
    const hIdx = prevNonBlank(ct);
    const { name } = nameAt(hIdx);
    if (!name) continue;
    const header = lines[hIdx].replace(/\s+/g, ' ').toLowerCase().replace(/(\d) (st|nd|rd|th)/, '$1$2');
    let level, school;
    const m1 = header.match(/^(\d)(?:st|nd|rd|th)-level ([a-z]+)/);
    const m2 = header.match(/^([a-z]+) cantrip/);
    if (m1) { level = Number(m1[1]); school = m1[2]; } else if (m2) { level = 0; school = m2[1]; } else continue;
    if (!SCHOOLS.includes(school)) continue;
    // body: until the name line(s) of the next spell
    const end = k + 1 < starts.length ? nameAt(prevNonBlank(starts[k + 1])).from : Math.min(lines.length, ct + 60);
    const field = (re) => { for (let j = ct; j < ct + 8; j++) { const m = lines[j]?.match(re); if (m) return { v: m[1], j }; } return null; };
    const casting = field(/^Casting\s*Tim\s*e\s*:\s*(.*)$/i);
    const range = field(/^Range\s*:\s*(.*)$/i);
    const comp = field(/^Com\s*ponents\s*:\s*(.*)$/i);
    const dur = field(/^Duration\s*:\s*(.*)$/i);
    if (!casting || !range || !comp || !dur) continue;
    // components may wrap onto the next line until the closing parenthesis
    let compText = comp.v;
    let j = comp.j;
    while ((compText.match(/\(/g) || []).length > (compText.match(/\)/g) || []).length && j < dur.j - 1) compText += ` ${lines[++j]}`;
    let body = lines.slice(dur.j + 1, end).filter((l) => l && !JUNK.test(l.replace(/\s+/g, ' ')));
    let text = body.join('\n');
    // join hyphenated breaks and soft line wraps into paragraphs
    text = text.replace(/-\n(?=[a-z])/g, '').replace(/\n(?=[a-z(])/g, ' ').replace(/([^.:!?])\n/g, '$1 ');
    const paras = text.split('\n').map(fix);
    const hi = paras.findIndex((p) => /^At Higher Levels\./i.test(p));
    const compFixed = fix(compText);
    const mat = compFixed.match(/\((.*)\)/);
    const durFixed = fix(dur.v);
    spells.push({
      index: `phb-${name.toLowerCase().replace(/[^a-z]+/g, '-').replace(/-$/, '')}`,
      name, level, school: cap(school), ritual: /ritual/.test(header),
      casting_time: fix(casting.v), range: fix(range.v),
      components: compFixed.replace(/\s*\(.*\)/, '').replace(/\s/g, '').replace(/,/g, ', '),
      material: mat ? mat[1] : '', duration: durFixed.replace(/^Concentration,\s*/i, ''), concentration: /^Concentration/i.test(durFixed),
      desc: (hi >= 0 ? paras.slice(0, hi) : paras).join('\n'),
      higher_level: hi >= 0 ? paras.slice(hi).join('\n').replace(/^At Higher Levels\.\s*/i, '') : '',
      classes: wanted[name] || [], source: 'PHB',
    });
  }
  return spells;
}

let cached = null;
/** PHB-only spells (not already in `srdSpells`), or [] when no PDF is available. Cached in DATA_DIR. */
export function loadPhbSpells(srd, dataDir) {
  if (cached) return cached;
  cached = [];
  const pdf = process.env.PHB_PDF || path.resolve('..', 'PHB-5e.pdf');
  const cache = dataDir && path.join(dataDir, 'phb-spells-v1.json');
  try {
    if (cache && fs.existsSync(cache)) return (cached = JSON.parse(fs.readFileSync(cache, 'utf8')));
    if (!fs.existsSync(pdf)) return cached;
    // The spell descriptions sit on PDF pages ~190-268 of the 2014 PHB scan; read a little wider to be safe.
    const txt = columnText(execFileSync('pdftotext', ['-bbox-layout', '-f', '180', '-l', '275', pdf, '-'], { maxBuffer: 128 * 1024 * 1024 }).toString());
    const vocab = buildVocab([
      ...srd.spells.flatMap((s) => [s.name, s.desc, s.higher_level, s.material, s.range, s.duration, s.casting_time]),
      ...srd.conditions.map((c) => c.desc), ...srd.items.map((i) => `${i.name} ${i.desc || ''}`),
      ...srd.classes.flatMap((c) => Object.values(c.levels).flatMap((l) => l.features.map((f) => f.desc))),
      ...srd.races.flatMap((r) => r.traits.map((t) => t.desc)), ...srd.feats.map((f) => f.desc), ...srd.skills.map((s) => s.desc || ''),
      Object.keys(PHB_ONLY_SPELLS).join(' '), 'curse cold frost thorns smite duel vine quiver volley barrage mantle tsunami wave madness daggers',
    ]);
    const known = new Set(srd.spells.map((s) => norm(s.name)));
    const seen = new Set();
    cached = parsePhbSpells(txt, vocab).filter((s) => !known.has(norm(s.name)) && !seen.has(s.name) && seen.add(s.name));
    if (cache) { fs.mkdirSync(dataDir, { recursive: true }); fs.writeFileSync(cache, JSON.stringify(cached)); }
  } catch (e) {
    console.warn('PHB spell extraction failed:', e.message);
  }
  return cached;
}
