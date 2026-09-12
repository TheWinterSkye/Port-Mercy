import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export type AiVisibility = 'never' | 'summary' | 'full';
export type ActionSource = 'client' | 'resource' | 'heartbeat' | 'system';

export type GameEvent = {
  id: string;
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
  heartbeat?: {
    events?: Record<string, AiVisibility>;
  };
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
  if (events && Object.values(events).some(value => !['never','summary','full'].includes(value))) throw new Error(`Invalid heartbeat event policy in ${source}`);
  return manifest;
}

type EventHandler = (event: GameEvent) => void | Promise<void>;
type ActionHandler = (ctx: ResourceActionContext, payload: any) => unknown | Promise<unknown>;
type ActionHook = (ctx: ResourceActionContext, payload: any) => boolean | void | string | { allow: boolean; reason?: string } | Promise<boolean | void | string | { allow: boolean; reason?: string }>;
type AfterHook = (ctx: ResourceActionContext, success: boolean, payload: any, result?: unknown, error?: Error) => void | Promise<void>;
type SnapshotProvider = () => unknown;

type Registered<T> = { resource: string; handler: T };

type LoadedResource = {
  manifest: ResourceManifest;
  directory: string;
};

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
  exports: {
    get: <T extends (...args: any[]) => any>(resource: string, name: string) => T;
  };
};

function jsonSafe(value: unknown): unknown {
  try { return JSON.parse(JSON.stringify(value)); } catch { return { unserializable: true }; }
}

export class EventJournal {
  private events: GameEvent[] = [];
  constructor(private readonly capacity = 500) {}

  push(event: GameEvent) {
    this.events.push(event);
    if (this.events.length > this.capacity) this.events.splice(0, this.events.length - this.capacity);
  }

  since(timestamp: number, includeNever = false) {
    return this.events
      .filter(event => event.at > timestamp && (includeNever || event.ai !== 'never'))
      .map(event => ({ ...event, payload: jsonSafe(event.payload) }));
  }

  tail(limit = 50, includeNever = false) {
    return this.events.filter(event => includeNever || event.ai !== 'never').slice(-limit).map(event => ({ ...event, payload: jsonSafe(event.payload) }));
  }
}

export class ResourceRuntime {
  readonly journal = new EventJournal(800);
  private resources = new Map<string, LoadedResource>();
  private eventHandlers = new Map<string, Registered<EventHandler>[]>();
  private actions = new Map<string, Registered<ActionHandler>>();
  private beforeHooks = new Map<string, Registered<ActionHook>[]>();
  private afterHooks = new Map<string, Registered<AfterHook>[]>();
  private exports = new Map<string, Map<string, (...args: any[]) => any>>();
  private snapshotProviders = new Map<string, Registered<SnapshotProvider>>();
  private clientActions = new Map<string,string>();

  constructor(readonly host: RuntimeHost, readonly resourcesDir: string) {}

  async loadAll() {
    const found = this.discover();
    const ordered = this.topologicalOrder(found);
    for (const resource of ordered) await this.loadResource(resource);
    return ordered.map(resource => resource.manifest.name);
  }

  listResources() {
    return [...this.resources.values()].map(({ manifest }) => ({
      name: manifest.name,
      version: manifest.version,
      description: manifest.description ?? '',
      dependencies: manifest.dependencies ?? [],
      clientActions: manifest.clientActions ?? [],
    }));
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
      visiting.delete(name);
      visited.add(name);
      result.push(resource);
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
      resource,
      manifest,
      host: this.host,
      events: {
        on: (name: string, handler: EventHandler) => this.on(resource, name, handler),
        emit: (name: string, payload: unknown, meta?: { ai?: AiVisibility; actorId?: string; roomId?: string; correlationId?: string }) => this.emitFrom(resource, name, payload, meta),
      },
      actions: {
        register: (name: string, handler: ActionHandler) => this.registerAction(resource, name, handler),
        before: (name: string, handler: ActionHook) => this.registerBefore(resource, name, handler),
        after: (name: string, handler: AfterHook) => this.registerAfter(resource, name, handler),
        execute: <T = unknown>(name: string, request: Omit<ActionRequest, 'correlationId'> & { correlationId?: string }) => this.execute<T>(name, request),
      },
      exports: {
        register: (name: string, fn: (...args: any[]) => any) => this.registerExport(resource, name, fn),
        get: <T extends (...args: any[]) => any>(targetResource: string, name: string) => this.getExport<T>(targetResource, name),
      },
      heartbeat: {
        snapshot: (name: string, provider: SnapshotProvider) => this.registerSnapshot(resource, name, provider),
      },
    };
  }

  private policyFor(resource: string, eventName: string): AiVisibility {
    const manifest = this.resources.get(resource)?.manifest;
    return manifest?.heartbeat?.events?.[eventName] ?? 'never';
  }

  private on(resource: string, name: string, handler: EventHandler) {
    const list = this.eventHandlers.get(name) ?? [];
    list.push({ resource, handler });
    this.eventHandlers.set(name, list);
  }

  async emitSystem(name: string, payload: unknown, meta?: { ai?: AiVisibility; actorId?: string; roomId?: string; correlationId?: string }) {
    return this.emitFrom('runtime', name, payload, { ...meta, ai: meta?.ai ?? 'never' });
  }

  private async emitFrom(resource: string, name: string, payload: unknown, meta?: { ai?: AiVisibility; actorId?: string; roomId?: string; correlationId?: string }) {
    const event: GameEvent = {
      id: randomUUID(),
      name,
      at: Date.now(),
      resource,
      correlationId: meta?.correlationId ?? randomUUID(),
      actorId: meta?.actorId,
      roomId: meta?.roomId,
      ai: meta?.ai ?? this.policyFor(resource, name),
      payload: jsonSafe(payload),
    };
    this.journal.push(event);
    for (const registered of [...(this.eventHandlers.get(name) ?? []), ...(this.eventHandlers.get('*') ?? [])]) {
      await registered.handler(event);
    }
    return event;
  }

  isClientAction(name: string) { return this.clientActions.has(name); }

  async executeClient<T = unknown>(name: string, request: Omit<ActionRequest, 'source'|'correlationId'> & { correlationId?: string }): Promise<ActionResult<T>> {
    if (!this.clientActions.has(name)) return { ok: false, reason: `Client action is not exposed: ${name}`, correlationId: request.correlationId ?? randomUUID() };
    return this.execute<T>(name, { ...request, source: 'client' });
  }

  private registerAction(resource: string, name: string, handler: ActionHandler) {
    if (this.actions.has(name)) throw new Error(`Action ${name} is already registered by ${this.actions.get(name)?.resource}`);
    this.actions.set(name, { resource, handler });
  }

  private registerBefore(resource: string, name: string, handler: ActionHook) {
    const list = this.beforeHooks.get(name) ?? [];
    list.push({ resource, handler });
    this.beforeHooks.set(name, list);
  }

  private registerAfter(resource: string, name: string, handler: AfterHook) {
    const list = this.afterHooks.get(name) ?? [];
    list.push({ resource, handler });
    this.afterHooks.set(name, list);
  }

  async execute<T = unknown>(name: string, request: Omit<ActionRequest, 'correlationId'> & { correlationId?: string }): Promise<ActionResult<T>> {
    const correlationId = request.correlationId ?? randomUUID();
    const action = this.actions.get(name);
    if (!action) return { ok: false, reason: `No handler registered for ${name}`, correlationId };

    const ctx: ResourceActionContext = {
      action: name,
      actorId: request.actorId,
      roomId: request.roomId,
      source: request.source,
      correlationId,
      resource: action.resource,
      host: this.host,
      emit: (eventName, payload, meta) => this.emitFrom(action.resource, eventName, payload, { ...meta, correlationId, actorId: meta?.actorId ?? request.actorId, roomId: meta?.roomId ?? request.roomId }),
      execute: <R = unknown>(nestedName: string, nestedRequest: Omit<ActionRequest, 'correlationId'> & { correlationId?: string }) => this.execute<R>(nestedName, { ...nestedRequest, correlationId: nestedRequest.correlationId ?? correlationId }),
      exports: { get: <F extends (...args: any[]) => any>(resource: string, exportName: string) => this.getExport<F>(resource, exportName) },
    };

    for (const hook of [...(this.beforeHooks.get(name) ?? []), ...(this.beforeHooks.get('*') ?? [])]) {
      const decision = await hook.handler(ctx, request.payload);
      if (decision === false || typeof decision === 'string' || (typeof decision === 'object' && decision && 'allow' in decision && !decision.allow)) {
        const reason = typeof decision === 'string' ? decision : typeof decision === 'object' && decision ? decision.reason ?? 'Action rejected by a resource hook.' : 'Action rejected by a resource hook.';
        await this.emitSystem('action:rejected', { action: name, by: hook.resource, reason }, { correlationId, actorId: request.actorId, roomId: request.roomId });
        for (const after of [...(this.afterHooks.get(name) ?? []), ...(this.afterHooks.get('*') ?? [])]) await after.handler(ctx, false, request.payload, undefined, new Error(reason));
        return { ok: false, reason, correlationId };
      }
    }

    try {
      const value = await action.handler(ctx, request.payload) as T;
      for (const after of [...(this.afterHooks.get(name) ?? []), ...(this.afterHooks.get('*') ?? [])]) await after.handler(ctx, true, request.payload, value);
      return { ok: true, value, correlationId };
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      for (const after of [...(this.afterHooks.get(name) ?? []), ...(this.afterHooks.get('*') ?? [])]) await after.handler(ctx, false, request.payload, undefined, err);
      await this.emitSystem('action:failed', { action: name, resource: action.resource, reason: err.message }, { correlationId, actorId: request.actorId, roomId: request.roomId });
      return { ok: false, reason: err.message, correlationId };
    }
  }

  private registerExport(resource: string, name: string, fn: (...args: any[]) => any) {
    const resourceExports = this.exports.get(resource) ?? new Map<string, (...args: any[]) => any>();
    if (resourceExports.has(name)) throw new Error(`Export ${resource}:${name} already exists.`);
    resourceExports.set(name, fn);
    this.exports.set(resource, resourceExports);
  }

  getExport<T extends (...args: any[]) => any>(resource: string, name: string): T {
    const fn = this.exports.get(resource)?.get(name);
    if (!fn) throw new Error(`Missing export ${resource}:${name}`);
    return fn as T;
  }

  private registerSnapshot(resource: string, name: string, provider: SnapshotProvider) {
    const key = `${resource}:${name}`;
    if (this.snapshotProviders.has(key)) throw new Error(`Heartbeat snapshot provider ${key} already exists.`);
    this.snapshotProviders.set(key, { resource, handler: provider });
  }

  heartbeatState() {
    const state: Record<string, unknown> = {};
    for (const [key, provider] of this.snapshotProviders) state[key] = jsonSafe(provider.handler());
    return state;
  }
}

export function resolveResourcesDirectory() {
  const configured = process.env.PORT_MERCY_RESOURCES_DIR;
  if (configured) return resolve(configured);
  const candidates = [
    resolve(process.cwd(), 'resources'),
    resolve(process.cwd(), '../../resources'),
    resolve(dirname(new URL(import.meta.url).pathname), '../../../../resources'),
  ];
  return candidates.find(existsSync) ?? candidates[0];
}
