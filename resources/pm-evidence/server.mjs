import { randomUUID } from 'node:crypto';
export async function setup(ctx) {
  const evidence = new Map();
  const record = async definition => {
    const row = {
      id: randomUUID(),
      type: definition.type || 'trace',
      roomId: definition.roomId,
      sourceActorId: definition.sourceActorId || null,
      summary: definition.summary || 'Unidentified trace evidence.',
      createdAt: Date.now(),
      expiresAt: definition.expiresAt || Date.now() + 6 * 60 * 60 * 1000,
      status: 'open'
    };
    evidence.set(row.id, row);
    await ctx.events.emit('evidence:created', { id: row.id, type: row.type, roomId: row.roomId, summary: row.summary }, { actorId: row.sourceActorId || undefined, roomId: row.roomId });
    return structuredClone(row);
  };
  ctx.exports.register('record', record);
  ctx.exports.register('listRoom', roomId => [...evidence.values()].filter(row => row.roomId === roomId && row.status === 'open').map(structuredClone));

  ctx.events.on('crime:witnessed', async event => {
    await record({ type: 'witness_statement', roomId: event.roomId, sourceActorId: event.actorId, summary: 'A witness account was created from a reported incident.', expiresAt: Date.now() + 24 * 60 * 60 * 1000 });
  });

  ctx.actions.register('evidence:collect', async (action, payload) => {
    const row = evidence.get(payload?.evidenceId);
    if (!row || row.status !== 'open') throw new Error('That evidence is unavailable.');
    row.status = 'collected'; row.collectedBy = action.actorId; row.collectedAt = Date.now();
    await action.emit('evidence:collected', { id: row.id, type: row.type, roomId: row.roomId }, { roomId: row.roomId });
    return structuredClone(row);
  });

  ctx.heartbeat.snapshot('open-summary', () => {
    const counts = {};
    for (const row of evidence.values()) if (row.status === 'open') counts[`${row.roomId}:${row.type}`] = (counts[`${row.roomId}:${row.type}`] || 0) + 1;
    return counts;
  });
}
