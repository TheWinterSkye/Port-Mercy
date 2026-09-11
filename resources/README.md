# Port Mercy Resource System

Port Mercy resources use a modular server architecture adapted specifically for a browser-based room world. They do **not** assume peds, 3D coordinates, entity network IDs, native game calls, or any external game runtime.

Each folder under `resources/` is independently loadable and contains a `pmresource.json` manifest plus a server module. The loader discovers resources, validates dependencies, topologically orders them, and calls the module's exported `setup(ctx)` function.

## Manifest

```json
{
  "name": "pm-example",
  "version": "0.1.0",
  "description": "Example Port Mercy resource.",
  "server": "server.mjs",
  "dependencies": ["pm-world"],
  "clientActions": ["example:inspect"],
  "heartbeat": {
    "events": {
      "example:mundaneUiEvent": "never",
      "example:stateChange": "summary",
      "example:importantWorldEvent": "full"
    }
  }
}
```

`clientActions` is also deny-by-default. Only actions explicitly listed there can enter through the browser action gateway; internal actions can still be composed by trusted resources.

Heartbeat event policy is deny-by-default. If an event is not listed, it is `never` and will not be included in the Luna heartbeat event stream.

- `never`: scripting/UI event only; do not send it to Luna.
- `summary`: send its compact payload as recent context.
- `full`: send its payload as an important world event.

## Runtime API

A resource can:

- `ctx.actions.register(name, handler)` — own an authoritative action. Public browser access is separate and must be declared in the manifest.
- `ctx.actions.before(name, hook)` — validate/veto an action before it happens.
- `ctx.actions.after(name, hook)` — observe success or failure after completion.
- `ctx.actions.execute(name, request)` — compose one resource action from another.
- `ctx.events.on(name, handler)` — listen for semantic game events.
- `ctx.events.emit(name, payload, meta)` — emit a semantic post-action event.
- `ctx.exports.register(name, fn)` — expose a service/function to other resources.
- `ctx.exports.get(resource, name)` — consume another resource's export.
- `ctx.heartbeat.snapshot(name, provider)` — contribute compact structured state to the heartbeat snapshot.
- `ctx.host` — narrow authoritative server bridge supplied by the Port Mercy world host.

## Action vs event

Actions are requests. Events are facts.

Example vehicle trunk flow:

1. Browser requests `vehicle:openStorage`.
2. `pm-vehicles` validates that the vehicle exists and is in the player's room.
3. It composes `inventory:open` for `vehicle_trunk`.
4. `pm-vehicles` has a pre-hook on `inventory:open` that can reject a locked vehicle.
5. `pm-inventory` resolves the secondary container and tells the client to open it.
6. Only after success are `inventory:opened` and `vehicle:storageOpened` emitted.
7. Both are currently `never` for Luna because opening a UI/container is not meaningful hourly world context.

The same pattern is intended for doors, housing storage, businesses, crafting, banking, police evidence, mailboxes, lockers, etc.

## Jobs

`pm-jobs` owns the shared registry and duty/task actions. Individual jobs belong in separate resources.

`pm-job-mercy-fuel` is the first example. It depends on `pm-jobs` and registers its definition at startup. Adding a future dockworker, diner, sanitation, refinery, hospital, police, taxi, mechanic, or courier job should not require editing `pm-jobs` itself.

Job lifecycle:

- `job:clockIn`
- `job:clockOut`
- `job:taskStarted`
- `job:taskCompleted`

Task completion is authoritative and can award deterministic pay/stress/skill changes. The semantic completion event can be sent to Luna when it matters for the living world.

## Current resources

- `pm-world` — room movement and world interactions.
- `pm-chat` — room/city chat; chat is not included in AI heartbeat by default.
- `pm-inventory` — player and secondary inventories, open/use/drop/move actions, pre/post integration surface.
- `pm-identity` — driver license document use handler.
- `pm-items` — ordinary consumable/item handlers.
- `pm-interactions` — room/entity interaction registry; the room-world replacement for 3D targeting.
- `pm-phone` — inventory-backed phone platform, app registry, SMS, and typed live-call sessions.
- `pm-banking` — player account actions and phone banking app registration.
- `pm-vehicles` — room-based vehicles, locks, trunk/glovebox integration.
- `pm-travel` — authoritative timed travel sessions and client progress updates.
- `pm-chases` — turn-based chase state machine that can interrupt vehicle travel.
- `pm-evidence` — concrete room-based evidence records and crime-event hooks.
- `pm-jobs` — shared job registry, duty state, tasks.
- `pm-job-mercy-fuel` — Mercy Fuel stock/delivery job resource.
- `pm-job-ritas-diner` — Rita's Diner cleanup/dishwashing job resource.

## Design rule

Do not add a giant switch statement to the world server for every new feature. Prefer a resource with a manifest, registered actions, explicit dependencies, exported services, and semantic events.

The phone is a UI gateway, not an owner of banking/vehicle/job/property data. Travel progress is a UI view of an authoritative server session, not a client timer that awards arrival. Contextual interaction options are registered by resources instead of hard-coded into one room renderer.
