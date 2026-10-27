import {createClient} from 'https://esm.sh/@supabase/supabase-js@2.116.0';
const db=createClient('https://ejlhgtodmcadmdhbujkf.supabase.co','sb_publishable_QoVgKCNOTSbrXFgXdusqfA_5_OM5jwM');
const $=id=>document.getElementById(id),esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let user=null,current=null,tab='requests',search='',loadVersion=0;
const say=s=>$('message').textContent=s,fail=e=>say(e?.message||'Operazione non disponibile. Riprova.');
const date=s=>new Intl.DateTimeFormat('it-IT',{day:'numeric',month:'long',timeZone:'Europe/Rome'}).format(new Date(s));
$('loginForm').onsubmit=async e=>{e.preventDefault();const b=e.currentTarget.querySelector('button');b.disabled=true;say('Accesso in corso…');try{const {error}=await db.auth.signInWithPassword({email:$('email').value.trim(),password:$('password').value});if(error)throw error;$('password').value='';await boot();}catch(e){fail(e);}finally{b.disabled=false;}};
$('logout').onclick=async()=>{try{const {error}=await db.auth.signOut();if(error)throw error;location.reload();}catch(e){fail(e);}};
async function mfa(){
 $('mfa').hidden=false;$('workspace').hidden=true;const {data,error}=await db.auth.mfa.listFactors();if(error)throw error;
 let factor=data.totp.find(x=>x.status==='verified')||data.totp[0];
 if(factor){$('mfa').innerHTML='<h2>Verifica l’accesso</h2>';code(factor);return;}
 $('mfa').innerHTML='<h2>Proteggi l’accesso</h2><p>Configura il secondo fattore con un’app Authenticator.</p><button id="enroll" type="button">Configura secondo fattore</button>';
 $('enroll').onclick=async()=>{const b=$('enroll');b.disabled=true;try{const {data,error}=await db.auth.mfa.enroll({factorType:'totp',friendlyName:'MEDIapp Centro'});if(error)throw error;factor=data;$('mfa').replaceChildren();const image=new Image();image.alt='Codice QR per configurare il secondo fattore';image.src=data.totp.qr_code;$('mfa').append(image);code(factor);}catch(e){fail(e);b.disabled=false;}};
}
function code(factor){
 $('mfa').insertAdjacentHTML('beforeend','<form id="otpForm"><label for="otp">Codice Authenticator</label><input id="otp" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required><button class="full" type="submit">Verifica e accedi</button></form>');
 $('otpForm').onsubmit=async e=>{e.preventDefault();const b=e.currentTarget.querySelector('button');b.disabled=true;try{const {error}=await db.auth.mfa.challengeAndVerify({factorId:factor.id,code:$('otp').value});if(error)throw Error('Codice non valido o scaduto. Riprova.');const result=await db.auth.refreshSession();if(result.error)throw result.error;await boot();}catch(e){fail(e);}finally{b.disabled=false;}};
}
async function boot(){
 say('');$('workspace').hidden=true;const {data:{user:u},error}=await db.auth.getUser();if(!u){if(error&&error.name!=='AuthSessionMissingError')throw error;return;}if(error)throw error;
 user=u;$('access').hidden=true;$('logout').hidden=false;const assurance=await db.auth.mfa.getAuthenticatorAssuranceLevel();if(assurance.error)throw assurance.error;
 if(assurance.data.currentLevel!=='aal2'){await mfa();return;}$('mfa').hidden=true;
 const [membership,profile,centers]=await Promise.all([db.from('center_managers').select('center_id,active').eq('user_id',user.id).eq('active',true),db.from('profiles').select('role,account_active').eq('id',user.id).single(),db.rpc('list_patient_centers')]);
 for(const result of [membership,profile,centers])if(result.error)throw result.error;
 if(!profile.data?.account_active)throw Error('Account non attivo.');
 const ids=new Set(membership.data.map(x=>x.center_id)),list=centers.data.filter(x=>profile.data.role==='Administrator'||ids.has(x.id));
 if(!list.length){say('Il tuo account non ha ancora un centro abilitato. Contatta l’amministratore.');$('dashboard').replaceChildren();return;}
 $('intro').hidden=true;$('workspace').hidden=false;$('center').innerHTML=list.map(c=>`<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('');$('center').closest('label').hidden=list.length===1;
 $('center').onchange=()=>{tab='requests';search='';load().catch(fail);};$('refresh').onclick=()=>load().catch(fail);await load();
}
async function load(){
 const version=++loadVersion,center=$('center').value;$('dashboard').setAttribute('aria-busy','true');$('dashboard').innerHTML='<p class="loading">Aggiornamento del centro…</p>';$('refresh').disabled=true;say('');
 try{const {data,error}=await db.rpc('center_management_dashboard',{p_center:center});if(version!==loadVersion)return;if(error)throw error;current=data;render();}
 catch(e){if(version===loadVersion){current=null;$('dashboard').replaceChildren();fail(e);}}
 finally{if(version===loadVersion){$('dashboard').setAttribute('aria-busy','false');$('refresh').disabled=false;}}
}
function patientList(){
 const q=search.trim().toLocaleLowerCase('it-IT'),patients=current.patients.filter(p=>String(p.name||'').toLocaleLowerCase('it-IT').includes(q));
 return patients.map(p=>`<li class="patient-row"><div class="patient-info"><strong>${esc(p.name||'Paziente')}</strong><small>Associato al centro</small></div></li>`).join('')||`<li class="empty">${q?'Nessun paziente corrisponde alla ricerca.':'Nessun paziente associato. Le richieste accettate compariranno qui.'}</li>`;
}
function render(){
 const d=current;
 $('dashboard').innerHTML=`<div class="center-heading"><div><p class="eyebrow">IL TUO CENTRO</p><h1 class="center-name">${esc(d.center)}</h1></div>${d.code?`<div class="center-code"><span>Codice per i pazienti</span><strong>${esc(d.code)}</strong><button type="button" class="secondary" id="copyCode">Copia codice</button></div>`:''}</div><div class="stats"><div class="stat"><strong>${d.requests.length}</strong><span>Richieste in attesa</span></div><div class="stat"><strong>${d.patients.length}</strong><span>Pazienti associati</span></div></div><div class="tabs" role="tablist" aria-label="Gestione del centro"><button type="button" id="requestsTab" role="tab" aria-selected="${tab==='requests'}" aria-controls="requestsPanel">Richieste (${d.requests.length})</button><button type="button" id="patientsTab" role="tab" aria-selected="${tab==='patients'}" aria-controls="patientsPanel">Pazienti (${d.patients.length})</button></div><section id="requestsPanel" class="surface list-panel" role="tabpanel" aria-labelledby="requestsTab" ${tab!=='requests'?'hidden':''}><h2>Richieste da approvare</h2><p class="list-help">Il paziente viene associato dopo la tua accettazione.</p><ul class="patient-list">${d.requests.map(r=>`<li class="patient-row"><div class="patient-info"><strong>${esc(r.name||'Paziente')}</strong><small>Richiesta del ${esc(date(r.created_at))}</small></div><div class="request-actions"><button type="button" data-request="${esc(r.id)}" data-accept="true" aria-label="Accetta la richiesta di ${esc(r.name||'questo paziente')}">Accetta</button><button type="button" class="secondary" data-request="${esc(r.id)}" data-accept="false" aria-label="Rifiuta la richiesta di ${esc(r.name||'questo paziente')}">Rifiuta</button></div></li>`).join('')||'<li class="empty">Nessuna richiesta in attesa.</li>'}</ul></section><section id="patientsPanel" class="surface list-panel" role="tabpanel" aria-labelledby="patientsTab" ${tab!=='patients'?'hidden':''}><h2>Pazienti del centro</h2><label class="search-label" for="patientSearch">Cerca per nome</label><input id="patientSearch" type="search" autocomplete="off" placeholder="Nome o cognome" value="${esc(search)}"><ul class="patient-list" id="patientList">${patientList()}</ul></section>`;
 $('requestsTab').onclick=()=>selectTab('requests');$('patientsTab').onclick=()=>selectTab('patients');
 for(const name of ['requests','patients'])$(name+'Tab').onkeydown=e=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(e.key)){e.preventDefault();const next=e.key==='Home'?'requests':e.key==='End'?'patients':name==='requests'?'patients':'requests';selectTab(next);$(next+'Tab').focus();}};
 $('patientSearch').oninput=e=>{search=e.target.value;$('patientList').innerHTML=patientList();};
 if($('copyCode'))$('copyCode').onclick=async()=>{try{await navigator.clipboard.writeText(d.code);say('Codice '+d.code+' copiato. Il paziente deve accedere al proprio account e attendere l’approvazione.');}catch{say('Il codice del centro è '+d.code+'.');}};
 $('dashboard').querySelectorAll('[data-request]').forEach(b=>b.onclick=()=>respond(b));
}
function selectTab(value){tab=value;for(const name of ['requests','patients']){$(name+'Tab').setAttribute('aria-selected',String(name===tab));$(name+'Panel').hidden=name!==tab;}}
async function respond(button){
 const buttons=[...$('dashboard').querySelectorAll('[data-request]')];buttons.forEach(b=>b.disabled=true);$('refresh').disabled=true;$('center').disabled=true;const accept=button.dataset.accept==='true';say(accept?'Accettazione in corso…':'Aggiornamento della richiesta…');
 try{const {error}=await db.rpc('center_respond_patient_request',{p_request:button.dataset.request,p_accept:accept});if(error)throw error;await load();if(current)say(accept?'Paziente accettato. Lo trovi nella scheda Pazienti.':'Richiesta rifiutata.');}
 catch(e){fail(e);buttons.forEach(b=>b.disabled=false);}
 finally{$('refresh').disabled=false;$('center').disabled=false;}
}
boot().catch(fail);
