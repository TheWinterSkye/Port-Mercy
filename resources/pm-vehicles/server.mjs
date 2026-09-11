export async function setup(ctx) {
  const registerApp = ctx.exports.get('pm-phone', 'registerApp');
  const registerInteraction = ctx.exports.get('pm-interactions', 'register');
  registerApp({ id: 'vehicles', label: 'My Vehicles', icon: 'car', order: 70, action: 'vehicle:listMine', mode: 'read', description: 'Parking location, registration, condition, financing, service, and impound status.' });
  registerInteraction('entity:vehicle:sedan.blue', { id: 'open-trunk', label: 'Open trunk', action: 'vehicle:openStorage', payload: { vehicleId: 'sedan.blue', compartment: 'trunk' }, roomId: 'southward.gas.forecourt' });

  ctx.actions.before('inventory:open', async (action, payload) => {
    const type = payload?.inventoryType;
    if (type !== 'vehicle_trunk' && type !== 'vehicle_glovebox') return;
    const vehicle = ctx.host.getVehicle(payload?.inventoryId);
    if (!vehicle) return 'That vehicle does not exist.';
    const player = ctx.host.getPlayer(action.actorId);
    if (!player || player.roomId !== vehicle.roomId) return 'That vehicle is not here.';
    if (vehicle.locked && vehicle.ownerId !== action.actorId) return 'The vehicle is locked.';
  });

  ctx.actions.register('vehicle:openStorage', async (action, payload) => {
    const vehicle = ctx.host.getVehicle(payload?.vehicleId);
    if (!vehicle) throw new Error('That vehicle does not exist.');
    const compartment = payload?.compartment === 'glovebox' ? 'glovebox' : 'trunk';
    const opened = await action.execute('inventory:open', {
      actorId: action.actorId,
      roomId: action.roomId,
      source: 'resource',
      payload: { inventoryType: `vehicle_${compartment}`, inventoryId: vehicle.id, compartment }
    });
    if (!opened.ok) throw new Error(opened.reason);
    await action.emit('vehicle:storageOpened', { vehicleId: vehicle.id, compartment }, { roomId: vehicle.roomId });
    return opened.value;
  });

  ctx.actions.register('vehicle:setLock', async (action, payload) => {
    const changed = ctx.host.setVehicleLock(action.actorId, payload?.vehicleId, Boolean(payload?.locked));
    if (!changed) throw new Error('You cannot change that vehicle lock.');
    await action.emit('vehicle:lockChanged', changed, { roomId: changed.roomId });
    return changed;
  });

  ctx.actions.register('vehicle:listMine', async action => {
    const vehicles = ctx.host.vehicleSnapshot().filter(vehicle => ctx.host.getVehicle(vehicle.id)?.ownerId === action.actorId);
    ctx.host.send(action.actorId, 'vehicle_list', { vehicles });
    return { vehicles };
  });

  ctx.heartbeat.snapshot('vehicles', () => ctx.host.vehicleSnapshot());
}
