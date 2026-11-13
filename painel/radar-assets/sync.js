/* Account-scoped cache and durable field patches. Legacy local data stays separate. */
(function(root){
'use strict';
const fields=['saved','read_at','clicked_at','applied_at','stage','notes'];
const stages=['Nenhuma','Interessado','Candidatado','Entrevista','Proposta','Rejeitado','Contratado','Descartado'];
function cleanPatch(value){
 const patch={};if(!value||typeof value!=='object'||Array.isArray(value))return patch;
 for(const field of fields){if(!Object.hasOwn(value,field))continue;const v=value[field];
  if(field==='saved'&&typeof v==='boolean')patch[field]=v;
  if(field==='notes'&&typeof v==='string')patch[field]=v.slice(0,20000);
  if(field==='stage'&&stages.includes(v))patch[field]=v;
  if(field.endsWith('_at')&&typeof v==='string'&&Number.isFinite(Date.parse(v)))patch[field]=new Date(v).toISOString();
 }return patch;
}
function cleanStates(value){const result=Object.create(null);if(!value||typeof value!=='object'||Array.isArray(value))return result;
 for(const [id,row] of Object.entries(value)){if(['__proto__','constructor','prototype'].includes(id))continue;result[id]=cleanPatch(row)}return result;
}
class PersonalSync{
 constructor(client,storage,onUpdate=()=>{}){this.client=client;this.storage=storage;this.onUpdate=onUpdate;this.uid=null;this.states={};this.pending={};this.imported={};this.epoch=0;this.running=null}
 key(){return `gamejobs-private-v2:${this.client.project}:${this.uid}`}
 select(uid){if(uid===this.uid)return;this.epoch++;this.uid=uid;this.states={};this.pending={};this.imported={};this.running=null;
  if(uid){try{const cached=JSON.parse(this.storage.getItem(this.key()));this.states=cleanStates(cached?.states);this.pending=cleanStates(cached?.pending);this.imported=cleanStates(cached?.imported)}catch{}}this.onUpdate(this.states);
 }
 persist(){if(this.uid)this.storage.setItem(this.key(),JSON.stringify({states:this.states,pending:this.pending,imported:this.imported}))}
 importBackup(rows){if(!this.uid)throw Error('Autenticação necessária.');for(const [id,row]of Object.entries(cleanStates(rows)))this.imported[id]={...row,...this.imported[id]};this.persist()}
 change(id,patch){if(!this.uid)throw Error('Autenticação necessária.');patch=cleanPatch(patch);this.pending[id]={...this.pending[id],...patch};this.states[id]={...this.states[id],...patch};this.persist();this.onUpdate(this.states)}
 async refresh(){const epoch=this.epoch;if(!this.uid)return;const rows=await this.client.states();if(epoch!==this.epoch)return;
  const next={};for(const row of rows)next[row.job_id]=cleanPatch(row);
  for(const [id,patch] of Object.entries(this.pending))next[id]={...next[id],...patch};
  this.states=next;this.persist();this.onUpdate(this.states);
 }
 flush(){
  if(this.running)return this.running;if(!this.uid)return Promise.resolve();const epoch=this.epoch;
  const work=async()=>{for(const [id,value] of Object.entries(this.pending)){
   const patch={...value};const row=await this.client.patch(id,patch);if(epoch!==this.epoch)return;
   const remaining={...this.pending[id]};for(const [key,v] of Object.entries(patch))if(remaining[key]===v)delete remaining[key];
   if(Object.keys(remaining).length)this.pending[id]=remaining;else delete this.pending[id];
   this.states[id]={...cleanPatch(row),...remaining};this.persist();this.onUpdate(this.states);
  }};
  const current=work().finally(()=>{if(epoch===this.epoch)this.running=null});this.running=current;return current;
 }
}
const api={cleanPatch,cleanStates,PersonalSync};root.GameJobsSync=api;
if(typeof module!=='undefined')module.exports=api;
})(typeof window==='undefined'?globalThis:window);
