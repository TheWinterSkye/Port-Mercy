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

test('bank transfer is atomic, conserved, and rejects self transfer',()=>{
  const store=new PersistenceStore(':memory:');
  const a=store.loadOrCreateCharacter('aaaaaaaa-aaaaaaaa-aaaaaaaa-aaaa');
  const b=store.loadOrCreateCharacter('bbbbbbbb-bbbbbbbb-bbbbbbbb-bbbb');
  const before=a.bank+b.bank;
  const moved=store.transferBank(a.characterId,b.phoneNumber,125);
  assert.equal(moved.fromBalance,a.bank-125);
  assert.equal(moved.toBalance,b.bank+125);
  assert.equal(moved.fromBalance+moved.toBalance,before);
  assert.throws(()=>store.transferBank(a.characterId,a.phoneNumber,1),/yourself/i);
  assert.throws(()=>store.transferBank(a.characterId,b.phoneNumber,999999),/invalid/i);
  store.close();
});

test('inventory round-trips through SQLite',()=>{
  const store=new PersistenceStore(':memory:');
  const a=store.loadOrCreateCharacter('aaaaaaaa-aaaaaaaa-aaaaaaaa-aaaa');
  store.saveItems(a.characterId,[{id:'i1',templateId:'water.bottle',name:'Water',kind:'consumable',quantity:1,weight:.5,description:'cold',usable:true,droppable:true,metadataJson:'{}'}]);
  assert.deepEqual(store.loadItems(a.characterId).map(i=>i.id),['i1']);
  store.close();
});
