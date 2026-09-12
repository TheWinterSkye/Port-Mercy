import http from 'node:http';
import express from 'express';
import { randomUUID } from 'node:crypto';
import { Server, Room, Client } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { Schema, defineTypes } from '@colyseus/schema';
import { HeartbeatService, type HeartbeatResult, type WorldMutation, type WorldSnapshot } from './heartbeat.js';
import { ResourceRuntime, resolveResourcesDirectory } from './runtime.js';
import { PersistenceStore, type PersistedCharacter, type PersistedItem, type PersistedVehicle, type PersistedIncident, type PersistedEvidence } from './persistence.js';
import { GAME_VERSION, WORLD_CATALOG, WORLD_ROOM_IDS, type RoomId } from '@portmercy/protocol';

type ChatScope='room'|'global';
type ChatPayload={scope?:ChatScope;text?:string};
type ItemPayload={itemId?:string};
type InventoryOpenPayload={inventoryType?:string;inventoryId?:string;compartment?:string};
type VehicleStoragePayload={vehicleId?:string;compartment?:'trunk'|'glovebox'};
type ItemRecord={id:string;templateId:string;name:string;kind:string;quantity:number;weight:number;description:string;usable:boolean;droppable:boolean;metadataJson:string};
type PlayerRecord=PersistedCharacter&{inventory:Map<string,ItemRecord>};
type ChatMessage={id:string;scope:ChatScope;from:string;text:string;roomId:RoomId;sentAt:number};
type Incident=PersistedIncident&{suspectCharacterId?:string|null};
type VehicleRecord={id:string;label:string;roomId:RoomId;status:string;locked:boolean;ownerCharacterId:string|null;registration:string;fuel:number;condition:number};
type ActivityRecord={kind:'work'|'travel'|'chase';id:string;startedAt:number};
type WeatherKind='clear'|'rain'|'fog'|'snow'|'storm';
type WeatherWire={zone:string;type:WeatherKind;label:string;detail:string;intensity:number;seed:number;startedAt:number;nextAt:number};
type InventoryWireItem={id:string;templateId:string;name:string;kind:string;quantity:number;weight:number;description:string;usable:boolean;droppable:boolean;metadata:Record<string,unknown>};
type NpcState={id:string;name:string;roomId:RoomId;role:string;motivation:string;intent:string};
type BusinessState={id:string;name:string;roomId:RoomId;open:boolean;pressure:string;status:string};

const EXITS=Object.fromEntries(WORLD_ROOM_IDS.map(id=>[id,WORLD_CATALOG[id].exits])) as Record<RoomId,Record<string,RoomId>>;
const VALID_ROOM_IDS=new Set<RoomId>(WORLD_ROOM_IDS);
const VALID_NPCS=new Set(['rita.vale','mercy.fuel.clerk','marrow.tenant']);
const VALID_BUSINESSES=new Set(['mercy.fuel','ritas.diner']);
const VALID_JOBS=new Set(['mercy.fuel.stock','ritas.dishwasher']);
const VALID_VEHICLES=new Set(['sedan.blue']);
const VALID_PROPERTIES=new Set(['marrow.apartments','marrow.3b']);
const WEATHER_STEPS:Array<Omit<WeatherWire,'zone'|'seed'|'startedAt'|'nextAt'>>=[
 {type:'rain',label:'Cold rain',detail:'harbor wind · wet pavement',intensity:.7},
 {type:'fog',label:'Dense fog',detail:'low visibility · harbor mist',intensity:.65},
 {type:'clear',label:'Clear night',detail:'cool air · dry streets',intensity:0},
 {type:'snow',label:'Wet snow',detail:'slush building on exposed streets',intensity:.55},
 {type:'storm',label:'Harbor squall',detail:'heavy rain · hard gusts',intensity:.9},
];
function makeWeather(index:number):WeatherWire{const base=WEATHER_STEPS[index%WEATHER_STEPS.length],now=Date.now();return {zone:'southward',...base,seed:Math.floor(Math.random()*1_000_000),startedAt:now,nextAt:now+30*60_000};}
function makeItem(templateId:string,name:string,kind:string,description:string,usable=false,droppable=true,weight=.1,metadata:Record<string,unknown>={}):ItemRecord{return {id:randomUUID(),templateId,name,kind,quantity:1,weight,description,usable,droppable,metadataJson:JSON.stringify(metadata)}}
function itemFromPersisted(row:PersistedItem):ItemRecord{return {...row};}
function itemToPersisted(item:ItemRecord):PersistedItem{return {...item};}
function itemMetadata(item:ItemRecord){try{return JSON.parse(item.metadataJson||'{}') as Record<string,unknown>}catch{return {}}}
function itemWire(item:ItemRecord):InventoryWireItem{return {id:item.id,templateId:item.templateId,name:item.name,kind:item.kind,quantity:item.quantity,weight:item.weight,description:item.description,usable:item.usable,droppable:item.droppable,metadata:itemMetadata(item)}}
function makeDriversLicense(p:PlayerRecord){return makeItem('document.drivers_license','Port Mercy driver license','document','A state-issued driver license. The portrait slot is ready for the character image when one exists.',true,false,.01,{documentType:'drivers_license',legalName:p.legalName,dateOfBirth:p.dateOfBirth,address:p.homeAddress,licenseNumber:p.licenseNumber,licenseClass:'C',expires:'2030-08-17',sexMarker:p.sexMarker,height:p.height,eyes:p.eyes,portraitUrl:'',portraitStatus:'pending'})}
function safeJson<T>(text:string|null,fall:T):T{try{return text?JSON.parse(text) as T:fall}catch{return fall}}

class WorldState extends Schema{
 heartbeatMode='offline';heartbeatLastAt=0;heartbeatSequence=0;heartbeatSummary='World heartbeat has not run yet.';resourceCount=0;onlineCount=0;
}
defineTypes(WorldState,{heartbeatMode:'string',heartbeatLastAt:'number',heartbeatSequence:'number',heartbeatSummary:'string',resourceCount:'number',onlineCount:'number'});

let worldProcessActive=false;

class WorldRoom extends Room<WorldState>{
 maxClients=512;
 autoDispose=false;
 private players=new Map<string,PlayerRecord>();
 private characterSessions=new Map<string,string>();
 private chatHistory:ChatMessage[]=[];
 private recentActivity=new Map<RoomId,string[]>();
 private persistence=new PersistenceStore();
 private weatherIndex=0;
 private weather:WeatherWire=makeWeather(0);
 private heartbeat!:HeartbeatService;
 private runtime!:ResourceRuntime;
 private secondaryInventories=new Map<string,Map<string,ItemRecord>>();
 private vehicles=new Map<string,VehicleRecord>();
 private incidents:Incident[]=[];
 private activities=new Map<string,ActivityRecord>();
 private heartbeatCursor=0;
 private npcs=new Map<string,NpcState>();
 private businesses=new Map<string,BusinessState>();

 async onCreate(){
  if(worldProcessActive)throw new Error('Port Mercy already has an active world in this server process; implicit city sharding is disabled.');
  worldProcessActive=true;this.setState(new WorldState());
  for(const roomId of WORLD_ROOM_IDS)this.recentActivity.set(roomId,[]);
  this.heartbeatCursor=Number(this.persistence.getMeta('heartbeat_cursor')||0)||0;
  const savedWeather=safeJson<WeatherWire|null>(this.persistence.getMeta('weather_state'),null);if(savedWeather&&savedWeather.zone==='southward')this.weather=savedWeather;
  this.loadDurableWorld();
  this.ensureSecondaryInventory('vehicle:sedan.blue:trunk',[makeItem('tool.jumper_cables','Jumper cables','tool','A cheap set of red and black jumper cables.',false,true,2.2),makeItem('cloth.shop_rag','Shop rag','misc','An oily cotton rag that smells faintly of gasoline.',false,true,.1)]);
  this.ensureSecondaryInventory('vehicle:sedan.blue:glovebox',[makeItem('document.registration','Vehicle registration','document','Registration paperwork for the faded blue sedan.',true,false,.02,{vehicleId:'sedan.blue'})]);
  this.ensureSecondaryInventory('shop:mercy.fuel:cooler',Array.from({length:6},()=>makeItem('drink.energy','Redline energy drink','consumable','A dented can of something aggressively citrus.',true,true,.35)));

  this.runtime=new ResourceRuntime(this.buildRuntimeHost(),resolveResourcesDirectory());
  const resources=await this.runtime.loadAll();this.state.resourceCount=resources.length;console.log(`[resources] loaded ${resources.length}: ${resources.join(', ')}`);
  this.onMessage('action',(client,payload:{name?:string;payload?:unknown;requestId?:string})=>void this.runClientAction(client,payload?.name,payload?.payload,payload?.requestId));
  this.onMessage('move',(client,direction:string)=>void this.runAction(client,'player:move',{direction}));
  this.onMessage('work',client=>void this.runAction(client,'job:performAvailable',{}));
  this.onMessage('chat',(client,payload:ChatPayload)=>void this.runAction(client,'chat:send',payload));
  this.onMessage('use_item',(client,payload:ItemPayload)=>void this.runAction(client,'inventory:use',payload));
  this.onMessage('drop_item',(client,payload:ItemPayload)=>void this.runAction(client,'inventory:drop',payload));
  this.onMessage('take',(client,target:string)=>void this.runAction(client,'world:take',{target}));
  this.onMessage('open_inventory',(client,payload:InventoryOpenPayload={})=>void this.runAction(client,'inventory:open',payload));
  this.onMessage('close_inventory',client=>void this.runAction(client,'inventory:close',{}));
  this.onMessage('open_vehicle_storage',(client,payload:VehicleStoragePayload)=>void this.runAction(client,'vehicle:openStorage',payload));
  this.onMessage('move_inventory_item',(client,payload:unknown)=>void this.runAction(client,'inventory:move',payload));
  this.onMessage('set_vehicle_lock',(client,payload:{vehicleId?:string;locked?:boolean})=>void this.runAction(client,'vehicle:setLock',payload));

  this.heartbeat=new HeartbeatService(sequence=>this.makeHeartbeatSnapshot(sequence),result=>this.applyHeartbeat(result),(mode,lastAt,sequence,summary)=>{this.state.heartbeatMode=mode;this.state.heartbeatLastAt=lastAt;this.state.heartbeatSequence=sequence;this.state.heartbeatSummary=summary;this.broadcast('heartbeat_status',{mode,lastAt,sequence,summary})});
  this.heartbeat.start();this.clock.setInterval(()=>this.advanceWeather(),30*60_000);
 }

 private loadDurableWorld(){
  const savedVehicles=this.persistence.loadVehicles();
  if(savedVehicles.length){for(const row of savedVehicles){const roomId=this.validRoom(row.roomId)?row.roomId:'southward.gas.forecourt';const status=row.status==='traveling'?'parked':row.status;const v:VehicleRecord={...row,roomId,status};this.vehicles.set(v.id,v);if(status!==row.status)this.persistVehicle(v)}}
  else{const v:VehicleRecord={id:'sedan.blue',label:'faded blue sedan',roomId:'southward.gas.forecourt',status:'parked',locked:false,ownerCharacterId:null,registration:'PM-4817',fuel:62,condition:84};this.vehicles.set(v.id,v);this.persistVehicle(v)}
  this.incidents=this.persistence.loadIncidents().map(row=>({...row}));
  const npcDefaults:NpcState[]=[
   {id:'rita.vale',name:'Rita Vale',roomId:'southward.diner',role:'diner owner',motivation:'Keep the diner solvent and look after regulars without becoming their rescuer.',intent:'run the graveyard shift'},
   {id:'mercy.fuel.clerk',name:'Maya Torres',roomId:'southward.mercyfuel.interior',role:'night cashier',motivation:'Finish the shift safely, avoid theft, and keep the store and pumps running.',intent:'watch the register and floor'},
   {id:'marrow.tenant',name:'Tired tenant',roomId:'southward.apartment.lobby',role:'resident',motivation:'Get upstairs, avoid trouble, and make rent.',intent:'get home quietly'},
  ];
  const npcSaved=safeJson<NpcState[]>(this.persistence.getMeta('npc_state'),[]);for(const row of npcSaved.length?npcSaved:npcDefaults)if(VALID_NPCS.has(row.id)&&this.validRoom(row.roomId))this.npcs.set(row.id,row);
  const businessDefaults:BusinessState[]=[
   {id:'mercy.fuel',name:'Mercy Fuel & Mart',roomId:'southward.mercyfuel.interior',open:true,pressure:'thin overnight staffing and aging pumps',status:'open'},
   {id:'ritas.diner',name:"Rita's Diner",roomId:'southward.diner',open:true,pressure:'slow graveyard trade and food-cost pressure',status:'open'},
  ];
  const businessSaved=safeJson<BusinessState[]>(this.persistence.getMeta('business_state'),[]);for(const row of businessSaved.length?businessSaved:businessDefaults)if(VALID_BUSINESSES.has(row.id)&&this.validRoom(row.roomId))this.businesses.set(row.id,row);
 }
 private saveNpcState(){this.persistence.setMeta('npc_state',JSON.stringify([...this.npcs.values()]));}
 private saveBusinessState(){this.persistence.setMeta('business_state',JSON.stringify([...this.businesses.values()]));}
 private persistVehicle(v:VehicleRecord){this.persistence.saveVehicle({id:v.id,label:v.label,roomId:v.roomId,status:v.status,locked:v.locked,ownerCharacterId:v.ownerCharacterId,registration:v.registration,fuel:v.fuel,condition:v.condition});}

 onJoin(client:Client,options:{characterToken?:string}={}){
  const supplied=String(options?.characterToken||'').trim();const token=/^[A-Za-z0-9_-]{20,100}$/.test(supplied)?supplied:randomUUID();const saved=this.persistence.loadOrCreateCharacter(token);
  if(this.characterSessions.has(saved.characterId))throw new Error('That character is already connected.');
  const p:PlayerRecord={...saved,roomId:this.validRoom(saved.roomId)?saved.roomId:'southward.gas.forecourt',inventory:new Map()};
  const storedItems=this.persistence.loadItems(p.characterId);if(storedItems.length){for(const row of storedItems)p.inventory.set(row.id,itemFromPersisted(row))}else{
   for(const item of [makeItem('phone.basic','Cheap phone','phone','A scratched prepaid phone with a weak battery.',true,false,.2),makeItem('key.apartment','Apartment key','key','A brass key stamped 3B.',false,false,.05),makeDriversLicense(p),makeItem('water.bottle','Bottled water','consumable','Still cold from a corner-store refrigerator.',true,true,.5)])p.inventory.set(item.id,item);this.persistPlayerObject(p);
  }
  this.players.set(client.sessionId,p);this.characterSessions.set(p.characterId,client.sessionId);this.state.onlineCount=this.players.size;
  client.send('identity_token',{characterToken:token,characterId:p.characterId});this.sendSelf(client.sessionId);this.sendRoomView(client);
  client.send('chat_history',this.chatHistory.filter(m=>m.scope==='global'||m.roomId===p.roomId).slice(-30));
  client.send('heartbeat_status',{mode:this.state.heartbeatMode,lastAt:this.state.heartbeatLastAt,sequence:this.state.heartbeatSequence,summary:this.state.heartbeatSummary});client.send('resource_status',{resources:this.runtime.listResources()});client.send('weather_state',this.weather);this.sendEvent(client.sessionId,'Connected to Port Mercy.',p.roomId);
  void this.runtime.emitSystem('player:joined',{name:p.name,characterId:p.characterId},{actorId:client.sessionId,roomId:p.roomId});this.broadcastRoomViews();
 }

 async onLeave(client:Client){
  const p=this.players.get(client.sessionId);if(!p)return;
  await this.runtime.emitSystem('player:left',{name:p.name,characterId:p.characterId},{actorId:client.sessionId,roomId:p.roomId});this.persistPlayerObject(p);this.characterSessions.delete(p.characterId);this.players.delete(client.sessionId);this.activities.delete(client.sessionId);this.state.onlineCount=this.players.size;this.broadcastRoomViews();
 }

 async onDispose(){
  for(const p of this.players.values())this.persistPlayerObject(p);
  await this.heartbeat?.close();await this.runtime?.dispose();this.persistence.setMeta('weather_state',JSON.stringify(this.weather));this.persistence.close();worldProcessActive=false;
 }

 private playerById(id?:string){return id?this.players.get(id):undefined;}
 private player(client:Client){return this.players.get(client.sessionId);}
 private clientFor(actorId?:string){return actorId?this.clients.find(c=>c.sessionId===actorId):undefined;}
 private validRoom(id:unknown):id is RoomId{return typeof id==='string'&&VALID_ROOM_IDS.has(id as RoomId);}
 private persistedCharacter(p:PlayerRecord):PersistedCharacter{const {inventory,...rest}=p;return rest;}
 private persistedItems(p:PlayerRecord):PersistedItem[]{return [...p.inventory.values()].map(itemToPersisted);}
 private persistPlayerObject(p:PlayerRecord){if(!p.characterId)return;this.persistence.saveCharacter(this.persistedCharacter(p));this.persistence.saveItems(p.characterId,this.persistedItems(p));}
 private persistPlayer(actorId?:string){const p=this.playerById(actorId);if(p)this.persistPlayerObject(p);}

 private selfState(p:PlayerRecord){return {characterId:p.characterId,name:p.name,legalName:p.legalName,dateOfBirth:p.dateOfBirth,homeAddress:p.homeAddress,licenseNumber:p.licenseNumber,sexMarker:p.sexMarker,height:p.height,eyes:p.eyes,phoneNumber:p.phoneNumber,cash:p.cash,bank:p.bank,health:p.health,stress:p.stress,job:p.job,jobId:p.jobId,onDuty:p.onDuty,roomId:p.roomId,skillsJson:p.skillsJson,inventory:[...p.inventory.values()].map(itemWire),activity:this.activities.get(this.characterSessions.get(p.characterId)??'')??null};}
 private sendSelf(actorId?:string){const p=this.playerById(actorId),client=this.clientFor(actorId);if(p&&client)client.send('self_state',this.selfState(p));}
 private sendEvent(actorId:string|undefined,text:string,roomId?:RoomId){const client=this.clientFor(actorId),p=this.playerById(actorId);if(client)client.send('event',{id:randomUUID(),text,roomId:roomId??p?.roomId??null,at:Date.now()});}
 private roomEvent(roomId:RoomId,text:string){const event={id:randomUUID(),text,roomId,at:Date.now()};this.remember(roomId,text);for(const client of this.clients)if(this.player(client)?.roomId===roomId)client.send('event',event);}
 private globalEvent(text:string){this.broadcast('world_event',{id:randomUUID(),text,at:Date.now()});}
 private remember(roomId:RoomId,text:string){const list=this.recentActivity.get(roomId)??[];list.push(text);if(list.length>40)list.shift();this.recentActivity.set(roomId,list);}

 private publicRoomView(actorId:string){
  const p=this.playerById(actorId);if(!p)return null;const room=WORLD_CATALOG[p.roomId];
  const occupants=[...this.players.values()].filter(other=>other.roomId===p.roomId).map(other=>({characterId:other.characterId,name:other.name,job:other.job}));
  const vehicles=[...this.vehicles.values()].filter(v=>v.roomId===p.roomId&&v.status!=='traveling').map(v=>({id:v.id,label:v.label,status:v.status,locked:v.locked,registration:v.registration,fuel:v.fuel,condition:v.condition,ownerCharacterId:v.ownerCharacterId}));
  const objects=room.objects.filter(obj=>obj.kind!=='vehicle'||vehicles.some(v=>v.id===obj.id));
  return {roomId:p.roomId,room:{...room,objects},occupants,vehicles,activity:[...(this.recentActivity.get(p.roomId)??[])].slice(-40)};
 }
 private sendRoomView(client:Client){const view=this.publicRoomView(client.sessionId);if(view)client.send('room_view',view);}
 private broadcastRoomViews(){for(const client of this.clients)this.sendRoomView(client);}

 private async runClientAction(client:Client,name:unknown,payload:unknown,requestId?:string){const p=this.player(client);if(!p)return;const correlationId=typeof requestId==='string'&&requestId.length<=160?requestId:randomUUID();if(typeof name!=='string'||!this.runtime.isClientAction(name)){client.send('action_result',{name:String(name||''),correlationId,ok:false,reason:'That action is not available to the client.'});return;}const result=await this.runtime.executeClient(name,{actorId:client.sessionId,roomId:p.roomId,payload,correlationId});client.send('action_result',{name,correlationId:result.correlationId,ok:result.ok,...(result.ok?{value:result.value}:{reason:result.reason})});if(!result.ok)this.sendEvent(client.sessionId,result.reason,p.roomId);}
 private async runAction(client:Client,name:string,payload:unknown){const p=this.player(client);if(!p)return;const result=await this.runtime.execute(name,{actorId:client.sessionId,roomId:p.roomId,source:'client',payload});if(!result.ok)this.sendEvent(client.sessionId,result.reason,p.roomId);}

 private ensureSecondaryInventory(id:string,seed:ItemRecord[]=[]){let inventory=this.secondaryInventories.get(id);if(!inventory){const stored=this.persistence.ensureContainer(id,seed.map(itemToPersisted));inventory=new Map(stored.map(row=>[row.id,itemFromPersisted(row)]));this.secondaryInventories.set(id,inventory)}return inventory;}
 private canonicalInventory(actorId:string|undefined,spec:{type?:string;id?:string;compartment?:string}){if(!actorId)return null;const type=String(spec.type||'player');if(type==='player')return `player:${actorId}`;if(type==='vehicle_trunk'||type==='vehicle_glovebox'){const compartment=type==='vehicle_glovebox'?'glovebox':'trunk';const vehicleId=String(spec.id||'');return vehicleId?`vehicle:${vehicleId}:${compartment}`:null}return null;}
 private inventoryAccess(actorId:string|undefined,id:string){const p=this.playerById(actorId);if(!p)return {ok:false,reason:'Player is unavailable.'};if(id===`player:${actorId}`)return {ok:true,type:'player',label:`${p.name}'s inventory`};const match=/^vehicle:([^:]+):(trunk|glovebox)$/.exec(id);if(!match)return {ok:false,reason:'That inventory does not exist.'};const vehicle=this.vehicles.get(match[1]);if(!vehicle)return {ok:false,reason:'That vehicle does not exist.'};if(vehicle.roomId!==p.roomId||vehicle.status==='traveling')return {ok:false,reason:'That vehicle is not here.'};if(vehicle.locked&&vehicle.ownerCharacterId!==p.characterId)return {ok:false,reason:'The vehicle is locked.'};return {ok:true,type:`vehicle_${match[2]}`,label:`${vehicle.label} — ${match[2]}`,vehicleId:vehicle.id,compartment:match[2]};}
 private resolveInventory(actorId:string|undefined,spec:{type?:string;id?:string;compartment?:string}){const id=this.canonicalInventory(actorId,spec);return id?this.resolveInventoryByCanonicalId(actorId,id):null;}
 private resolveInventoryByCanonicalId(actorId:string|undefined,id:string){const access=this.inventoryAccess(actorId,id);if(!access.ok)return null;const p=this.playerById(actorId)!;if(id===`player:${actorId}`)return {id,type:'player',label:access.label,ownerId:actorId,items:[...p.inventory.values()].map(itemWire)};const items=[...this.ensureSecondaryInventory(id).values()].map(itemWire);return {id,type:access.type,label:access.label,vehicleId:access.vehicleId,compartment:access.compartment,items};}
 private persistInventoryMove(actorId:string,containerIds:string[]){const p=this.playerById(actorId);if(!p)throw new Error('Player is unavailable.');const containers=[...new Set(containerIds.filter(id=>id!==`player:${actorId}`))].map(id=>({id,items:[...this.ensureSecondaryInventory(id).values()].map(itemToPersisted)}));this.persistence.saveInventoryBundle(p.characterId,this.persistedItems(p),containers);}
 private moveInventoryItem(actorId:string|undefined,payload:any){
  const p=this.playerById(actorId);if(!p||!actorId)throw new Error('Player is unavailable.');const itemId=String(payload?.itemId||''),fromId=String(payload?.fromInventory||`player:${actorId}`),toId=String(payload?.toInventory||'');if(!itemId||!toId||fromId===toId)throw new Error('Invalid inventory transfer.');
  const fromAccess=this.inventoryAccess(actorId,fromId),toAccess=this.inventoryAccess(actorId,toId);if(!fromAccess.ok)throw new Error(fromAccess.reason);if(!toAccess.ok)throw new Error(toAccess.reason);
  const playerId=`player:${actorId}`,from=fromId===playerId?p.inventory:this.ensureSecondaryInventory(fromId),to=toId===playerId?p.inventory:this.ensureSecondaryInventory(toId);const item=from.get(itemId);if(!item)throw new Error('That item is no longer there.');if(fromId===playerId&&toId!==playerId&&!item.droppable)throw new Error(`${item.name} must stay with you.`);if(to.size>=60)throw new Error('That inventory is full.');
  from.delete(itemId);to.set(itemId,item);try{this.persistInventoryMove(actorId,[fromId,toId]);}catch(error){to.delete(itemId);from.set(itemId,item);throw error}this.sendSelf(actorId);return {itemId:item.id,templateId:item.templateId,fromInventory:fromId,toInventory:toId,count:item.quantity};
 }
 private takeShopItem(actorId:string|undefined,containerId:string,templateId:string){const p=this.playerById(actorId);if(!p||!actorId)throw new Error('Player is unavailable.');const container=this.ensureSecondaryInventory(containerId);const item=[...container.values()].find(row=>row.templateId===templateId);if(!item)throw new Error('That stock is gone.');container.delete(item.id);p.inventory.set(item.id,item);try{this.persistInventoryMove(actorId,[containerId])}catch(error){p.inventory.delete(item.id);container.set(item.id,item);throw error}this.sendSelf(actorId);return item;}

 private sendChat(actorId:string|undefined,scope:ChatScope,text:string){const p=this.playerById(actorId);if(!p)throw new Error('Player is unavailable.');const message:ChatMessage={id:randomUUID(),scope,from:p.name,text,roomId:p.roomId,sentAt:Date.now()};this.chatHistory.push(message);if(this.chatHistory.length>200)this.chatHistory.shift();for(const other of this.clients){const op=this.player(other);if(scope==='global'||op?.roomId===p.roomId)other.send('chat',message)}return message;}

 private beginActivity(actorId:string|undefined,kind:ActivityRecord['kind'],id:string,allowFrom:ActivityRecord['kind'][]=[]){if(!actorId)return {ok:false,reason:'Player is unavailable.'};const current=this.activities.get(actorId);if(current&&!allowFrom.includes(current.kind))return {ok:false,reason:`You are already ${current.kind==='work'?'working':current.kind==='travel'?'traveling':'in a chase'}.`};const row={kind,id,startedAt:Date.now()};this.activities.set(actorId,row);this.sendSelf(actorId);return {ok:true,activity:row,previous:current??null};}
 private endActivity(actorId:string|undefined,kind?:ActivityRecord['kind']){if(!actorId)return false;const current=this.activities.get(actorId);if(!current||kind&&current.kind!==kind)return false;this.activities.delete(actorId);this.sendSelf(actorId);return true;}
 private getActivity(actorId?:string){return actorId?this.activities.get(actorId)??null:null;}
 private actionAllowed(actorId:string|undefined,action:string,source:string){const current=this.getActivity(actorId);if(!current||source==='system'||source==='heartbeat')return true;const nonPhysical=action==='chat:send'||action==='interaction:list'||action.startsWith('phone:')||action.startsWith('bank:')||action==='vehicle:listMine'||action==='job:listAvailable';if(nonPhysical)return true;if(current.kind==='travel')return action==='travel:cancel'||action==='chase:choose';if(current.kind==='work')return false;if(current.kind==='chase')return action==='chase:choose';return true;}

 private buildRuntimeHost(){return {
  getPlayer:(actorId?:string)=>this.playerById(actorId),
  findPlayerByPhone:(phoneNumber?:string)=>{if(!phoneNumber)return null;const normalized=String(phoneNumber).replace(/\D/g,'');for(const [id,p] of this.players)if(p.phoneNumber.replace(/\D/g,'')===normalized)return {id,player:p};return null;},
  listOnlinePlayers:()=>[...this.players.entries()].map(([id,p])=>({id,characterId:p.characterId,name:p.name,phoneNumber:p.phoneNumber,roomId:p.roomId})),
  send:(actorId:string|undefined,event:string,payload:unknown)=>{if(event==='event'&&payload&&typeof payload==='object'&&'text' in (payload as any))this.sendEvent(actorId,String((payload as any).text));else this.clientFor(actorId)?.send(event,payload)},
  sendSelf:(actorId?:string)=>this.sendSelf(actorId),broadcastRoomViews:()=>this.broadcastRoomViews(),roomEvent:(roomId:RoomId,text:string)=>this.roomEvent(roomId,text),remember:(roomId:RoomId,text:string)=>this.remember(roomId,text),sendChat:(actorId:string|undefined,scope:ChatScope,text:string)=>this.sendChat(actorId,scope,text),
  movePlayer:(actorId:string|undefined,direction:string)=>{const p=this.playerById(actorId);if(!p)return null;const dir=direction.toLowerCase(),from=p.roomId,next=EXITS[from]?.[dir];if(!next)return null;p.roomId=next;this.persistPlayer(actorId);this.sendSelf(actorId);this.broadcastRoomViews();return {playerId:actorId,characterId:p.characterId,name:p.name,from,to:next,direction:dir}},
  setPlayerRoom:(actorId:string|undefined,roomId:string)=>{const p=this.playerById(actorId);if(!p||!this.validRoom(roomId))return false;p.roomId=roomId;this.persistPlayer(actorId);this.sendSelf(actorId);this.broadcastRoomViews();return true},
  createItem:(...args:Parameters<typeof makeItem>)=>makeItem(...args),addPlayerItem:(actorId:string|undefined,item:ItemRecord)=>{const p=this.playerById(actorId);if(!p)return false;p.inventory.set(item.id,item);this.persistPlayer(actorId);this.sendSelf(actorId);return true},getPlayerItem:(actorId:string|undefined,itemId?:string)=>{const p=this.playerById(actorId);return p&&itemId?p.inventory.get(itemId):undefined},removePlayerItem:(actorId:string|undefined,itemId:string)=>{const p=this.playerById(actorId);if(!p)return false;const removed=p.inventory.delete(itemId);if(removed){this.persistPlayer(actorId);this.sendSelf(actorId)}return removed},itemMetadata,
  hasItemTemplate:(actorId:string|undefined,templateId:string)=>{const p=this.playerById(actorId);return Boolean(p&&[...p.inventory.values()].some(item=>item.templateId===templateId))},
  resolveInventory:(actorId:string|undefined,spec:any)=>this.resolveInventory(actorId,spec),resolveInventoryByCanonicalId:(actorId:string|undefined,id:string)=>this.resolveInventoryByCanonicalId(actorId,id),moveInventoryItem:(actorId:string|undefined,payload:any)=>this.moveInventoryItem(actorId,payload),takeShopItem:(actorId:string|undefined,containerId:string,templateId:string)=>this.takeShopItem(actorId,containerId,templateId),
  adjustStress:(actorId:string|undefined,delta:number)=>{const p=this.playerById(actorId);if(!p||!Number.isFinite(delta))return null;p.stress=Math.max(0,Math.min(100,p.stress+Math.trunc(delta)));this.persistPlayer(actorId);this.sendSelf(actorId);return p.stress},adjustCash:(actorId:string|undefined,delta:number)=>{const p=this.playerById(actorId);if(!p||!Number.isSafeInteger(Math.trunc(delta)))return null;const next=p.cash+Math.trunc(delta);if(!Number.isSafeInteger(next)||next<0)return null;p.cash=next;this.persistPlayer(actorId);this.sendSelf(actorId);return p.cash},adjustBank:(actorId:string|undefined,delta:number)=>{const p=this.playerById(actorId);if(!p||!Number.isSafeInteger(Math.trunc(delta)))return null;const next=p.bank+Math.trunc(delta);if(!Number.isSafeInteger(next)||next<0)return null;p.bank=next;this.persistPlayer(actorId);this.sendSelf(actorId);return p.bank},getBank:(actorId:string|undefined)=>this.playerById(actorId)?.bank??null,
  transferBankByPhone:(actorId:string|undefined,toPhone:string,amount:number,requestKey:string)=>{const source=this.playerById(actorId);if(!source)return null;const result=this.persistence.transferBank(source.characterId,toPhone,amount,requestKey);source.bank=result.fromBalance;let targetActorId:string|null=null;for(const [id,player] of this.players)if(player.characterId===result.toCharacterId){player.bank=result.toBalance;targetActorId=id;this.sendSelf(id)}this.persistPlayer(actorId);this.sendSelf(actorId);return {...result,targetActorId}},
  getSkill:(actorId:string|undefined,skill:string)=>{const p=this.playerById(actorId);if(!p)return 0;try{return Number(JSON.parse(p.skillsJson||'{}')[skill]||0)}catch{return 0}},setPlayerJob:(actorId:string|undefined,jobId:string,label:string,onDuty:boolean)=>{const p=this.playerById(actorId);if(!p)return false;p.jobId=jobId;p.job=label;p.onDuty=onDuty;this.persistPlayer(actorId);this.sendSelf(actorId);return true},setOnDuty:(actorId:string|undefined,onDuty:boolean)=>{const p=this.playerById(actorId);if(!p)return false;p.onDuty=onDuty;this.persistPlayer(actorId);this.sendSelf(actorId);return true},
  beginActivity:(actorId:string|undefined,kind:ActivityRecord['kind'],id:string,allowFrom:ActivityRecord['kind'][]=[])=>this.beginActivity(actorId,kind,id,allowFrom),endActivity:(actorId:string|undefined,kind?:ActivityRecord['kind'])=>this.endActivity(actorId,kind),getActivity:(actorId?:string)=>this.getActivity(actorId),actionAllowed:(actorId:string|undefined,action:string,source:string)=>this.actionAllowed(actorId,action,source),
  addIncident:(data:{type:string;roomId:RoomId;status:string;summary:string;suspectCharacterId?:string|null})=>{const now=Date.now(),incident:Incident={id:randomUUID(),createdAt:now,updatedAt:now,...data};this.incidents.push(incident);this.persistence.saveIncident(incident);return {...incident}},updateIncident:(id:string,status:string,summary?:string)=>{const row=this.incidents.find(i=>i.id===id);if(!row)return null;row.status=status;if(summary)row.summary=summary;row.updatedAt=Date.now();this.persistence.saveIncident(row);return {...row}},getIncident:(id:string)=>this.incidents.find(i=>i.id===id)??null,listIncidents:()=>this.incidents.map(i=>({...i})),
  listEvidenceRecords:()=>this.persistence.loadEvidence(),saveEvidenceRecord:(row:PersistedEvidence)=>this.persistence.saveEvidence(row),
  getVehicle:(vehicleId?:string)=>vehicleId?this.vehicles.get(vehicleId):undefined,setVehicleRoom:(vehicleId:string|undefined,roomId:string)=>{const v=vehicleId?this.vehicles.get(vehicleId):undefined;if(!v||!this.validRoom(roomId))return false;v.roomId=roomId;this.persistVehicle(v);this.broadcastRoomViews();return true},setVehicleStatus:(vehicleId:string|undefined,status:string)=>{const v=vehicleId?this.vehicles.get(vehicleId):undefined;if(!v)return false;v.status=status;this.persistVehicle(v);this.broadcastRoomViews();return true},setVehicleLock:(actorId:string|undefined,vehicleId?:string,locked=false)=>{const p=this.playerById(actorId),v=vehicleId?this.vehicles.get(vehicleId):undefined;if(!p||!v||v.ownerCharacterId!==p.characterId)return null;v.locked=locked;this.persistVehicle(v);this.broadcastRoomViews();return {...v}},vehicleSnapshot:()=>[...this.vehicles.values()].map(v=>({...v})),
  roomSnapshot:()=>WORLD_ROOM_IDS.map(id=>({...WORLD_CATALOG[id],recentActivity:[...(this.recentActivity.get(id)??[])].slice(-10)})),
 };}

 private advanceWeather(){this.weatherIndex=(this.weatherIndex+1)%WEATHER_STEPS.length;this.weather=makeWeather(this.weatherIndex);this.persistence.setMeta('weather_state',JSON.stringify(this.weather));this.broadcast('weather_state',this.weather);const text=`Weather shifts across South Ward: ${this.weather.label.toLowerCase()}.`;for(const roomId of WORLD_ROOM_IDS)if(WORLD_CATALOG[roomId].environment==='outdoor')this.remember(roomId,text);}

 private makeHeartbeatSnapshot(sequence:number):WorldSnapshot{
  const players=[...this.players.entries()].map(([id,p])=>({id:p.characterId||id,name:p.name,roomId:p.roomId,job:p.job,cash:p.cash,health:p.health,stress:p.stress,inventory:[...p.inventory.values()].map(i=>i.templateId),skills:Object.entries(JSON.parse(p.skillsJson||'{}')).map(([skill,value])=>({id:skill,value:Number(value)||0}))}));
  const rooms=WORLD_ROOM_IDS.map(roomId=>({id:roomId,name:WORLD_CATALOG[roomId].name,district:WORLD_CATALOG[roomId].district,occupants:players.filter(p=>p.roomId===roomId).map(p=>p.name),recentActivity:[...(this.recentActivity.get(roomId)??[])].slice(-10)}));
  const resourceState=this.runtime.heartbeatState(),jobRegistry=(resourceState['pm-jobs:registry'] as Array<{id:string;label:string;roomId:string;status:string;demand:string}>|undefined)??[];
  const journal=this.runtime.journal.afterSequence(this.heartbeatCursor,200);const recentEvents=journal.events.map(event=>({sequence:event.sequence,name:event.name,at:event.at,resource:event.resource,actorId:event.actorId??null,roomId:event.roomId??null,detail:event.ai==='full'?event.payload:undefined,summary:event.ai==='summary'?event.payload:undefined}));
  return {city:'Port Mercy',heartbeatNumber:sequence,capturedAt:new Date().toISOString(),worldClock:new Date().toISOString(),weather:`${this.weather.label}: ${this.weather.detail}`,eventCursor:journal.cursor,rooms,players,npcs:[...this.npcs.values()].map(n=>({...n})),businesses:[...this.businesses.values()].map(b=>({...b})),vehicles:[...this.vehicles.values()].map(v=>({id:v.id,label:v.label,roomId:v.roomId,status:`${v.status}; ${v.locked?'locked':'unlocked'}`})),housing:[{id:'marrow.apartments',label:'Marrow Apartments',roomId:'southward.apartment.lobby',status:'occupied; neglected common areas'},{id:'marrow.3b',label:'Apartment 3B',roomId:'southward.apartment.lobby',status:'player residence; upstairs and not yet modeled as a room'}],police:{activeCalls:this.incidents.filter(i=>i.status==='reported'||i.status==='responding').map(i=>({roomId:i.roomId,reason:i.summary,priority:i.status==='responding'?2:3}))},jobMarket:jobRegistry.map(job=>({id:job.id,name:job.label,roomId:job.roomId,status:job.status,demand:job.demand})),incidents:this.incidents.map(i=>({id:i.id,type:i.type,roomId:i.roomId,status:i.status,summary:i.summary,createdAt:i.createdAt})),economy:{notes:['South Ward is cash-poor, rents are late, and overnight businesses run lean.']},recentEvents,resourceState};
 }
 private async applyHeartbeat(result:HeartbeatResult){for(const mutation of result.mutations)this.applyMutation(mutation);this.heartbeatCursor=result.eventCursor;this.persistence.setMeta('heartbeat_cursor',String(this.heartbeatCursor));console.log(`[heartbeat:${result.mode}] ${result.summary}`);}
 private applyMutation(mutation:WorldMutation){
  switch(mutation.type){
   case 'room_event':if(this.validRoom(mutation.roomId))this.roomEvent(mutation.roomId,mutation.text);return;
   case 'npc_intent':{if(!this.validRoom(mutation.roomId)||!VALID_NPCS.has(mutation.npcId))return;const current=this.npcs.get(mutation.npcId);if(!current)return;current.roomId=mutation.roomId;current.intent=mutation.action;this.saveNpcState();this.roomEvent(mutation.roomId,mutation.text);this.broadcastRoomViews();return;}
   case 'business_event':{if(!this.validRoom(mutation.roomId)||!VALID_BUSINESSES.has(mutation.businessId))return;const current=this.businesses.get(mutation.businessId);if(!current)return;current.roomId=mutation.roomId;if(typeof mutation.open==='boolean')current.open=mutation.open;if(mutation.status)current.status=mutation.status;this.saveBusinessState();this.roomEvent(mutation.roomId,mutation.text);return;}
   case 'job_event':if(this.validRoom(mutation.roomId)&&VALID_JOBS.has(mutation.jobId))this.roomEvent(mutation.roomId,mutation.text);return;
   case 'vehicle_event':{if(!this.validRoom(mutation.roomId)||!VALID_VEHICLES.has(mutation.vehicleId))return;const vehicle=this.vehicles.get(mutation.vehicleId);if(!vehicle)return;if(!vehicle.ownerCharacterId&&vehicle.status!=='traveling'){vehicle.roomId=mutation.roomId;this.persistVehicle(vehicle);this.broadcastRoomViews()}this.roomEvent(mutation.roomId,mutation.text);return;}
   case 'housing_event':if(this.validRoom(mutation.roomId)&&VALID_PROPERTIES.has(mutation.propertyId))this.roomEvent(mutation.roomId,mutation.text);return;
   case 'police_dispatch':{if(!this.validRoom(mutation.roomId)||!Number.isInteger(mutation.priority)||mutation.priority<1||mutation.priority>5)return;const incident=[...this.incidents].reverse().find(i=>i.roomId===mutation.roomId&&(i.status==='reported'||i.status==='witnessed'));if(incident){incident.status='responding';incident.updatedAt=Date.now();this.persistence.saveIncident(incident)}this.roomEvent(mutation.roomId,mutation.text);return;}
   case 'economy_event':this.globalEvent(mutation.text);return;
  }
 }
}

const app=express();app.get('/health',(_q,r)=>r.json({ok:true,service:'port-mercy',version:GAME_VERSION}));const server=http.createServer(app);const gameServer=new Server({transport:new WebSocketTransport({server})});gameServer.define('world',WorldRoom);const port=Number(process.env.PORT||2567);gameServer.listen(port);console.log(`Port Mercy server listening on ${port}`);
