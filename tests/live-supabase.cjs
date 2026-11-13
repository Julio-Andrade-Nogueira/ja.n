/* Opt-in test against a real project; only dedicated test accounts are mutated. */
const assert=require('node:assert/strict');
const {createClient}=require('../painel/radar-assets/supabase-client.js');
const required=['SUPABASE_URL','SUPABASE_PUBLISHABLE_KEY','RADAR_TEST_EMAIL_A','RADAR_TEST_PASSWORD_A','RADAR_TEST_EMAIL_B','RADAR_TEST_PASSWORD_B'];
function client(){return createClient({supabaseUrl:process.env.SUPABASE_URL,supabasePublishableKey:process.env.SUPABASE_PUBLISHABLE_KEY},{fetch,localStorage:{getItem:()=>null,setItem:()=>{},removeItem:()=>{}}})}
async function main(){
 for(const key of required)if(!process.env[key])throw Error('Missing environment variable: '+key);
 const a=client(),b=client(),jobs=await a.jobs();assert.ok(jobs.length,'Run the collector first: at least one real job is needed.');
 const id=jobs[0].id;await a.signIn(process.env.RADAR_TEST_EMAIL_A,process.env.RADAR_TEST_PASSWORD_A);
 await b.signIn(process.env.RADAR_TEST_EMAIL_B,process.env.RADAR_TEST_PASSWORD_B);
 assert.notEqual(a.getSession().user.id,b.getSession().user.id);
 const previous=(await a.states()).find(r=>r.job_id===id)||{notes:'',saved:false,stage:'Nenhuma'};
 try{
  await a.patch(id,{notes:'RADAR_DEDICATED_TEST_ACCOUNT_ONLY',saved:true});
  const response=await fetch(`${a.project}/rest/v1/radar_user_states?user_id=eq.${a.getSession().user.id}`,{headers:{apikey:process.env.SUPABASE_PUBLISHABLE_KEY,Authorization:'Bearer '+b.getSession().access_token}});
  assert.equal(response.status,200);assert.deepEqual(await response.json(),[]);
  const mutate=await fetch(`${a.project}/rest/v1/radar_user_states?user_id=eq.${a.getSession().user.id}`,{method:'PATCH',headers:{apikey:process.env.SUPABASE_PUBLISHABLE_KEY,Authorization:'Bearer '+b.getSession().access_token,'Content-Type':'application/json',Prefer:'return=representation'},body:JSON.stringify({notes:'unauthorized test'})});
  assert.equal(mutate.status,200);assert.deepEqual(await mutate.json(),[]);
  assert.equal((await a.states()).find(r=>r.job_id===id).notes,'RADAR_DEDICATED_TEST_ACCOUNT_ONLY');
  const anonymous=await fetch(`${a.project}/rest/v1/radar_user_states?select=*`,{headers:{apikey:process.env.SUPABASE_PUBLISHABLE_KEY}});
  assert.ok([401,403].includes(anonymous.status));
  console.log('Live Supabase: public reads, Auth, RPC and two-account RLS passed.');
 }finally{
  await a.patch(id,{notes:previous.notes,saved:previous.saved,stage:previous.stage});
  await Promise.allSettled([a.signOut(),b.signOut()]);
 }
}
main().catch(error=>{console.error('Live test failed:',error.message);process.exitCode=1});
