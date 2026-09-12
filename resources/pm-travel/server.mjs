import { randomUUID } from 'node:crypto';

export async function setup(ctx) {
  const sessions = new Map();
  const registerInteraction = ctx.exports.get('pm-interactions','register');
  const refreshInventories = ctx.exports.get('pm-inventory','refreshAll');
  const routes = new Map([
    ['southward.gas.forecourt>southward.diner', { seconds: 18, label: 'Harbor Avenue westbound' }],
    ['southward.diner>southward.gas.forecourt', { seconds: 18, label: 'Harbor Avenue eastbound' }],
    ['southward.gas.forecourt>southward.alley', { seconds: 12, label: 'service road' }],
    ['southward.alley>southward.gas.forecourt', { seconds: 12, label: 'service road' }]
  ]);

  registerInteraction('room:southward.gas.forecourt',{id:'drive-ritas',label:"Drive to Rita's",action:'travel:start',payload:{vehicleId:'sedan.blue',destination:'southward.diner'},roomId:'southward.gas.forecourt',order:90});
  registerInteraction('room:southward.diner',{id:'drive-mercy-fuel',label:'Drive to Mercy Fuel',action:'travel:start',payload:{vehicleId:'sedan.blue',destination:'southward.gas.forecourt'},roomId:'southward.diner',order:90});

  const publicSession = session => {if(!session)return null;const {timer,...safe}=session;return {...safe};};
  const setVehicleTravel = (vehicleId,status) => {ctx.host.setVehicleStatus(vehicleId,status);refreshInventories();};

  const arrive = async session => {
    if (sessions.get(session.actorId)?.id !== session.id || session.status !== 'traveling') return;
    const player = ctx.host.getPlayer(session.actorId), vehicle = ctx.host.getVehicle(session.vehicleId);
    if (!player || !vehicle) { sessions.delete(session.actorId); ctx.host.endActivity(session.actorId,'travel'); setVehicleTravel(session.vehicleId,'parked'); return; }
    ctx.host.setPlayerRoom(session.actorId, session.destination);ctx.host.setVehicleRoom(vehicle.id, session.destination);setVehicleTravel(vehicle.id,'parked');
    sessions.delete(session.actorId);ctx.host.endActivity(session.actorId,'travel');session.status='arrived';session.arrivedAt=Date.now();session.timer=undefined;
    ctx.host.send(session.actorId,'travel_update',publicSession(session));ctx.host.roomEvent(session.destination,`${player.name} arrives in ${vehicle.label}.`);
    await ctx.events.emit('travel:arrived',{vehicleId:vehicle.id,origin:session.origin,destination:session.destination},{actorId:session.actorId,roomId:session.destination});
  };
  const schedule=(session,delayMs)=>{clearTimeout(session.timer);session.timer=setTimeout(()=>void arrive(session).catch(error=>console.error('[travel] arrival failed',error)),Math.max(0,delayMs));session.timer.unref?.();};

  const pause=async(actorId,reason='interrupted')=>{const session=sessions.get(actorId);if(!session||session.status!=='traveling')return null;clearTimeout(session.timer);session.remainingMs=Math.max(0,session.arriveAt-Date.now());session.status='paused';session.pauseReason=reason;session.timer=undefined;ctx.host.send(actorId,'travel_update',publicSession(session));await ctx.events.emit('travel:paused',{vehicleId:session.vehicleId,destination:session.destination,reason,remainingMs:session.remainingMs},{actorId,roomId:session.origin});return publicSession(session);};
  const resume=async(actorId,reason='resumed')=>{const session=sessions.get(actorId);if(!session||session.status!=='paused')return null;const activity=ctx.host.beginActivity(actorId,'travel',session.id);if(!activity?.ok)return null;const now=Date.now(),remainingMs=Math.max(500,session.remainingMs??500);session.status='traveling';session.pauseReason=null;session.startedAt=now;session.arriveAt=now+remainingMs;session.seconds=remainingMs/1000;session.remainingMs=undefined;schedule(session,remainingMs);ctx.host.send(actorId,'travel_update',publicSession(session));await ctx.events.emit('travel:resumed',{vehicleId:session.vehicleId,destination:session.destination,reason,seconds:session.seconds},{actorId,roomId:session.origin});return publicSession(session);};
  const abort=async(actorId,reason='cancelled')=>{const session=sessions.get(actorId);if(!session)return null;clearTimeout(session.timer);sessions.delete(actorId);ctx.host.endActivity(actorId,'travel');setVehicleTravel(session.vehicleId,'parked');session.status='cancelled';session.cancelReason=reason;session.timer=undefined;ctx.host.send(actorId,'travel_update',publicSession(session));await ctx.events.emit('travel:cancelled',{vehicleId:session.vehicleId,origin:session.origin,destination:session.destination,reason},{actorId,roomId:session.origin});return publicSession(session);};

  ctx.exports.register('getSession',actorId=>publicSession(sessions.get(actorId)));
  ctx.exports.register('listActive',()=>[...sessions.values()].map(publicSession));ctx.exports.register('pause',pause);ctx.exports.register('resume',resume);ctx.exports.register('abort',abort);

  ctx.actions.register('travel:start',async(action,payload)=>{
    if(sessions.has(action.actorId))throw new Error('You are already traveling.');const player=ctx.host.getPlayer(action.actorId),vehicle=ctx.host.getVehicle(payload?.vehicleId);if(!player||!vehicle)throw new Error('Travel is unavailable.');
    if(vehicle.roomId!==player.roomId||vehicle.status==='traveling')throw new Error('That vehicle is not here.');if(vehicle.ownerCharacterId&&vehicle.ownerCharacterId!==player.characterId)throw new Error('You do not have the keys to that vehicle.');
    const destination=String(payload?.destination||''),route=routes.get(`${player.roomId}>${destination}`);if(!route)throw new Error('There is no drivable route to that destination yet.');const startedAt=Date.now(),arriveAt=startedAt+route.seconds*1000,id=randomUUID();
    const activity=ctx.host.beginActivity(action.actorId,'travel',id);if(!activity?.ok)throw new Error(activity?.reason||'You cannot travel right now.');
    const session={id,actorId:action.actorId,vehicleId:vehicle.id,origin:player.roomId,destination,route:route.label,startedAt,arriveAt,seconds:route.seconds,status:'traveling',timer:null};sessions.set(action.actorId,session);setVehicleTravel(vehicle.id,'traveling');schedule(session,route.seconds*1000);ctx.host.send(action.actorId,'travel_update',publicSession(session));await action.emit('travel:started',{vehicleId:vehicle.id,origin:session.origin,destination,seconds:route.seconds},{roomId:session.origin});return publicSession(session);
  });
  ctx.actions.register('travel:cancel',async action=>{const cancelled=await abort(action.actorId,'player-cancelled');if(!cancelled)throw new Error('You are not traveling.');return {cancelled:true};});

  ctx.events.on('player:left',event=>{if(event.actorId)void abort(event.actorId,'disconnected').catch(error=>console.error('[travel] disconnect cleanup failed',error));});
  ctx.lifecycle.onDispose(()=>{for(const session of sessions.values())clearTimeout(session.timer);sessions.clear();});
  ctx.heartbeat.snapshot('active',()=>[...sessions.values()].map(publicSession));
}
