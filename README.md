# Port Mercy

A browser-based, multiplayer, persistent-world graphical MUD prototype set in a gritty modern coastal city.

## Stack
- React + TypeScript for the information-heavy game interface.
- PixiJS 8 for layered room scenes, atmosphere, NPCs, vehicles, props, and future transparent image overlays.
- Colyseus for the authoritative multiplayer room/server layer.
- Shared TypeScript protocol package between browser and server.
- PostgreSQL is the planned canonical persistence layer for accounts, characters, inventory instances, property, vehicles, jobs, economy, crime records, and world state.
- Redis/Valkey remains deferred until horizontal scaling, presence routing, or distributed workers actually require it.
- Codex App Server is the preferred AI heartbeat integration, with a deterministic offline heartbeat fallback.

## Resource/event architecture
Port Mercy uses a resource-driven game runtime so major systems can evolve independently without turning the main world server into a monolith. The resource layer is intentionally room-based and browser-native; it does not assume 3D entities, coordinate loops, or client-authoritative state.

- `resources/` contains independently loadable game resources with `pmresource.json` manifests.
- Manifests declare name, version, dependencies, server entrypoint, and explicit AI-heartbeat event policy.
- Resources are dependency-sorted before startup.
- Resources register authoritative actions such as `inventory:open`, `vehicle:openStorage`, `job:clockIn`, and `job:completeTask`. Manifests separately declare which of those actions are safe for browser clients to request.
- The Colyseus room exposes one generic resource-action gateway instead of needing a new network message handler for each future script. Internal actions remain inaccessible unless explicitly listed under `clientActions`.
- Resources can register pre-action hooks that veto an operation before state changes.
- Resources can observe post-action success/failure and emit semantic events only after an operation actually happens.
- Resources expose services/exports to one another. For example, `pm-job-mercy-fuel` registers a job through an export owned by `pm-jobs`; it does not edit the shared jobs code.
- Resources may contribute compact heartbeat snapshot state.
- A bounded event journal captures semantic world events with correlation IDs, actor/room context, source resource, and an explicit Luna visibility level.
- AI visibility is deny-by-default. Events not declared in a manifest are never sent to Luna.

Current resources are `pm-world`, `pm-chat`, `pm-inventory`, `pm-identity`, `pm-items`, `pm-interactions`, `pm-phone`, `pm-banking`, `pm-vehicles`, `pm-travel`, `pm-chases`, `pm-evidence`, `pm-jobs`, `pm-job-mercy-fuel`, and `pm-job-ritas-diner`.

The heartbeat still prefers Codex App Server with `gpt-5.6-luna` at low effort and still falls back to the deterministic offline provider. Its world snapshot now also receives the resource snapshot registry and only the recent events explicitly marked `summary` or `full` by resources. This keeps UI noise (opening inventory, opening a trunk, chat transport, etc.) out of Luna while allowing meaningful facts (completed work, witnessed crimes, future business/police/vehicle state changes) to reach it.

See `resources/README.md` for the manifest and scripting model.
See `docs/SYSTEM-DESIGN-NOTES.md` for the deeper Port Mercy systems roadmap and design boundaries.

## Crime and police rule
Port Mercy does **not** use an arcade police-heat number. A crime creates concrete world state: an incident, possible witnesses, evidence/report status, location, and time. Police logic responds to those facts. The hourly heartbeat can reason about unresolved incidents and propose world responses, but urgent real-time responses should eventually be handled by deterministic timers/event systems instead of waiting for the next hourly AI tick.

## Driver license inventory document
A Port Mercy driver license is now a normal inventory item with structured metadata:
- legal name
- date of birth
- home address
- license number and class
- expiration date
- sex marker
- height and eye color
- portrait URL/status

The current preview intentionally uses a `PHOTO pending character art` placeholder. Character creation should eventually populate these fields and a generated/uploaded character portrait can be assigned to `portraitUrl` without changing the inventory model.

## Codex App Server configuration
The server reads these environment variables:

- `PORT_MERCY_HEARTBEAT_PROVIDER=auto` — `auto` tries Codex then falls back offline. `offline` skips Codex entirely.
- `PORT_MERCY_HEARTBEAT_MS=3600000` — one-hour default.
- `PORT_MERCY_CODEX_COMMAND=codex app-server`
- `PORT_MERCY_CODEX_MODEL=gpt-5.6-luna`
- `PORT_MERCY_CODEX_EFFORT=low`
- `PORT_MERCY_CODEX_CWD` — optional; defaults to a dedicated empty temp directory so the heartbeat does not need access to the game repository.
- `PORT_MERCY_HEARTBEAT_BOOT_TICK=0` — set to `1` during development to run a heartbeat immediately on world startup.

An example is included at `apps/server/.env.example`.

This integration is deliberately App Server based rather than OpenAI API-key based. The Port Mercy server launches the locally installed/authenticated Codex process. This repository does not contain credentials.

## Current fixed-screen game shell
The playable slice also includes:
- Four connected South Ward locations with distinct rendered scenes.
- Inventory in a dedicated modal so more items never stretch the main game screen. The same modal can now open secondary inventories such as a vehicle trunk.
- Phone, driver license, keys, tools, and consumables as ordinary inventory items. Using the phone now opens a registered-app shell; the phone itself remains just an inventory item.
- A text-first phone model with contacts/messages, typed live-call state, banking/jobs app registration, read-only vehicle records, and private phone traffic excluded from Luna by default. Physical actions such as starting a drive still require interacting with the vehicle/world.
- Timed vehicle travel sessions with an in-preview progress bar. Turn-based chases now pause an active travel session; escaping resumes the remaining trip, while being caught aborts it.
- A shared room/entity contextual interaction registry, without raycasts, coordinates, peds, or other 3D assumptions.
- Room-based evidence records as the start of a concrete crime/police system rather than an arcade heat meter.
- Room/global chat UI plus server chat routing and recent history.
- Fixed-height Room Activity history with internal scrolling.
- Viewport-locked desktop layout; growing content scrolls within its own panel.
- Character cash, health, stress, job, movement, room entities, and contextual actions. The fuel-station and diner work buttons now route through the shared job resource and separate registered job resources.
- Local browser fallback mode so the UI can still be previewed without the multiplayer server.

## Run locally
1. Install a current Node.js release.
2. Run `npm install` from the repository root.
3. Start the multiplayer server with `npm run dev:server`.
4. In another terminal start the web app with `npm run dev:web`.
5. Open the Vite URL.

By default the browser stays in local preview mode unless `VITE_GAME_SERVER` is set. To connect it to the local Colyseus server, set `VITE_GAME_SERVER=ws://localhost:2567` before starting Vite.

If Codex is installed and authenticated, the server will try the App Server automatically. If it is not available, Port Mercy continues with the offline heartbeat provider.

## Architecture rule
The browser requests actions but never awards itself money, items, skills, property, vehicles, or successful crimes. The authoritative server owns mechanics and persistence. The AI heartbeat observes a bounded snapshot and proposes world evolution; it is not a privileged database writer.
