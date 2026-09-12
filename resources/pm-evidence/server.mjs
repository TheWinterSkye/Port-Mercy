import { randomUUID } from 'node:crypto';
export async function setup(ctx) {
  const evidence = new Map(ctx.host.listEvidenceRecords().map(row => [row.id, row]));
  const incidentTimers = new Map();

  const save = row => { evidence.set(row.id,row); ctx.host.saveEvidenceRecord(row); return structuredClone(row); };
  const expire = async () => {
    const now=Date.now();
    for(const row of evidence.values()){
      if(row.status==='open'&&row.expiresAt<=now){row.status='expired';save(row);await ctx.events.emit('evidence:expired',{id:row.id,type:row.type,roomId:row.roomId,incidentId:row.incidentId},{roomId:row.roomId});}
    }
  };
  const record = async definition => {
    const row={id:randomUUID(),incidentId:definition.incidentId||null,type:definition.type||'trace',roomId:definition.roomId,sourceActorId:definition.sourceActorId||null,summary:definition.summary||'Unidentified trace evidence.',createdAt:Date.now(),expiresAt:definition.expiresAt||Date.now()+6*60*60*1000,status:'open',collectedBy:null,collectedAt:null};
    save(row);await ctx.events.emit('evidence:created',{id:row.id,incidentId:row.incidentId,type:row.type,roomId:row.roomId,summary:row.summary},{actorId:row.sourceActorId||undefined,roomId:row.roomId});return structuredClone(row);
  };
  ctx.exports.register('record',record);
  ctx.exports.register('listRoom',roomId=>{void expire();return [...evidence.values()].filter(row=>row.roomId===roomId&&row.status==='open'&&row.expiresAt>Date.now()).map(row=>structuredClone(row));});

  const clearIncidentTimer=id=>{const timer=incidentTimers.get(id);if(timer)clearTimeout(timer);incidentTimers.delete(id);};
  const scheduleIncident = incident => {
    clearIncidentTimer(incident.id);
    if(!['witnessed','reported','responding'].includes(incident.status))return;
    const delays={witnessed:5000,reported:7000,responding:15000};
    const due=(incident.updatedAt||incident.createdAt)+delays[incident.status];
    const timer=setTimeout(async()=>{
      try{
        const current=ctx.host.getIncident(incident.id);if(!current)return;
        if(current.status==='witnessed'){
          const next=ctx.host.updateIncident(current.id,'reported',current.summary);if(!next)return;
          ctx.host.roomEvent(next.roomId,'Maya finishes a short call with dispatch and gives a description of what happened.');
          await ctx.events.emit('crime:reported',{incidentId:next.id,type:next.type,suspectCharacterId:next.suspectCharacterId||null},{roomId:next.roomId});scheduleIncident(next);
        }else if(current.status==='reported'){
          const next=ctx.host.updateIncident(current.id,'responding',current.summary);if(!next)return;
          ctx.host.roomEvent(next.roomId,'A Port Mercy patrol unit is assigned to the reported theft.');
          await ctx.events.emit('crime:responding',{incidentId:next.id,type:next.type,suspectCharacterId:next.suspectCharacterId||null},{roomId:next.roomId});scheduleIncident(next);
        }else if(current.status==='responding'){
          const next=ctx.host.updateIncident(current.id,'resolved',current.summary);if(!next)return;
          ctx.host.roomEvent(next.roomId,'The responding officer finishes the initial report and clears the immediate call.');
          await ctx.events.emit('crime:resolved',{incidentId:next.id,type:next.type},{roomId:next.roomId});clearIncidentTimer(next.id);
        }
      }catch(error){console.error('[evidence] incident lifecycle failed',error);}
    },Math.max(0,due-Date.now()));timer.unref?.();incidentTimers.set(incident.id,timer);
  };

  ctx.events.on('crime:witnessed',async event=>{
    const payload=event.payload||{};
    await record({incidentId:payload.incidentId||null,type:'witness_statement',roomId:event.roomId,sourceActorId:event.actorId,summary:'A witness account was created from the observed incident.',expiresAt:Date.now()+24*60*60*1000});
    const incident=payload.incidentId?ctx.host.getIncident(payload.incidentId):null;if(incident)scheduleIncident(incident);
  });

  ctx.actions.register('evidence:collect',async(action,payload)=>{
    await expire();const row=evidence.get(payload?.evidenceId),player=ctx.host.getPlayer(action.actorId);if(!row||row.status!=='open'||row.expiresAt<=Date.now())throw new Error('That evidence is unavailable.');
    if(!player||player.roomId!==row.roomId)throw new Error('That evidence is not here.');
    if(action.source==='client'&&player.jobId!=='police')throw new Error('You are not authorized to collect evidence.');
    row.status='collected';row.collectedBy=player.characterId;row.collectedAt=Date.now();save(row);await action.emit('evidence:collected',{id:row.id,incidentId:row.incidentId,type:row.type,roomId:row.roomId},{roomId:row.roomId});return structuredClone(row);
  });

  for(const incident of ctx.host.listIncidents())scheduleIncident(incident);
  const expiryTimer=setInterval(()=>void expire().catch(error=>console.error('[evidence] expiry failed',error)),60000);expiryTimer.unref?.();
  ctx.lifecycle.onDispose(()=>{clearInterval(expiryTimer);for(const timer of incidentTimers.values())clearTimeout(timer);incidentTimers.clear();});
  ctx.heartbeat.snapshot('open-summary',()=>{const counts={};for(const row of evidence.values())if(row.status==='open'&&row.expiresAt>Date.now())counts[`${row.roomId}:${row.type}`]=(counts[`${row.roomId}:${row.type}`]||0)+1;return counts;});
}
