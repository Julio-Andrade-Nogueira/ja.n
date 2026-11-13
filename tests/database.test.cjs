// Real PostgreSQL engine (PGlite) with a minimal Supabase auth.uid() test shim.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const alice='10000000-0000-0000-0000-000000000001',bob='10000000-0000-0000-0000-000000000002';
const job='20000000-0000-0000-0000-000000000001';

test('SQL migration: constraints, anonymous permissions, cross-user RLS and atomic patches',async()=>{
 const db=new PGlite();
 try{
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
   create schema auth; create table auth.users(id uuid primary key);
   create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
   grant usage on schema public,auth to anon,authenticated,service_role;
   grant execute on function auth.uid() to anon,authenticated,service_role;
   insert into auth.users values ('${alice}'),('${bob}');`);
  const dir=path.join(__dirname,'../supabase/migrations');
  for(const file of fs.readdirSync(dir).sort())await db.exec(fs.readFileSync(path.join(dir,file),'utf8'));
  await db.exec(`insert into public.radar_jobs(id,canonical_key,title,company,source,source_board,external_id,url)
   values('${job}','unique','Fixture job','Fixture studio','greenhouse','fixture','1','https://example.com/fixture/1')`);
  await assert.rejects(db.exec(`update public.radar_jobs set score=101`),/check constraint/);
  await db.exec('set role anon');
  assert.equal((await db.query('select title from public.radar_jobs')).rows.length,1);
  await assert.rejects(db.query('select * from public.radar_user_states'),/permission denied/);
  await assert.rejects(db.query('select * from public.radar_runs'),/permission denied/);
  await assert.rejects(db.query('select * from public.radar_checks'),/permission denied/);
  await assert.rejects(db.exec(`update public.radar_jobs set title='tampered'`),/permission denied/);
  await assert.rejects(db.query(`select public.radar_patch_state('${job}','{"notes":"x"}')`),/permission denied/);
  await db.exec(`reset role;set role authenticated;set request.jwt.claim.sub='${alice}'`);
  await db.query(`select public.radar_patch_state('${job}','{"notes":"alice private","stage":"Entrevista"}')`);
  await db.query(`select public.radar_patch_state('${job}','{"saved":true}')`);
  let row=(await db.query('select * from public.radar_user_states')).rows[0];
  assert.equal(row.notes,'alice private');assert.equal(row.stage,'Entrevista');assert.equal(row.saved,true);
  await db.query(`select public.radar_patch_state('${job}','{"notes":"migration must not overwrite"}',true)`);
  assert.equal((await db.query('select notes from public.radar_user_states')).rows[0].notes,'alice private');
  await assert.rejects(db.query(`select public.radar_patch_state('${job}','{"user_id":"${bob}"}')`),/Invalid state patch/);
  await assert.rejects(db.query(`update public.radar_user_states set user_id='${bob}'`),/row-level security/);
  await db.exec(`set request.jwt.claim.sub='${bob}'`);
  assert.equal((await db.query('select * from public.radar_user_states')).rows.length,0);
  assert.equal((await db.query('select * from public.radar_user_events')).rows.length,0);
  assert.equal((await db.query(`update public.radar_user_states set notes='hacked' where user_id='${alice}' returning *`)).rows.length,0);
  await db.query(`select public.radar_patch_state('${job}','{"notes":"bob private"}')`);
  await db.exec(`set request.jwt.claim.sub='${alice}'`);
  assert.equal((await db.query('select notes from public.radar_user_states')).rows[0].notes,'alice private');
  await db.exec('reset role');
  const tables=(await db.query(`select relname,relrowsecurity from pg_class where relname like 'radar_%' and relkind='r'`)).rows;
  assert.equal(tables.length,6);assert.ok(tables.every(t=>t.relrowsecurity));
 }finally{await db.close()}
});
