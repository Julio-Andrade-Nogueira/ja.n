/* Minimal Supabase Auth + PostgREST client; no CDN, build step or administrative key. */
(function(root){
'use strict';
function validateConfig(config){
 const url=String(config.supabaseUrl||'').replace(/\/$/,'');
 const key=String(config.supabasePublishableKey||'');
 if(!url&&!key)return null;
 if(!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(url))throw Error('Configure a URL HTTPS do projeto Supabase.');
 let allowed=key.startsWith('sb_publishable_');
 if(!allowed&&key.split('.').length===3){try{const payload=key.split('.')[1].replace(/-/g,'+').replace(/_/g,'/');allowed=JSON.parse(atob(payload)).role==='anon'}catch{}}
 if(!allowed)throw Error('Use somente a chave pública publishable/anon no navegador.');
 return {url,key};
}
function createClient(config,env=root){
 const checked=validateConfig(config);if(!checked)return null;
 const {url,key}=checked,sessionKey='gamejobs-auth-v2:'+url;
 let session=null,refreshing=null,change=()=>{};
 try{session=JSON.parse(env.localStorage.getItem(sessionKey))}catch{}
 function setSession(value){session=value;try{if(value)env.localStorage.setItem(sessionKey,JSON.stringify(value));else env.localStorage.removeItem(sessionKey)}catch{}change(session)}
 async function request(path,{method='GET',body,token}={}){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20000);
  try{
   const response=await env.fetch(url+path,{method,headers:{apikey:key,'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:body===undefined?undefined:JSON.stringify(body),signal:controller.signal,cache:'no-store'});
   if(!response.ok){const error=Error(`Supabase HTTP ${response.status}. Confira a conexão, a configuração e as políticas de acesso.`);error.status=response.status;throw error}
   return response.status===204?null:await response.json();
  }finally{clearTimeout(timer)}
 }
 async function token(){
  if(!session)return null;
  if(session.expires_at*1000>Date.now()+60000)return session.access_token;
  if(!refreshing){
   const original=session;
   refreshing=request('/auth/v1/token?grant_type=refresh_token',{method:'POST',body:{refresh_token:original.refresh_token}})
    .then(data=>{if(session===original)setSession({...data,expires_at:data.expires_at||Math.floor(Date.now()/1000)+data.expires_in});return session?.access_token||null})
    .catch(error=>{if(session===original&&[400,401].includes(error.status))setSession(null);throw error}).finally(()=>{refreshing=null});
  }
  return refreshing;
 }
 async function authenticated(path,options={}){const owner=session?.user?.id;const access=await token();if(!access||owner!==session?.user?.id)throw Error('Entre na sua conta para sincronizar.');return request(path,{...options,token:access})}
 async function pages(table,query='',privateData=false){
  let rows=[];
  for(let offset=0;offset<100000;offset+=500){
   const path=`/rest/v1/${table}?select=*&order=${table==='radar_jobs'?'id':'job_id'}&limit=500&offset=${offset}${query}`;
   const page=await (privateData?authenticated(path):request(path));
   if(!Array.isArray(page))throw Error('Resposta inválida do Supabase.');rows.push(...page);if(page.length<500)return rows;
  }
  throw Error('Limite de paginação atingido. Refine a consulta.');
 }
 return {
  project:url,
  getSession:()=>session,
  onChange:fn=>{change=fn;env.addEventListener?.('storage',e=>{if(e.key===sessionKey){try{session=JSON.parse(e.newValue)}catch{session=null}change(session)}})},
  async restore(){if(!session)return null;try{const original=session;const user=await authenticated('/auth/v1/user');if(session===original&&user.id!==session.user.id)setSession(null);return session}catch(error){if([400,401].includes(error.status))setSession(null);return session}},
  async signIn(email,password){const data=await request('/auth/v1/token?grant_type=password',{method:'POST',body:{email,password}});setSession({...data,expires_at:data.expires_at||Math.floor(Date.now()/1000)+data.expires_in});return data},
  async signUp(email,password){return request('/auth/v1/signup',{method:'POST',body:{email,password}})},
  async signOut(){const access=await token();if(access)await request('/auth/v1/logout',{method:'POST',token:access});setSession(null)},
  jobs:()=>pages('radar_jobs'),
  states:()=>{const uid=session?.user?.id;if(!uid)throw Error('Autenticação necessária.');return pages('radar_user_states','&user_id=eq.'+encodeURIComponent(uid),true)},
  async patch(jobId,patch,onlyIfAbsent=false){const data=await authenticated('/rest/v1/rpc/radar_patch_state',{method:'POST',body:{p_job_id:jobId,p_patch:patch,...(onlyIfAbsent?{p_only_if_absent:true}:{})}});const row=Array.isArray(data)?data[0]:data;if(!row||row.job_id!==jobId)throw Error('Resposta de acompanhamento inválida.');return row},
 };
}
const api={validateConfig,createClient};root.GameJobsSupabase=api;
if(typeof module!=='undefined')module.exports=api;
})(typeof window==='undefined'?globalThis:window);
