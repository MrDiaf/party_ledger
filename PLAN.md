# Progress — D&D Table (party organisation app)

Self-hosted organiser for one group of friends: shared calendar, quests, treasury,
session logs, PHB-5e character builder/sheets with version history, resource
tracking, and an AI assistant (Codex / ChatGPT subscription) that talks to the app
through MCP. Runs with Docker Compose behind `make up`.

Milestone files live in `guidelines/milestones/`.

## Milestone 01 — Foundation (compose, accounts, parties)
- [x] `make up` / `make down` / `make help` work and README exists
- [x] Register + login with no password complexity rules
- [x] Parties (campaigns) can be created and joined with an invite code

## Milestone 02 — Admin back door (LAN only)
- [x] Admin UI/API served on a separate port that rejects Tailscale/public addresses
- [x] Admin can reset passwords, toggle admin, delete users, toggle registration

## Milestone 03 — Shared calendar
- [ ] Party calendar with manual events and per-account highlight filter (events verified; highlight filter implemented, not yet checked with several accounts)
- [x] Google/iCal feed linking: pick events, share full or redacted (time slot only)
- [x] Redacted shares never store or send title/description/location

## Milestone 04 — Quests
- [x] Quests with available / active / completed / failed status, filterable

## Milestone 05 — Treasury
- [x] Standard + custom currencies with balances and notes
- [x] Informal items with stats/notes, and a treasury history log

## Milestone 06 — Session logs
- [ ] Create sessions and append timestamped live entries (optional dictation) (entries verified; live view across two browsers and dictation not yet checked)

## Milestone 07 — Rules data + character builder
- [x] SRD/PHB data bundled (races, classes, subclasses, backgrounds, spells, levels)
- [x] BG3-style creation wizard incl. 4d6-drop-lowest, base level and per-level level-up
- [x] Nothing is saved until the player presses Create

## Milestone 08 — Character sheet + version history
- [x] Editable sheet (2024 sheet layout fields), autosave creates versions
- [x] Level-up creates a version; any version can be viewed and reverted

## Milestone 09 — Resource management
- [x] HP/temp HP, hit dice, spell slots, class resources, conditions, timed effects
- [x] Short/long rest per PHB; every change recorded in history

## Milestone 10 — AI assistant + MCP
- [ ] Admin links ChatGPT subscription (Codex device login) from the admin UI (URL/code parsing verified; full sign-in needs the owner)
- [x] MCP server exposing app tools; admin settings tab enables/disables each tool
- [x] Chat panel where users ask the assistant to act (scoped to their permissions)

## Milestone 11 — Character sheet photo import
- [ ] Upload/take photo of a paper sheet → vision extraction → review → create (schema + pipeline verified with a blank sheet; not yet tried with a filled sheet)

## Milestone 13 — Sheets, equipment, spellbook, mobile
- [x] Blank-sheet path (no builder) and blank official sheet download
- [x] PDF download filled onto the official 2024 sheet + full-text detail pages
- [x] Starting equipment as real (a)/(b) choices with item details; item catalog; packs unpacked
- [x] Skill descriptions in the builder and on the sheet
- [x] BG3-style spellbook with casting/upcasting; PHB-only spells read from the owner's PHB PDF
- [ ] Mobile navigation (bottom tab bar, sticky sheet tabs, full-screen dialogs) — built and server-rendered, not yet checked on a real phone

## Milestone 12 — Google OAuth calendar (optional, not started)
- [ ] Only if iCal-link import proves insufficient
