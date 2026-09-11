export async function setup(ctx) {
  ctx.actions.register('chat:send', async (action, payload) => {
    const player = ctx.host.getPlayer(action.actorId);
    if (!player) throw new Error('Player is unavailable.');
    const text = String(payload?.text || '').trim().replace(/\s+/g, ' ').slice(0, 280);
    if (!text) throw new Error('Message is empty.');
    const scope = payload?.scope === 'global' ? 'global' : 'room';
    const message = ctx.host.sendChat(action.actorId, scope, text);
    await action.emit('chat:sent', { scope, length: text.length }, { roomId: player.roomId });
    return message;
  });
}
