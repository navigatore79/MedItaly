const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
let browser;
before(async()=>{browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,headless:true,args:['--no-sandbox','--disable-gpu','--disable-dev-shm-usage']});});
after(async()=>{await browser?.close();});
const root=path.join(__dirname,'..');
const routing=fs.readFileSync(path.join(root,'workspace-routing.js'),'utf8').replace('export async function','async function');
async function setup(options={}){
 const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.setContent(fs.readFileSync(path.join(root,'center.html'),'utf8').replace(/<script[^>]*>[\s\S]*?<\/script>/g,''));
 await page.addStyleTag({content:fs.readFileSync(path.join(root,'center.css'),'utf8')});
 await page.evaluate(opts=>{
  window.__options=opts;window.__calls=[];
  window.__data={center:'Laboratorio di Emodinamica - PO Santa Maria delle Grazie di Pozzuoli - ASL NA 2 Nord',code:'0000',requests:[{id:'request',name:'Paziente dimostrativo con un cognome particolarmente lungo per il controllo da smartphone',created_at:'2026-10-27T12:00:00Z'}],patients:[{id:'existing',name:'Paziente esempio'}]};
  window.__mock={auth:{getUser:async()=>({data:{user:opts.signedOut?null:{id:'manager'}}}),mfa:{getAuthenticatorAssuranceLevel:async()=>({data:{currentLevel:opts.aal||'aal2'}}),listFactors:async()=>({data:{totp:[]}})}},from:table=>{const result={data:table==='center_managers'?(opts.denied?[]:[{center_id:'center',active:true}]):{role:opts.role||'Patient',account_active:opts.active!==false}};let chain;chain=new Proxy({}, {get:(_,p)=>p==='then'?(ok,bad)=>Promise.resolve(result).then(ok,bad):()=>chain});return chain;},rpc:async(name,args)=>{window.__calls.push({name,args});if(name==='list_my_managed_centers')return {data:opts.denied||opts.active===false?[]:[{id:'center',name:window.__data.center,mfa_required:opts.requireMfa!==false}]};if(name==='center_management_dashboard')return {data:JSON.parse(JSON.stringify(window.__data))};if(name==='center_respond_patient_request'){if(window.__options.failResponse)return {error:{message:'Connessione interrotta. Riprova.'}};if(args.p_accept)window.__data.patients.push({id:'new',name:window.__data.requests[0].name});window.__data.requests=[];return {data:null};}throw Error('Unexpected RPC '+name);}};
 },options);
 const source=fs.readFileSync(path.join(root,'center.js'),'utf8').replace(/^import .*\n/gm,'').replace(/^const db=createClient.*\n/m,'const db=window.__mock;\n').replaceAll("location.replace('./')","window.__redirect='./'");
 await page.addScriptTag({content:routing+'\n'+source});
 if(!options.signedOut&&options.role!=='Clinician'&&!options.denied&&options.active!==false&&(options.aal!=='aal1'||options.requireMfa===false))await page.locator('.center-name').waitFor();else await page.waitForTimeout(30);
 return {page,errors};
}
test('mobile center preserves 0000, wraps long names, and fits 320–1280px',async()=>{
 const {page,errors}=await setup();
 for(const width of [320,360,390,768,1280]){
  await page.setViewportSize({width,height:900});
  assert.equal(await page.locator('.center-code strong').textContent(),'0000');
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`overflow at ${width}`);
  const tooSmall=await page.locator('button:visible,input:visible,select:visible').evaluateAll(nodes=>nodes.filter(n=>n.getBoundingClientRect().height<44).map(n=>n.id));assert.deepEqual(tooSmall,[]);
 }
 if(process.env.CENTER_SCREENSHOT_DIR){fs.mkdirSync(process.env.CENTER_SCREENSHOT_DIR,{recursive:true});await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(process.env.CENTER_SCREENSHOT_DIR,'center-mobile.png'),fullPage:true});}
 assert.deepEqual(errors,[]);await page.close();
});
test('acceptance moves the requested patient to the searchable list',async()=>{
 const {page,errors}=await setup();await page.getByRole('button',{name:/Accetta la richiesta/}).click();
 await page.getByRole('status').filter({hasText:'Paziente accettato'}).waitFor();
 assert.deepEqual(await page.evaluate(()=>window.__calls.find(c=>c.name==='center_respond_patient_request').args),{p_request:'request',p_accept:true});
 await page.getByRole('tab',{name:'Pazienti (2)'}).click();await page.locator('#patientSearch').fill('particolarmente');assert.equal(await page.locator('#patientList .patient-row').count(),1);
 await page.locator('#patientSearch').fill('inesistente');assert.match(await page.locator('#patientList').textContent(),/Nessun paziente corrisponde/);
 await page.getByRole('tab',{name:'Richieste (0)'}).click();assert.match(await page.locator('#requestsPanel').textContent(),/Nessuna richiesta/);assert.deepEqual(errors,[]);await page.close();
});
test('response failure leaves the request available for retry',async()=>{
 const {page}=await setup({failResponse:true});await page.getByRole('button',{name:/Accetta la richiesta/}).click();await page.getByRole('status').filter({hasText:'Connessione interrotta'}).waitFor();assert.equal(await page.getByRole('button',{name:/Accetta la richiesta/}).isEnabled(),true);assert.equal(await page.locator('.patient-row:visible').count(),1);await page.close();
});
test('missing membership, inactive account and missing MFA never reveal the workspace',async()=>{
 for(const options of [{denied:true},{active:false},{aal:'aal1'}]){const {page,errors}=await setup(options);assert.equal(await page.locator('#workspace').isVisible(),false);assert.equal(await page.locator('.center-name').count(),0);assert.deepEqual(errors,[]);await page.close();}
});

test('an individually exempt center member opens the workspace at aal1 without an MFA prompt',async()=>{const {page,errors}=await setup({aal:'aal1',requireMfa:false});assert.equal(await page.locator('#workspace').isVisible(),true);assert.equal(await page.locator('#mfa').isVisible(),false);assert.equal(await page.locator('.center-code strong').textContent(),'0000');assert.deepEqual(errors,[]);await page.close();});
test('an individual MFA exception never gives an unassigned account center access',async()=>{const {page}=await setup({aal:'aal1',requireMfa:false,denied:true});assert.equal(await page.locator('#workspace').isVisible(),false);assert.equal(await page.evaluate(()=>window.__calls.some(c=>c.name==='center_management_dashboard')),false);await page.close();});

test('old center links send doctors to the full dashboard and signed-out users to the single login',async()=>{
 for(const options of [{role:'Clinician'},{signedOut:true}]) {
  const {page,errors}=await setup(options);
  assert.equal(await page.evaluate(()=>window.__redirect),'./');
  assert.equal(await page.locator('input[type="password"]').count(),0);
  assert.equal(await page.evaluate(()=>window.__calls.some(c=>c.name==='center_management_dashboard')),false);
  assert.deepEqual(errors,[]);await page.close();
 }
});
