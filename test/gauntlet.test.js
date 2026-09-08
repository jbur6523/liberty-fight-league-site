import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {confirmationState} from '../src/superfight/contracts.js';
import {boutType} from '../src/superfight/validation.js';

test('special final bout types stay separate from public Gi/No-Gi preferences',()=>{
 for(const type of ['john_wick','gauntlet']) {
   assert.equal(boutType(type,{special:true}),type);
   assert.throws(()=>boutType(type));
 }
 assert.equal(confirmationState([{competitor_id:'a',response:'accepted'},{competitor_id:'b',response:'accepted'}],'a','b',['c','d']).summary,'partially_accepted');
 assert.equal(confirmationState(['a','b','c','d'].map(competitor_id=>({competitor_id,response:'accepted'})),'a','b',['c','d']).summary,'all_accepted');
 assert.equal(confirmationState([{competitor_id:'d',response:'declined'}],'a','b',['c','d']).summary,'declined');
});

test('Gauntlet reserves all four fighters, creates confirmations, rejects conflicts, and unmatches together',async()=>{
 const db=new PGlite();
 try {
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql as $$select null::uuid$$;`);
  const directory=new URL('../supabase/migrations/',import.meta.url);
  for(const name of (await readdir(directory)).filter(n=>n.endsWith('.sql')).sort())
    await db.exec((await readFile(new URL(name,directory),'utf8')).replace(/create extension if not exists pgcrypto;/gi,''));
  const event=(await db.query("insert into superfight_events(public_slug,name,applications_open) values('gauntlet-test','Gauntlet test',true) returning id")).rows[0].id;
  const admin=randomUUID();await db.query('insert into auth.users(id) values($1)',[admin]);
  const fighters=[];
  for(let i=0;i<6;i++) fighters.push((await db.query("insert into superfight_competitors(event_id,source,full_name,instagram_handle,belt) values($1,'admin_quick_add',$2,$3,'blue') returning id",[event,`Fighter ${i}`,`fighter_${i}`])).rows[0].id);
  const create=async(type,ids)=>(await db.query('select create_superfight_group_match($1,$2,$3,null,154,$4,$5,null,$6,$7) id',[event,ids[0],ids[1],type,admin,ids[2]??null,ids[3]??null])).rows[0].id;
  await assert.rejects(create('gauntlet',[fighters[0],fighters[1],fighters[0]]),/different competitors/);
  await assert.rejects(create('john_wick',fighters.slice(0,3)),/extra_fighters_gauntlet/);
  assert.equal((await db.query('select count(*)::int n from superfight_matches')).rows[0].n,0);
  const match=await create('gauntlet',fighters.slice(0,4));
  const confirmations=(await db.query('select competitor_id,token from superfight_match_confirmations where match_id=$1',[match])).rows;
  assert.equal(confirmations.length,4);
  assert.deepEqual(confirmations.map(c=>c.competitor_id).sort(),fighters.slice(0,4).sort());
  await assert.rejects(create('gi',[fighters[4],fighters[2]]),/already belongs/);
  await assert.rejects(create('gauntlet',[fighters[4],fighters[5],fighters[3]]),/already belongs/);
  await assert.rejects(db.query("select submit_superfight_offer($1,'offerer','gi',$2,'New','blue',154,'Gym')",[fighters[3],randomUUID()]),/no longer available/);
  await assert.rejects(db.query("select submit_superfight_offer($1,'fighter_2','gi',$2,'New','blue',154,'Gym')",[fighters[4],randomUUID()]),/already have an active match/);
  await assert.rejects(db.query('select merge_superfight_competitors($1,$2)',[fighters[3],fighters[4]]));
  for(const confirmation of confirmations) await db.query("select * from submit_superfight_confirmation($1,'accepted',null,false)",[confirmation.token]);
  assert.equal((await db.query("select count(*)::int n from superfight_match_confirmations where match_id=$1 and response='accepted'",[match])).rows[0].n,4);
  await db.query("update superfight_matches set state='unmatched',unmatched_at=now(),unmatched_by=$2 where id=$1",[match,admin]);
  const john=await create('john_wick',[fighters[2],fighters[3]]);
  assert.equal((await db.query('select count(*)::int n from superfight_match_confirmations where match_id=$1',[john])).rows[0].n,2);
  await create('gauntlet',[fighters[0],fighters[1],fighters[4]]);
  assert.equal((await db.query("select count(*)::int n from superfight_matches where state='active'")).rows[0].n,2);
  assert.equal((await db.query("select has_function_privilege('anon','create_superfight_group_match(uuid,uuid,uuid,uuid,numeric,superfight_bout_type,uuid,uuid,uuid,uuid)','EXECUTE') allowed")).rows[0].allowed,false);
 }finally{await db.close();}
});
