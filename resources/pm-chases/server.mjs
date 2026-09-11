import { randomUUID } from 'node:crypto';

export async function setup(ctx) {
  const chases = new Map();
  const options = new Set(['push','swerve','hide','brake']);
  const pauseTravel = ctx.exports.get('pm-travel', 'pause');
  const resumeTravel = ctx.exports.get('pm-travel', 'resume');
  const abortTravel = ctx.exports.get('pm-travel', 'abort');

  ctx.exports.register('start', async ({ actorId, vehicleId, pursuer = 'police', difficulty = 30 }) => {
    if (chases.has(actorId)) return chases.get(actorId);
    const driving = ctx.host.getSkill(actorId, 'driving');
    const interruptedTravel = await pauseTravel(actorId, 'chase');
    const chase = {
      id: randomUUID(), actorId, vehicleId, pursuer, difficulty, driving,
      turn: 1, gap: 0, status: 'active', log: [], interruptedTravel: Boolean(interruptedTravel)
    };
    chases.set(actorId, chase);
    ctx.host.send(actorId, 'chase_update', chase);
    await ctx.events.emit('chase:started', { vehicleId, pursuer, difficulty, interruptedTravel: chase.interruptedTravel }, { actorId, roomId: ctx.host.getPlayer(actorId)?.roomId });
    return chase;
  });

  ctx.actions.register('chase:choose', async (action, payload) => {
    const chase = chases.get(action.actorId);
    if (!chase || chase.status !== 'active') throw new Error('There is no active chase.');
    const choice = String(payload?.choice || '');
    if (!options.has(choice)) throw new Error('Invalid chase maneuver.');
    const roll = Math.floor(Math.random() * 100) + 1;
    const modifiers = { push: 8, swerve: 2, hide: -4, brake: 4 };
    const target = 50 + chase.difficulty - chase.driving - modifiers[choice];
    const success = roll >= target;
    chase.gap += success ? (choice === 'hide' ? 2 : 1) : -1;
    chase.log.push({ turn: chase.turn, choice, roll, success, gap: chase.gap });
    chase.turn += 1;
    if (chase.gap >= 3) chase.status = 'escaped';
    if (chase.gap <= -3) chase.status = 'caught';
    ctx.host.send(action.actorId, 'chase_update', chase);
    await action.emit('chase:turnResolved', { chaseId: chase.id, choice, success, gap: chase.gap }, { roomId: action.roomId });
    if (chase.status !== 'active') {
      if (chase.interruptedTravel) {
        if (chase.status === 'escaped') await resumeTravel(action.actorId, 'chase-escaped');
        else await abortTravel(action.actorId, 'chase-caught');
      }
      await action.emit('chase:ended', { chaseId: chase.id, outcome: chase.status, turns: chase.turn - 1 }, { roomId: action.roomId });
      chases.delete(action.actorId);
    }
    return chase;
  });

  ctx.heartbeat.snapshot('active', () => [...chases.values()].map(chase => ({ id: chase.id, actorId: chase.actorId, vehicleId: chase.vehicleId, pursuer: chase.pursuer, turn: chase.turn, gap: chase.gap, status: chase.status })));
}
