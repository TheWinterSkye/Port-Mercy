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

function normalizePhone(value:string){return value.replace(/\D/g,'');}

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
      CREATE TABLE IF NOT EXISTS bank_transactions(
        id TEXT PRIMARY KEY,
        from_character_id TEXT NOT NULL REFERENCES characters(id),
        to_character_id TEXT NOT NULL REFERENCES characters(id),
        amount INTEGER NOT NULL CHECK(amount>0),
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL);
    `);
  }

  private nextPhone(){
    const row=this.db.prepare(`SELECT value FROM metadata WHERE key='next_phone'`).get() as {value?:string}|undefined;
    const n=Math.max(1,Number(row?.value||1));
    this.db.prepare(`INSERT INTO metadata(key,value) VALUES('next_phone',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`).run(String(n+1));
    const exchange=210+Math.floor((n-1)/10000)%790;
    const line=String((n-1)%10000).padStart(4,'0');
    return `(555) ${exchange}-${line}`;
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
      health:Number(row.health),stress:Number(row.stress),job:row.job,jobId:row.job_id,onDuty:Boolean(row.on_duty),roomId:row.room_id,skillsJson:row.skills_json};
  }

  saveCharacter(character:PersistedCharacter){
    this.db.prepare(`UPDATE characters SET name=?,legal_name=?,date_of_birth=?,home_address=?,license_number=?,sex_marker=?,height=?,eyes=?,phone_number=?,phone_digits=?,
      cash=?,bank=?,health=?,stress=?,job=?,job_id=?,on_duty=?,room_id=?,skills_json=?,updated_at=? WHERE id=?`).run(
      character.name,character.legalName,character.dateOfBirth,character.homeAddress,character.licenseNumber,character.sexMarker,character.height,character.eyes,
      character.phoneNumber,normalizePhone(character.phoneNumber),character.cash,character.bank,character.health,character.stress,character.job,character.jobId,
      character.onDuty?1:0,character.roomId,character.skillsJson,Date.now(),character.characterId
    );
  }

  loadItems(characterId:string):PersistedItem[]{
    return (this.db.prepare('SELECT * FROM character_items WHERE character_id=? ORDER BY rowid').all(characterId) as any[]).map(row=>({
      id:row.item_id,templateId:row.template_id,name:row.name,kind:row.kind,quantity:Number(row.quantity),weight:Number(row.weight),description:row.description,
      usable:Boolean(row.usable),droppable:Boolean(row.droppable),metadataJson:row.metadata_json,
    }));
  }

  saveItems(characterId:string,items:PersistedItem[]){
    this.db.exec('BEGIN IMMEDIATE');
    try{
      this.db.prepare('DELETE FROM character_items WHERE character_id=?').run(characterId);
      const insert=this.db.prepare(`INSERT INTO character_items(character_id,item_id,template_id,name,kind,quantity,weight,description,usable,droppable,metadata_json) VALUES(?,?,?,?,?,?,?,?,?,?,?)`);
      for(const item of items) insert.run(characterId,item.id,item.templateId,item.name,item.kind,item.quantity,item.weight,item.description,item.usable?1:0,item.droppable?1:0,item.metadataJson||'{}');
      this.db.exec('COMMIT');
    }catch(error){this.db.exec('ROLLBACK');throw error;}
  }

  transferBank(fromCharacterId:string,toPhone:string,amount:number){
    const dollars=Math.floor(Number(amount));
    if(!Number.isSafeInteger(dollars)||dollars<=0||dollars>100_000) throw new Error('Invalid transfer amount.');
    const digits=normalizePhone(toPhone);
    this.db.exec('BEGIN IMMEDIATE');
    try{
      const from=this.db.prepare('SELECT id,bank,phone_number FROM characters WHERE id=?').get(fromCharacterId) as any;
      const to=this.db.prepare('SELECT id,bank,phone_number,name FROM characters WHERE phone_digits=?').get(digits) as any;
      if(!from||!to) throw new Error('That account is unavailable.');
      if(from.id===to.id) throw new Error('You cannot transfer money to yourself.');
      if(Number(from.bank)<dollars) throw new Error('Insufficient funds.');
      const fromBalance=Number(from.bank)-dollars,toBalance=Number(to.bank)+dollars;
      this.db.prepare('UPDATE characters SET bank=?,updated_at=? WHERE id=?').run(fromBalance,Date.now(),from.id);
      this.db.prepare('UPDATE characters SET bank=?,updated_at=? WHERE id=?').run(toBalance,Date.now(),to.id);
      const transactionId=randomUUID();
      this.db.prepare('INSERT INTO bank_transactions(id,from_character_id,to_character_id,amount,created_at) VALUES(?,?,?,?,?)').run(transactionId,from.id,to.id,dollars,Date.now());
      this.db.exec('COMMIT');
      return {transactionId,amount:dollars,fromCharacterId:from.id,toCharacterId:to.id,toPhone:to.phone_number,toName:to.name,fromBalance,toBalance};
    }catch(error){this.db.exec('ROLLBACK');throw error;}
  }

  getCharacterByPhone(phone:string){
    const row=this.db.prepare('SELECT * FROM characters WHERE phone_digits=?').get(normalizePhone(phone)) as any;
    return row?this.toCharacter(row):null;
  }

  close(){this.db.close();}
}
