# Port Mercy systems design notes

Port Mercy is built around a resource-driven roleplay architecture: durable game domains remain independent modules with explicit actions, events, exports, dependencies, and UI entry points. The goal is to keep the core server small while allowing new jobs, services, properties, vehicles, civic systems, and other world features to plug into shared contracts.

## What we are actively borrowing

### Phone as an app platform
`pm-phone` owns the device shell, contacts, messages, typed live calls, and an app registry. Other resources register apps instead of editing the phone core. Calls use `ringing -> connected -> ended/declined`; conversation inside a connected call is text. Routine private phone content is `never` for the Luna heartbeat.

The phone is **not** a remote-control surface for physical actions. A vehicle app may show parking location, registration, financing, service alerts, or impound state, but starting a drive requires interacting with the vehicle in the world. The same rule applies to doors, containers, machines, and other physical objects.

### Targeting becomes contextual interactions
`pm-interactions` is the shared contextual-action layer. Resources register verbs against a target such as `room:southward.diner`, `entity:vehicle:sedan.blue`, `property:marrow.3b`, or a future NPC id. Options can be filtered by room, job, duty, ownership, license, item, lock state, or arbitrary server checks. There is no raycasting or distance math.

### Vehicle state is durable, travel is a session
`pm-vehicles` owns persistent vehicle identity, room, owner/key access, locks, condition, and named compartments. A future `pm-garages` should own stored/out/impounded state rather than despawning cars as a UI trick.

`pm-travel` starts authoritative timed travel sessions. The browser displays progress, but the server owns departure, destination, ETA, interruptions, and arrival. This is where fuel use, traffic, breakdowns, road closures, passengers, and route events can attach.

### Chases are a state machine, not a fake 3D pursuit
`pm-chases` can interrupt travel. It is turn based: each side chooses a maneuver, server rules resolve the turn, and the gap changes until escape/capture/crash/abandonment. Driving skill, vehicle condition, road/weather, police vehicle quality, passengers, and injuries can modify resolution. Luna may provide NPC intent or color, but not decide authoritative dice/results.

### Banking/business state is not phone state
`pm-banking` owns balances and transfers. The phone registers a banking app, while future ATMs, teller windows, payroll, invoices, rent, vehicle financing, and business accounts call the same banking service.

### Crime produces incidents and evidence, not heat
`pm-evidence` stores room-based evidence records and can react to semantic crime events. Future police resources can collect evidence, flag plates, create case records, impound vehicles, jail characters, and respond to dispatch calls without an arcade wanted meter.

### Jobs register themselves
`pm-jobs` owns registry/duty/task contracts. Individual careers remain separate resources such as `pm-job-mercy-fuel`. A hospital, refinery, police department, sanitation service, mechanic shop, taxi company, delivery company, or restaurant can add its own grades/tasks/tools without modifying the job core.

## Systems worth building next

### Shops
Use a shared shop registry with finite stock, prices, job/license/grade restrictions, deliveries that replenish inventory, and business ownership. Shop inventory should be authoritative and use the same item definitions as player/container inventory.

### Garages and impound
Separate vehicle ownership from where a vehicle is physically/statefully stored. Keep `stored`, `out`, `impounded`, `seized`, `under_repair`, and `in_transit` states. House/job/public garages become access points into that service.

### Vehicle keys and hotwiring
Keys should be permission records rather than just physical props. Support owner keys, shared keys, revocation, lock state, lockpicking/hotwire actions, stolen-key state, and evidence generation. The physical key item can still exist when useful.

### Vehicle condition and mechanics
Track systems such as engine, radiator/cooling, brakes, tires, battery, fuel system, body, transmission and electrical. Damage comes from travel/chases/events rather than frame-by-frame 3D simulation. Mechanics inspect, diagnose, order/install parts, and bill through banking/business resources.

### Vehicle sales and financing
Dealer inventory, test drives, down payments, installment schedules, salesperson commission, late payment and repossession translate well to a persistent browser world.

### Housing/apartments
Property ownership/rental, shared keys, doorbell, storage, mailbox, wardrobe/appearance, parking/garage, utilities, rent, lock changes and police entry warrants all fit room-based gameplay. Interior rooms are ordinary Port Mercy rooms, not 3D-game shells.

### Business management
Jobs/businesses need grades and permissions: hire/fire, schedule, payroll, shared account access, stock ordering, invoices, storage permissions and audit logs. This should be its own business resource rather than living inside every job.


### Doors and access control
A future `pm-doors` should borrow established door-access permission model without coordinates: a door connects two room IDs and has lock state plus rules for character IDs, jobs/grades, keys/items, property tenancy, business roles, warrants/admin overrides, lockpicking and auto-lock. The generic interaction resource can expose Lock, Unlock, Knock, Ring, Force and Enter verbs.

### City Hall and licensing
A future `pm-civic` should own authoritative licenses and civil documents. The physical driver-license inventory item is a rendered copy of that record, not the authority itself. It can issue/reissue birth certificates and licenses, manage driving tests, government applications and later permits.

### Shared world clock, weather and outages
A future `pm-worldstate` should own one server clock and weather state for everybody. Rooms render that shared state; resources can react to rain, storms, power outages, business hours and road conditions. The heartbeat may propose world-weather transitions, but the worldstate resource validates and applies them.

### Character identity and slots
Keep account identity separate from character identity. Port Mercy should eventually let one account own one or more characters, while every character has its own legal identity, inventory, finances, licenses, jobs, housing, vehicles, records and portrait. No 3D-game ped preview is needed.

### Schema-driven forms and action menus
Use a shared schema-driven UI contract. A resource should be able to request a form/menu declaratively instead of building a custom React screen for every invoice, transfer, evidence form, repair quote, employment action or shop purchase.

### Injury/medical state
Borrow the persistent injury/status concept, not 3D-game health mechanics: bleeding, fractures, burns, intoxication, shock, pain, unconsciousness, treatment timers, hospital billing and medical records. This can become a deep hospital/EMS job system later.

## What we deliberately do not borrow

- peds, entity handles, network IDs, bones, raycasts, polyzones, vector coordinates, animation dictionaries, vehicle spawning/despawning, arcade wanted levels, frame loops, or native calls.
- client authority over money, inventory, travel completion, chase outcomes, damage, ownership, job pay, evidence, or police results.
- sending private player chat/messages/call transcripts to Luna by default.

## Event policy for Luna

Resources decide whether semantic events are `never`, `summary`, or `full`. UI actions normally remain `never`. World-changing outcomes such as a chase ending, a vehicle arriving, a business closing, evidence being collected, a witnessed crime, or a job materially changing the world can be promoted. This lets the hourly heartbeat reason over meaningful changes without receiving every menu click.
