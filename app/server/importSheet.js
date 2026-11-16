// Character-sheet import: photos and/or PDFs (form fields + text + rendered pages) -> Codex vision with a strict JSON schema -> character draft.
// The draft is returned to the browser for review; nothing is saved until the player presses Create.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { Router } from 'express';
import { PDFDocument } from 'pdf-lib';
import { HttpError, h, requireUser } from './core.js';
import { runAgent } from './ai.js';
import { blankCharacter, suggestedSlots, ABILITIES } from '../shared/rules.js';
import srd from './data/srd.json' with { type: 'json' };

const S = { type: 'string' };
const N = { type: 'number' };
const obj = (props) => ({ type: 'object', additionalProperties: false, required: Object.keys(props), properties: props });
const arr = (items) => ({ type: 'array', items });
const named = obj({ name: S, desc: S });

export const SHEET_SCHEMA = obj({
  name: S, player: S, race: S, subrace: S, background: S, alignment: S, xp: N,
  classes: arr(obj({ name: S, subclass: S, level: N })),
  abilities: obj(Object.fromEntries(ABILITIES.map((a) => [a, N]))),
  saving_throw_proficiencies: arr({ type: 'string', enum: ABILITIES }),
  skills: arr(obj({ name: S, proficiency: { type: 'string', enum: ['prof', 'expert'] } })),
  ac: N, speed: N, size: S, hp_max: N, hp_current: N, hp_temp: N,
  armor_proficiencies: arr(S), weapon_proficiencies: arr(S), tool_proficiencies: arr(S), languages: arr(S),
  attacks: arr(obj({ name: S, bonus: S, damage: S, notes: S })),
  class_features: arr(named), species_traits: arr(named), feats: arr(named),
  spellcasting_ability: { type: 'string', enum: ['', ...ABILITIES] },
  spell_slots_total: arr(N),
  spells: arr(obj({ name: S, level: N, notes: S })),
  equipment: arr(obj({ name: S, qty: N })),
  attunement: arr(S),
  coins: obj({ cp: N, sp: N, ep: N, gp: N, pp: N }),
  appearance: S, backstory: S, personality_traits: S, ideals: S, bonds: S, flaws: S, notes: S,
  unreadable: S,
});

const PROMPT = `These images (and any PDF data below) are a filled-in Dungeons & Dragons 5e character sheet (any layout, possibly handwritten, possibly several pages).
Transcribe it into the JSON schema. Rules:
- Copy what is written; do not invent values. Use "" / 0 / [] when a field is empty or unreadable.
- abilities are the SCORES (e.g. 15), not modifiers.
- classes: one entry per class with its level (multiclass = several entries).
- spell_slots_total: 9 numbers, total slots for spell levels 1-9.
- spells: level 0 for cantrips.
- Put anything you could not read or that did not fit into "unreadable".`;

const MAX_PDF = 25 * 1024 * 1024;
const MAX_PAGES = 6;

/**
 * What a PDF sheet says: fillable form fields (exact values, e.g. D&D Beyond / official fillable sheets),
 * the text layer, and the pages rendered as images for vision. Returns { fields, text, images: [file] }.
 */
export async function readSheetPdf(bytes, dir, tag = 'pdf') {
  const out = { fields: [], text: '', images: [] };
  try {
    const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
    for (const f of doc.getForm().getFields()) {
      let v = '';
      try {
        if (typeof f.getText === 'function') v = f.getText() || '';
        else if (typeof f.isChecked === 'function') v = f.isChecked() ? '[x]' : '';
        else if (typeof f.getSelected === 'function') v = [].concat(f.getSelected() || []).join(', ');
      } catch { /* unreadable field */ }
      if (String(v).trim()) out.fields.push(`${f.getName()}: ${String(v).trim()}`);
    }
  } catch { /* not parseable by pdf-lib (or no form) — the text layer and page images still work */ }
  const file = path.join(dir, `${tag}.pdf`);
  fs.writeFileSync(file, bytes);
  try { out.text = execFileSync('pdftotext', ['-layout', '-l', String(MAX_PAGES), file, '-'], { maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { /* no text layer */ }
  try {
    execFileSync('pdftoppm', ['-r', '120', '-jpeg', '-jpegopt', 'quality=85', '-l', String(MAX_PAGES), file, path.join(dir, `${tag}-page`)], { stdio: 'ignore' });
    out.images = fs.readdirSync(dir).filter((f) => f.startsWith(`${tag}-page`)).sort().map((f) => path.join(dir, f));
  } catch { /* rendering failed — fields/text may still be enough */ }
  return out;
}

const find = (list, name) => list.find((x) => x.name.toLowerCase() === String(name || '').trim().toLowerCase())
  || list.find((x) => String(name || '').toLowerCase().includes(x.name.toLowerCase()));

export function sheetToCharacter(x) {
  const d = blankCharacter();
  const race = find(srd.races, x.race);
  const subrace = race && find(race.subraces, x.subrace);
  Object.assign(d, {
    name: x.name || 'Imported character', player: x.player || '', alignment: x.alignment || '', xp: x.xp || 0,
    race: race ? { index: race.index, name: race.name } : x.race ? { index: 'custom', name: x.race } : null,
    subrace: subrace ? { index: subrace.index, name: subrace.name } : x.subrace ? { index: 'custom', name: x.subrace } : null,
    background: x.background ? { index: find(srd.backgrounds, x.background)?.index || 'custom', name: x.background } : null,
    ac: x.ac || 10, speed: x.speed || race?.speed || 30, size: x.size || race?.size || 'Medium',
    abilities: Object.fromEntries(ABILITIES.map((a) => [a, x.abilities?.[a] || 10])),
    saves: x.saving_throw_proficiencies || [],
    skills: Object.fromEntries((x.skills || []).map((s) => [s.name.replace(/\s*\(.*\)/, '').trim(), s.proficiency])),
    proficiencies: { armor: x.armor_proficiencies || [], weapons: x.weapon_proficiencies || [], tools: x.tool_proficiencies || [], languages: x.languages || [] },
    hp: { max: x.hp_max || 1, current: x.hp_current || x.hp_max || 1, temp: x.hp_temp || 0 },
    attacks: x.attacks || [], features: x.class_features || [], traits: x.species_traits || [], feats: x.feats || [],
    spells: (x.spells || []).map((s) => {
      const known = srd.spells.find((k) => k.name.toLowerCase() === s.name.toLowerCase());
      return { name: s.name, level: s.level, prepared: true, concentration: !!known?.concentration, ritual: !!known?.ritual, casting_time: known?.casting_time || '', range: known?.range || '', components: known?.components || '', notes: s.notes || '' };
    }),
    equipment: (x.equipment || []).map((e) => ({ name: e.name, qty: e.qty || 1, notes: '', equipped: false })),
    attunement: [...(x.attunement || []), '', '', ''].slice(0, 3),
    coins: { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0, ...(x.coins || {}) },
    appearance: x.appearance || '', backstory: x.backstory || '',
    personality: { traits: x.personality_traits || '', ideals: x.ideals || '', bonds: x.bonds || '', flaws: x.flaws || '' },
    notes: [x.notes, x.unreadable && `Not readable during import: ${x.unreadable}`].filter(Boolean).join('\n\n'),
  });
  d.classes = (x.classes || []).map((c) => {
    const def = find(srd.classes, c.name);
    const sub = def && find(def.subclasses, c.subclass);
    return { index: def?.index || 'custom', name: def?.name || c.name, level: Math.max(1, Math.min(20, c.level || 1)), hit_die: def?.hit_die || 8, subclass: sub?.index || (c.subclass ? 'custom' : ''), subclass_name: sub?.name || c.subclass || '' };
  });
  for (const c of d.classes) {
    const k = `d${c.hit_die}`;
    d.hit_dice[k] = { total: (d.hit_dice[k]?.total || 0) + c.level, used: 0 };
  }
  d.spellcasting.ability = x.spellcasting_ability || srd.classes.find((c) => d.classes.some((k) => k.index === c.index) && c.spellcasting_ability)?.spellcasting_ability || null;
  const fromSheet = x.spell_slots_total || [];
  const suggested = suggestedSlots(d.classes, srd);
  d.spellcasting.slots = Array.from({ length: 9 }, (_, i) => ({ max: fromSheet.some((n) => n > 0) ? fromSheet[i] || 0 : suggested.slots[i], used: 0 }));
  if (suggested.pact) d.spellcasting.pact = { ...suggested.pact, used: 0 };
  return d;
}

export function importRouter(db) {
  const r = Router();
  // Photos and/or PDFs of a filled-in sheet → draft character (nothing is saved here).
  r.post('/import-image', h(async (req) => {
    const user = requireUser(req);
    const uploads = [...(Array.isArray(req.body.images) ? req.body.images : []), ...(Array.isArray(req.body.files) ? req.body.files : [])].slice(0, 6);
    if (!uploads.length) throw new HttpError(400, 'Add at least one photo or PDF');
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dnd-import-'));
    try {
      const images = [];
      const extra = [];
      let pdfNo = 0;
      for (const [i, up] of uploads.entries()) {
        const m = /^data:([\w/+.-]+);base64,(.+)$/s.exec(String(up));
        if (!m) throw new HttpError(400, 'Unreadable upload');
        const bytes = Buffer.from(m[2], 'base64');
        if (m[1] === 'application/pdf') {
          if (bytes.length > MAX_PDF) throw new HttpError(413, 'PDF too large (max 25 MB)');
          pdfNo += 1;
          const pdf = await readSheetPdf(bytes, tmp, `sheet${pdfNo}`);
          if (!pdf.fields.length && !pdf.text && !pdf.images.length) throw new HttpError(400, 'Could not read that PDF');
          images.push(...pdf.images);
          if (pdf.fields.length) extra.push(`PDF ${pdfNo} form fields (exact values typed into the fillable sheet; trust these first):\n${pdf.fields.join('\n').slice(0, 30000)}`);
          if (pdf.text) extra.push(`PDF ${pdfNo} text layer (may include printed labels):\n${pdf.text.slice(0, 30000)}`);
        } else {
          const im = /^image\/(png|jpe?g|webp|gif)$/.exec(m[1]);
          if (!im) throw new HttpError(400, 'Upload photos (PNG, JPEG, WebP, GIF) or PDF files');
          const f = path.join(tmp, `page${i + 1}.${im[1].replace('jpeg', 'jpg')}`);
          fs.writeFileSync(f, bytes);
          images.push(f);
        }
      }
      const prompt = extra.length ? `${PROMPT}\n- Some pages came from a PDF; its form fields and text are given below and the pages are attached as images. Combine them.\n\n${extra.join('\n\n')}` : PROMPT;
      const out = await runAgent(db, { user, prompt, images: images.slice(0, 8), schema: SHEET_SCHEMA, useTools: false });
      let parsed;
      try { parsed = JSON.parse(out.text); } catch { throw new HttpError(502, 'The assistant did not return valid sheet data — try a clearer photo or PDF'); }
      return { data: sheetToCharacter(parsed), raw: parsed };
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }));
  return r;
}
