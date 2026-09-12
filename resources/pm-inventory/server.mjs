export async function setup(ctx) {
  const usableItems = new Map();
  const openSessions = new Map();

  ctx.exports.register('registerUsableItem', (templateId, handler) => {
    if (usableItems.has(templateId)) throw new Error(`Usable item already registered: ${templateId}`);
    usableItems.set(templateId, handler);
  });
  ctx.exports.register('isOpen', actorId => openSessions.has(actorId));

  const refreshActor = actorId => {
    const inventoryId = openSessions.get(actorId);
    if (!inventoryId) return;
    const refreshed = ctx.host.resolveInventoryByCanonicalId(actorId, inventoryId);
    if (!refreshed) {
      openSessions.delete(actorId);
      ctx.host.send(actorId, 'inventory_close', { reason: 'access_changed' });
      return;
    }
    ctx.host.send(actorId, 'inventory_open', refreshed);
  };
  const refreshAll = () => {
    for (const actorId of [...openSessions.keys()]) refreshActor(actorId);
  };
  const refreshInventories = ids => {
    const wanted = new Set(ids.filter(Boolean));
    for (const [actorId, openId] of openSessions) if (wanted.has(openId)) refreshActor(actorId);
  };
  ctx.exports.register('refreshAll', refreshAll);
  ctx.exports.register('refreshInventories', refreshInventories);

  ctx.actions.register('inventory:open', async (action, payload) => {
    const spec = { type: payload?.inventoryType || 'player', id: payload?.inventoryId || action.actorId, compartment: payload?.compartment };
    const inventory = ctx.host.resolveInventory(action.actorId, spec);
    if (!inventory) throw new Error('That inventory is unavailable or you no longer have access to it.');
    openSessions.set(action.actorId, inventory.id);
    ctx.host.send(action.actorId, 'inventory_open', inventory);
    await action.emit('inventory:opened', { inventoryId: inventory.id, inventoryType: inventory.type, label: inventory.label }, { roomId: action.roomId });
    return { inventoryId: inventory.id, inventoryType: inventory.type };
  });

  ctx.actions.register('inventory:close', async action => {
    const inventoryId = openSessions.get(action.actorId);
    openSessions.delete(action.actorId);
    ctx.host.send(action.actorId, 'inventory_close', {});
    await action.emit('inventory:closed', { inventoryId: inventoryId || null }, { roomId: action.roomId });
    return { inventoryId: inventoryId || null };
  });

  ctx.actions.register('inventory:use', async (action, payload) => {
    const item = ctx.host.getPlayerItem(action.actorId, payload?.itemId);
    if (!item || !item.usable) throw new Error('That item cannot be used right now.');
    const handler = usableItems.get(item.templateId);
    if (!handler) throw new Error(`${item.name} has no use handler.`);
    const result = await handler({ action, item, host: ctx.host });
    refreshActor(action.actorId);
    await action.emit('inventory:itemUsed', { itemId: item.id, templateId: item.templateId, name: item.name, result: result ?? null }, { roomId: action.roomId });
    return result ?? { used: true };
  });

  ctx.actions.register('inventory:drop', async (action, payload) => {
    const item = ctx.host.getPlayerItem(action.actorId, payload?.itemId);
    if (!item) throw new Error('That item is no longer in your inventory.');
    if (!item.droppable) throw new Error(`You decide not to leave your ${item.name.toLowerCase()} behind.`);
    if (!ctx.host.removePlayerItem(action.actorId, item.id)) throw new Error('The item could not be dropped.');
    ctx.host.send(action.actorId, 'event', { text: `You leave ${item.name.toLowerCase()} here.` });
    refreshActor(action.actorId);
    await action.emit('inventory:itemDropped', { itemId: item.id, templateId: item.templateId, name: item.name }, { roomId: action.roomId });
    return { dropped: item.id };
  });

  ctx.actions.register('inventory:move', async (action, payload) => {
    const moved = ctx.host.moveInventoryItem(action.actorId, payload);
    refreshInventories([moved.fromInventory, moved.toInventory]);
    await action.emit('inventory:itemMoved', moved, { roomId: action.roomId });
    return moved;
  });

  ctx.events.on('world:roomChanged', event => {
    if (event.actorId) refreshActor(event.actorId);
  });
  ctx.events.on('player:left', event => {
    if (event.actorId) openSessions.delete(event.actorId);
  });
  ctx.lifecycle.onDispose(() => openSessions.clear());

  ctx.exports.register('open', (actorId, spec, roomId) => ctx.actions.execute('inventory:open', { actorId, roomId, source: 'resource', payload: spec }));
}
