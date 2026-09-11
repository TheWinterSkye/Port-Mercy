import http from 'node:http';
import express from 'express';
import { randomUUID } from 'node:crypto';
import { Server, Room, Client } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { Schema, MapSchema, defineTypes } from '@colyseus/schema';
import { HeartbeatService, type HeartbeatResult, type WorldMutation, type WorldSnapshot } from './heartbeat.js';
import { ResourceRuntime, resolveResourcesDirectory } from './runtime.js';

type RoomId = 'southward.gas.forecourt'|'southward.diner'|'southward.alley'|'southward.apartment.lobby';
type ChatScope = 'room'|'global';

type ChatPayload = { scope?:ChatScope; text?:string };
type ItemPayload = { itemId?:string };
type InventoryOpenPayload = { inventoryType?:string; inventoryId?:string; compartment?:string };
type VehicleStoragePayload = { vehicleId?:string; compartment?:'trunk'|'glovebox' };

const EXITS:Record<RoomId,Record<string,RoomId>> = {
  'southward.gas.forecourt': { west:'southward.diner', east:'southward.alley', inside:'southward.apartment.lobby' },
  'southward.diner': { east:'southward.gas.forecourt' },
  'southward.alley': { west:'southward.gas.forecourt' },
  'southward.apartment.lobby': { outside:'southward.gas.forecourt' }
};

const ROOM_NAMES:Record<RoomId,{name:string;district:string}> = {
  'southward.gas.forecourt': {name:'Mercy Fuel & Mart',district:'South Ward'},
  'southward.diner': {name:"Rita's Diner",district:'South Ward'},
  'southward.alley': {name:'Mercy Service Alley',district:'South Ward'},
  'southward.apartment.lobby': {name:'Marrow Apartments',district:'South Ward'},
};

const VALID_ROOM_IDS = new Set<RoomId>(Object.keys(ROOM_NAMES) as RoomId[]);
const VALID_NPCS = new Set(['rita.vale','mercy.fuel.clerk','marrow.tenant']);
const VALID_BUSINESSES = new Set(['mercy.fuel','ritas.diner']);
const VALID_JOBS = new Set(['mercy.fuel.stock','ritas.dishwasher']);
const VALID_VEHICLES = new Set(['sedan.blue']);
const VALID_PROPERTIES = new Set(['marrow.apartments','marrow.3b']);

class ItemState extends Schema {
  id=''; templateId=''; name=''; kind='misc'; quantity=1; weight=0; description=''; usable=false; droppable=true; metadataJson='{}';
}
defineTypes(ItemState,{id:'string',templateId:'string',name:'string',kind:'string',quantity:'number',weight:'number',description:'string',usable:'boolean',droppable:'boolean',metadataJson:'string'});

class Player extends Schema {
  name='Player'; roomId:RoomId='southward.gas.forecourt'; cash=83; bank=640; health=100; stress=18; job='Unemployed'; jobId='unemployed'; onDuty=false;
  legalName='Player'; dateOfBirth='1992-08-17'; homeAddress='18 Marrow Avenue, Apt 3B'; licenseNumber='PM-0000-0000'; skillsJson='{"driving":18,"labor":12,"streetwise":8}';
  phoneNumber='(346) 555-0100';
  inventory=new MapSchema<ItemState>();
}
defineTypes(Player,{name:'string',roomId:'string',cash:'number',bank:'number',health:'number',stress:'number',job:'string',jobId:'string',onDuty:'boolean',legalName:'string',dateOfBirth:'string',homeAddress:'string',licenseNumber:'string',skillsJson:'string',phoneNumber:'string',inventory:{map:ItemState}});

class WorldState extends Schema {
  players=new MapSchema<Player>();
  heartbeatMode='offline';
  heartbeatLastAt=0;
  heartbeatSequence=0;
  heartbeatSummary='World heartbeat has not run yet.';
  resourceCount=0;
}
defineTypes(WorldState,{players:{map:Player},heartbeatMode:'string',heartbeatLastAt:'number',heartbeatSequence:'number',heartbeatSummary:'string',resourceCount:'number'});

type ChatMessage = { id:string; scope:ChatScope; from:string; text:string; roomId:RoomId; sentAt:number };
type Incident = {id:string;type:string;roomId:RoomId;status:string;summary:string;createdAt:number};
type VehicleRecord = {id:string;label:string;roomId:RoomId;status:string;locked:boolean;ownerId:string|null;registration:string;fuel:number;condition:number};

type InventoryWireItem = {id:string;templateId:string;name:string;kind:string;quantity:number;weight:number;description:string;usable:boolean;droppable:boolean;metadata:Record<string,unknown>};

function makeItem(templateId:string,name:string,kind:string,description:string,usable=false,droppable=true,weight=.1,metadata:Record<string,unknown>={}){
  const item=new ItemState();
  item.id=randomUUID(); item.templateId=templateId; item.name=name; item.kind=kind; item.description=description;
  item.usable=usable; item.droppable=droppable; item.weight=weight; item.metadataJson=JSON.stringify(metadata);
  return item;
}

function makeDriversLicense(p:Player){
  return makeItem(
    'document.drivers_license',
    'Port Mercy driver license',
    'document',
    'A state-issued driver license. The portrait slot is ready for the character image when one exists.',
    true,
    false,
    .01,
    {
      documentType:'drivers_license',
      legalName:p.legalName,
      dateOfBirth:p.dateOfBirth,
      address:p.homeAddress,
      licenseNumber:p.licenseNumber,
      licenseClass:'C',
      expires:'2030-08-17',
      sexMarker:'F',
      height:'5 ft 7 in',
      eyes:'Brown',
      portraitUrl:'',
      portraitStatus:'pending',
    },
  );
}

class WorldRoom extends Room<WorldState> {
  maxClients=128;
  private chatHistory:ChatMessage[]=[];
  private recentActivity = new Map<RoomId,string[]>();
  private incidents:Incident[]=[];
  private heartbeat!: HeartbeatService;
  private runtime!: ResourceRuntime;
  private secondaryInventories = new Map<string,Map<string,ItemState>>();
  private vehicles = new Map<string,VehicleRecord>([
    ['sedan.blue',{id:'sedan.blue',label:'faded blue sedan',roomId:'southward.gas.forecourt',status:'parked',locked:false,ownerId:null,registration:'PM-4817',fuel:62,condition:84}],
  ]);

  async onCreate(){
    this.setState(new WorldState());
    for(const roomId of VALID_ROOM_IDS) this.recentActivity.set(roomId,[]);

    this.runtime = new ResourceRuntime(this.buildRuntimeHost(), resolveResourcesDirectory());
    const resources = await this.runtime.loadAll();
    this.state.resourceCount = resources.length;
    console.log(`[resources] loaded ${resources.length}: ${resources.join(', ')}`);

    this.onMessage('action',(client,payload:{name?:string;payload?:unknown})=>void this.runClientAction(client,payload?.name,payload?.payload));
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

    this.heartbeat = new HeartbeatService(
      sequence => this.makeHeartbeatSnapshot(sequence),
      result => this.applyHeartbeat(result),
      (mode,lastAt,sequence,summary) => {
        this.state.heartbeatMode=mode;
        this.state.heartbeatLastAt=lastAt;
        this.state.heartbeatSequence=sequence;
        this.state.heartbeatSummary=summary;
        this.broadcast('heartbeat_status',{mode,lastAt,sequence,summary});
      },
    );
    this.heartbeat.start();
  }

  onJoin(client:Client){
    const p=new Player();
    p.name=`Resident-${client.sessionId.slice(0,4)}`;
    p.legalName=p.name;
    p.licenseNumber=`PM-${client.sessionId.slice(0,4).toUpperCase()}-${client.sessionId.slice(-4).toUpperCase()}`;
    p.phoneNumber=`(346) 555-${String(100 + (this.state.players.size % 100)).padStart(4,'0')}`;
    for(const item of [
      makeItem('phone.basic','Cheap phone','phone','A scratched prepaid phone with a weak battery.',true,false,.2),
      makeItem('key.apartment','Apartment key','key','A brass key stamped 3B.',false,false,.05),
      makeDriversLicense(p),
      makeItem('water.bottle','Bottled water','consumable','Still cold from a corner-store refrigerator.',true,true,.5)
    ]) p.inventory.set(item.id,item);
    this.state.players.set(client.sessionId,p);

    const sedan=this.vehicles.get('sedan.blue');
    if(sedan && !sedan.ownerId){
      sedan.ownerId=client.sessionId;
      this.ensureSecondaryInventory('vehicle:sedan.blue:trunk',[
        makeItem('tool.jumper_cables','Jumper cables','tool','A cheap set of red and black jumper cables.',false,true,2.2),
        makeItem('cloth.shop_rag','Shop rag','misc','An oily cotton rag that smells faintly of gasoline.',false,true,.1),
      ]);
      this.ensureSecondaryInventory('vehicle:sedan.blue:glovebox',[
        makeItem('document.registration','Vehicle registration','document','Registration paperwork for the faded blue sedan.',true,false,.02,{vehicleId:'sedan.blue'}),
      ]);
    }

    client.send('chat_history',this.chatHistory.slice(-30));
    client.send('heartbeat_status',{mode:this.state.heartbeatMode,lastAt:this.state.heartbeatLastAt,sequence:this.state.heartbeatSequence,summary:this.state.heartbeatSummary});
    client.send('resource_status',{resources:this.runtime.listResources()});
    client.send('event',{text:'Connected to Port Mercy.'});
    void this.runtime.emitSystem('player:joined',{name:p.name},{actorId:client.sessionId,roomId:p.roomId,ai:'never'});
  }

  onLeave(client:Client){
    const p=this.state.players.get(client.sessionId);
    if(p) void this.runtime.emitSystem('player:left',{name:p.name},{actorId:client.sessionId,roomId:p.roomId,ai:'never'});
    this.state.players.delete(client.sessionId);
  }

  async onDispose(){ await this.heartbeat?.close(); }

  private playerById(id?:string){ return id ? this.state.players.get(id) : undefined; }
  private player(client:Client){ return this.state.players.get(client.sessionId); }

  private async runClientAction(client:Client,name:unknown,payload:unknown){
    const p=this.player(client); if(!p)return;
    if(typeof name!=='string'||!this.runtime.isClientAction(name)){client.send('event',{text:'That action is not available to the client.'});return;}
    const result=await this.runtime.executeClient(name,{actorId:client.sessionId,roomId:p.roomId,payload});
    if(result.ok===false)client.send('event',{text:result.reason});
    else client.send('action_result',{name,correlationId:result.correlationId,ok:true});
  }

  private async runAction(client:Client,name:string,payload:unknown){
    const p=this.player(client);
    if(!p)return;
    const result=await this.runtime.execute(name,{actorId:client.sessionId,roomId:p.roomId,source:'client',payload});
    if(result.ok===false) client.send('event',{text:result.reason});
  }

  private itemMetadata(item:ItemState){
    try{return JSON.parse(item.metadataJson||'{}') as Record<string,unknown>}catch{return {}}
  }

  private itemWire(item:ItemState):InventoryWireItem{
    return {id:item.id,templateId:item.templateId,name:item.name,kind:item.kind,quantity:item.quantity,weight:item.weight,description:item.description,usable:item.usable,droppable:item.droppable,metadata:this.itemMetadata(item)};
  }

  private ensureSecondaryInventory(id:string,seed:ItemState[]=[]){
    let inventory=this.secondaryInventories.get(id);
    if(!inventory){inventory=new Map();this.secondaryInventories.set(id,inventory);for(const item of seed)inventory.set(item.id,item)}
    return inventory;
  }

  private resolveInventory(actorId:string|undefined,spec:{type?:string;id?:string;compartment?:string}){
    const player=this.playerById(actorId); if(!player)return null;
    const type=spec.type||'player';
    if(type==='player'){
      return {id:`player:${actorId}`,type:'player',label:`${player.name}'s inventory`,ownerId:actorId,items:(Array.from(player.inventory.values()) as ItemState[]).map(i=>this.itemWire(i))};
    }
    if(type==='vehicle_trunk'||type==='vehicle_glovebox'){
      const vehicle=this.vehicles.get(String(spec.id||'')); if(!vehicle)return null;
      const compartment=type==='vehicle_glovebox'?'glovebox':'trunk';
      const id=`vehicle:${vehicle.id}:${compartment}`;
      const items=[...this.ensureSecondaryInventory(id).values()].map(i=>this.itemWire(i));
      return {id,type,label:`${vehicle.label} — ${compartment}`,vehicleId:vehicle.id,compartment,items};
    }
    return null;
  }

  private resolveInventoryByCanonicalId(actorId:string|undefined,id:string){
    if(id===`player:${actorId}`)return this.resolveInventory(actorId,{type:'player',id:actorId});
    const match=/^vehicle:(.+):(trunk|glovebox)$/.exec(id);
    if(match)return this.resolveInventory(actorId,{type:`vehicle_${match[2]}`,id:match[1],compartment:match[2]});
    return null;
  }

  private moveInventoryItem(actorId:string|undefined,payload:any){
    const player=this.playerById(actorId); if(!player)return null;
    const itemId=String(payload?.itemId||'');
    const fromId=String(payload?.fromInventory||`player:${actorId}`);
    const toId=String(payload?.toInventory||'');
    if(!toId)return null;

    const playerId=`player:${actorId}`;
    let item:ItemState|undefined;
    if(fromId===playerId){item=player.inventory.get(itemId);if(item)player.inventory.delete(itemId)}
    else {const from=this.secondaryInventories.get(fromId);item=from?.get(itemId);if(item)from?.delete(itemId)}
    if(!item)return null;

    if(toId===playerId)player.inventory.set(item.id,item);
    else this.ensureSecondaryInventory(toId).set(item.id,item);
    return {itemId:item.id,templateId:item.templateId,fromInventory:fromId,toInventory:toId,count:item.quantity};
  }

  private remember(roomId:RoomId,text:string){
    const current=this.recentActivity.get(roomId)??[];
    current.push(text);
    if(current.length>40)current.shift();
    this.recentActivity.set(roomId,current);
  }

  private roomEvent(roomId:RoomId,text:string){
    this.remember(roomId,text);
    for(const client of this.clients){
      if(this.player(client)?.roomId===roomId) client.send('event',{text});
    }
  }

  private globalEvent(text:string){ for(const client of this.clients) client.send('world_event',{text}); }

  private sendChat(actorId:string|undefined,scope:ChatScope,text:string){
    const p=this.playerById(actorId); if(!p)throw new Error('Player is unavailable.');
    const message:ChatMessage={id:randomUUID(),scope,from:p.name,text,roomId:p.roomId,sentAt:Date.now()};
    this.chatHistory.push(message); if(this.chatHistory.length>100)this.chatHistory.shift();
    for(const other of this.clients){
      const op=this.state.players.get(other.sessionId);
      if(scope==='global'||op?.roomId===p.roomId) other.send('chat',message);
    }
    return message;
  }

  private buildRuntimeHost(){
    return {
      getPlayer:(actorId?:string)=>this.playerById(actorId),
      findPlayerByPhone:(phoneNumber?:string)=>{
        if(!phoneNumber)return null;
        const normalized=String(phoneNumber).replace(/\D/g,'');
        let found:{id:string;player:Player}|null=null;
        this.state.players.forEach((player,id)=>{
          if(!found&&player.phoneNumber.replace(/\D/g,'')===normalized)found={id,player};
        });
        return found;
      },
      listOnlinePlayers:()=>{
        const rows:Array<{id:string;name:string;phoneNumber:string;roomId:RoomId}>=[];
        this.state.players.forEach((player,id)=>rows.push({id,name:player.name,phoneNumber:player.phoneNumber,roomId:player.roomId}));
        return rows;
      },
      send:(actorId:string|undefined,event:string,payload:unknown)=>{if(actorId)this.clients.find(c=>c.sessionId===actorId)?.send(event,payload)},
      roomEvent:(roomId:RoomId,text:string)=>this.roomEvent(roomId,text),
      remember:(roomId:RoomId,text:string)=>this.remember(roomId,text),
      sendChat:(actorId:string|undefined,scope:ChatScope,text:string)=>this.sendChat(actorId,scope,text),
      movePlayer:(actorId:string|undefined,direction:string)=>{
        const p=this.playerById(actorId);if(!p)return null;
        const dir=direction.toLowerCase();const from=p.roomId;const next=EXITS[from]?.[dir];if(!next)return null;p.roomId=next;return {playerId:actorId,name:p.name,from,to:next,direction:dir};
      },
      setPlayerRoom:(actorId:string|undefined,roomId:string)=>{
        const p=this.playerById(actorId);if(!p||!this.validRoom(roomId))return false;p.roomId=roomId;return true;
      },
      createItem:(...args:Parameters<typeof makeItem>)=>makeItem(...args),
      addPlayerItem:(actorId:string|undefined,item:ItemState)=>{const p=this.playerById(actorId);if(!p)return false;p.inventory.set(item.id,item);return true},
      getPlayerItem:(actorId:string|undefined,itemId?:string)=>{const p=this.playerById(actorId);return p&&itemId?p.inventory.get(itemId):undefined},
      removePlayerItem:(actorId:string|undefined,itemId:string)=>this.playerById(actorId)?.inventory.delete(itemId)??false,
      itemMetadata:(item:ItemState)=>this.itemMetadata(item),
      resolveInventory:(actorId:string|undefined,spec:any)=>this.resolveInventory(actorId,spec),
      resolveInventoryByCanonicalId:(actorId:string|undefined,id:string)=>this.resolveInventoryByCanonicalId(actorId,id),
      moveInventoryItem:(actorId:string|undefined,payload:any)=>this.moveInventoryItem(actorId,payload),
      adjustStress:(actorId:string|undefined,delta:number)=>{const p=this.playerById(actorId);if(!p)return null;p.stress=Math.max(0,Math.min(100,p.stress+delta));return p.stress},
      adjustCash:(actorId:string|undefined,delta:number)=>{const p=this.playerById(actorId);if(!p)return null;p.cash=Math.max(0,p.cash+delta);return p.cash},
      adjustBank:(actorId:string|undefined,delta:number)=>{const p=this.playerById(actorId);if(!p)return null;p.bank=Math.max(0,p.bank+delta);return p.bank},
      getBank:(actorId:string|undefined)=>this.playerById(actorId)?.bank??null,
      getSkill:(actorId:string|undefined,skill:string)=>{const p=this.playerById(actorId);if(!p)return 0;try{return Number(JSON.parse(p.skillsJson||'{}')[skill]||0)}catch{return 0}},
      setPlayerJob:(actorId:string|undefined,jobId:string,label:string,onDuty:boolean)=>{const p=this.playerById(actorId);if(!p)return false;p.jobId=jobId;p.job=label;p.onDuty=onDuty;return true},
      setOnDuty:(actorId:string|undefined,onDuty:boolean)=>{const p=this.playerById(actorId);if(!p)return false;p.onDuty=onDuty;return true},
      addIncident:(data:Omit<Incident,'id'|'createdAt'>)=>{const incident:Incident={id:randomUUID(),createdAt:Date.now(),...data};this.incidents.push(incident);if(this.incidents.length>100)this.incidents.shift();return incident},
      getVehicle:(vehicleId?:string)=>vehicleId?this.vehicles.get(vehicleId):undefined,
      setVehicleRoom:(vehicleId:string|undefined,roomId:string)=>{const v=vehicleId?this.vehicles.get(vehicleId):undefined;if(!v||!this.validRoom(roomId))return false;v.roomId=roomId;return true},
      setVehicleLock:(actorId:string|undefined,vehicleId?:string,locked=false)=>{const v=vehicleId?this.vehicles.get(vehicleId):undefined;if(!v||v.ownerId!==actorId)return null;v.locked=locked;return {...v}},
      vehicleSnapshot:()=>[...this.vehicles.values()].map(v=>({id:v.id,label:v.label,roomId:v.roomId,status:v.status,locked:v.locked,registration:v.registration,fuel:v.fuel,condition:v.condition})),
      roomSnapshot:()=>[...(Object.keys(ROOM_NAMES) as RoomId[])].map(id=>({id,...ROOM_NAMES[id],recentActivity:[...(this.recentActivity.get(id)??[])].slice(-10)})),
    };
  }

  private makeHeartbeatSnapshot(sequence:number):WorldSnapshot{
    const players=[] as WorldSnapshot['players'];
    this.state.players.forEach((p,id)=>players.push({
      id,
      name:p.name,
      roomId:p.roomId,
      job:p.job,
      cash:p.cash,
      health:p.health,
      stress:p.stress,
      inventory:(Array.from(p.inventory.values()) as ItemState[]).map(i=>i.templateId),
      skills:Object.entries(JSON.parse(p.skillsJson||'{}')).map(([skill,value])=>({id:skill,value:Number(value)||0})),
    }));

    const rooms=(Object.keys(ROOM_NAMES) as RoomId[]).map(roomId=>({
      id:roomId,
      name:ROOM_NAMES[roomId].name,
      district:ROOM_NAMES[roomId].district,
      occupants:players.filter(p=>p.roomId===roomId).map(p=>p.name),
      recentActivity:[...(this.recentActivity.get(roomId)??[])].slice(-10),
    }));

    const resourceState=this.runtime.heartbeatState();
    const jobRegistry=(resourceState['pm-jobs:registry'] as Array<{id:string;label:string;roomId:string;status:string;demand:string}>|undefined)??[];
    const recentEvents=this.runtime.journal.since(this.state.heartbeatLastAt,false).slice(-100).map(event=>({
      name:event.name,
      at:event.at,
      resource:event.resource,
      actorId:event.actorId??null,
      roomId:event.roomId??null,
      detail:event.ai==='full'?event.payload:undefined,
      summary:event.ai==='summary'?event.payload:undefined,
    }));

    return {
      city:'Port Mercy',
      heartbeatNumber:sequence,
      capturedAt:new Date().toISOString(),
      worldClock:new Date().toISOString(),
      weather:'Cold coastal rain, wet pavement, low cloud and light harbor wind.',
      rooms,
      players,
      npcs:[
        {id:'rita.vale',name:'Rita Vale',roomId:'southward.diner',role:'diner owner',motivation:'Keep the diner solvent and look after regulars without becoming their rescuer.'},
        {id:'mercy.fuel.clerk',name:'Night clerk',roomId:'southward.gas.forecourt',role:'night cashier',motivation:'Finish the shift safely, avoid theft, and keep the pumps working.'},
        {id:'marrow.tenant',name:'Tired tenant',roomId:'southward.apartment.lobby',role:'resident',motivation:'Get upstairs, avoid trouble, and make rent.'},
      ],
      businesses:[
        {id:'mercy.fuel',name:'Mercy Fuel & Mart',roomId:'southward.gas.forecourt',open:true,pressure:'thin overnight staffing and aging pumps'},
        {id:'ritas.diner',name:"Rita's Diner",roomId:'southward.diner',open:true,pressure:'slow graveyard trade and food-cost pressure'},
      ],
      vehicles:[...this.vehicles.values()].map(v=>({id:v.id,label:v.label,roomId:v.roomId,status:`${v.status}; ${v.locked?'locked':'unlocked'}`})),
      housing:[
        {id:'marrow.apartments',label:'Marrow Apartments',roomId:'southward.apartment.lobby',status:'occupied; neglected common areas'},
        {id:'marrow.3b',label:'Apartment 3B',roomId:'southward.apartment.lobby',status:'player residence; upstairs and not yet modeled as a room'},
      ],
      police:{activeCalls:this.incidents.filter(i=>i.status==='reported').map(i=>({roomId:i.roomId,reason:i.summary,priority:3}))},
      jobMarket:jobRegistry.map(job=>({id:job.id,name:job.label,roomId:job.roomId,status:job.status,demand:job.demand})),
      incidents:this.incidents.map(i=>({...i})),
      economy:{notes:['South Ward is cash-poor, rents are late, and overnight businesses run lean.']},
      recentEvents,
      resourceState,
    };
  }

  private validRoom(id:unknown):id is RoomId{return typeof id==='string'&&VALID_ROOM_IDS.has(id as RoomId)}

  private applyHeartbeat(result:HeartbeatResult){
    for(const mutation of result.mutations) this.applyMutation(mutation);
    console.log(`[heartbeat:${result.mode}] ${result.summary}`);
  }

  private applyMutation(mutation:WorldMutation){
    switch(mutation.type){
      case 'room_event':
        if(this.validRoom(mutation.roomId))this.roomEvent(mutation.roomId,mutation.text);
        return;
      case 'npc_intent':
        if(this.validRoom(mutation.roomId)&&VALID_NPCS.has(mutation.npcId))this.roomEvent(mutation.roomId,mutation.text);
        return;
      case 'business_event':
        if(this.validRoom(mutation.roomId)&&VALID_BUSINESSES.has(mutation.businessId))this.roomEvent(mutation.roomId,mutation.text);
        return;
      case 'job_event':
        if(this.validRoom(mutation.roomId)&&VALID_JOBS.has(mutation.jobId))this.roomEvent(mutation.roomId,mutation.text);
        return;
      case 'vehicle_event':
        if(this.validRoom(mutation.roomId)&&VALID_VEHICLES.has(mutation.vehicleId))this.roomEvent(mutation.roomId,mutation.text);
        return;
      case 'housing_event':
        if(this.validRoom(mutation.roomId)&&VALID_PROPERTIES.has(mutation.propertyId))this.roomEvent(mutation.roomId,mutation.text);
        return;
      case 'police_dispatch':
        if(this.validRoom(mutation.roomId)&&Number.isFinite(mutation.priority)&&mutation.priority>=1&&mutation.priority<=5)this.roomEvent(mutation.roomId,mutation.text);
        return;
      case 'economy_event':
        this.globalEvent(mutation.text);
        return;
    }
  }
}

const app=express();
app.get('/health',(_q,r)=>r.json({ok:true,service:'port-mercy',version:'0.6.0'}));
const server=http.createServer(app);
const gameServer=new Server({transport:new WebSocketTransport({server})});
gameServer.define('world',WorldRoom);
const port=Number(process.env.PORT||2567);
gameServer.listen(port);
console.log(`Port Mercy server listening on ${port}`);
