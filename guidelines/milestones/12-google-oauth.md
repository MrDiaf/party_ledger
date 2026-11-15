# Milestone 12 — Google OAuth calendar (optional)

## Objective
Direct Google account sign-in for calendar import, only if the iCal secret-link flow is not good enough.

## Existing-state check
Inspect repo; evaluate criteria; implement only what is missing.

## Scope
Calendar import only.

## Required work
Requires a Google Cloud OAuth client and an HTTPS redirect (e.g. Tailscale `*.ts.net` serve). Read-only scope `calendar.readonly`. Reuse the existing pick + redact dialog.

## Completion criteria
- [ ] Not started — needs owner decision

## Verification
Manual.
