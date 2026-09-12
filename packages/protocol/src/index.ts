export const GAME_VERSION = '0.8.0';

export type Direction = 'north'|'south'|'east'|'west'|'inside'|'outside'|'up'|'down';
export type RoomEnvironment = 'outdoor'|'indoor';

export type WorldObject = {
  id:string;
  targetId:string;
  label:string;
  kind:'vehicle'|'npc'|'prop'|'door';
  anchorX?:number;
  anchorY?:number;
  layer?:number;
  tone?:string;
};

export type WorldRoomDefinition = {
  id:string;
  name:string;
  district:string;
  environment:RoomEnvironment;
  weatherZone:string;
  description:string;
  art?:string;
  exits:Partial<Record<Direction,string>>;
  objects:readonly WorldObject[];
  flags?:readonly ('spawn'|'work'|'parking'|'housing')[];
};

export const WORLD_CATALOG = {
  'southward.gas.forecourt': {
    id:'southward.gas.forecourt',
    name:'Mercy Fuel & Mart',
    district:'South Ward',
    environment:'outdoor',
    weatherZone:'southward',
    description:'The forecourt sits between Harbor Avenue and the waterfront. Canopy lights wash over wet pumps and pavement while the store windows glow behind them.',
    art:'/assets/rooms/mercy-fuel-exterior.webp',
    exits:{west:'southward.diner',east:'southward.alley',inside:'southward.mercyfuel.interior'},
    objects:[
      {id:'sedan.blue',targetId:'entity:vehicle:sedan.blue',label:'faded blue sedan',kind:'vehicle',anchorX:.73,anchorY:.72,layer:20},
      {id:'mercy.pumps',targetId:'entity:prop:mercy.pumps',label:'fuel pumps',kind:'prop',anchorX:.46,anchorY:.68,layer:10},
    ],
    flags:['spawn','work','parking'],
  },
  'southward.mercyfuel.interior': {
    id:'southward.mercyfuel.interior',
    name:'Mercy Fuel · Store Interior',
    district:'South Ward',
    environment:'indoor',
    weatherZone:'southward',
    description:'Warm fluorescents hum over the coolers, coffee station and a glossy tile floor tracked wet near the entrance. Harbor lights shimmer through the front glass.',
    art:'/assets/rooms/mercy-fuel-interior.webp',
    exits:{outside:'southward.gas.forecourt'},
    objects:[
      {id:'maya.torres',targetId:'entity:npc:maya.torres',label:'Maya Torres',kind:'npc',anchorX:.76,anchorY:.58,layer:20},
      {id:'mercy.coffee',targetId:'entity:prop:mercy.coffee',label:'coffee station',kind:'prop',anchorX:.32,anchorY:.57,layer:10},
      {id:'mercy.coolers',targetId:'entity:prop:mercy.coolers',label:'cold drink coolers',kind:'prop',anchorX:.18,anchorY:.48,layer:5},
    ],
    flags:['work'],
  },
  'southward.diner': {
    id:'southward.diner',
    name:"Rita's Diner",
    district:'South Ward',
    environment:'indoor',
    weatherZone:'southward',
    description:'A narrow twenty-four-hour diner with split vinyl booths, strong coffee and rain streaking the windows toward Harbor Avenue.',
    exits:{east:'southward.gas.forecourt'},
    objects:[
      {id:'rita.vale',targetId:'entity:npc:rita.vale',label:'Rita Vale',kind:'npc',anchorX:.66,anchorY:.56,layer:20},
    ],
    flags:['work'],
  },
  'southward.alley': {
    id:'southward.alley',
    name:'Mercy Service Alley',
    district:'South Ward',
    environment:'outdoor',
    weatherZone:'southward',
    description:'Wet brick walls squeeze around dumpsters, utility pipes and a fire escape. A security lamp buzzes overhead beside the harbor wind.',
    exits:{west:'southward.gas.forecourt'},
    objects:[
      {id:'mercy.dumpster',targetId:'entity:prop:mercy.dumpster',label:'padlocked dumpster',kind:'prop',anchorX:.58,anchorY:.68,layer:10},
    ],
    flags:[],
  },
  'southward.apartment.lobby': {
    id:'southward.apartment.lobby',
    name:'Marrow Apartments',
    district:'South Ward',
    environment:'indoor',
    weatherZone:'southward',
    description:'Peeling green paint, dented brass mailboxes and an elevator that smells faintly of hot wiring. Apartment 3B is upstairs. The lobby camera over the door has not worked in years.',
    exits:{},
    objects:[
      {id:'marrow.tenant',targetId:'entity:npc:marrow.tenant',label:'tired tenant',kind:'npc',anchorX:.61,anchorY:.63,layer:20},
    ],
    flags:['housing'],
  },
} as const satisfies Record<string,WorldRoomDefinition>;

export type RoomId = keyof typeof WORLD_CATALOG;
export const WORLD_ROOM_IDS = Object.keys(WORLD_CATALOG) as RoomId[];
export function getWorldRoom(id:string){return WORLD_CATALOG[id as RoomId] ?? null;}

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

export type RoomView = WorldRoomDefinition & { id:RoomId };

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

export type InventoryType = 'player'|'stash'|'container'|'vehicle_trunk'|'vehicle_glovebox'|'shop';
export type InventoryView = {id:string;type:InventoryType|string;label:string;items:InventoryItem[]};

export type InteractionOption = {
  id:string;
  label:string;
  action:string;
  payload?:unknown;
  roomId?:RoomId;
  jobId?:string;
  onDuty?:boolean;
  order?:number;
};
export type InteractionList = {targetId:string;options:InteractionOption[]};

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
export type ResourceDescriptor = {name:string;version:string;description:string;dependencies:string[];clientActions?:string[]};
export type ResourceEvent = {id:string;name:string;at:number;resource:string;correlationId:string;actorId?:string;roomId?:string;ai:AiEventVisibility;payload:unknown};

export type GameActionName =
  | 'player:move'|'chat:send'|'inventory:open'|'inventory:close'|'inventory:use'|'inventory:drop'|'inventory:move'
  | 'vehicle:openStorage'|'vehicle:setLock'|'job:clockIn'|'job:clockOut'|'job:performAvailable'|'job:startTask'
  | 'world:take'|'interaction:list'|'interaction:run'|'travel:start'|'travel:cancel';
export type GameActionRequest = {name:GameActionName|string;payload?:unknown};
export type GameActionResult = {name:string;correlationId:string;ok:boolean;reason?:string;value?:unknown};

export type WeatherState={zone:string;type:'clear'|'rain'|'fog'|'snow'|'storm';label:string;detail:string;intensity:number;seed:number;startedAt:number;nextAt:number};
