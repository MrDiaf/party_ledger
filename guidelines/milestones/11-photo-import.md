# Milestone 11 — Character sheet photo import

## Objective
Turn a photo/scan of a paper sheet into a character.

## Dependencies
Milestones 08 and 10.

## Existing-state check
Inspect repo; evaluate criteria; implement only what is missing.

## Scope
Import endpoint + UI.

## Required work
- Upload or camera capture (mobile `capture` attribute), up to several images.
- `codex exec -i <images> --output-schema` extracts sheet JSON.
- User reviews/edits in the sheet editor before pressing Create; version kind `import`.

## Completion criteria
- [ ] Image → JSON draft → review → create (verified with a blank sheet; not yet tried with a filled sheet)

## Verification
Manual test with a photographed sheet.
