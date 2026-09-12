from pathlib import Path

p = Path('apps/web/src/main.tsx')
s = p.read_text()
s = s.replace('(room.exits as Partial<Record<Direction,RoomId>>)[dir];', '(room.exits as Partial<Record<Direction,RoomId>>)[dir as Direction];')
p.write_text(s)

p = Path('apps/server/src/index.ts')
s = p.read_text()
anchor = "import { GAME_VERSION, WORLD_CATALOG, WORLD_ROOM_IDS, type RoomId } from '@portmercy/protocol';\n"
aliases = "\ntype ChatScope = 'room'|'global';\ntype ChatPayload = { scope?:ChatScope; text?:string };\ntype ItemPayload = { itemId?:string };\ntype InventoryOpenPayload = { inventoryType?:string; inventoryId?:string; compartment?:string };\ntype VehicleStoragePayload = { vehicleId?:string; compartment?:'trunk'|'glovebox' };\n"
if 'type ChatScope =' not in s:
    s = s.replace(anchor, anchor + aliases)
s = s.replace("roomSnapshot:()=>WORLD_ROOM_IDS.map(id=>({id,...WORLD_CATALOG[id],recentActivity:[...(this.recentActivity.get(id)??[])].slice(-10)})),", "roomSnapshot:()=>WORLD_ROOM_IDS.map(id=>({...WORLD_CATALOG[id],recentActivity:[...(this.recentActivity.get(id)??[])].slice(-10)})),")
p.write_text(s)
