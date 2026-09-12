import { randomUUID } from 'node:crypto';

export async function setup(ctx) {
  const chases = new Map();
  const options = new Set(['push','swerve','hide','brake']);
  const pauseTravel = ctx.exports.get('pm-travel', 'pause');
  const resumeTravel = ctx.exports.get('pm-travel', 'resume');
  const abortTravel = ctx.exports.get('pm-travel', 'abort');
  const getTravel = ctx.exports.get('pm-travel', 'getSession');

  const publicChase = chase => chase ? structuredClone(chase) : null;
  const start = async ({ actorId, vehicleId, pursuer = 'police', difficulty = 30 }) => {
    if (chases.has(actorId)) return publicChase(chases.get(actorId));
    const player=ctx.host.getPlayer(actorId),vehicle=ctx.host.getVehicle(vehicleId);
    if(!player||!vehicle)throw new Error('Chase participant is unavailable.');
    const driving = ctx.host.getSkill(actorId, 'driving');
    const interruptedTravel = await pauseTravel(actorId, 'chase');
    const id=randomUUID();
    const activity=ctx.host.beginActivity(actorId,'chase',id,interruptedTravel?['travel']:[]);
    if(!activity?.ok){if(interruptedTravel)await resumeTravel(actorId,'chase-start-failed');throw new Error(activity?.reason||'A chase cannot start right now.');}
    const chase = {id,actorId,vehicleId,pursuer,difficulty,driving,turn:1,gap:0,status:'active',log:[],interruptedTravel:Boolean(interruptedTravel)};
    chases.set(actorId,chase);ctx.host.send(actorId,'chase_update',publicChase(chase));
    await ctx.events.emit('chase:started',{vehicleId,pursuer,difficulty,interruptedTravel:chase.interruptedTravel},{actorId,roomId:player.roomId});return publicChase(chase);
  };
  ctx.exports.register('start',start);

  ctx.actions.register('chase:choose', async (action, payload) => {
    const chase=chases.get(action.actorId);if(!chase||chase.status!=='active')throw new Error('There is no active chase.');
    const choice=String(payload?.choice||'');if(!options.has(choice))throw new Error('Invalid chase maneuver.');
    const roll=Math.floor(Math.random()*100)+1,modifiers={push:8,swerve:2,hide:-4,brake:4},target=50+chase.difficulty-chase.driving-modifiers[choice],success=roll>=target;
    chase.gap+=success?(choice==='hide'?2:1):-1;chase.log.push({turn:chase.turn,choice,roll,success,gap:chase.gap});chase.turn+=1;if(chase.gap>=3)chase.status='escaped';if(chase.gap<=-3)chase.status='caught';
    ctx.host.send(action.actorId,'chase_update',publicChase(chase));await action.emit('chase:turnResolved',{chaseId:chase.id,choice,success,gap:chase.gap},{roomId:action.roomId});
    if(chase.status!=='active'){
      chases.delete(action.actorId);ctx.host.endActivity(action.actorId,'chase');
      if(chase.interruptedTravel){if(chase.status==='escaped')await resumeTravel(action.actorId,'chase-escaped');else await abortTravel(action.actorId,'chase-caught');}
      await action.emit('chase:ended',{chaseId:chase.id,outcome:chase.status,turns:chase.turn-1},{roomId:action.roomId});
    }
    return publicChase(chase);
  });

  ctx.events.on('crime:responding',async event=>{
    const suspectCharacterId=event.payload?.suspectCharacterId;if(!suspectCharacterId)return;
    const online=ctx.host.listOnlinePlayers().find(row=>row.characterId===suspectCharacterId);if(!online)return;
    const travel=getTravel(online.id);if(!travel||travel.status!=='traveling')return;
    try{await start({actorId:online.id,vehicleId:travel.vehicleId,pursuer:'Port Mercy patrol',difficulty:30});ctx.host.send(online.id,'event',{text:'Blue lights flare behind you. A patrol unit is trying to pull you over.'});}catch(error){console.error('[chases] pursuit start failed',error);}
  });

  ctx.events.on('player:left',event=>{if(!event.actorId)return;const chase=chases.get(event.actorId);if(!chase)return;chases.delete(event.actorId);ctx.host.endActivity(event.actorId,'chase');if(chase.interruptedTravel)void abortTravel(event.actorId,'disconnected-during-chase');});
  ctx.lifecycle.onDispose(()=>chases.clear());
  ctx.heartbeat.snapshot('active',()=>[...chases.values()].map(chase=>({id:chase.id,actorId:chase.actorId,vehicleId:chase.vehicleId,pursuer:chase.pursuer,turn:chase.turn,gap:chase.gap,status:chase.status})));
}
