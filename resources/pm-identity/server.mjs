export async function setup(ctx) {
  const registerUsableItem = ctx.exports.get('pm-inventory', 'registerUsableItem');
  registerUsableItem('document.drivers_license', async ({ action, item, host }) => {
    const metadata = host.itemMetadata(item);
    host.send(action.actorId, 'document_view', { itemId: item.id, metadata });
    host.send(action.actorId, 'event', { text: `Driver license: ${metadata.legalName} · ${metadata.licenseNumber} · ${metadata.address}.` });
    await ctx.events.emit('identity:documentViewed', { documentType: 'drivers_license' }, { actorId: action.actorId, roomId: action.roomId });
    return { viewed: true };
  });
}
