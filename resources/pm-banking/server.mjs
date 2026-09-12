export async function setup(ctx) {
  const registerApp = ctx.exports.get('pm-phone', 'registerApp');
  registerApp({ id: 'bank', label: 'Harbor Federal', icon: 'bank', order: 60, action: 'bank:getAccounts' });

  ctx.actions.register('bank:getAccounts', async action => {
    const player = ctx.host.getPlayer(action.actorId);
    if (!player) throw new Error('Account holder is unavailable.');
    const value = { accounts: [
      { id: `checking:${player.characterId}`, label: 'Checking', type: 'personal', balance: ctx.host.getBank(action.actorId) ?? 0 },
      { id: `cash:${player.characterId}`, label: 'Cash on hand', type: 'cash', balance: player.cash }
    ] };
    ctx.host.send(action.actorId, 'bank_state', value);
    return value;
  });

  ctx.actions.register('bank:transfer', async (action, payload) => {
    if (!payload || typeof payload !== 'object') throw new Error('Invalid transfer request.');
    if (typeof payload.amount !== 'number' || !Number.isSafeInteger(payload.amount) || payload.amount <= 0 || payload.amount > 5000) throw new Error('Transfer amount must be a whole number between $1 and $5,000.');
    const toPhone = String(payload.toPhone || '').trim();
    if (!/^\(?(?:\d{3})\)?[\s.-]*\d{3}[\s.-]*\d{4}$/.test(toPhone)) throw new Error('Enter a valid phone number.');
    const requestKey = action.correlationId;
    const result = ctx.host.transferBankByPhone(action.actorId, toPhone, payload.amount, requestKey);
    if (!result) throw new Error('Transfer could not be completed.');
    if (result.targetActorId && !result.idempotent) ctx.host.send(result.targetActorId, 'bank_notice', { text: `A $${result.amount} transfer reached your checking account.` });
    if (!result.idempotent) await action.emit('bank:transferCompleted', { transactionId: result.transactionId, amount: result.amount, to: result.toPhone }, { roomId: action.roomId });
    return { transactionId: result.transactionId, amount: result.amount, balance: result.fromBalance, to: result.toPhone, idempotent: result.idempotent };
  });
}
