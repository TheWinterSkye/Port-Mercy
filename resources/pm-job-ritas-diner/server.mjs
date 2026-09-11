export async function setup(ctx) {
  const registerJob = ctx.exports.get('pm-jobs', 'registerJob');
  const registerInteraction = ctx.exports.get('pm-interactions', 'register');
  registerJob({
    id: 'ritas.dishwasher',
    label: "Rita's Diner cleanup",
    locationLabel: "Rita's Diner",
    roomId: 'southward.diner',
    status: 'occasional cash shifts',
    demand: 'sporadic',
    quickTask: 'dish_pit',
    grades: {
      0: { label: 'Cleanup hand', payRate: 12 }
    },
    tasks: {
      dish_pit: {
        label: 'Clear the dish pit and mop behind the counter',
        pay: 12,
        stress: 3,
        playerText: 'You clear a rack of dishes and mop behind the counter. +$12, +3 stress.',
        roomText: '{player} worked through a stack of dishes behind the counter.'
      }
    }
  });
  registerInteraction('room:southward.diner', { id: 'diner-cleanup-shift', label: 'Wash dishes', action: 'job:performAvailable', payload: {}, roomId: 'southward.diner' });
}
