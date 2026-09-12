export async function setup(ctx) {
  const registerJob = ctx.exports.get('pm-jobs', 'registerJob');
  const registerInteraction = ctx.exports.get('pm-interactions', 'register');
  registerJob({
    id: 'mercy.fuel.stock',
    label: 'Mercy Fuel night stock',
    locationLabel: 'Mercy Fuel & Mart',
    roomId: 'southward.gas.forecourt',
    status: 'casual shifts available',
    demand: 'low but recurring',
    quickTask: 'stock_delivery',
    grades: {
      0: { label: 'Casual stock hand', payRate: 14 }
    },
    tasks: {
      stock_delivery: {
        label: 'Move delivery boxes to the stock room',
        durationMs: 12000,
        pay: 14,
        stress: 4,
        playerText: 'You haul two boxes into the stock room. +$14, +4 stress.',
        roomText: '{player} moved a delivery into the stock room.'
      }
    }
  });
  registerInteraction('room:southward.gas.forecourt', { id: 'fuel-stock-shift', label: 'Unload delivery', action: 'job:performAvailable', payload: {}, roomId: 'southward.gas.forecourt', order: 10 });
}
