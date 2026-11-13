/* GameJobs Radar — vanilla JS / no build tools */
(() => {
'use strict';
const $ = (id) => document.getElementById(id);
const storeKey='gamejobs-radar-v1';
const saved=(()=>{try{return JSON.parse(localStorage.getItem(storeKey))||{}}catch{return {}}})();
const localStates=GameJobsSync.cleanStates(saved.states);
const state={jobs:Array.isArray(saved.jobs)?saved.jobs:[],states:localStates,view:'all',selected:null,filtersOpen:false,demo:Boolean(saved.demo)};
let client=null,personal=null,remoteJobs=[],refreshing=false,remoteError=false;
const cloudIds=new Set();
const remoteCacheKey=()=>client?'gamejobs-public-v2:'+client.project:'';
function cloudJob(id){return cloudIds.has(id)&&!state.demo}
function account(){return personal?.uid||null}
let toastTimer;
const esc=(v)=>String(v===null||v===undefined?'':v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const uniq=(xs)=>[...new Set(xs.filter(Boolean))].sort((a,b)=>a.localeCompare(b,'pt-BR'));
const iso=(v)=>{if(!v)return null;const d=new Date(v);return isNaN(d)?null:d.toISOString()};
const datefmt=(v)=>{if(!v)return 'Não informada';const d=new Date(v);return isNaN(d)?'Não informada':new Intl.DateTimeFormat('pt-BR',{day:'2-digit',month:'short',year:'numeric'}).format(d)};
const money=(j)=>{if(j.salary_text)return j.salary_text; if(j.salary_min!=null||j.salary_max!=null){const fmt=x=>x==null?'—':new Intl.NumberFormat('pt-BR',{maximumFractionDigits:0}).format(Number(x));return `${esc(j.currency||'')} ${fmt(j.salary_min)}–${fmt(j.salary_max)}${j.salary_period?' / '+esc(j.salary_period):''}`;}return 'Não informado'};
const scoreClass=(n)=>n>=75?'high':n>=50?'medium':'low';
function jobs(){if(state.demo)return state.jobs.filter(j=>j.demo);const all=new Map(state.jobs.filter(j=>!j.demo).map(j=>[j.id,j]));for(const j of remoteJobs)all.set(j.id,j);return [...all.values()]}
function st(id){return account()&&cloudJob(id)?(state.states[id]||{}):(localStates[id]||{})}
function persist(){try{localStorage.setItem(storeKey,JSON.stringify({jobs:state.jobs,states:localStates,demo:state.demo}))}catch{toast('Armazenamento local cheio. Exporte seus dados.')}}
function toast(s){$('toast').textContent=s;$('toast').classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').classList.remove('show'),2800)}
function announce(s){$('notice').hidden=false;$('noticeText').textContent=s}
function normalize(raw){
 const val=(...keys)=>{for(const k of keys){if(raw[k]!==undefined&&raw[k]!==null&&raw[k]!=='')return raw[k]}return null};
 const url=String(val('url','link','apply_url')||''); const src=String(val('source','fonte')||'manual');
 const job={
 id:String(val('id','job_id')||`${src}:${url||[val('company','empresa'),val('title','cargo')].join(':')}`).slice(0,230),
 title:String(val('title','cargo')||'Cargo não informado'),company:String(val('company','empresa')||'Empresa não informada'),
 area:String(val('area','categoria')||'Outras'),mode:String(val('mode','modalidade')||'Não informado'),
 location:String(val('location','localizacao')||'Não informada'),country:String(val('country','pais')||'Não informado'),
 eligibility:String(val('eligibility','aceita_brasil')||'A confirmar'),level:String(val('level','senioridade')||'Não informado'),
 contract:String(val('contract','contrato')||'Não informado'),salary_min:val('salary_min'),salary_max:val('salary_max'),
 salary_text:val('salary_text','salario'),currency:val('currency','moeda'),salary_period:val('salary_period'),
 hours_per_day:val('hours_per_day','horas_diarias'),weekly_hours:val('weekly_hours','horas_semanais'),
 posted_at:iso(val('posted_at','publicacao')),deadline_at:iso(val('deadline_at','encerramento')),
 requirements:String(val('requirements','requisitos')||''),differentials:String(val('differentials','diferenciais')||''),
 description:String(val('description','descricao')||''),language:String(val('language','idioma')||'Não informado'),
 url:/^https?:\/\//i.test(url)?url:'',source:src,source_board:val('source_board'),
 status:['active','closed','unverified'].includes(val('status'))?val('status'):'unverified',
 score:val('score','compatibilidade')!==null&&Number.isFinite(Number(val('score','compatibilidade')))?Math.max(0,Math.min(100,Number(val('score','compatibilidade')))):null,
 score_reason:String(val('score_reason','justificativa')||''),first_seen_at:iso(val('first_seen_at'))||new Date().toISOString(),last_seen_at:iso(val('last_seen_at')),
 last_checked_at:iso(val('last_checked_at')),closed_at:iso(val('closed_at')),gaps:Array.isArray(raw.gaps)?raw.gaps.map(String):[],priority:Number(raw.priority)||6,eligibility_evidence:String(raw.eligibility_evidence||''),
 demo:Boolean(val('demo')),
 };
 if(!job.id||!job.title)throw Error('Vaga sem identificador ou cargo');return job;
}
function updateState(id,patch){
 if(patch.stage&&['Candidatado','Entrevista','Proposta','Rejeitado','Contratado'].includes(patch.stage)&&!st(id).applied_at)patch.applied_at=new Date().toISOString();
 if(account()&&cloudJob(id)){try{personal.change(id,patch);personal.flush().catch(()=>{toast('Alteração pendente neste aparelho. Tente sincronizar novamente.');connectionStatus('Alterações pendentes')})}catch{toast('Não foi possível guardar o acompanhamento. Exporte um backup.')}}
 else{localStates[id]={...st(id),...GameJobsSync.cleanPatch(patch)};persist();render();if(client&&cloudJob(id))toast('Salvo neste aparelho. Entre e use “Migrar histórico local” para sincronizar.');}
}
function filters(){return {q:$('search').value.trim().toLowerCase(),area:$('fArea').value,mode:$('fMode').value,level:$('fLevel').value,
 contract:$('fContract').value,score:Number($('fScore').value),days:Number($('fDate').value),loc:$('fLocation').value.toLowerCase(),company:$('fCompany').value.toLowerCase(),
 hours:$('fHours').value,salary:$('fSalary').value,eligibility:$('fEligibility').value,language:$('fLanguage').value};}
function filtered(){const f=filters();let arr=jobs().filter(j=>{
 const s=st(j.id);const closed=j.status==='closed';
 if(state.view==='closed'&&!closed)return false;
 if(['all','new'].includes(state.view)&&closed)return false;
 if(state.view==='new'&&s.read_at)return false;
 if(state.view==='saved'&&!s.saved)return false;
 if(state.view==='clicked'&&!s.clicked_at)return false;
 if(state.view==='applied'&&!['Candidatado','Entrevista','Proposta','Rejeitado','Contratado'].includes(s.stage))return false;
 if(f.q&&!(`${j.title} ${j.company} ${j.area} ${j.requirements} ${j.differentials} ${j.description} ${j.location}`.toLowerCase().includes(f.q)))return false;
 if(f.area&&j.area!==f.area)return false;if(f.mode&&j.mode!==f.mode)return false;if(f.level&&j.level!==f.level)return false;
 if(f.contract&&j.contract!==f.contract)return false;if(f.score&&(j.score===null||j.score<f.score))return false;
 if(f.days&&(!j.posted_at||(Date.now()-new Date(j.posted_at).getTime())>f.days*86400000))return false;
 if(f.loc&&!(`${j.location} ${j.country}`.toLowerCase().includes(f.loc)))return false;
 if(f.company&&!j.company.toLowerCase().includes(f.company))return false;
 if(f.hours==='known'&&j.hours_per_day==null&&j.weekly_hours==null)return false;
 if(f.hours==='part'&&(j.hours_per_day==null||Number(j.hours_per_day)>6))return false;
 if(f.hours==='full'&&(j.hours_per_day==null||Number(j.hours_per_day)<=6))return false;
 if(f.salary==='known'&&j.salary_text==null&&j.salary_min==null&&j.salary_max==null)return false;
 if(f.salary==='unknown'&&(j.salary_text!=null||j.salary_min!=null||j.salary_max!=null))return false;
 if(f.eligibility&&j.eligibility!==f.eligibility)return false;
 if(f.language&&!j.language.includes(f.language))return false;
 return true;});
 const sort=$('sort').value;
 arr.sort((a,b)=>{if(sort==='score')return (a.priority??6)-(b.priority??6)||(b.score??-1)-(a.score??-1)||((new Date(b.posted_at||0))-(new Date(a.posted_at||0)));
 if(sort==='recent')return new Date(b.posted_at||b.first_seen_at||0)-new Date(a.posted_at||a.first_seen_at||0);
 if(sort==='deadline')return new Date(a.deadline_at||'2999-01-01')-new Date(b.deadline_at||'2999-01-01');
 if(sort==='company')return a.company.localeCompare(b.company);
 if(sort==='salary')return Number(b.salary_max??b.salary_min??-1)-Number(a.salary_max??a.salary_min??-1);
 return 0;});return arr;
}
function badge(v,cls=''){return `<span class="pill ${cls}">${esc(v)}</span>`}
function render(){const all=jobs(),active=all.filter(j=>j.status==='active'),s=(id)=>st(id);
 const apply=s=>['Candidatado','Entrevista','Proposta','Rejeitado','Contratado'].includes(s.stage);
 $('mActive').textContent=active.length;$('mHigh').textContent=active.filter(j=>j.score!=null&&j.score>=75).length;
 $('mNew').textContent=active.filter(j=>!s(j.id).read_at).length;$('mApplied').textContent=all.filter(j=>apply(s(j.id))).length;
 for(const [k,v] of Object.entries({All:all.filter(j=>j.status!=='closed').length,New:all.filter(j=>j.status!=='closed'&&!s(j.id).read_at).length,Clicked:all.filter(j=>s(j.id).clicked_at).length,Saved:all.filter(j=>s(j.id).saved).length,Applied:all.filter(j=>apply(s(j.id))).length,Closed:all.filter(j=>j.status==='closed').length}))$('count'+k).textContent=v;
 const areas=uniq(all.map(j=>j.area));const area=$('fArea');const cur=area.value;area.innerHTML='<option value="">Todas as áreas</option>'+areas.map(a=>`<option value="${esc(a)}">${esc(a)}</option>`).join('');area.value=areas.includes(cur)?cur:'';
 const names={all:'Todas as vagas',new:'Não visualizadas',clicked:'Links acessados',saved:'Salvas',applied:'Candidaturas',closed:'Encerradas'};
 $('crumbCurrent').textContent=names[state.view];$('pageTitle').innerHTML=esc(state.view==='all'?'Radar de oportunidades':names[state.view])+'<span class="period">.</span>';
 document.querySelectorAll('.nav-btn').forEach(x=>x.classList.toggle('active',x.dataset.view===state.view));
 const arr=filtered();$('resultCount').textContent=arr.length;$('resultSubtitle').textContent=`${arr.length} oportunidade${arr.length!==1?'s':''} encontrada${arr.length!==1?'s':''} • ${all.length} no total`;
 const activeFilterIds=['search','fArea','fMode','fLevel','fContract','fScore','fDate','fLocation','fCompany','fHours','fSalary','fEligibility','fLanguage'];
 const fc=activeFilterIds.filter(k=>{const x=$(k);return x.value&&x.value!=='0'}).length;$('filterCount').textContent=fc?`(${fc})`:'';
 $('jobList').innerHTML=arr.map(j=>{
 const stt=s(j.id);const sc=j.score===null?'—':Math.round(j.score);const cls=j.score===null?'medium':scoreClass(j.score);const isClosed=j.status==='closed';
 const clock=j.hours_per_day!=null?`${j.hours_per_day} h/dia`:j.weekly_hours!=null?`${j.weekly_hours} h/semana`:null;
 return `<article class="job ${isClosed?'closed':''}" data-id="${esc(j.id)}"><div class="company-icon">${esc(j.company.slice(0,2).toUpperCase())}</div><div class="job-body"><div class="job-title-row"><button class="job-title" data-action="detail" data-id="${esc(j.id)}">${esc(j.title)}</button>${!stt.read_at&&!isClosed?'<span class="tag-new">NÃO VISTA</span>':''}${j.demo?'<span class="demo-banner">EXEMPLO FICTÍCIO</span>':''}</div><div class="job-company">${esc(j.company)}</div><div class="job-meta"><span>⌖ ${esc(j.location||'Não informada')}</span><span>▢ ${esc(j.mode)}</span><span>◷ ${esc(datefmt(j.posted_at))}</span>${clock?`<span>◴ ${esc(clock)}</span>`:''}</div><div class="job-tags">${badge(j.area)}${badge(j.level)}${badge(j.eligibility==='Sim'?'Aceita Brasil':j.eligibility==='Não'?'Não aceita Brasil':'Brasil: confirmar',j.eligibility==='Sim'?'ok':j.eligibility==='Não'?'bad':'warn')}${stt.stage&&stt.stage!=='Nenhuma'?badge(stt.stage,'ok'):''}${isClosed?badge('Encerrada','bad'):j.status==='unverified'?badge('Situação a confirmar','warn'):''}</div></div><div class="job-right"><div class="score-label">COMPATIBILIDADE</div><div class="score ${cls}">${sc}<small>${j.score===null?'Não avaliada':'/100'}</small></div><div class="score-track"><span class="${cls}" style="width:${j.score??0}%"></span></div><div class="job-utilities"><button class="mini-btn ${stt.saved?'selected':''}" data-action="save" data-id="${esc(j.id)}" title="Salvar vaga">${stt.saved?'★':'☆'}</button><button class="mini-btn" data-action="detail" data-id="${esc(j.id)}">Detalhes →</button></div></div></article>`;
 }).join('');
 $('emptyState').hidden=arr.length>0;$('jobList').hidden=!arr.length;
 $('emptyTitle').textContent=all.length?'Nenhuma vaga encontrada':'Seu radar ainda está vazio';$('emptyText').textContent=all.length?'Experimente limpar os filtros ou mudar de lista.':'Importe um arquivo JSON ou abra a demonstração com vagas fictícias.';
}
function openDrawer(id){const j=jobs().find(v=>v.id===id);if(!j)return;state.selected=id;if(!st(id).read_at)updateState(id,{read_at:new Date().toISOString()});
 const s=st(id),closed=j.status==='closed';
 $('drawerContent').innerHTML=`<h2 class="detail-title">${esc(j.title)}</h2><div class="detail-company">${esc(j.company)} · ${esc(j.location)}</div><div class="detail-badges">${badge(j.area)}${badge(j.mode)}${badge(j.level)}${badge(j.contract)}${badge(closed?'Encerrada':j.status==='active'?'Ativa':'A confirmar',closed?'bad':j.status==='active'?'ok':'warn')}${j.demo?badge('Exemplo fictício','warn'):''}</div><div class="details-score"><strong>${j.score===null?'—':Math.round(j.score)+'/100'}</strong><p><b>Compatibilidade orientativa</b><br>${esc(j.score_reason||'Compatibilidade não avaliada. Não é uma garantia de elegibilidade.')}</p></div><div class="detail-actions"><button class="btn primary" id="openJobLink" ${!j.url?'disabled':''}>↗ Abrir anúncio oficial</button><button class="btn secondary" id="toggleSaved">${s.saved?'★ Salva':'☆ Salvar'}</button></div><div class="detail-section"><h3>Informações da vaga</h3><div class="detail-kv">
 <div><label>Salário</label><strong>${esc(money(j))}</strong></div><div><label>Jornada</label><strong>${j.hours_per_day!=null?esc(j.hours_per_day+' h/dia'):j.weekly_hours!=null?esc(j.weekly_hours+' h/semana'):'Não informada'}</strong></div><div><label>Publicação</label><strong>${esc(datefmt(j.posted_at))}</strong></div><div><label>Encerramento</label><strong>${esc(datefmt(j.deadline_at))}</strong></div><div><label>Elegibilidade Brasil</label><strong>${esc(j.eligibility)}</strong></div><div><label>Idioma</label><strong>${esc(j.language)}</strong></div><div><label>Primeira descoberta</label><strong>${esc(datefmt(j.first_seen_at))}</strong></div><div><label>Última verificação</label><strong>${esc(datefmt(j.last_checked_at||j.last_seen_at))}</strong></div><div><label>Última confirmação ativa</label><strong>${esc(datefmt(j.last_seen_at))}</strong></div><div><label>Encerrada em</label><strong>${esc(datefmt(j.closed_at))}</strong></div></div><p>${esc(j.eligibility_evidence||'Elegibilidade exige confirmação no anúncio oficial.')}</p></div>
 <div class="detail-section"><h3>Requisitos</h3><p>${esc(j.requirements||'Não especificados separadamente. Consulte a descrição oficial.')}</p></div>
 <div class="detail-section"><h3>Lacunas a desenvolver ou confirmar</h3><p>${esc(j.gaps?.join(', ')||'Sem lacunas identificadas automaticamente; consulte os requisitos.')}</p></div><div class="detail-section"><h3>Diferenciais</h3><p>${esc(j.differentials||'Não informados')}</p></div>
 <div class="detail-section"><h3>Descrição / observações do anúncio</h3><p>${esc(j.description||'Consulte o anúncio original para mais detalhes.')}</p></div>
 <div class="detail-section"><h3>Seu acompanhamento</h3><label class="form-field"><span>Etapa da candidatura</span><select id="stage"><option>Nenhuma</option><option>Interessado</option><option>Candidatado</option><option>Entrevista</option><option>Proposta</option><option>Rejeitado</option><option>Contratado</option><option>Descartado</option></select></label><label class="form-field"><span>Notas pessoais</span><textarea id="jobNotes" placeholder="Ex.: preciso adaptar o currículo, falar com recrutador..."></textarea></label><div class="drawer-actions"><button class="btn primary" id="saveNotes">Salvar acompanhamento</button></div><p class="muted">Clique pelo painel para registrar um acesso. Acessos externos não podem ser detectados.</p></div>
 <div class="detail-section"><h3>Origem</h3><p>${esc(j.source||'Manual')} ${j.source_board?'· '+esc(j.source_board):''}${j.demo?' · Demonstração, não é uma vaga real':''}</p></div>`;
 $('stage').value=s.stage||'Nenhuma';$('jobNotes').value=s.notes||'';
 $('openJobLink').onclick=()=>{if(j.url){updateState(id,{clicked_at:s.clicked_at||new Date().toISOString()});window.open(j.url,'_blank','noopener,noreferrer');toast('Clique registrado em Links acessados')}};
 let initialStage=s.stage||'Nenhuma',initialNotes=s.notes||'';
 $('toggleSaved').onclick=()=>{updateState(id,{saved:!st(id).saved});$('toggleSaved').textContent=st(id).saved?'★ Salva':'☆ Salvar';toast(st(id).saved?'Vaga salva':'Vaga removida das salvas')};
 $('saveNotes').onclick=()=>{const patch={};if($('stage').value!==initialStage)patch.stage=$('stage').value;if($('jobNotes').value!==initialNotes)patch.notes=$('jobNotes').value;if(Object.keys(patch).length){updateState(id,patch);initialStage=$('stage').value;initialNotes=$('jobNotes').value;toast('Acompanhamento salvo no aparelho; sincronização automática quando conectado.')}else toast('Nenhuma alteração no acompanhamento')};
 $('veil').hidden=false;$('drawer').classList.add('open');$('drawer').setAttribute('aria-hidden','false');document.body.style.overflow='hidden';
}
function closeDrawer(){state.selected=null;$('drawer').classList.remove('open');$('drawer').setAttribute('aria-hidden','true');$('veil').hidden=true;document.body.style.overflow=''}
function openModal(title,html){$('modalTitle').textContent=title;$('modalContent').innerHTML=`<div class="modal-content">${html}</div>`;$('modal').hidden=false;document.body.style.overflow='hidden'}
function closeModal(){$('modal').hidden=true;document.body.style.overflow=''}
function connectionStatus(message){
 $('connectName').textContent=client?(account()?'Conta conectada':'Vagas públicas'):'Modo local';
 $('connectHint').textContent=client?(account()?'Histórico privado da sua conta':'Entre para sincronizar seu histórico'):'Dados salvos neste aparelho';
 $('connectDot').className='dot '+(client&&!remoteError?'green':'amber');
 $('syncText').textContent=message||(!client?'Supabase não configurado':remoteError?'Falha de atualização; cache local':'Dados do Supabase');
}
async function refreshRemote(){
 if(refreshing)return;refreshing=true;$('refreshBtn').disabled=true;$('jobList').setAttribute('aria-busy','true');connectionStatus('Carregando vagas…');
 try{
  const rows=await client.jobs();remoteJobs=rows.map(normalize);cloudIds.clear();remoteJobs.forEach(j=>cloudIds.add(j.id));remoteError=false;
  try{localStorage.setItem(remoteCacheKey(),JSON.stringify(remoteJobs))}catch{}
  if(!state.demo)announce(rows.length?'Vagas carregadas do Supabase. A coleta é feita pelo GitHub Actions; confira a última verificação de cada anúncio.':'Supabase conectado, mas ainda não há vagas. Configure e execute o coletor para alimentar o banco.');
  connectionStatus('Vagas atualizadas às '+new Date().toLocaleTimeString('pt-BR'));
 }catch(error){remoteError=true;announce('Não foi possível atualizar as vagas. '+error.message+' Dados já carregados continuam disponíveis; confira a data de verificação.');connectionStatus('Falha na atualização')}
 finally{refreshing=false;$('refreshBtn').disabled=false;$('jobList').setAttribute('aria-busy','false');render()}
 if(account()){try{await personal.flush();await personal.refresh();connectionStatus(remoteError?'Vagas em cache; histórico sincronizado':'Vagas e histórico sincronizados')}catch{toast('Histórico sem sincronizar. Alterações pendentes permanecem nesta conta e aparelho.');connectionStatus('Histórico pendente')}}
}
function handleSession(session){
 const uid=session?.user?.id||null;if(uid===personal.uid)return;
 closeDrawer();personal.select(uid);state.states=uid?personal.states:localStates;render();connectionStatus();
 if(uid)personal.flush().then(()=>personal.refresh()).catch(()=>{toast('Conta conectada; histórico aguardando conexão.');connectionStatus('Histórico pendente')});
}
async function connect(){
 try{client=GameJobsSupabase.createClient(window.GAMEJOBS_CONFIG||{});if(!client){connectionStatus();return}}
 catch(error){announce(error.message+' O modo local continua disponível.');connectionStatus();return}
 personal=new GameJobsSync.PersonalSync(client,localStorage,rows=>{state.states=account()?rows:localStates;render()});
 try{const cache=JSON.parse(localStorage.getItem(remoteCacheKey()));if(Array.isArray(cache)){remoteJobs=cache.map(normalize).map(j=>({...j,status:j.status==='closed'?'closed':'unverified'}));remoteJobs.forEach(j=>cloudIds.add(j.id));render()}}catch{}
 client.onChange(handleSession);await client.restore();handleSession(client.getSession());await refreshRemote();
 const seconds=Math.max(30,Number(window.GAMEJOBS_CONFIG.refreshSeconds)||120);
 setInterval(()=>{if(!document.hidden)refreshRemote()},seconds*1000);
 window.addEventListener('online',()=>refreshRemote());
 document.addEventListener('visibilitychange',()=>{if(!document.hidden)refreshRemote()});
}
function canonicalLink(value){try{const url=new URL(value);if(url.protocol!=='https:')return '';if(url.hostname==='boards.greenhouse.io')url.hostname='job-boards.greenhouse.io';url.hash='';url.pathname=url.pathname.replace(/\/$/,'');for(const key of [...url.searchParams.keys()])if(key.startsWith('utm_')||['gh_src','lever-source','lever-origin','source'].includes(key))url.searchParams.delete(key);url.searchParams.sort();return url.href}catch{return ''}}
async function migrateLocal(){
 try{
  const owner=account();
  await personal.flush();await personal.refresh();let count=0;
  const byLink=new Map();for(const job of remoteJobs){const link=canonicalLink(job.url);if(link)byLink.set(link,byLink.has(link)?null:job.id)}
  const legacyJobs=new Map(state.jobs.filter(j=>!j.demo).map(j=>[j.id,j]));
  for(const [id,row] of Object.entries({...localStates,...personal.imported})){
   if(account()!==owner)throw Error('A conta mudou durante a migração.');
   // Exact identity or unambiguous official URL only; existing cloud rows always win.
   const target=cloudIds.has(id)?id:byLink.get(canonicalLink(legacyJobs.get(id)?.url));
   if(target&&!personal.states[target]&&Object.keys(row).length){await client.patch(target,row,true);count++}
  }
  await personal.refresh();toast(`${count} registros locais processados. Registros existentes na conta foram preservados.`);
 }catch{toast('Migração pendente. Confira a conexão e tente novamente.')}render();
}
function settings(){
 const auth=client?(account()?`<p>Conta: ${esc(client.getSession()?.user?.email||'Autenticada')}. Favoritos, notas e candidaturas de vagas do Supabase ficam protegidos pela sua conta.</p><button class="btn secondary" id="signOut">Sair da conta</button><button class="btn secondary" id="migrateLocal">Migrar histórico local</button><p>A migração copia apenas vagas reais já presentes no banco e sem acompanhamento nesta conta. Outros registros continuam no backup local.</p>`:`<form id="authForm"><label class="form-field"><span>E-mail</span><input id="authEmail" type="email" required autocomplete="email"></label><label class="form-field"><span>Senha (mínimo 8 caracteres)</span><input id="authPassword" type="password" required minlength="8" autocomplete="current-password"></label><button class="btn primary" id="signIn" type="submit">Entrar</button><button class="btn secondary" id="signUp" type="button">Criar conta</button></form><p>Ao criar a conta, confirme o e-mail se o Supabase solicitar. Dados locais só são transferidos ao usar “Migrar histórico local”.</p>`):'<p>Supabase não configurado. Preencha somente a URL e a chave pública em config.js após aplicar o SQL. Neste modo, o histórico fica neste navegador.</p>';
 openModal('Conta e dados',`<h3>Sincronização</h3>${auth}<p id="authMessage" role="status"></p><h3>Importar e exportar</h3><p>O backup inclui vagas e acompanhamento visível. Guarde-o em local privado. Importações preservam os campos pessoais existentes e ficam no aparelho, sem envio automático à conta.</p><button class="btn secondary" id="settingsImport">Importar JSON</button><button class="btn secondary" id="settingsExport">Exportar JSON</button><hr><h3>Demonstração e dados locais</h3><p>Os exemplos são fictícios e não têm anúncios de candidatura. A demonstração mantém os dados reais separados. Limpar vagas locais preserva o histórico.</p><button class="btn secondary" id="settingsDemo">Carregar exemplos fictícios</button><button class="btn secondary" id="exitDemo">Voltar às vagas reais / locais</button><button class="btn secondary" id="settingsClear">Limpar apenas vagas locais</button>`);
 $('settingsImport').onclick=()=>$('fileInput').click();$('settingsExport').onclick=exportJson;
 $('settingsDemo').onclick=()=>{loadDemo();closeModal()};$('exitDemo').onclick=()=>{state.demo=false;persist();closeModal();render();if(client)refreshRemote()};
 $('settingsClear').onclick=()=>{if(confirm('Remover vagas importadas e demonstração deste aparelho? Seu histórico será preservado.')){state.jobs=[];state.demo=false;persist();render();closeModal()}};
 if($('signOut'))$('signOut').onclick=async()=>{try{await personal.flush();await client.signOut();closeModal();toast('Conta desconectada')}catch{toast('Não foi possível concluir a saída. Tente novamente após sincronizar.')}};
 if($('migrateLocal'))$('migrateLocal').onclick=migrateLocal;
 if($('authForm')){
  let busy=false;
  const submit=async(signup)=>{if(busy||!$('authForm').reportValidity())return;busy=true;$('signIn').disabled=true;$('signUp').disabled=true;
   const message=$('authMessage'),email=$('authEmail').value.trim(),password=$('authPassword').value;
   try{if(signup){await client.signUp(email,password);message.textContent='Solicitação recebida. Confira seu e-mail para confirmar a conta e depois entre.'}else{await client.signIn(email,password);closeModal();toast('Conta conectada')}}
   catch(error){message.textContent=error.message+' Confira o e-mail, a senha e a confirmação da conta.'}
   finally{busy=false;if($('authPassword'))$('authPassword').value='';if($('signIn'))$('signIn').disabled=false;if($('signUp'))$('signUp').disabled=false}
  };
  $('authForm').onsubmit=e=>{e.preventDefault();submit(false)};$('signUp').onclick=()=>submit(true);
 }
}
function exportJson(){const payload={backup_version:2,exported_at:new Date().toISOString(),user_id:account(),jobs:[...new Map([...state.jobs,...remoteJobs].map(j=>[j.id,j])).values()],states:account()?personal.states:localStates,local_states:localStates,pending:account()?personal.pending:{},account_imports:account()?personal.imported:{}};const a=document.createElement('a'),blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'});a.href=URL.createObjectURL(blob);a.download='gamejobs-radar-backup-'+new Date().toISOString().slice(0,10)+'.json';document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),1000);toast('Backup exportado')}
function loadDemo(){const now=new Date().toISOString();const examples=[
 {id:'demo:1',title:'Game Design Intern',company:'Estúdio Aurora (fictício)',area:'Game Design',mode:'Remoto',location:'Brasil · Remoto',country:'Brasil',eligibility:'Sim',level:'Estágio',contract:'Meio período',score:91,score_reason:'Estágio em game design com prototipação; alinhado ao perfil estudante. Nota demonstrativa.',requirements:'Interesse por documentação de sistemas, prototipagem e playtesting.',differentials:'Experiência com Unreal Blueprints ou Godot.',language:'Português',hours_per_day:6,salary_text:'R$ 1.600 / mês',status:'active'},
 {id:'demo:2',title:'Junior QA Game Tester',company:'Pixel Forge (fictício)',area:'QA',mode:'Híbrido',location:'Belo Horizonte, MG',country:'Brasil',eligibility:'Sim',level:'Júnior',contract:'Integral',score:84,score_reason:'Entrada em QA com habilidades transferíveis de testes e análise de sistemas. Nota demonstrativa.',requirements:'Criar e executar planos de testes. Documentar bugs com clareza.',differentials:'Experiência em jogos online.',status:'active'},
 {id:'demo:3',title:'Gameplay Programmer — Unreal',company:'Northlight Interactive (fictício)',area:'Programação',mode:'Remoto',location:'Global · A confirmar',country:'Internacional',eligibility:'A confirmar',level:'Júnior',contract:'Integral',score:73,score_reason:'Contato com Blueprints ajuda, mas demanda C++ profissional e elegibilidade não confirmada.',requirements:'Unreal Engine, C++, Blueprints e Git.',differentials:'Multiplayer e sistemas de combate.',language:'Inglês',status:'active'},
 {id:'demo:4',title:'Junior Technical Artist',company:'Blueframe Games (fictício)',area:'Arte e VFX',mode:'Remoto',location:'Europa (restrita)',country:'Europa',eligibility:'Não',level:'Júnior',score:40,score_reason:'Área de transição; exige portfólio em shaders e acesso geográfico restrito. Nota demonstrativa.',requirements:'Shaders, materiais, Niagara e Houdini.',status:'active'},
 {id:'demo:5',title:'Community Coordinator',company:'Waypoint Studio (fictício)',area:'Comunidade',mode:'Remoto',location:'Brasil',country:'Brasil',eligibility:'Sim',level:'Júnior',contract:'Meio período',score:77,score_reason:'Vaga de entrada e transferível para alguém que conhece comunidades de jogos.',requirements:'Comunicação, eventos de comunidade e inglês intermediário.',status:'active'},
 {id:'demo:6',title:'3D Character Artist',company:'Copper Kite (fictício)',area:'Arte 3D',mode:'Presencial',location:'São Paulo, SP',country:'Brasil',eligibility:'Sim',level:'Pleno',score:51,score_reason:'Pode desenvolver habilidades de modelagem, mas nível pleno exige experiência maior.',requirements:'Maya, escultura, baking e texturização PBR.',status:'active'},
 {id:'demo:7',title:'Narrative Designer Assistant',company:'Narrative Works (fictício)',area:'Narrativa',mode:'Remoto',location:'Brasil',country:'Brasil',eligibility:'Sim',level:'Estágio',score:78,score_reason:'Oportunidade de transição para narrativa com baixa exigência de experiência.',requirements:'Escrita, estrutura narrativa e narrativa interativa.',status:'closed'},
 ];const day=(n)=>new Date(Date.now()-n*86400000).toISOString();state.jobs=[...state.jobs.filter(j=>!j.demo),...examples.map((j,i)=>normalize({...j,posted_at:day(i+1),deadline_at:i===6?day(1):null,first_seen_at:now,source:'demonstração',demo:true}))];state.demo=true;persist();state.view='all';render();announce('DEMONSTRAÇÃO: estas empresas e vagas são fictícias. Importe dados reais para acompanhar suas oportunidades.');toast('Exemplos fictícios carregados')}
async function importFile(file){if(!file)return;try{const parsed=JSON.parse(await file.text());const list=Array.isArray(parsed)?parsed:Array.isArray(parsed.jobs)?parsed.jobs:null;if(!list)throw Error('Esperado array de vagas ou objeto com campo jobs.');if(list.length>5000)throw Error('Máximo de 5.000 vagas por arquivo.');if(parsed.user_id&&parsed.user_id!==account())throw Error('Este backup pertence a outra conta. Entre na conta correspondente para importar.');const imported=list.map(normalize);const existing=new Map(state.jobs.map(x=>[x.id,x]));for(const j of imported)existing.set(j.id,j);state.jobs=[...existing.values()];if(parsed.states&&typeof parsed.states==='object'){const importedStates=GameJobsSync.cleanStates(parsed.states);if(parsed.user_id){personal.importBackup({...GameJobsSync.cleanStates(parsed.account_imports),...importedStates});}else{for(const [id,row] of Object.entries(importedStates))localStates[id]={...row,...localStates[id]};}for(const [id,row]of Object.entries(GameJobsSync.cleanStates(parsed.local_states)))localStates[id]={...row,...localStates[id]};}if(!account())state.states=localStates;state.demo=false;persist();render();announce('Backup importado neste aparelho. Campos pessoais existentes foram preservados; use a migração explícita para transferir registros ausentes à conta. Exemplos só aparecem na demonstração.');toast(`${imported.length} vagas importadas`);closeModal()}catch(e){toast('Falha na importação: '+e.message)}finally{$('fileInput').value=''}}
function refreshLocal(){render();toast('Modo local: importe um JSON para atualizar as vagas')}
function listeners(){
 $('nav').addEventListener('click',e=>{const btn=e.target.closest('[data-view]');if(!btn)return;state.view=btn.dataset.view;render();$('sidebar').classList.remove('mobile-open');$('veil').hidden=true});
 $('jobList').addEventListener('click',e=>{const btn=e.target.closest('[data-action]');if(!btn)return;const id=btn.dataset.id;if(btn.dataset.action==='detail')openDrawer(id);if(btn.dataset.action==='save'){updateState(id,{saved:!st(id).saved});toast(st(id).saved?'Vaga salva':'Vaga removida')}});
 for(const id of ['search','sort','fArea','fMode','fLevel','fContract','fScore','fDate','fLocation','fCompany','fHours','fSalary','fEligibility','fLanguage'])$(id).addEventListener(['search','fLocation','fCompany'].includes(id)?'input':'change',render);
 $('filtersToggle').onclick=()=>{$('filters').classList.toggle('open');state.filtersOpen=!state.filtersOpen};
 $('clearFilters').onclick=()=>{for(const id of ['search','fArea','fMode','fLevel','fContract','fScore','fDate','fLocation','fCompany','fHours','fSalary','fEligibility','fLanguage'])$(id).value='';render()};
 $('openSettings').onclick=settings;$('topSettings').onclick=settings;
 $('refreshBtn').onclick=()=>client?refreshRemote():refreshLocal();$('exportJson').onclick=exportJson;$('importBtn').onclick=()=>$('fileInput').click();$('fileInput').onchange=e=>importFile(e.target.files[0]);
 $('emptyDemo').onclick=loadDemo;$('emptyImport').onclick=()=>$('fileInput').click();$('noticeClose').onclick=()=>$('notice').hidden=true;
 $('closeDrawer').onclick=closeDrawer;$('closeModal').onclick=closeModal;$('menuBtn').onclick=()=>{$('sidebar').classList.toggle('mobile-open');$('veil').hidden=!$('sidebar').classList.contains('mobile-open')};
 $('veil').onclick=()=>{closeDrawer();$('sidebar').classList.remove('mobile-open')};
 document.addEventListener('keydown',e=>{if(e.key==='Escape'){closeDrawer();closeModal();$('sidebar').classList.remove('mobile-open')}});
}
function init(){state.jobs=state.jobs.flatMap(j=>{try{return [normalize(j)]}catch{return []}});listeners();render();connect();
 if(state.demo){announce('DEMONSTRAÇÃO: estas empresas e vagas são fictícias. Importe dados reais para acompanhar suas oportunidades.');}
 else if(state.jobs.length){announce('Modo local: vagas e acompanhamento estão neste dispositivo. Exporte um backup para transferir seus dados.');}
}
init();
})();
