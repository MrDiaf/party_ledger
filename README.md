# Party Ledger — D&D group organiser

A small self-hosted web app for one group of friends playing D&D 5e (2014 Player's Handbook).
It keeps the shared stuff (calendar, quests, treasury, session logs) and the personal stuff
(character sheets with full version history and in-play resource tracking) in one place, and
has an AI assistant that runs on the admin's ChatGPT subscription.

It is an **organisation tool, not a game**: rules are applied when you press a button
(damage, rest, level-up), but every value on a sheet stays editable and nothing locks you in.

## What it does

**Shared (per party)**
- **Calendar**: game sessions, events and "busy" blocks for every member. Highlight the accounts
  you care about (others are dimmed or hidden). Link a Google calendar (or any iCal feed), pick
  which events to share, and share each one *with details* or *redacted* (only the time slot is
  uploaded, never the title/description/location).
- **Quests**: available, active and past (completed/failed) quests.
- **Treasury**: pp/gp/ep/sp/cp plus your own currencies with notes and gold value, informal items
  with free-text stats, and a history of every change.
- **Session logs**: start a session and type what happens. Everyone sees new entries live.
  Optional voice dictation in browsers that support it (Chrome/Edge). Add pictures (📷 button,
  paste or drag & drop); each gets a number in the session, and writing `[img3]` in any entry links
  to picture 3.

**Personal**
- **Three ways to start a character**: the guided builder, a **blank sheet** you fill in yourself
  field by field (no wizard, nothing enforced), or the **paper sheet** (download the blank official
  2024 sheet to print, or import a photo of a filled one).
- **Character builder**: a step-by-step wizard (race → class → background → equipment → abilities → skills →
  spells → level-ups → details) using the bundled SRD/PHB data. Starting equipment is a real choice:
  pick option (a) or (b), choose the actual weapon for "any martial weapon", or roll starting gold
  instead; tap any item for its stats. Packs are unpacked into separate items, armor/weapons start
  equipped, weapons get attack lines and AC is worked out from what you wear. Roll abilities with 4d6-drop-lowest
  (or standard array, point buy, manual). Choose a starting level and you then walk level 2…N one
  level at a time (HP roll/average, subclass, ASI or feat, feature options, new spells, multiclass).
  Nothing is saved until you press **Create**; the draft lives in your browser until then.
- **Character sheet**: modelled on the 2024 sheet layout: abilities, saves, skills (tap one to read
  what it covers), combat, attacks, features/traits/feats, spells, equipment, attunement, coins,
  appearance, backstory, personality and personal notes, plus a portrait.
- **Download PDF**: the character written onto the official 2024 character sheet (both pages),
  followed by pages with every feature, spell, item and story text in full.
- **Spellbook**: spells as tiles by school and level (Baldur's Gate style), slot pips, tap a spell for
  its full text, damage/save DC worked out for your character, and cast it (pick the slot level to
  upcast; concentration/duration become timed effects). A spell library to learn new spells. Besides
  the 319 SRD spells, the 41 PHB-only spells (Hex, Armor of Agathys, Chromatic Orb, the smites…) are
  read from your own PHB PDF when the server starts — nothing from the PHB is stored in this repo.
- **Inventory**: every item is a real entry linked to the SRD catalog (weight, cost, damage, AC,
  properties with explanations), with equipped toggles, carrying weight and a searchable catalog.
- **History like git**: every edit (autosave), level-up, resource action, AI change and manual
  snapshot is a version. View what changed and restore any version. Restoring adds a new
  version, so nothing is ever lost.
- **Resource management** (the *Play* tab): damage/heal/temp HP, death saves, hit dice, spell
  slots and pact slots, class resources (Rage, Ki, Channel Divinity…), conditions, exhaustion,
  timed spells/effects with concentration, "time passes" buttons, and short/long rests per the PHB.
- **Import a sheet**: take a photo, upload scans, or upload a PDF (e.g. a D&D Beyond export or a
  filled-in fillable sheet: its form fields are read exactly, other PDFs are read from their text and
  page images). The assistant fills in a draft you review before creating.

**For the DM** (only the party's DM sees these)
- **Monsters**: search the Monster Manual by name, type or CR, open a stat block, and add one or
  several (numbered "Goblin Warrior 1, 2, 3…") to **the field**, which holds the monsters active in
  the current fight. Each slot tracks HP (damage/heal, temp HP), AC, initiative (🎲 rolls it for
  everyone), conditions and notes, and keeps its stat block one tap away. Custom monsters work
  without the book.
- **DM notes**: private notes in tabs (plot threads, NPC secrets…). Tick **📣 Visible to players**
  to turn a note into an **announcement**. Players see it on the Overview and under
  *Announcements*; pinned ones stay on top.

**AI assistant** (optional)
- Uses the **Codex CLI** signed in with the admin's ChatGPT subscription (or an OpenAI API key).
- Talks to the app through a built-in **MCP server**. In *Admin → AI assistant* the admin chooses
  which tools it may use (or makes it read-only). Each request runs with the permissions of the
  person chatting.
- Send it pictures (📎 / paste): it can see them and offer to put one in a session log. That only
  creates a confirm card in the chat panel — nothing is added until you press "Add to session".
- Examples: "Tordek took 12 slashing damage", "we take a long rest", "add 150 gp from the goblins",
  "mark the cat quest as done", "how does grappling work?" (it can search your PHB PDF).

## Requirements

- Docker with Docker Compose v2 (`docker compose`)
- `make`
- Your PHB PDF at `./PHB-5e.pdf` (or set `PHB_PDF` in `.env`). It is mounted read-only and is
  used for the assistant's rules search and for the PHB spells that are not in the SRD.
- The official sheet at `./DnD_2024_Character-Sheet.pdf` (or set `SHEET_PDF` in `.env`), mounted
  read-only, for the PDF download and the blank-sheet download.
- Optional: your Monster Manual (2024) PDF at `./D&D 5e - Monster Manual 2024.pdf` (or set
  `MM_PDF`). The server reads the stat blocks once (a few seconds) and caches them in the data
  volume. Nothing from the book is stored in the repo. Without it, the DM can still add custom monsters.

All PDFs are git-ignored: keep them next to the app, never commit them.

### Monster Manual OCR (recommended)

The scan's own text layer is poor OCR, which produces garbled names and missing scores. Two one-time
commands give a much cleaner catalog:

1. `make mm-ocr` re-reads every page column by column with Tesseract in Docker (about 7 minutes) and
   writes `Monster Manual 2024 - OCR.json`.
2. `make mm-fix` (app running, ChatGPT linked under Admin → AI) sends only the pages whose stat
   blocks still came out incomplete to ChatGPT through Codex, about 110 page images (~17k tokens each),
   one at a time. It writes `Monster Manual 2024 - ChatGPT fixes.json`. ChatGPT's per-hour limits may
   pause it; the script waits and retries, and you can stop it and run it again to resume.

Then `make up` again. Both files are the book's text, so they are git-ignored too.

## Usage

Start:

```bash
make up
```

Then open:

- **App**: http://localhost:8590 (from other devices on your LAN: `http://<this-machine's-LAN-IP>:8590`)
- **Admin back door**: http://localhost:8591/admin (home network only, see below)

App accounts never get admin powers, not even the first one or a DM. Server administration
(accounts, registration, AI) happens only on the admin back door below. Let your friends
register, create a party (*Party* page) and share its invite code.

Stop (keeps all data):

```bash
make down
```

All commands:

```bash
make help
```

### Sharing with friends over Tailscale

Share the **main app port only** on the internet with Tailscale Funnel:

```bash
make funnel-up       # https://<this-machine>.<tailnet>.ts.net:10000
make funnel-down     # stop sharing (other funnels on this machine are left alone)
make funnel-status   # see what is exposed
```

Funnel only allows public ports 443, 8443 and 10000. The default is 10000; change it with
`FUNNEL_PORT` in `.env`. If the command complains about permissions, run
`sudo tailscale set --operator=$USER` once. Once your friends have accounts, consider turning
registration off (Admin → Settings).

Never serve or funnel port 8591. The admin back door refuses Tailscale traffic anyway.

### The admin back door

Port 8591 serves only the admin panel (accounts, password resets, registration on/off, AI link and
tool permissions). It answers **only** requests from addresses in `ADMIN_ALLOWED_CIDRS` (default:
private LAN ranges and localhost) and **always refuses** Tailscale addresses (`100.64.0.0/10`,
`fd7a:115c:a1e0::/48`) and requests carrying Tailscale headers. So someone at home can reset a
friend's password, but nobody can do it through Tailscale.

For extra safety you can set `ADMIN_BIND` to your LAN IP so the port isn't even bound on other
interfaces, and/or set `ADMIN_PASSWORD`. The main app has no admin API at all.

Passwords have no length or complexity rules (by design: this is for a few friends).

### Linking the AI assistant

1. Open *Admin → AI assistant* and click **Link ChatGPT account**. Open the shown URL, sign in
   with your ChatGPT account and enter the code. (Terminal alternative: `make ai-login`.)
2. Tick **Assistant enabled for all users**, and untick any tools you don't want it to have.
3. Users open the assistant with the **✨ Assistant** button in the sidebar.

The login is stored in the data volume (`/data/codex`), so it survives restarts.

### Linking a Google calendar

On the *Calendar* page click **Google Calendar** and paste your calendar's *Secret address in iCal
format* (Google Calendar → Settings → your calendar → Integrate calendar). Only you can see the
imported list. For each event choose *Don't share*, *Busy only* or *Share with details*.
**Resync shared** moves or removes shared events whose source changed.

## Configuration

Everything has defaults; copy `.env.example` to `.env` to change them.

| Variable | Default | Meaning |
|---|---|---|
| `APP_PORT` / `APP_BIND` | `8590` / `0.0.0.0` | Main app port and bind address |
| `ADMIN_PORT` / `ADMIN_BIND` | `8591` / `0.0.0.0` | Admin back-door port and bind address |
| `ADMIN_ALLOWED_CIDRS` | private ranges + loopback | Networks allowed on the admin port (Tailscale is always refused) |
| `ADMIN_PASSWORD` | empty | Optional extra password for the admin back door |
| `PHB_PDF` | `./PHB-5e.pdf` | PHB PDF used for the rules search |
| `MM_PDF` | `./D&D 5e - Monster Manual 2024.pdf` | Monster Manual PDF for the DM's monster catalog (optional) |
| `MM_OCR_JSON` / `MM_FIXES_JSON` | `./Monster Manual 2024 - OCR.json` / `… - ChatGPT fixes.json` | Output of `make mm-ocr` / `make mm-fix` (optional) |
| `AI_TIMEOUT_MS` | `240000` | Max time per assistant request |

## Data

Everything lives in the Docker volume `dnd-table_dnd-data` (SQLite database + Codex login).
`make down` keeps it. `make clean-data` deletes it (asks for confirmation).

## Development

- Code: `app/server` (Express + `node:sqlite`), `app/shared/rules.js` (5e rules shared by
  server, UI and AI tools), `app/web` (React + Vite).
- Tests: `make test` (or `cd app && npm test` with Node 22).
- Rules data: `app/server/data/srd.json` is generated by `npm run srd` from the
  [5e SRD dataset](https://github.com/5e-bits/5e-database) (OGL 1.0a) plus PHB name supplements.
  PHB-only subclasses, feats and backgrounds are included by name; their details come from your
  PHB via the rules search.
- Plan and status: `PLAN.md` and `guidelines/milestones/`.

## Known limitations

- Calendar import uses the iCal secret link rather than Google sign-in (OAuth). OAuth needs a
  Google Cloud project and an HTTPS redirect; see milestone 12.
- Live updates (session log, sheet changes from the DM/AI) use polling every few seconds, which
  is fine for a handful of players.
- PHB content outside the SRD (most subclass features, most feats) appears by name only; type
  the details in, or ask the assistant to look them up in your PHB.
- The Monster Manual is a scan. With `make mm-ocr` + `make mm-fix`, nearly all ~490 stat blocks are
  read cleanly. Without them, names and scores come from the scan's poor OCR. Either way, rename or
  adjust a monster on the field, and check the book when it matters: the page is shown.
