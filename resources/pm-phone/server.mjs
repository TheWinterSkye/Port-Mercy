import { randomUUID } from 'node:crypto';
function clone(value) { return structuredClone(value); }

export async function setup(ctx) {
  const registerUsableItem = ctx.exports.get('pm-inventory', 'registerUsableItem');
  const apps = new Map();
  const messages = new Map();
  const calls = new Map();

  const coreApps = [
    { id: 'contacts', label: 'Contacts', icon: 'contacts', order: 10 },
    { id: 'messages', label: 'Messages', icon: 'messages', order: 20 },
    { id: 'calls', label: 'Calls', icon: 'phone', order: 30 },
    { id: 'mail', label: 'Mail', icon: 'mail', order: 40 },
  ];
  for (const app of coreApps) apps.set(app.id, app);

  ctx.exports.register('registerApp', definition => {
    if (!definition?.id || !definition?.label) throw new Error('Phone app requires id and label.');
    apps.set(definition.id, clone(definition));
  });
  ctx.exports.register('listApps', () => [...apps.values()].sort((a,b)=>(a.order||100)-(b.order||100)).map(clone));

  const inboxFor = actorId => messages.get(actorId) ?? [];
  const pushMessage = (actorId, row) => {
    const inbox = inboxFor(actorId);
    inbox.push(row);
    if (inbox.length > 200) inbox.splice(0, inbox.length - 200);
    messages.set(actorId, inbox);
  };

  const phoneState = actorId => {
    const player = ctx.host.getPlayer(actorId);
    if (!player) return null;
    const contacts = ctx.host.listOnlinePlayers().filter(p => p.id !== actorId).map(p => ({ name: p.name, phoneNumber: p.phoneNumber, online: true }));
    return {
      owner: { name: player.name, phoneNumber: player.phoneNumber },
      apps: [...apps.values()].sort((a,b)=>(a.order||100)-(b.order||100)).map(clone),
      contacts,
      messages: inboxFor(actorId).slice(-80),
      activeCall: calls.get(actorId) ?? null,
    };
  };


  registerUsableItem('phone.basic', async ({ action }) => {
    const result = await action.execute('phone:open', { actorId: action.actorId, roomId: action.roomId, source: 'resource', payload: {} });
    if (!result.ok) throw new Error(result.reason);
    return result.value;
  });

  ctx.actions.register('phone:open', async action => {
    const state = phoneState(action.actorId);
    if (!state) throw new Error('Phone owner is unavailable.');
    ctx.host.send(action.actorId, 'phone_open', state);
    await action.emit('phone:opened', { appCount: state.apps.length }, { roomId: action.roomId });
    return state;
  });

  ctx.actions.register('phone:sendMessage', async (action, payload) => {
    const sender = ctx.host.getPlayer(action.actorId);
    const target = ctx.host.findPlayerByPhone(String(payload?.to || ''));
    const text = String(payload?.text || '').trim().replace(/\s+/g, ' ').slice(0, 500);
    if (!sender || !target) throw new Error('That number is unavailable.');
    if (!text) throw new Error('Message cannot be empty.');
    const row = { id: randomUUID(), from: sender.phoneNumber, fromName: sender.name, to: target.player.phoneNumber, text, sentAt: Date.now() };
    pushMessage(action.actorId, row); pushMessage(target.id, row);
    ctx.host.send(target.id, 'phone_message', row);
    ctx.host.send(action.actorId, 'phone_message', row);
    await action.emit('phone:messageSent', { to: target.player.phoneNumber, length: text.length }, { roomId: action.roomId });
    return row;
  });

  ctx.actions.register('phone:startCall', async (action, payload) => {
    const caller = ctx.host.getPlayer(action.actorId);
    const target = ctx.host.findPlayerByPhone(String(payload?.to || ''));
    if (!caller || !target) throw new Error('That number is unavailable.');
    if (calls.has(action.actorId) || calls.has(target.id)) throw new Error('One of the phones is already in a call.');
    const call = { id: randomUUID(), callerId: action.actorId, callerName: caller.name, callerNumber: caller.phoneNumber, calleeId: target.id, calleeName: target.player.name, calleeNumber: target.player.phoneNumber, status: 'ringing', startedAt: Date.now(), transcript: [] };
    calls.set(action.actorId, call); calls.set(target.id, call);
    ctx.host.send(action.actorId, 'phone_call', call); ctx.host.send(target.id, 'phone_call', call);
    await action.emit('phone:callStarted', { to: target.player.phoneNumber }, { roomId: action.roomId });
    return call;
  });

  ctx.actions.register('phone:answerCall', async action => {
    const call = calls.get(action.actorId);
    if (!call || call.status !== 'ringing' || call.calleeId !== action.actorId) throw new Error('There is no incoming call to answer.');
    call.status = 'connected'; call.answeredAt = Date.now();
    ctx.host.send(call.callerId, 'phone_call', call); ctx.host.send(call.calleeId, 'phone_call', call);
    await action.emit('phone:callAnswered', { callId: call.id }, { roomId: action.roomId });
    return call;
  });

  ctx.actions.register('phone:declineCall', async action => {
    const call = calls.get(action.actorId);
    if (!call || call.status !== 'ringing') throw new Error('There is no ringing call.');
    call.status = 'declined'; call.endedAt = Date.now();
    ctx.host.send(call.callerId, 'phone_call', call); ctx.host.send(call.calleeId, 'phone_call', call);
    calls.delete(call.callerId); calls.delete(call.calleeId);
    await action.emit('phone:callEnded', { callId: call.id, reason: 'declined' }, { roomId: action.roomId });
    return { ended: true };
  });

  ctx.actions.register('phone:sendCallText', async (action, payload) => {
    const call = calls.get(action.actorId);
    const sender = ctx.host.getPlayer(action.actorId);
    const text = String(payload?.text || '').trim().replace(/\s+/g, ' ').slice(0, 500);
    if (!call || call.status !== 'connected' || !sender) throw new Error('You are not in a connected call.');
    if (!text) throw new Error('Call text cannot be empty.');
    const line = { id: randomUUID(), fromId: action.actorId, fromName: sender.name, text, sentAt: Date.now() };
    call.transcript.push(line); if (call.transcript.length > 100) call.transcript.shift();
    ctx.host.send(call.callerId, 'phone_call_text', line); ctx.host.send(call.calleeId, 'phone_call_text', line);
    await action.emit('phone:callText', { callId: call.id, length: text.length }, { roomId: action.roomId });
    return line;
  });

  ctx.actions.register('phone:endCall', async action => {
    const call = calls.get(action.actorId);
    if (!call) throw new Error('There is no active call.');
    call.status = 'ended'; call.endedAt = Date.now();
    ctx.host.send(call.callerId, 'phone_call', call); ctx.host.send(call.calleeId, 'phone_call', call);
    calls.delete(call.callerId); calls.delete(call.calleeId);
    await action.emit('phone:callEnded', { callId: call.id, reason: 'hangup' }, { roomId: action.roomId });
    return { ended: true };
  });

  ctx.heartbeat.snapshot('apps', () => [...apps.values()].map(app => ({ id: app.id, label: app.label })));
}
