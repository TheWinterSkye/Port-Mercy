export async function setup(ctx) {
  ctx.actions.before('*', async action => {
    if (!ctx.host.actionAllowed(action.actorId, action.action, action.source)) {
      const current = ctx.host.getActivity(action.actorId);
      const label = current?.kind === 'travel' ? 'while traveling' : current?.kind === 'work' ? 'while working' : current?.kind === 'chase' ? 'during a chase' : 'right now';
      return `You cannot do that ${label}.`;
    }
  });

  ctx.actions.register('player:move', async (action, payload) => {
    const moved = ctx.host.movePlayer(action.actorId, String(payload?.direction || ''));
    if (!moved) throw new Error(`There is no ${String(payload?.direction || 'that')} exit.`);
    ctx.host.send(action.actorId, 'event', { text: `You move ${moved.direction}.` });
    await action.emit('world:roomChanged', moved, { roomId: moved.to });
    return moved;
  });

  ctx.actions.register('world:take', async (action, payload) => {
    const player = ctx.host.getPlayer(action.actorId);
    if (!player) throw new Error('Player is unavailable.');
    const target = String(payload?.target || '');
    if (target !== 'energy_drink' || player.roomId !== 'southward.mercyfuel.interior') throw new Error('You cannot take that.');

    const item = ctx.host.takeShopItem(action.actorId, 'shop:mercy.fuel:cooler', 'drink.energy');
    ctx.host.send(action.actorId, 'event', { text: 'You slip a Redline energy drink into your bag. Maya looks up sharply.' });
    ctx.host.roomEvent(player.roomId, 'Maya steps away from the register and reaches for the phone.');
    const incident = ctx.host.addIncident({
      type: 'shoplifting',
      roomId: player.roomId,
      status: 'witnessed',
      summary: 'Maya Torres witnessed a customer pocket an energy drink and reached for the phone.',
      suspectCharacterId: player.characterId
    });
    await action.emit('world:itemTaken', { target, itemTemplateId: item.templateId, itemId: item.id, method: 'unpaid' }, { roomId: player.roomId });
    await action.emit('crime:witnessed', { incidentId: incident.id, type: incident.type, summary: incident.summary, suspectCharacterId: player.characterId }, { roomId: player.roomId, ai: 'full' });
    return { itemId: item.id, incidentId: incident.id };
  });

  ctx.heartbeat.snapshot('rooms', () => ctx.host.roomSnapshot());
}
