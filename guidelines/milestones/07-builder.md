# Milestone 07 — Rules data + character builder

## Objective
Baldur's-Gate-3-style guided creation backed by PHB 5e (2014) rules.

## Existing-state check
Inspect repo; evaluate criteria; implement only what is missing.

## Scope
`app/scripts/build-srd.mjs`, `app/server/data/srd.json`, builder UI.

## Required work
- Bundle condensed SRD 5.1 data (5e-bits/5e-database, OGL) + PHB-only names (backgrounds, subraces, subclass names) as supplements.
- Steps: Race → Class → Background → Abilities (4d6 drop lowest / standard array / point buy / manual) → Skills → Spells → Details & backstory → Level.
- Pick a starting level; the wizard then walks level 2..N with HP (roll/average), new features, subclass choice, ASI/feat, new spells, optional multiclass.
- Never locks the player: rule violations are warnings, every value is overridable.
- Draft lives in the browser (localStorage) until **Create character**.

## Completion criteria
- [x] 4d6-drop-lowest roller
- [x] Base level selection runs per-level level-up steps
- [x] Character row only exists after Create

## Verification
Unit test for dice + derived stats; manual run of the wizard.
