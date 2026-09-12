import React,{FormEvent,useEffect,useMemo,useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {Application,Container,Graphics,Text} from 'pixi.js';
import {Client as ColyseusClient,type Room as ColyseusRoom} from 'colyseus.js';
import {GAME_VERSION,WORLD_CATALOG,type Direction,type RoomId,type WorldObject,type WorldRoomDefinition,type InteractionOption,type InteractionList} from '@portmercy/protocol';
import './styles.css';

type Item={id:string;templateId:string;name:string;kind:string;quantity:number;weight:number;description:string;usable:boolean;droppable:boolean;metadata:Record<string,any>};
type InventoryView={id:string;type:string;label:string;items:Item[]};
type ChatMsg={id:string;scope:'room'|'global';from:string;text:string;roomId:RoomId;sentAt:number};
type RoomDef=WorldRoomDefinition&{id:RoomId};
type Activity={kind:'work'|'travel'|'chase';id:string;startedAt:number}|null;
type PlayerView={characterId:string;name:string;cash:number;bank:number;health:number;stress:number;job:string;jobId:string;onDuty:boolean;phoneNumber:string;roomId:RoomId;inventory:Item[];activity:Activity};
type PhoneState={owner?:{name:string;phoneNumber:string};apps?:Array<{id:string;label:string;action?:string}>;contacts?:Array<{name:string;phoneNumber:string;online?:boolean}>;messages?:Array<any>;activeCall?:any};
type TravelState={status:string;origin:RoomId;destination:RoomId;startedAt:number;arriveAt:number;vehicleId:string;route?:string;progress?:number;remainingMs?:number;pauseReason?:string;seconds?:number};
type ChaseState={id:string;status:string;pursuer:string;turn:number;gap:number;log?:any[]};
type WeatherKind='clear'|'rain'|'fog'|'snow'|'storm';
type WeatherState={zone:string;type:WeatherKind;label:string;detail:string;intensity:number;seed:number;startedAt:number;nextAt:number};
type PublicRoomView={roomId:RoomId;room:RoomDef;occupants:Array<{characterId:string;name:string;job:string}>;vehicles:Array<any>;activity:string[]};
type NetworkState='offline-preview'|'connecting'|'live'|'reconnecting'|'disconnected';

const rooms=WORLD_CATALOG;
const TRAVEL_FRAMES=['/assets/travel/drive-01.webp','/assets/travel/drive-02.webp','/assets/travel/drive-03.webp','/assets/travel/drive-04.webp'];
const starterItems:Item[]=[
 {id:'local-phone',templateId:'phone.basic',name:'Cheap phone',kind:'phone',quantity:1,weight:.2,description:'A scratched prepaid phone with a weak battery.',usable:true,droppable:false,metadata:{}},
 {id:'local-key',templateId:'key.apartment',name:'Apartment key',kind:'key',quantity:1,weight:.05,description:'A brass key stamped 3B.',usable:false,droppable:false,metadata:{}},
 {id:'local-license',templateId:'document.drivers_license',name:'Port Mercy driver license',kind:'document',quantity:1,weight:.01,description:'A state-issued driver license.',usable:true,droppable:false,metadata:{documentType:'drivers_license',legalName:'Winter',dateOfBirth:'1992-08-17',address:'18 Marrow Avenue, Apt 3B',licenseNumber:'PM-WNTR-3B17',licenseClass:'C',expires:'2030-08-17',sexMarker:'F',height:'5 ft 7 in',eyes:'Brown'}},
 {id:'local-water',templateId:'water.bottle',name:'Bottled water',kind:'consumable',quantity:1,weight:.5,description:'Still cold from a corner-store refrigerator.',usable:true,droppable:true,metadata:{}}
];

function drawFallback(app:Application,room:RoomDef){
 const W=1100,H=650,world=new Container(),g=new Graphics();world.addChild(g);g.rect(0,0,W,H).fill(0x0b1119);
 if(room.id==='southward.gas.forecourt'){g.rect(0,390,W,260).fill(0x17191c);g.rect(70,88,520,34).fill(0xd8d7c7);g.rect(85,122,18,282).fill(0xb9b8ab);g.rect(555,122,18,282).fill(0xb9b8ab);g.rect(118,160,330,230).fill(0x222a31);g.rect(142,190,74,200).fill(0x6e242a);g.rect(245,205,168,78).fill(0x091017);}
 else if(room.id==='southward.diner'){g.rect(0,405,W,245).fill(0x241d1c);g.rect(72,88,956,317).fill(0x3c2725);g.rect(100,116,900,255).fill(0xead8bb);for(let i=0;i<5;i++){g.roundRect(125+i*170,252,124,78,16).fill(0x773838);g.rect(145+i*170,330,84,45).fill(0x402727)}}
 else if(room.id==='southward.alley'){g.rect(0,420,W,230).fill(0x17191b);g.rect(0,0,320,430).fill(0x302a29);g.rect(780,0,320,430).fill(0x292626);g.rect(320,0,460,430).fill(0x10151b);g.roundRect(505,330,180,100,8).fill(0x34383a);}
 else{g.rect(0,420,W,230).fill(0x2c2724);g.rect(0,0,W,420).fill(0x31413a);g.rect(80,70,260,320).fill(0x27322e);for(let r=0;r<5;r++)for(let c=0;c<4;c++)g.rect(485+c*75,95+r*52,58,38).fill(0x81735d)}
 for(const o of room.objects){const c=new Container(),shape=new Graphics();if(o.kind==='vehicle'){shape.roundRect(-82,-25,164,52,14).fill(0x355064);shape.roundRect(-38,-52,80,34,10).fill(0x253746)}else if(o.kind==='npc'){shape.circle(0,-44,17).fill(0xc7a287);shape.roundRect(-19,-27,38,72,10).fill(0x465260)}else shape.roundRect(-48,-28,96,56,7).fill(0x41474a);const label=new Text({text:o.label,style:{fill:0xe4e8ec,fontSize:13,fontFamily:'system-ui'}});label.anchor.set(.5);label.y=53;c.addChild(shape,label);c.x=(o.anchorX??.5)*W;c.y=(o.anchorY??.5)*H;world.addChild(c)}
 app.stage.addChild(world);const fit=()=>{const scale=Math.min(app.renderer.width/W,app.renderer.height/H);world.scale.set(scale);world.x=(app.renderer.width-W*scale)/2;world.y=(app.renderer.height-H*scale)/2};fit();app.renderer.on('resize',fit);
}
function WeatherOverlay({room,weather}:{room:RoomDef;weather:WeatherState}){if(room.environment!=='outdoor')return null;const rainCount=weather.type==='storm'?72:weather.type==='rain'?54:0,snowCount=weather.type==='snow'?38:0;return <><div className={`weatherLayer ${weather.type}`}><div className="weatherTint"/><div className="weatherGlow"/>{(weather.type==='fog'||weather.type==='snow')&&Array.from({length:4},(_,i)=><span className="fogBand" key={i} style={{top:`${14+i*18}%`,animationDuration:`${18+i*4}s`}}/>)}{Array.from({length:rainCount},(_,i)=><span className="rainDrop" key={i} style={{left:`${(i*37+weather.seed*17)%104-2}%`,animationDelay:`-${((i*23)%100)/17}s`,animationDuration:`${.72+((i*7)%9)/18}s`}}/>)}{Array.from({length:snowCount},(_,i)=><span className="snowFlake" key={i} style={{left:`${(i*29+weather.seed*13)%100}%`,animationDelay:`-${((i*19)%120)/12}s`,animationDuration:`${6+((i*5)%7)}s`}}/>)}{weather.type==='storm'&&<div className="weatherFlash"/>}</div><div className="weatherHud"><span className="weatherDot"/><div><b>South Ward Weather</b><span>{weather.label}</span><small>{weather.detail}</small></div></div></>}
function Scene({room,weather,travel,travelFrame,publicView}:{room:RoomDef;weather:WeatherState;travel:TravelState|null;travelFrame:number;publicView:PublicRoomView|null}){
 const host=useRef<HTMLDivElement>(null),art=room.art??null,isDriving=Boolean(travel&&(travel.status==='traveling'||travel.status==='paused'));
 useEffect(()=>{if(isDriving||art||!host.current)return;let disposed=false;const app=new Application();(async()=>{await app.init({resizeTo:host.current!,background:'#0b0d10',antialias:true});if(disposed)return;host.current!.appendChild(app.canvas);drawFallback(app,room)})();return()=>{disposed=true;app.destroy(true,{children:true})}},[room.id,art,isDriving]);
 if(isDriving)return <div className="scene roomArtScene travelScene"><img className="roomArt" src={TRAVEL_FRAMES[travelFrame%TRAVEL_FRAMES.length]} alt="Driving through Port Mercy"/><div className="travelSceneHud"><b>{travel?.status==='paused'?'Travel interrupted':'Driving'}</b><span>{travel?.route||'Port Mercy streets'}</span></div></div>;
 return <div className={`scene ${art?'roomArtScene':''}`}>{art?<img className="roomArt" src={art} onError={e=>{(e.currentTarget as HTMLImageElement).style.display='none'}} alt={`${room.name} at night`}/>:<div className="pixiHost" ref={host}/>}<WeatherOverlay room={room} weather={weather}/>{publicView&&<div className="scenePresence">{publicView.occupants.map(o=><span key={o.characterId}>{o.name}</span>)}</div>}</div>;
}

function App(){
 const endpoint=import.meta.env.VITE_GAME_SERVER as string|undefined;
 const [player,setPlayer]=useState<PlayerView>({characterId:'local',name:'Winter',cash:83,bank:640,health:100,stress:18,job:'Unemployed',jobId:'unemployed',onDuty:false,phoneNumber:'(346) 555-0187',roomId:'southward.gas.forecourt',inventory:starterItems,activity:null});
 const [eventsByRoom,setEventsByRoom]=useState<Partial<Record<RoomId,string[]>>>({'southward.gas.forecourt':['Rain started twenty minutes ago.'],'southward.mercyfuel.interior':['The cooler compressors hum behind the glass doors.'],'southward.diner':['The coffee burner clicks softly behind the counter.']});
 const [chat,setChat]=useState<ChatMsg[]>([]),[chatText,setChatText]=useState(''),[scope,setScope]=useState<'room'|'global'>('room');
 const [selected,setSelected]=useState<string|null>(starterItems[0].id),[inventoryOpen,setInventoryOpen]=useState(false),[inventoryContext,setInventoryContext]=useState<InventoryView|null>(null);
 const [networkRoom,setNetworkRoom]=useState<ColyseusRoom|null>(null),[networkState,setNetworkState]=useState<NetworkState>(endpoint?'connecting':'offline-preview'),[heartbeatLabel,setHeartbeatLabel]=useState('OFFLINE'),[resourceCount,setResourceCount]=useState(0);
 const [publicView,setPublicView]=useState<PublicRoomView|null>(null),[interactionLists,setInteractionLists]=useState<Record<string,InteractionOption[]>>({});
 const [phoneOpen,setPhoneOpen]=useState(false),[phoneState,setPhoneState]=useState<PhoneState|null>(null),[phoneApp,setPhoneApp]=useState('messages'),[phonePanel,setPhonePanel]=useState<any>(null),[callText,setCallText]=useState(''),[messageText,setMessageText]=useState(''),[messageTo,setMessageTo]=useState(''),[incomingAlert,setIncomingAlert]=useState<any>(null);
 const [travel,setTravel]=useState<TravelState|null>(null),[travelFrame,setTravelFrame]=useState(0),[chase,setChase]=useState<ChaseState|null>(null);
 const [weather,setWeather]=useState<WeatherState>({zone:'southward',type:'rain',label:'Cold rain',detail:'harbor wind · wet pavement',intensity:.7,seed:4812,startedAt:Date.now(),nextAt:Date.now()+30*60_000});
 const activityRef=useRef<HTMLDivElement>(null),roomRef=useRef<RoomId>(player.roomId);roomRef.current=player.roomId;
 const room=rooms[player.roomId],events=eventsByRoom[player.roomId]??[],displayItems=inventoryContext&&inventoryContext.type!=='player'?inventoryContext.items:player.inventory,selectedItem=displayItems.find(i=>i.id===selected)??null;
 const visibleChat=useMemo(()=>chat.filter(m=>m.scope==='global'||m.roomId===player.roomId).slice(-30),[chat,player.roomId]);
 const push=(text:string,roomId:RoomId)=>setEventsByRoom(v=>{const list=v[roomId]??[];return {...v,[roomId]:[...list.slice(-39),text]}});
 const canSend=networkState==='live'&&networkRoom;
 const sendAction=(name:string,payload:unknown={})=>{if(!canSend)return;networkRoom.send('action',{name,payload,requestId:crypto.randomUUID()})};

 useEffect(()=>{const el=activityRef.current;if(el)el.scrollTop=el.scrollHeight},[events]);
 useEffect(()=>{if(!travel||travel.status!=='traveling')return;const id=window.setInterval(()=>setTravelFrame(v=>(v+1)%TRAVEL_FRAMES.length),140);return()=>window.clearInterval(id)},[travel?.status]);
 useEffect(()=>{if(!inventoryOpen&&!phoneOpen)return;const fn=(e:KeyboardEvent)=>{if(e.key==='Escape'){setInventoryOpen(false);setPhoneOpen(false);if(canSend)sendAction('inventory:close')}};window.addEventListener('keydown',fn);return()=>window.removeEventListener('keydown',fn)},[inventoryOpen,phoneOpen,canSend]);

 useEffect(()=>{
  if(!endpoint)return;let active=true,joined:ColyseusRoom|undefined,retry:number|undefined;
  const connect=async(reconnecting=false)=>{if(!active)return;setNetworkState(reconnecting?'reconnecting':'connecting');try{
    const client=new ColyseusClient(endpoint);let characterToken=localStorage.getItem('pm.characterToken');if(!characterToken){characterToken=crypto.randomUUID();localStorage.setItem('pm.characterToken',characterToken)}
    joined=await client.joinOrCreate('world',{characterToken});if(!active){joined.leave();return}setNetworkRoom(joined);setNetworkState('live');
    joined.onMessage('identity_token',(m:{characterToken?:string})=>{if(m.characterToken)localStorage.setItem('pm.characterToken',m.characterToken)});
    joined.onMessage('self_state',(m:any)=>setPlayer({characterId:m.characterId,name:m.name,cash:m.cash,bank:m.bank,health:m.health,stress:m.stress,job:m.job,jobId:m.jobId,onDuty:m.onDuty,phoneNumber:m.phoneNumber,roomId:m.roomId,inventory:m.inventory||[],activity:m.activity||null}));
    joined.onMessage('room_view',(m:PublicRoomView)=>{setPublicView(m);if(m.activity?.length)setEventsByRoom(v=>({...v,[m.roomId]:m.activity.slice(-40)}))});
    joined.onMessage('event',(m:{text?:string;roomId?:RoomId})=>{if(m.text&&m.roomId)push(m.text,m.roomId)});
    joined.onMessage('world_event',(m:{text?:string})=>{if(m.text)push(m.text,roomRef.current)});
    joined.onMessage('interaction_list',(m:InteractionList)=>setInteractionLists(v=>({...v,[m.targetId]:m.options||[]})));
    joined.onMessage('chat',(m:ChatMsg)=>setChat(v=>[...v.slice(-99),m]));joined.onMessage('chat_history',(items:ChatMsg[])=>setChat(items));
    joined.onMessage('heartbeat_status',(m:{mode?:string;sequence?:number})=>setHeartbeatLabel(`${(m.mode||'offline').toUpperCase()}${m.sequence?` #${m.sequence}`:''}`));joined.onMessage('resource_status',(m:{resources?:unknown[]})=>setResourceCount(m.resources?.length||0));
    joined.onMessage('inventory_open',(m:InventoryView)=>{setInventoryContext(m);setSelected(m.items?.[0]?.id??null);setInventoryOpen(true)});joined.onMessage('inventory_close',()=>{setInventoryOpen(false);setInventoryContext(null)});
    joined.onMessage('phone_open',(m:PhoneState)=>{setPhoneState(m);setMessageTo(m.contacts?.[0]?.phoneNumber||'');setPhonePanel(null);setPhoneOpen(true);setIncomingAlert(null)});
    joined.onMessage('phone_message',(m:any)=>setPhoneState(v=>({...v,messages:[...(v?.messages||[]),m]})));
    joined.onMessage('phone_call',(m:any)=>{const terminal=['ended','declined','missed'].includes(m?.status);setPhoneState(v=>({...v,activeCall:terminal?null:m}));if(terminal)setIncomingAlert(null)});
    joined.onMessage('phone_alert',(m:any)=>{setIncomingAlert(m);setPhoneState(v=>({...v,activeCall:m.call}))});
    joined.onMessage('phone_call_text',(m:any)=>setPhoneState(v=>v?.activeCall?({...v,activeCall:{...v.activeCall,transcript:[...(v.activeCall.transcript||[]),m]}}):v));
    joined.onMessage('bank_state',(m:any)=>setPhonePanel(m));joined.onMessage('vehicle_list',(m:any)=>setPhonePanel(m));joined.onMessage('job_list',(m:any)=>setPhonePanel(m));
    joined.onMessage('travel_update',(m:TravelState)=>{setTravel(['arrived','cancelled'].includes(m.status)?null:m);if(m.status==='arrived'||m.status==='cancelled')setTravelFrame(0)});joined.onMessage('chase_update',(m:ChaseState)=>{setChase(m.status==='active'?m:null)});joined.onMessage('weather_state',(m:WeatherState)=>setWeather(m));
    joined.onLeave(()=>{if(!active)return;setNetworkRoom(null);setNetworkState('reconnecting');retry=window.setTimeout(()=>void connect(true),2000)});joined.onError((_code,message)=>{if(active)push(`Connection error: ${message}`,roomRef.current)});
  }catch(error){if(!active)return;setNetworkRoom(null);setNetworkState('disconnected');push(`Multiplayer connection failed: ${error instanceof Error?error.message:'server unavailable'}`,roomRef.current);retry=window.setTimeout(()=>void connect(true),4000)}};
  void connect();return()=>{active=false;if(retry)window.clearTimeout(retry);joined?.leave()};
 },[endpoint]);

 useEffect(()=>{if(!canSend)return;const current=rooms[player.roomId],targets=[`room:${current.id}`,...((publicView?.roomId===current.id?publicView.room.objects:current.objects).map(o=>o.targetId))];for(const targetId of targets)sendAction('interaction:list',{targetId})},[networkRoom,networkState,player.roomId,publicView?.roomId]);

 const roomInteractions=interactionLists[`room:${player.roomId}`]??[];
 const runInteraction=(targetId:string,option:InteractionOption)=>sendAction('interaction:run',{targetId,optionId:option.id});
 const openOwnInventory=()=>{if(canSend){sendAction('inventory:open',{inventoryType:'player'});return}if(networkState!=='offline-preview')return;setInventoryContext({id:'player:local',type:'player',label:`${player.name}'s inventory`,items:player.inventory});setSelected(player.inventory[0]?.id??null);setInventoryOpen(true)};
 const closeInventory=()=>{if(canSend)sendAction('inventory:close');setInventoryOpen(false);setInventoryContext(null)};
 const takeFromOpenInventory=()=>{if(!selectedItem||!inventoryContext||inventoryContext.type==='player')return;if(canSend)sendAction('inventory:move',{itemId:selectedItem.id,fromInventory:inventoryContext.id,toInventory:`player:${networkRoom!.sessionId}`})};
 const move=(dir:string)=>{if(canSend){sendAction('player:move',{direction:dir});return}if(networkState!=='offline-preview')return;const next=(room.exits as Partial<Record<Direction,RoomId>>)[dir as Direction];if(!next){push(`There is no ${dir} exit.`,player.roomId);return}setPlayer(p=>({...p,roomId:next}));push(`You move ${dir}.`,next)};
 const useItem=()=>{if(!selectedItem)return;if(canSend){sendAction('inventory:use',{itemId:selectedItem.id});return}if(networkState!=='offline-preview')return;if(selectedItem.templateId==='phone.basic'){setInventoryOpen(false);setPhoneState({owner:{name:player.name,phoneNumber:player.phoneNumber},apps:[{id:'messages',label:'Messages'},{id:'calls',label:'Calls'}],contacts:[{name:'Rita Vale',phoneNumber:'(346) 555-0142',online:true}],messages:[]});setPhoneOpen(true)}};
 const dropItem=()=>{if(selectedItem&&canSend)sendAction('inventory:drop',{itemId:selectedItem.id})};
 const sendChat=(e:FormEvent)=>{e.preventDefault();const text=chatText.trim().replace(/\s+/g,' ').slice(0,280);if(!text)return;if(canSend)sendAction('chat:send',{scope,text});else if(networkState==='offline-preview')setChat(v=>[...v,{id:`local-${Date.now()}`,scope,from:player.name,text,roomId:player.roomId,sentAt:Date.now()}]);setChatText('')};
 const openPhone=()=>{const phone=player.inventory.find(i=>i.templateId==='phone.basic');if(phone&&canSend)sendAction('phone:open');else if(phone&&networkState==='offline-preview'){setPhoneState({owner:{name:player.name,phoneNumber:player.phoneNumber},apps:[{id:'messages',label:'Messages'},{id:'calls',label:'Calls'}],contacts:[],messages:[]});setPhoneOpen(true)}};
 const openPhoneApp=(app:{id:string;action?:string})=>{setPhoneApp(app.id);setPhonePanel(null);if(canSend&&app.action)sendAction(app.action)};
 const startCall=(to:string)=>sendAction('phone:startCall',{to});const answerCall=()=>sendAction('phone:answerCall');const declineCall=()=>sendAction('phone:declineCall');const endCall=()=>sendAction('phone:endCall');
 const sendCallText=(e:FormEvent)=>{e.preventDefault();const text=callText.trim();if(text&&canSend)sendAction('phone:sendCallText',{text});setCallText('')};
 const sendPhoneMessage=(e:FormEvent)=>{e.preventDefault();const text=messageText.trim();if(text&&messageTo&&canSend)sendAction('phone:sendMessage',{to:messageTo,text});setMessageText('')};
 const chooseChase=(choice:string)=>sendAction('chase:choose',{choice});
 const travelProgress=travel?Math.max(0,Math.min(1,(Date.now()-travel.startedAt)/Math.max(1,travel.arriveAt-travel.startedAt))):0;
 const sceneRoom=(publicView?.roomId===player.roomId?publicView.room:room) as RoomDef;
 const hereObjects=(publicView?.roomId===player.roomId?publicView.room.objects:room.objects) as readonly WorldObject[];
 const otherOccupants=(publicView?.roomId===player.roomId?publicView.occupants:[]).filter(o=>o.characterId!==player.characterId);
 const networkLabel=networkState==='live'?'LIVE SERVER':networkState==='offline-preview'?'OFFLINE VISUAL PREVIEW':networkState.toUpperCase();

 return <main className="shell">
  <header><div className="brand"><b>PORT MERCY</b><span> persistent city</span></div><div className={`server ${networkState}`}><i/> {networkLabel} <em>WORLD {heartbeatLabel}</em>{incomingAlert&&<button className="incomingCall" onClick={openPhone}>INCOMING CALL</button>}</div></header>
  <aside className="left panel"><section><div className="eyebrow">CHARACTER</div><h2>{player.name}</h2><div className="stat"><span>Cash</span><b>${player.cash}</b></div><div className="stat"><span>Bank</span><b>${player.bank}</b></div><div className="stat"><span>Health</span><b>{player.health}</b></div><div className="stat"><span>Stress</span><b>{player.stress}%</b></div><div className="stat"><span>Job</span><b>{player.job}</b></div>{player.activity&&<div className="activityBadge">{player.activity.kind.toUpperCase()}</div>}</section><section className="gameMenu"><div className="eyebrow">MENU</div><button className="menuButton" disabled={networkState==='disconnected'||networkState==='reconnecting'} onClick={openOwnInventory}><span>Inventory</span><small>{player.inventory.length}</small></button><button className="menuButton" onClick={openPhone}><span>Phone</span><small>›</small></button></section></aside>
  <section className="center"><div className="roomTitle"><div><small>{travel?'IN TRANSIT':sceneRoom.district+' · Harbor County'}</small><h1>{travel?`Driving toward ${rooms[travel.destination].name}`:sceneRoom.name}</h1></div><span>{travel?'southward.roads.travel':sceneRoom.id}</span></div><Scene room={sceneRoom} weather={weather} travel={travel} travelFrame={travelFrame} publicView={publicView}/>{travel?<p className="desc">{travel.route||'Port Mercy streets'} · {Math.max(0,Math.ceil((travel.arriveAt-Date.now())/1000))}s remaining</p>:<p className="desc">{sceneRoom.description}</p>}
   {travel&&<div className="travelTrack"><div className="travelFill" style={{width:`${travelProgress*100}%`}}/></div>}
   {chase?<div className="chaseBar"><span className="eyebrow">CHASE</span><b>{chase.pursuer}</b>{['push','swerve','hide','brake'].map(c=><button key={c} onClick={()=>chooseChase(c)}>{c}</button>)}</div>:<div className="commandBar"><span className="eyebrow">DO</span>{canSend?(roomInteractions.length?roomInteractions.map(option=><button key={option.id} onClick={()=>runInteraction(`room:${player.roomId}`,option)}>{option.label}</button>):<span className="empty">Nothing special to do here.</span>):networkState==='offline-preview'?<span className="empty">Visual preview — connect the server for authoritative actions.</span>:<span className="empty">Authoritative actions unavailable while disconnected.</span>}</div>}
   <div className="exits"><span className="eyebrow">GO</span>{travel?<span className="empty">You are on the road.</span>:Object.keys(sceneRoom.exits).map(d=><button disabled={!canSend&&networkState!=='offline-preview'} key={d} onClick={()=>move(d)}>{d.toUpperCase()}</button>)}</div>
   <div className="activity"><div className="sectionHead"><span className="eyebrow">ROOM ACTIVITY</span><small>{events.length}/40</small></div><div className="activityLog" ref={activityRef}>{events.map((e,i)=><p key={`${i}-${e}`}>{e}</p>)}</div></div>
  </section>
  <aside className="right panel"><section><div className="sectionHead"><span className="eyebrow">HERE</span><small>{hereObjects.length+otherOccupants.length} visible</small></div>{otherOccupants.map(o=><div className="entity" key={o.characterId}><div><b>{o.name}</b><small>PLAYER · {o.job}</small></div></div>)}{hereObjects.map(o=>{const opts=interactionLists[o.targetId]??[];return <div className="entity" key={o.id}><div><b>{o.label}</b><small>{o.kind}</small></div>{opts[0]&&<button onClick={()=>runInteraction(o.targetId,opts[0])}>{opts[0].label}</button>}</div>})}</section>
   <section className="chat"><div className="chatHead"><span className="eyebrow">CHAT</span><div><button className={scope==='room'?'active':''} onClick={()=>setScope('room')}>ROOM</button><button className={scope==='global'?'active':''} onClick={()=>setScope('global')}>GLOBAL</button></div></div><div className="messages">{visibleChat.map(m=><div className="message" key={m.id}><div><b>{m.from}</b><small>{m.scope}</small></div><p>{m.text}</p></div>)}</div><form onSubmit={sendChat}><input disabled={networkState!=='live'&&networkState!=='offline-preview'} value={chatText} onChange={e=>setChatText(e.target.value)} placeholder="Say something…"/><button>Send</button></form></section>
  </aside>
  <footer><span>PORT MERCY v{GAME_VERSION}</span><span>{resourceCount||'—'} RESOURCES · {networkState==='offline-preview'?'PREVIEW IS NOT MULTIPLAYER PROOF':'SERVER AUTHORITATIVE'}</span></footer>

  {inventoryOpen&&<div className="modalShade" role="dialog" aria-modal="true" aria-label="Inventory"><div className="inventoryModal"><div className="modalHead"><div><div className="eyebrow">INVENTORY</div><h2>{inventoryContext?.label||'Inventory'}</h2></div><button autoFocus className="closeButton" onClick={closeInventory}>×</button></div><div className="inventoryBody"><div className="itemList">{displayItems.map(i=><button className={`item ${selected===i.id?'selected':''}`} key={i.id} onClick={()=>setSelected(i.id)}><span>{i.name}</span><small>{i.kind}</small></button>)}</div><div className="inventoryDetail">{selectedItem?<><div className="itemDetail"><b>{selectedItem.name}</b><p>{selectedItem.description}</p><small>{selectedItem.weight} lb</small></div>{selectedItem.kind==='document'&&selectedItem.metadata?.documentType==='drivers_license'&&<div className="licenseCard"><div className="licenseTop"><div><small>PORT MERCY</small><strong>DRIVER LICENSE</strong></div><span>CLASS {selectedItem.metadata.licenseClass||'C'}</span></div><dl>{[['Name',selectedItem.metadata.legalName],['DOB',selectedItem.metadata.dateOfBirth],['Address',selectedItem.metadata.address],['License',selectedItem.metadata.licenseNumber],['Sex',selectedItem.metadata.sexMarker],['Eyes',selectedItem.metadata.eyes]].map(([k,v])=><div key={k}><dt>{k}</dt><dd>{String(v||'—')}</dd></div>)}</dl></div>}<div className="miniActions"><button disabled={!selectedItem.usable} onClick={useItem}>Use</button><button disabled={!selectedItem.droppable} onClick={dropItem}>Drop</button>{inventoryContext?.type!=='player'&&<button onClick={takeFromOpenInventory}>Take</button>}</div></>:<div className="empty">Select an item.</div>}</div></div></div></div>}

  {phoneOpen&&<div className="modalShade" role="dialog" aria-modal="true" aria-label="Phone"><div className="phoneModal"><div className="phoneBar"><span>{phoneState?.owner?.phoneNumber||player.phoneNumber}</span><button autoFocus className="phoneClose" onClick={()=>setPhoneOpen(false)}>×</button></div><div className="phoneHome"><div className="phoneApps">{phoneState?.apps?.map(app=><button className="phoneApp" key={app.id} onClick={()=>openPhoneApp(app)}><b>{app.label}</b><small>{app.id}</small></button>)}</div><div className="phonePane"><h3>{phoneApp.toUpperCase()}</h3>{phoneApp==='calls'?<CallPane state={phoneState} onCall={startCall} onAnswer={answerCall} onDecline={declineCall} onEnd={endCall} callText={callText} setCallText={setCallText} onSend={sendCallText}/>:phoneApp==='messages'?<><div className="phoneList">{(phoneState?.messages||[]).slice(-12).map((m:any)=><div className="phoneRow" key={m.id}><span><b>{m.fromName}</b><br/>{m.text}</span></div>)}</div><form onSubmit={sendPhoneMessage}><select value={messageTo} onChange={e=>setMessageTo(e.target.value)}>{phoneState?.contacts?.map(c=><option value={c.phoneNumber} key={c.phoneNumber}>{c.name}</option>)}</select><input value={messageText} onChange={e=>setMessageText(e.target.value)} placeholder="Text message"/><button>Send</button></form></>:phonePanel?<pre className="phoneData">{JSON.stringify(phonePanel,null,2)}</pre>:<p>Select an app or contact.</p>}</div></div></div></div>}
 </main>;
}

function CallPane({state,onCall,onAnswer,onDecline,onEnd,callText,setCallText,onSend}:{state:PhoneState|null;onCall:(to:string)=>void;onAnswer:()=>void;onDecline:()=>void;onEnd:()=>void;callText:string;setCallText:(v:string)=>void;onSend:(e:FormEvent)=>void}){
 const call=state?.activeCall;if(!call)return <div className="phoneList">{state?.contacts?.map(c=><div className="phoneRow" key={c.phoneNumber}><span>{c.name}<br/><small>{c.phoneNumber}</small></span><button onClick={()=>onCall(c.phoneNumber)}>Call</button></div>)}</div>;
 const incoming=call.status==='ringing'&&call.calleeNumber===state?.owner?.phoneNumber;
 return <>{incoming&&<div className="callControls"><button onClick={onAnswer}>Answer</button><button onClick={onDecline}>Decline</button></div>}<p>{call.status} · {incoming?call.callerName:call.calleeName}</p><div className="callTranscript">{(call.transcript||[]).map((line:any)=><p key={line.id}><b>{line.fromName}:</b> {line.text}</p>)}</div>{call.status==='connected'&&<><form onSubmit={onSend}><input value={callText} onChange={e=>setCallText(e.target.value)} placeholder="Type during call"/><button>Send</button></form><button onClick={onEnd}>Hang up</button></>}</>;
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>);
