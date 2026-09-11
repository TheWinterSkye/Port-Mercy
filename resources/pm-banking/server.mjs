export async function setup(ctx) {
  const registerApp = ctx.exports.get('pm-phone', 'registerApp');
  registerApp({ id: 'bank', label: 'Harbor Federal', icon: 'bank', order: 60, action: 'bank:getAccounts' });

  ctx.actions.register('bank:getAccounts', async action => {
    const player = ctx.host.getPlayer(action.actorId);
    if (!player) throw new Error('Account holder is unavailable.');
    const value = { accounts: [
      { id: `checking:${action.actorId}`, label: 'Checking', type: 'personal', balance: ctx.host.getBank(action.actorId) ?? 0 },
      { id: `cash:${action.actorId}`, label: 'Cash on hand', type: 'cash', balance: player.cash }
    ] };
    ctx.host.send(action.actorId, 'bank_state', value);
    return value;
  });

  ctx.actions.register('bank:transfer', async (action, payload) => {
    const amount = Math.floor(Number(payload?.amount || 0));
    const target = ctx.host.findPlayerByPhone(String(payload?.toPhone || ''));
    if (!target || amount <= 0) throw new Error('Invalid transfer.');
    const balance = ctx.host.getBank(action.actorId) ?? 0;
    if (balance < amount) throw new Error('Insufficient funds.');
    ctx.host.adjustBank(action.actorId, -amount); ctx.host.adjustBank(target.id, amount);
    ctx.host.send(target.id, 'bank_notice', { text: `A $${amount} transfer reached your checking account.` });
    await action.emit('bank:transferCompleted', { amount, to: target.player.phoneNumber }, { roomId: action.roomId });
    return { amount, balance: ctx.host.getBank(action.actorId) };
  });
}
