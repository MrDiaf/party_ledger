# Milestone 03 — Shared calendar

## Objective
Party calendar every member can add to, with optional import from a Google calendar.

## Existing-state check
Inspect repo; evaluate criteria; implement only what is missing.

## Scope
Calendar API + calendar page.

## Required work
- Events belong to a party and an author: kinds `session`, `busy`, `event`.
- Highlight filter: choose which accounts are emphasised (others dimmed/hidden).
- Linking: user stores a private iCal URL (Google Calendar → Settings → "Secret address in iCal format"). The import dialog fetches upcoming events live; the user picks which to share and whether each is **redacted**.
- Redacted shares store only start/end (title "Busy"); sensitive fields never leave the user's import dialog.
- "Resync" updates times of previously shared events (matched by UID).

## Completion criteria
- [x] Manual event create/edit/delete
- [ ] Highlight filter per account (implemented; not yet checked with several accounts)
- [x] iCal import with choose + redact; redacted rows contain no title/description/location
- [x] Resync updates shared events

## Verification
Server test for redaction; manual UI check.
