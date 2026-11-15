# Milestone 06 — Session logs

## Objective
Record what happened each session.

## Existing-state check
Inspect repo; evaluate criteria; implement only what is missing.

## Scope
Logs API + page.

## Required work
- Session: number, title, date, summary.
- Live transcript: timestamped entries with author; page polls for new entries so everyone sees them.
- Optional browser dictation (Web Speech API) where supported.

## Completion criteria
- [x] Create session, append/edit/delete entries
- [ ] Entries from other users appear without reload (4 s polling implemented; not yet checked with two browsers)

## Verification
Server test for entries; manual UI check.
