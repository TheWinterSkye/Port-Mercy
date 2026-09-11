import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface, type Interface } from 'node:readline';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

export type HeartbeatMode = 'codex' | 'offline';

export type HeartbeatRoom = {
  id: string;
  name: string;
  district: string;
  occupants: string[];
  recentActivity: string[];
};

export type HeartbeatPlayer = {
  id: string;
  name: string;
  roomId: string;
  job: string;
  cash: number;
  health: number;
  stress: number;
  inventory: string[];
  skills: Array<{ id:string; value:number }>;
};

export type WorldSnapshot = {
  city: 'Port Mercy';
  heartbeatNumber: number;
  capturedAt: string;
  worldClock: string;
  weather: string;
  rooms: HeartbeatRoom[];
  players: HeartbeatPlayer[];
  npcs: Array<{ id: string; name: string; roomId: string; role: string; motivation: string }>;
  businesses: Array<{ id: string; name: string; roomId: string; open: boolean; pressure: string }>;
  vehicles: Array<{ id: string; label: string; roomId: string; status: string }>;
  housing: Array<{ id: string; label: string; roomId: string; status: string }>;
  police: { activeCalls: Array<{ roomId: string; reason: string; priority: number }> };
  jobMarket: Array<{ id:string; name:string; roomId:string; status:string; demand:string }>;
  incidents: Array<{ id:string; type:string; roomId:string; status:string; summary:string; createdAt:number }>;
  economy: { notes: string[] };
  recentEvents: Array<{ name:string; at:number; resource:string; actorId:string|null; roomId:string|null; detail?:unknown; summary?:unknown }>;
  resourceState: Record<string, unknown>;
};

export type WorldMutation =
  | { type: 'room_event'; roomId: string; text: string }
  | { type: 'npc_intent'; npcId: string; roomId: string; action: string; text: string }
  | { type: 'business_event'; businessId: string; roomId: string; text: string }
  | { type: 'job_event'; jobId: string; roomId: string; text: string }
  | { type: 'vehicle_event'; vehicleId: string; roomId: string; text: string }
  | { type: 'housing_event'; propertyId: string; roomId: string; text: string }
  | { type: 'police_dispatch'; roomId: string; reason: string; priority: number; text: string }
  | { type: 'economy_event'; text: string };

export type HeartbeatResult = {
  mode: HeartbeatMode;
  summary: string;
  mutations: WorldMutation[];
  generatedAt: number;
};

export interface HeartbeatProvider {
  readonly mode: HeartbeatMode;
  run(snapshot: WorldSnapshot): Promise<HeartbeatResult>;
  close(): Promise<void>;
}

const OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string', maxLength: 600 },
    mutations: {
      type: 'array',
      maxItems: 12,
      items: {
        type: 'object',
        properties: {
          type: {
            type: 'string',
            enum: ['room_event', 'npc_intent', 'business_event', 'job_event', 'vehicle_event', 'housing_event', 'police_dispatch', 'economy_event'],
          },
          roomId: { type: ['string', 'null'] },
          text: { type: 'string', maxLength: 320 },
          npcId: { type: ['string', 'null'] },
          action: { type: ['string', 'null'], maxLength: 120 },
          businessId: { type: ['string', 'null'] },
          jobId: { type: ['string', 'null'] },
          vehicleId: { type: ['string', 'null'] },
          propertyId: { type: ['string', 'null'] },
          reason: { type: ['string', 'null'], maxLength: 180 },
          priority: { type: ['integer', 'null'], minimum: 1, maximum: 5 },
        },
        required: ['type', 'roomId', 'text', 'npcId', 'action', 'businessId', 'jobId', 'vehicleId', 'propertyId', 'reason', 'priority'],
        additionalProperties: false,
      },
    },
  },
  required: ['summary', 'mutations'],
  additionalProperties: false,
} as const;

const HEARTBEAT_INSTRUCTIONS = `You are the hourly world heartbeat for Port Mercy, a gritty modern persistent multiplayer MUD with graphical rooms.

The game server is authoritative. You do NOT directly edit player cash, health, stress, inventory, property ownership, vehicle ownership, skills, or criminal records. You propose bounded world mutations only. The server validates every mutation before applying it.

The snapshot includes a resource-generated event stream. Treat recentEvents as the canonical summary of meaningful things that actually happened between heartbeats. Events marked for AI visibility were explicitly selected by game resources; do not infer significance from omitted UI or low-level events. resourceState contains compact state contributed by loaded resources such as job registries and vehicle systems.

Simulate a busy world that does not wait for players. NPCs have their own motives. Businesses can have mundane problems. Vehicles move for reasons. Police respond to concrete calls, witnesses, evidence, or ongoing incidents; there is no abstract arcade police-heat meter. Housing and neighborhood conditions may evolve. Keep most heartbeats mundane and restrained. Do not manufacture dramatic events just to entertain a player. Do not make the player the center of the city.

Use only IDs present in the supplied snapshot. Prefer 0-5 meaningful mutations per heartbeat. Avoid repeating the same event. Keep texts short enough for a MUD activity feed. For mutation fields that do not apply to that mutation type, return null. Return only data matching the supplied output schema.`;

function safeJsonParse<T>(text: string): T | null {
  try { return JSON.parse(text) as T; } catch { return null; }
}

export class OfflineHeartbeatProvider implements HeartbeatProvider {
  readonly mode = 'offline' as const;

  async run(snapshot: WorldSnapshot): Promise<HeartbeatResult> {
    const mutations: WorldMutation[] = [];
    const n = snapshot.heartbeatNumber;

    // Deliberately modest and deterministic: the offline world should keep moving,
    // but it should never pretend to have the richer judgement of the model.
    if (n % 2 === 0) {
      mutations.push({
        type: 'room_event',
        roomId: 'southward.gas.forecourt',
        text: 'A delivery van noses under the fuel canopy, idles for a minute, then pulls around toward the service lane.',
      });
    }
    if (n % 3 === 0) {
      mutations.push({
        type: 'npc_intent',
        npcId: 'rita.vale',
        roomId: 'southward.diner',
        action: 'close_out_register',
        text: 'Rita counts the register twice, writes a figure on the back of a receipt, and tucks it under the till.',
      });
    }
    if (n % 5 === 0) {
      mutations.push({
        type: 'business_event',
        businessId: 'mercy.fuel',
        roomId: 'southward.gas.forecourt',
        text: 'The price board flickers and the night clerk tapes an OUT OF ORDER sign over pump two.',
      });
    }

    return {
      mode: this.mode,
      summary: mutations.length ? `Offline fallback advanced ${mutations.length} world thread(s).` : 'Offline fallback heartbeat completed quietly.',
      mutations,
      generatedAt: Date.now(),
    };
  }

  async close() {}
}

type PendingRequest = {
  resolve: (value: any) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
};

export class CodexHeartbeatProvider implements HeartbeatProvider {
  readonly mode = 'codex' as const;
  private child: ChildProcessWithoutNullStreams | null = null;
  private lines: Interface | null = null;
  private nextId = 1;
  private pending = new Map<number, PendingRequest>();
  private threadId: string | null = null;
  private agentTextByTurn = new Map<string, string>();
  private activeTurnId: string | null = null;
  private completedTurns = new Set<string>();
  private turnWaiters = new Map<string, { resolve: () => void; reject: (error: Error) => void; timeout: NodeJS.Timeout }>();

  constructor(
    private readonly command = process.env.PORT_MERCY_CODEX_COMMAND || 'codex app-server',
    private readonly model = process.env.PORT_MERCY_CODEX_MODEL || 'gpt-5.6-luna',
    private readonly effort = process.env.PORT_MERCY_CODEX_EFFORT || 'low',
    private readonly cwd = process.env.PORT_MERCY_CODEX_CWD || join(tmpdir(),'port-mercy-heartbeat'),
  ) {}

  private async ensureStarted() {
    if (this.child && this.threadId) return;
    if (this.child && !this.threadId) await this.close();

    mkdirSync(this.cwd,{recursive:true});
    this.child = spawn(this.command, {
      shell: true,
      cwd: this.cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });

    this.child.stderr.on('data', chunk => {
      const text = String(chunk).trim();
      if (text) console.warn(`[codex app-server] ${text}`);
    });

    this.child.on('exit', (code, signal) => {
      const err = new Error(`Codex app-server exited (${code ?? signal ?? 'unknown'}).`);
      for (const pending of this.pending.values()) {
        clearTimeout(pending.timeout);
        pending.reject(err);
      }
      this.pending.clear();
      for (const waiter of this.turnWaiters.values()) {
        clearTimeout(waiter.timeout);
        waiter.reject(err);
      }
      this.turnWaiters.clear();
      this.threadId = null;
      this.child = null;
    });

    this.lines = createInterface({ input: this.child.stdout });
    this.lines.on('line', line => this.handleLine(line));

    await this.request('initialize', {
      clientInfo: { name: 'port_mercy_world_heartbeat', title: 'Port Mercy World Heartbeat', version: '0.5.0' },
    });
    this.notify('initialized', {});

    const started = await this.request('thread/start', {
      model: this.model,
      cwd: this.cwd,
      approvalPolicy: 'never',
      sandbox: 'readOnly',
      serviceName: 'port_mercy_world_heartbeat',
    });
    this.threadId = started?.thread?.id ?? null;
    if (!this.threadId) throw new Error('Codex app-server did not return a thread id.');
  }

  private handleLine(line: string) {
    const msg = safeJsonParse<any>(line);
    if (!msg) return;

    if (typeof msg.id === 'number' && (msg.result !== undefined || msg.error !== undefined)) {
      const pending = this.pending.get(msg.id);
      if (pending) {
        clearTimeout(pending.timeout);
        this.pending.delete(msg.id);
        if (msg.error) pending.reject(new Error(msg.error?.message || JSON.stringify(msg.error)));
        else pending.resolve(msg.result);
      }
      return;
    }

    if (msg.method === 'item/completed') {
      const item = msg.params?.item;
      const turnId = msg.params?.turnId;
      if (turnId && item?.type === 'agentMessage' && typeof item.text === 'string') {
        this.agentTextByTurn.set(turnId, item.text);
      }
      return;
    }

    if (msg.method === 'item/agentMessage/delta') {
      const turnId = msg.params?.turnId;
      const delta = msg.params?.delta;
      if (turnId && typeof delta === 'string') {
        this.agentTextByTurn.set(turnId, (this.agentTextByTurn.get(turnId) || '') + delta);
      }
      return;
    }

    if (msg.method === 'turn/completed') {
      const turnId = msg.params?.turn?.id || msg.params?.turnId;
      if (!turnId) return;
      const waiter = this.turnWaiters.get(turnId);
      if (waiter) {
        clearTimeout(waiter.timeout);
        this.turnWaiters.delete(turnId);
        waiter.resolve();
      } else {
        this.completedTurns.add(turnId);
      }
    }
  }

  private write(message: unknown) {
    if (!this.child?.stdin.writable) throw new Error('Codex app-server stdin is not writable.');
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private notify(method: string, params: unknown) {
    this.write({ method, params });
  }

  private request(method: string, params: unknown, timeoutMs = 45_000): Promise<any> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Timed out waiting for Codex ${method}.`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timeout });
      this.write({ method, id, params });
    });
  }

  async run(snapshot: WorldSnapshot): Promise<HeartbeatResult> {
    await this.ensureStarted();
    if (!this.threadId) throw new Error('Codex heartbeat thread is unavailable.');

    const text = `${HEARTBEAT_INSTRUCTIONS}\n\nAUTHORITATIVE WORLD SNAPSHOT:\n${JSON.stringify(snapshot)}`;
    const started = await this.request('turn/start', {
      threadId: this.threadId,
      input: [{ type: 'text', text }],
      cwd: this.cwd,
      model: this.model,
      effort: this.effort,
      summary: 'concise',
      approvalPolicy: 'never',
      sandboxPolicy: { type: 'readOnly' },
      outputSchema: OUTPUT_SCHEMA,
    }, 60_000);

    const turnId = started?.turn?.id as string | undefined;
    if (!turnId) throw new Error('Codex heartbeat did not return a turn id.');
    this.activeTurnId = turnId;

    if (!this.completedTurns.delete(turnId)) await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.turnWaiters.delete(turnId);
        reject(new Error('Codex heartbeat turn timed out.'));
      }, 120_000);
      this.turnWaiters.set(turnId, { resolve, reject, timeout });
    });

    const raw = this.agentTextByTurn.get(turnId) || '';
    this.agentTextByTurn.delete(turnId);
    this.activeTurnId = null;
    const parsed = safeJsonParse<{ summary?: string; mutations?: WorldMutation[] }>(raw);
    if (!parsed || !Array.isArray(parsed.mutations)) throw new Error('Codex heartbeat returned invalid structured output.');

    return {
      mode: this.mode,
      summary: String(parsed.summary || 'Codex heartbeat completed.'),
      mutations: parsed.mutations.slice(0, 12),
      generatedAt: Date.now(),
    };
  }

  async close() {
    this.lines?.close();
    this.lines = null;
    if (this.child) {
      this.child.kill();
      this.child = null;
    }
    this.threadId = null;
  }
}

export class HeartbeatService {
  private readonly offline = new OfflineHeartbeatProvider();
  private codex: CodexHeartbeatProvider | null = null;
  private sequence = 0;
  private running = false;
  private timer:NodeJS.Timeout|null=null;

  readonly intervalMs = Math.max(60_000, Number(process.env.PORT_MERCY_HEARTBEAT_MS || 3_600_000));
  readonly preferred = (process.env.PORT_MERCY_HEARTBEAT_PROVIDER || 'auto').toLowerCase();

  constructor(
    private readonly snapshot: (sequence: number) => WorldSnapshot,
    private readonly apply: (result: HeartbeatResult) => void,
    private readonly status: (mode: HeartbeatMode, lastAt: number, sequence: number, summary: string) => void,
  ) {
    if (this.preferred !== 'offline') this.codex = new CodexHeartbeatProvider();
  }

  start() {
    if (this.running) return;
    this.running = true;
    if (process.env.PORT_MERCY_HEARTBEAT_BOOT_TICK === '1') void this.tick();
    this.schedule();
  }

  private schedule() {
    if (!this.running) return;
    this.timer = setTimeout(async () => {
      if (!this.running) return;
      try { await this.tick(); } finally { this.schedule(); }
    }, this.intervalMs);
    this.timer.unref?.();
  }

  async tick() {
    const sequence = ++this.sequence;
    const snapshot = this.snapshot(sequence);
    let result: HeartbeatResult;

    if (this.codex) {
      try {
        result = await this.codex.run(snapshot);
      } catch (error) {
        console.warn(`[heartbeat] Codex unavailable; using offline fallback: ${error instanceof Error ? error.message : String(error)}`);
        await this.codex.close();
        result = await this.offline.run(snapshot);
      }
    } else {
      result = await this.offline.run(snapshot);
    }

    this.apply(result);
    this.status(result.mode, result.generatedAt, sequence, result.summary);
  }

  async close() {
    this.running = false;
    if(this.timer){clearTimeout(this.timer);this.timer=null;}
    await this.codex?.close();
    await this.offline.close();
  }
}
