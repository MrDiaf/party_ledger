# Milestone 05 — Treasury

## Objective
Informal party treasury.

## Existing-state check
Inspect repo; evaluate criteria; implement only what is missing.

## Scope
Treasury API + page.

## Required work
- Currencies per party: seeded pp/gp/ep/sp/cp, plus custom currencies with name, abbreviation, notes, optional gp value.
- Balance adjust (+/-) with optional note; every change written to a treasury log.
- Items: name, quantity, holder, value, free-text stats/notes. No strict validation.

## Completion criteria
- [x] Custom currency can be created with notes
- [x] Balance adjustments logged
- [x] Items CRUD

## Verification
Server test for currency adjust + log.
