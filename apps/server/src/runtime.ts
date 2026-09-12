import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export type AiVisibility = 'never' | 'summary' | 'full';
export type ActionSource = 'client' | 'resource' | 'heartbeat' | 'system';

export type GameEvent = {
  id: string;
  sequence: number;
  name: string;
  at: number;
  resource: string;
  correlationId: string;
  actorId?: string;
  roomId?: string;
  ai: AiVisibility;
  payload: unknown;
};

export type ActionRequest<T = unknown> = {
  actorId?: string;
  roomId?: string;
  source: ActionSource;
  payload: T;
  correlationId?: string;
};

export type ActionResult<T = unknown> =
  | { ok: true; value: T; correlationId: string }
  | { ok: false; reason: string; correlationId: string };

export type ResourceManifest = {
  name: string;
  version: string;
  description?: string;
  server: string;
  dependencies?: string[];
  clientActions?: string[];
  heartbeat?: { events?: Record<string, AiVisibility> };
};

export function validateManifest(value: unknown, source = 'pmresource.json'): ResourceManifest {
  if (!value || typeof value !== 'object') throw new Error(`Invalid resource manifest: ${source}`);
  const manifest = value as ResourceManifest;
  if (!manifest.name || typeof manifest.name !== 'string') throw new Error(`Resource manifest missing name: ${source}`);
  if (!manifest.version || typeof manifest.version !== 'string') throw new Error(`Resource manifest missing version: ${source}`);
  if (!manifest.server || typeof manifest.server !== 'string') throw new Error(`Resource manifest missing server: ${source}`);
  for (const [label, list] of [['dependencies', manifest.dependencies], ['clientActions', manifest.clientActions]] as const) {
    if (list !== undefined && (!Array.isArray(list) || list.some(entry => typeof entry !== 'string' || !entry))) throw new Error(`Invalid ${label} in ${source}`);
  }
  const events = manifest.heartbeat?.events;
  if (events && Object.values(events).some(entry => !['never','summary','full'].includes(entry))) throw new Error(`Invalid heartbeat event policy in ${source}`);
  return manifest;
}

type EventHandler = (event: GameEvent) => void | Promise<void>;
type ActionHandler = (ctx: ResourceActionContext, payload: any) => unknown | Promise<unknown>;
type ActionHook = (ctx: ResourceActionContext, payload: any) => boolean | void | string | { allow: boolean; reason?: string } | Promise<boolean | void | string | { allow: boolean; reason?: string }>;
type AfterHook = (ctx: ResourceActionContext, success: boolean, payload: any, result?: unknown, error?: Error) => void | Promise<void>;
type SnapshotProvider = () => unknown;
type DisposeHandler = () => void | Promise<void>;
type Registered<T> = { resource: string; handler: T };
type LoadedResource = { manifest: ResourceManifest; directory: string };

export type RuntimeHost = Record<string, any>;
export type ResourceActionContext = {
  action: string;
  actorId?: string;
  roomId?: string;
  source: ActionSource;
  correlationId: string;
  resource: string;
  host: RuntimeHost;
  emit: (name: string, payload: unknown, meta?: { ai?: AiVisibility; actorId?: string; roomId?: string }) => Promise<GameEvent>;
  execute: <T = unknown>(name: string, request: Omit<ActionRequest, 'correlationId'> & { correlationId?: string }) => Promise<ActionResult<T>>;
  exports: { get: <T extends (...args: any[]) => any>(resource: string, name: string) => T };
};

function jsonSafe(value: unknown): unknown {
  try { return JSON.parse(JSON.stringify(value)); } catch { return { unserializable: true }; }
}
function safeError(value: unknown){ return value instanceof Error ? value : new Error(String(value)); }
function visibilityRank(value:AiVisibility){ return value==='never'?0:value==='summary'?1:2; }
function visibilityFloor(policy:AiVisibility, requested?:AiVisibility):AiVisibility{
  if(!requested) return policy;
  return visibilityRank(requested) <= visibilityRank(policy) ? requested : policy;
}

export class EventJournal {
  private events: GameEvent[] = [];
  private aiEvents: GameEvent[] = [];
  private sequence = 0;
  constructor(private readonly capacity = 1000, private readonly aiCapacity = 2000) {}

  nextSequence(){ return ++this.sequence; }
  currentSequence(){ return this.sequence; }

  push(event: GameEvent) {
    this.events.push(event);
    if (this.events.length > this.capacity) this.events.splice(0, this.events.length - this.capacity);
    if(event.ai !== 'never'){
      this.aiEvents.push(event);
      if(this.aiEvents.length > this.aiCapacity) this.aiEvents.splice(0,this.aiEvents.length-this.aiCapacity);
    }
  }

  afterSequence(cursor:number,limit=200){
    const matching=this.aiEvents.filter(event=>event.sequence>cursor);
    const selected=matching.slice(0,Math.max(1,limit));
    const capturedCursor=matching.length>selected.length ? selected.at(-1)!.sequence : this.sequence;
    return {events:selected.map(event=>({...event,payload:jsonSafe(event.payload)})),cursor:capturedCursor,hasMore:matching.length>selected.length};
  }

  since(timestamp: number, includeNever = false) {
    return this.events.filter(event => event.at > timestamp && (includeNever || event.ai !== 'never')).map(event => ({ ...event, payload: jsonSafe(event.payload) }));
  }
  tail(limit = 50, includeNever = false) {
    return this.events.filter(event => includeNever || event.ai !== 'never').slice(-limit).map(event => ({ ...event, payload: jsonSafe(event.payload) }));
  }
}

export class ResourceRuntime {
  readonly journal = new EventJournal(1200,2400);
  private resources = new Map<string, LoadedResource>();
  private eventHandlers = new Map<string, Registered<EventHandler>[]>();
  private actions = new Map<string, Registered<ActionHandler>>();
  private beforeHooks = new Map<string, Registered<ActionHook>[]>();
  private afterHooks = new Map<string, Registered<AfterHook>[]>();
  private exports = new Map<string, Map<string, (...args: any[]) => any>>();
  private snapshotProviders = new Map<string, Registered<SnapshotProvider>>();
  private disposers:Registered<DisposeHandler>[]=[];
  private clientActions = new Map<string,string>();
  private disposed=false;

  constructor(readonly host: RuntimeHost, readonly resourcesDir: string) {}

  async loadAll() {
    const found = this.discover();
    const ordered = this.topologicalOrder(found);
    for (const resource of ordered) await this.loadResource(resource);
    return ordered.map(resource => resource.manifest.name);
  }

  listResources() {
    return [...this.resources.values()].map(({ manifest }) => ({name:manifest.name,version:manifest.version,description:manifest.description??'',dependencies:manifest.dependencies??[],clientActions:manifest.clientActions??[]}));
  }

  private discover(): LoadedResource[] {
    if (!existsSync(this.resourcesDir)) throw new Error(`Port Mercy resources directory not found: ${this.resourcesDir}`);
    const resources: LoadedResource[] = [];
    for (const entry of readdirSync(this.resourcesDir)) {
      const directory = join(this.resourcesDir, entry);
      if (!statSync(directory).isDirectory()) continue;
      const manifestPath = join(directory, 'pmresource.json');
      if (!existsSync(manifestPath)) continue;
      const manifest = validateManifest(JSON.parse(readFileSync(manifestPath, 'utf8')), manifestPath);
      resources.push({ manifest, directory });
    }
    return resources;
  }

  private topologicalOrder(found: LoadedResource[]) {
    const byName = new Map(found.map(resource => [resource.manifest.name, resource]));
    const visiting = new Set<string>();
    const visited = new Set<string>();
    const result: LoadedResource[] = [];
    const visit = (name: string) => {
      if (visited.has(name)) return;
      if (visiting.has(name)) throw new Error(`Circular Port Mercy resource dependency involving ${name}`);
      const resource = byName.get(name);
      if (!resource) throw new Error(`Missing Port Mercy resource dependency: ${name}`);
      visiting.add(name);
      for (const dependency of resource.manifest.dependencies ?? []) visit(dependency);
      visiting.delete(name);visited.add(name);result.push(resource);
    };
    for (const resource of found) visit(resource.manifest.name);
    return result;
  }

  private async loadResource(resource: LoadedResource) {
    const { manifest, directory } = resource;
    const modulePath = resolve(directory, manifest.server);
    const imported = await import(`${pathToFileURL(modulePath).href}?v=${Date.now()}`);
    if (typeof imported.setup !== 'function') throw new Error(`${manifest.name} must export setup(ctx)`);
    this.resources.set(manifest.name, resource);
    await imported.setup(this.makeResourceContext(manifest));
    for (const actionName of manifest.clientActions ?? []) {
      const action = this.actions.get(actionName);
      if (!action || action.resource !== manifest.name) throw new Error(`${manifest.name} exposes client action ${actionName} but does not own that action.`);
      if (this.clientActions.has(actionName)) throw new Error(`Client action ${actionName} is already exposed by ${this.clientActions.get(actionName)}.`);
      this.clientActions.set(actionName, manifest.name);
    }
    await this.emitFrom(manifest.name, 'resource:started', { version: manifest.version }, { ai: 'never' });
  }

  private makeResourceContext(manifest: ResourceManifest) {
    const resource = manifest.name;
    return {
      resource,manifest,host:this.host,
      events:{on:(name:string,handler:EventHandler)=>this.on(resource,name,handler),emit:(name:string,payload:unknown,meta?:{ai?:AiVisibility;actorId?:string;roomId?:string;correlationId?:string})=>this.emitFrom(resource,name,payload,meta)},
      actions:{register:(name:string,handler:ActionHandler)=>this.registerAction(resource,name,handler),before:(name:string,handler:ActionHook)=>this.registerBefore(resource,name,handler),after:(name:string,handler:AfterHook)=>this.registerAfter(resource,name,handler),execute:<T=unknown>(name:string,request:Omit<ActionRequest,'correlationId'>&{correlationId?:string})=>this.execute<T>(name,request)},
      exports:{register:(name:string,fn:(...args:any[])=>any)=>this.registerExport(resource,name,fn),get:<T extends (...args:any[])=>any>(target:string,name:string)=>this.getExport<T>(target,name)},
      heartbeat:{snapshot:(name:string,provider:SnapshotProvider)=>this.registerSnapshot(resource,name,provider)},
      lifecycle:{onDispose:(handler:DisposeHandler)=>this.disposers.push({resource,handler})},
    };
  }

  private policyFor(resource:string,eventName:string):AiVisibility{return this.resources.get(resource)?.manifest.heartbeat?.events?.[eventName]??'never';}
  private on(resource:string,name:string,handler:EventHandler){const list=this.eventHandlers.get(name)??[];list.push({resource,handler});this.eventHandlers.set(name,list);}

  async emitSystem(name:string,payload:unknown,meta?:{ai?:AiVisibility;actorId?:string;roomId?:string;correlationId?:string}){
    return this.emitFrom('runtime',name,payload,{...meta,ai:'never'});
  }

  private async emitFrom(resource:string,name:string,payload:unknown,meta?:{ai?:AiVisibility;actorId?:string;roomId?:string;correlationId?:string}){
    const policy=resource==='runtime'?'never':this.policyFor(resource,name);
    const event:GameEvent={id:randomUUID(),sequence:this.journal.nextSequence(),name,at:Date.now(),resource,correlationId:meta?.correlationId??randomUUID(),actorId:meta?.actorId,roomId:meta?.roomId,ai:visibilityFloor(policy,meta?.ai),payload:jsonSafe(payload)};
    this.journal.push(event);
    for(const registered of [...(this.eventHandlers.get(name)??[]),...(this.eventHandlers.get('*')??[])]){
      try{await registered.handler(event);}catch(error){console.error(`[resource:${registered.resource}] event handler failed for ${name}:`,safeError(error).message);}
    }
    return event;
  }

  isClientAction(name:string){return this.clientActions.has(name);}
  async executeClient<T=unknown>(name:string,request:Omit<ActionRequest,'source'|'correlationId'>&{correlationId?:string}):Promise<ActionResult<T>>{
    if(!this.clientActions.has(name))return {ok:false,reason:`Client action is not exposed: ${name}`,correlationId:request.correlationId??randomUUID()};
    return this.execute<T>(name,{...request,source:'client'});
  }

  private registerAction(resource:string,name:string,handler:ActionHandler){if(this.actions.has(name))throw new Error(`Action ${name} is already registered by ${this.actions.get(name)?.resource}`);this.actions.set(name,{resource,handler});}
  private registerBefore(resource:string,name:string,handler:ActionHook){const list=this.beforeHooks.get(name)??[];list.push({resource,handler});this.beforeHooks.set(name,list);}
  private registerAfter(resource:string,name:string,handler:AfterHook){const list=this.afterHooks.get(name)??[];list.push({resource,handler});this.afterHooks.set(name,list);}

  private async runAfter(ctx:ResourceActionContext,name:string,success:boolean,payload:unknown,result?:unknown,error?:Error){
    for(const after of [...(this.afterHooks.get(name)??[]),...(this.afterHooks.get('*')??[])]){
      try{await after.handler(ctx,success,payload,result,error);}catch(afterError){console.error(`[resource:${after.resource}] after-hook failed for ${name}:`,safeError(afterError).message);}
    }
  }

  async execute<T=unknown>(name:string,request:Omit<ActionRequest,'correlationId'>&{correlationId?:string}):Promise<ActionResult<T>>{
    const correlationId=request.correlationId??randomUUID();
    const action=this.actions.get(name);
    if(!action)return {ok:false,reason:`No handler registered for ${name}`,correlationId};
    const ctx:ResourceActionContext={action:name,actorId:request.actorId,roomId:request.roomId,source:request.source,correlationId,resource:action.resource,host:this.host,
      emit:(eventName,payload,meta)=>this.emitFrom(action.resource,eventName,payload,{...meta,correlationId,actorId:meta?.actorId??request.actorId,roomId:meta?.roomId??request.roomId}),
      execute:<R=unknown>(nestedName:string,nestedRequest:Omit<ActionRequest,'correlationId'>&{correlationId?:string})=>this.execute<R>(nestedName,{...nestedRequest,correlationId:nestedRequest.correlationId??correlationId}),
      exports:{get:<F extends (...args:any[])=>any>(resource:string,exportName:string)=>this.getExport<F>(resource,exportName)}};

    try{
      for(const hook of [...(this.beforeHooks.get(name)??[]),...(this.beforeHooks.get('*')??[])]){
        let decision;
        try{decision=await hook.handler(ctx,request.payload);}catch(error){throw new Error(`Action guard ${hook.resource} failed: ${safeError(error).message}`);}
        if(decision===false||typeof decision==='string'||(typeof decision==='object'&&decision&&'allow' in decision&&!decision.allow)){
          const reason=typeof decision==='string'?decision:typeof decision==='object'&&decision?decision.reason??'Action rejected by a resource hook.':'Action rejected by a resource hook.';
          await this.emitSystem('action:rejected',{action:name,by:hook.resource,reason},{correlationId,actorId:request.actorId,roomId:request.roomId});
          await this.runAfter(ctx,name,false,request.payload,undefined,new Error(reason));
          return {ok:false,reason,correlationId};
        }
      }
    }catch(error){
      const err=safeError(error);
      await this.runAfter(ctx,name,false,request.payload,undefined,err);
      await this.emitSystem('action:failed',{action:name,resource:action.resource,reason:err.message},{correlationId,actorId:request.actorId,roomId:request.roomId});
      return {ok:false,reason:err.message,correlationId};
    }

    try{
      const value=await action.handler(ctx,request.payload) as T;
      await this.runAfter(ctx,name,true,request.payload,value);
      return {ok:true,value,correlationId};
    }catch(error){
      const err=safeError(error);
      await this.runAfter(ctx,name,false,request.payload,undefined,err);
      await this.emitSystem('action:failed',{action:name,resource:action.resource,reason:err.message},{correlationId,actorId:request.actorId,roomId:request.roomId});
      return {ok:false,reason:err.message,correlationId};
    }
  }

  private registerExport(resource:string,name:string,fn:(...args:any[])=>any){const resourceExports=this.exports.get(resource)??new Map<string,(...args:any[])=>any>();if(resourceExports.has(name))throw new Error(`Export ${resource}:${name} already exists.`);resourceExports.set(name,fn);this.exports.set(resource,resourceExports);}
  getExport<T extends (...args:any[])=>any>(resource:string,name:string):T{const fn=this.exports.get(resource)?.get(name);if(!fn)throw new Error(`Missing export ${resource}:${name}`);return fn as T;}
  private registerSnapshot(resource:string,name:string,provider:SnapshotProvider){const key=`${resource}:${name}`;if(this.snapshotProviders.has(key))throw new Error(`Heartbeat snapshot provider ${key} already exists.`);this.snapshotProviders.set(key,{resource,handler:provider});}

  heartbeatState(maxBytesPerProvider=64_000){
    const state:Record<string,unknown>={};
    for(const [key,provider] of this.snapshotProviders){
      try{
        const value=jsonSafe(provider.handler());
        const encoded=JSON.stringify(value);
        state[key]=encoded.length<=maxBytesPerProvider?value:{truncated:true,bytes:encoded.length};
      }catch(error){state[key]={error:safeError(error).message};}
    }
    return state;
  }

  async dispose(){
    if(this.disposed)return;this.disposed=true;
    for(const registered of [...this.disposers].reverse()){
      try{await registered.handler();}catch(error){console.error(`[resource:${registered.resource}] dispose failed:`,safeError(error).message);}
    }
    this.disposers=[];this.eventHandlers.clear();this.beforeHooks.clear();this.afterHooks.clear();this.actions.clear();this.exports.clear();this.snapshotProviders.clear();this.clientActions.clear();
  }
}

export function resolveResourcesDirectory() {
  const configured=process.env.PORT_MERCY_RESOURCES_DIR;if(configured)return resolve(configured);
  const candidates=[resolve(process.cwd(),'resources'),resolve(process.cwd(),'../../resources'),resolve(dirname(new URL(import.meta.url).pathname),'../../../../resources')];
  return candidates.find(existsSync)??candidates[0];
}
