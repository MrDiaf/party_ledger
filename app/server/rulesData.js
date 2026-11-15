// The rules bundle served to the app: SRD data plus the PHB-only spells read from the owner's PHB PDF.
import srd from './data/srd.json' with { type: 'json' };
import { DATA_DIR } from './db.js';
import { loadPhbSpells } from './phbSpells.js';

let rules = null;
let json = null;

export function getRules() {
  if (!rules) {
    const phb = loadPhbSpells(srd, DATA_DIR);
    const spells = [...srd.spells, ...phb].sort((a, b) => a.level - b.level || a.name.localeCompare(b.name));
    rules = { ...srd, spells, phb_spells: phb.length };
  }
  return rules;
}

export function rulesJson() {
  return (json ||= JSON.stringify(getRules()));
}
