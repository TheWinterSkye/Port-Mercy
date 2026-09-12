import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface, type Interface } from 'node:readline';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { GAME_VERSION } from '@portmercy/protocol';

export type HeartbeatMode='codex'|'offline';
export type HeartbeatRoom={id:string;name:string;district:string;occupants:string[];recentActivity:string[]};
export type HeartbeatPlayer={id:string;name:string;roomId:string;job:string;cash:number;health:number;stress:number;inventory:string[];skills:Array<{id:string;value:number}>};
export type WorldSnapshot={
  city:'Port Mercy';heartbeatNumber:number;capturedAt:string;worldClock:string;weather:string;eventCursor:number;
  rooms:HeartbeatRoom[];players:HeartbeatPlayer[];
  npcs:Array<{id:string;name:string;roomId:string;role:string;motivation:string;intent?:string}>;
  businesses:Array<{id:string;name:string;roomId:string;open:boolean;pressure:string;status?:string}>;
  vehicles:Array<{id:string;label:string;roomId:string;status:string}>;
  housing:Array<{id:string;label:string;roomId:string;status:string}>;
  police:{activeCalls:Array<{roomId:string;reason:string;priority:number}>};
  jobMarket:Array<{id:string;name:string;roomId:string;status:string;demand:string}>;
  incidents:Array<{id:string;type:string;roomId:string;status:string;summary:string;createdAt:number}>;
  economy:{notes:string[]};
  recentEvents:Array<{sequence:number;name:string;at:number;resource:string;actorId:string|null;roomId:string|null;detail?:unknown;summary?:unknown}>;
  resourceState:Record<string,unknown>;
};

export type WorldMutation=
 |{type:'room_event';roomId:string;text:string}
 |{type:'npc_intent';npcId:string;roomId:string;action:string;text:string}
 |{type:'business_event';businessId:string;roomId:string;text:string;open?:boolean;status?:string}
 |{type:'job_event';jobId:string;roomId:string;text:string}
 |{type:'vehicle_event';vehicleId:string;roomId:string;text:string}
 |{type:'housing_event';propertyId:string;roomId:string;text:string}
 |{type:'police_dispatch';roomId:string;reason:string;priority:number;text:string}
 |{type:'economy_event';text:string};

export type HeartbeatResult={mode:HeartbeatMode;summary:string;mutations:WorldMutation[];generatedAt:number;eventCursor:number};
export interface HeartbeatProvider{readonly mode:HeartbeatMode;run(snapshot:WorldSnapshot):Promise<HeartbeatResult>;close():Promise<void>}

const OUTPUT_SCHEMA={type:'object',properties:{summary:{type:'string',maxLength:600},mutations:{type:'array',maxItems:12,items:{type:'object',properties:{type:{type:'string',enum:['room_event','npc_intent','business_event','job_event','vehicle_event','housing_event','police_dispatch','economy_event']},roomId:{type:['string','null'],maxLength:120},text:{type:'string',maxLength:320},npcId:{type:['string','null'],maxLength:120},action:{type:['string','null'],maxLength:120},businessId:{type:['string','null'],maxLength:120},jobId:{type:['string','null'],maxLength:120},vehicleId:{type:['string','null'],maxLength:120},propertyId:{type:['string','null'],maxLength:120},reason:{type:['string','null'],maxLength:180},priority:{type:['integer','null'],minimum:1,maximum:5},open:{type:['boolean','null']},status:{type:['string','null'],maxLength:80}},required:['type','roomId','text','npcId','action','businessId','jobId','vehicleId','propertyId','reason','priority'],additionalProperties:false}}},required:['summary','mutations'],additionalProperties:false} as const;

const HEARTBEAT_INSTRUCTIONS=`You are the hourly world heartbeat for Port Mercy, a gritty modern persistent multiplayer MUD with graphical rooms.
The game server is authoritative. Do not directly edit player cash, health, stress, inventory, ownership, skills, or criminal records. Propose only bounded world mutations; the server validates them.
RecentEvents is the canonical stream of meaningful events since the last successfully acknowledged heartbeat. Omitted private/UI events are intentionally unavailable. Do not infer private phone content.
Simulate a busy world that does not wait for players. NPCs have motives. Businesses have mundane problems. Police respond to concrete incidents, witnesses and evidence; there is no abstract heat meter. Keep most heartbeats restrained. Do not make players the center of the city.
Use only IDs in the snapshot. Prefer 0-5 meaningful mutations. For fields that do not apply, return null. Return only the requested schema.`;

function safeJsonParse<T>(text:string):T|null{try{return JSON.parse(text) as T}catch{return null}}
function boundedString(value:unknown,max:number,required=true){if(typeof value!=='string')return required?null:'';const v=value.trim();if(required&&!v)return null;if(v.length>max)return null;return v;}
function object(value:unknown):Record<string,unknown>|null{return value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:null;}

export function validateHeartbeatOutput(value:unknown):{summary:string;mutations:WorldMutation[]}{
  const root=object(value);if(!root)throw new Error('Heartbeat output must be an object.');
  const summary=boundedString(root.summary,600);if(summary===null)throw new Error('Heartbeat summary is invalid.');
  if(!Array.isArray(root.mutations)||root.mutations.length>12)throw new Error('Heartbeat mutations must be an array of at most 12 items.');
  const mutations:WorldMutation[]=[];
  for(const raw of root.mutations){
    const row=object(raw);if(!row)throw new Error('Heartbeat mutation must be an object.');
    const type=boundedString(row.type,40);const text=boundedString(row.text,320);if(type===null||text===null)throw new Error('Heartbeat mutation type/text is invalid.');
    const roomId=boundedString(row.roomId,120,false)||'';
    switch(type){
      case 'room_event':if(!roomId)throw new Error('room_event requires roomId.');mutations.push({type,roomId,text});break;
      case 'npc_intent':{const npcId=boundedString(row.npcId,120),action=boundedString(row.action,120);if(!roomId||npcId===null||action===null)throw new Error('npc_intent is invalid.');mutations.push({type,npcId,roomId,action,text});break;}
      case 'business_event':{const businessId=boundedString(row.businessId,120);if(!roomId||businessId===null)throw new Error('business_event is invalid.');const status=boundedString(row.status,80,false)||undefined;const open=typeof row.open==='boolean'?row.open:undefined;mutations.push({type,businessId,roomId,text,status,open});break;}
      case 'job_event':{const jobId=boundedString(row.jobId,120);if(!roomId||jobId===null)throw new Error('job_event is invalid.');mutations.push({type,jobId,roomId,text});break;}
      case 'vehicle_event':{const vehicleId=boundedString(row.vehicleId,120);if(!roomId||vehicleId===null)throw new Error('vehicle_event is invalid.');mutations.push({type,vehicleId,roomId,text});break;}
      case 'housing_event':{const propertyId=boundedString(row.propertyId,120);if(!roomId||propertyId===null)throw new Error('housing_event is invalid.');mutations.push({type,propertyId,roomId,text});break;}
      case 'police_dispatch':{const reason=boundedString(row.reason,180),priority=Number(row.priority);if(!roomId||reason===null||!Number.isInteger(priority)||priority<1||priority>5)throw new Error('police_dispatch is invalid.');mutations.push({type,roomId,reason,priority,text});break;}
      case 'economy_event':mutations.push({type,text});break;
      default:throw new Error(`Unknown heartbeat mutation type: ${type}`);
    }
  }
  return {summary,mutations};
}

export class OfflineHeartbeatProvider implements HeartbeatProvider{
  readonly mode='offline' as const;
  async run(snapshot:WorldSnapshot):Promise<HeartbeatResult>{
    const mutations:WorldMutation[]=[];const n=snapshot.heartbeatNumber;
    if(n%2===0)mutations.push({type:'room_event',roomId:'southward.gas.forecourt',text:'A delivery van noses under the fuel canopy, idles for a minute, then pulls around toward the service lane.'});
    if(n%3===0)mutations.push({type:'npc_intent',npcId:'rita.vale',roomId:'southward.diner',action:'close_out_register',text:'Rita counts the register twice, writes a figure on the back of a receipt, and tucks it under the till.'});
    if(n%5===0)mutations.push({type:'business_event',businessId:'mercy.fuel',roomId:'southward.gas.forecourt',status:'pump_2_out_of_order',text:'Pump two clicks off with a fault light. Maya writes the failure into the shift log.'});
    return {mode:this.mode,summary:mutations.length?`Offline fallback advanced ${mutations.length} world thread(s).`:'Offline fallback heartbeat completed quietly.',mutations,generatedAt:Date.now(),eventCursor:snapshot.eventCursor};
  }
  async close(){}
}

type PendingRequest={resolve:(value:any)=>void;reject:(error:Error)=>void;timeout:NodeJS.Timeout};
export class CodexHeartbeatProvider implements HeartbeatProvider{
  readonly mode='codex' as const;
  private child:ChildProcessWithoutNullStreams|null=null;private lines:Interface|null=null;private nextId=1;private pending=new Map<number,PendingRequest>();private threadId:string|null=null;
  private agentTextByTurn=new Map<string,string>();private activeTurnId:string|null=null;private completedTurns=new Set<string>();private turnWaiters=new Map<string,{resolve:()=>void;reject:(error:Error)=>void;timeout:NodeJS.Timeout}>();
  constructor(private readonly command=process.env.PORT_MERCY_CODEX_COMMAND||'codex app-server',private readonly model=process.env.PORT_MERCY_CODEX_MODEL||'gpt-5.6-luna',private readonly effort=process.env.PORT_MERCY_CODEX_EFFORT||'low',private readonly cwd=process.env.PORT_MERCY_CODEX_CWD||join(tmpdir(),'port-mercy-heartbeat')){}

  private rejectAll(error:Error){for(const pending of this.pending.values()){clearTimeout(pending.timeout);pending.reject(error)}this.pending.clear();for(const waiter of this.turnWaiters.values()){clearTimeout(waiter.timeout);waiter.reject(error)}this.turnWaiters.clear();this.completedTurns.clear();this.agentTextByTurn.clear();this.activeTurnId=null;}
  private async ensureStarted(){
    if(this.child&&this.threadId)return;if(this.child&&!this.threadId)await this.close();mkdirSync(this.cwd,{recursive:true});
    this.child=spawn(this.command,{shell:true,cwd:this.cwd,stdio:['pipe','pipe','pipe'],windowsHide:true});
    this.child.stderr.on('data',chunk=>{const text=String(chunk).trim();if(text)console.warn(`[codex app-server] ${text}`)});
    this.child.on('exit',(code,signal)=>{this.rejectAll(new Error(`Codex app-server exited (${code??signal??'unknown'}).`));this.threadId=null;this.child=null});
    this.lines=createInterface({input:this.child.stdout});this.lines.on('line',line=>this.handleLine(line));
    await this.request('initialize',{clientInfo:{name:'port_mercy_world_heartbeat',title:'Port Mercy World Heartbeat',version:GAME_VERSION}});this.notify('initialized',{});
    const started=await this.request('thread/start',{model:this.model,cwd:this.cwd,approvalPolicy:'never',sandbox:'readOnly',serviceName:'port_mercy_world_heartbeat'});
    this.threadId=started?.thread?.id??null;if(!this.threadId)throw new Error('Codex app-server did not return a thread id.');
  }
  private handleLine(line:string){
    const msg=safeJsonParse<any>(line);if(!msg)return;
    if(typeof msg.id==='number'&&(msg.result!==undefined||msg.error!==undefined)){const pending=this.pending.get(msg.id);if(pending){clearTimeout(pending.timeout);this.pending.delete(msg.id);if(msg.error)pending.reject(new Error(msg.error?.message||JSON.stringify(msg.error)));else pending.resolve(msg.result)}return;}
    if(msg.method==='item/completed'){const item=msg.params?.item,turnId=msg.params?.turnId;if(turnId&&item?.type==='agentMessage'&&typeof item.text==='string')this.agentTextByTurn.set(turnId,item.text);return;}
    if(msg.method==='item/agentMessage/delta'){const turnId=msg.params?.turnId,delta=msg.params?.delta;if(turnId&&typeof delta==='string')this.agentTextByTurn.set(turnId,(this.agentTextByTurn.get(turnId)||'')+delta);return;}
    if(msg.method==='turn/completed'){const turnId=msg.params?.turn?.id||msg.params?.turnId;if(!turnId)return;const waiter=this.turnWaiters.get(turnId);if(waiter){clearTimeout(waiter.timeout);this.turnWaiters.delete(turnId);waiter.resolve()}else this.completedTurns.add(turnId);}
  }
  private write(message:unknown){if(!this.child?.stdin.writable)throw new Error('Codex app-server stdin is not writable.');this.child.stdin.write(`${JSON.stringify(message)}\n`);}
  private notify(method:string,params:unknown){this.write({method,params});}
  private request(method:string,params:unknown,timeoutMs=45_000):Promise<any>{const id=this.nextId++;return new Promise((resolve,reject)=>{const timeout=setTimeout(()=>{this.pending.delete(id);reject(new Error(`Timed out waiting for Codex ${method}.`))},timeoutMs);this.pending.set(id,{resolve,reject,timeout});this.write({method,id,params})});}

  async run(snapshot:WorldSnapshot):Promise<HeartbeatResult>{
    if(this.activeTurnId)throw new Error('A Codex heartbeat turn is already in flight.');
    await this.ensureStarted();if(!this.threadId)throw new Error('Codex heartbeat thread is unavailable.');
    const text=`${HEARTBEAT_INSTRUCTIONS}\n\nAUTHORITATIVE WORLD SNAPSHOT:\n${JSON.stringify(snapshot)}`;
    let turnId:string|undefined;
    try{
      const started=await this.request('turn/start',{threadId:this.threadId,input:[{type:'text',text}],cwd:this.cwd,model:this.model,effort:this.effort,summary:'concise',approvalPolicy:'never',sandboxPolicy:{type:'readOnly'},outputSchema:OUTPUT_SCHEMA},60_000);
      turnId=started?.turn?.id;if(!turnId)throw new Error('Codex heartbeat did not return a turn id.');this.activeTurnId=turnId;
      if(!this.completedTurns.delete(turnId))await new Promise<void>((resolve,reject)=>{const timeout=setTimeout(()=>{this.turnWaiters.delete(turnId!);reject(new Error('Codex heartbeat turn timed out.'))},120_000);this.turnWaiters.set(turnId!,{resolve,reject,timeout})});
      const raw=this.agentTextByTurn.get(turnId)||'';const parsed=safeJsonParse<unknown>(raw);const valid=validateHeartbeatOutput(parsed);
      return {mode:this.mode,summary:valid.summary,mutations:valid.mutations,generatedAt:Date.now(),eventCursor:snapshot.eventCursor};
    }finally{if(turnId){this.agentTextByTurn.delete(turnId);this.completedTurns.delete(turnId);const waiter=this.turnWaiters.get(turnId);if(waiter){clearTimeout(waiter.timeout);this.turnWaiters.delete(turnId)}}this.activeTurnId=null;}
  }
  async close(){this.lines?.close();this.lines=null;this.rejectAll(new Error('Codex heartbeat provider closed.'));if(this.child){this.child.kill();this.child=null}this.threadId=null;}
}

function heartbeatInterval(){const raw=Number(process.env.PORT_MERCY_HEARTBEAT_MS||3_600_000);return Number.isFinite(raw)&&raw>=60_000?Math.floor(raw):3_600_000;}
export class HeartbeatService{
  private readonly offline=new OfflineHeartbeatProvider();private codex:CodexHeartbeatProvider|null=null;private sequence=0;private running=false;private timer:NodeJS.Timeout|null=null;private inFlight=false;
  readonly intervalMs=heartbeatInterval();readonly preferred=(process.env.PORT_MERCY_HEARTBEAT_PROVIDER||'auto').toLowerCase();
  constructor(private readonly snapshot:(sequence:number)=>WorldSnapshot,private readonly apply:(result:HeartbeatResult)=>void|Promise<void>,private readonly status:(mode:HeartbeatMode,lastAt:number,sequence:number,summary:string)=>void){if(this.preferred!=='offline')this.codex=new CodexHeartbeatProvider();}
  start(){if(this.running)return;this.running=true;if(process.env.PORT_MERCY_HEARTBEAT_BOOT_TICK==='1')void this.tick();this.schedule();}
  private schedule(){if(!this.running)return;this.timer=setTimeout(async()=>{if(!this.running)return;try{await this.tick()}finally{this.schedule()}},this.intervalMs);this.timer.unref?.();}
  async tick(){
    if(this.inFlight||!this.running)return;this.inFlight=true;const sequence=++this.sequence;
    try{
      let snapshot:WorldSnapshot;try{snapshot=this.snapshot(sequence)}catch(error){console.error('[heartbeat] snapshot failed:',error);return;}
      let result:HeartbeatResult;
      if(this.codex){try{result=await this.codex.run(snapshot)}catch(error){console.warn(`[heartbeat] Codex unavailable; using offline fallback: ${error instanceof Error?error.message:String(error)}`);await this.codex.close();result=await this.offline.run(snapshot)}}else result=await this.offline.run(snapshot);
      try{await this.apply(result);this.status(result.mode,result.generatedAt,sequence,result.summary)}catch(error){console.error('[heartbeat] apply failed; event cursor not acknowledged:',error);}
    }finally{this.inFlight=false;}
  }
  async close(){this.running=false;if(this.timer){clearTimeout(this.timer);this.timer=null}await this.codex?.close();await this.offline.close();}
}
