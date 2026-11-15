// "Download PDF": the character written onto the official D&D 2024 character sheet (pages 1-2), followed by
// detail pages with every feature, spell, item and story text in full. The sheet artwork is the owner's
// DnD_2024_Character-Sheet.pdf, rasterised once (keeps the download ~1 MB instead of 16 MB); the text is real
// PDF text on top. Without that PDF, the detail pages are produced on their own.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { Router } from 'express';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { DATA_DIR } from './db.js';
import { h, requireUser, HttpError } from './core.js';
import { getCharacter } from './routes/characters.js';
import { getRules } from './rulesData.js';
import { ABILITIES, ABILITY_NAMES, SKILLS, derived, signed, normalizeCharacter } from '../shared/rules.js';
import { itemOf, totalWeight } from '../shared/items.js';

const W = 603, H = 774; // official sheet page size (pt)
const INK = rgb(0.08, 0.08, 0.2);
const GREY = rgb(0.35, 0.35, 0.4);

export const sheetTemplatePath = () => process.env.SHEET_PDF || path.resolve('..', 'DnD_2024_Character-Sheet.pdf');

/** Page backgrounds as JPEGs (cached in DATA_DIR), or null when the official sheet PDF is not available. */
function backgrounds() {
  const pdf = sheetTemplatePath();
  const out = [1, 2].map((n) => path.join(DATA_DIR, `sheet-bg-${n}.jpg`));
  if (out.every((f) => fs.existsSync(f))) return out.map((f) => fs.readFileSync(f));
  if (!fs.existsSync(pdf)) return null;
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    execFileSync('pdftoppm', ['-r', '150', '-jpeg', '-jpegopt', 'quality=82', '-f', '1', '-l', '2', pdf, path.join(DATA_DIR, 'sheet-bg')], { stdio: 'ignore' });
    return out.map((f) => fs.readFileSync(f));
  } catch (e) {
    console.warn('Could not rasterise the character sheet template:', e.message);
    return null;
  }
}

// ---------- text helpers ----------
function makeText(font, bold) {
  const charset = new Set(font.getCharacterSet());
  const clean = (t) => String(t ?? '').replace(/[★✓✔]/g, '*').replace(/[→]/g, '->').replace(/[ ]/g, ' ')
    .split('').filter((c) => c === '\n' || charset.has(c.codePointAt(0))).join('');
  const width = (t, size, f = font) => f.widthOfTextAtSize(clean(t), size);
  /** Fit one line: shrink to minSize, then truncate with an ellipsis. */
  const fit = (t, max, size, minSize = 5, f = font) => {
    let s = size;
    const c = clean(t);
    while (s > minSize && f.widthOfTextAtSize(c, s) > max) s -= 0.5;
    if (f.widthOfTextAtSize(c, s) <= max) return { text: c, size: s };
    let cut = c;
    while (cut && f.widthOfTextAtSize(`${cut}...`, s) > max) cut = cut.slice(0, -1);
    return { text: `${cut}...`, size: s };
  };
  /** Word-wrap to lines of max width. */
  const wrap = (t, max, size, f = font) => {
    const lines = [];
    for (const para of clean(t).split('\n')) {
      let line = '';
      for (const word of para.split(/\s+/)) {
        const next = line ? `${line} ${word}` : word;
        if (f.widthOfTextAtSize(next, size) <= max || !line) line = next;
        else { lines.push(line); line = word; }
      }
      lines.push(line);
    }
    return lines;
  };
  return { clean, width, fit, wrap, font, bold };
}

function drawer(page, T) {
  const text = (t, x, y, { size = 9, max, center, f = T.font, color = INK, minSize } = {}) => {
    if (t == null || t === '') return;
    const r = max ? T.fit(t, max, size, minSize, f) : { text: T.clean(t), size };
    const dx = center ? -f.widthOfTextAtSize(r.text, r.size) / 2 : 0;
    page.drawText(r.text, { x: x + dx, y, size: r.size, font: f, color });
  };
  /** Wrapped block inside a box; returns what did not fit (a half-written paragraph continues as "(cont.)"). */
  const block = (items, { x, top, w, bottom, size = 6.5, gap = 1.2 }) => {
    let y = top;
    const lh = size * gap;
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const lines = [...(it.title ? [{ t: it.title, b: true }] : []), ...T.wrap(it.body || '', w, size).filter(Boolean).map((t) => ({ t }))];
      if (y - lh * Math.min(lines.length, 2) < bottom) return items.slice(i);
      for (let k = 0; k < lines.length; k++) {
        const l = lines[k];
        if (y - lh < bottom) return [{ title: it.title ? `${it.title.replace(/ \(cont\.\)$/, '')} (cont.)` : '', body: lines.slice(k).map((m) => m.t).join(' ') }, ...items.slice(i + 1)];
        y -= lh;
        page.drawText(l.b ? T.fit(l.t, w, size, 4, T.bold).text : l.t, { x, y, size, font: l.b ? T.bold : T.font, color: l.b ? INK : GREY });
      }
      y -= lh * 0.35;
    }
    return [];
  };
  const diamond = (x, y, r = 3) => page.drawSvgPath(`M 0 ${-r} L ${r} 0 L 0 ${r} L ${-r} 0 Z`, { x, y, color: INK });
  const dot = (x, y, r = 3) => page.drawCircle({ x, y, size: r, color: INK });
  return { text, block, diamond, dot };
}

const short = (t, n = 140) => { const s = String(t || '').replace(/\s+/g, ' ').trim(); return s.length > n ? `${s.slice(0, n).replace(/\s\S*$/, '')}...` : s; };

// ---------- page 1 ----------
function pageOne(page, d, x, rules, T) {
  const { text, block, diamond, dot } = drawer(page, T);
  const B = T.bold;
  text(d.name, 25, 747, { size: 13, max: 205, f: B });
  text(d.background?.name, 25, 724, { size: 9, max: 118 });
  text(d.classes.map((c) => `${c.name} ${c.level}`).join(' / '), 150, 724, { size: 9, max: 92 });
  text(d.subrace?.name || d.race?.name, 25, 703, { size: 9, max: 118 });
  text(d.classes.map((c) => c.subclass_name).filter(Boolean).join(' / '), 150, 703, { size: 9, max: 92 });
  text(String(x.level), 277, 733, { size: 16, center: true, f: B });
  text(d.xp ? String(d.xp) : '', 277, 691, { size: 7, center: true, max: 30 });
  text(String(d.ac), 339, 717, { size: 20, center: true, f: B });
  if (d.equipment.some((e) => e.equipped && itemOf(rules, e)?.kind === 'Shield')) diamond(339.5, 697.5, 2.6);
  text(String(d.hp.current), 404, 716, { size: 18, center: true, f: B });
  text(d.hp.temp ? String(d.hp.temp) : '', 455, 726, { size: 10, center: true });
  text(String(d.hp.max), 455, 705, { size: 10, center: true, f: B });
  const hd = Object.entries(d.hit_dice);
  text(hd.map(([k, v]) => `${v.used || 0}${k}`).join(' '), 512, 726, { size: 8, center: true, max: 42 });
  text(hd.map(([k, v]) => `${v.total}${k}`).join(' '), 512, 705, { size: 8, center: true, max: 42 });
  for (let i = 0; i < 3; i++) {
    if (d.death_saves.success > i) diamond(545 + i * 10, 729.7, 2.6);
    if (d.death_saves.fail > i) diamond(545 + i * 10, 709.2, 2.6);
  }
  text(signed(x.pb), 57, 621, { size: 20, center: true, f: B });
  text(signed(x.initiative), 263, 629, { size: 14, center: true, f: B });
  text(`${d.speed} ft`, 356, 629, { size: 13, center: true, f: B });
  text(d.size, 451, 629, { size: 11, center: true, max: 70 });
  text(String(x.passive_perception), 545, 629, { size: 14, center: true, f: B });
  if (d.inspiration) diamond(57, 181.5, 5);

  // ability blocks: [modifier circle centre, score centre, save y, skills [name, y]]
  const blocks = {
    str: { cx: 41.5, cy: 548, sx: 79, sy: 547, save: 508.8, skills: [['Athletics', 488.8]], px: 21.6, vx: 36 },
    dex: { cx: 41.5, cy: 430, sx: 79, sy: 429, save: 390.8, skills: [['Acrobatics', 370.9], ['Sleight of Hand', 357], ['Stealth', 343.2]], px: 21.6, vx: 36 },
    con: { cx: 41.5, cy: 284.5, sx: 79, sy: 284, save: 245.2, skills: [], px: 21.6, vx: 36 },
    int: { cx: 148.4, cy: 624, sx: 186, sy: 623, save: 586.3, skills: [['Arcana', 566.4], ['History', 552], ['Investigation', 538.1], ['Nature', 524.3], ['Religion', 509.9]], px: 128, vx: 142.5 },
    wis: { cx: 148.4, cy: 451, sx: 186, sy: 450, save: 412.4, skills: [['Animal Handling', 392.5], ['Insight', 378.1], ['Medicine', 364.3], ['Perception', 349.9], ['Survival', 336]], px: 128, vx: 142.5 },
    cha: { cx: 148.4, cy: 278, sx: 186, sy: 277, save: 238, skills: [['Deception', 218.1], ['Intimidation', 204.2], ['Performance', 190.4], ['Persuasion', 176]], px: 128, vx: 142.5 },
  };
  for (const a of ABILITIES) {
    const b = blocks[a];
    text(signed(x.mods[a]), b.cx, b.cy, { size: 15, center: true, f: B });
    text(String(d.abilities[a]), b.sx, b.sy, { size: 9, center: true, f: B });
    // (save / skill y values are the centres of the printed proficiency rings)
    if (d.saves.includes(a)) dot(b.px, b.save, 2.7);
    text(signed(x.saves[a]), b.vx, b.save - 2.5, { size: 7.5, center: true });
    for (const [s, y] of b.skills) {
      if (d.skills[s]) dot(b.px, y, 2.7);
      if (d.skills[s] === 'expert') text('E', b.px + 4, y + 1.5, { size: 4.5, f: B });
      text(signed(x.skills[s]), b.vx, y - 2.5, { size: 7.5, center: true });
    }
  }

  // weapons & damage cantrips (6 rows)
  d.attacks.slice(0, 6).forEach((a, i) => {
    const y = 563 - i * 17.6;
    text(a.name, 227, y, { size: 8, max: 105, f: B });
    text(a.bonus, 337, y, { size: 8, max: 42 });
    text(a.damage, 384, y, { size: 7.5, max: 76 });
    text(a.notes, 463, y, { size: 6.5, max: 125 });
  });

  const feat = (f) => ({ title: `${f.name}${f.source ? ` (${f.source})` : ''}`, body: short(f.desc) });
  let rest = block(d.features.map(feat), { x: 228, top: 422, w: 172, bottom: 222, size: 6 });
  rest = block(rest, { x: 411, top: 422, w: 175, bottom: 222, size: 6 });
  if (rest.length) text(`+ ${rest.length} more - full text on the detail pages`, 411, 215, { size: 5.5, color: GREY });
  const tr = block(d.traits.map(feat), { x: 228, top: 178, w: 162, bottom: 14, size: 6 });
  if (tr.length) text(`+ ${tr.length} more (detail pages)`, 228, 9, { size: 5.5, color: GREY });
  const ft = block(d.feats.map(feat), { x: 413, top: 178, w: 172, bottom: 14, size: 6 });
  if (ft.length) text(`+ ${ft.length} more (detail pages)`, 413, 9, { size: 5.5, color: GREY });

  const armor = d.proficiencies.armor.join(' ').toLowerCase();
  [['light', 63.7], ['medium', 96.9], ['heavy', 142.3], ['shield', 178.3]].forEach(([k, xx]) => {
    if (armor.includes(k) || (k !== 'shield' && armor.includes('all armor'))) diamond(xx, 125.6, 2.8);
  });
  block([{ body: d.proficiencies.weapons.join(', ') }], { x: 18, top: 110, w: 185, bottom: 60, size: 7 });
  block([{ body: d.proficiencies.tools.join(', ') }], { x: 18, top: 46, w: 185, bottom: 10, size: 7 });
}

// ---------- page 2 ----------
function pageTwo(page, d, x, rules, T) {
  const { text, block, diamond } = drawer(page, T);
  const B = T.bold;
  const sa = d.spellcasting.ability;
  text(sa ? ABILITY_NAMES[sa] : '', 25, 745, { size: 10, max: 110, f: B });
  if (sa) {
    text(signed(x.mods[sa]), 30, 712, { size: 13, center: true, f: B });
    text(String(x.spell_dc), 30, 685, { size: 13, center: true, f: B });
    text(signed(x.spell_attack), 30, 657, { size: 13, center: true, f: B });
  }
  const rows = [[188, 682.6, [202, 213, 224, 235]], [188, 668.8, [202, 213, 224]], [188, 655.5, [202, 213, 224]],
    [275.7, 682.6, [290.7, 300.7, 310.5]], [275.7, 668.8, [290.7, 300.7, 310.5]], [275.7, 655.5, [290.7, 300.7]],
    [354, 682.6, [369, 379]], [354, 668.8, [369]], [354, 655.5, [369]]];
  d.spellcasting.slots.forEach((s, i) => {
    if (!s.max && !s.used) return;
    const [tx, y, ds] = rows[i];
    text(String(s.max), tx, y, { size: 8, center: true, f: B });
    ds.slice(0, Math.min(s.used, ds.length)).forEach((dx) => diamond(dx + 1.5, y + 2.6, 2.4));
  });
  if (d.spellcasting.pact) text(`Pact: ${d.spellcasting.pact.max - d.spellcasting.pact.used}/${d.spellcasting.pact.max} slots of level ${d.spellcasting.pact.level}`, 155, 645, { size: 6.5, color: GREY });

  const spells = [...d.spells].sort((a, b) => (a.level || 0) - (b.level || 0) || a.name.localeCompare(b.name));
  spells.slice(0, 30).forEach((sp, i) => {
    const y = 774 - (335 + i * 35.07) / 1.806 - 3;
    const info = rules.spells.find((s) => s.name.toLowerCase() === sp.name.toLowerCase());
    text(sp.level ? String(sp.level) : 'C', 26, y, { size: 7.5, center: true, f: B });
    text(sp.name, 43, y, { size: 7.5, max: 108, f: sp.prepared || !sp.level ? B : T.font });
    text(sp.casting_time || info?.casting_time, 154, y, { size: 6, max: 33 });
    text(sp.range || info?.range, 189.5, y, { size: 6, max: 46 });
    if (sp.concentration ?? info?.concentration) diamond(243, y + 3, 2.4);
    if (sp.ritual ?? info?.ritual) diamond(265.7, y + 3, 2.4);
    if (/M/.test(sp.components || info?.components || '')) diamond(287.3, y + 3, 2.4);
    text([sp.level && !sp.prepared ? 'not prepared' : '', sp.notes, info?.material && short(info.material, 60)].filter(Boolean).join('; '), 304.5, y, { size: 5.5, max: 90 });
  });
  if (spells.length > 30) text(`+ ${spells.length - 30} more spells on the detail pages`, 43, 8, { size: 6, color: GREY });

  block([{ body: d.appearance }], { x: 412, top: 740, w: 174, bottom: 673, size: 6.5 });
  const p = d.personality;
  block([
    p.traits && { title: 'Personality', body: short(p.traits, 220) }, p.ideals && { title: 'Ideals', body: short(p.ideals, 160) },
    p.bonds && { title: 'Bonds', body: short(p.bonds, 160) }, p.flaws && { title: 'Flaws', body: short(p.flaws, 160) },
    d.backstory && { title: 'Backstory', body: short(d.backstory, 600) },
  ].filter(Boolean), { x: 412, top: 630, w: 174, bottom: 500, size: 6 });
  text(d.alignment, 448, 491, { size: 8, max: 136 });
  block([{ body: d.proficiencies.languages.join(', ') }], { x: 412, top: 428, w: 174, bottom: 397, size: 7 });
  const eq = d.equipment.map((e) => `${e.qty > 1 ? `${e.qty}x ` : ''}${e.name}${e.equipped ? '*' : ''}`).join(', ');
  const wt = totalWeight(d, rules);
  block([{ body: eq }, { body: `* equipped · ${+wt.toFixed(1)} lb carried` }], { x: 412, top: 360, w: 174, bottom: 182, size: 6.3 });
  d.attunement.forEach((a, i) => text(a, 432, [168, 148, 128][i], { size: 7.5, max: 152 }));
  [['cp', 428], ['sp', 464], ['ep', 499.5], ['gp', 535], ['pp', 570]].forEach(([c, cx]) => text(d.coins[c] ? String(d.coins[c]) : '', cx, 57, { size: 9, center: true, max: 30, f: B }));
}

// ---------- detail pages ----------
async function detailPages(doc, d, rules, T, portrait) {
  let page, y;
  const M = 40, WIDTH = W - 2 * M;
  const newPage = () => { page = doc.addPage([W, H]); y = H - M; };
  const need = (h) => { if (y - h < M) newPage(); };
  const line = (t, size = 8.5, f = T.font, color = INK, indent = 0) => {
    for (const l of T.wrap(t, WIDTH - indent, size, f)) { need(size * 1.3); y -= size * 1.3; page.drawText(l, { x: M + indent, y, size, font: f, color }); }
  };
  const heading = (t) => { need(40); y -= 10; line(t, 13, T.bold); page.drawLine({ start: { x: M, y: y - 3 }, end: { x: W - M, y: y - 3 }, thickness: 0.6, color: GREY }); y -= 6; };
  const entry = (title, body, meta) => { need(30); y -= 3; line(title, 9.5, T.bold); if (meta) line(meta, 7.5, T.font, GREY); if (body) line(body, 8.5, T.font, GREY); };

  newPage();
  if (portrait) {
    try {
      const img = portrait.startsWith('data:image/png') ? await doc.embedPng(portrait) : await doc.embedJpg(portrait);
      const s = 70 / Math.max(img.width, img.height);
      page.drawImage(img, { x: W - M - img.width * s, y: H - M - img.height * s, width: img.width * s, height: img.height * s });
    } catch { /* unsupported portrait format */ }
  }
  line(d.name || 'Unnamed', 18, T.bold);
  line(`${d.subrace?.name || d.race?.name || ''} · ${d.classes.map((c) => `${c.name}${c.subclass_name ? ` (${c.subclass_name})` : ''} ${c.level}`).join(' / ')} · ${d.background?.name || ''}`, 9, T.font, GREY);
  y -= 8;

  if (d.attacks.length) { heading('Attacks'); for (const a of d.attacks) entry(a.name, a.notes, `${a.bonus} to hit / DC · ${a.damage}`); }
  if (d.features.length) { heading('Class features'); for (const f of d.features) entry(f.name, f.desc, f.source); }
  if (d.traits.length) { heading('Species traits'); for (const f of d.traits) entry(f.name, f.desc, f.source); }
  if (d.feats.length) { heading('Feats'); for (const f of d.feats) entry(f.name, f.desc); }
  if (d.resources.length) { heading('Limited-use resources'); line(d.resources.map((r) => `${r.name}: ${Math.max(0, r.max - (r.used || 0))}/${r.max} (${r.recharge} rest)`).join(' · ')); }
  if (d.spells.length) {
    heading('Spells');
    const sorted = [...d.spells].sort((a, b) => (a.level || 0) - (b.level || 0) || a.name.localeCompare(b.name));
    for (const sp of sorted) {
      const s = rules.spells.find((k) => k.name.toLowerCase() === sp.name.toLowerCase()) || {};
      const meta = [sp.level ? `Level ${sp.level}` : 'Cantrip', s.school, sp.casting_time || s.casting_time, sp.range || s.range, s.components && `${s.components}${s.material ? ` (${s.material})` : ''}`,
        `${(sp.concentration ?? s.concentration) ? 'Concentration, ' : ''}${s.duration || sp.duration || ''}`, (sp.ritual ?? s.ritual) && 'ritual', sp.level && !sp.prepared && 'not prepared'].filter(Boolean).join(' · ');
      entry(sp.name, [s.desc, s.higher_level && `At higher levels: ${s.higher_level}`, sp.notes].filter(Boolean).join('\n'), meta);
    }
  }
  if (d.equipment.length) {
    heading('Equipment');
    for (const e of d.equipment) {
      const it = itemOf(rules, e);
      const meta = [it && `${it.kind}${it.sub ? ` (${it.sub})` : ''}`, it?.damage, it?.versatile && `two-handed ${it.versatile}`, it?.ac && `AC ${it.kind === 'Shield' ? '+' : ''}${it.ac.base}${it.ac.dex ? ' + DEX' : ''}${it.ac.max_dex != null ? ` (max ${it.ac.max_dex})` : ''}`,
        it?.properties?.join(', '), (it?.weight ?? e.weight) != null && `${it?.weight ?? e.weight} lb`, it?.cost, e.equipped && 'equipped'].filter(Boolean).join(' · ');
      entry(`${e.qty > 1 ? `${e.qty}x ` : ''}${e.name}`, [e.notes, e.desc].filter(Boolean).join(' - '), meta);
    }
    line(`Coins: ${['pp', 'gp', 'ep', 'sp', 'cp'].map((c) => `${d.coins[c]} ${c}`).join(', ')} · Carried ${+totalWeight(d, rules).toFixed(1)} lb of ${(Number(d.abilities.str) || 10) * 15} lb`, 8.5, T.font, GREY);
  }
  const p = d.personality;
  const story = [['Personality traits', p.traits], ['Ideals', p.ideals], ['Bonds', p.bonds], ['Flaws', p.flaws], ['Appearance', d.appearance], ['Backstory', d.backstory], ['Allies & organisations', d.allies], ['Notes', d.notes]].filter(([, v]) => v);
  if (story.length) { heading('Personality & story'); for (const [k, v] of story) entry(k, v); }
  if (d.conditions.length || d.effects.length || d.exhaustion) {
    heading('Current state');
    line([d.conditions.length && `Conditions: ${d.conditions.map((c) => c.name).join(', ')}`, d.exhaustion && `Exhaustion ${d.exhaustion}`, d.effects.length && `Effects: ${d.effects.map((e) => e.name).join(', ')}`].filter(Boolean).join(' · '));
  }
  if (d.level_log.length) { heading('Level log'); for (const l of d.level_log) line(`Level ${l.level}: ${l.class} · +${l.hp} HP${l.note ? ` · ${l.note}` : ''}`, 8); }
}

/** Build the PDF bytes for one character. */
export async function buildSheetPdf(data) {
  const rules = getRules();
  const d = normalizeCharacter(data);
  const x = derived(d);
  const doc = await PDFDocument.create();
  doc.setTitle(`${d.name || 'Character'} — character sheet`);
  doc.setCreator('Party Ledger');
  const T = makeText(await doc.embedFont(StandardFonts.Helvetica), await doc.embedFont(StandardFonts.HelveticaBold));
  const bgs = backgrounds();
  if (bgs) {
    for (const [i, fill] of [[0, pageOne], [1, pageTwo]]) {
      const page = doc.addPage([W, H]);
      page.drawImage(await doc.embedJpg(bgs[i]), { x: 0, y: 0, width: W, height: H });
      fill(page, d, x, rules, T);
    }
  }
  await detailPages(doc, d, rules, T, /^data:image\/(png|jpe?g);base64,/.test(d.portrait || '') ? d.portrait : '');
  return doc.save();
}

const fileName = (n) => `${String(n || 'character').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '_') || 'character'}_sheet.pdf`;

export function sheetRoutes(db) {
  const r = Router();
  r.get('/characters/:id/pdf', h(async (req, res) => {
    const ch = getCharacter(db, requireUser(req), req.params.id);
    const bytes = await buildSheetPdf(ch.data);
    res.type('application/pdf').set('Content-Disposition', `${req.query.inline ? 'inline' : 'attachment'}; filename="${fileName(ch.data.name)}"`).send(Buffer.from(bytes));
  }));
  // The blank official sheet, for players who would rather fill it in by hand.
  r.get('/sheet/blank.pdf', h((req, res) => {
    requireUser(req);
    const f = sheetTemplatePath();
    if (!fs.existsSync(f)) throw new HttpError(404, 'The official character sheet PDF is not installed on this server');
    res.type('application/pdf').set('Content-Disposition', 'attachment; filename="DnD_2024_Character-Sheet.pdf"').sendFile(f);
  }));
  return r;
}
