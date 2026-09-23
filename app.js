import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.116.0';

const PUBLIC_LEGAL_PARAMS=new URLSearchParams(location.search);
const PUBLIC_LEGAL_MODE=PUBLIC_LEGAL_PARAMS.has('legal');
const PUBLIC_LEGAL_KEY=PUBLIC_LEGAL_PARAMS.get('legal')||'';
const PUBLIC_LEGAL_ALLOWED=new Set(['','privacy','privacy-clinician','terms','security','retention','beta','medi-ai','ip','subprocessors']);
const PUBLIC_LEGAL_REMOTE='https://ejlhgtodmcadmdhbujkf.supabase.co/functions/v1/legal-docs';
const PUBLIC_LEGAL_PATHS={'':'/documenti','privacy':'/privacy','privacy-clinician':'/privacy-clinician','terms':'/terms','security':'/security','retention':'/retention','beta':'/beta','medi-ai':'/medi-ai','ip':'/proprieta-intellettuale','subprocessors':'/subprocessors'};

async function renderPublicLegal(key){
  if(!PUBLIC_LEGAL_ALLOWED.has(key)) key='';
  const target=PUBLIC_LEGAL_REMOTE+(key?'?doc='+encodeURIComponent(key):'');
  try{
    const response=await fetch(target,{credentials:'omit',cache:'no-store'});
    if(!response.ok) throw new Error('HTTP '+response.status);
    const parsed=new DOMParser().parseFromString(await response.text(),'text/html');
    document.title=parsed.title||'Meditaly · Documenti';
    document.head.querySelectorAll('style').forEach(x=>x.remove());
    parsed.head.querySelectorAll('style').forEach(source=>{const st=document.createElement('style');st.textContent=source.textContent;document.head.appendChild(st);});
    document.body.innerHTML=parsed.body.innerHTML;
    document.querySelectorAll('a').forEach(a=>{
      try{
        const u=new URL(a.href);
        const doc=u.searchParams.get('doc')||'';
        const isRemoteLegal=u.origin===new URL(PUBLIC_LEGAL_REMOTE).origin && u.pathname.includes('/functions/v1/legal-docs');
        const isLocalDocParam=u.origin===location.origin && u.searchParams.has('doc');
        if((isRemoteLegal||isLocalDocParam) && Object.prototype.hasOwnProperty.call(PUBLIC_LEGAL_PATHS,doc)) a.href=PUBLIC_LEGAL_PATHS[doc];
      }catch{}
    });
  }catch(e){
    document.body.innerHTML='<main style="font-family:system-ui,sans-serif;max-width:760px;margin:60px auto;padding:24px;color:#18385e"><h1>Meditaly</h1><h2>Documento temporaneamente non disponibile</h2><p>Riprova tra poco oppure contatta <a href="mailto:maiellociro@gmail.com">maiellociro@gmail.com</a>.</p></main>';
  }
}

if(PUBLIC_LEGAL_MODE){
  await renderPublicLegal(PUBLIC_LEGAL_KEY);
}else{

const SUPABASE_URL='https://ejlhgtodmcadmdhbujkf.supabase.co';
const SUPABASE_KEY='sb_publishable_QoVgKCNOTSbrXFgXdusqfA_5_OM5jwM';
const sb=createClient(SUPABASE_URL,SUPABASE_KEY);
const LEGAL_VERSION='2.1';
const $=id=>document.getElementById(id); let me=null,patients=[],selected=null;
const esc=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const fmt=d=>d?new Date(d).toLocaleString('it-IT'):'—';
const healthLabel=s=>({green:'Bene',yellow:'Così così',red:'Non sto bene'})[s]||'Nessun check-in';
const healthPill=s=>`<span class="pill health-pill ${['green','yellow','red'].includes(s)?s:'gray'}">${esc(healthLabel(s))}</span>`;
function out(el,t,ok=false){el.innerHTML='<div class="'+(ok?'ok':'err')+'">'+esc(t)+'</div>'}
function showAuthPane(register=false){
  $('loginPane').classList.toggle('hidden',register); $('registerPane').classList.toggle('hidden',!register);
  $('tabLogin').classList.toggle('on',!register); $('tabRegister').classList.toggle('on',register); $('authMsg').innerHTML='';
}
$('tabLogin').onclick=()=>showAuthPane(false); $('tabRegister').onclick=()=>showAuthPane(true);
$('togglePass').onclick=()=>{const input=$('pass');const show=input.type==='password';input.type=show?'text':'password';$('togglePass').textContent=show?'🙈':'👁';$('togglePass').setAttribute('aria-label',show?'Nascondi password':'Mostra password');input.focus();};
$('forgotPass').onclick=async()=>{const email=$('email').value.trim();if(!email)return out($('authMsg'),'Inserisci prima la tua email.');const{error}=await sb.auth.resetPasswordForEmail(email,{redirectTo:'https://ejlhgtodmcadmdhbujkf.supabase.co/functions/v1/password-reset'});if(error)return out($('authMsg'),error.message);out($('authMsg'),'Email per il ripristino password inviata.',true);};
$('registerDoctor').onclick=async()=>{const full=$('rName').value.trim(),email=$('rEmail').value.trim(),password=$('rPass').value,reg=$('rReg').value.trim();if(!full||!email||password.length<8||!reg)return out($('authMsg'),'Compila nome, email, password di almeno 8 caratteri e numero Albo.');if(!$('rPrivacy').checked||!$('rTerms').checked)return out($('authMsg'),'Completa la presa visione privacy e l’accettazione dei Termini.');localStorage.setItem('meditaly_clinician_pending_legal',JSON.stringify({version:LEGAL_VERSION}));const{error}=await sb.auth.signUp({email,password,options:{emailRedirectTo:'https://ejlhgtodmcadmdhbujkf.supabase.co/functions/v1/account-confirmed',data:{full_name:full,requested_role:'Clinician',phone:$('rPhone').value.trim(),professional_registration_no:reg,center_code:$('rCenter').value.trim(),privacy_clinician_version:LEGAL_VERSION,terms_version:LEGAL_VERSION}}});if(error)return out($('authMsg'),error.message);out($('authMsg'),'Richiesta inviata. Conferma l’email; l’amministratore dovrà poi approvare il profilo medico.',true);};

$('login').onclick=async()=>{
  out($('authMsg'),'Accesso in corso…',true);
  const{error}=await sb.auth.signInWithPassword({email:$('email').value.trim(),password:$('pass').value});
  if(error)return out($('authMsg'),error.message);
  boot();
};
$('logout').onclick=async()=>{await sb.auth.signOut();location.reload()};
async function persistClinicianLegal(){const raw=localStorage.getItem('meditaly_clinician_pending_legal');if(!raw)return;const u=(await sb.auth.getUser()).data.user;if(!u)return;try{const p=JSON.parse(raw);const rows=[{user_id:u.id,document_key:'privacy-clinician',document_version:p.version||LEGAL_VERSION,action:'acknowledged'},{user_id:u.id,document_key:'terms',document_version:p.version||LEGAL_VERSION,action:'accepted'}];const{error}=await sb.from('legal_acceptances').insert(rows);if(error)throw error;localStorage.removeItem('meditaly_clinician_pending_legal');}catch(e){console.warn('Clinician legal acceptance pending',e)}}
async function renderMfa(){
  const box=$('mfaBody');
  const{data:f,error}=await sb.auth.mfa.listFactors();
  if(error){box.innerHTML='<h2>2FA</h2><div class="err">'+esc(error.message)+'</div>';return;}
  const totp=f?.totp||[],verified=totp.find(x=>x.status==='verified'),pending=totp.find(x=>x.status!=='verified');
  if(verified){
    box.innerHTML='<h2>Verifica Google Authenticator</h2><p class="muted">Inserisci il codice a 6 cifre.</p><div class="field"><input id="otp" maxlength="6" inputmode="numeric" autocomplete="one-time-code" placeholder="000000" style="text-align:center;font-size:24px;letter-spacing:.18em"></div><button id="verifyOtp" class="btn full">Verifica</button><div id="mfaMsg"></div>';
    const input=$('otp');input.oninput=()=>input.value=input.value.replace(/\D/g,'').slice(0,6);
    $('verifyOtp').onclick=async()=>{const code=input.value.trim();if(code.length!==6)return out($('mfaMsg'),'Inserisci un codice a 6 cifre.');const{error}=await sb.auth.mfa.challengeAndVerify({factorId:verified.id,code});if(error){input.value='';input.focus();return out($('mfaMsg'),'Codice non valido o scaduto. Usa il codice corrente e riprova.');}await sb.auth.refreshSession();boot();};
    return;
  }
  if(pending){
    box.innerHTML='<h2>Completa il 2FA</h2><p class="muted">Hai già iniziato la configurazione. Apri Google Authenticator e inserisci il codice corrente.</p><div class="field"><input id="otpPending" maxlength="6" inputmode="numeric" autocomplete="one-time-code" placeholder="000000" style="text-align:center;font-size:24px;letter-spacing:.18em"></div><button id="verifyPending" class="btn full">Completa configurazione</button><button id="restartMfa" class="btn secondary full" style="margin-top:8px">Ricomincia configurazione</button><div id="mfaMsg"></div>';
    const input=$('otpPending');input.oninput=()=>input.value=input.value.replace(/\D/g,'').slice(0,6);
    $('verifyPending').onclick=async()=>{const code=input.value.trim();if(code.length!==6)return out($('mfaMsg'),'Inserisci un codice a 6 cifre.');const{error}=await sb.auth.mfa.challengeAndVerify({factorId:pending.id,code});if(error){input.value='';input.focus();return out($('mfaMsg'),'Codice non valido o scaduto. Riprova con il codice corrente.');}await sb.auth.refreshSession();boot();};
    $('restartMfa').onclick=async()=>{const{error}=await sb.auth.mfa.unenroll({factorId:pending.id});if(error)return out($('mfaMsg'),error.message);renderMfa();};
    return;
  }
  box.innerHTML='<h2>Configura Google Authenticator</h2><p class="muted">Il secondo fattore è obbligatorio per l’accesso clinico.</p><button id="enrollMfa" class="btn full">Configura 2FA</button><div id="mfaMsg"></div>';
  $('enrollMfa').onclick=async()=>{const{data,error}=await sb.auth.mfa.enroll({factorType:'totp',friendlyName:'Google Authenticator - Meditaly Clinica'});if(error)return out($('mfaMsg'),error.message);const qr=data.totp.qr_code||'',src=qr.startsWith('data:')?qr:(qr.trim().startsWith('<svg')?'data:image/svg+xml;charset=utf-8,'+encodeURIComponent(qr):qr);box.innerHTML='<h2>Scansiona il QR</h2><p class="muted">Apri Google Authenticator, aggiungi un account e poi inserisci il primo codice.</p><div style="display:grid;place-items:center;margin:14px 0"><img alt="QR 2FA" style="width:210px;height:210px;border:1px solid #dfe9ee;border-radius:16px;padding:10px;background:white" src="'+src+'"></div><div class="small muted" style="word-break:break-all;text-align:center">Chiave manuale: '+esc(data.totp.secret||'')+'</div><div class="field"><input id="otpSetup" maxlength="6" inputmode="numeric" autocomplete="one-time-code" placeholder="000000" style="text-align:center;font-size:24px;letter-spacing:.18em"></div><button id="verifySetup" class="btn full">Attiva 2FA</button><div id="mfaMsg"></div>';const input=$('otpSetup');input.oninput=()=>input.value=input.value.replace(/\D/g,'').slice(0,6);$('verifySetup').onclick=async()=>{const code=input.value.trim();if(code.length!==6)return out($('mfaMsg'),'Inserisci un codice a 6 cifre.');const{error}=await sb.auth.mfa.challengeAndVerify({factorId:data.id,code});if(error){input.value='';input.focus();return out($('mfaMsg'),'Codice non valido o scaduto. Riprova.');}await sb.auth.refreshSession();boot();};};
}

document.querySelectorAll('.nav button').forEach(b=>b.onclick=async()=>{
  document.querySelectorAll('.nav button').forEach(x=>x.classList.remove('on')); b.classList.add('on');
  document.querySelectorAll('.view').forEach(v=>v.classList.add('hidden')); $(b.dataset.view).classList.remove('hidden');
  if(b.dataset.view==='appointments') await loadAppointments();
  if(b.dataset.view==='delivery')loadDelivery();
  if(b.dataset.view==='admin')loadAdmin();
  if(b.dataset.view==='testDoctor')loadTestDoctor();
});

async function boot(){
  const{data:{user}}=await sb.auth.getUser(); if(!user)return; await persistClinicianLegal();
  const{data:p,error}=await sb.from('profiles').select('*').eq('id',user.id).single();
  if(error)return out($('authMsg'),error.message); me=p;
  if(!me||!['Clinician','Administrator'].includes(me.role))return out($('authMsg'),'Account non abilitato come medico.');
  $('adminNav').classList.toggle('hidden',me.role!=='Administrator');
  $('testDoctorNav').classList.toggle('hidden',me.role!=='Administrator');
  $('auth').classList.add('hidden');$('mfa').classList.add('hidden');$('portal').classList.remove('hidden');$('logout').classList.remove('hidden');
  await loadPatients(); await Promise.all([loadOverview(),loadProtocols(),loadRequests(),loadDirectoryProfile()]);
}

const deliveryLabel={sent:'Accettata da FCM',failed:'Invio fallito',pending:'In coda',read:'Letta nell’app',unknown:'Registrata nell’app'};
const deliveryStatus=(notice,outcomes)=>{
  if(notice.is_read)return 'read';
  if(outcomes.some(x=>x.status==='sent'))return 'sent';
  if(outcomes.some(x=>x.status==='pending'))return 'pending';
  if(outcomes.length&&outcomes.every(x=>x.status==='failed'))return 'failed';
  return 'unknown';
};
async function loadDelivery(){
  const list=$('deliveryList');if(!list||!me)return;
  list.innerHTML='<p class="muted">Caricamento esiti…</p>';
  const ids=patients.map(p=>p.patient_id);
  if(!ids.length){list.innerHTML='<p class="muted">Nessun paziente assegnato.</p>';return;}
  const {data:rows,error}=await sb.from('notifications')
    .select('id,patient_id,title,notification_type,created_at,sent_at,is_read,read_at')
    .eq('sender_id',me.id).in('patient_id',ids).order('created_at',{ascending:false}).limit(100);
  if(error){out(list,'Impossibile leggere le notifiche: '+error.message);return;}
  const notices=rows||[];const {data:outcomes,error:outcomeError}=notices.length
    ?await sb.from('push_outbox').select('id,user_id,notification_id,status,created_at,sent_at').in('notification_id',notices.map(n=>n.id))
    :{data:[],error:null};
  if(outcomeError){out(list,'Impossibile leggere gli esiti push: '+outcomeError.message);return;}
  const byNotice=new Map();for(const row of outcomes||[]){if(!byNotice.has(row.notification_id))byNotice.set(row.notification_id,[]);byNotice.get(row.notification_id).push(row);}
  const names=new Map(patients.map(p=>[p.patient_id,p.profile?.full_name||'Paziente']));
  const filter=$('deliveryFilter'),prev=filter.value,search=$('deliverySearch'),chips=$('deliveryChips');
  filter.innerHTML='<option value="">Tutti i pazienti</option>'+patients.map(p=>`<option value="${esc(p.patient_id)}">${esc(names.get(p.patient_id))}</option>`).join('');
  filter.value=ids.includes(prev)?prev:'';
  const states=[['all','Tutte'],['unknown','Registrate'],['pending','In coda'],['sent','FCM'],['read','Lette'],['failed','Fallite']];
  const previousStatus=chips.querySelector('button.on')?.dataset.status||'all';
  chips.innerHTML=states.map(([key,label])=>`<button type="button" data-status="${key}" class="${previousStatus===key?'on':''}"></button>`).join('');
  chips.querySelectorAll('button').forEach((button,index)=>button.textContent=states[index][1]);
  const enhanced=notices.map(n=>({...n,delivery:deliveryStatus(n,byNotice.get(n.id)||[])}));
  const draw=()=>{
    const base=enhanced.filter(n=>!filter.value||n.patient_id===filter.value);
    const counts=Object.fromEntries(states.map(([key])=>[key,key==='all'?base.length:base.filter(n=>n.delivery===key).length]));
    chips.querySelectorAll('button').forEach(b=>{b.textContent=`${states.find(x=>x[0]===b.dataset.status)[1]} · ${counts[b.dataset.status]}`;b.setAttribute('aria-pressed',b.classList.contains('on')?'true':'false');});
    const active=chips.querySelector('button.on')?.dataset.status||'all',query=search.value.trim().toLocaleLowerCase('it');
    const shown=base.filter(n=>(active==='all'||n.delivery===active)&&(!query||[n.title,names.get(n.patient_id),n.notification_type].some(s=>String(s||'').toLocaleLowerCase('it').includes(query))));
    $('deliverySummary').textContent=`${shown.length} di ${base.length} comunicazioni mostrate (ultime 100 inviate).`;
    list.innerHTML=shown.map(n=>{
      const history=byNotice.get(n.id)||[],sent=history.find(x=>x.status==='sent'),status=n.delivery;
      const when=sent?.sent_at?`FCM: ${fmt(sent.sent_at)}`:status==='failed'?'FCM: invio fallito':'FCM: non confermato';
      return `<div class="delivery-item delivery-grid"><div><strong>${esc(n.title)}</strong><div class="delivery-meta">${esc(names.get(n.patient_id))} · ${esc(n.notification_type)} · ${fmt(n.created_at)}</div></div><span class="delivery-status ${status}">${deliveryLabel[status]}</span><span class="delivery-meta">${esc(when)}${n.read_at?`<br>Lettura: ${fmt(n.read_at)}`:''}</span><button class="btn secondary delivery-open" data-patient="${esc(n.patient_id)}">Apri paziente</button></div>`;
    }).join('')||'<p class="muted">Nessuna comunicazione con questi filtri.</p>';
    list.querySelectorAll('.delivery-open').forEach(b=>b.onclick=()=>{document.querySelector('[data-view="patients"]').click();openPatient(b.dataset.patient)});
  };
  filter.onchange=draw;search.oninput=draw;
  chips.querySelectorAll('button').forEach(b=>b.onclick=()=>{chips.querySelectorAll('button').forEach(x=>x.classList.remove('on'));b.classList.add('on');draw();});
  $('composeDelivery').onclick=async()=>{
    const id=filter.value||(ids.length===1?ids[0]:null);
    document.querySelector('[data-view="patients"]').click();
    if(!id){$('patientSearch')?.focus();return;}
    await openPatient(id);document.querySelector('#patientDetail [data-tab="chat"]')?.click();$('noticeTitle')?.focus();
  };
  draw();
}
$('refreshDelivery').onclick=loadDelivery;

async function loadAdmin(){
  const box=$('adminContent');if(!box||me?.role!=='Administrator')return;
  box.innerHTML='<p class="muted">Caricamento…</p>';
  const [a,u,c]=await Promise.all([
    sb.from('clinician_applications').select('id,full_name,professional_registration_no,status,created_at').order('created_at',{ascending:false}).limit(100),
    sb.from('profiles').select('id,full_name,role,account_active').order('created_at',{ascending:false}).limit(200),
    sb.from('patient_clinicians').select('patient_id,clinician_id,active').eq('active',true).limit(200)
  ]);
  if(a.error||u.error||c.error){out(box,[a.error,u.error,c.error].filter(Boolean).map(e=>e.message).join('; '));return;}
  const people=u.data||[],name=id=>people.find(x=>x.id===id)?.full_name||id;
  box.innerHTML=`<h3>Richieste medico</h3><div class="list">${(a.data||[]).map(x=>`<div class="item"><b>${esc(x.full_name)}</b> · Albo ${esc(x.professional_registration_no)} · ${esc(x.status)}<div class="muted small">${fmt(x.created_at)}</div>${x.status==='Pending'?`<button class="btn admin-review" data-id="${x.id}" data-approve="true">Approva</button> <button class="btn secondary admin-review" data-id="${x.id}" data-approve="false">Rifiuta</button>`:''}</div>`).join('')||'Nessuna richiesta.'}</div><h3>Account</h3><div class="list">${people.map(x=>`<div class="item"><b>${esc(x.full_name||'Utente')}</b> · ${esc(x.role)} · ${x.account_active?'Attivo':'Sospeso'}${x.id!==me.id?` <button class="btn secondary admin-account" data-id="${x.id}" data-active="${!x.account_active}">${x.account_active?'Sospendi':'Riattiva'}</button>`:''}</div>`).join('')}</div><h3>Assegnazioni attive</h3><div class="list">${(c.data||[]).map(x=>`<div class="item">${esc(name(x.patient_id))} → ${esc(name(x.clinician_id))}</div>`).join('')||'Nessuna assegnazione.'}</div>`;
  box.querySelectorAll('.admin-review').forEach(b=>b.onclick=async()=>{if(!confirm(b.dataset.approve==='true'?'Approvare questa richiesta medico?':'Rifiutare questa richiesta medico?'))return;const {error}=await sb.rpc('admin_review_clinician_application',{p_application:b.dataset.id,p_approve:b.dataset.approve==='true'});if(error)alert(error.message);else loadAdmin();});
  box.querySelectorAll('.admin-account').forEach(b=>b.onclick=async()=>{if(!confirm('Confermare la modifica dello stato account?'))return;const {error}=await sb.rpc('admin_set_account_active',{p_user:b.dataset.id,p_active:b.dataset.active==='true'});if(error)alert(error.message);else loadAdmin();});
}

async function loadTestDoctor(){
  const box=$('testDoctorContent');if(!box||me?.role!=='Administrator')return;
  box.innerHTML='<p class="muted">Caricamento collegamenti di prova…</p>';
  const {data:contacts,error}=await sb.from('patient_care_contacts')
    .select('patient_id,initial_choice,choice_completed_at')
    .eq('test_support_admin_id',me.id).order('updated_at',{ascending:false});
  if(error)return out(box,error.message);
  const ids=(contacts||[]).map(x=>x.patient_id);
  const {data:profiles,error:profileError}=ids.length?await sb.from('profiles').select('id,full_name').in('id',ids):{data:[],error:null};
  if(profileError)return out(box,profileError.message);
  const names=new Map((profiles||[]).map(x=>[x.id,x.full_name||'Paziente']));
  const selected=(contacts||[]).filter(x=>x.initial_choice==='test');
  box.innerHTML=`<div class="row between"><p><strong>${selected.length}</strong> pazienti in modalità Test Medico · <strong>${ids.length}</strong> collegati al contatto test.</p><button id="refreshTestDoctor" class="btn secondary">Aggiorna</button></div><div class="list">${selected.map(x=>`<div class="item"><b>${esc(names.get(x.patient_id)||'Paziente')}</b><div class="small muted">Modalità test scelta il ${fmt(x.choice_completed_at)} · Nessuna prescrizione abilitata</div><button class="btn secondary test-patient-open" data-id="${x.patient_id}">Vedi percorso</button></div>`).join('')||'<p class="muted">Nessun paziente ha scelto la modalità test.</p>'}</div><div id="testPatientDetail" class="section"></div>`;
  $('refreshTestDoctor').onclick=loadTestDoctor;
  box.querySelectorAll('.test-patient-open').forEach(b=>b.onclick=async()=>{
    const id=b.dataset.id,detail=$('testPatientDetail');if(!selected.some(x=>x.patient_id===id))return;
    detail.innerHTML='<p class="muted">Caricamento percorso…</p>';
    const [checkins,meds,followups,intakes,conversation]=await Promise.all([
      sb.from('patient_daily_checkins').select('status,checkin_date,submitted_at').eq('patient_id',id).order('checkin_date',{ascending:false}).limit(7),
      sb.from('medications').select('name,dose,active,medication_schedules(time_of_day)').eq('patient_id',id).order('created_at',{ascending:false}).limit(25),
      sb.from('followup_milestones').select('milestone_label,due_date,completed').eq('patient_id',id).order('due_date').limit(20),
      sb.from('medication_intakes').select('status,intake_date').eq('patient_id',id).eq('intake_date',new Date().toLocaleDateString('en-CA',{timeZone:'Europe/Rome'})),
      sb.from('chat_messages').select('sender_id,recipient_id,body,sent_at,is_read').or(`and(sender_id.eq.${me.id},recipient_id.eq.${id}),and(sender_id.eq.${id},recipient_id.eq.${me.id})`).order('sent_at',{ascending:false}).limit(50)
    ]);
    const err=[checkins,meds,followups,intakes,conversation].find(x=>x.error)?.error;if(err)return out(detail,err.message);
    const taken=(intakes.data||[]).filter(x=>x.status==='taken').length;
    detail.innerHTML=`<div class="card"><h3>${esc(names.get(id)||'Paziente')} · percorso in sola lettura</h3><p>Assunzioni confermate oggi: <strong>${taken}</strong> di ${(intakes.data||[]).length} registrate</p><h4>Check-in</h4>${(checkins.data||[]).map(x=>`<div class="item">${healthPill(x.status)} ${esc(x.checkin_date)}</div>`).join('')||'Nessun check-in.'}<h4>Terapie</h4>${(meds.data||[]).map(x=>`<div class="item"><b>${esc(x.name)} ${esc(x.dose||'')}</b> · ${x.active?'Attiva':'Conclusa'}<div class="muted small">${(x.medication_schedules||[]).map(s=>esc(s.time_of_day?.slice(0,5))).join(', ')}</div></div>`).join('')||'Nessuna terapia.'}<h4>Controlli</h4>${(followups.data||[]).map(x=>`<div class="item">${esc(x.milestone_label)} · ${fmt(x.due_date)} · ${x.completed?'Completato':'Da effettuare'}</div>`).join('')||'Nessun controllo.'}</div><div class="card"><h3>Messaggi di prova</h3><p class="notice">Conversazione con il paziente in modalità Test Medico. Non usarla per prescrizioni o urgenze.</p><div class="list">${(conversation.data||[]).reverse().map(m=>`<div class="item"><b>${m.sender_id===me.id?'Tu':'Paziente'}</b> · ${fmt(m.sent_at)}<div>${esc(m.body)}</div></div>`).join('')||'<p class="muted">Nessun messaggio.</p>'}</div><label class="field"><span>Rispondi</span><textarea id="testChatBody" maxlength="4000" placeholder="Scrivi al paziente"></textarea></label><button id="testChatSend" class="btn">Invia messaggio</button><div id="testChatResult" aria-live="polite"></div></div>`;
    $('testChatSend').onclick=async()=>{const body=$('testChatBody').value.trim();if(!body)return out($('testChatResult'),'Scrivi un messaggio.');$('testChatSend').disabled=true;const {error}=await sb.from('chat_messages').insert({sender_id:me.id,recipient_id:id,body});if(error){out($('testChatResult'),error.message);$('testChatSend').disabled=false;}else b.click();};
  });
}

async function loadPatients(){
  const uid=(await sb.auth.getUser()).data.user.id;
  const{data:a,error}=await sb.from('patient_clinicians').select('patient_id').eq('clinician_id',uid).eq('active',true);
  if(error){console.error(error);return;}
  const ids=(a||[]).map(x=>x.patient_id);
  if(!ids.length){patients=[];renderPatients();return;}
  const[{data:pp},{data:ci}]=await Promise.all([
    sb.from('profiles').select('id,full_name,date_of_birth,phone').in('id',ids),
    sb.from('patient_daily_checkins').select('*').in('patient_id',ids).order('submitted_at',{ascending:false})
  ]);
  patients=ids.map(id=>({patient_id:id,profile:(pp||[]).find(p=>p.id===id),latest:(ci||[]).find(c=>c.patient_id===id)}));
  renderPatients();
}

function renderPatients(){
  const q=($('patientSearch')?.value||'').toLowerCase();
  $('patientList').innerHTML=patients.filter(x=>(x.profile?.full_name||'').toLowerCase().includes(q)).map(x=>
    '<div class="patient row" data-id="'+x.patient_id+'">'+healthPill(x.latest?.status)+'<div class="patient-main"><b>'+esc(x.profile?.full_name||'Paziente')+'</b><div class="small muted">'+(x.latest?'Ultimo check-in: '+esc(healthLabel(x.latest.status))+' · '+fmt(x.latest.submitted_at):'Nessun check-in')+'</div></div><div class="patient-quick"><button type="button" data-action="notice">Notifica</button><button type="button" data-action="file">File</button><button type="button" data-action="message">Messaggio</button></div><span class="right">›</span></div>'
  ).join('')||'<p class="muted">Nessun paziente assegnato.</p>';
  document.querySelectorAll('.patient[data-id]').forEach(x=>x.onclick=()=>openPatient(x.dataset.id));
  document.querySelectorAll('.patient-quick [data-action]').forEach(b=>b.onclick=async e=>{e.stopPropagation();const row=b.closest('.patient'),id=row?.dataset.id,action=b.dataset.action;if(!id)return;if(action==='file')return sendPatientFile(id);await openPatient(id);document.querySelector('#patientDetail [data-tab="chat"]')?.click();setTimeout(()=>{const target=action==='message'?$('chatText'):$('noticeTitle');target?.focus();target?.scrollIntoView({behavior:'smooth',block:'center'});},60);});
}

async function sendPatientFile(id){
  const input=document.createElement('input');input.type='file';input.accept='.pdf,image/*,application/pdf';
  input.onchange=async()=>{const file=input.files?.[0];if(!file)return;const title=prompt('Titolo del documento',file.name.replace(/\\.[^.]+$/,''));if(!title)return;const safe=file.name.replace(/[^a-zA-Z0-9._-]/g,'_');const path=id+'/clinician/'+Date.now()+'_'+safe;const reportId=crypto.randomUUID();
    try{
      const up=await sb.storage.from('medical-reports').upload(path,file,{contentType:file.type||'application/octet-stream',upsert:false});if(up.error)throw up.error;
      const report=await sb.from('medical_reports').insert({id:reportId,patient_id:id,title,report_type:'Documento del medico',report_date:new Date().toLocaleDateString('en-CA',{timeZone:'Europe/Rome'}),storage_path:path,mime_type:file.type||'application/octet-stream',file_size_bytes:file.size,notes:'Documento inviato dal medico tramite dashboard Meditaly.'});if(report.error){await sb.storage.from('medical-reports').remove([path]);throw report.error;}
      const detail=await sb.from('medical_report_files').insert({report_id:reportId,patient_id:id,page_number:1,storage_path:path,mime_type:file.type||'application/octet-stream',file_size_bytes:file.size});if(detail.error){await sb.storage.from('medical-reports').remove([path]);throw detail.error;}
      const notice=await sb.rpc('clinician_send_patient_notice',{p_patient:id,p_title:'Nuovo documento dal medico',p_message:'Il tuo medico ha condiviso un nuovo documento. Apri la sezione Referti di Meditaly.',p_kind:'Custom Message'});if(!notice.error&&notice.data)await dispatch(notice.data);
      alert('File inviato al paziente e archiviato nei Referti.');
    }catch(e){alert(e.message||'Invio file non riuscito.');}
  };input.click();
}
$('patientSearch').oninput=renderPatients;

async function loadOverview(){
  $('kPatients').textContent=patients.length;
  const today=new Date().toLocaleDateString('en-CA',{timeZone:'Europe/Rome'});
  const ids=patients.map(x=>x.patient_id); if(!ids.length)return;
  const[{data:c},{count:m}]=await Promise.all([
    sb.from('patient_daily_checkins').select('*').in('patient_id',ids).eq('checkin_date',today).order('submitted_at',{ascending:false}),
    sb.from('chat_messages').select('*',{count:'exact',head:true}).eq('recipient_id',(await sb.auth.getUser()).data.user.id).eq('is_read',false)
  ]);
  const latest=[]; for(const x of c||[]) if(!latest.some(y=>y.patient_id===x.patient_id)) latest.push(x);
  $('kRed').textContent=latest.filter(x=>x.status==='red').length;
  $('kYellow').textContent=latest.filter(x=>x.status==='yellow').length;
  $('kMsg').textContent=m||0;
  const att=latest.filter(x=>x.status!=='green');
  $('attentionList').innerHTML=att.map(x=>{const p=patients.find(y=>y.patient_id===x.patient_id)?.profile;return '<div class="patient '+(x.status==='red'?'attention':'warn')+'" data-id="'+x.patient_id+'"><div class="row">'+healthPill(x.status)+'<b>'+esc(p?.full_name||'Paziente')+'</b><span class="pill">'+esc(x.status==='red'?'Richiede attenzione':'Da verificare')+'</span></div><div class="small muted">'+esc((x.reasons||[]).join(', ')||x.note||'Nessun dettaglio')+' · '+fmt(x.submitted_at)+'</div></div>'}).join('')||'<p class="muted">Nessuna segnalazione gialla o rossa oggi.</p>';
  document.querySelectorAll('#attentionList [data-id]').forEach(x=>x.onclick=()=>{document.querySelector('[data-view="patients"]').click();openPatient(x.dataset.id)});
}

async function openPatient(id){
  selected=id; const p=patients.find(x=>x.patient_id===id)?.profile;
  const[daily,meds,fu,msgs,setts,protos,imports,intakes]=await Promise.all([
    sb.from('patient_daily_checkins').select('*').eq('patient_id',id).order('checkin_date',{ascending:false}).limit(14),
    sb.from('medications').select('*,medication_schedules(*)').eq('patient_id',id).order('created_at',{ascending:false}),
    sb.from('followup_milestones').select('*').eq('patient_id',id).order('due_date'),
    sb.from('chat_messages').select('*').or('sender_id.eq.'+id+',recipient_id.eq.'+id).order('sent_at'),
    sb.from('patient_monitoring_settings').select('*').eq('patient_id',id).eq('clinician_id',(await sb.auth.getUser()).data.user.id).maybeSingle(),
    sb.from('monitoring_protocols').select('*').eq('clinician_id',(await sb.auth.getUser()).data.user.id).eq('is_active',true),
    sb.from('patient_care_imports').select('*').eq('patient_id',id).order('created_at',{ascending:false}),
    sb.from('medication_intakes').select('medication_schedule_id,intake_date,status').eq('patient_id',id).eq('intake_date',new Date().toLocaleDateString('en-CA',{timeZone:'Europe/Rome'}))
  ]);
  const latest=daily.data?.[0];
  $('patientDetail').innerHTML=`<div class="card">
    <div class="row between"><div><h2>${esc(p?.full_name||'Paziente')}</h2><div class="muted small">${esc(p?.phone||'')} ${p?.date_of_birth?'· '+esc(p.date_of_birth):''}</div></div><div class="row">${healthPill(latest?.status)}</div></div>
    <div class="tabs"><button class="on" data-tab="summary">Monitoraggio</button><button data-tab="therapy">Terapie</button><button data-tab="controls">Controlli</button><button data-tab="chat">Messaggi</button><button data-tab="patientimports">Invii paziente</button><button data-tab="settings">Protocollo</button></div>
    <div id="summary" class="tabp"><h3>Ultimi check-in</h3><div class="table-like">${(daily.data||[]).map(x=>'<div class="item"><div class="row">'+healthPill(x.status)+'<b>'+esc(x.checkin_date)+'</b></div><div class="small muted">'+esc((x.reasons||[]).join(', ')||x.note||'Nessun dettaglio')+'</div></div>').join('')||'<p class="muted">Nessun check-in.</p>'}</div></div>
    <div id="therapy" class="tabp hidden"><div class="two"><div><h3>Nuova terapia</h3><div class="field" style="position:relative"><label>Farmaco</label><input id="medName" autocomplete="off" placeholder="Cerca per nome, principio attivo o AIC..."><div id="medCatalogResults" class="hidden" style="position:absolute;z-index:30;left:0;right:0;top:100%;background:#fff;border:1px solid #dfe9ee;border-radius:12px;box-shadow:0 12px 30px rgba(15,52,66,.14);max-height:260px;overflow:auto"></div><div class="small muted" style="margin-top:6px">Ricerca su Anagrafica Farmaci AIFA · seleziona il medicinale, poi indica dose e modalità.</div></div><div class="field"><label>Dose</label><input id="medDose"></div><div class="field"><label>Via</label><input id="medRoute" value="Orale"></div><div class="field"><label>Istruzioni</label><textarea id="medInstr" rows="2"></textarea></div><div class="two"><div class="field"><label>Inizio</label><input id="medStart" type="date"></div><div class="field"><label>Fine</label><input id="medEnd" type="date"></div></div><div class="field"><label>Orari giornalieri</label><input id="medTimes" placeholder="08:00,20:00"></div><button id="saveMed" class="btn">Salva terapia</button><p class="muted small">Gli orari registrati attivano i promemoria locali nell’app e il riepilogo serale.</p><div id="medMsg"></div></div><div><h3>Terapie attuali</h3><div class="table-like">${(meds.data||[]).map(m=>'<div class="item"><b>'+esc(m.name)+' '+esc(m.dose||'')+'</b><div class="small muted">'+esc(m.route||'')+' · '+((m.medication_schedules||[]).map(s=>s.time_of_day?.slice(0,5)).filter(Boolean).join(', ')||'nessun orario')+' · '+(m.active?'Attiva':'Conclusa')+'</div></div>').join('')||'<p class="muted">Nessuna terapia.</p>'}</div></div><div class="card section"><h3>Assunzioni confermate oggi</h3><div class="table-like">${(meds.data||[]).flatMap(m=>(m.medication_schedules||[]).map(sc=>({m,sc}))).map(({m,sc})=>`<div class="item">${esc(sc.time_of_day?.slice(0,5)||'—')} · ${esc(m.name)}: ${esc((intakes.data||[]).find(x=>x.medication_schedule_id===sc.id)?.status==='taken'?'Assunto':(intakes.data||[]).find(x=>x.medication_schedule_id===sc.id)?.status==='skipped'?'Non assunto':'Non confermato')}</div>`).join('')||'Nessun orario previsto.'}</div></div></div>
    <div id="controls" class="tabp hidden"><div class="two"><div><h3>Nuovo controllo</h3><div class="field"><label>Titolo</label><input id="fuLabel"></div><div class="field"><label>Tipo</label><input id="fuType" value="visita"></div><div class="field"><label>Data</label><input id="fuDate" type="date"></div><div class="field"><label>Promemoria giorni prima</label><input id="fuOffsets" value="${esc((setts.data?.followup_reminder_offsets||[7,1,0]).join(','))}"></div><div class="field"><label>Note</label><textarea id="fuNotes" rows="2"></textarea></div><button id="saveFu" class="btn">Programma controllo</button><div id="fuMsg"></div></div><div><h3>Calendario</h3><div class="table-like">${(fu.data||[]).map(x=>'<div class="item"><b>'+esc(x.milestone_label)+'</b><div class="small muted">'+esc(x.due_date)+' · '+esc(x.milestone_type)+' · '+(x.completed?'Completato':'Da fare')+'</div></div>').join('')||'<p class="muted">Nessun controllo.</p>'}</div></div></div></div>
    <div id="chat" class="tabp hidden"><div class="two"><div><h3>Conversazione</h3><div id="chatBox" class="msgbox">${(msgs.data||[]).map(x=>'<div class="msg '+(x.sender_id===me.id?'mine':'')+'">'+esc(x.body)+'<div class="small muted">'+fmt(x.sent_at)+'</div></div>').join('')}</div><div class="field"><textarea id="chatText" rows="2" placeholder="Scrivi un messaggio..."></textarea></div><button id="sendChat" class="btn">Invia messaggio</button></div><div><h3>Notifica immediata</h3><p class="muted small">Sul lock screen viene mostrata solo una comunicazione generica Meditaly.</p><div class="field"><label>Titolo interno</label><input id="noticeTitle" value="Il medico vuole contattarti"></div><div class="field"><label>Messaggio nell'app</label><textarea id="noticeBody" rows="3">Apri Meditaly per una nuova comunicazione del tuo medico.</textarea></div><button id="sendNotice" class="btn">Invia notifica</button><div id="noticeMsg"></div></div></div></div>
    <div id="patientimports" class="tabp hidden"><h3>Invii del paziente</h3><p class="muted small">Controlla sempre i dati prima di confermare. Una foto/OCR può contenere errori.</p><div class="table-like">${(imports.data||[]).map(x=>`<div class="item"><div class="row"><b>${esc(x.title)}</b><span class="pill">${esc(x.item_type)}</span><span class="pill">${esc(x.status)}</span></div><div class="small muted">${esc(x.source_type)} · ${fmt(x.created_at)}</div>${x.ocr_text?`<details><summary>Testo riconosciuto</summary><div class="small">${esc(x.ocr_text)}</div></details>`:''}${x.storage_path?`<button class="btn secondary preview-import" data-path="${esc(x.storage_path)}" style="margin-top:10px">Apri foto/documento</button>`:''}${x.status==='Pending'?`<div class="row" style="margin-top:10px"><button class="btn confirm-import" data-import="${x.id}" data-type="${x.item_type}">Conferma</button><button class="btn danger reject-import" data-import="${x.id}">Rifiuta</button></div>`:''}</div>`).join('')||'<p class="muted">Nessun invio.</p>'}</div></div>
    <div id="settings" class="tabp hidden"><h3>Livello di monitoraggio</h3><div class="two"><div><div class="field"><label>Protocollo</label><select id="patientProtocol"><option value="">Personalizzato</option>${(protos.data||[]).map(x=>'<option value="'+x.id+'" '+(setts.data?.protocol_id===x.id?'selected':'')+'>'+esc(x.name)+'</option>').join('')}</select></div><div class="row"><button id="applyProto" class="btn secondary">Applica protocollo</button><button id="openProtocols" class="btn secondary">Gestisci protocolli</button></div><div class="quick-protocol-create"><label>Nuovo protocollo rapido</label><div class="row"><input id="patientNewProtocolName" placeholder="Nome del protocollo"><button id="createPatientProtocol" class="btn">Aggiungi</button></div><div class="small muted">Crea un modello base; potrai completarlo nella sezione Protocolli.</div></div></div><div><div class="field"><label>Ora check-in</label><input id="setTime" type="time" value="${esc((setts.data?.checkin_time||'09:00').slice(0,5))}"></div><div class="row"><label><input id="setYellow" type="checkbox" ${setts.data?.alert_on_yellow?'checked':''}> Evidenzia giallo</label><label><input id="setRed" type="checkbox" ${setts.data?.alert_on_red!==false?'checked':''}> Evidenzia rosso</label></div><button id="saveSettings" class="btn" style="margin-top:12px">Salva personalizzazione</button><div id="setMsg"></div></div></div></div>
  </div>`;
  $('patientDetail').classList.remove('hidden');
  document.querySelectorAll('#patientDetail [data-tab]').forEach(b=>b.onclick=()=>{document.querySelectorAll('#patientDetail [data-tab]').forEach(x=>x.classList.remove('on'));b.classList.add('on');document.querySelectorAll('#patientDetail .tabp').forEach(x=>x.classList.add('hidden'));$(b.dataset.tab).classList.remove('hidden')});
  // Ricerca farmaci AIFA: menu a tendina con ricerca, solo supporto anagrafico.
  const medInput=$('medName'), medResults=$('medCatalogResults');
  let medSearchTimer=null, medAbort=null;
  function closeMedResults(){medResults.classList.add('hidden');medResults.innerHTML='';}
  medInput.addEventListener('input',()=>{
    clearTimeout(medSearchTimer);
    const q=medInput.value.trim();
    if(q.length<2){closeMedResults();return;}
    medSearchTimer=setTimeout(async()=>{
      try{
        if(medAbort)medAbort.abort();
        medAbort=new AbortController();
        medResults.classList.remove('hidden');
        medResults.innerHTML='<div class="item small muted">Ricerca AIFA…</div>';
        const s=(await sb.auth.getSession()).data.session;
        if(!s){closeMedResults();return;}
        const r=await fetch(SUPABASE_URL+'/functions/v1/drug-catalog?q='+encodeURIComponent(q),{
          headers:{'Authorization':'Bearer '+s.access_token},
          signal:medAbort.signal
        });
        const j=await r.json();
        if(!r.ok)throw new Error(j.error||'Ricerca non disponibile');
        const items=j.items||[];
        medResults.innerHTML=items.map((x,i)=>{
          const active=x.active||'Principio attivo non indicato';
          const form=x.form||'Forma non indicata';
          const aic=x.aic?'AIC '+x.aic:'AIC non indicato';
          const pack=x.pack||'';
          const company=x.company||'';
          return '<button type="button" class="aifa-drug" data-i="'+i+'" style="display:block;width:100%;text-align:left;border:0;border-bottom:1px solid #edf3f6;background:#fff;padding:12px;cursor:pointer">'+
            '<div style="font-weight:700;font-size:15px;color:#102f3a">'+esc(x.name)+'</div>'+
            '<div class="small" style="margin-top:4px;color:#365963"><b>Principio attivo:</b> '+esc(active)+'</div>'+
            '<div class="small muted" style="margin-top:2px">'+esc(form)+' · '+esc(aic)+'</div>'+
            (pack?'<div class="small muted" style="margin-top:2px">'+esc(pack)+'</div>':'')+
            (company?'<div class="small muted" style="margin-top:2px">Titolare: '+esc(company)+'</div>':'')+
          '</button>';
        }).join('')||'<div class="item small muted">Nessun medicinale trovato.</div>';
        document.querySelectorAll('.aifa-drug').forEach(b=>b.onclick=()=>{
          const x=items[Number(b.dataset.i)];
          if(!x)return;
          medInput.value=x.name;
          medInput.dataset.aic=x.aic||'';
          medInput.dataset.atc=x.atc||'';
          closeMedResults();
        });
      }catch(e){
        if(e.name==='AbortError')return;
        medResults.classList.remove('hidden');
        medResults.innerHTML='<div class="item small err">'+esc(e.message||'Ricerca AIFA non disponibile')+'</div>';
      }
    },280);
  });
  medInput.addEventListener('focus',()=>{if(medResults.innerHTML)medResults.classList.remove('hidden')});
  document.addEventListener('click',e=>{if(!medInput.contains(e.target)&&!medResults.contains(e.target))closeMedResults()});

  $('saveMed').onclick=async()=>{
    const name=$('medName').value.trim(),rawTimes=$('medTimes').value.trim(),times=rawTimes.split(',').map(x=>x.trim()); if(!name||!rawTimes||times.some(t=>!/^([01]\d|2[0-3]):[0-5]\d$/.test(t))||new Set(times).size!==times.length)return out($('medMsg'),'Inserisci farmaco e orari HH:MM validi, separati da virgole e senza duplicati.');
    const uid=(await sb.auth.getUser()).data.user.id;
    const{data:m,error}=await sb.from('medications').insert({patient_id:id,prescribed_by:uid,name,dose:$('medDose').value.trim(),route:$('medRoute').value.trim(),instructions:$('medInstr').value.trim(),starts_on:$('medStart').value||null,ends_on:$('medEnd').value||null,active:true}).select().single();
    if(error)return out($('medMsg'),error.message);
    if(times.length){const rows=times.map(t=>({medication_id:m.id,time_of_day:t,weekdays:[0,1,2,3,4,5,6]}));const e=await sb.from('medication_schedules').insert(rows);if(e.error)return out($('medMsg'),'Farmaco creato, ma gli orari non sono stati salvati: '+e.error.message+'; verifica il piano prima di avvisare il paziente.')}
    out($('medMsg'),'Terapia salvata.',true);setTimeout(()=>openPatient(id),500);
  };
  $('saveFu').onclick=async()=>{
    const label=$('fuLabel').value.trim(),date=$('fuDate').value; if(!label||!date)return out($('fuMsg'),'Titolo e data sono obbligatori.');
    const offsets=$('fuOffsets').value.split(',').map(Number).filter(Number.isFinite);
    const{error}=await sb.from('followup_milestones').insert({patient_id:id,milestone_label:label,milestone_type:$('fuType').value.trim()||'visita',due_date:date,notes:$('fuNotes').value.trim(),created_by:(await sb.auth.getUser()).data.user.id,reminder_offsets:offsets,notifications_enabled:true});
    if(error)return out($('fuMsg'),error.message);out($('fuMsg'),'Controllo programmato.',true);setTimeout(()=>openPatient(id),500);
  };
  $('sendChat').onclick=async()=>{
    const body=$('chatText').value.trim(); if(!body)return;
    const button=$('sendChat');button.disabled=true;
    const{data:outboxId,error}=await sb.rpc('clinician_send_message_push',{p_patient:id,p_body:body});
    if(error){button.disabled=false;return alert(error.message);}
    const ok=await dispatch(outboxId);await openPatient(id);
    document.querySelector('#patientDetail [data-tab="chat"]')?.click();
    if(!ok)out($('noticeMsg'),'Messaggio registrato nell’app; push non confermata. Controlla Notifiche inviate.');
  };
  $('sendNotice').onclick=async()=>{
    const title=$('noticeTitle').value.trim(),body=$('noticeBody').value.trim(),button=$('sendNotice');
    if(!title||!body)return out($('noticeMsg'),'Inserisci titolo e messaggio prima dell’invio.');
    button.disabled=true;button.textContent='Invio in corso…';
    try{
      const{data:outboxId,error}=await sb.rpc('clinician_send_patient_notice',{p_patient:id,p_title:title,p_message:body,p_kind:'Custom Message'});
      if(error)return out($('noticeMsg'),error.message);
      const ok=await dispatch(outboxId);
      out($('noticeMsg'),ok?'Registrata nell’app; accettata da FCM. La lettura del paziente è da verificare.':'Registrata nell’app; invio push non confermato. Controlla il registro.',ok);
    }catch(e){out($('noticeMsg'),e.message||'Impossibile completare l’invio.');}
    finally{button.disabled=false;button.textContent='Invia notifica';}
  };
  $('openProtocols').onclick=()=>document.querySelector('[data-view="protocols"]')?.click();
  $('createPatientProtocol').onclick=async()=>{const name=$('patientNewProtocolName').value.trim();if(!name)return out($('setMsg'),'Inserisci il nome del protocollo.');const uid=(await sb.auth.getUser()).data.user.id;const{data:newProtocol,error}=await sb.from('monitoring_protocols').insert({clinician_id:uid,name,description:'Creato dal profilo di '+(p?.full_name||'paziente'),checkin_enabled:true,checkin_time:$('setTime').value||'09:00',checkin_frequency:'daily',checkin_weekdays:[0,1,2,3,4,5,6],alert_on_yellow:$('setYellow').checked,alert_on_red:$('setRed').checked,medication_reminder_enabled:true,followup_reminder_offsets:[7,1,0]}).select().single();if(error)return out($('setMsg'),error.message);out($('setMsg'),'Protocollo aggiunto. Ora puoi selezionarlo e applicarlo.',true);setTimeout(()=>openPatient(id),500);};
  $('applyProto').onclick=async()=>{
    const pid=$('patientProtocol').value; if(!pid)return out($('setMsg'),'Seleziona un protocollo.');
    const{data,error}=await sb.rpc('apply_protocol_to_patient',{p_patient:id,p_protocol:pid,p_note:null});
    if(error)return out($('setMsg'),error.message);
    const meds=data?.medications_created||0, followups=data?.followups_created||0;
    let pushed=false; if(data?.outbox_id)pushed=await dispatch(data.outbox_id);
    out($('setMsg'),'Protocollo applicato: '+meds+' terapie e '+followups+' controlli aggiunti al percorso.'+(pushed?' Invio push accettato da FCM.':''),true);
    setTimeout(()=>openPatient(id),700);
  };
  document.querySelectorAll('.preview-import').forEach(b=>b.onclick=async()=>{const{data,error}=await sb.storage.from('medical-reports').createSignedUrl(b.dataset.path,300);if(error)return alert(error.message);window.open(data.signedUrl,'_blank','noopener');});
  document.querySelectorAll('.confirm-import').forEach(b=>b.onclick=async()=>{const row=(imports.data||[]).find(x=>x.id===b.dataset.import);if(!row)return;let payload=row.structured_data||{};if(row.item_type==='therapy'){const name=prompt('Nome farmaco',payload.name||row.title);if(!name)return;const dose=prompt('Dose',payload.dose||'')??'';const times=prompt('Orari separati da virgola',(payload.times||[]).join(','))??'';payload={...payload,name,dose,times:times.split(',').map(x=>x.trim()).filter(Boolean)};}else if(row.item_type==='control'){const label=prompt('Nome controllo',payload.label||row.title);if(!label)return;const due=prompt('Data YYYY-MM-DD',payload.due_date||'')||'';if(!due)return;payload={...payload,label,due_date:due,type:payload.type||'visita'};}const{error}=await sb.rpc('clinician_review_care_import',{p_import:row.id,p_action:'confirm',p_payload:payload,p_note:null});if(error)return alert(error.message);alert('Elemento confermato.');openPatient(id);});
  document.querySelectorAll('.reject-import').forEach(b=>b.onclick=async()=>{if(!confirm('Rifiutare questo elemento?'))return;const{error}=await sb.rpc('clinician_review_care_import',{p_import:b.dataset.import,p_action:'reject',p_payload:{},p_note:'Non confermato dal medico'});if(error)return alert(error.message);openPatient(id);});
  $('saveSettings').onclick=async()=>{
    const uid=(await sb.auth.getUser()).data.user.id;
    const payload={patient_id:id,clinician_id:uid,enabled:true,checkin_enabled:true,checkin_time:$('setTime').value||'09:00',checkin_frequency:'daily',checkin_weekdays:[0,1,2,3,4,5,6],alert_on_yellow:$('setYellow').checked,alert_on_red:$('setRed').checked,updated_at:new Date().toISOString()};
    const{error}=await sb.from('patient_monitoring_settings').upsert(payload,{onConflict:'patient_id'}); if(error)return out($('setMsg'),error.message); out($('setMsg'),'Monitoraggio aggiornato.',true);
  };
}

async function dispatch(outboxId){
  try{const s=(await sb.auth.getSession()).data.session;if(!s||!outboxId)return false;const r=await fetch(SUPABASE_URL+'/functions/v1/dispatch-push',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+s.access_token},body:JSON.stringify({outbox_id:outboxId})});const result=await r.json();return r.ok&&result.ok===true&&result.sent>0}catch{return false}
}

async function loadAppointments(){
  const uid=(await sb.auth.getUser()).data.user?.id;if(!uid)return;
  const [{data:rows,error},{data:links}]=await Promise.all([
    sb.from('appointments').select('*').eq('clinician_id',uid).order('created_at',{ascending:false}),
    sb.from('patient_clinicians').select('patient_id').eq('clinician_id',uid).eq('active',true)
  ]);
  const ids=[...new Set((links||[]).map(x=>x.patient_id))];
  let map={};
  if(ids.length){const{data:p}=await sb.from('profiles').select('id,full_name').in('id',ids);for(const x of p||[])map[x.id]=x.full_name||'Paziente';}
  const select=$('apptPatient'); if(select)select.innerHTML=ids.map(id=>'<option value="'+id+'">'+esc(map[id]||'Paziente')+'</option>').join('');
  if(error){if($('appointmentList'))$('appointmentList').innerHTML='<div class="err">'+esc(error.message)+'</div>';return;}
  const statusLabel={Requested:'Richiesto dal paziente',Proposed:'Proposto',Confirmed:'Confermato',Rejected:'Rifiutato',Cancelled:'Annullato',Completed:'Completato'};
  if($('appointmentList'))$('appointmentList').innerHTML=(rows||[]).map(x=>{
    const when=x.proposed_start?new Date(x.proposed_start).toLocaleString('it-IT'):(x.requested_date?esc(x.requested_date)+(x.requested_time_window?' · '+esc(x.requested_time_window):''):'Data da concordare');
    const actions=x.status==='Requested'?'<div class="row" style="margin-top:8px"><button class="btn secondary appt-prefill" data-id="'+x.id+'" data-patient="'+x.patient_id+'">Proponi data</button><button class="btn danger appt-reject" data-id="'+x.id+'">Rifiuta</button></div>':x.status==='Proposed'?'<span class="small muted">In attesa della risposta del paziente.</span>':'';
    return '<div class="item"><div class="row between"><div><b>'+esc(map[x.patient_id]||'Paziente')+'</b><div class="small muted">'+esc(statusLabel[x.status]||x.status)+' · '+when+'</div></div><span class="pill">'+esc(x.location_type==='video'?'Video':x.location_type==='phone'?'Telefonica':'In presenza')+'</span></div>'+(x.reason?'<div style="margin-top:5px">'+esc(x.reason)+'</div>':'')+actions+'</div>';
  }).join('')||'<p class="muted">Nessun appuntamento o richiesta.</p>';

  document.querySelectorAll('.appt-prefill').forEach(b=>b.onclick=()=>{
    if($('apptPatient'))$('apptPatient').value=b.dataset.patient;
    if($('apptReason'))$('apptReason').value='Riscontro alla richiesta del paziente';
    $('apptStart')?.focus();
  });
  document.querySelectorAll('.appt-reject').forEach(b=>b.onclick=async()=>{
    const{error}=await sb.rpc('respond_appointment',{p_appointment:b.dataset.id,p_accept:false,p_note:'Richiesta non accolta'});
    if(error)return alert(error.message);loadAppointments();
  });
}
$('refreshAppointments').onclick=()=>loadAppointments();
$('proposeAppointment').onclick=async()=>{
  const patient=$('apptPatient').value,start=$('apptStart').value;
  if(!patient||!start)return out($('apptMsg'),'Seleziona paziente, data e ora.');
  const{data,error}=await sb.rpc('propose_appointment',{
    p_patient:patient,
    p_start:new Date(start).toISOString(),
    p_duration_minutes:Number($('apptDuration').value||30),
    p_reason:$('apptReason').value.trim()||null,
    p_location_type:$('apptLocationType').value,
    p_location_label:$('apptLocation').value.trim()||null,
    p_note:$('apptNote').value.trim()||null
  });
  if(error)return out($('apptMsg'),error.message);
  const pushed=data?.outbox_id?await dispatch(data.outbox_id):false;
  out($('apptMsg'),pushed?'Proposta inviata al paziente.':'Proposta registrata; la notifica push non è stata consegnata.',pushed);
  $('apptStart').value='';$('apptReason').value='';$('apptNote').value='';loadAppointments();
};

async function loadRequests(){
 const uid=(await sb.auth.getUser()).data.user?.id;if(!uid)return;
 const[{data:reqs,error:re},{data:imports,error:ie}]=await Promise.all([
  sb.from('patient_clinician_requests').select('*').eq('clinician_id',uid).order('created_at',{ascending:false}),
  sb.from('patient_care_imports').select('*').eq('clinician_id',uid).eq('status','Pending').order('created_at',{ascending:false})
 ]);
 if(re){$('linkRequestList').innerHTML='<div class="err">'+esc(re.message)+'</div>';}else{
   const ids=[...new Set((reqs||[]).map(x=>x.patient_id))];let map={};if(ids.length){const{data:p}=await sb.from('profiles').select('id,full_name').in('id',ids);for(const x of p||[])map[x.id]=x.full_name;}
   $('linkRequestList').innerHTML=(reqs||[]).map(r=>`<div class="item"><div class="row"><b>${esc(map[r.patient_id]||'Paziente')}</b><span class="pill">${esc(r.status)}</span></div><div class="small muted">${fmt(r.created_at)}</div>${r.status==='Pending'?`<div class="row" style="margin-top:8px"><button class="btn accept-link" data-id="${r.id}">Accetta</button><button class="btn danger reject-link" data-id="${r.id}">Rifiuta</button></div>`:''}</div>`).join('')||'<p class="muted">Nessuna richiesta.</p>';
   document.querySelectorAll('.accept-link').forEach(b=>b.onclick=()=>reviewLink(b.dataset.id,true));document.querySelectorAll('.reject-link').forEach(b=>b.onclick=()=>reviewLink(b.dataset.id,false));
 }
 if(ie){$('careImportList').innerHTML='<div class="err">'+esc(ie.message)+'</div>';}else{
   const ids=[...new Set((imports||[]).map(x=>x.patient_id))];let map={};if(ids.length){const{data:p}=await sb.from('profiles').select('id,full_name').in('id',ids);for(const x of p||[])map[x.id]=x.full_name;}
   $('careImportList').innerHTML=(imports||[]).map(x=>`<div class="item"><div class="row"><b>${esc(map[x.patient_id]||'Paziente')}</b><span class="pill">${esc(x.item_type)}</span></div><div>${esc(x.title)}</div><div class="small muted">${esc(x.source_type)} · ${fmt(x.created_at)}</div><button class="btn secondary open-import-patient" data-patient="${x.patient_id}" style="margin-top:8px">Apri paziente</button></div>`).join('')||'<p class="muted">Nessun elemento da verificare.</p>';document.querySelectorAll('.open-import-patient').forEach(b=>b.onclick=()=>{document.querySelector('[data-view="patients"]').click();openPatient(b.dataset.patient)});
 }
}
async function reviewLink(id,accept){const{error}=await sb.rpc('clinician_review_link_request',{p_request:id,p_accept:accept,p_note:null});if(error)return alert(error.message);await loadPatients();await loadRequests();await loadOverview();}

async function loadDirectoryProfile(){
 const uid=(await sb.auth.getUser()).data.user?.id;if(!uid)return;
 let{data,error}=await sb.from('clinician_directory').select('*').eq('clinician_id',uid).maybeSingle();
 if(error)return;
 if(!data){data={display_name:me?.full_name||'',specialty:'',center_label:'',professional_registration_no:'',directory_visible:true,accepting_requests:true};}
 $('dirName').value=data.display_name||'';$('dirSpecialty').value=data.specialty||'';$('dirCenter').value=data.center_label||'';$('dirReg').value=data.professional_registration_no||'';$('dirVisible').checked=data.directory_visible!==false;$('dirAccept').checked=data.accepting_requests!==false;
}
$('saveDirectory').onclick=async()=>{const uid=(await sb.auth.getUser()).data.user.id;const payload={clinician_id:uid,display_name:$('dirName').value.trim()||me.full_name,specialty:$('dirSpecialty').value.trim()||null,center_label:$('dirCenter').value.trim()||null,professional_registration_no:$('dirReg').value.trim()||null,directory_visible:$('dirVisible').checked,accepting_requests:$('dirAccept').checked,updated_at:new Date().toISOString()};const{error}=await sb.from('clinician_directory').upsert(payload,{onConflict:'clinician_id'});if(error)return out($('dirMsg'),error.message);out($('dirMsg'),'Profilo pubblico aggiornato.',true);};

const GISE_PROTOCOL_TEMPLATES=[
  {
    id:'gise-pci-a',
    name:'GISE Post-PCI · Percorso A',
    source:'SICI-GISE / percorso follow-up post-PCI (2015)',
    description:'Paziente post-PCI con disfunzione ventricolare sinistra (FE ≤45%). Nel documento: MMG post-dimissione, a 1 e 2 mesi con controlli ematochimici; visita cardiologica a 3 e 12 mesi e poi annuale se persiste la disfunzione; ecocardiogramma a 3 e 12 mesi se persiste, poi biennale.',
    time:'09:00', offsets:'7,1,0', yellow:true, missed:true,
    followups:[
      {label:'Controllo MMG',type:'visita',after_days:30,notes:'Follow-up post-PCI · verificare esami ematochimici',reminder_offsets:[7,1,0]},
      {label:'Controllo MMG',type:'visita',after_days:60,notes:'Follow-up post-PCI',reminder_offsets:[7,1,0]},
      {label:'Visita cardiologica + ecocardiogramma',type:'cardiologia',after_days:90,notes:'Percorso A · verificare persistenza disfunzione ventricolare',reminder_offsets:[14,7,1]},
      {label:'Visita cardiologica + ecocardiogramma',type:'cardiologia',after_days:365,notes:'Percorso A · personalizzare in base al quadro clinico',reminder_offsets:[30,7,1]}
    ]
  },
  {
    id:'gise-pci-b',
    name:'GISE Post-PCI · Percorso B',
    source:'SICI-GISE / percorso follow-up post-PCI (2015)',
    description:'Paziente post-PCI senza disfunzione ventricolare sinistra ma con fattori di rischio clinici (SCA o diabete), anatomici (tronco comune, discendente prossimale o malattia trivasale severa) o procedurali (rivascolarizzazione incompleta/subottimale). Nel documento: MMG post-dimissione, 3 e 6 mesi; cardiologia entro 12 mesi, poi annuale; test provocativo entro 12 mesi e poi biennale, anticipabile a 3-6 mesi in casi selezionati.',
    time:'09:00', offsets:'7,1,0', yellow:true, missed:false,
    followups:[
      {label:'Controllo MMG',type:'visita',after_days:90,notes:'Percorso B post-PCI',reminder_offsets:[7,1,0]},
      {label:'Controllo MMG',type:'visita',after_days:180,notes:'Percorso B post-PCI',reminder_offsets:[7,1,0]},
      {label:'Visita cardiologica',type:'cardiologia',after_days:365,notes:'Entro 12 mesi · personalizzare sul rischio',reminder_offsets:[30,7,1]},
      {label:'Test provocativo',type:'esame',after_days:365,notes:'Entro 12 mesi se indicato; anticipabile in casi selezionati',reminder_offsets:[30,7,1]}
    ]
  },
  {
    id:'gise-pci-c',
    name:'GISE Post-PCI · Percorso C',
    source:'SICI-GISE / percorso follow-up post-PCI (2015)',
    description:'Paziente post-PCI che non rientra nei percorsi A o B. Nel documento: MMG post-dimissione e a 3 mesi con controlli ematochimici; visita cardiologica specialistica a 12 mesi; test provocativo non indicato di routine nel paziente asintomatico, salvo situazioni specifiche.',
    time:'09:00', offsets:'7,1,0', yellow:false, missed:false,
    followups:[
      {label:'Controllo MMG',type:'visita',after_days:90,notes:'Percorso C post-PCI',reminder_offsets:[7,1,0]},
      {label:'Visita cardiologica specialistica',type:'cardiologia',after_days:365,notes:'Controllo a 12 mesi',reminder_offsets:[30,7,1]}
    ]
  },
  {
    id:'gise-tavi',
    name:'GISE TAVI · Follow-up',
    source:'Documento di posizione SICI-GISE TAVI (2018)',
    description:'Follow-up dopo TAVI. Il documento indica un primo controllo a 30 giorni con visita clinica, ECG a 12 derivazioni ed ecocardiogramma transtoracico; ECG Holter 24 h in caso di alterazioni del ritmo. Successivi controlli clinici almeno annuali, modulati sul quadro clinico.',
    time:'09:00', offsets:'7,1,0', yellow:true, missed:true,
    followups:[
      {label:'Controllo TAVI 30 giorni',type:'cardiologia',after_days:30,notes:'Visita clinica + ECG 12 derivazioni + ecocardiogramma; Holter se indicato',reminder_offsets:[7,1,0]},
      {label:'Controllo TAVI annuale',type:'cardiologia',after_days:365,notes:'Controllo clinico almeno annuale, da modulare sul quadro clinico',reminder_offsets:[30,7,1]}
    ]
  }
];

function addProtoMedRow(v={}){
  const box=$('protoMedList'); if(!box)return;
  const el=document.createElement('div');el.className='item proto-med-row';
  el.innerHTML='<div class="two"><div class="field"><label>Farmaco</label><input class="pm-name" placeholder="Nome / AIFA" value="'+esc(v.name||'')+'"></div><div class="field"><label>Dose</label><input class="pm-dose" placeholder="Es. 100 mg" value="'+esc(v.dose||'')+'"></div></div>'+
    '<div class="two"><div class="field"><label>Via</label><input class="pm-route" value="'+esc(v.route||'Orale')+'"></div><div class="field"><label>Orari</label><input class="pm-times" placeholder="08:00,20:00" value="'+esc((v.times||[]).join(','))+'"></div></div>'+
    '<div class="two"><div class="field"><label>Inizio dopo (giorni)</label><input class="pm-start" type="number" min="0" value="'+esc(v.starts_in_days??0)+'"></div><div class="field"><label>Durata (giorni, vuoto = continuativa)</label><input class="pm-duration" type="number" min="1" value="'+esc(v.duration_days??'')+'"></div></div>'+
    '<div class="field"><label>Istruzioni</label><input class="pm-instr" value="'+esc(v.instructions||'')+'"></div><button type="button" class="btn danger proto-remove">Rimuovi</button>';
  box.appendChild(el);el.querySelector('.proto-remove').onclick=()=>el.remove();
}
function addProtoFollowRow(v={}){
  const box=$('protoFollowList'); if(!box)return;
  const el=document.createElement('div');el.className='item proto-follow-row';
  el.innerHTML='<div class="two"><div class="field"><label>Controllo</label><input class="pf-label" placeholder="Es. Visita cardiologica" value="'+esc(v.label||'')+'"></div><div class="field"><label>Tipo</label><input class="pf-type" value="'+esc(v.type||'controllo')+'"></div></div>'+
    '<div class="two"><div class="field"><label>Dopo quanti giorni</label><input class="pf-days" type="number" min="0" value="'+esc(v.after_days??30)+'"></div><div class="field"><label>Promemoria giorni prima</label><input class="pf-rem" value="'+esc((v.reminder_offsets||[7,1,0]).join(','))+'"></div></div>'+
    '<div class="field"><label>Note</label><input class="pf-notes" value="'+esc(v.notes||'')+'"></div><button type="button" class="btn danger proto-remove">Rimuovi</button>';
  box.appendChild(el);el.querySelector('.proto-remove').onclick=()=>el.remove();
}
function clearProtocolPlan(){if($('protoMedList'))$('protoMedList').innerHTML='';if($('protoFollowList'))$('protoFollowList').innerHTML='';}
function readProtocolPlan(){
  const medication_plan=[...document.querySelectorAll('.proto-med-row')].map(r=>({
    name:r.querySelector('.pm-name').value.trim(),
    dose:r.querySelector('.pm-dose').value.trim(),
    route:r.querySelector('.pm-route').value.trim(),
    times:r.querySelector('.pm-times').value.split(',').map(x=>x.trim()).filter(Boolean),
    starts_in_days:Number(r.querySelector('.pm-start').value||0),
    duration_days:r.querySelector('.pm-duration').value?Number(r.querySelector('.pm-duration').value):null,
    instructions:r.querySelector('.pm-instr').value.trim()
  })).filter(x=>x.name);
  const followup_plan=[...document.querySelectorAll('.proto-follow-row')].map(r=>({
    label:r.querySelector('.pf-label').value.trim(),
    type:r.querySelector('.pf-type').value.trim()||'controllo',
    after_days:Number(r.querySelector('.pf-days').value||0),
    reminder_offsets:r.querySelector('.pf-rem').value.split(',').map(Number).filter(Number.isFinite),
    notes:r.querySelector('.pf-notes').value.trim()
  })).filter(x=>x.label);
  return {medication_plan,followup_plan};
}
$('addProtoMed').onclick=()=>addProtoMedRow();
$('addProtoFollow').onclick=()=>addProtoFollowRow();

function renderGiseTemplates(){
  const box=$('giseTemplateList'); if(!box)return;
  box.innerHTML=GISE_PROTOCOL_TEMPLATES.map((x,i)=>`
    <div class="item">
      <div class="row between"><div><b>${esc(x.name)}</b><div class="small muted">${esc(x.source)}</div></div><button class="btn secondary use-gise-template" data-i="${i}">Usa template</button></div>
      <div class="small" style="margin-top:7px">${esc(x.description)}</div>
    </div>`).join('');
  document.querySelectorAll('.use-gise-template').forEach(b=>b.onclick=()=>{
    const x=GISE_PROTOCOL_TEMPLATES[Number(b.dataset.i)]; if(!x)return;
    $('protoName').value=x.name;
    $('protoDesc').value=x.description+' Fonte: '+x.source+'. Verificare e personalizzare sul singolo paziente.';
    $('protoTime').value=x.time;
    $('protoOffsets').value=x.offsets;
    $('protoYellow').checked=x.yellow;
    $('protoMissed').checked=x.missed;
    clearProtocolPlan();
    (x.followups||[]).forEach(addProtoFollowRow);
    $('protoName').focus();
    out($('protoMsg'),'Template caricato. Verifica i parametri e premi “Salva protocollo”.',true);
  });
}

async function loadProtocols(){
  const uid=(await sb.auth.getUser()).data.user?.id;if(!uid)return;
  const{data}=await sb.from('monitoring_protocols').select('*').eq('clinician_id',uid).order('created_at',{ascending:false});
  renderGiseTemplates();
  $('protocolList').innerHTML=(data||[]).map(x=>'<div class="item"><b>'+esc(x.name)+'</b><div class="small muted">'+esc(x.description||'')+' · check-in '+esc(x.checkin_time?.slice(0,5)||'09:00')+'</div><div class="row" style="margin-top:6px"><span class="pill">'+((x.medication_plan||[]).length)+' farmaci</span><span class="pill">'+((x.followup_plan||[]).length)+' controlli</span></div></div>').join('')||'<p class="muted">Nessun protocollo salvato.</p>';
}
$('saveProto').onclick=async()=>{
  const name=$('protoName').value.trim();if(!name)return out($('protoMsg'),'Inserisci il nome.');
  const offsets=$('protoOffsets').value.split(',').map(Number).filter(Number.isFinite);const uid=(await sb.auth.getUser()).data.user.id;
  const plan=readProtocolPlan();
  const{error}=await sb.from('monitoring_protocols').insert({clinician_id:uid,name,description:$('protoDesc').value.trim(),checkin_enabled:true,checkin_time:$('protoTime').value||'09:00',checkin_frequency:'daily',checkin_weekdays:[0,1,2,3,4,5,6],alert_on_yellow:$('protoYellow').checked,alert_on_red:true,missed_checkin_alert:$('protoMissed').checked,medication_reminder_enabled:true,followup_reminder_offsets:offsets,medication_plan:plan.medication_plan,followup_plan:plan.followup_plan,source_reference:$('protoDesc').value.includes('Fonte:')?'SICI-GISE / template verificato dal medico':null});
  if(error)return out($('protoMsg'),error.message);out($('protoMsg'),'Protocollo salvato con '+plan.medication_plan.length+' farmaci e '+plan.followup_plan.length+' controlli.',true);$('protoName').value='';$('protoDesc').value='';clearProtocolPlan();loadProtocols();
};

const{data:{session}}=await sb.auth.getSession();if(session)boot();
}
