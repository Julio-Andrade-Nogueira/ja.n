const {test}=require('node:test');
const assert=require('node:assert/strict');
const {PersonalSync,cleanPatch,cleanStates}=require('../painel/radar-assets/sync.js');
const {createClient,validateConfig}=require('../painel/radar-assets/supabase-client.js');
const storage=()=>{const rows=new Map();return {getItem:k=>rows.get(k)||null,setItem:(k,v)=>rows.set(k,v),removeItem:k=>rows.delete(k)}};

test('secrets and privileged JWTs are refused by the frontend',()=>{
 assert.equal(validateConfig({}),null);
 for(const key of ['sb_secret_test',`a.${btoa('{"role":"service_role"}')}.c`])
  assert.throws(()=>validateConfig({supabaseUrl:'https://fixture.supabase.co',supabasePublishableKey:key}));
 assert.ok(validateConfig({supabaseUrl:'https://fixture.supabase.co',supabasePublishableKey:'sb_publishable_test'}));
});
test('import sanitization blocks arbitrary fields and prototype pollution',()=>{
 assert.deepEqual(cleanPatch({notes:'personal',user_id:'other',saved:'false',stage:'hacked'}),{notes:'personal'});
 assert.equal(Object.keys(cleanStates(JSON.parse('{"__proto__":{"notes":"bad"}}'))).length,0);
});
test('patch sync preserves other fields, persists offline edits, and isolates accounts',async()=>{
 const disk=storage();let online=false;
 const remote={saved:false,notes:'from another device',stage:'Entrevista'};
 const client={project:'fixture',states:async()=>[{job_id:'job',...remote}],patch:async(id,p)=>{if(!online)throw Error('offline');Object.assign(remote,p);return {job_id:id,...remote}}};
 const sync=new PersonalSync(client,disk);sync.select('alice');await sync.refresh();sync.change('job',{saved:true});
 await assert.rejects(sync.flush());assert.equal(remote.saved,false);
 const restored=new PersonalSync(client,disk);restored.select('alice');assert.equal(restored.states.job.saved,true);
 online=true;await restored.flush();assert.equal(remote.notes,'from another device');assert.equal(remote.stage,'Entrevista');
 restored.select('bob');assert.equal(Object.keys(restored.states).length,0);
 restored.select(null);assert.deepEqual(restored.states,{});
 restored.select('alice');assert.equal(restored.states.job.notes,'from another device');
 restored.importBackup({legacy:{notes:'private imported backup'}});restored.select('bob');assert.equal(Object.keys(restored.imported).length,0);
 restored.select('alice');assert.equal(restored.imported.legacy.notes,'private imported backup');
});
test('edits made during an in-flight request remain pending; old account responses are ignored',async()=>{
 let resolve;const client={project:'fixture',patch:()=>new Promise(r=>{resolve=r})};
 const sync=new PersonalSync(client,storage());sync.select('alice');sync.change('job',{notes:'first'});
 const running=sync.flush();sync.change('job',{notes:'second'});resolve({job_id:'job',notes:'first'});await running;
 assert.equal(sync.states.job.notes,'second');assert.equal(sync.pending.job.notes,'second');
 const next=sync.flush();sync.select('bob');resolve({job_id:'job',notes:'private alice'});await next;assert.equal(Object.keys(sync.states).length,0);
});
test('public pagination and authenticated RPC use correct PostgREST contracts',async()=>{
 const calls=[];const env={localStorage:storage(),fetch:async(url,options)=>{calls.push({url,options});
  let body;if(url.includes('/token?'))body={access_token:'user-jwt',refresh_token:'refresh',expires_in:3600,user:{id:'alice'}};
  else if(url.includes('rpc/'))body=[{job_id:'job',notes:'safe'}];
  else body=url.includes('offset=0')?Array.from({length:500},(_,id)=>({id})):[];
  return {ok:true,status:200,json:async()=>body};}};
 const client=createClient({supabaseUrl:'https://fixture.supabase.co',supabasePublishableKey:'sb_publishable_fixture'},env);
 assert.equal((await client.jobs()).length,500);assert.ok(calls[1].url.includes('offset=500'));
 assert.equal(calls[0].options.headers.Authorization,undefined);
 await client.signIn('fixture@example.com','not-a-real-password');
 assert.equal((await client.patch('job',{notes:'safe'})).notes,'safe');
 const rpc=calls.at(-1);assert.equal(rpc.options.headers.Authorization,'Bearer user-jwt');
 assert.deepEqual(JSON.parse(rpc.options.body),{p_job_id:'job',p_patch:{notes:'safe'}});
 assert.ok(!env.localStorage.getItem('gamejobs-auth-v2:'+client.project).includes('not-a-real-password'));
});
