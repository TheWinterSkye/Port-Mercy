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
    const amount = Math.floor(Number(payload?.amount || 0));
    if (!Number.isSafeInteger(amount) || amount <= 0 || amount > 5000) throw new Error('Transfer amount must be between $1 and $5,000.');
    const result = ctx.host.transferBankByPhone(action.actorId, String(payload?.toPhone || ''), amount);
    if (!result) throw new Error('Transfer could not be completed.');
    if (result.targetActorId) ctx.host.send(result.targetActorId, 'bank_notice', { text: `A $${amount} transfer reached your checking account.` });
    await action.emit('bank:transferCompleted', { transactionId: result.transactionId, amount, to: result.toPhone }, { roomId: action.roomId });
    return { transactionId: result.transactionId, amount, balance: result.fromBalance, to: result.toPhone };
  });
}
