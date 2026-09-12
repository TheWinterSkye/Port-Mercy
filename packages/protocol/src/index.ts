export type Direction = 'north'|'south'|'east'|'west'|'inside'|'outside'|'up'|'down';
export type RoomId = 'southward.gas.forecourt'|'southward.mercyfuel.interior'|'southward.diner'|'southward.alley'|'southward.apartment.lobby';

export type DriverLicenseData = {
  documentType:'drivers_license';
  legalName:string;
  dateOfBirth:string;
  address:string;
  licenseNumber:string;
  licenseClass:string;
  expires:string;
  sexMarker:string;
  height:string;
  eyes:string;
  portraitUrl:string;
  portraitStatus:'pending'|'ready';
};

export type InventoryItem = {
  id:string;
  templateId:string;
  name:string;
  kind:'key'|'phone'|'document'|'consumable'|'tool'|'misc';
  quantity:number;
  weight:number;
  description:string;
  usable?:boolean;
  droppable?:boolean;
  metadata?:Record<string,unknown>|DriverLicenseData;
};

export type PlayerSummary = {
  id:string;
  name:string;
  job:string;
  cash:number;
  health:number;
  stress:number;
  roomId:RoomId;
  inventory:InventoryItem[];
};

export type WorldObject = {
  id:string;
  label:string;
  kind:'vehicle'|'npc'|'prop'|'door';
  x:number;
  y:number;
  z:number;
  tone?:string;
};

export type RoomView = {
  id:RoomId;
  name:string;
  district:string;
  environment:'outdoor'|'indoor';
  weatherZone:string;
  description:string;
  exits:Partial<Record<Direction,RoomId>>;
  objects:WorldObject[];
};

export type ChatScope = 'room'|'global';
export type ChatMessage = {
  id:string;
  scope:ChatScope;
  from:string;
  text:string;
  roomId:RoomId;
  sentAt:number;
};

export type HeartbeatStatus = {
  mode:'codex'|'offline';
  lastAt:number;
  sequence:number;
  summary:string;
};

export type ClientCommand =
  | {type:'move'; direction:Direction}
  | {type:'chat'; scope:ChatScope; text:string}
  | {type:'work'}
  | {type:'take'; target:string}
  | {type:'use_item'; itemId:string}
  | {type:'drop_item'; itemId:string}
  | {type:'interact'; target:string; verb:string}
  | {type:'open_inventory'; inventoryType?:InventoryType; inventoryId?:string}
  | {type:'open_vehicle_storage'; vehicleId:string; compartment:'trunk'|'glovebox'}
  | {type:'move_inventory_item'; itemId:string; fromInventory:string; toInventory:string};

export type AiEventVisibility = 'never'|'summary'|'full';

export type ResourceDescriptor = {
  name:string;
  version:string;
  description:string;
  dependencies:string[];
  clientActions?:string[];
};

export type ResourceEvent = {
  id:string;
  name:string;
  at:number;
  resource:string;
  correlationId:string;
  actorId?:string;
  roomId?:string;
  ai:AiEventVisibility;
  payload:unknown;
};

export type InventoryType = 'player'|'stash'|'container'|'vehicle_trunk'|'vehicle_glovebox'|'shop';

export type InventoryView = {
  id:string;
  type:InventoryType|string;
  label:string;
  items:InventoryItem[];
};

export type GameActionName =
  | 'player:move'
  | 'chat:send'
  | 'inventory:open'
  | 'inventory:close'
  | 'inventory:use'
  | 'inventory:drop'
  | 'inventory:move'
  | 'vehicle:openStorage'
  | 'vehicle:setLock'
  | 'job:clockIn'
  | 'job:clockOut'
  | 'job:performAvailable'
  | 'job:completeTask'
  | 'world:take';

export type GameActionRequest = { name:GameActionName|string; payload?:unknown };
export type GameActionResult = { name:string; correlationId:string; ok:boolean; reason?:string };

export type WeatherState={zone:string;type:'clear'|'rain'|'fog'|'snow'|'storm';label:string;detail:string;intensity:number;seed:number;startedAt:number;nextAt:number};
