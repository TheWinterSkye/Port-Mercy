import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Client } from 'colyseus.js';

async function freePort(){return await new Promise((resolvePort,reject)=>{const s=createServer();s.once('error',reject);s.listen(0,'127.0.0.1',()=>{const address=s.address();const port=typeof address==='object'&&address?address.port:0;s.close(error=>error?reject(error):resolvePort(port));});});}
async function waitFor(fn,timeout=10000){const started=Date.now();let last;while(Date.now()-started<timeout){try{const value=await fn();if(value)return value;}catch(error){last=error;}await new Promise(r=>setTimeout(r,80));}throw last||new Error('Timed out waiting for condition.');}

async function startCompiledServer(){
  const port=await freePort(),dir=await mkdtemp(join(tmpdir(),'port-mercy-ci-'));
  const child=spawn(process.execPath,['apps/server/dist/index.js'],{cwd:resolve('.'),env:{...process.env,PORT:String(port),PORT_MERCY_DB_PATH:join(dir,'world.sqlite'),PORT_MERCY_HEARTBEAT_PROVIDER:'offline',PORT_MERCY_HEARTBEAT_BOOT_TICK:'0',PORT_MERCY_RESOURCES_DIR:resolve('resources')},stdio:['ignore','pipe','pipe']});
  let output='';child.stdout.on('data',c=>output+=String(c));child.stderr.on('data',c=>output+=String(c));
  await waitFor(async()=>{if(child.exitCode!==null)throw new Error(`server exited ${child.exitCode}: ${output}`);const response=await fetch(`http://127.0.0.1:${port}/health`);return response.ok;},12000);
  return {port,dir,child,getOutput:()=>output};
}

async function stopServer(server,rooms=[]){for(const room of rooms){try{await room.leave()}catch{}}server.child.kill('SIGTERM');await Promise.race([new Promise(resolve=>server.child.once('exit',resolve)),new Promise(resolve=>setTimeout(resolve,2000))]);if(server.child.exitCode===null)server.child.kill('SIGKILL');await rm(server.dir,{recursive:true,force:true});}

function token(i){return `ci-character-${String(i).padStart(4,'0')}-abcdefghijklmnop`;}

test('compiled server accepts multiple clients, patches state, and exposes no private player map',async()=>{
  const server=await startCompiledServer();const rooms=[];
  try{
    const clientA=new Client(`ws://127.0.0.1:${server.port}`),clientB=new Client(`ws://127.0.0.1:${server.port}`);
    const a=await clientA.joinOrCreate('world',{characterToken:token(1)});rooms.push(a);
    assert.equal('players' in a.state,false,'replicated state must not contain private player records');
    const b=await clientB.joinOrCreate('world',{characterToken:token(2)});rooms.push(b);
    assert.equal(a.id,b.id,'clients should join the same persistent city instance');
    await waitFor(()=>Number(a.state.onlineCount)===2&&Number(b.state.onlineCount)===2);
    await b.leave();rooms.pop();await waitFor(()=>Number(a.state.onlineCount)===1);
    assert.equal(server.child.exitCode,null,server.getOutput());
  }finally{await stopServer(server,rooms);}
});

test('single city accepts a 16-client concurrency smoke without spawning shards',async()=>{
  const server=await startCompiledServer();const rooms=[];
  try{
    for(let i=0;i<16;i++){const c=new Client(`ws://127.0.0.1:${server.port}`);rooms.push(await c.joinOrCreate('world',{characterToken:token(100+i)}));}
    const ids=new Set(rooms.map(room=>room.id));assert.equal(ids.size,1,'all smoke clients must share one Port Mercy world');
    await waitFor(()=>rooms.every(room=>Number(room.state.onlineCount)===16),15000);
    assert.equal(server.child.exitCode,null,server.getOutput());
  }finally{await stopServer(server,rooms);}
});
