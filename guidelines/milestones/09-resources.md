# Milestone 09 — Resource management

## Objective
Manual, PHB-based in-play tracking.

## Existing-state check
Inspect repo; evaluate criteria; implement only what is missing.

## Scope
Resource panel on sheet, server resource operations (shared with the AI tools).

## Required work
- HP damage/heal/temp (temp absorbs first), death saves, hit dice, spell slots per level (+ pact slots), class resources (rage, ki, etc. with short/long recharge), conditions (PHB Appendix A + exhaustion levels), timed effects/spells with duration + concentration, advance time (round / minute / 10 min / hour).
- Short rest (spend hit dice, recharge short-rest resources, pact slots) and long rest (full HP, half hit dice back, all slots, long-rest resources, exhaustion −1).
- The player presses buttons; nothing ticks automatically. Every operation is a history version with a readable message.

## Completion criteria
- [x] Damage/heal/temp HP rules correct
- [x] Short/long rest restore correctly
- [x] Each action visible in history

## Verification
Server unit tests for resource operations.
