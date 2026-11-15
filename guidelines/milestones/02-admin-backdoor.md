# Milestone 02 — Admin back door (LAN only)

## Objective
Account recovery without exposing admin powers over Tailscale/funnel.

## Dependencies
Milestone 01.

## Existing-state check
Inspect repo; evaluate criteria; implement only what is missing.

## Scope
Admin server/port, admin API + UI.

## Required work
- Separate listener (container 3001, host `ADMIN_PORT` default 8591, bind `ADMIN_BIND`).
- Requests on the admin port are trusted only if the client IP is in `ADMIN_ALLOWED_CIDRS` (default private LAN + loopback + docker ranges, never `100.64.0.0/10`) and carry no `Tailscale-*` headers. Optional `ADMIN_PASSWORD` adds a password prompt.
- The main port does **not** serve the admin API. App accounts (DMs included) have no site-wide powers; `is_admin` is retired and reset to 0 on startup.
- Functions: list users, reset password, rename, delete user, toggle open registration.

## Completion criteria
- [x] Admin port answers from LAN/loopback; rejects 100.x (Tailscale) and Tailscale headers
- [x] Password reset works and invalidates the user's sessions
- [x] Registration can be disabled

## Verification
Server tests for the IP filter and reset flow.
