# Milestone 08 — Character sheet + version history

## Objective
Editable sheet with git-like history.

## Existing-state check
Inspect repo; evaluate criteria; implement only what is missing.

## Scope
Characters API, sheet page, history view.

## Required work
- Sheet sections follow the 2024 sheet (abilities/saves/skills, HP/hit dice/death saves, attacks, class features, species traits, feats, proficiencies, spells w/ slots, appearance, backstory & personality, languages, equipment, attunement, coins) + free personal notes and portrait.
- Every save creates a version (`autosave`, `levelup`, `manual`, `revert`, `resource`, `ai`, `import`); rapid autosaves by the same author within 2 minutes coalesce.
- History list with change summary, view old version, revert (revert = new version, history never lost), manual "commit" with a message.

## Completion criteria
- [x] Autosave creates/coalesces versions
- [x] Level-up writes a `levelup` version
- [x] Revert restores an old version as a new version

## Verification
Server test for versioning + revert.
