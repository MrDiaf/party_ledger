# Milestone 10 — AI assistant + MCP

## Objective
Assistant using the admin's ChatGPT subscription via Codex CLI, acting on the app through MCP.

## Existing-state check
Inspect repo; evaluate criteria; implement only what is missing.

## Scope
Codex in the container, `/mcp` endpoint, admin AI settings, chat UI.

## Required work
- `@openai/codex` installed in the image; `CODEX_HOME=/data/codex` (persisted).
- Admin UI starts `codex login --device-auth`, shows URL + code, shows status, can log out.
- MCP (streamable HTTP, `/mcp`) with per-request bearer tokens bound to the acting user; tools respect that user's permissions.
- Admin settings tab: enable assistant, model, and per-tool on/off.
- Chat: `codex exec --json` with the app MCP server attached; conversation stored per user.

## Completion criteria
- [ ] Device login flow from the admin UI (URL/code parsing verified; full sign-in needs the owner)
- [x] MCP tools list honours settings
- [x] Chat can read/update app data through MCP

## Verification
Server test for MCP tool listing/permissions; manual chat test once logged in.
