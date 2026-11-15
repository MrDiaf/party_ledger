# Milestone 01 — Foundation

## Objective
Runnable skeleton: Docker Compose app (Node + SQLite + React), Makefile, README, accounts and parties.

## Existing-state check
Before implementation: inspect the repo, evaluate every criterion, preserve what is satisfied, implement only what is missing. Do not read other milestone files unless necessary.

## Scope
`compose.yaml`, `Makefile`, `README.md`, `.env.example`, `.gitignore`, `app/` server + web shell.

## Required work
- One `app` service; data in a named volume (`/data`, SQLite via `node:sqlite`).
- Main port (default host 8590) is what Tailscale serve/funnel should point at.
- Accounts: username + password, **no** length/complexity rules (only non-empty). scrypt hashing, HttpOnly session cookie.
- No app account is ever an admin; admin is the LAN admin port only (see milestone 02).
- Parties ("campaigns"): create, join by invite code, member roles `dm` / `player`.

## Completion criteria
- [x] `make up` builds and starts the app; `make down` stops it without deleting data; `make help` lists commands
- [x] `POST /api/auth/register` accepts a 1-character password
- [x] Login/logout/me work with cookie session
- [x] Party can be created and joined via invite code

## Verification
`make test` (server tests), `curl http://localhost:8590/api/health`.
