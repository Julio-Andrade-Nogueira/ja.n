/* Browser integration against controlled Supabase responses; fixtures are not real vacancies. */
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const http=require('node:http');
const path=require('node:path');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..');
const ID='20000000-0000-0000-0000-000000000001';
const jobs=[
 {id:ID,title:'Fixture Junior Game Designer',company:'Fixture Studio',area:'Game Design',level:'Júnior',mode:'Remoto',location:'Brasil',country:'Brasil',eligibility:'Sim',contract:'Meio período',score:82,priority:2,hours_per_day:6,language:'Português',salary_min:1000,currency:'BRL',posted_at:new Date().toISOString(),status:'active',url:'https://example.com/fixture/1'},
 {id:'20000000-0000-0000-0000-000000000002',title:'Fixture Senior Animator',company:'Fixture Other',area:'Animação',level:'Sênior',mode:'Híbrido',location:'Belo Horizonte',country:'Brasil',eligibility:'A confirmar',contract:'Integral',score:null,hours_per_day:8,language:'Inglês',status:'unverified',url:'https://example.com/fixture/2'},
 {id:'20000000-0000-0000-0000-000000000003',title:'Fixture Closed QA',company:'Fixture Other',area:'QA',status:'closed',url:'https://example.com/fixture/3'}
];
const waitFor=async(fn)=>{for(let i=0;i<100;i++){if(await fn())return;await new Promise(r=>setTimeout(r,25))}throw Error('Timed out waiting for state')};

test('Pages prefix, legacy data, filters, auth, private sync, account switching and failures',async()=>{
 const server=http.createServer(async(req,res)=>{try{
  if(!req.url.startsWith('/ja.n/')){res.writeHead(404);res.end();return}
  let name=decodeURIComponent(new URL(req.url,'http://localhost').pathname.slice(6))||'index.html';
  const target=path.resolve(root,name);if(!target.startsWith(root+path.sep))throw Error('bad path');
  const data=await fs.readFile(target);res.setHeader('Content-Type',target.endsWith('.js')?'application/javascript':target.endsWith('.css')?'text/css':'text/html');res.end(data);
 }catch{res.writeHead(404);res.end()}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const base=`http://127.0.0.1:${server.address().port}/ja.n/`;
 let browser;
 try{
  const executable=process.env.CHROMIUM_EXECUTABLE||await fs.access('/usr/bin/chromium').then(()=>'/usr/bin/chromium',()=>undefined);
  browser=await chromium.launch({headless:true,executablePath:executable,args:['--no-sandbox']});
  const local=await browser.newContext();
  // Keep the local-mode test deterministic even after public Supabase configuration is filled.
  await local.route('**/radar-assets/config.js',route=>route.fulfill({contentType:'application/javascript',body:'window.GAMEJOBS_CONFIG={supabaseUrl:"",supabasePublishableKey:""}'}));
  await local.addInitScript(()=>{if(!localStorage.getItem('gamejobs-radar-v1'))localStorage.setItem('gamejobs-radar-v1',JSON.stringify({jobs:[{id:'legacy',title:'Legacy fixture',company:'Fixture',status:'unverified'}],states:{legacy:{notes:'preserved legacy note',saved:true}}}))});
  const page=await local.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base);await page.waitForURL('**/painel/radar.html');await page.locator('.job-title').waitFor();
  assert.match(await page.locator('#connectName').textContent(),/Modo local/);
  await page.locator('#topSettings').click();await page.locator('#settingsDemo').click();
  assert.equal(await page.locator('.job').count(),6);
  assert.match(await page.locator('#noticeText').textContent(),/fictícias/);
  await page.locator('#search').fill('QA');assert.equal(await page.locator('.job').count(),1);
  await page.locator('#search').fill('');await page.locator('#topSettings').click();await page.locator('#exitDemo').click();
  assert.equal(await page.locator('.job').count(),1); // Demonstration never enters the real/local list.
  assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('gamejobs-radar-v1')).states.legacy.notes),'preserved legacy note');
  await local.close();

  const context=await browser.newContext();let publicFail=false,privateFail=false,uid='alice',patches=[];
  const states={alice:{[ID]:{job_id:ID,notes:'Alice private note',saved:false,stage:'Entrevista'}},bob:{}};
  await context.route('**/radar-assets/config.js',route=>route.fulfill({contentType:'application/javascript',body:'window.GAMEJOBS_CONFIG={supabaseUrl:"https://fixture.supabase.co",supabasePublishableKey:"sb_publishable_fixture",refreshSeconds:120}'}));
  await context.route('https://fixture.supabase.co/**',async route=>{
   const request=route.request(),url=new URL(request.url());let body={};
   if(url.pathname.endsWith('/token')){const credentials=request.postDataJSON();uid=credentials.email.startsWith('bob')?'bob':'alice';body={user:{id:uid,email:credentials.email},access_token:uid+'-jwt',refresh_token:'refresh',expires_in:3600}}
   else if(url.pathname.endsWith('/user'))body={id:uid};
   else if(url.pathname.endsWith('/logout')){await route.fulfill({status:204});return}
   else if(url.pathname.endsWith('/radar_jobs')){if(publicFail){await route.fulfill({status:503,json:{}});return}body=jobs}
   else if(url.pathname.endsWith('/radar_user_states'))body=Object.values(states[uid]);
   else if(url.pathname.includes('/rpc/')){
    if(privateFail){await route.fulfill({status:503,json:{}});return}
    const {p_job_id,p_patch}=request.postDataJSON();patches.push({uid,id:p_job_id,patch:p_patch});
    states[uid][p_job_id]={...states[uid][p_job_id],job_id:p_job_id,...p_patch};body=[states[uid][p_job_id]];
   }
   await route.fulfill({json:body});
  });
  const app=await context.newPage();app.on('pageerror',e=>errors.push(e.message));
  await app.goto(base+'painel/radar.html');await waitFor(async()=>await app.locator('.job').count()===2);
  assert.equal(await app.locator('#mActive').textContent(),'1');
  assert.match(await app.locator('#jobList').textContent(),/Situação a confirmar/);
  assert.match(await app.locator('#jobList').textContent(),/Não avaliada/);
  await app.locator('#filtersToggle').click();
  // Exercise every existing filter through real DOM input and the unchanged rendering flow.
  const selectors=[['#fArea','Game Design'],['#fMode','Remoto'],['#fLevel','Júnior'],['#fContract','Meio período'],['#fScore','75'],['#fDate','7'],['#fHours','part'],['#fSalary','known'],['#fEligibility','Sim'],['#fLanguage','Português']];
  for(const [selector,value]of selectors){await app.locator(selector).selectOption(value);assert.equal(await app.locator('.job').count(),1,selector);await app.locator('#clearFilters').click()}
  for(const [selector,value]of [['#search','Designer'],['#fLocation','Belo Horizonte'],['#fCompany','Studio']]){await app.locator(selector).fill(value);assert.equal(await app.locator('.job').count(),1,selector);await app.locator('#clearFilters').click()}
  const login=async email=>{await app.locator('#topSettings').click();await app.locator('#authEmail').fill(email);await app.locator('#authPassword').fill('fixture-password');await app.locator('#signIn').click();await waitFor(async()=>!(await app.locator('#modal').isVisible()));await waitFor(async()=>await app.locator('#connectName').textContent()==='Conta conectada')};
  await login('alice@example.com');await app.locator('.job-title').first().click();
  await waitFor(async()=>await app.locator('#jobNotes').inputValue()==='Alice private note');
  await app.locator('#toggleSaved').click();await waitFor(()=>states.alice[ID].saved===true);
  assert.equal(states.alice[ID].notes,'Alice private note');assert.equal(states.alice[ID].stage,'Entrevista');
  assert.ok(patches.some(p=>p.patch.saved===true&&!Object.hasOwn(p.patch,'notes')));
  privateFail=true;await app.locator('#jobNotes').fill('Alice offline edit');await app.locator('#saveNotes').click();
  await waitFor(async()=>await app.evaluate(()=>Object.values(JSON.parse(localStorage.getItem('gamejobs-private-v2:https://fixture.supabase.co:alice')).pending).some(x=>x.notes==='Alice offline edit')));
  await app.reload();await app.locator('.job-title').first().click();assert.equal(await app.locator('#jobNotes').inputValue(),'Alice offline edit');
  privateFail=false;await app.locator('#closeDrawer').click();await app.locator('#refreshBtn').click();await waitFor(()=>states.alice[ID].notes==='Alice offline edit');
  await app.locator('#topSettings').click();await app.locator('#signOut').click();await waitFor(async()=>!(await app.locator('#modal').isVisible()));
  await login('bob@example.com');await app.locator('.job-title').first().click();assert.equal(await app.locator('#jobNotes').inputValue(),'');
  await app.locator('#closeDrawer').click();publicFail=true;await app.locator('#refreshBtn').click();await waitFor(async()=>(await app.locator('#noticeText').textContent()).includes('Não foi possível atualizar'));
  assert.equal(await app.locator('.job').count(),2);
  publicFail=false;await app.locator('#refreshBtn').click();await waitFor(async()=>(await app.locator('#noticeText').textContent()).includes('Vagas carregadas'));
  // Backups remain local and cannot overwrite cloud notes or pollute prototypes.
  await app.locator('#fileInput').setInputFiles({name:'fixture-backup.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({jobs:[],states:{[ID]:{notes:'imported private note'}}}))});
  assert.equal(states.alice[ID].notes,'Alice offline edit');assert.equal(states.bob[ID].notes,undefined);
  await app.setViewportSize({width:390,height:844});
  assert.ok(await app.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));
  assert.deepEqual(errors,[]);
  await context.close();
 }finally{if(browser)await browser.close();await new Promise(r=>server.close(r))}
});
