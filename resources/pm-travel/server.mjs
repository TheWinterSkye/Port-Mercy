import { randomUUID } from 'node:crypto';

export async function setup(ctx) {
  const sessions = new Map();
  const routes = new Map([
    ['southward.gas.forecourt>southward.diner', { seconds: 18, label: 'Harbor Avenue westbound' }],
    ['southward.diner>southward.gas.forecourt', { seconds: 18, label: 'Harbor Avenue eastbound' }],
    ['southward.gas.forecourt>southward.alley', { seconds: 12, label: 'service road' }],
    ['southward.alley>southward.gas.forecourt', { seconds: 12, label: 'service road' }]
  ]);

  const publicSession = session => {
    if (!session) return null;
    const { timer, ...safe } = session;
    return { ...safe };
  };

  const arrive = async session => {
    if (sessions.get(session.actorId)?.id !== session.id || session.status !== 'traveling') return;
    const player = ctx.host.getPlayer(session.actorId);
    const vehicle = ctx.host.getVehicle(session.vehicleId);
    if (!player || !vehicle) {
      sessions.delete(session.actorId);
      return;
    }
    ctx.host.setPlayerRoom(session.actorId, session.destination);
    ctx.host.setVehicleRoom(vehicle.id, session.destination);
    sessions.delete(session.actorId);
    session.status = 'arrived';
    session.arrivedAt = Date.now();
    session.timer = undefined;
    ctx.host.send(session.actorId, 'travel_update', publicSession(session));
    ctx.host.roomEvent(session.destination, `${player.name} arrives in ${vehicle.label}.`);
    await ctx.events.emit('travel:arrived', { vehicleId: vehicle.id, origin: session.origin, destination: session.destination }, { actorId: session.actorId, roomId: session.destination });
  };

  const schedule = (session, delayMs) => {
    clearTimeout(session.timer);
    session.timer = setTimeout(() => arrive(session), Math.max(0, delayMs));
  };

  const pause = async (actorId, reason = 'interrupted') => {
    const session = sessions.get(actorId);
    if (!session || session.status !== 'traveling') return null;
    clearTimeout(session.timer);
    session.remainingMs = Math.max(0, session.arriveAt - Date.now());
    session.status = 'paused';
    session.pauseReason = reason;
    session.timer = undefined;
    ctx.host.send(actorId, 'travel_update', publicSession(session));
    await ctx.events.emit('travel:paused', { vehicleId: session.vehicleId, destination: session.destination, reason, remainingMs: session.remainingMs }, { actorId, roomId: session.origin });
    return publicSession(session);
  };

  const resume = async (actorId, reason = 'resumed') => {
    const session = sessions.get(actorId);
    if (!session || session.status !== 'paused') return null;
    const now = Date.now();
    const remainingMs = Math.max(500, session.remainingMs ?? 500);
    session.status = 'traveling';
    session.pauseReason = null;
    session.startedAt = now;
    session.arriveAt = now + remainingMs;
    session.seconds = remainingMs / 1000;
    session.remainingMs = undefined;
    schedule(session, remainingMs);
    ctx.host.send(actorId, 'travel_update', publicSession(session));
    await ctx.events.emit('travel:resumed', { vehicleId: session.vehicleId, destination: session.destination, reason, seconds: session.seconds }, { actorId, roomId: session.origin });
    return publicSession(session);
  };

  const abort = async (actorId, reason = 'cancelled') => {
    const session = sessions.get(actorId);
    if (!session) return null;
    clearTimeout(session.timer);
    sessions.delete(actorId);
    session.status = 'cancelled';
    session.cancelReason = reason;
    session.timer = undefined;
    ctx.host.send(actorId, 'travel_update', publicSession(session));
    await ctx.events.emit('travel:cancelled', { vehicleId: session.vehicleId, origin: session.origin, destination: session.destination, reason }, { actorId, roomId: session.origin });
    return publicSession(session);
  };

  ctx.exports.register('getSession', actorId => publicSession(sessions.get(actorId)));
  ctx.exports.register('listActive', () => [...sessions.values()].map(publicSession));
  ctx.exports.register('pause', pause);
  ctx.exports.register('resume', resume);
  ctx.exports.register('abort', abort);

  ctx.actions.register('travel:start', async (action, payload) => {
    if (sessions.has(action.actorId)) throw new Error('You are already traveling.');
    const player = ctx.host.getPlayer(action.actorId);
    const vehicle = ctx.host.getVehicle(payload?.vehicleId);
    if (!player || !vehicle) throw new Error('Travel is unavailable.');
    if (vehicle.roomId !== player.roomId) throw new Error('That vehicle is not here.');
    if (vehicle.ownerId && vehicle.ownerId !== action.actorId) throw new Error('You do not have the keys to that vehicle.');
    const destination = String(payload?.destination || '');
    const route = routes.get(`${player.roomId}>${destination}`);
    if (!route) throw new Error('There is no drivable route to that destination yet.');
    const startedAt = Date.now();
    const arriveAt = startedAt + route.seconds * 1000;
    const session = { id: randomUUID(), actorId: action.actorId, vehicleId: vehicle.id, origin: player.roomId, destination, route: route.label, startedAt, arriveAt, seconds: route.seconds, status: 'traveling' };
    sessions.set(action.actorId, session);
    schedule(session, route.seconds * 1000);
    ctx.host.send(action.actorId, 'travel_update', publicSession(session));
    await action.emit('travel:started', { vehicleId: vehicle.id, origin: session.origin, destination, seconds: route.seconds }, { roomId: session.origin });
    return publicSession(session);
  });

  ctx.actions.register('travel:cancel', async action => {
    const cancelled = await abort(action.actorId, 'player-cancelled');
    if (!cancelled) throw new Error('You are not traveling.');
    return { cancelled: true };
  });

  ctx.heartbeat.snapshot('active', () => [...sessions.values()].map(publicSession));
}
