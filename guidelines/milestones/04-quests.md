# Milestone 04 — Quests

## Objective
Track quests per party.

## Existing-state check
Inspect repo; evaluate criteria; implement only what is missing.

## Scope
Quest API + page.

## Required work
Fields: title, description, giver, reward, notes, status (`available`, `active`, `completed`, `failed`). Page groups by status (Active / Available / Past).

## Completion criteria
- [x] CRUD quests, change status
- [x] Page shows active, available and past quests separately

## Verification
Server test for CRUD + membership enforcement.
