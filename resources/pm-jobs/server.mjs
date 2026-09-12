export async function setup(ctx) {
  const jobs = new Map();
  const activeTasks = new Map();
  const registerApp = ctx.exports.get('pm-phone', 'registerApp');
  registerApp({ id: 'jobs', label: 'Work', icon: 'briefcase', order: 80, action: 'job:listAvailable' });

  ctx.exports.register('registerJob', definition => {
    if (!definition?.id || !definition?.label || !definition?.roomId) throw new Error('Invalid job definition.');
    if (jobs.has(definition.id)) throw new Error(`Job already registered: ${definition.id}`);
    jobs.set(definition.id, structuredClone(definition));
  });
  ctx.exports.register('getJob', id => jobs.get(id));
  ctx.exports.register('listJobs', () => [...jobs.values()].map(job => structuredClone(job)));
  ctx.exports.register('getActiveTask', actorId => {
    const session=activeTasks.get(actorId); if(!session)return null;
    const {timer,...safe}=session; return structuredClone(safe);
  });

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
    const active=activeTasks.get(action.actorId); const activeSafe=active?{jobId:active.jobId,taskId:active.taskId,label:active.label,startedAt:active.startedAt,endsAt:active.endsAt}:null;
    ctx.host.send(action.actorId, 'job_list', { jobs: available, activeTask:activeSafe });
    return { jobs: available, activeTask:activeSafe };
  });

  ctx.actions.register('job:clockOut', async action => {
    const player = ctx.host.getPlayer(action.actorId);
    if (!player) throw new Error('Player is unavailable.');
    if(activeTasks.has(action.actorId)) throw new Error('Finish the current task before clocking out.');
    const oldJob = player.jobId || player.job;
    ctx.host.setOnDuty(action.actorId, false);
    ctx.host.send(action.actorId, 'event', { text: 'You clock out.' });
    await action.emit('job:clockedOut', { jobId: oldJob }, { roomId: player.roomId });
    return { onDuty: false };
  });

  const cancelTask = (actorId, reason='interrupted') => {
    const session=activeTasks.get(actorId);if(!session)return null;
    clearTimeout(session.timer);activeTasks.delete(actorId);ctx.host.endActivity(actorId,'work');
    const player=ctx.host.getPlayer(actorId);if(player)ctx.host.send(actorId,'job_task',{status:'cancelled',jobId:session.jobId,taskId:session.taskId,reason});
    return session;
  };

  async function finish(session){
    if(activeTasks.get(session.actorId)?.id!==session.id)return;
    activeTasks.delete(session.actorId);ctx.host.endActivity(session.actorId,'work');
    const player=ctx.host.getPlayer(session.actorId);
    if(!player||player.roomId!==session.roomId||player.jobId!==session.jobId||!player.onDuty){
      if(player)ctx.host.send(session.actorId,'event',{text:`${session.label} was interrupted before completion.`});
      return;
    }
    const cash=ctx.host.adjustCash(session.actorId,session.pay);
    if(cash===null) return;
    ctx.host.adjustStress(session.actorId,session.stress);
    ctx.host.send(session.actorId,'job_task',{status:'completed',jobId:session.jobId,taskId:session.taskId,completedAt:Date.now(),pay:session.pay,stress:session.stress});
    ctx.host.send(session.actorId,'event',{text:session.playerText||`You finish ${session.label}. +$${session.pay}.`});
    if(session.roomText)ctx.host.remember(session.roomId,session.roomText.replaceAll('{player}',player.name));
    await ctx.events.emit('job:taskCompleted',{jobId:session.jobId,taskId:session.taskId,label:session.label,pay:session.pay,stress:session.stress},{actorId:session.actorId,roomId:session.roomId});
  }

  ctx.actions.register('job:startTask', async (action, payload) => {
    if(activeTasks.has(action.actorId)) throw new Error('You are already working on a task.');
    const job=jobs.get(payload?.jobId),player=ctx.host.getPlayer(action.actorId);
    if(!job||!player)throw new Error('That job is unavailable.');
    if(player.roomId!==job.roomId)throw new Error('You are not at the job site.');
    if(player.jobId!==job.id||!player.onDuty)throw new Error('You are not clocked in for this job.');
    if(player.stress>=95)throw new Error('You are too exhausted to start another task right now.');
    const task=job.tasks?.[payload?.taskId]; if(!task)throw new Error('That task is unavailable.');
    const durationMs=Math.max(1500,Math.min(300000,Number(task.durationMs||10000)));
    const startedAt=Date.now(),endsAt=startedAt+durationMs,id=`${action.actorId}:${startedAt}`;
    const activity=ctx.host.beginActivity(action.actorId,'work',id);if(!activity?.ok)throw new Error(activity?.reason||'You cannot start work right now.');
    const session={id,actorId:action.actorId,jobId:job.id,taskId:payload.taskId,label:task.label,roomId:player.roomId,pay:Number(task.pay||0),stress:Number(task.stress||0),playerText:task.playerText,roomText:task.roomText,startedAt,endsAt,timer:null};
    session.timer=setTimeout(()=>void finish(session).catch(error=>console.error('[jobs] task completion failed',error)),durationMs);session.timer.unref?.();
    activeTasks.set(action.actorId,session);
    ctx.host.send(action.actorId,'job_task',{status:'started',jobId:job.id,taskId:payload.taskId,label:task.label,startedAt,endsAt,durationMs});
    ctx.host.send(action.actorId,'event',{text:`You start ${task.label.toLowerCase()}.`});
    await action.emit('job:taskStarted',{jobId:job.id,taskId:payload.taskId,label:task.label,durationMs,endsAt},{roomId:player.roomId});
    return {jobId:job.id,taskId:payload.taskId,status:'working',startedAt,endsAt,durationMs};
  });

  ctx.actions.register('job:performAvailable', async action => {
    const player=ctx.host.getPlayer(action.actorId); if(!player)throw new Error('Player is unavailable.');
    const job=[...jobs.values()].find(entry=>entry.roomId===player.roomId&&entry.quickTask); if(!job)throw new Error('There is no work available here right now.');
    if(player.jobId!==job.id||!player.onDuty){
      const clocked=await action.execute('job:clockIn',{actorId:action.actorId,roomId:player.roomId,source:'resource',payload:{jobId:job.id}}); if(!clocked.ok)throw new Error(clocked.reason);
    }
    const started=await action.execute('job:startTask',{actorId:action.actorId,roomId:player.roomId,source:'resource',payload:{jobId:job.id,taskId:job.quickTask}}); if(!started.ok)throw new Error(started.reason);
    return started.value;
  });

  ctx.events.on('player:left', event => {if(event.actorId)cancelTask(event.actorId,'disconnected');});
  ctx.lifecycle.onDispose(()=>{for(const session of activeTasks.values())clearTimeout(session.timer);activeTasks.clear();});
  ctx.heartbeat.snapshot('registry',()=>[...jobs.values()].map(job=>({id:job.id,label:job.label,roomId:job.roomId,status:job.status||'available',demand:job.demand||'unknown'})));
  ctx.heartbeat.snapshot('active-tasks',()=>[...activeTasks.values()].map(({timer,...task})=>task));
}
