export async function setup(ctx) {
  const targets = new Map();
  ctx.exports.register('register', (targetId, option) => {
    if (!targetId || !option?.id || !option?.label || !option?.action) throw new Error('Invalid interaction option.');
    const list = targets.get(targetId) ?? [];
    list.push(structuredClone(option)); targets.set(targetId, list);
  });
  ctx.exports.register('list', targetId => structuredClone(targets.get(targetId) ?? []));

  const visible = (action, targetId) => (targets.get(targetId) ?? []).filter(option => {
    const player = ctx.host.getPlayer(action.actorId); if (!player) return false;
    if (option.roomId && option.roomId !== player.roomId) return false;
    if (option.jobId && option.jobId !== player.jobId) return false;
    if (option.onDuty === true && !player.onDuty) return false;
    return true;
  });

  ctx.actions.register('interaction:list', async (action, payload) => {
    const targetId = String(payload?.targetId || `room:${action.roomId}`);
    return { targetId, options: visible(action, targetId) };
  });

  ctx.actions.register('interaction:run', async (action, payload) => {
    const targetId = String(payload?.targetId || '');
    const option = visible(action, targetId).find(entry => entry.id === payload?.optionId);
    if (!option) throw new Error('That interaction is not available.');
    const result = await action.execute(option.action, { actorId: action.actorId, roomId: action.roomId, source: 'resource', payload: option.payload ?? {} });
    if (!result.ok) throw new Error(result.reason);
    await action.emit('interaction:used', { targetId, optionId: option.id, action: option.action }, { roomId: action.roomId });
    return result.value;
  });
}
