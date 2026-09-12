import test from 'node:test';
import assert from 'node:assert/strict';
import { PersistenceStore } from './persistence.js';

test('character identity persists and phone numbers are unique',()=>{
  const store=new PersistenceStore(':memory:');
  const a=store.loadOrCreateCharacter('aaaaaaaa-aaaaaaaa-aaaaaaaa-aaaa');
  const again=store.loadOrCreateCharacter('aaaaaaaa-aaaaaaaa-aaaaaaaa-aaaa');
  const b=store.loadOrCreateCharacter('bbbbbbbb-bbbbbbbb-bbbbbbbb-bbbb');
  assert.equal(again.characterId,a.characterId);
  assert.equal(again.phoneNumber,a.phoneNumber);
  assert.notEqual(b.phoneNumber,a.phoneNumber);
  store.close();
});

test('bank transfer is atomic, conserved, idempotent, and rejects invalid transfers',()=>{
  const store=new PersistenceStore(':memory:');
  const a=store.loadOrCreateCharacter('aaaaaaaa-aaaaaaaa-aaaaaaaa-aaaa');
  const b=store.loadOrCreateCharacter('bbbbbbbb-bbbbbbbb-bbbbbbbb-bbbb');
  const before=a.bank+b.bank;
  const moved=store.transferBank(a.characterId,b.phoneNumber,125,'request-bank-0001');
  assert.equal(moved.fromBalance,a.bank-125);
  assert.equal(moved.toBalance,b.bank+125);
  assert.equal(moved.fromBalance+moved.toBalance,before);
  const retry=store.transferBank(a.characterId,b.phoneNumber,125,'request-bank-0001');
  assert.equal(retry.transactionId,moved.transactionId);
  assert.equal(retry.idempotent,true);
  assert.equal(store.getCharacterByPhone(a.phoneNumber)?.bank,moved.fromBalance);
  assert.equal(store.getCharacterByPhone(b.phoneNumber)?.bank,moved.toBalance);
  assert.throws(()=>store.transferBank(a.characterId,a.phoneNumber,1,'request-bank-self'),/yourself/i);
  assert.throws(()=>store.transferBank(a.characterId,b.phoneNumber,999999,'request-bank-large'),/invalid/i);
  assert.throws(()=>store.transferBank(a.characterId,b.phoneNumber,Number.NaN,'request-bank-nan'),/invalid/i);
  assert.throws(()=>store.transferBank(a.characterId,b.phoneNumber,1.5,'request-bank-frac'),/invalid/i);
  store.close();
});

test('inventory and secondary containers round-trip through SQLite',()=>{
  const store=new PersistenceStore(':memory:');
  const a=store.loadOrCreateCharacter('aaaaaaaa-aaaaaaaa-aaaaaaaa-aaaa');
  const water={id:'i1',templateId:'water.bottle',name:'Water',kind:'consumable',quantity:1,weight:.5,description:'cold',usable:true,droppable:true,metadataJson:'{}'};
  const rag={id:'r1',templateId:'cloth.rag',name:'Rag',kind:'misc',quantity:1,weight:.1,description:'rag',usable:false,droppable:true,metadataJson:'{}'};
  store.saveItems(a.characterId,[water]);
  assert.deepEqual(store.loadItems(a.characterId).map(i=>i.id),['i1']);
  assert.deepEqual(store.ensureContainer('vehicle:test:trunk',[rag]).map(i=>i.id),['r1']);
  store.saveInventoryBundle(a.characterId,[water],[{id:'vehicle:test:trunk',items:[]}]);
  assert.deepEqual(store.loadContainerItems('vehicle:test:trunk'),[]);
  store.close();
});
