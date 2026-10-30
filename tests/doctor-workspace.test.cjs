const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=path.join(__dirname,'..');
const read=name=>fs.readFileSync(path.join(root,name),'utf8');
const routing=read('workspace-routing.js').replace('export async function','async function');
const source=read('app.js');
const conversations=read('patient-conversations.js').replaceAll('export function','function');
const overview=source.slice(source.indexOf('let patientConversations=null;'),source.indexOf('\nlet patientOpenRequest='));
const boot=source.slice(source.indexOf('async function boot(){'),source.indexOf('\nconst deliveryLabel='))
 .replaceAll("location.replace('./center.html')","window.__redirect='./center.html'");
const nav=source.slice(source.indexOf("document.querySelectorAll('.nav button').forEach(b=>b.onclick="),source.indexOf('\nfunction loadTherapyPatientList()'));
let browser;
before(async()=>{browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,headless:true,args:['--no-sandbox','--disable-gpu','--disable-dev-shm-usage']});});
after(async()=>{await browser?.close();});

async function setup(options={}) {
 const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.setContent(read('index.html').replace(/<script\b[^>]*>[\s\S]*?<\/script>/g,''));
 for(const css of ['responsive.css','clinica-editoriale.css','dashboard-polish.css','dashboard-mobile.css','patient-conversations.css'])await page.addStyleTag({content:read(css)});
 await page.evaluate(opts=>{
  window.__options=opts;window.__loads=[];
  const profile={id:'doctor',role:opts.role||'Clinician',full_name:'Medico dimostrativo',account_active:opts.active!==false};
  window.__db={auth:{getUser:async()=>({data:{user:opts.signedOut?null:{id:'doctor'}}})},from:()=>{
   let q;q=new Proxy({},{get:(_,key)=>key==='then'?(yes,no)=>Promise.resolve({data:profile}).then(yes,no):()=>q});return q;
  },rpc:async name=>({data:opts.manager?[{id:'center',name:'Centro dimostrativo'}]:[]})};
 },options);
 const stubs=`const $=id=>document.getElementById(id),sb=window.__db;let me,chatUserId,patients=[],workspace='doctor',welcomeShown=true;
 const out=(node,text)=>node.textContent=text,MeditalyCalls={init(){}},voiceController={startWelcomeFlow(){}};
 async function persistClinicianLegal(){} function ensureDashboardChatRealtime(){} function updateInstallButton(){}
 function showPatientDirectory(){} function setWorkspace(mode){workspace=mode;window.__workspace=mode;}
 ${['loadPatients','loadProtocols','loadRequests','loadDirectoryProfile','loadAppointments','loadTherapyPatientList','loadMessages','loadDelivery','loadAdmin','loadMarcoDoctor','loadTestDoctor'].map(name=>`async function ${name}(){window.__loads.push('${name}');}`).join('\n')}
 `;
 await page.addScriptTag({content:routing+'\n'+stubs+conversations+'\n'+overview+'\n'+nav+'\n'+boot+'\nwindow.__boot=boot();'});
 await page.evaluate(()=>window.__boot);
 await page.addScriptTag({content:read('dashboard-mobile.js')});
 return {page,errors};
}

test('doctor boots into the full existing clinical workspace with all requested functions',async()=>{
 const {page,errors}=await setup();
 assert.equal(await page.locator('#portal').isVisible(),true);
 assert.equal(await page.locator('#auth').isVisible(),false);
 assert.equal(await page.locator('#adminNav').isVisible(),false);
 for(const [view,loader] of [['therapies','loadTherapyPatientList'],['appointments','loadAppointments'],['protocols','loadProtocols'],['messages','loadMessages'],['delivery','loadDelivery'],['requests','loadRequests']]) {
  await page.locator(`.nav [data-view="${view}"]`).click();
  assert.equal(await page.locator('#'+view).isVisible(),true);
  assert.ok(await page.evaluate(name=>window.__loads.includes(name),loader));
 }
 assert.match(source,/renderQuestionnaireManager\(/);
 assert.match(source,/import '\.\/visit-slots\.js'/);
 assert.deepEqual(errors,[]);await page.close();
});

test('one login routes managers while denying inactive and unassigned patient accounts',async()=>{
 for(const options of [{role:'Patient',manager:true},{role:'Patient'},{active:false},{signedOut:true},{role:'Administrator'}]) {
  const {page,errors}=await setup(options);
  if(options.manager)assert.equal(await page.evaluate(()=>window.__redirect),'./center.html');
  else if(options.role==='Administrator')assert.equal(await page.evaluate(()=>window.__workspace),'admin');
  else assert.equal(await page.locator('#portal').isVisible(),false);
  assert.deepEqual(errors,[]);await page.close();
 }
});

test('all clinical navigation remains reachable and usable on phones and desktop',async()=>{
 const {page,errors}=await setup();
 for(const width of [320,360,390,768,1280]) {
  await page.setViewportSize({width,height:900});
  for(const view of ['overview','patients','therapies','appointments','protocols','messages','delivery','requests','profile']) {
   const button=page.locator(`.nav [data-view="${view}"]`);
   await button.click();
   assert.equal(await page.locator('#'+view).isVisible(),true);
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${view} overflows at ${width}`);
   if(width<=700)assert.ok((await button.boundingBox()).height>=44);
  }
 }
 await page.setViewportSize({width:390,height:844});
 await page.locator('.nav [data-view="messages"]').click();
 await page.locator('#messageBody').focus();
 assert.equal(await page.locator('.nav').isVisible(),false);
 await page.locator('#messageBody').evaluate(n=>n.blur());
 await page.waitForTimeout(20);assert.equal(await page.locator('.nav').isVisible(),true);
 if(process.env.DOCTOR_SCREENSHOT_DIR){fs.mkdirSync(process.env.DOCTOR_SCREENSHOT_DIR,{recursive:true});await page.locator('.nav [data-view="overview"]').click();await page.screenshot({path:path.join(process.env.DOCTOR_SCREENSHOT_DIR,'doctor-mobile.png'),fullPage:true});}
 assert.deepEqual(errors,[]);await page.close();
});

test('center requests approve and refresh the clinical patient list, or allow retry after failure',async()=>{
 const page=await browser.newPage();
 await page.setContent('<div id="requests"></div>');
 await page.addScriptTag({content:read('center-requests.js').replace('export async function','async function')});
 await page.evaluate(async()=>{
  window.__args=[];window.__refreshes=0;window.__fail=true;
  const db={rpc:async(name,args)=>{
   if(name==='list_my_managed_centers')return {data:[{id:'center',name:'Centro <script> sicuro'}]};
   if(name==='center_management_dashboard')return {data:{code:'0000',requests:[{id:'request',name:'Paziente dimostrativo'}]}};
   window.__args.push(args);return window.__fail?{error:{message:'Rete assente'}}:{data:null};
  }};
  await renderClinicalCenterRequests(db,document.getElementById('requests'),async()=>window.__refreshes++);
 });
 assert.equal(await page.locator('script').count(),1); // only the injected implementation, no markup from names
 await page.getByRole('button',{name:'Accetta',exact:true}).click();
 assert.match(await page.getByRole('status').textContent(),/Rete assente/);
 assert.equal(await page.getByRole('button',{name:'Accetta',exact:true}).isEnabled(),true);
 await page.evaluate(()=>window.__fail=false);
 await page.getByRole('button',{name:'Accetta',exact:true}).click();
 assert.match(await page.getByRole('status').textContent(),/Paziente accettato/);
 assert.deepEqual(await page.evaluate(()=>window.__args[1]),{p_request:'request',p_accept:true});
 assert.equal(await page.evaluate(()=>window.__refreshes),1);
 assert.equal(await page.getByRole('button',{name:'Accetta',exact:true}).count(),0);
 await page.close();
});
