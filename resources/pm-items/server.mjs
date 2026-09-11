export async function setup(ctx) {
  const registerUsableItem = ctx.exports.get('pm-inventory', 'registerUsableItem');

  registerUsableItem('water.bottle', async ({ action, item, host }) => {
    host.adjustStress(action.actorId, -2);
    host.removePlayerItem(action.actorId, item.id);
    host.send(action.actorId, 'event', { text: 'You finish the water. -2 stress.' });
    await ctx.events.emit('item:consumed', { templateId: item.templateId }, { actorId: action.actorId, roomId: action.roomId });
    return { consumed: true, stressDelta: -2 };
  });

  registerUsableItem('drink.energy', async ({ action, item, host }) => {
    host.adjustStress(action.actorId, -1);
    host.removePlayerItem(action.actorId, item.id);
    host.send(action.actorId, 'event', { text: 'You drink it. It tastes medicinal. -1 stress.' });
    await ctx.events.emit('item:consumed', { templateId: item.templateId }, { actorId: action.actorId, roomId: action.roomId });
    return { consumed: true, stressDelta: -1 };
  });
}
