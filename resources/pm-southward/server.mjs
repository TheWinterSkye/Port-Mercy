export async function setup(ctx){
  const register=ctx.exports.get('pm-interactions','register');
  const lines={
    pumps:'Pump three clicks and hums beneath the canopy. The card reader looks older than the rest of the hardware.',
    coolers:'Rows of bottled drinks hum behind the glass, blue cooler lights flickering over the labels.',
    dumpster:'The dumpster padlock is cheap but intact. Someone has scratched a delivery code into the brick beside it.',
    menu:'The laminated menu is mostly breakfast, burgers and things that survived a fryer.',
  };
  ctx.actions.register('southward:inspect',async(action,payload)=>{const text=lines[String(payload?.target||'')];if(!text)throw new Error('There is nothing useful to inspect that way.');ctx.host.send(action.actorId,'event',{text});return {inspected:payload.target};});
  ctx.actions.register('southward:talk',async(action,payload)=>{const who=String(payload?.who||'');const text=who==='maya'?'Maya Torres glances up from the register and asks if you need anything from behind the counter.':who==='rita'?'Rita pours coffee without asking. “You look like you need this more than I need the quarter.”':null;if(!text)throw new Error('They are not here.');ctx.host.send(action.actorId,'event',{text});return {talkedTo:who};});
  ctx.actions.register('southward:coffee',async action=>{const player=ctx.host.getPlayer(action.actorId);if(!player||player.roomId!=='southward.mercyfuel.interior')throw new Error('There is no coffee station here.');ctx.host.adjustStress(action.actorId,-2);ctx.host.send(action.actorId,'event',{text:'You pour a bitter cup of station coffee. -2 stress.'});return {stressDelta:-2};});

  register('room:southward.gas.forecourt',{id:'inspect-pumps',label:'Inspect pumps',action:'southward:inspect',payload:{target:'pumps'},roomId:'southward.gas.forecourt',order:30});
  register('room:southward.gas.forecourt',{id:'open-trunk',label:'Open sedan trunk',action:'vehicle:openStorage',payload:{vehicleId:'sedan.blue',compartment:'trunk'},roomId:'southward.gas.forecourt',order:40});
  register('room:southward.mercyfuel.interior',{id:'talk-maya',label:'Talk to Maya',action:'southward:talk',payload:{who:'maya'},roomId:'southward.mercyfuel.interior',order:20});
  register('room:southward.mercyfuel.interior',{id:'pour-coffee',label:'Pour coffee',action:'southward:coffee',payload:{},roomId:'southward.mercyfuel.interior',order:30});
  register('room:southward.mercyfuel.interior',{id:'browse-coolers',label:'Browse coolers',action:'southward:inspect',payload:{target:'coolers'},roomId:'southward.mercyfuel.interior',order:40});
  register('room:southward.mercyfuel.interior',{id:'pocket-redline',label:'Pocket energy drink',action:'world:take',payload:{target:'energy_drink'},roomId:'southward.mercyfuel.interior',order:90});
  register('room:southward.diner',{id:'talk-rita',label:'Talk to Rita',action:'southward:talk',payload:{who:'rita'},roomId:'southward.diner',order:20});
  register('room:southward.diner',{id:'read-menu',label:'Read menu',action:'southward:inspect',payload:{target:'menu'},roomId:'southward.diner',order:30});
  register('room:southward.alley',{id:'inspect-dumpster',label:'Inspect dumpster',action:'southward:inspect',payload:{target:'dumpster'},roomId:'southward.alley',order:20});
}
