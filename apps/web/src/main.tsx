import React,{FormEvent,useEffect,useMemo,useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {Application,Container,Graphics,Text} from 'pixi.js';
import {Client as ColyseusClient,getStateCallbacks,type Room as ColyseusRoom} from 'colyseus.js';
import './styles.css';

type RoomId='southward.gas.forecourt'|'southward.mercyfuel.interior'|'southward.diner'|'southward.alley'|'southward.apartment.lobby';
type Item={id:string;templateId:string;name:string;kind:string;quantity:number;weight:number;description:string;usable:boolean;droppable:boolean;metadata:Record<string,any>};
type InventoryView={id:string;type:string;label:string;items:Item[]};
type ChatMsg={id:string;scope:'room'|'global';from:string;text:string;roomId:RoomId;sentAt:number};
type WorldObject={id:string;label:string;kind:'vehicle'|'npc'|'prop';x:number;y:number};
type RoomEnvironment='outdoor'|'indoor';
type RoomDef={id:RoomId;name:string;district:string;environment:RoomEnvironment;weatherZone:string;desc:string;exits:Record<string,RoomId>;objects:WorldObject[]};

type PlayerView={name:string;cash:number;bank:number;health:number;stress:number;job:string;roomId:RoomId;inventory:Item[]};
type PhoneState={owner?:{name:string;phoneNumber:string};apps?:Array<{id:string;label:string;action?:string}>;contacts?:Array<{name:string;phoneNumber:string;online?:boolean}>;messages?:Array<any>;activeCall?:any};
type TravelState={status:string;origin:RoomId;destination:RoomId;startedAt:number;arriveAt:number;vehicleId:string;route?:string;progress?:number;remainingMs?:number;pauseReason?:string;seconds?:number};
type WeatherKind='clear'|'rain'|'fog'|'snow'|'storm';
type WeatherState={zone:string;type:WeatherKind;label:string;detail:string;intensity:number;seed:number;startedAt:number;nextAt:number};

const rooms:Record<RoomId,RoomDef>={
 'southward.gas.forecourt':{id:'southward.gas.forecourt',name:'Mercy Fuel & Mart',district:'South Ward',environment:'outdoor',weatherZone:'southward',desc:'The forecourt sits between Harbor Avenue and the waterfront. Canopy lights wash over wet pumps and pavement while the store windows glow behind them.',exits:{west:'southward.diner',east:'southward.alley',inside:'southward.mercyfuel.interior'},objects:[{id:'car1',label:'faded blue sedan',kind:'vehicle',x:.73,y:.72},{id:'pump1',label:'fuel pumps',kind:'prop',x:.46,y:.68}]},
 'southward.mercyfuel.interior':{id:'southward.mercyfuel.interior',name:'Mercy Fuel · Store Interior',district:'South Ward',environment:'indoor',weatherZone:'southward',desc:'Warm fluorescents hum over the coolers, coffee station and a glossy tile floor tracked wet near the entrance. Harbor lights shimmer through the front glass.',exits:{outside:'southward.gas.forecourt'},objects:[{id:'npc1',label:'Maya Torres',kind:'npc',x:.76,y:.58},{id:'coffee1',label:'coffee station',kind:'prop',x:.32,y:.57},{id:'coolers1',label:'cold drink coolers',kind:'prop',x:.18,y:.48}]},
 'southward.diner':{id:'southward.diner',name:"Rita's Diner",district:'South Ward',environment:'indoor',weatherZone:'southward',desc:'A narrow twenty-four-hour diner with split vinyl booths, strong coffee and rain streaking the windows toward Harbor Avenue.',exits:{east:'southward.gas.forecourt'},objects:[{id:'npc2',label:'Rita Vale',kind:'npc',x:.66,y:.56}]},
 'southward.alley':{id:'southward.alley',name:'Mercy Service Alley',district:'South Ward',environment:'outdoor',weatherZone:'southward',desc:'Wet brick walls squeeze around dumpsters, utility pipes and a fire escape. A security lamp buzzes overhead beside the harbor wind.',exits:{west:'southward.gas.forecourt'},objects:[{id:'prop1',label:'padlocked dumpster',kind:'prop',x:.58,y:.68}]},
 'southward.apartment.lobby':{id:'southward.apartment.lobby',name:'Marrow Apartments',district:'South Ward',environment:'indoor',weatherZone:'southward',desc:'Peeling green paint, dented brass mailboxes and an elevator that smells faintly of hot wiring. Apartment 3B is upstairs. The lobby camera over the door has not worked in years.',exits:{},objects:[{id:'npc3',label:'tired tenant',kind:'npc',x:.61,y:.63}]}
};

const starterItems:Item[]=[
 {id:'local-phone',templateId:'phone.basic',name:'Cheap phone',kind:'phone',quantity:1,weight:.2,description:'A scratched prepaid phone with a weak battery.',usable:true,droppable:false,metadata:{}},
 {id:'local-key',templateId:'key.apartment',name:'Apartment key',kind:'key',quantity:1,weight:.05,description:'A brass key stamped 3B.',usable:false,droppable:false,metadata:{}},
 {id:'local-license',templateId:'document.drivers_license',name:'Port Mercy driver license',kind:'document',quantity:1,weight:.01,description:'A state-issued driver license. The portrait can be replaced by the character image when one exists.',usable:true,droppable:false,metadata:{documentType:'drivers_license',legalName:'Winter',dateOfBirth:'1992-08-17',address:'18 Marrow Avenue, Apt 3B',licenseNumber:'PM-WNTR-3B17',licenseClass:'C',expires:'2030-08-17',sexMarker:'F',height:'5 ft 7 in',eyes:'Brown',portraitUrl:'',portraitStatus:'pending'}},
 {id:'local-water',templateId:'water.bottle',name:'Bottled water',kind:'consumable',quantity:1,weight:.5,description:'Still cold from a corner-store refrigerator.',usable:true,droppable:true,metadata:{}}
];

function drawScene(app:Application,room:RoomDef){
 const w=1100,h=650; const g=new Graphics();
 g.rect(0,0,w,h).fill(0x0b1119);
 if(room.id==='southward.gas.forecourt'){
   g.rect(0,390,w,260).fill(0x17191c);g.rect(70,88,520,34).fill(0xd8d7c7);g.rect(85,122,18,282).fill(0xb9b8ab);g.rect(555,122,18,282).fill(0xb9b8ab);
   g.rect(118,160,330,230).fill(0x222a31);g.rect(142,190,74,200).fill(0x6e242a);g.rect(245,205,168,78).fill(0x091017);
   g.rect(675,225,54,145).fill(0x2c333a);g.rect(790,225,54,145).fill(0x2c333a);g.rect(687,244,30,28).fill(0xb54d43);g.rect(802,244,30,28).fill(0xb54d43);
   for(let i=0;i<9;i++)g.rect(i*145,470+(i%2)*2,95,5).fill(0x5e5b50);
 } else if(room.id==='southward.diner'){
   g.rect(0,405,w,245).fill(0x241d1c);g.rect(72,88,956,317).fill(0x3c2725);g.rect(100,116,900,255).fill(0xead8bb);
   for(let i=0;i<5;i++){g.roundRect(125+i*170,252,124,78,16).fill(0x773838);g.rect(145+i*170,330,84,45).fill(0x402727)}
   g.rect(120,142,245,68).fill(0x111822);g.rect(403,142,245,68).fill(0x111822);g.rect(686,142,245,68).fill(0x111822);
   g.rect(765,336,180,32).fill(0xb8aea0);g.rect(765,368,180,22).fill(0x514745);
 } else if(room.id==='southward.alley'){
   g.rect(0,420,w,230).fill(0x17191b);g.rect(0,0,320,430).fill(0x302a29);g.rect(780,0,320,430).fill(0x292626);g.rect(320,0,460,430).fill(0x10151b);
   for(let y=55;y<400;y+=44){for(let x=18;x<300;x+=92)g.rect(x,y,70,22).fill(0x423937)}
   g.rect(815,130,210,18).fill(0x4a4744);g.rect(838,148,18,212).fill(0x4a4744);g.rect(980,148,18,212).fill(0x4a4744);
   g.roundRect(505,330,180,100,8).fill(0x34383a);g.rect(520,316,150,20).fill(0x43484b);
 } else {
   g.rect(0,420,w,230).fill(0x2c2724);g.rect(0,0,w,420).fill(0x31413a);g.rect(80,70,260,320).fill(0x27322e);g.rect(110,110,205,240).fill(0x4b4036);
   for(let r=0;r<5;r++)for(let c=0;c<4;c++)g.rect(485+c*75,95+r*52,58,38).fill(0x81735d);
   g.rect(846,92,145,298).fill(0x292f31);g.rect(865,115,107,251).fill(0x3b4245);g.circle(957,245,5).fill(0xc6b26f);
 }
 app.stage.addChild(g);
 for(const o of room.objects){
   const c=new Container();const shape=new Graphics();
   if(o.kind==='vehicle'){shape.roundRect(-82,-25,164,52,14).fill(0x355064);shape.roundRect(-38,-52,80,34,10).fill(0x253746);shape.circle(-52,30,16).fill(0x050607);shape.circle(52,30,16).fill(0x050607)}
   else if(o.kind==='npc'){shape.circle(0,-44,17).fill(0xc7a287);shape.roundRect(-19,-27,38,72,10).fill(0x465260)}
   else{shape.roundRect(-48,-28,96,56,7).fill(0x41474a)}
   const label=new Text({text:o.label,style:{fill:0xe4e8ec,fontSize:13,fontFamily:'system-ui'}});label.anchor.set(.5);label.y=53;c.addChild(shape,label);c.x=o.x*app.renderer.width;c.y=o.y*app.renderer.height;app.stage.addChild(c);
 }
 if(room.environment==='outdoor'){const rain=new Graphics();for(let i=0;i<85;i++){const x=Math.random()*w,y=Math.random()*h;rain.moveTo(x,y).lineTo(x-5,y+17).stroke({width:1,color:0x86a9c2,alpha:.17})}app.stage.addChild(rain);}
}

function WeatherOverlay({room,weather}:{room:RoomDef;weather:WeatherState}){
 if(room.environment!=='outdoor')return null;
 const rainCount=weather.type==='storm'?72:weather.type==='rain'?54:0;
 const snowCount=weather.type==='snow'?38:0;
 const rain=Array.from({length:rainCount},(_,i)=>({left:(i*37+weather.seed*17)%104-2,delay:-((i*23)%100)/17,duration:.72+((i*7)%9)/18,opacity:.12+(i%8)*.045}));
 const snow=Array.from({length:snowCount},(_,i)=>({left:(i*29+weather.seed*13)%100,delay:-((i*19)%120)/12,duration:6+((i*5)%7),scale:.65+(i%5)*.16}));
 return <><div className={`weatherLayer ${weather.type}`}><div className="weatherTint"/><div className="weatherGlow"/>{(weather.type==='fog'||weather.type==='snow')&&Array.from({length:4},(_,i)=><span className="fogBand" key={`f-${i}`} style={{top:`${14+i*18}%`,animationDuration:`${18+i*4}s`,animationDelay:`-${i*2.5}s`}}/>)}{rain.map((r,i)=><span className="rainDrop" key={`r-${i}`} style={{left:`${r.left}%`,animationDelay:`${r.delay}s`,animationDuration:`${r.duration}s`,opacity:r.opacity}}/>)}{snow.map((f,i)=><span className="snowFlake" key={`s-${i}`} style={{left:`${f.left}%`,animationDelay:`${f.delay}s`,animationDuration:`${f.duration}s`,transform:`scale(${f.scale})`}}/>)}{weather.type==='storm'&&<div className="weatherFlash"/>}</div><div className="weatherHud"><span className="weatherDot"/><div><b>South Ward Weather</b><span>{weather.label}</span><small>{weather.detail}</small></div></div></>;
}

function Scene({room,weather}:{room:RoomDef;weather:WeatherState}){
 const host=useRef<HTMLDivElement>(null);
 const art=room.id==='southward.gas.forecourt'?'/assets/rooms/mercy-fuel-exterior.webp':room.id==='southward.mercyfuel.interior'?'/assets/rooms/mercy-fuel-interior.webp':null;
 useEffect(()=>{
   if(art||!host.current)return;
   let disposed=false;
   const app=new Application();
   (async()=>{await app.init({resizeTo:host.current!,background:'#0b0d10',antialias:true});if(disposed)return;host.current!.appendChild(app.canvas);drawScene(app,room)})();
   return()=>{disposed=true;app.destroy(true,{children:true})};
 },[room.id,art]);
 return <div className={`scene ${art?'roomArtScene':''}`}>{art?<img className="roomArt" src={art} alt={`${room.name} at night`}/>:<div className="pixiHost" ref={host}/>}<WeatherOverlay room={room} weather={weather}/></div>;
}

function App(){
 const [player,setPlayer]=useState<PlayerView>({name:'Winter',cash:83,bank:640,health:100,stress:18,job:'Unemployed',roomId:'southward.gas.forecourt',inventory:starterItems});
 const [eventsByRoom,setEventsByRoom]=useState<Partial<Record<RoomId,string[]>>>({'southward.gas.forecourt':['Rain started twenty minutes ago.','A faded sedan sits beneath pump three.'],'southward.mercyfuel.interior':['The cooler compressors hum behind the glass doors.'],'southward.diner':['The coffee burner clicks softly behind the counter.'],'southward.alley':['Water ticks from the fire escape into a dented drain.'],'southward.apartment.lobby':['The old elevator cables groan somewhere above.']});
 const [chat,setChat]=useState<ChatMsg[]>([{id:'hello',scope:'room',from:'Rita Vale',text:'If you are coming in, wipe your shoes. I just mopped.',roomId:'southward.diner',sentAt:Date.now()-90000}]);
 const [chatText,setChatText]=useState('');
 const [scope,setScope]=useState<'room'|'global'>('room');
 const [selected,setSelected]=useState<string|null>(starterItems[0].id);
 const [inventoryOpen,setInventoryOpen]=useState(false);
 const [inventoryContext,setInventoryContext]=useState<InventoryView|null>(null);
 const [resourceCount,setResourceCount]=useState(0);
 const activityRef=useRef<HTMLDivElement>(null);
 const [networkRoom,setNetworkRoom]=useState<any>(null);
 const [networkLabel,setNetworkLabel]=useState('LOCAL PREVIEW');
 const [heartbeatLabel,setHeartbeatLabel]=useState('OFFLINE FALLBACK');
 const [phoneOpen,setPhoneOpen]=useState(false);
 const [phoneState,setPhoneState]=useState<PhoneState|null>(null);
 const [phoneApp,setPhoneApp]=useState('messages');
 const [phonePanel,setPhonePanel]=useState<any>(null);
 const [callText,setCallText]=useState('');
 const [travel,setTravel]=useState<TravelState|null>(null);
 const [weather,setWeather]=useState<WeatherState>({zone:'southward',type:'rain',label:'Cold rain',detail:'harbor wind · wet pavement',intensity:.7,seed:4812,startedAt:Date.now(),nextAt:Date.now()+30*60_000});
 const room=rooms[player.roomId];
 const events=eventsByRoom[player.roomId]??[];
 const displayItems=inventoryContext&&inventoryContext.type!=='player'?inventoryContext.items:player.inventory;
 const selectedItem=displayItems.find(i=>i.id===selected)??null;
 const visibleChat=useMemo(()=>chat.filter(m=>m.scope==='global'||m.roomId===player.roomId).slice(-30),[chat,player.roomId]);
 const push=(text:string,roomId:RoomId=player.roomId)=>setEventsByRoom(v=>{const list=v[roomId]??[];return {...v,[roomId]:[...list.slice(-39),text]}});
 const sendAction=(name:string,payload:unknown={})=>networkRoom?.send('action',{name,payload});

 useEffect(()=>{const el=activityRef.current;if(el)el.scrollTop=el.scrollHeight},[events]);
 useEffect(()=>{if(!travel)return;const id=window.setInterval(()=>setTravel(t=>t?{...t}:t),250);return()=>window.clearInterval(id)},[travel?.status,travel?.arriveAt]);

 useEffect(()=>{
   const endpoint=import.meta.env.VITE_GAME_SERVER as string|undefined;
   if(!endpoint)return;
   let active=true;let joined:ColyseusRoom|undefined;
   (async()=>{try{
     const client=new ColyseusClient(endpoint); joined=await client.joinOrCreate('world'); if(!active){joined.leave();return;} setNetworkRoom(joined);setNetworkLabel('LIVE SERVER');
     joined.onMessage('event',(m:{text?:string})=>{if(m.text)push(m.text)});
     joined.onMessage('chat',(m:ChatMsg)=>setChat(v=>[...v.slice(-79),m]));
     joined.onMessage('chat_history',(items:ChatMsg[])=>setChat(items));
     joined.onMessage('world_event',(m:{text?:string})=>{if(m.text)push(m.text)});
     joined.onMessage('heartbeat_status',(m:{mode?:string;sequence?:number})=>setHeartbeatLabel(`${(m.mode||'offline').toUpperCase()}${m.sequence?` #${m.sequence}`:''}`));
     joined.onMessage('resource_status',(m:{resources?:unknown[]})=>setResourceCount(m.resources?.length||0));
     joined.onMessage('inventory_open',(m:InventoryView)=>{setInventoryContext(m);setSelected(m.items?.[0]?.id??null);setInventoryOpen(true)});
     joined.onMessage('inventory_close',()=>{setInventoryOpen(false);setInventoryContext(null)});
     joined.onMessage('phone_open',(m:PhoneState)=>{setPhoneState(m);setPhonePanel(null);setPhoneOpen(true)});
     joined.onMessage('phone_message',(m:any)=>setPhoneState(v=>v?({...v,messages:[...(v.messages||[]),m]}):v));
     joined.onMessage('phone_call',(m:any)=>setPhoneState(v=>v?({...v,activeCall:m}):v));
     joined.onMessage('phone_call_text',(m:any)=>setPhoneState(v=>v?.activeCall?({...v,activeCall:{...v.activeCall,transcript:[...(v.activeCall.transcript||[]),m]}}):v));
     joined.onMessage('bank_state',(m:any)=>setPhonePanel(m));
     joined.onMessage('vehicle_list',(m:any)=>setPhonePanel(m));
     joined.onMessage('job_list',(m:any)=>setPhonePanel(m));
     joined.onMessage('travel_update',(m:TravelState)=>setTravel(m.status==='arrived'||m.status==='cancelled'?null:m));
     joined.onMessage('weather_state',(m:WeatherState)=>setWeather(m));
     const state:any=joined.state; const $=getStateCallbacks(joined); const sync=(p:any)=>{const inv:Item[]=[];p.inventory?.forEach((i:any)=>{let metadata:Record<string,any>={};try{metadata=JSON.parse(i.metadataJson||'{}')}catch{}inv.push({id:i.id,templateId:i.templateId,name:i.name,kind:i.kind,quantity:i.quantity,weight:i.weight,description:i.description,usable:i.usable,droppable:i.droppable,metadata})});setPlayer({name:p.name,cash:p.cash,bank:p.bank??0,health:p.health,stress:p.stress,job:p.job,roomId:p.roomId as RoomId,inventory:inv})};
     $(state).players.onAdd((p:any,id:string)=>{if(id===joined!.sessionId){sync(p);$(p).onChange(()=>sync(p));$(p).inventory.onAdd(()=>sync(p));$(p).inventory.onRemove(()=>sync(p));}});
   }catch{if(active){setNetworkLabel('LOCAL PREVIEW');push('Could not reach multiplayer server; continuing locally.')}}})();
   return()=>{active=false;joined?.leave()};
 },[]);

 const openOwnInventory=()=>{if(networkRoom){sendAction('inventory:open',{inventoryType:'player'});return;}setInventoryContext({id:'player:local',type:'player',label:`${player.name}'s inventory`,items:player.inventory});setSelected(player.inventory[0]?.id??null);setInventoryOpen(true)};
 const closeInventory=()=>{if(networkRoom)sendAction('inventory:close',{});setInventoryOpen(false);setInventoryContext(null)};
 const openSedanTrunk=()=>{if(networkRoom){sendAction('vehicle:openStorage',{vehicleId:'sedan.blue',compartment:'trunk'});return;}const localTrunk:Item[]=[{id:'trunk-jumpers',templateId:'tool.jumper_cables',name:'Jumper cables',kind:'tool',quantity:1,weight:2.2,description:'A cheap set of red and black jumper cables.',usable:false,droppable:true,metadata:{}},{id:'trunk-rag',templateId:'cloth.shop_rag',name:'Shop rag',kind:'misc',quantity:1,weight:.1,description:'An oily cotton rag that smells faintly of gasoline.',usable:false,droppable:true,metadata:{}}];setInventoryContext({id:'vehicle:sedan.blue:trunk',type:'vehicle_trunk',label:'faded blue sedan — trunk',items:localTrunk});setSelected(localTrunk[0]?.id??null);setInventoryOpen(true);push('You lift the sedan trunk. The hinges complain.')};
 const takeFromOpenInventory=()=>{if(!selectedItem||!inventoryContext||inventoryContext.type==='player')return;if(networkRoom){sendAction('inventory:move',{itemId:selectedItem.id,fromInventory:inventoryContext.id,toInventory:`player:${networkRoom.sessionId}`});return;}setPlayer(p=>({...p,inventory:[...p.inventory,selectedItem]}));setInventoryContext(v=>v?({...v,items:v.items.filter(i=>i.id!==selectedItem.id)}):v);push(`You take ${selectedItem.name.toLowerCase()} from ${inventoryContext.label}.`);setSelected(null)};

 const localMove=(dir:string)=>{const next=room.exits[dir];if(!next){push(`There is no ${dir} exit.`);return;}setPlayer(p=>({...p,roomId:next}));push(`You move ${dir}.`)};
 const move=(dir:string)=>networkRoom?sendAction('player:move',{direction:dir}):localMove(dir);
 const work=()=>{if(networkRoom){sendAction('job:performAvailable',{});return;}if(player.roomId==='southward.gas.forecourt'){setPlayer(p=>({...p,cash:p.cash+14,stress:Math.min(100,p.stress+4),job:'Mercy Fuel night stock'}));push('You haul two boxes into the stock room. +$14, +4 stress.');return;}if(player.roomId==='southward.diner'){setPlayer(p=>({...p,cash:p.cash+12,stress:Math.min(100,p.stress+3),job:"Rita's Diner cleanup"}));push('You clear a rack of dishes and mop behind the counter. +$12, +3 stress.');return;}push('There is no quick cash work available here.')};
 const takeDrink=()=>{if(player.roomId!=='southward.mercyfuel.interior'){push('The drinks are inside the store.');return;}if(networkRoom){sendAction('world:take',{target:'energy_drink'});return;}if(player.inventory.some(i=>i.templateId==='drink.energy')){push('You already have a Redline in your bag.');return;}const item:Item={id:`drink-${Date.now()}`,templateId:'drink.energy',name:'Redline energy drink',kind:'consumable',quantity:1,weight:.35,description:'A dented can of something aggressively citrus.',usable:true,droppable:true,metadata:{}};setPlayer(p=>({...p,inventory:[...p.inventory,item]}));setSelected(item.id);push('You slip a Redline energy drink into your bag. Maya looks up sharply.');setTimeout(()=>push('Maya steps away from the register and reaches for the phone.'),650)};
 const useItem=()=>{if(!selectedItem)return;if(networkRoom){sendAction('inventory:use',{itemId:selectedItem.id});return;}if(!selectedItem.usable){push('That item cannot be used right now.');return;}if(selectedItem.templateId==='phone.basic'){setInventoryOpen(false);setPhoneState({owner:{name:player.name,phoneNumber:'(346) 555-0187'},apps:[{id:'messages',label:'Messages'},{id:'calls',label:'Calls'},{id:'mail',label:'Mail'},{id:'bank',label:'Bank'},{id:'vehicles',label:'Vehicles'},{id:'jobs',label:'Work'}],contacts:[{name:'Rita Vale',phoneNumber:'(346) 555-0142',online:true}],messages:[{fromName:'Rita Vale',text:'Coffee is on if you are awake.',sentAt:Date.now()-60000}]});setPhoneOpen(true);return;}if(selectedItem.templateId==='document.drivers_license'){push(`Driver license: ${selectedItem.metadata.legalName} · ${selectedItem.metadata.licenseNumber} · ${selectedItem.metadata.address}.`);return;}setPlayer(p=>({...p,stress:Math.max(0,p.stress-(selectedItem.templateId==='water.bottle'?2:1)),inventory:p.inventory.filter(i=>i.id!==selectedItem.id)}));setSelected(null);push(selectedItem.templateId==='water.bottle'?'You finish the water. -2 stress.':'You drink it. It tastes medicinal. -1 stress.')};
 const openPhoneApp=(app:{id:string;action?:string})=>{setPhoneApp(app.id);setPhonePanel(null);if(networkRoom&&app.action)sendAction(app.action,{})};
 const startCall=()=>{const contact=phoneState?.contacts?.[0];if(!contact)return;if(networkRoom){sendAction('phone:startCall',{to:contact.phoneNumber});return;}const call={id:'local-call',status:'connected',calleeName:contact.name,calleeNumber:contact.phoneNumber,transcript:[{id:'1',fromName:contact.name,text:'Yeah? I can type. What do you need?',sentAt:Date.now()}]};setPhoneState(v=>v?({...v,activeCall:call}):v)};
 const sendCallText=(e:FormEvent)=>{e.preventDefault();const text=callText.trim();if(!text)return;if(networkRoom)sendAction('phone:sendCallText',{text});else setPhoneState(v=>v?.activeCall?({...v,activeCall:{...v.activeCall,transcript:[...(v.activeCall.transcript||[]),{id:`local-${Date.now()}`,fromName:'You',text,sentAt:Date.now()}]}}):v);setCallText('')};
 const endCall=()=>{if(networkRoom)sendAction('phone:endCall',{});setPhoneState(v=>v?({...v,activeCall:null}):v)};
 const startTravel=(destination:RoomId)=>{if(travel)return;if(networkRoom){sendAction('travel:start',{vehicleId:'sedan.blue',destination});return;}const startedAt=Date.now(),arriveAt=startedAt+12000,origin=player.roomId;setTravel({status:'traveling',origin,destination,startedAt,arriveAt,vehicleId:'sedan.blue',route:'Harbor Avenue'});const timer=setInterval(()=>{const progress=Math.min(1,(Date.now()-startedAt)/(arriveAt-startedAt));setTravel(v=>v?({...v,progress}):v);if(progress>=1){clearInterval(timer);setPlayer(p=>({...p,roomId:destination}));setTravel(null);push(`You arrive at ${rooms[destination].name} in the faded blue sedan.`)}},100)};
 const dropItem=()=>{if(!selectedItem)return;if(networkRoom){sendAction('inventory:drop',{itemId:selectedItem.id});return;}if(!selectedItem.droppable){push(`You decide not to leave your ${selectedItem.name.toLowerCase()} behind.`);return;}setPlayer(p=>({...p,inventory:p.inventory.filter(i=>i.id!==selectedItem.id)}));push(`You leave ${selectedItem.name.toLowerCase()} here.`);setSelected(null)};
 const sendChat=(e:FormEvent)=>{e.preventDefault();const text=chatText.trim().replace(/\s+/g,' ').slice(0,280);if(!text)return;if(networkRoom)sendAction('chat:send',{scope,text});else setChat(v=>[...v,{id:`local-${Date.now()}`,scope,from:player.name,text,roomId:player.roomId,sentAt:Date.now()}]);setChatText('')};

 return <main className="shell">
   <header><div className="brand"><b>PORT MERCY</b><span> persistent city</span></div><div className="server"><i/> {networkLabel} <em>WORLD {heartbeatLabel}</em></div></header>
   <aside className="left panel">
     <section><div className="eyebrow">CHARACTER</div><h2>{player.name}</h2><div className="stat"><span>Cash</span><b>${player.cash}</b></div><div className="stat"><span>Health</span><b>{player.health}</b></div><div className="stat"><span>Stress</span><b>{player.stress}%</b></div><div className="stat"><span>Job</span><b>{player.job}</b></div></section>
     <section className="gameMenu"><div className="eyebrow">MENU</div><button className="menuButton" onClick={openOwnInventory}><span>Inventory</span><small>{player.inventory.length}</small></button><button className="menuButton" onClick={()=>push('Character details will live in this menu as the sheet grows.')}><span>Character</span><small>›</small></button><button className="menuButton" onClick={()=>player.roomId==='southward.gas.forecourt'?startTravel('southward.diner'):player.roomId==='southward.diner'?startTravel('southward.gas.forecourt'):push('The drivable city map will expand with the district.')}><span>City map</span><small>›</small></button></section>
   </aside>
   <section className="center">
     <div className="roomTitle"><div><small>{room.district} · Harbor County</small><h1>{room.name}</h1></div><span>{room.id}</span></div>
     <Scene room={room} weather={weather}/>
     <p className="desc">{room.desc}</p>
     <div className="commandBar"><span className="eyebrow">DO</span>{player.roomId==='southward.gas.forecourt'&&<><button onClick={work}>Unload delivery</button><button onClick={()=>push('Pump three clicks and hums beneath the canopy. The card reader looks older than the rest of the hardware.')}>Inspect pumps</button><button onClick={openSedanTrunk}>Open sedan trunk</button><button onClick={()=>startTravel('southward.diner')}>Drive to Rita's</button></>}{player.roomId==='southward.mercyfuel.interior'&&<><button onClick={()=>push('Maya Torres glances up from the register and asks if you need anything from behind the counter.')}>Talk to Maya</button><button onClick={()=>setPlayer(p=>({...p,stress:Math.max(0,p.stress-2)}))}>Pour coffee</button><button onClick={()=>push('Rows of bottled drinks hum behind the glass, blue cooler lights flickering over the labels.')}>Browse coolers</button><button onClick={takeDrink}>Pocket energy drink</button></>}{player.roomId==='southward.diner'&&<><button onClick={work}>Wash dishes</button><button onClick={()=>push('Rita pours coffee without asking. “You look like you need this more than I need the quarter.”')}>Talk to Rita</button><button onClick={()=>push('The laminated menu is mostly breakfast, burgers and things that survived a fryer.')}>Read menu</button><button onClick={()=>startTravel('southward.gas.forecourt')}>Drive to Mercy Fuel</button></>}{player.roomId==='southward.alley'&&<><button onClick={()=>push('The dumpster padlock is cheap but intact. Someone has scratched a delivery code into the brick beside it.')}>Inspect dumpster</button></>}{player.roomId==='southward.apartment.lobby'&&<><button onClick={()=>push('Mailbox 3B contains a grocery circular and a final notice addressed to someone who lived here before you.')}>Check mailbox</button></>}</div>
     <div className="exits"><span className="eyebrow">GO</span>{Object.keys(room.exits).map(dir=><button key={dir} onClick={()=>move(dir)}>{dir.toUpperCase()}</button>)}</div>
     <section className="activity"><div className="sectionHead"><span className="eyebrow">ROOM ACTIVITY</span><small>latest below</small></div><div className="activityLog" ref={activityRef}>{events.map((x,i)=><p key={`${i}-${x}`}>{x}</p>)}</div></section>
   </section>
   <aside className="right panel">
     <section><div className="sectionHead"><span className="eyebrow">HERE</span><small>{room.objects.length} visible</small></div>{room.objects.map(o=><div className="entity" key={o.id}><div><b>{o.label}</b><small>{o.kind}</small></div><button onClick={()=>o.kind==='vehicle'?openSedanTrunk():push(`You look more closely at ${o.label}.`)}>{o.kind==='vehicle'?'Trunk':'Look'}</button></div>)}</section>
     <section className="chat"><div className="chatHead"><span className="eyebrow">CHAT</span><div><button className={scope==='room'?'active':''} onClick={()=>setScope('room')}>Room</button><button className={scope==='global'?'active':''} onClick={()=>setScope('global')}>Global</button></div></div><div className="messages">{visibleChat.length?visibleChat.map(m=><div className="message" key={m.id}><div><b>{m.from}</b><small>{m.scope==='global'?'CITY':'HERE'} · {new Date(m.sentAt).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}</small></div><p>{m.text}</p></div>):<div className="empty">No messages yet.</div>}</div><form onSubmit={sendChat}><input value={chatText} onChange={e=>setChatText(e.target.value)} maxLength={280} placeholder={scope==='room'?'Say something to people here…':'Send to city chat…'}/><button type="submit">Send</button></form></section>
   </aside>
   <footer><span>PORT MERCY // SOUTH WARD // NIGHT</span><span>v0.7 · {resourceCount?`${resourceCount} RESOURCES · `:''}SYNCED WEATHER · WORLD HEARTBEAT {heartbeatLabel}</span></footer>
   {travel&&<div className="travelHud"><div><b>{travel.status==='paused'?'Travel interrupted':`Driving · ${travel.route||'city route'}`}</b><span>{travel.status==='paused'?'CHASE':`${Math.max(0,Math.ceil((travel.arriveAt-Date.now())/1000))}s`}</span></div><div className="travelTrack"><div className="travelFill" style={{width:`${Math.min(100,Math.max(0,travel.status==='paused'&&travel.remainingMs!=null?100-(travel.remainingMs/Math.max(1,(travel.seconds??((travel.arriveAt-travel.startedAt)/1000))*1000))*100:(travel.progress??((Date.now()-travel.startedAt)/(travel.arriveAt-travel.startedAt)))*100))}%`}}/></div></div>}
   {inventoryOpen&&<div className="modalShade" onMouseDown={closeInventory}><section className="inventoryModal" onMouseDown={e=>e.stopPropagation()} aria-modal="true" role="dialog" aria-label="Inventory"><div className="modalHead"><div><span className="eyebrow">INVENTORY</span><h2>{inventoryContext?.label||"What you're carrying"}</h2></div><button className="closeButton" onClick={closeInventory} aria-label="Close inventory">×</button></div><div className="inventoryBody"><div className="itemList">{displayItems.map(item=><button className={`item ${selected===item.id?'selected':''}`} key={item.id} onClick={()=>setSelected(item.id)}><span>{item.name}</span><small>{item.kind}</small></button>)}</div><div className="inventoryDetail">{selectedItem?<div className="itemDetail"><b>{selectedItem.name}</b>{selectedItem.templateId==='document.drivers_license'?<div className="licenseCard"><div className="licenseTop"><div><small>PORT MERCY</small><strong>DRIVER LICENSE</strong></div><span>CLASS {selectedItem.metadata.licenseClass}</span></div><div className="licenseMain"><div className="licensePhoto">{selectedItem.metadata.portraitUrl?<img src={selectedItem.metadata.portraitUrl} alt="Character portrait"/>:<><span>PHOTO</span><small>pending character art</small></>}</div><dl><div><dt>Name</dt><dd>{selectedItem.metadata.legalName}</dd></div><div><dt>DOB</dt><dd>{selectedItem.metadata.dateOfBirth}</dd></div><div><dt>Address</dt><dd>{selectedItem.metadata.address}</dd></div><div><dt>License</dt><dd>{selectedItem.metadata.licenseNumber}</dd></div><div><dt>Sex</dt><dd>{selectedItem.metadata.sexMarker}</dd></div><div><dt>Height</dt><dd>{selectedItem.metadata.height}</dd></div><div><dt>Eyes</dt><dd>{selectedItem.metadata.eyes}</dd></div><div><dt>Expires</dt><dd>{selectedItem.metadata.expires}</dd></div></dl></div></div>:<p>{selectedItem.description}</p>}<small>{selectedItem.weight.toFixed(2)} kg</small><div className="miniActions">{inventoryContext&&inventoryContext.type!=='player'?<button onClick={takeFromOpenInventory}>Take</button>:<><button onClick={useItem} disabled={!selectedItem.usable}>Use</button><button onClick={dropItem}>Drop</button></>}</div></div>:<div className="empty">Select an item.</div>}</div></div><div className="inventoryFoot">{displayItems.length} item{displayItems.length===1?'':'s'} · {inventoryContext?.type==='player'||!inventoryContext?'phone, license, keys and tools are ordinary inventory items':'secondary inventory handled by the same resource system'}</div></section></div>}
   {phoneOpen&&phoneState&&<div className="modalShade" onMouseDown={()=>setPhoneOpen(false)}><section className="phoneModal" onMouseDown={e=>e.stopPropagation()}><div className="phoneBar"><span>PORT MERCY CELLULAR · {phoneState.owner?.phoneNumber||'(346) 555-0187'}</span><button className="phoneClose" onClick={()=>setPhoneOpen(false)}>×</button></div><div className="phoneHome"><div className="phoneApps">{(phoneState.apps||[]).map(app=><button className="phoneApp" key={app.id} onClick={()=>openPhoneApp(app)}><b>{app.label}</b><small>{app.id}</small></button>)}</div><div className="phonePane">{phoneApp==='messages'&&<><h3>Messages</h3><div className="phoneList">{(phoneState.messages||[]).map((m:any,i:number)=><div className="phoneRow" key={m.id||i}><span><b>{m.fromName||m.from||'Unknown'}</b><br/><small>{m.text}</small></span></div>)}</div></>}{phoneApp==='calls'&&<>{phoneState.activeCall?<><h3>{phoneState.activeCall.calleeName||phoneState.activeCall.callerName||'Call'} · {phoneState.activeCall.status}</h3><div className="callTranscript">{(phoneState.activeCall.transcript||[]).map((line:any,i:number)=><p key={line.id||i}><b>{line.fromName||'Caller'}:</b> {line.text}</p>)}</div>{phoneState.activeCall.status==='connected'&&<form onSubmit={sendCallText}><input value={callText} onChange={e=>setCallText(e.target.value)} placeholder="Type into the call…"/><button>Send</button></form>}<button onClick={endCall}>Hang up</button></>:<><h3>Calls</h3><p>Calls are live text conversations: ring, answer, type, hang up.</p>{phoneState.contacts?.[0]&&<div className="phoneRow"><span><b>{phoneState.contacts[0].name}</b><br/><small>{phoneState.contacts[0].phoneNumber}</small></span><button onClick={startCall}>Call</button></div>}</>}</>}{phoneApp==='bank'&&<><h3>Bank</h3>{phonePanel?.accounts?.map((a:any)=><div className="phoneRow" key={a.id}><span>{a.label}</span><b>${a.balance}</b></div>)||<p>Open the banking app to load your accounts.</p>}</>}{phoneApp==='vehicles'&&<><h3>Vehicles</h3>{phonePanel?.vehicles?.map((v:any)=><div className="phoneRow" key={v.id}><span><b>{v.label}</b><br/><small>{rooms[v.roomId as RoomId]?.name??'Unknown location'} · {v.status||'parked'} · {v.locked?'locked':'unlocked'}</small><br/><small>REG {v.registration||'pending'} · {v.fuel??'?'}% fuel · {v.condition??'?'}% condition</small></span></div>)||<p>Your registered vehicles appear here.</p>}</>}{phoneApp==='jobs'&&<><h3>Work</h3>{phonePanel?.jobs?.map((j:any)=><div className="phoneRow" key={j.id}><span>{j.label}</span><small>{j.here?'HERE':j.status}</small></div>)||<p>Available jobs appear here.</p>}</>}{phoneApp==='mail'&&<><h3>Mail</h3><div className="phoneRow"><span><b>Port Mercy DMV</b><br/><small>Your driver license is valid.</small></span></div></>}{phoneApp==='contacts'&&<><h3>Contacts</h3>{phoneState.contacts?.map(c=><div className="phoneRow" key={c.phoneNumber}><span><b>{c.name}</b><br/><small>{c.phoneNumber}</small></span></div>)}</>}</div></div></section></div>}
 </main>;
}

createRoot(document.getElementById('root')!).render(<App/>);
