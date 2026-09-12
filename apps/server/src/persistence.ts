import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export type PersistedItem = {
  id:string;templateId:string;name:string;kind:string;quantity:number;weight:number;description:string;usable:boolean;droppable:boolean;metadataJson:string;
};

export type PersistedCharacter = {
  accountId:string;characterId:string;name:string;legalName:string;dateOfBirth:string;homeAddress:string;licenseNumber:string;
  sexMarker:string;height:string;eyes:string;phoneNumber:string;cash:number;bank:number;health:number;stress:number;job:string;jobId:string;
  onDuty:boolean;roomId:string;skillsJson:string;
};

export type PersistedVehicle = {
  id:string;label:string;roomId:string;status:string;locked:boolean;ownerCharacterId:string|null;registration:string;fuel:number;condition:number;
};

export type PersistedIncident = {
  id:string;type:string;roomId:string;status:string;summary:string;createdAt:number;updatedAt:number;
};

export type PersistedEvidence = {
  id:string;incidentId:string|null;type:string;roomId:string;sourceActorId:string|null;summary:string;createdAt:number;expiresAt:number;status:string;collectedBy:string|null;collectedAt:number|null;
};

function normalizePhone(value:string){return String(value||'').replace(/\D/g,'');}
function bool(v:unknown){return Boolean(Number(v));}

export class PersistenceStore {
  readonly db:DatabaseSync;

  constructor(filename=process.env.PORT_MERCY_DB_PATH || resolve(process.cwd(),'data','port-mercy.sqlite')){
    if(filename!==':memory:') mkdirSync(dirname(filename),{recursive:true});
    this.db=new DatabaseSync(filename);
    this.db.exec(`
      PRAGMA foreign_keys=ON;
      PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS accounts(
        id TEXT PRIMARY KEY,
        token TEXT NOT NULL UNIQUE,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS characters(
        id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        slot INTEGER NOT NULL DEFAULT 0,
        name TEXT NOT NULL,
        legal_name TEXT NOT NULL,
        date_of_birth TEXT NOT NULL,
        home_address TEXT NOT NULL,
        license_number TEXT NOT NULL UNIQUE,
        sex_marker TEXT NOT NULL,
        height TEXT NOT NULL,
        eyes TEXT NOT NULL,
        phone_number TEXT NOT NULL UNIQUE,
        phone_digits TEXT NOT NULL UNIQUE,
        cash INTEGER NOT NULL,
        bank INTEGER NOT NULL,
        health INTEGER NOT NULL,
        stress INTEGER NOT NULL,
        job TEXT NOT NULL,
        job_id TEXT NOT NULL,
        on_duty INTEGER NOT NULL,
        room_id TEXT NOT NULL,
        skills_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE(account_id,slot)
      );
      CREATE TABLE IF NOT EXISTS character_items(
        character_id TEXT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
        item_id TEXT NOT NULL,
        template_id TEXT NOT NULL,
        name TEXT NOT NULL,
        kind TEXT NOT NULL,
        quantity INTEGER NOT NULL,
        weight REAL NOT NULL,
        description TEXT NOT NULL,
        usable INTEGER NOT NULL,
        droppable INTEGER NOT NULL,
        metadata_json TEXT NOT NULL,
        PRIMARY KEY(character_id,item_id)
      );
      CREATE TABLE IF NOT EXISTS containers(
        id TEXT PRIMARY KEY,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS container_items(
        container_id TEXT NOT NULL REFERENCES containers(id) ON DELETE CASCADE,
        item_id TEXT NOT NULL,
        template_id TEXT NOT NULL,
        name TEXT NOT NULL,
        kind TEXT NOT NULL,
        quantity INTEGER NOT NULL,
        weight REAL NOT NULL,
        description TEXT NOT NULL,
        usable INTEGER NOT NULL,
        droppable INTEGER NOT NULL,
        metadata_json TEXT NOT NULL,
        PRIMARY KEY(container_id,item_id)
      );
      CREATE TABLE IF NOT EXISTS bank_transactions(
        id TEXT PRIMARY KEY,
        from_character_id TEXT NOT NULL REFERENCES characters(id),
        to_character_id TEXT NOT NULL REFERENCES characters(id),
        amount INTEGER NOT NULL CHECK(amount>0),
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS bank_transfer_requests(
        request_key TEXT PRIMARY KEY,
        transaction_id TEXT NOT NULL UNIQUE REFERENCES bank_transactions(id),
        from_character_id TEXT NOT NULL REFERENCES characters(id),
        to_character_id TEXT NOT NULL REFERENCES characters(id),
        to_phone TEXT NOT NULL,
        to_name TEXT NOT NULL,
        amount INTEGER NOT NULL CHECK(amount>0),
        from_balance INTEGER NOT NULL,
        to_balance INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS vehicles(
        id TEXT PRIMARY KEY,
        label TEXT NOT NULL,
        room_id TEXT NOT NULL,
        status TEXT NOT NULL,
        locked INTEGER NOT NULL,
        owner_character_id TEXT,
        registration TEXT NOT NULL,
        fuel INTEGER NOT NULL,
        condition INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS incidents(
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        room_id TEXT NOT NULL,
        status TEXT NOT NULL,
        summary TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS evidence_records(
        id TEXT PRIMARY KEY,
        incident_id TEXT,
        type TEXT NOT NULL,
        room_id TEXT NOT NULL,
        source_actor_id TEXT,
        summary TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        status TEXT NOT NULL,
        collected_by TEXT,
        collected_at INTEGER
      );
      CREATE TABLE IF NOT EXISTS metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL);
    `);
  }

  getMeta(key:string){
    const row=this.db.prepare('SELECT value FROM metadata WHERE key=?').get(key) as {value?:string}|undefined;
    return row?.value??null;
  }
  setMeta(key:string,value:string){
    this.db.prepare(`INSERT INTO metadata(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`).run(key,value);
  }

  private nextPhone(){
    const areas=['346','713','281','832','409','979','936','214','469','972','945','817','682','903','430','254','361','512','737','806','830','915','325','432','956','210'];
    const row=this.db.prepare(`SELECT value FROM metadata WHERE key='next_phone'`).get() as {value?:string}|undefined;
    const n=Math.max(1,Number(row?.value||1));
    const capacity=areas.length*100;
    if(n>capacity) throw new Error('The fictional phone-number pool is exhausted.');
    this.setMeta('next_phone',String(n+1));
    const area=areas[Math.floor((n-1)/100)];
    const line=String(100+((n-1)%100)).padStart(4,'0');
    return `(${area}) 555-${line}`;
  }

  loadOrCreateCharacter(token:string):PersistedCharacter{
    const clean=String(token||'').trim();
    if(!/^[A-Za-z0-9_-]{20,100}$/.test(clean)) throw new Error('Invalid character token.');
    let account=this.db.prepare('SELECT id FROM accounts WHERE token=?').get(clean) as {id:string}|undefined;
    if(!account){
      account={id:randomUUID()};
      this.db.prepare('INSERT INTO accounts(id,token,created_at) VALUES(?,?,?)').run(account.id,clean,Date.now());
    }
    let row=this.db.prepare('SELECT * FROM characters WHERE account_id=? AND slot=0').get(account.id) as any;
    if(!row){
      const id=randomUUID(),phone=this.nextPhone(),now=Date.now();
      const short=account.id.replace(/-/g,'').slice(0,4).toUpperCase();
      const name=`Resident-${short}`;
      const license=`PM-${randomUUID().replace(/-/g,'').slice(0,10).toUpperCase()}`;
      this.db.prepare(`INSERT INTO characters(
        id,account_id,slot,name,legal_name,date_of_birth,home_address,license_number,sex_marker,height,eyes,phone_number,phone_digits,
        cash,bank,health,stress,job,job_id,on_duty,room_id,skills_json,created_at,updated_at
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        id,account.id,0,name,name,'1992-08-17','18 Marrow Avenue, Apt 3B',license,'X','5 ft 7 in','Brown',phone,normalizePhone(phone),
        83,640,100,18,'Unemployed','unemployed',0,'southward.gas.forecourt','{"driving":18,"labor":12,"streetwise":8}',now,now
      );
      row=this.db.prepare('SELECT * FROM characters WHERE id=?').get(id);
    }
    return this.toCharacter(row);
  }

  private toCharacter(row:any):PersistedCharacter{
    return {accountId:row.account_id,characterId:row.id,name:row.name,legalName:row.legal_name,dateOfBirth:row.date_of_birth,homeAddress:row.home_address,
      licenseNumber:row.license_number,sexMarker:row.sex_marker,height:row.height,eyes:row.eyes,phoneNumber:row.phone_number,cash:Number(row.cash),bank:Number(row.bank),
      health:Number(row.health),stress:Number(row.stress),job:row.job,jobId:row.job_id,onDuty:bool(row.on_duty),roomId:row.room_id,skillsJson:row.skills_json};
  }

  saveCharacter(character:PersistedCharacter){
    if(!Number.isSafeInteger(character.cash)||character.cash<0||!Number.isSafeInteger(character.bank)||character.bank<0) throw new Error('Refusing to persist an invalid balance.');
    this.db.prepare(`UPDATE characters SET name=?,legal_name=?,date_of_birth=?,home_address=?,license_number=?,sex_marker=?,height=?,eyes=?,phone_number=?,phone_digits=?,
      cash=?,bank=?,health=?,stress=?,job=?,job_id=?,on_duty=?,room_id=?,skills_json=?,updated_at=? WHERE id=?`).run(
      character.name,character.legalName,character.dateOfBirth,character.homeAddress,character.licenseNumber,character.sexMarker,character.height,character.eyes,
      character.phoneNumber,normalizePhone(character.phoneNumber),character.cash,character.bank,character.health,character.stress,character.job,character.jobId,
      character.onDuty?1:0,character.roomId,character.skillsJson,Date.now(),character.characterId
    );
  }

  private rowToItem(row:any):PersistedItem{
    return {id:row.item_id,templateId:row.template_id,name:row.name,kind:row.kind,quantity:Number(row.quantity),weight:Number(row.weight),description:row.description,
      usable:bool(row.usable),droppable:bool(row.droppable),metadataJson:row.metadata_json};
  }
  private insertItems(table:'character_items'|'container_items',ownerColumn:'character_id'|'container_id',ownerId:string,items:PersistedItem[]){
    const insert=this.db.prepare(`INSERT INTO ${table}(${ownerColumn},item_id,template_id,name,kind,quantity,weight,description,usable,droppable,metadata_json) VALUES(?,?,?,?,?,?,?,?,?,?,?)`);
    for(const item of items) insert.run(ownerId,item.id,item.templateId,item.name,item.kind,item.quantity,item.weight,item.description,item.usable?1:0,item.droppable?1:0,item.metadataJson||'{}');
  }

  loadItems(characterId:string):PersistedItem[]{
    return (this.db.prepare('SELECT * FROM character_items WHERE character_id=? ORDER BY rowid').all(characterId) as any[]).map(row=>this.rowToItem(row));
  }
  saveItems(characterId:string,items:PersistedItem[]){
    this.db.exec('BEGIN IMMEDIATE');
    try{this.db.prepare('DELETE FROM character_items WHERE character_id=?').run(characterId);this.insertItems('character_items','character_id',characterId,items);this.db.exec('COMMIT');}
    catch(error){this.db.exec('ROLLBACK');throw error;}
  }

  ensureContainer(containerId:string,seed:PersistedItem[]=[]):PersistedItem[]{
    this.db.exec('BEGIN IMMEDIATE');
    try{
      const exists=this.db.prepare('SELECT id FROM containers WHERE id=?').get(containerId);
      if(!exists){
        this.db.prepare('INSERT INTO containers(id,created_at) VALUES(?,?)').run(containerId,Date.now());
        this.insertItems('container_items','container_id',containerId,seed);
      }
      this.db.exec('COMMIT');
    }catch(error){this.db.exec('ROLLBACK');throw error;}
    return this.loadContainerItems(containerId);
  }
  loadContainerItems(containerId:string):PersistedItem[]{
    return (this.db.prepare('SELECT * FROM container_items WHERE container_id=? ORDER BY rowid').all(containerId) as any[]).map(row=>this.rowToItem(row));
  }
  saveInventoryBundle(characterId:string,playerItems:PersistedItem[],containers:Array<{id:string;items:PersistedItem[]}>){
    this.db.exec('BEGIN IMMEDIATE');
    try{
      this.db.prepare('DELETE FROM character_items WHERE character_id=?').run(characterId);
      this.insertItems('character_items','character_id',characterId,playerItems);
      for(const container of containers){
        this.db.prepare('INSERT OR IGNORE INTO containers(id,created_at) VALUES(?,?)').run(container.id,Date.now());
        this.db.prepare('DELETE FROM container_items WHERE container_id=?').run(container.id);
        this.insertItems('container_items','container_id',container.id,container.items);
      }
      this.db.exec('COMMIT');
    }catch(error){this.db.exec('ROLLBACK');throw error;}
  }

  transferBank(fromCharacterId:string,toPhone:string,amount:number,requestKey:string){
    const dollars=Number(amount);
    if(!Number.isSafeInteger(dollars)||dollars<=0||dollars>100_000) throw new Error('Invalid transfer amount.');
    const key=String(requestKey||'').trim();
    if(!/^[A-Za-z0-9:_-]{8,160}$/.test(key)) throw new Error('Invalid transfer request id.');
    const digits=normalizePhone(toPhone);
    this.db.exec('BEGIN IMMEDIATE');
    try{
      const prior=this.db.prepare('SELECT * FROM bank_transfer_requests WHERE request_key=?').get(key) as any;
      if(prior){
        if(prior.from_character_id!==fromCharacterId||Number(prior.amount)!==dollars||normalizePhone(prior.to_phone)!==digits) throw new Error('Transfer request id was already used for different transfer details.');
        this.db.exec('COMMIT');
        return {transactionId:prior.transaction_id,amount:Number(prior.amount),fromCharacterId:prior.from_character_id,toCharacterId:prior.to_character_id,toPhone:prior.to_phone,toName:prior.to_name,fromBalance:Number(prior.from_balance),toBalance:Number(prior.to_balance),idempotent:true};
      }
      const from=this.db.prepare('SELECT id,bank,phone_number FROM characters WHERE id=?').get(fromCharacterId) as any;
      const to=this.db.prepare('SELECT id,bank,phone_number,name FROM characters WHERE phone_digits=?').get(digits) as any;
      if(!from||!to) throw new Error('That account is unavailable.');
      if(from.id===to.id) throw new Error('You cannot transfer money to yourself.');
      if(!Number.isSafeInteger(Number(from.bank))||!Number.isSafeInteger(Number(to.bank))) throw new Error('Account balance is invalid.');
      if(Number(from.bank)<dollars) throw new Error('Insufficient funds.');
      const fromBalance=Number(from.bank)-dollars,toBalance=Number(to.bank)+dollars;
      if(!Number.isSafeInteger(toBalance)) throw new Error('Recipient balance would overflow.');
      const now=Date.now(),transactionId=randomUUID();
      this.db.prepare('UPDATE characters SET bank=?,updated_at=? WHERE id=?').run(fromBalance,now,from.id);
      this.db.prepare('UPDATE characters SET bank=?,updated_at=? WHERE id=?').run(toBalance,now,to.id);
      this.db.prepare('INSERT INTO bank_transactions(id,from_character_id,to_character_id,amount,created_at) VALUES(?,?,?,?,?)').run(transactionId,from.id,to.id,dollars,now);
      this.db.prepare(`INSERT INTO bank_transfer_requests(request_key,transaction_id,from_character_id,to_character_id,to_phone,to_name,amount,from_balance,to_balance,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)`).run(key,transactionId,from.id,to.id,to.phone_number,to.name,dollars,fromBalance,toBalance,now);
      this.db.exec('COMMIT');
      return {transactionId,amount:dollars,fromCharacterId:from.id,toCharacterId:to.id,toPhone:to.phone_number,toName:to.name,fromBalance,toBalance,idempotent:false};
    }catch(error){this.db.exec('ROLLBACK');throw error;}
  }

  getCharacterByPhone(phone:string){
    const row=this.db.prepare('SELECT * FROM characters WHERE phone_digits=?').get(normalizePhone(phone)) as any;
    return row?this.toCharacter(row):null;
  }

  loadVehicles():PersistedVehicle[]{
    return (this.db.prepare('SELECT * FROM vehicles ORDER BY id').all() as any[]).map(row=>({id:row.id,label:row.label,roomId:row.room_id,status:row.status,locked:bool(row.locked),ownerCharacterId:row.owner_character_id??null,registration:row.registration,fuel:Number(row.fuel),condition:Number(row.condition)}));
  }
  saveVehicle(v:PersistedVehicle){
    this.db.prepare(`INSERT INTO vehicles(id,label,room_id,status,locked,owner_character_id,registration,fuel,condition,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET label=excluded.label,room_id=excluded.room_id,status=excluded.status,locked=excluded.locked,owner_character_id=excluded.owner_character_id,registration=excluded.registration,fuel=excluded.fuel,condition=excluded.condition,updated_at=excluded.updated_at`).run(v.id,v.label,v.roomId,v.status,v.locked?1:0,v.ownerCharacterId,v.registration,v.fuel,v.condition,Date.now());
  }

  loadIncidents():PersistedIncident[]{
    return (this.db.prepare('SELECT * FROM incidents ORDER BY created_at').all() as any[]).map(row=>({id:row.id,type:row.type,roomId:row.room_id,status:row.status,summary:row.summary,createdAt:Number(row.created_at),updatedAt:Number(row.updated_at)}));
  }
  saveIncident(i:PersistedIncident){
    this.db.prepare(`INSERT INTO incidents(id,type,room_id,status,summary,created_at,updated_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET type=excluded.type,room_id=excluded.room_id,status=excluded.status,summary=excluded.summary,updated_at=excluded.updated_at`).run(i.id,i.type,i.roomId,i.status,i.summary,i.createdAt,i.updatedAt);
  }

  loadEvidence():PersistedEvidence[]{
    return (this.db.prepare('SELECT * FROM evidence_records ORDER BY created_at').all() as any[]).map(row=>({id:row.id,incidentId:row.incident_id??null,type:row.type,roomId:row.room_id,sourceActorId:row.source_actor_id??null,summary:row.summary,createdAt:Number(row.created_at),expiresAt:Number(row.expires_at),status:row.status,collectedBy:row.collected_by??null,collectedAt:row.collected_at==null?null:Number(row.collected_at)}));
  }
  saveEvidence(e:PersistedEvidence){
    this.db.prepare(`INSERT INTO evidence_records(id,incident_id,type,room_id,source_actor_id,summary,created_at,expires_at,status,collected_by,collected_at) VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET incident_id=excluded.incident_id,type=excluded.type,room_id=excluded.room_id,source_actor_id=excluded.source_actor_id,summary=excluded.summary,expires_at=excluded.expires_at,status=excluded.status,collected_by=excluded.collected_by,collected_at=excluded.collected_at`).run(e.id,e.incidentId,e.type,e.roomId,e.sourceActorId,e.summary,e.createdAt,e.expiresAt,e.status,e.collectedBy,e.collectedAt);
  }

  close(){this.db.close();}
}
