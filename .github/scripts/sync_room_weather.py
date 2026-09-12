from pathlib import Path
import re


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise SystemExit(f"missing pattern: {label}")
    return text.replace(old, new, 1)

# ---------- web client ----------
p = Path("apps/web/src/main.tsx")
s = p.read_text()
s = replace_once(
    s,
    "type RoomId='southward.gas.forecourt'|'southward.diner'|'southward.alley'|'southward.apartment.lobby';",
    "type RoomId='southward.gas.forecourt'|'southward.mercyfuel.interior'|'southward.diner'|'southward.alley'|'southward.apartment.lobby';",
    "web RoomId",
)
s = replace_once(
    s,
    "type RoomDef={id:RoomId;name:string;district:string;desc:string;exits:Record<string,RoomId>;objects:WorldObject[]};",
    "type RoomEnvironment='outdoor'|'indoor';\ntype RoomDef={id:RoomId;name:string;district:string;environment:RoomEnvironment;weatherZone:string;desc:string;exits:Record<string,RoomId>;objects:WorldObject[]};",
    "RoomDef",
)
s = replace_once(
    s,
    "type TravelState={status:string;origin:RoomId;destination:RoomId;startedAt:number;arriveAt:number;vehicleId:string;route?:string;progress?:number;remainingMs?:number;pauseReason?:string;seconds?:number};",
    "type TravelState={status:string;origin:RoomId;destination:RoomId;startedAt:number;arriveAt:number;vehicleId:string;route?:string;progress?:number;remainingMs?:number;pauseReason?:string;seconds?:number};\ntype WeatherKind='clear'|'rain'|'fog'|'snow'|'storm';\ntype WeatherState={zone:string;type:WeatherKind;label:string;detail:string;intensity:number;seed:number;startedAt:number;nextAt:number};",
    "WeatherState",
)

room_block = '''const rooms:Record<RoomId,RoomDef>={
 'southward.gas.forecourt':{id:'southward.gas.forecourt',name:'Mercy Fuel & Mart',district:'South Ward',environment:'outdoor',weatherZone:'southward',desc:'The forecourt sits between Harbor Avenue and the waterfront. Canopy lights wash over wet pumps and pavement while the store windows glow behind them.',exits:{west:'southward.diner',east:'southward.alley',inside:'southward.mercyfuel.interior'},objects:[{id:'car1',label:'faded blue sedan',kind:'vehicle',x:.73,y:.72},{id:'pump1',label:'fuel pumps',kind:'prop',x:.46,y:.68}]},
 'southward.mercyfuel.interior':{id:'southward.mercyfuel.interior',name:'Mercy Fuel · Store Interior',district:'South Ward',environment:'indoor',weatherZone:'southward',desc:'Warm fluorescents hum over the coolers, coffee station and a glossy tile floor tracked wet near the entrance. Harbor lights shimmer through the front glass.',exits:{outside:'southward.gas.forecourt'},objects:[{id:'npc1',label:'Maya Torres',kind:'npc',x:.76,y:.58},{id:'coffee1',label:'coffee station',kind:'prop',x:.32,y:.57},{id:'coolers1',label:'cold drink coolers',kind:'prop',x:.18,y:.48}]},
 'southward.diner':{id:'southward.diner',name:"Rita's Diner",district:'South Ward',environment:'indoor',weatherZone:'southward',desc:'A narrow twenty-four-hour diner with split vinyl booths, strong coffee and rain streaking the windows toward Harbor Avenue.',exits:{east:'southward.gas.forecourt'},objects:[{id:'npc2',label:'Rita Vale',kind:'npc',x:.66,y:.56}]},
 'southward.alley':{id:'southward.alley',name:'Mercy Service Alley',district:'South Ward',environment:'outdoor',weatherZone:'southward',desc:'Wet brick walls squeeze around dumpsters, utility pipes and a fire escape. A security lamp buzzes overhead beside the harbor wind.',exits:{west:'southward.gas.forecourt'},objects:[{id:'prop1',label:'padlocked dumpster',kind:'prop',x:.58,y:.68}]},
 'southward.apartment.lobby':{id:'southward.apartment.lobby',name:'Marrow Apartments',district:'South Ward',environment:'indoor',weatherZone:'southward',desc:'Peeling green paint, dented brass mailboxes and an elevator that smells faintly of hot wiring. Apartment 3B is upstairs. The lobby camera over the door has not worked in years.',exits:{},objects:[{id:'npc3',label:'tired tenant',kind:'npc',x:.61,y:.63}]}
};'''
s, n = re.subn(r"const rooms:Record<RoomId,RoomDef>=\{.*?\n\};", room_block, s, count=1, flags=re.S)
if n != 1:
    raise SystemExit("rooms block replacement failed")

s = replace_once(
    s,
    " const rain=new Graphics();for(let i=0;i<85;i++){const x=Math.random()*w,y=Math.random()*h;rain.moveTo(x,y).lineTo(x-5,y+17).stroke({width:1,color:0x86a9c2,alpha:.17})}app.stage.addChild(rain);",
    " if(room.environment==='outdoor'){const rain=new Graphics();for(let i=0;i<85;i++){const x=Math.random()*w,y=Math.random()*h;rain.moveTo(x,y).lineTo(x-5,y+17).stroke({width:1,color:0x86a9c2,alpha:.17})}app.stage.addChild(rain);}",
    "fallback rain gating",
)

scene_block = '''function WeatherOverlay({room,weather}:{room:RoomDef;weather:WeatherState}){
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

function App(){'''
s, n = re.subn(r"function Scene\(\{room\}:\{room:RoomDef\}\)\{.*?\n\}\n\nfunction App\(\)\{", scene_block, s, count=1, flags=re.S)
if n != 1:
    raise SystemExit("Scene replacement failed")

s = replace_once(
    s,
    " const [events,setEvents]=useState<string[]>(['Rain started twenty minutes ago.','A faded sedan idles beneath pump three.']);\n const [chat,setChat]=useState<ChatMsg[]>([{id:'hello',scope:'room',from:'Rita Vale',text:'If you are coming in, wipe your shoes. I just mopped.',roomId:'southward.gas.forecourt',sentAt:Date.now()-90000}]);",
    " const [eventsByRoom,setEventsByRoom]=useState<Partial<Record<RoomId,string[]>>>({'southward.gas.forecourt':['Rain started twenty minutes ago.','A faded sedan sits beneath pump three.'],'southward.mercyfuel.interior':['The cooler compressors hum behind the glass doors.'],'southward.diner':['The coffee burner clicks softly behind the counter.'],'southward.alley':['Water ticks from the fire escape into a dented drain.'],'southward.apartment.lobby':['The old elevator cables groan somewhere above.']});\n const [chat,setChat]=useState<ChatMsg[]>([{id:'hello',scope:'room',from:'Rita Vale',text:'If you are coming in, wipe your shoes. I just mopped.',roomId:'southward.diner',sentAt:Date.now()-90000}]);",
    "room event/chat seed",
)
s = replace_once(
    s,
    " const [travel,setTravel]=useState<TravelState|null>(null);\n const room=rooms[player.roomId];",
    " const [travel,setTravel]=useState<TravelState|null>(null);\n const [weather,setWeather]=useState<WeatherState>({zone:'southward',type:'rain',label:'Cold rain',detail:'harbor wind · wet pavement',intensity:.7,seed:4812,startedAt:Date.now(),nextAt:Date.now()+30*60_000});\n const room=rooms[player.roomId];\n const events=eventsByRoom[player.roomId]??[];",
    "weather state",
)
s = replace_once(
    s,
    " const push=(text:string)=>setEvents(v=>[...v.slice(-39),text]);",
    " const push=(text:string,roomId:RoomId=player.roomId)=>setEventsByRoom(v=>{const list=v[roomId]??[];return {...v,[roomId]:[...list.slice(-39),text]}});",
    "room push",
)
s = replace_once(
    s,
    "     joined.onMessage('travel_update',(m:TravelState)=>setTravel(m.status==='arrived'||m.status==='cancelled'?null:m));",
    "     joined.onMessage('travel_update',(m:TravelState)=>setTravel(m.status==='arrived'||m.status==='cancelled'?null:m));\n     joined.onMessage('weather_state',(m:WeatherState)=>setWeather(m));",
    "weather network",
)
s = replace_once(
    s,
    " const takeDrink=()=>{if(networkRoom){sendAction('world:take',{target:'energy_drink'});return;}if(player.inventory.some(i=>i.templateId==='drink.energy')){push('You already have a Redline in your bag.');return;}const item:Item={id:`drink-${Date.now()}`,templateId:'drink.energy',name:'Redline energy drink',kind:'consumable',quantity:1,weight:.35,description:'A dented can of something aggressively citrus.',usable:true,droppable:true,metadata:{}};setPlayer(p=>({...p,inventory:[...p.inventory,item]}));setSelected(item.id);push('You slip a Redline energy drink into your bag. The clerk looks up sharply.');setTimeout(()=>push('The night clerk steps away from the register and reaches for the phone.'),650)};",
    " const takeDrink=()=>{if(player.roomId!=='southward.mercyfuel.interior'){push('The drinks are inside the store.');return;}if(networkRoom){sendAction('world:take',{target:'energy_drink'});return;}if(player.inventory.some(i=>i.templateId==='drink.energy')){push('You already have a Redline in your bag.');return;}const item:Item={id:`drink-${Date.now()}`,templateId:'drink.energy',name:'Redline energy drink',kind:'consumable',quantity:1,weight:.35,description:'A dented can of something aggressively citrus.',usable:true,droppable:true,metadata:{}};setPlayer(p=>({...p,inventory:[...p.inventory,item]}));setSelected(item.id);push('You slip a Redline energy drink into your bag. Maya looks up sharply.');setTimeout(()=>push('Maya steps away from the register and reaches for the phone.'),650)};",
    "take drink",
)
s = s.replace("<Scene room={room}/>", "<Scene room={room} weather={weather}/>", 1)
old = "{player.roomId==='southward.gas.forecourt'&&<><button onClick={work}>Unload delivery</button><button onClick={takeDrink}>Pocket energy drink</button><button onClick={openSedanTrunk}>Open sedan trunk</button><button onClick={()=>startTravel('southward.diner')}>Drive to Rita's</button></>}"
new = "{player.roomId==='southward.gas.forecourt'&&<><button onClick={work}>Unload delivery</button><button onClick={()=>push('Pump three clicks and hums beneath the canopy. The card reader looks older than the rest of the hardware.')}>Inspect pumps</button><button onClick={openSedanTrunk}>Open sedan trunk</button><button onClick={()=>startTravel('southward.diner')}>Drive to Rita's</button></>}{player.roomId==='southward.mercyfuel.interior'&&<><button onClick={()=>push('Maya Torres glances up from the register and asks if you need anything from behind the counter.')}>Talk to Maya</button><button onClick={()=>setPlayer(p=>({...p,stress:Math.max(0,p.stress-2)}))}>Pour coffee</button><button onClick={()=>push('Rows of bottled drinks hum behind the glass, blue cooler lights flickering over the labels.')}>Browse coolers</button><button onClick={takeDrink}>Pocket energy drink</button></>}"
s = replace_once(s, old, new, "command bar")
s = s.replace("<span>v0.6.1 · {resourceCount?`${resourceCount} RESOURCES · `:''}WORLD HEARTBEAT {heartbeatLabel}</span>", "<span>v0.7 · {resourceCount?`${resourceCount} RESOURCES · `:''}SYNCED WEATHER · WORLD HEARTBEAT {heartbeatLabel}</span>", 1)
p.write_text(s)

# ---------- CSS ----------
p = Path("apps/web/src/styles.css")
s = p.read_text()
s = s.replace(".scene .roomArt{object-fit:cover;image-rendering:auto}", ".scene .roomArt{object-fit:cover;image-rendering:auto}.pixiHost{position:absolute;inset:0}")
if ".weatherLayer{" not in s:
    s += """
.weatherLayer{position:absolute;inset:0;pointer-events:none;overflow:hidden;z-index:2}.weatherHud{position:absolute;left:12px;top:12px;z-index:3;display:flex;align-items:center;gap:10px;padding:7px 10px;border-radius:8px;background:#091019cf;border:1px solid #31404f;color:#d7e0e7;box-shadow:0 8px 24px #0006}.weatherHud b{display:block;font-size:10px;letter-spacing:.16em;color:#8da0b1;text-transform:uppercase}.weatherHud span{display:block;font-size:12px;font-weight:700}.weatherHud small{display:block;font-size:9px;color:#8fa2b3;white-space:nowrap}.weatherDot{width:10px;height:10px;border-radius:50%;background:#83a7c5;box-shadow:0 0 10px #83a7c599;flex:0 0 auto}.weatherLayer .weatherTint,.weatherLayer .weatherGlow,.weatherLayer .weatherFlash{position:absolute;inset:0}.weatherLayer.rain .weatherTint{background:linear-gradient(180deg,#10223588 0,#12233338 28%,#0a0f154e 100%)}.weatherLayer.storm .weatherTint{background:linear-gradient(180deg,#13263aaa 0,#0e17245c 28%,#070b1158 100%)}.weatherLayer.snow .weatherTint{background:linear-gradient(180deg,#24364d60 0,#dce5f010 30%,#0a0e1338 100%)}.weatherLayer.fog .weatherTint{background:linear-gradient(180deg,#15212975 0,#2c394250 40%,#1a202638 100%)}.rainDrop{position:absolute;top:-14%;width:2px;height:12%;background:linear-gradient(180deg,#dff5ff00 0,#c0d8ec 35%,#f7fbff 100%);transform:skewX(-16deg);animation:pmRain linear infinite}.snowFlake{position:absolute;top:-8%;width:5px;height:5px;border-radius:50%;background:#f4f8ff;opacity:.85;box-shadow:0 0 7px #ffffff88;animation:pmSnow linear infinite}.fogBand{position:absolute;left:-18%;width:62%;height:24%;border-radius:999px;background:linear-gradient(90deg,#dfe8f100 0,#dfe8f126 18%,#dfe8f142 50%,#dfe8f122 82%,#dfe8f100 100%);filter:blur(20px);opacity:.55;animation:pmFog linear infinite}.weatherLayer.storm .weatherFlash{animation:pmFlash 9s linear infinite}@keyframes pmRain{0%{transform:translate3d(0,-12%,0) skewX(-16deg);opacity:0}12%{opacity:.34}100%{transform:translate3d(-7vw,128%,0) skewX(-16deg);opacity:0}}@keyframes pmSnow{0%{transform:translate3d(0,-10%,0)}100%{transform:translate3d(6vw,122%,0)}}@keyframes pmFog{0%{transform:translate3d(0,0,0)}50%{transform:translate3d(11%,0,0)}100%{transform:translate3d(0,0,0)}}@keyframes pmFlash{0%,18%,20%,21%,100%{background:#ffffff00}18.6%{background:#ffffff14}19.1%{background:#ffffff08}20.4%{background:#ffffff1c}}
"""
p.write_text(s)

# ---------- authoritative server ----------
p = Path("apps/server/src/index.ts")
s = p.read_text()
s = replace_once(s, "type RoomId = 'southward.gas.forecourt'|'southward.diner'|'southward.alley'|'southward.apartment.lobby';", "type RoomId = 'southward.gas.forecourt'|'southward.mercyfuel.interior'|'southward.diner'|'southward.alley'|'southward.apartment.lobby';", "server RoomId")
exit_block = '''const EXITS:Record<RoomId,Record<string,RoomId>> = {
  'southward.gas.forecourt': { west:'southward.diner', east:'southward.alley', inside:'southward.mercyfuel.interior' },
  'southward.mercyfuel.interior': { outside:'southward.gas.forecourt' },
  'southward.diner': { east:'southward.gas.forecourt' },
  'southward.alley': { west:'southward.gas.forecourt' },
  'southward.apartment.lobby': {}
};'''
s, n = re.subn(r"const EXITS:Record<RoomId,Record<string,RoomId>> = \{.*?\n\};", exit_block, s, count=1, flags=re.S)
if n != 1: raise SystemExit("server exits replacement failed")
names_block = '''const ROOM_NAMES:Record<RoomId,{name:string;district:string;environment:'outdoor'|'indoor';weatherZone:string}> = {
  'southward.gas.forecourt': {name:'Mercy Fuel & Mart',district:'South Ward',environment:'outdoor',weatherZone:'southward'},
  'southward.mercyfuel.interior': {name:'Mercy Fuel · Store Interior',district:'South Ward',environment:'indoor',weatherZone:'southward'},
  'southward.diner': {name:"Rita's Diner",district:'South Ward',environment:'indoor',weatherZone:'southward'},
  'southward.alley': {name:'Mercy Service Alley',district:'South Ward',environment:'outdoor',weatherZone:'southward'},
  'southward.apartment.lobby': {name:'Marrow Apartments',district:'South Ward',environment:'indoor',weatherZone:'southward'},
};'''
s, n = re.subn(r"const ROOM_NAMES:Record<RoomId,\{name:string;district:string\}> = \{.*?\n\};", names_block, s, count=1, flags=re.S)
if n != 1: raise SystemExit("room names replacement failed")
s = replace_once(s, "type VehicleRecord = {id:string;label:string;roomId:RoomId;status:string;locked:boolean;ownerId:string|null;registration:string;fuel:number;condition:number};", "type VehicleRecord = {id:string;label:string;roomId:RoomId;status:string;locked:boolean;ownerId:string|null;registration:string;fuel:number;condition:number};\ntype WeatherKind='clear'|'rain'|'fog'|'snow'|'storm';\ntype WeatherWire={zone:string;type:WeatherKind;label:string;detail:string;intensity:number;seed:number;startedAt:number;nextAt:number};\nconst WEATHER_STEPS:Array<Omit<WeatherWire,'zone'|'seed'|'startedAt'|'nextAt'>>=[{type:'rain',label:'Cold rain',detail:'harbor wind · wet pavement',intensity:.7},{type:'fog',label:'Dense fog',detail:'low visibility · harbor mist',intensity:.65},{type:'clear',label:'Clear night',detail:'cool air · dry streets',intensity:0},{type:'snow',label:'Wet snow',detail:'slush building on exposed streets',intensity:.55},{type:'storm',label:'Harbor squall',detail:'heavy rain · hard gusts',intensity:.9}];\nfunction makeWeather(index:number):WeatherWire{const base=WEATHER_STEPS[index%WEATHER_STEPS.length],now=Date.now();return {zone:'southward',...base,seed:Math.floor(Math.random()*1_000_000),startedAt:now,nextAt:now+30*60_000}}", "server weather types")
s = replace_once(s, "  private incidents:Incident[]=[];", "  private incidents:Incident[]=[];\n  private weatherIndex=0;\n  private weather:WeatherWire=makeWeather(0);", "server weather fields")
s = replace_once(s, "    this.heartbeat.start();", "    this.heartbeat.start();\n    this.clock.setInterval(()=>this.advanceWeather(),30*60_000);", "weather timer")
s = replace_once(s, "    client.send('resource_status',{resources:this.runtime.listResources()});", "    client.send('resource_status',{resources:this.runtime.listResources()});\n    client.send('weather_state',this.weather);", "weather join")
s = replace_once(s, "  private makeHeartbeatSnapshot(sequence:number):WorldSnapshot{", "  private advanceWeather(){this.weatherIndex=(this.weatherIndex+1)%WEATHER_STEPS.length;this.weather=makeWeather(this.weatherIndex);this.broadcast('weather_state',this.weather);const text=`Weather shifts across South Ward: ${this.weather.label.toLowerCase()}.`;for(const roomId of Object.keys(ROOM_NAMES) as RoomId[]){if(ROOM_NAMES[roomId].environment==='outdoor')this.remember(roomId,text)}}\n\n  private makeHeartbeatSnapshot(sequence:number):WorldSnapshot{", "weather method")
s = s.replace("      weather:'Cold coastal rain, wet pavement, low cloud and light harbor wind.',", "      weather:`${this.weather.label}: ${this.weather.detail}`,")
s = s.replace("        {id:'mercy.fuel.clerk',name:'Night clerk',roomId:'southward.gas.forecourt',role:'night cashier',motivation:'Finish the shift safely, avoid theft, and keep the pumps working.'},", "        {id:'mercy.fuel.clerk',name:'Maya Torres',roomId:'southward.mercyfuel.interior',role:'night cashier',motivation:'Finish the shift safely, avoid theft, and keep the store and pumps running.'},")
s = s.replace("        {id:'mercy.fuel',name:'Mercy Fuel & Mart',roomId:'southward.gas.forecourt',open:true,pressure:'thin overnight staffing and aging pumps'},", "        {id:'mercy.fuel',name:'Mercy Fuel & Mart',roomId:'southward.mercyfuel.interior',open:true,pressure:'thin overnight staffing and aging pumps'},")
s = s.replace("app.get('/health',(_q,r)=>r.json({ok:true,service:'port-mercy',version:'0.6.0'}));", "app.get('/health',(_q,r)=>r.json({ok:true,service:'port-mercy',version:'0.7.0'}));")
p.write_text(s)

# ---------- world resource ----------
p = Path("resources/pm-world/server.mjs")
s = p.read_text()
s = s.replace("player.roomId !== 'southward.gas.forecourt'", "player.roomId !== 'southward.mercyfuel.interior'")
s = s.replace("The clerk looks up sharply.", "Maya looks up sharply.")
s = s.replace("The night clerk steps away from the register and reaches for the phone.", "Maya steps away from the register and reaches for the phone.")
s = s.replace("The night clerk witnessed a customer pocket an energy drink and reached for the phone.", "Maya Torres witnessed a customer pocket an energy drink and reached for the phone.")
p.write_text(s)

# ---------- shared protocol ----------
p = Path("packages/protocol/src/index.ts")
s = p.read_text().replace("export type RoomId = 'southward.gas.forecourt'|'southward.diner'|'southward.alley'|'southward.apartment.lobby';", "export type RoomId = 'southward.gas.forecourt'|'southward.mercyfuel.interior'|'southward.diner'|'southward.alley'|'southward.apartment.lobby';")
s = s.replace("  district:string;\n  description:string;", "  district:string;\n  environment:'outdoor'|'indoor';\n  weatherZone:string;\n  description:string;")
if "export type WeatherState" not in s:
    s += "\nexport type WeatherState={zone:string;type:'clear'|'rain'|'fog'|'snow'|'storm';label:string;detail:string;intensity:number;seed:number;startedAt:number;nextAt:number};\n"
p.write_text(s)

# ---------- standalone repo preview minimal consistency ----------
p = Path("preview.html")
s = p.read_text()
s = s.replace("gas:{id:'southward.gas.forecourt',name:'Mercy Fuel & Mart',district:'South Ward · Harbor County',desc:'Rain freckles the forecourt beneath washed-out canopy lights. The convenience store windows are caged in steel, and traffic from Harbor Avenue throws wet reflections across the pumps.',ex:{WEST:'diner',EAST:'alley',INSIDE:'lobby'},ents:[['faded blue sedan','vehicle'],['night clerk','npc']]},", "gas:{id:'southward.gas.forecourt',name:'Mercy Fuel & Mart',district:'South Ward · Harbor County',environment:'outdoor',desc:'The forecourt sits between Harbor Avenue and the waterfront. Canopy lights wash over wet pumps and pavement while the store windows glow behind them.',ex:{WEST:'diner',EAST:'alley',INSIDE:'store'},ents:[['faded blue sedan','vehicle'],['fuel pumps','prop']]},")
s = s.replace(" diner:{id:'southward.diner',name:\"Rita's Diner\",district:'South Ward · Harbor County',desc:", " diner:{id:'southward.diner',name:\"Rita's Diner\",district:'South Ward · Harbor County',environment:'indoor',desc:")
s = s.replace(" alley:{id:'southward.alley',name:'Mercy Service Alley',district:'South Ward · Harbor County',desc:", " alley:{id:'southward.alley',name:'Mercy Service Alley',district:'South Ward · Harbor County',environment:'outdoor',desc:")
s = s.replace(" lobby:{id:'southward.apartment.lobby',name:'Marrow Apartments',district:'South Ward · Harbor County',desc:'Peeling green paint, dented brass mailboxes and an elevator that smells faintly of hot wiring. Apartment 3B is upstairs. The lobby camera over the door has not worked in years.',ex:{OUTSIDE:'gas'},ents:[['tired tenant','npc']]}", " store:{id:'southward.mercyfuel.interior',name:'Mercy Fuel · Store Interior',district:'South Ward · Harbor County',environment:'indoor',desc:'Warm fluorescents hum over the coolers and coffee station. Harbor lights shimmer through the front glass.',ex:{OUTSIDE:'gas'},ents:[['Maya Torres','npc'],['coffee station','prop'],['cold drink coolers','prop']]}")
s = s.replace("room:'gas',time:new Date(Date.now()-90000)", "room:'diner',time:new Date(Date.now()-90000)")
s = s.replace("room==='lobby'", "room==='store'")
s = s.replace("The clerk looks up sharply.", "Maya looks up sharply.").replace("The night clerk steps away from the register and reaches for the phone.", "Maya steps away from the register and reaches for the phone.")
p.write_text(s)

print("Port Mercy room/weather source patch complete")
