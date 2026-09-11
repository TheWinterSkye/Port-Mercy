export async function setup(ctx) {
  const jobs = new Map();
  const registerApp = ctx.exports.get('pm-phone', 'registerApp');
  registerApp({ id: 'jobs', label: 'Work', icon: 'briefcase', order: 80, action: 'job:listAvailable' });

  ctx.exports.register('registerJob', (definition) => {
    if (!definition?.id || !definition?.label || !definition?.roomId) throw new Error('Invalid job definition.');
    if (jobs.has(definition.id)) throw new Error(`Job already registered: ${definition.id}`);
    jobs.set(definition.id, structuredClone(definition));
  });
  ctx.exports.register('getJob', id => jobs.get(id));
  ctx.exports.register('listJobs', () => [...jobs.values()].map(job => structuredClone(job)));

  ctx.actions.register('job:clockIn', async (action, payload) => {
    const job = jobs.get(payload?.jobId);
    const player = ctx.host.getPlayer(action.actorId);
    if (!job || !player) throw new Error('That job is unavailable.');
    if (player.roomId !== job.roomId) throw new Error(`You must be at ${job.locationLabel || job.label} to clock in.`);
    ctx.host.setPlayerJob(action.actorId, job.id, job.label, true);
    ctx.host.send(action.actorId, 'event', { text: `You clock in for ${job.label}.` });
    await action.emit('job:clockedIn', { jobId: job.id, label: job.label }, { roomId: player.roomId });
    return { jobId: job.id, onDuty: true };
  });

  ctx.actions.register('job:listAvailable', async action => {
    const player = ctx.host.getPlayer(action.actorId);
    if (!player) throw new Error('Player is unavailable.');
    const available = [...jobs.values()].map(job => ({ id: job.id, label: job.label, roomId: job.roomId, locationLabel: job.locationLabel || job.label, status: job.status || 'available', here: job.roomId === player.roomId }));
    ctx.host.send(action.actorId, 'job_list', { jobs: available });
    return { jobs: available };
  });

  ctx.actions.register('job:clockOut', async (action) => {
    const player = ctx.host.getPlayer(action.actorId);
    if (!player) throw new Error('Player is unavailable.');
    const oldJob = player.jobId || player.job;
    ctx.host.setOnDuty(action.actorId, false);
    ctx.host.send(action.actorId, 'event', { text: 'You clock out.' });
    await action.emit('job:clockedOut', { jobId: oldJob }, { roomId: player.roomId });
    return { onDuty: false };
  });

  ctx.actions.register('job:performAvailable', async (action) => {
    const player = ctx.host.getPlayer(action.actorId);
    if (!player) throw new Error('Player is unavailable.');
    const job = [...jobs.values()].find(entry => entry.roomId === player.roomId && entry.quickTask);
    if (!job) throw new Error('There is no work available here right now.');
    if (player.jobId !== job.id || !player.onDuty) {
      const clocked = await action.execute('job:clockIn', { actorId: action.actorId, roomId: player.roomId, source: 'resource', payload: { jobId: job.id } });
      if (!clocked.ok) throw new Error(clocked.reason);
    }
    const completed = await action.execute('job:completeTask', { actorId: action.actorId, roomId: player.roomId, source: 'resource', payload: { jobId: job.id, taskId: job.quickTask } });
    if (!completed.ok) throw new Error(completed.reason);
    return completed.value;
  });

  ctx.actions.register('job:completeTask', async (action, payload) => {
    const job = jobs.get(payload?.jobId);
    const player = ctx.host.getPlayer(action.actorId);
    if (!job || !player) throw new Error('That job is unavailable.');
    if (player.roomId !== job.roomId) throw new Error('You are not at the job site.');
    if (player.jobId !== job.id || !player.onDuty) throw new Error('You are not clocked in for this job.');
    const task = job.tasks?.[payload?.taskId];
    if (!task) throw new Error('That task is unavailable.');
    await action.emit('job:taskStarted', { jobId: job.id, taskId: payload.taskId }, { roomId: player.roomId });
    ctx.host.adjustCash(action.actorId, Number(task.pay || 0));
    ctx.host.adjustStress(action.actorId, Number(task.stress || 0));
    ctx.host.send(action.actorId, 'event', { text: task.playerText || `You finish ${task.label}. +$${task.pay || 0}.` });
    if (task.roomText) ctx.host.remember(player.roomId, task.roomText.replaceAll('{player}', player.name));
    await action.emit('job:taskCompleted', { jobId: job.id, taskId: payload.taskId, label: task.label, pay: task.pay || 0, stress: task.stress || 0 }, { roomId: player.roomId });
    return { jobId: job.id, taskId: payload.taskId, pay: task.pay || 0, stress: task.stress || 0 };
  });

  ctx.heartbeat.snapshot('registry', () => [...jobs.values()].map(job => ({ id: job.id, label: job.label, roomId: job.roomId, status: job.status || 'available', demand: job.demand || 'unknown' })));
}
