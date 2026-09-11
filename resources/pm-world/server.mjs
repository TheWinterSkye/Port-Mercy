export async function setup(ctx) {
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
    if (target !== 'energy_drink' || player.roomId !== 'southward.gas.forecourt') throw new Error('You cannot take that.');

    const item = ctx.host.createItem('drink.energy', 'Redline energy drink', 'consumable', 'A dented can of something aggressively citrus.', true, true, 0.35);
    ctx.host.addPlayerItem(action.actorId, item);
    ctx.host.send(action.actorId, 'event', { text: 'You slip a Redline energy drink into your bag. The clerk looks up sharply.' });
    ctx.host.roomEvent(player.roomId, 'The night clerk steps away from the register and reaches for the phone.');
    const incident = ctx.host.addIncident({
      type: 'shoplifting',
      roomId: player.roomId,
      status: 'witnessed',
      summary: 'The night clerk witnessed a customer pocket an energy drink and reached for the phone.'
    });
    await action.emit('world:itemTaken', { target, itemTemplateId: item.templateId, method: 'unpaid' }, { roomId: player.roomId });
    await action.emit('crime:witnessed', { incidentId: incident.id, type: incident.type, summary: incident.summary }, { roomId: player.roomId, ai: 'full' });
    return { itemId: item.id, incidentId: incident.id };
  });

  ctx.heartbeat.snapshot('rooms', () => ctx.host.roomSnapshot());
}
