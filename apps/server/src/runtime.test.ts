import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ResourceRuntime } from './runtime.js';

function resource(root:string,name:string,dependencies:string[],setup:string,clientActions:string[]=[]){
  const dir=join(root,name);mkdirSync(dir,{recursive:true});
  writeFileSync(join(dir,'pmresource.json'),JSON.stringify({name,version:'1.0.0',server:'server.mjs',dependencies,clientActions}));
  writeFileSync(join(dir,'server.mjs'),setup);
}

test('resource runtime honors dependency order',async()=>{
  const root=mkdtempSync(join(tmpdir(),'pm-runtime-'));
  try{
    resource(root,'base',[],`export async function setup(){}`);
    resource(root,'feature',['base'],`export async function setup(){}`);
    const runtime=new ResourceRuntime({},root);
    assert.deepEqual(await runtime.loadAll(),['base','feature']);
  }finally{rmSync(root,{recursive:true,force:true})}
});

test('resource runtime rejects dependency cycles',async()=>{
  const root=mkdtempSync(join(tmpdir(),'pm-runtime-'));
  try{
    resource(root,'a',['b'],`export async function setup(){}`);
    resource(root,'b',['a'],`export async function setup(){}`);
    const runtime=new ResourceRuntime({},root);
    await assert.rejects(()=>runtime.loadAll(),/Circular Port Mercy resource dependency/);
  }finally{rmSync(root,{recursive:true,force:true})}
});

test('client actions are deny by default and hooks can veto',async()=>{
  const root=mkdtempSync(join(tmpdir(),'pm-runtime-'));
  try{
    resource(root,'core',[],`export async function setup(ctx){ctx.actions.register('safe',async()=>({ok:true}));ctx.actions.register('hidden',async()=>({hidden:true}));}`,['safe']);
    resource(root,'guard',['core'],`export async function setup(ctx){ctx.actions.before('safe',async()=> 'blocked by test guard');}`);
    const runtime=new ResourceRuntime({},root);await runtime.loadAll();
    const hidden=await runtime.executeClient('hidden',{actorId:'p1',roomId:'r1',payload:{}});
    assert.equal(hidden.ok,false);
    const safe=await runtime.executeClient('safe',{actorId:'p1',roomId:'r1',payload:{}});
    assert.equal(safe.ok,false);
    if(!safe.ok) assert.match(safe.reason,/blocked by test guard/);
  }finally{rmSync(root,{recursive:true,force:true})}
});
