import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.116.0';
import { initVoiceCommands } from './voice-commands.js';

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
const MARCO_TEST_CLINICIAN_ID='985c1b31-a967-4c61-abe9-243fc8ea5efd';
const $=id=>document.getElementById(id); let me=null,patients=[],patientLoadError=null,selected=null,workspace='doctor',editingProtocol=null;
const esc=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const fmt=d=>d?new Date(d).toLocaleString('it-IT'):'—';
const healthLabel=s=>({green:'Bene',yellow:'Così così',red:'Non sto bene'})[s]||'Nessun check-in';
const healthPill=s=>`<span class="pill health-pill ${['green','yellow','red'].includes(s)?s:'gray'}">${esc(healthLabel(s))}</span>`;
const romeDay=()=>new Date().toLocaleDateString('en-CA',{timeZone:'Europe/Rome'});
const romeDayAgo=n=>new Date(Date.parse(romeDay()+'T12:00:00Z')-n*86400000).toISOString().slice(0,10);
const intakeState=s=>s==='taken'?'Assunto · confermato dal paziente':s==='skipped'?'Non assunto · indicato dal paziente':s==='unknown'?'Non ricordo · indicato dal paziente':'Non confermato';
function intakeRows(meds,intakes,day){
  const recorded=new Map((intakes||[]).filter(x=>x.intake_date===day).map(x=>[x.medication_schedule_id,x]));
  const weekday=new Date(day+'T12:00:00Z').getUTCDay();
  const scheduled=(meds||[]).filter(m=>(!m.starts_on||m.starts_on<=day)&&(!m.ends_on||m.ends_on>=day))
    .flatMap(m=>(m.medication_schedules||[]).filter(sc=>!Array.isArray(sc.weekdays)||sc.weekdays.includes(weekday)).map(sc=>({m,sc})));
  const rows=scheduled.map(({m,sc})=>`<div class="item"><b>${esc(sc.time_of_day?.slice(0,5)||'—')} · ${esc(m.name)} ${esc(m.dose||'')}</b><div class="small ${recorded.get(sc.id)?.status==='taken'?'ok':'muted'}">${esc(intakeState(recorded.get(sc.id)?.status) + (recorded.get(sc.id)?.skip_reason==='side_effect'?' · Effetto indesiderato riferito':''))}</div></div>`);
  const known=new Set(scheduled.map(({sc})=>sc.id));
  for(const x of (intakes||[]).filter(x=>x.intake_date===day&&!known.has(x.medication_schedule_id)))
    rows.push(`<div class="item">Orario non più nel piano · ${esc(intakeState(x.status))}</div>`);
  return rows.join('')||'<p class="muted">Nessun orario previsto per questa terapia.</p>';
}
function intakeDays(intakes){return [...new Set((intakes||[]).map(x=>x.intake_date))].sort().reverse();}
function therapyRows(meds,intakes,day){
  const recorded=new Map((intakes||[]).filter(x=>x.intake_date===day).map(x=>[x.medication_schedule_id,x.status]));
  return (meds||[]).map(m=>`<div class="item"><b>${esc(m.name)} ${esc(m.dose||'')}</b><div class="small muted">${esc(m.route||'')} · ${m.active?'Attiva':'Conclusa'}</div><div class="small">${(m.medication_schedules||[]).map(sc=>`${esc(sc.time_of_day?.slice(0,5)||'—')} · ${esc(intakeState(recorded.get(sc.id)))}`).join('<br>')||'Nessun orario'}</div></div>`).join('')||'<p class="muted">Nessuna terapia.</p>';
}
function medicationAttention(meds,intakes){
  const skipped=(intakes||[]).filter(x=>x.status==='skipped');
  return skipped.length>=2?skipped.map(x=>({day:x.intake_date,time:'',name:(meds||[]).find(m=>(m.medication_schedules||[]).some(sc=>sc.id===x.medication_schedule_id))?.name||'Farmaco',status:'skipped'})):[];
}
const intakeAlerts=new Map();
const careAlerts=new Map();
const intakeAlertLabel=alerts=>`${alerts.length} dosi dichiarate non assunte`;
const signalLabel={red_checkin:'Non sto bene',repeated_skips:'Più dosi dichiarate non assunte',side_effect:'Possibile effetto indesiderato riferito'};
function out(el,t,ok=false){el.innerHTML='<div class="'+(ok?'ok':'err')+'">'+esc(t)+'</div>'}
function showAuthPane(register=false){
  $('loginPane').classList.toggle('hidden',register); $('registerPane').classList.toggle('hidden',!register);
  $('tabLogin').classList.toggle('on',!register); $('tabRegister').classList.toggle('on',register); $('authMsg').innerHTML='';
}
$('tabLogin').onclick=()=>showAuthPane(false); $('tabRegister').onclick=()=>showAuthPane(true);
$('togglePass').onclick=()=>{const input=$('pass');const show=input.type==='password';input.type=show?'text':'password';$('togglePass').textContent=show?'🙈':'👁';$('togglePass').setAttribute('aria-label',show?'Nascondi password':'Mostra password');input.focus();};
$('forgotPass').onclick=async()=>{
  const email=$('email').value.trim(),button=$('forgotPass');
  if(!email)return out($('authMsg'),'Inserisci prima la tua email.');
  if(button.disabled)return;
  button.disabled=true;
  try{
    const{error}=await sb.auth.resetPasswordForEmail(email,{redirectTo:'https://ejlhgtodmcadmdhbujkf.supabase.co/functions/v1/password-reset'});
    if(error)throw error;
    out($('authMsg'),'Se questo indirizzo è registrato, riceverai un link per reimpostare la password. Controlla anche la cartella spam.',true);
  }catch(error){
    const limited=error.code==='over_email_send_rate_limit'||/email rate limit exceeded/i.test(error.message||'');
    out($('authMsg'),limited?'Il servizio email ha raggiunto il limite temporaneo del progetto. Nessuna email è stata inviata: riprova più tardi.':error.message);
  }finally{button.disabled=false}
};
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
  if(b.classList.contains('hidden'))return;
  document.querySelectorAll('.nav button').forEach(x=>x.classList.remove('on')); b.classList.add('on');
  document.querySelectorAll('.view').forEach(v=>v.classList.add('hidden')); $(b.dataset.view).classList.remove('hidden');
  if(b.dataset.view==='overview'||b.dataset.view==='patients') await loadOverview();
  if(b.dataset.view==='appointments') await loadAppointments();
  if(b.dataset.view==='messages') await loadMessages();
  if(b.dataset.view==='delivery')loadDelivery();
  if(b.dataset.view==='admin')loadAdmin();
  if(b.dataset.view==='protocols')loadProtocols();
  if(b.dataset.view==='marcoDoctor')loadMarcoDoctor();
  if(b.dataset.view==='testDoctor')loadTestDoctor();
});
setInterval(()=>{
  if(document.hidden||$('portal').classList.contains('hidden'))return;
  if(document.querySelector('.nav button.on')?.dataset.view==='overview')loadOverview();
},60000);

function setWorkspace(mode){
  if(me?.role!=='Administrator')return;
  workspace=['admin','doctor','test'].includes(mode)?mode:'admin';
  $('workspaceMode').value=workspace;
  const descriptions={admin:'Gestione account e assegnazioni.',doctor:`Vista clinica dell’account ${me.full_name||'attuale'}: ${patients.length} pazienti assegnati. Per i pazienti degli altri medici usa il rispettivo accesso.`,test:'Conversazioni di prova dei pazienti che hanno scelto Test Medico.'};
  $('workspaceHint').textContent=descriptions[workspace];
  document.querySelectorAll('.nav button').forEach(button=>{
    const type=button.dataset.view;
    button.classList.toggle('hidden',workspace==='admin'?!['admin','marcoDoctor','protocols'].includes(type):workspace==='test'?type!=='testDoctor':['admin','marcoDoctor','testDoctor'].includes(type));
  });
  const first=workspace==='admin'?'admin':workspace==='test'?'testDoctor':'overview';
  document.querySelector(`.nav button[data-view="${first}"]`)?.click();
}
$('workspaceMode').onchange=e=>setWorkspace(e.target.value);

async function boot(){
  const{data:{user}}=await sb.auth.getUser(); if(!user)return; await persistClinicianLegal();
  const{data:p,error}=await sb.from('profiles').select('*').eq('id',user.id).single();
  if(error)return out($('authMsg'),error.message); me=p;
  if(!me||!['Clinician','Administrator'].includes(me.role))return out($('authMsg'),'Account non abilitato come medico.');
  // Accesso beta con password e ruolo approvato; il secondo fattore non è richiesto.
  $('auth').classList.add('hidden');$('mfa').classList.add('hidden');$('portal').classList.remove('hidden');$('logout').classList.remove('hidden');
  $('voiceToggle').classList.toggle('hidden',me.role!=='Clinician');
  await loadPatients(); await Promise.all([loadOverview(),loadProtocols(),loadRequests(),loadDirectoryProfile()]);
  if(me.role==='Administrator'){$('workspaceSwitch').classList.remove('hidden');setWorkspace('admin');}
  else{$('workspaceSwitch').classList.add('hidden');$('adminNav').classList.add('hidden');$('marcoDoctorNav').classList.add('hidden');$('testDoctorNav').classList.add('hidden');document.querySelector('[data-view="overview"]').click();}
}

const deliveryLabel={sent:'Accettata da FCM',failed:'Invio fallito',pending:'In coda',read:'Letta nell’app',unknown:'Registrata nell’app'};
async function messageRecipients(){
  const recipients=patients.map(x=>({id:x.patient_id,name:x.profile?.full_name||'Paziente',mode:'clinician'}));
  if(me?.role!=='Administrator'||workspace==='doctor')return recipients;
  const {data:contacts,error}=await sb.from('patient_care_contacts').select('patient_id')
    .eq('test_support_admin_id',me.id).eq('initial_choice','test').not('choice_completed_at','is',null);
  if(error)throw error;
  const ids=(contacts||[]).map(x=>x.patient_id).filter(id=>!recipients.some(p=>p.id===id));
  if(ids.length){
    const {data:profiles,error:profileError}=await sb.from('profiles').select('id,full_name,role').in('id',ids);
    if(profileError)throw profileError;
    recipients.push(...(profiles||[]).filter(p=>p.role==='Patient').map(p=>({id:p.id,name:p.full_name||'Paziente',mode:'test'})));
  }
  return recipients;
}
async function loadMessages(){
  const select=$('messagePatient'),list=$('messageThreads'),result=$('messagePageResult');
  let recipients;try{recipients=await messageRecipients();}catch(e){return out(list,'Impossibile caricare i destinatari: '+e.message);}
  const ids=recipients.map(x=>x.id),previous=select.value;
  select.innerHTML='<option value="">Scegli un paziente</option>'+recipients.map(x=>`<option value="${esc(x.id)}">${esc(x.name)}${x.mode==='test'?' · Test Medico':''}</option>`).join('');
  if(ids.includes(previous))select.value=previous;
  if(!ids.length){list.innerHTML='<p class="notice">Nessun paziente ha completato il collegamento. Il paziente deve scegliere Test Medico nell’app, oppure un medico reale deve accettare la sua richiesta.</p>';return;}
  list.innerHTML='<p class="muted">Caricamento conversazioni…</p>';
  const {data,error}=await sb.from('chat_messages').select('sender_id,recipient_id,body,sent_at,is_read')
    .or(`sender_id.eq.${me.id},recipient_id.eq.${me.id}`).order('sent_at',{ascending:false}).limit(200);
  if(error){out(list,'Impossibile leggere i messaggi: '+error.message);return;}
  const last=new Map();for(const m of data||[]){const id=m.sender_id===me.id?m.recipient_id:m.sender_id;if(ids.includes(id)&&!last.has(id))last.set(id,m);}
  list.innerHTML=recipients.map(p=>{const m=last.get(p.id);return `<button class="item message-thread" type="button" data-id="${esc(p.id)}" data-mode="${p.mode}"><strong>${esc(p.name)}${p.mode==='test'?' · Test Medico':''}</strong><div class="small muted">${m?`${m.sender_id===me.id?'Tu: ':''}${esc(m.body.slice(0,130))} · ${fmt(m.sent_at)}`:'Nessun messaggio'}</div></button>`}).join('');
  list.querySelectorAll('.message-thread').forEach(b=>b.onclick=async()=>{
    if(b.dataset.mode==='test'){await document.querySelector('[data-view="testDoctor"]').onclick();$('testDoctorContent').querySelector(`.test-patient-open[data-id="${b.dataset.id}"]`)?.click();return;}
    document.querySelector('[data-view="patients"]').click();await openPatient(b.dataset.id);$('patientDetail').querySelector('[data-tab="chat"]')?.click();$('chatText')?.focus();
  });
  $('sendMessagePage').onclick=async()=>{
    const id=select.value,body=$('messageBody').value.trim(),button=$('sendMessagePage');
    if(!ids.includes(id)||!body)return out(result,'Scegli un paziente e scrivi il messaggio.');
    button.disabled=true;result.innerHTML='<p class="muted">Invio in corso…</p>';
    try{
      const mode=recipients.find(x=>x.id===id)?.mode;
      const {data:outboxId,error}=await sb.rpc(mode==='test'?'test_support_send_message_push':'clinician_send_message_push',{p_patient:id,p_body:body});
      if(error)throw error;
      $('messageBody').value='';
      const sent=await dispatch(outboxId);
      await loadMessages();select.value=id;
      out(result,sent?'Messaggio registrato; invio push accettato da FCM. Lettura del paziente non verificata.':'Messaggio registrato nella conversazione; push non confermata. Controlla Notifiche inviate.',sent);
    }catch(e){out(result,'Invio non riuscito: '+(e.message||'Riprova.'));}
    finally{button.disabled=false;}
  };
}
$('refreshMessages').onclick=loadMessages;
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
  let recipients;try{recipients=await messageRecipients();}catch(e){return out(list,'Impossibile caricare destinatari: '+e.message);}
  const ids=recipients.map(p=>p.id);
  if(!ids.length){list.innerHTML='<p class="muted">Nessun paziente collegato.</p>';return;}
  const {data:rows,error}=await sb.from('notifications')
    .select('id,patient_id,title,notification_type,created_at,sent_at,is_read,read_at')
    .eq('sender_id',me.id).in('patient_id',ids).order('created_at',{ascending:false}).limit(100);
  if(error){out(list,'Impossibile leggere le notifiche: '+error.message);return;}
  const notices=rows||[];const {data:outcomes,error:outcomeError}=notices.length
    ?await sb.from('push_outbox').select('id,user_id,notification_id,status,created_at,sent_at').in('notification_id',notices.map(n=>n.id))
    :{data:[],error:null};
  if(outcomeError){out(list,'Impossibile leggere gli esiti push: '+outcomeError.message);return;}
  const byNotice=new Map();for(const row of outcomes||[]){if(!byNotice.has(row.notification_id))byNotice.set(row.notification_id,[]);byNotice.get(row.notification_id).push(row);}
  const names=new Map(recipients.map(p=>[p.id,p.name]));
  const filter=$('deliveryFilter'),prev=filter.value,search=$('deliverySearch'),chips=$('deliveryChips');
  filter.innerHTML='<option value="">Tutti i pazienti</option>'+recipients.map(p=>`<option value="${esc(p.id)}">${esc(p.name)}${p.mode==='test'?' · Test Medico':''}</option>`).join('');
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
    list.querySelectorAll('.delivery-open').forEach(b=>b.onclick=async()=>{
      const who=recipients.find(p=>p.id===b.dataset.patient);
      if(who?.mode==='test'){await document.querySelector('[data-view="testDoctor"]').onclick();$('testDoctorContent').querySelector(`.test-patient-open[data-id="${b.dataset.patient}"]`)?.click();return;}
      document.querySelector('[data-view="patients"]').click();openPatient(b.dataset.patient);
    });
  };
  filter.onchange=draw;search.oninput=draw;
  chips.querySelectorAll('button').forEach(b=>b.onclick=()=>{chips.querySelectorAll('button').forEach(x=>x.classList.remove('on'));b.classList.add('on');draw();});
  $('composeDelivery').onclick=async()=>{
    const id=filter.value||(ids.length===1?ids[0]:null);
    if(id&&recipients.find(p=>p.id===id)?.mode==='test'){
      await document.querySelector('[data-view="messages"]').onclick();$('messagePatient').value=id;$('messageBody').focus();return;
    }
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
  const people=u.data||[],byId=new Map(people.map(p=>[p.id,p])),name=id=>byId.get(id)?.full_name||id;
  const activePatients=people.filter(x=>['Patient','Administrator'].includes(x.role)&&x.account_active),activeDoctors=people.filter(x=>x.role==='Clinician'&&x.account_active);
  const activeLinks=(c.data||[]).filter(x=>['Patient','Administrator'].includes(byId.get(x.patient_id)?.role)&&byId.get(x.clinician_id)?.role==='Clinician');
  const pending=(a.data||[]).filter(x=>x.status==='Pending').length;
  const applications=(a.data||[]).map(x=>{
    const status=x.status==='Pending'?'pending':x.status==='Approved'?'approved':'rejected';
    return `<div class="admin-entry-row"><div class="admin-entry-main"><strong>${esc(x.full_name)}</strong><small>Albo ${esc(x.professional_registration_no||'—')} · ${fmt(x.created_at)}</small></div><div class="admin-entry-actions"><span class="admin-status ${status}">${esc(x.status)}</span>${x.status==='Pending'?`<button type="button" class="btn admin-review" data-id="${esc(x.id)}" data-approve="true">Approva</button><button type="button" class="btn secondary admin-review" data-id="${esc(x.id)}" data-approve="false">Rifiuta</button>`:''}</div></div>`;
  }).join('')||'<div class="admin-empty">Nessuna richiesta di abilitazione medica.</div>';
  const accounts=people.map(x=>`<div class="admin-entry-row"><div class="admin-entry-main"><strong>${esc(x.full_name||'Utente')}</strong><small class="admin-role">${esc(x.role)}</small></div><div class="admin-entry-actions"><span class="admin-status ${x.account_active?'active':'suspended'}">${x.account_active?'Attivo':'Sospeso'}</span>${x.id!==me.id?`<button type="button" class="btn secondary admin-account" data-id="${esc(x.id)}" data-active="${!x.account_active}">${x.account_active?'Sospendi':'Riattiva'}</button>`:''}</div></div>`).join('')||'<div class="admin-empty">Nessun account.</div>';
  const associations=activeLinks.map(x=>`<div class="admin-entry-row"><div class="admin-entry-main"><strong>${esc(name(x.patient_id))}</strong><small>Medico: ${esc(name(x.clinician_id))}</small></div><div class="admin-entry-actions"><span class="admin-status active">Attiva</span><button type="button" class="btn danger admin-remove-link" data-patient="${esc(x.patient_id)}" data-doctor="${esc(x.clinician_id)}">Rimuovi</button></div></div>`).join('')||'<div class="admin-empty">Nessuna associazione attiva tra paziente e medico.</div>';
  box.innerHTML=`<div class="admin-metrics" aria-label="Riepilogo amministrazione"><div class="admin-metric"><small>Percorsi paziente</small><strong>${activePatients.length}</strong></div><div class="admin-metric"><small>Medici attivi</small><strong>${activeDoctors.length}</strong></div><div class="admin-metric attention"><small>Richieste da valutare</small><strong>${pending}</strong></div><div class="admin-metric"><small>Associazioni attive</small><strong>${activeLinks.length}</strong></div></div>
  <div class="admin-columns"><section class="admin-panel" aria-labelledby="adminAssociationTitle"><div class="admin-panel-head"><div><h2 id="adminAssociationTitle">Associa paziente e medico</h2><p>Il medico selezionato potrà consultare il percorso del paziente.</p></div></div><div class="admin-association-form"><label class="field" for="adminLinkPatient">Paziente<select id="adminLinkPatient">${activePatients.map(p=>`<option value="${esc(p.id)}">${esc(p.full_name||'Paziente')}${p.role==='Administrator'?' · Area personale':''}</option>`).join('')}</select></label><span class="admin-form-arrow" aria-hidden="true">→</span><label class="field" for="adminLinkDoctor">Medico<select id="adminLinkDoctor">${activeDoctors.map(p=>`<option value="${esc(p.id)}">${esc(p.full_name||'Medico')}</option>`).join('')}</select></label></div><button id="adminAddLink" class="btn admin-primary" type="button" ${!activePatients.length||!activeDoctors.length?'disabled':''}>Aggiungi associazione</button><div id="adminLinkResult" role="status" aria-live="polite"></div><p class="admin-access-note">Una richiesta in attesa per la stessa coppia viene segnata come accettata. Il contatto Test Medico segue un percorso separato.</p></section>
  <section class="admin-panel" aria-labelledby="adminApplicationsTitle"><div class="admin-panel-head"><div><h2 id="adminApplicationsTitle">Abilitazioni mediche</h2><p>Verifica le richieste di accesso dei professionisti.</p></div><span class="admin-count">${pending} da valutare</span></div><div class="admin-list">${applications}</div></section></div>
  <section class="admin-panel" aria-labelledby="adminLinksTitle"><div class="admin-panel-head"><div><h2 id="adminLinksTitle">Associazioni attive</h2><p>Gestisci l'accesso dei medici ai percorsi paziente.</p></div><span class="admin-count">${activeLinks.length}</span></div><div class="admin-list">${associations}</div></section>
  <section class="admin-panel admin-account-panel" aria-labelledby="adminAccountsTitle"><div class="admin-panel-head"><div><h2 id="adminAccountsTitle">Account</h2><p>Stato e ruolo degli utenti registrati.</p></div><span class="admin-count">${people.length}</span></div><div class="admin-list">${accounts}</div></section>`;
  box.querySelectorAll('.admin-review').forEach(b=>b.onclick=async()=>{if(!confirm(b.dataset.approve==='true'?'Approvare questa richiesta medico?':'Rifiutare questa richiesta medico?'))return;const {error}=await sb.rpc('admin_review_clinician_application',{p_application:b.dataset.id,p_approve:b.dataset.approve==='true'});if(error)alert(error.message);else loadAdmin();});
  box.querySelectorAll('.admin-account').forEach(b=>b.onclick=async()=>{if(!confirm('Confermare la modifica dello stato account?'))return;const {error}=await sb.rpc('admin_set_account_active',{p_user:b.dataset.id,p_active:b.dataset.active==='true'});if(error)alert(error.message);else loadAdmin();});
  $('adminAddLink').onclick=async()=>{
    const patient=$('adminLinkPatient').value,doctor=$('adminLinkDoctor').value;
    if(!activePatients.some(p=>p.id===patient)||!activeDoctors.some(p=>p.id===doctor))return out($('adminLinkResult'),'Scegli un paziente e un medico attivi.');
    if(!confirm(`Associare ${name(patient)} a ${name(doctor)}? Il medico potrà accedere al percorso sanitario del paziente.`))return;
    const button=$('adminAddLink');button.disabled=true;
    const {data,error}=await sb.rpc('admin_set_patient_clinician_link',{p_patient:patient,p_clinician:doctor,p_active:true});
    if(error){button.disabled=false;return out($('adminLinkResult'),error.message);}
    await loadAdmin();out($('adminLinkResult'),data==='unchanged'?'Associazione già attiva.':'Associazione attivata.',true);
  };
  box.querySelectorAll('.admin-remove-link').forEach(button=>button.onclick=async()=>{
    const patient=button.dataset.patient,doctor=button.dataset.doctor;
    if(!confirm(`Rimuovere l'associazione tra ${name(patient)} e ${name(doctor)}? Il medico perderà l'accesso al percorso del paziente.`))return;
    button.disabled=true;
    const {error}=await sb.rpc('admin_set_patient_clinician_link',{p_patient:patient,p_clinician:doctor,p_active:false});
    if(error){button.disabled=false;return alert(error.message);}
    await loadAdmin();out($('adminLinkResult'),'Associazione disattivata.',true);
  });
}

async function loadMarcoDoctor(){
  const box=$('marcoDoctorContent');if(!box||me?.role!=='Administrator')return;
  box.innerHTML='<p class="muted">Caricamento richieste di Marco…</p>';
  const [doctor,requests,links]=await Promise.all([
    sb.from('profiles').select('id,full_name,role,account_active').eq('id',MARCO_TEST_CLINICIAN_ID).maybeSingle(),
    sb.from('patient_clinician_requests').select('id,patient_id,status,created_at,reviewed_at').eq('clinician_id',MARCO_TEST_CLINICIAN_ID).order('created_at',{ascending:false}).limit(100),
    sb.from('patient_clinicians').select('patient_id,active,assigned_at').eq('clinician_id',MARCO_TEST_CLINICIAN_ID).eq('active',true).limit(100)
  ]);
  if(doctor.error||requests.error||links.error)return out(box,[doctor.error,requests.error,links.error].filter(Boolean).map(e=>e.message).join('; '));
  if(doctor.data?.role!=='Clinician')return out(box,'Profilo medico Marco Test non disponibile.');
  const ids=[...new Set([...(requests.data||[]).map(r=>r.patient_id),...(links.data||[]).map(l=>l.patient_id)])];
  const people=ids.length?await sb.from('profiles').select('id,full_name,role').in('id',ids):{data:[],error:null};
  if(people.error)return out(box,people.error.message);
  const names=new Map((people.data||[]).filter(p=>['Patient','Administrator'].includes(p.role)).map(p=>[p.id,p.full_name||'Paziente']));
  const active=new Set((links.data||[]).map(l=>l.patient_id));
  const requestRows=(requests.data||[]).filter(r=>names.has(r.patient_id)).map(r=>{
    const action=r.status==='Pending'&&!active.has(r.patient_id)&&doctor.data.account_active
      ?`<button class="btn marco-associate" data-patient="${esc(r.patient_id)}">Associa</button>`:'';
    return `<div class="item row between"><span><b>${esc(names.get(r.patient_id))}</b> · ${esc(r.status)} <small class="muted">${fmt(r.created_at)}</small></span>${action}</div>`;
  }).join('')||'<p class="muted">Nessuna richiesta ricevuta.</p>';
  const linkRows=(links.data||[]).filter(l=>names.has(l.patient_id)).map(l=>`<div class="item row between"><span><b>${esc(names.get(l.patient_id))}</b> · dal ${fmt(l.assigned_at)}</span><button class="btn danger marco-remove" data-patient="${esc(l.patient_id)}">Rimuovi</button></div>`).join('')||'<p class="muted">Nessun paziente associato. La richiesta pendente non è ancora un’associazione.</p>';
  box.innerHTML=`<p><b>${esc(doctor.data.full_name)}</b> · ${doctor.data.account_active?'Account attivo':'Account sospeso'}</p><h3>Richieste ricevute</h3><div class="list">${requestRows}</div><h3>Pazienti associati</h3><div class="list">${linkRows}</div><div id="marcoLinkResult" role="status" aria-live="polite"></div>`;
  box.querySelectorAll('.marco-associate,.marco-remove').forEach(button=>button.onclick=async()=>{
    const patient=button.dataset.patient,enable=button.classList.contains('marco-associate');
    if(!names.has(patient))return;
    if(!confirm(`${enable?'Associare':'Rimuovere'} ${names.get(patient)} ${enable?'a':'da'} Dr. Marco Test? ${enable?'Il medico potrà accedere al suo percorso sanitario.':'Il medico perderà l’accesso al suo percorso sanitario.'}`))return;
    button.disabled=true;
    const {error}=await sb.rpc('admin_set_patient_clinician_link',{p_patient:patient,p_clinician:MARCO_TEST_CLINICIAN_ID,p_active:enable});
    if(error){button.disabled=false;return out($('marcoLinkResult'),error.message);}
    await loadMarcoDoctor();out($('marcoLinkResult'),enable?'Associazione attivata; richiesta segnata come accettata.':'Associazione disattivata.',true);
  });
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
  const selected=(contacts||[]).filter(x=>x.initial_choice==='test'&&x.choice_completed_at);
  box.innerHTML=`<div class="row between"><p><strong>${selected.length}</strong> pazienti in modalità Test Medico · <strong>${ids.length}</strong> con contatto test predisposto.</p><button id="refreshTestDoctor" class="btn secondary">Aggiorna</button></div><div class="list">${selected.map(x=>`<div class="item"><b>${esc(names.get(x.patient_id)||'Paziente')}</b><div class="small muted">Modalità test scelta il ${fmt(x.choice_completed_at)} · Nessuna prescrizione abilitata</div><button class="btn secondary test-patient-open" data-id="${x.patient_id}">Vedi percorso e messaggi</button></div>`).join('')||'<p class="notice">Nessun paziente ha ancora scelto Test Medico dall’app. Il contatto è predisposto, ma puoi inviare messaggi solo dopo la scelta del paziente.</p>'}</div><div id="testPatientDetail" class="section"></div>`;
  $('refreshTestDoctor').onclick=loadTestDoctor;
  box.querySelectorAll('.test-patient-open').forEach(b=>b.onclick=async()=>{
    const id=b.dataset.id,detail=$('testPatientDetail');if(!selected.some(x=>x.patient_id===id))return;
    detail.innerHTML='<p class="muted">Caricamento percorso…</p>';
    const [checkins,meds,followups,intakes,conversation]=await Promise.all([
      sb.from('patient_daily_checkins').select('status,checkin_date,submitted_at').eq('patient_id',id).order('checkin_date',{ascending:false}).limit(7),
      sb.from('medications').select('name,dose,active,medication_schedules(id,time_of_day)').eq('patient_id',id).order('created_at',{ascending:false}).limit(25),
      sb.from('followup_milestones').select('milestone_label,due_date,completed').eq('patient_id',id).order('due_date').limit(20),
      sb.from('medication_intakes').select('medication_schedule_id,status,intake_date').eq('patient_id',id).gte('intake_date',romeDayAgo(30)).lte('intake_date',romeDay()).order('intake_date',{ascending:false}).limit(1000),
      sb.from('chat_messages').select('sender_id,recipient_id,body,sent_at,is_read').or(`and(sender_id.eq.${me.id},recipient_id.eq.${id}),and(sender_id.eq.${id},recipient_id.eq.${me.id})`).order('sent_at',{ascending:false}).limit(50)
    ]);
    const err=[checkins,meds,followups,intakes,conversation].find(x=>x.error)?.error;if(err)return out(detail,err.message);
    const taken=(intakes.data||[]).filter(x=>x.status==='taken'&&x.intake_date===romeDay()).length;
    detail.innerHTML=`<div class="card"><h3>${esc(names.get(id)||'Paziente')} · percorso in sola lettura</h3><p>Assunzioni confermate oggi: <strong>${taken}</strong>. Registrazioni negli ultimi 30 giorni: ${(intakes.data||[]).length}.</p>${medicationAttention(meds.data,intakes.data).length?`<p class="notice" style="background:#fff5df;color:#775211">Terapie da verificare: ${esc(intakeAlertLabel(medicationAttention(meds.data,intakes.data)))}. L’assenza di conferma non dimostra la mancata assunzione.</p>`:''}<h4>Check-in</h4>${(checkins.data||[]).map(x=>`<div class="item">${healthPill(x.status)} ${esc(x.checkin_date)}</div>`).join('')||'Nessun check-in.'}<h4>Terapie</h4>${(meds.data||[]).map(x=>`<div class="item"><b>${esc(x.name)} ${esc(x.dose||'')}</b> · ${x.active?'Attiva':'Conclusa'}<div class="muted small">${(x.medication_schedules||[]).map(sc=>`${esc(sc.time_of_day?.slice(0,5))} · ${esc(intakeState((intakes.data||[]).find(i=>i.intake_date===romeDay()&&i.medication_schedule_id===sc.id)?.status))}`).join('<br>')}</div></div>`).join('')||'Nessuna terapia.'}<h4>Assunzioni registrate</h4><div id="testIntakeHistory" class="list">${intakeDays(intakes.data).map(day=>`<div class="item"><b>${esc(day)}</b>${(intakes.data||[]).filter(i=>i.intake_date===day).map(i=>`<div class="small">${esc((meds.data||[]).flatMap(m=>(m.medication_schedules||[]).map(sc=>({m,sc}))).find(row=>row.sc.id===i.medication_schedule_id)?.m.name||'Terapia non più nel piano')} · ${esc(intakeState(i.status))}</div>`).join('')}</div>`).join('')||'Nessuna conferma negli ultimi 30 giorni.'}</div><h4>Controlli</h4>${(followups.data||[]).map(x=>`<div class="item">${esc(x.milestone_label)} · ${fmt(x.due_date)} · ${x.completed?'Completato':'Da effettuare'}</div>`).join('')||'Nessun controllo.'}</div><div class="card"><h3>Messaggi di prova</h3><p class="notice">Conversazione con il paziente in modalità Test Medico. Non usarla per prescrizioni o urgenze.</p><div class="list">${(conversation.data||[]).reverse().map(m=>`<div class="item"><b>${m.sender_id===me.id?'Tu':'Paziente'}</b> · ${fmt(m.sent_at)}<div>${esc(m.body)}</div></div>`).join('')||'<p class="muted">Nessun messaggio.</p>'}</div><label class="field"><span>Rispondi</span><textarea id="testChatBody" maxlength="4000" placeholder="Scrivi al paziente"></textarea></label><button id="testChatSend" class="btn">Invia messaggio</button><div id="testChatResult" aria-live="polite"></div></div>`;
    $('testChatSend').onclick=async()=>{
      const body=$('testChatBody').value.trim(),button=$('testChatSend'),result=$('testChatResult');
      if(!body)return out(result,'Scrivi un messaggio.');
      button.disabled=true;result.innerHTML='<p class="muted">Invio in corso…</p>';
      try{
        const {data:outboxId,error}=await sb.rpc('test_support_send_message_push',{p_patient:id,p_body:body});
        if(error)throw error;
        const sent=await dispatch(outboxId);
        await b.onclick();
        out($('testChatResult'),sent?'Messaggio registrato e push accettata da FCM; lettura da verificare.':'Messaggio registrato, push non confermata. Verifica Notifiche inviate.',sent);
      }catch(e){out(result,'Invio non riuscito: '+(e.message||'Riprova.'));button.disabled=false;}
    };
  });
}

async function loadPatients(){
  const uid=(await sb.auth.getUser()).data.user.id;
  const{data:a,error}=await sb.from('patient_clinicians').select('patient_id').eq('clinician_id',uid).eq('active',true);
  if(error){patientLoadError=error.message;patients=[];renderPatients();return;}
  const ids=(a||[]).map(x=>x.patient_id);
  if(!ids.length){patientLoadError=null;patients=[];renderPatients();return;}
  const[{data:pp,error:profileError},{data:ci,error:checkinError}]=await Promise.all([
    sb.from('profiles').select('id,full_name,date_of_birth,phone,role').in('id',ids),
    sb.from('patient_daily_checkins').select('*').in('patient_id',ids).order('submitted_at',{ascending:false})
  ]);
  if(profileError||checkinError){patientLoadError=(profileError||checkinError).message;patients=[];renderPatients();return;}
  patientLoadError=null;
  patients=ids.map(id=>({patient_id:id,profile:(pp||[]).find(p=>p.id===id),latest:(ci||[]).find(c=>c.patient_id===id)})).filter(x=>['Patient','Administrator'].includes(x.profile?.role)&&x.patient_id!==uid);
  renderPatients();
}

function renderPatients(){
  const q=($('patientSearch')?.value||'').toLowerCase();
  $('patientList').innerHTML=(patientLoadError?`<div class="err" role="alert">Impossibile caricare i pazienti: ${esc(patientLoadError)}</div>`:'')+patients.filter(x=>(x.profile?.full_name||'').toLowerCase().includes(q)).map(x=>
    '<div class="patient row" data-id="'+x.patient_id+'">'+healthPill(x.latest?.status)+'<div class="patient-main"><b>'+esc(x.profile?.full_name||'Paziente')+'</b><div class="small muted">'+(x.latest?'Ultimo check-in: '+esc(healthLabel(x.latest.status))+' · '+fmt(x.latest.submitted_at):'Nessun check-in')+'</div>'+(careAlerts.get(x.patient_id)?.length?'<span class="pill intake-alert-pill">Da valutare · '+careAlerts.get(x.patient_id).length+'</span>':'')+'</div><div class="patient-quick"><button type="button" data-action="notice">Notifica</button><button type="button" data-action="file">File</button><button type="button" data-action="message">Messaggio</button></div><span class="right">›</span></div>'
  ).join('')||(patientLoadError?'':`<p class="notice">Nessun paziente assegnato all’account ${esc(me?.full_name||'attuale')}. La vista Medico dell’amministratore mostra soltanto i pazienti assegnati al suo account; gli altri medici hanno elenchi separati. Per creare un’associazione usa Amministrazione.</p>`);
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
  const ids=patients.map(x=>x.patient_id);careAlerts.clear();intakeAlerts.clear();
  $('reportDay').textContent=romeDay();
  if(!ids.length){$('kRed').textContent='0';$('kYellow').textContent='0';$('kMsg').textContent='0';$('kIntake').textContent='0';$('attentionList').innerHTML='<p class="muted">Nessun paziente collegato.</p>';$('dailyReport').innerHTML='<p class="muted">Nessun paziente collegato.</p>';renderPatients();return;}
  const today=romeDay();
  const [{data:todayCheckins,error:checkinError},{data:todayIntakes,error:intakeError}]=await Promise.all([
    sb.from('patient_daily_checkins').select('patient_id,status,submitted_at').in('patient_id',ids).eq('checkin_date',today),
    sb.from('medication_intakes').select('patient_id,status,confirmed_at').in('patient_id',ids).eq('intake_date',today)
  ]);
  $('dailyReport').innerHTML=checkinError||intakeError?`<div class="err">Report non disponibile: ${esc((checkinError||intakeError).message)}</div>`:
    patients.map(patient=>{const checkin=(todayCheckins||[]).find(x=>x.patient_id===patient.patient_id),intakes=(todayIntakes||[]).filter(x=>x.patient_id===patient.patient_id);
      if(!checkin&&!intakes.length)return '';
      const taken=intakes.filter(x=>x.status==='taken').length,skipped=intakes.filter(x=>x.status==='skipped').length,unknown=intakes.filter(x=>x.status==='unknown').length;
      return `<div class="patient attention" data-id="${esc(patient.patient_id)}"><b>${esc(patient.profile?.full_name||'Paziente')}</b><div class="small muted">Check-in: ${esc(checkin?healthLabel(checkin.status):'non registrato')} · Terapie registrate: ${taken} assunte, ${skipped} non assunte, ${unknown} non ricordate</div></div>`;
    }).filter(Boolean).join('')||'<p class="muted">Nessuna registrazione oggi.</p>';
  document.querySelectorAll('#dailyReport [data-id]').forEach(x=>x.onclick=()=>{document.querySelector('[data-view="patients"]').click();openPatient(x.dataset.id)});
  const [{data:signals,error:signalsError},{count:messagesCount,error:messagesError}]=await Promise.all([
    sb.from('care_signals').select('id,patient_id,kind,signal_date,status,created_at').eq('status','open').in('patient_id',ids).order('created_at',{ascending:false}).limit(100),
    sb.from('chat_messages').select('id',{count:'exact',head:true}).eq('recipient_id',(await sb.auth.getUser()).data.user.id).eq('is_read',false)
  ]);
  const mine=(signals||[]).filter(x=>ids.includes(x.patient_id));
  for(const x of mine){const list=careAlerts.get(x.patient_id)||[];list.push(x);careAlerts.set(x.patient_id,list);}
  $('kRed').textContent=mine.filter(x=>x.kind==='red_checkin').length;
  $('kYellow').textContent=mine.filter(x=>x.kind==='side_effect').length;
  $('kIntake').textContent=mine.filter(x=>x.kind==='repeated_skips').length;
  $('kMsg').textContent=messagesCount||0;
  renderPatients();
  $('attentionList').innerHTML=(signalsError||messagesError?`<div class="err" role="alert">Avvisi non disponibili: ${esc((signalsError||messagesError).message)}</div>`:'')+(mine.map(x=>`<div class="patient attention" data-id="${esc(x.patient_id)}"><div class="row between"><div><b>${esc(patients.find(p=>p.patient_id===x.patient_id)?.profile?.full_name||'Paziente')}</b><div class="small muted">${esc(signalLabel[x.kind]||'Da valutare')} · ${esc(x.signal_date)} · ${fmt(x.created_at)}</div></div><button class="btn secondary review-signal" data-signal="${esc(x.id)}" type="button">Segna visto</button></div></div>`).join('')||'<p class="muted">Nessuna situazione segnalata da valutare.</p>');
  document.querySelectorAll('#attentionList [data-id]').forEach(x=>x.onclick=()=>{document.querySelector('[data-view="patients"]').click();openPatient(x.dataset.id)});
  document.querySelectorAll('.review-signal').forEach(button=>button.onclick=async e=>{e.stopPropagation();button.disabled=true;const {data,error}=await sb.rpc('review_care_signal',{p_signal_id:button.dataset.signal});if(error||!data){alert('Impossibile registrare la presa visione: '+(error?.message||'Accesso non autorizzato'));button.disabled=false;return;}loadOverview();});
}

async function openPatient(id){
  selected=id; const p=patients.find(x=>x.patient_id===id)?.profile;
  const[daily,meds,fu,msgs,setts,protos,imports,intakes,reports,procedure,conditions]=await Promise.all([
    sb.from('patient_daily_checkins').select('*').eq('patient_id',id).order('checkin_date',{ascending:false}).limit(14),
    sb.from('medications').select('*,medication_schedules(*)').eq('patient_id',id).order('created_at',{ascending:false}),
    sb.from('followup_milestones').select('*').eq('patient_id',id).order('due_date'),
    sb.from('chat_messages').select('*').or('sender_id.eq.'+id+',recipient_id.eq.'+id).order('sent_at'),
    sb.from('patient_monitoring_settings').select('*').eq('patient_id',id).eq('clinician_id',(await sb.auth.getUser()).data.user.id).maybeSingle(),
    sb.from('monitoring_protocols').select('*').eq('clinician_id',(await sb.auth.getUser()).data.user.id).eq('is_active',true),
    sb.from('patient_care_imports').select('*').eq('patient_id',id).order('created_at',{ascending:false}),
    sb.from('medication_intakes').select('medication_schedule_id,intake_date,status,skip_reason').eq('patient_id',id).gte('intake_date',romeDayAgo(30)).lte('intake_date',romeDay()).order('intake_date',{ascending:false}).limit(1000),
    sb.from('medical_reports').select('id,title,report_type,report_date,uploaded_at,medical_report_files(storage_path,page_number,mime_type)').eq('patient_id',id).order('uploaded_at',{ascending:false}),
    sb.from('patient_clinician_requests').select('performed_on,procedure_label').eq('patient_id',id).eq('clinician_id',(await sb.auth.getUser()).data.user.id).not('performed_on','is',null).order('created_at',{ascending:false}).limit(1).maybeSingle(),
    sb.from('patient_chronic_conditions').select('condition_codes,updated_at').eq('patient_id',id).maybeSingle()
  ]);
  const readErrors={summary:daily.error,therapy:meds.error||intakes.error,controls:fu.error,chat:msgs.error,patientimports:imports.error,reports:reports.error,settings:setts.error||protos.error};
  const readError=key=>readErrors[key]?`<div class="err" role="alert">Impossibile caricare la sezione: ${esc(readErrors[key].message)}</div>`:'';
  const latest=daily.data?.[0];
  $('patientDetail').innerHTML=`<div class="card">
    <div class="row between"><div><h2>${esc(p?.full_name||'Paziente')}</h2><div class="muted small">${esc(p?.phone||'')} ${p?.date_of_birth?'· '+esc(p.date_of_birth):''}</div></div><div class="row">${healthPill(latest?.status)}</div></div>
    <div id="patientIntakeAlert" role="status"></div>
    <div class="tabs"><button class="on" data-tab="summary">Monitoraggio</button><button data-tab="therapy">Terapie</button><button data-tab="controls">Controlli</button><button data-tab="chat">Messaggi</button><button data-tab="patientimports">Invii paziente</button><button data-tab="reports">Referti</button><button data-tab="settings">Protocollo</button></div>
    <div id="summary" class="tabp">${readError('summary')}<h3>Condizioni dichiarate dal paziente</h3>${conditions.error?`<div class="err">Informazioni non disponibili: ${esc(conditions.error.message)}</div>`:`<p class="muted">${esc((conditions.data?.condition_codes||[]).map(c=>({'diabetes_type_2':'Diabete di tipo 2',hypertension:'Ipertensione',copd:'BPCO',asthma:'Asma',heart_failure:'Scompenso cardiaco',ckd:'Malattia renale cronica'})[c]||c).join(' · ')||'Nessuna condizione dichiarata.')} · Informazione riferita dal paziente, da verificare.</p>`}<h3>Ultimi check-in</h3><div class="table-like">${(daily.data||[]).map(x=>'<div class="item"><div class="row">'+healthPill(x.status)+'<b>'+esc(x.checkin_date)+'</b></div><div class="small muted">'+esc((x.reasons||[]).join(', ')||x.note||'Nessun dettaglio')+'</div></div>').join('')||'<p class="muted">Nessun check-in.</p>'}</div></div>
    <div id="therapy" class="tabp hidden">${readError('therapy')}<div class="care-intro"><strong>Piano terapeutico</strong><p>Registra una terapia, verifica dose e orari e consulta le assunzioni dichiarate dal paziente.</p></div><div class="two"><div><h3>Nuova terapia</h3><div class="field" style="position:relative"><label>Farmaco</label><input id="medName" autocomplete="off" placeholder="Cerca per nome, principio attivo o AIC..."><div id="medCatalogResults" class="hidden" style="position:absolute;z-index:30;left:0;right:0;top:100%;background:#fff;border:1px solid #dfe9ee;border-radius:12px;box-shadow:0 12px 30px rgba(15,52,66,.14);max-height:260px;overflow:auto"></div><div class="small muted" style="margin-top:6px">Ricerca sui cataloghi AIFA classe A e H · <a href="/nomenclatori.html" target="_blank" rel="noopener noreferrer">consulta e scarica i file</a>. Seleziona il medicinale e indica dose e modalità.</div></div><div class="field"><label>Dose</label><input id="medDose"></div><div class="field"><label>Via</label><input id="medRoute" value="Orale"></div><div class="field"><label>Istruzioni</label><textarea id="medInstr" rows="2"></textarea></div><div class="two"><div class="field"><label>Inizio</label><input id="medStart" type="date"></div><div class="field"><label>Fine</label><input id="medEnd" type="date"></div></div><div class="field"><label>Orari giornalieri</label><input id="medTimes" placeholder="08:00,20:00"></div><button id="saveMed" class="btn">Salva terapia</button><p class="muted small">Gli orari registrati attivano i promemoria locali nell’app e il riepilogo serale.</p><div id="medMsg"></div></div><div><h3>Terapie attuali</h3><div id="therapyCurrent" class="table-like">${therapyRows(meds.data,intakes.data,romeDay())}</div></div><div class="card section"><div class="row between"><h3>Assunzioni dichiarate dal paziente</h3><button id="refreshIntakes" type="button" class="btn secondary">Aggiorna</button></div><div class="field"><label for="intakeDate">Giorno</label><input id="intakeDate" type="date" min="${romeDayAgo(30)}" max="${romeDay()}" value="${romeDay()}"></div><p class="small muted">Per vedere le conferme precedenti, seleziona la data. Una conferma è una dichiarazione del paziente, non una verifica clinica dell'assunzione.</p><div id="intakeList" class="table-like">${intakeRows(meds.data,intakes.data,romeDay())}</div><div id="intakeHistory" class="row">${intakeDays(intakes.data).map(day=>`<button type="button" class="btn secondary intake-day" data-day="${esc(day)}">${esc(day)}</button>`).join('')||'<span class="muted">Nessuna conferma negli ultimi 30 giorni.</span>'}</div><div id="intakeMessage" role="status"></div></div></div></div>
    <div id="controls" class="tabp hidden">${readError('controls')}<div class="care-intro"><strong>Controlli programmati</strong><p>Imposta scadenze e promemoria; il calendario resta consultabile accanto al modulo.</p></div><div class="two"><div><h3>Nuovo controllo</h3><div class="field"><label>Titolo</label><input id="fuLabel"></div><div class="field"><label>Tipo</label><input id="fuType" value="visita"></div><div class="field"><label>Data</label><input id="fuDate" type="date"></div><div class="field"><label>Promemoria giorni prima</label><input id="fuOffsets" value="${esc((setts.data?.followup_reminder_offsets||[7,1,0]).join(','))}"></div><div class="field"><label>Note</label><textarea id="fuNotes" rows="2"></textarea></div><button id="saveFu" class="btn">Programma controllo</button><div id="fuMsg"></div></div><div><h3>Calendario</h3><div class="table-like">${(fu.data||[]).map(x=>'<div class="item"><b>'+esc(x.milestone_label)+'</b><div class="small muted">'+esc(x.due_date)+' · '+esc(x.milestone_type)+' · '+(x.completed?'Completato':'Da fare')+'</div></div>').join('')||'<p class="muted">Nessun controllo.</p>'}</div></div></div></div>
    <div id="chat" class="tabp hidden">${readError('chat')}<div class="two"><div><h3>Conversazione</h3><div id="chatBox" class="msgbox">${(msgs.data||[]).filter(x=>(x.sender_id===me.id&&x.recipient_id===id)||(x.sender_id===id&&x.recipient_id===me.id)).map(x=>'<div class="msg '+(x.sender_id===me.id?'mine':'')+'">'+esc(x.body)+'<div class="small muted">'+fmt(x.sent_at)+'</div></div>').join('')||'<p class="muted">Nessun messaggio.</p>'}</div><div class="field"><textarea id="chatText" rows="2" placeholder="Scrivi un messaggio..."></textarea></div><button id="sendChat" class="btn">Invia messaggio</button><div id="chatMsg" role="status" aria-live="polite"></div></div><div><h3>Notifica immediata</h3><p class="muted small">Sul lock screen viene mostrata solo una comunicazione generica Meditaly.</p><div class="field"><label>Titolo interno</label><input id="noticeTitle" value="Il medico vuole contattarti"></div><div class="field"><label>Messaggio nell'app</label><textarea id="noticeBody" rows="3">Apri Meditaly per una nuova comunicazione del tuo medico.</textarea></div><button id="sendNotice" class="btn">Invia notifica</button><div id="noticeMsg"></div></div></div></div>
    <div id="patientimports" class="tabp hidden">${readError('patientimports')}<h3>Invii del paziente</h3><p class="muted small">Controlla sempre i dati prima di confermare. Una foto/OCR può contenere errori.</p><div class="table-like">${(imports.data||[]).map(x=>`<div class="item"><div class="row"><b>${esc(x.title)}</b><span class="pill">${esc(x.item_type)}</span><span class="pill">${esc(x.status)}</span></div><div class="small muted">${esc(x.source_type)} · ${fmt(x.created_at)}</div>${x.ocr_text?`<details><summary>Testo riconosciuto</summary><div class="small">${esc(x.ocr_text)}</div></details>`:''}${x.storage_path?`<button class="btn secondary preview-import" data-path="${esc(x.storage_path)}" style="margin-top:10px">Apri foto/documento</button>`:''}${x.status==='Pending'?`<div class="row" style="margin-top:10px"><button class="btn confirm-import" data-import="${x.id}" data-type="${x.item_type}">Conferma</button><button class="btn danger reject-import" data-import="${x.id}">Rifiuta</button></div>`:''}</div>`).join('')||'<p class="muted">Nessun invio.</p>'}</div></div>
    <div id="reports" class="tabp hidden">${readError('reports')}<h3>Referti del paziente</h3><p class="small muted">Accesso consentito solo al medico associato. I file si aprono tramite link protetti di breve durata.</p><div class="list">${(reports.data||[]).map(r=>`<div class="item"><b>${esc(r.title)}</b><div class="small muted">${esc(r.report_type||'Referto')} · ${fmt(r.report_date||r.uploaded_at)}</div><button type="button" class="btn secondary open-clinician-report" data-report="${r.id}">Apri referto</button></div>`).join('')||'<p class="muted">Nessun referto disponibile.</p>'}</div><div id="reportsMsg"></div></div>
    <div id="settings" class="tabp hidden">${readError('settings')}<h3>Livello di monitoraggio</h3><div class="two"><div><div class="field"><label>Protocollo</label><select id="patientProtocol"><option value="">Personalizzato</option>${(protos.data||[]).map(x=>'<option value="'+x.id+'" '+(setts.data?.protocol_id===x.id?'selected':'')+'>'+esc(x.name)+'</option>').join('')}</select></div><div class="row"><button id="applyProto" class="btn secondary">Rivedi e applica</button><button id="openProtocols" class="btn secondary">Gestisci protocolli</button></div><div id="protocolReview" class="card hidden" style="margin-top:12px"></div><div class="quick-protocol-create"><label>Nuovo protocollo rapido</label><div class="row"><input id="patientNewProtocolName" placeholder="Nome del protocollo"><button id="createPatientProtocol" class="btn">Aggiungi</button></div><div class="small muted">Crea un modello base; potrai completarlo nella sezione Protocolli.</div></div></div><div><div class="field"><label>Ora check-in</label><input id="setTime" type="time" value="${esc((setts.data?.checkin_time||'09:00').slice(0,5))}"></div><div class="row"><label><input id="setYellow" type="checkbox" ${setts.data?.alert_on_yellow?'checked':''}> Evidenzia giallo</label><label><input id="setRed" type="checkbox" ${setts.data?.alert_on_red!==false?'checked':''}> Evidenzia rosso</label></div><button id="saveSettings" class="btn" style="margin-top:12px">Salva personalizzazione</button><div id="setMsg"></div></div></div></div>
  </div>`;
  $('patientDetail').classList.remove('hidden');
  let patientIntakes=intakes.data||[];
  const paintIntakes=()=>{
    const day=$('intakeDate')?.value||romeDay();
    const alerts=medicationAttention(meds.data,patientIntakes);
    $('patientIntakeAlert').innerHTML=alerts.length?`<div class="notice" style="background:#fff5df;color:#775211;margin:12px 0"><b>Terapie da verificare · ${esc(intakeAlertLabel(alerts))}</b><div class="small">Assunzioni previste oggi o ieri. Apri Terapie per controllare gli orari; l'assenza di conferma non dimostra che il farmaco non sia stato assunto.</div></div>`:'';
    $('intakeList').innerHTML=intakeRows(meds.data,patientIntakes,day);
    $('therapyCurrent').innerHTML=therapyRows(meds.data,patientIntakes,romeDay());
    $('intakeHistory').innerHTML=intakeDays(patientIntakes).map(d=>`<button type="button" class="btn secondary intake-day" data-day="${esc(d)}">${esc(d)}</button>`).join('')||'<span class="muted">Nessuna conferma negli ultimi 30 giorni.</span>';
    $('intakeHistory').querySelectorAll('.intake-day').forEach(button=>button.onclick=()=>{$('intakeDate').value=button.dataset.day;paintIntakes();});
  };
  paintIntakes();
  $('intakeDate').onchange=paintIntakes;
  $('refreshIntakes').onclick=async()=>{
    const button=$('refreshIntakes');button.disabled=true;
    const {data,error}=await sb.from('medication_intakes').select('medication_schedule_id,intake_date,status,skip_reason').eq('patient_id',id).gte('intake_date',romeDayAgo(30)).lte('intake_date',romeDay()).order('intake_date',{ascending:false}).limit(1000);
    button.disabled=false;
    if(error)return out($('intakeMessage'),'Impossibile aggiornare le assunzioni: '+error.message);
    patientIntakes=data||[];paintIntakes();out($('intakeMessage'),'Assunzioni aggiornate.',true);
  };
  document.querySelectorAll('#patientDetail [data-tab]').forEach(b=>b.onclick=()=>{document.querySelectorAll('#patientDetail [data-tab]').forEach(x=>x.classList.remove('on'));b.classList.add('on');document.querySelectorAll('#patientDetail .tabp').forEach(x=>x.classList.add('hidden'));$('patientDetail').querySelector('#'+b.dataset.tab)?.classList.remove('hidden');if(b.dataset.tab==='therapy')$('refreshIntakes')?.click();});
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
    const body=$('chatText').value.trim();if(!body)return out($('chatMsg'),'Scrivi un messaggio prima di inviare.');
    const button=$('sendChat');button.disabled=true;$('chatMsg').innerHTML='<p class="muted">Invio in corso…</p>';
    try{
      const{data:outboxId,error}=await sb.rpc('clinician_send_message_push',{p_patient:id,p_body:body});
      if(error)throw error;
      const ok=await dispatch(outboxId);await openPatient(id);
      $('patientDetail').querySelector('[data-tab="chat"]')?.click();
      out($('chatMsg'),ok?'Messaggio registrato; push accettata da FCM. Lettura da verificare.':'Messaggio registrato nella conversazione; push non confermata. Controlla Notifiche inviate.',ok);
    }catch(e){out($('chatMsg'),'Invio non riuscito: '+(e.message||'Riprova.'));button.disabled=false;}
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
  document.querySelectorAll('.open-clinician-report').forEach(button=>button.onclick=async()=>{button.disabled=true;const report=(reports.data||[]).find(r=>r.id===button.dataset.report);try{if(!report?.medical_report_files?.length)throw new Error('Nessun file associato.');for(const file of [...report.medical_report_files].sort((a,b)=>a.page_number-b.page_number)){const {data,error}=await sb.storage.from('medical-reports').createSignedUrl(file.storage_path,120);if(error)throw error;window.open(data.signedUrl,'_blank','noopener');}}catch(e){out($('reportsMsg'),e.message||'Impossibile aprire il referto.');}finally{button.disabled=false}});
  $('openProtocols').onclick=()=>document.querySelector('[data-view="protocols"]')?.click();
  $('createPatientProtocol').onclick=async()=>{const name=$('patientNewProtocolName').value.trim();if(!name)return out($('setMsg'),'Inserisci il nome del protocollo.');const uid=(await sb.auth.getUser()).data.user.id;const{data:newProtocol,error}=await sb.from('monitoring_protocols').insert({clinician_id:uid,name,description:'Creato dal profilo di '+(p?.full_name||'paziente'),checkin_enabled:true,checkin_time:$('setTime').value||'09:00',checkin_frequency:'daily',checkin_weekdays:[0,1,2,3,4,5,6],alert_on_yellow:$('setYellow').checked,alert_on_red:$('setRed').checked,medication_reminder_enabled:true,followup_reminder_offsets:[7,1,0]}).select().single();if(error)return out($('setMsg'),error.message);out($('setMsg'),'Protocollo aggiunto. Ora puoi selezionarlo e applicarlo.',true);setTimeout(()=>openPatient(id),500);};
  const review=$('protocolReview');
  $('patientProtocol').onchange=()=>{review.classList.add('hidden');review.innerHTML='';};
  $('applyProto').onclick=()=>{
    const pid=$('patientProtocol').value,proto=(protos.data||[]).find(x=>x.id===pid);
    if(!proto)return out($('setMsg'),'Seleziona un protocollo.');
    const medRows=(proto.medication_plan||[]).map((m,i)=>`<div class="item reviewed-med"><label><input type="checkbox" class="rm-on" checked> Terapia ${i+1}</label><div class="two"><div class="field"><label>Farmaco</label><input class="rm-name" value="${esc(m.name||'')}"></div><div class="field"><label>Dose</label><input class="rm-dose" value="${esc(m.dose||'')}"></div></div><div class="two"><div class="field"><label>Via</label><input class="rm-route" value="${esc(m.route||'')}"></div><div class="field"><label>Orari (HH:MM separati da virgole)</label><input class="rm-times" value="${esc((m.times||[]).join(','))}"></div></div><div class="two"><div class="field"><label>Giorni dalla prestazione</label><input class="rm-start" type="number" min="0" max="9999" value="${esc(m.starts_in_days??0)}"></div><div class="field"><label>Durata giorni (vuoto: continuativa)</label><input class="rm-duration" type="number" min="1" max="9999" value="${esc(m.duration_days??'')}"></div></div><div class="field"><label>Istruzioni</label><input class="rm-instr" value="${esc(m.instructions||'')}"></div></div>`).join('');
    const fuRows=(proto.followup_plan||[]).map((f,i)=>`<div class="item reviewed-fu"><label><input type="checkbox" class="rf-on" checked> Controllo ${i+1}</label><div class="two"><div class="field"><label>Controllo</label><input class="rf-label" value="${esc(f.label||'')}"></div><div class="field"><label>Tipo</label><input class="rf-type" value="${esc(f.type||'controllo')}"></div></div><div class="field"><label>Giorni dalla prestazione</label><input class="rf-days" type="number" min="0" max="9999" value="${esc(f.after_days??0)}"></div><div class="field"><label>Note</label><input class="rf-notes" value="${esc(f.notes||'')}"></div></div>`).join('');
    review.innerHTML=`<h3>Conferma clinica · ${esc(proto.name)}</h3><p class="small muted">Controlli e inizio delle terapie sono calcolati dalla data della prestazione. Seleziona, correggi o escludi ogni elemento prima dell'invio. I modelli GISE sono supporto al follow-up e non prescrizioni automatiche.</p><div class="field"><label>Data della prestazione eseguita ${procedure.data?.procedure_label?`· ${esc(procedure.data.procedure_label)}`:''}</label><input id="procedureDateReview" type="date" required value="${esc(procedure.data?.performed_on||'')}" max="${new Date().toLocaleDateString('en-CA',{timeZone:'Europe/Rome'})}"></div><h4>Controlli</h4>${fuRows||'<p class="small muted">Nessun controllo previsto dal template.</p>'}<h4>Terapie · conferma individuale</h4><div id="reviewMedRows">${medRows}</div><button type="button" class="btn secondary" id="addReviewedMed">＋ Aggiungi terapia dopo valutazione</button><p class="small muted">Le indicazioni GISE supportano il controllo; farmaco, dose e durata dipendono dal singolo paziente e vanno prescritti dal medico.</p><div id="previewDates" class="small muted"></div><div class="field"><label>Nota del medico</label><textarea id="reviewNote" rows="2" placeholder="Motivi delle personalizzazioni"></textarea></div><button id="confirmReviewedProtocol" class="btn" type="button">Conferma e invia al paziente</button><div id="reviewMsg"></div>`;
    review.classList.remove('hidden');review.scrollIntoView({behavior:'smooth',block:'nearest'});
    $('confirmReviewedProtocol').onclick=async()=>{
      const day=$('procedureDateReview').value,today=new Date().toLocaleDateString('en-CA',{timeZone:'Europe/Rome'});
      if(!day||day>today)return out($('reviewMsg'),'Inserisci una data della prestazione valida.');
      const meds=[...review.querySelectorAll('.reviewed-med')].filter(r=>r.querySelector('.rm-on').checked).map(r=>({name:r.querySelector('.rm-name').value.trim(),dose:r.querySelector('.rm-dose').value.trim(),route:r.querySelector('.rm-route').value.trim(),times:r.querySelector('.rm-times').value.split(',').map(t=>t.trim()).filter(Boolean),starts_in_days:Number(r.querySelector('.rm-start').value),duration_days:r.querySelector('.rm-duration').value?Number(r.querySelector('.rm-duration').value):null,instructions:r.querySelector('.rm-instr').value.trim()}));
      const followups=[...review.querySelectorAll('.reviewed-fu')].filter(r=>r.querySelector('.rf-on').checked).map(r=>({label:r.querySelector('.rf-label').value.trim(),type:r.querySelector('.rf-type').value.trim(),after_days:Number(r.querySelector('.rf-days').value),notes:r.querySelector('.rf-notes').value.trim(),reminder_offsets:proto.followup_reminder_offsets||[7,1,0]}));
      if(meds.some(m=>!m.name||!Number.isInteger(m.starts_in_days)||m.starts_in_days<0||m.starts_in_days>9999||m.duration_days!==null&&(!Number.isInteger(m.duration_days)||m.duration_days<1)||m.times.some(t=>!/^([01]\d|2[0-3]):[0-5]\d$/.test(t)))||followups.some(f=>!f.label||!Number.isInteger(f.after_days)||f.after_days<0||f.after_days>9999))return out($('reviewMsg'),'Correggi nomi, giorni e orari prima di confermare.');
      if(!meds.length&&!followups.length)return out($('reviewMsg'),'Seleziona almeno un controllo o una terapia.');
      if(!confirm(`Confermi ${meds.length} terapie e ${followups.length} controlli per ${p?.full_name||'il paziente'} a partire dal ${day}?`))return;
      const button=$('confirmReviewedProtocol');button.disabled=true;
      try{const{data,error}=await sb.rpc('apply_reviewed_protocol_to_patient',{p_patient:id,p_protocol:pid,p_procedure_date:day,p_medication_plan:meds,p_followup_plan:followups,p_note:$('reviewNote').value.trim()||null});if(error)throw error;
        let pushed=false;if(data?.outbox_id)pushed=await dispatch(data.outbox_id);
        out($('reviewMsg'),`Piano confermato: ${data.medications_created} terapie e ${data.followups_created} controlli. ${pushed?'Push accettata dal servizio; consegna sul dispositivo da verificare.':'Notifica registrata nell’app.'}`,true);setTimeout(()=>openPatient(id),1800);
      }catch(e){out($('reviewMsg'),e.message||'Applicazione non riuscita.');button.disabled=false;}
    };
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
   $('linkRequestList').innerHTML=(reqs||[]).map(r=>`<div class="item"><div class="row"><b>${esc(map[r.patient_id]||'Paziente')}</b><span class="pill">${esc(r.status)}</span></div><div class="small muted">${fmt(r.created_at)}${r.procedure_label?' · '+esc(r.procedure_label)+' · '+esc(r.performed_on||''):''}</div>${r.status==='Pending'?`<div class="row" style="margin-top:8px"><button class="btn accept-link" data-id="${r.id}">Accetta</button><button class="btn danger reject-link" data-id="${r.id}">Rifiuta</button></div>`:''}</div>`).join('')||'<p class="muted">Nessuna richiesta.</p>';
   document.querySelectorAll('.accept-link').forEach(b=>b.onclick=()=>reviewLink(b.dataset.id,true));document.querySelectorAll('.reject-link').forEach(b=>b.onclick=()=>reviewLink(b.dataset.id,false));
 }
 if(ie){$('careImportList').innerHTML='<div class="err">'+esc(ie.message)+'</div>';}else{
   const ids=[...new Set((imports||[]).map(x=>x.patient_id))];let map={};if(ids.length){const{data:p}=await sb.from('profiles').select('id,full_name').in('id',ids);for(const x of p||[])map[x.id]=x.full_name;}
   $('careImportList').innerHTML=(imports||[]).map(x=>`<div class="item"><div class="row"><b>${esc(map[x.patient_id]||'Paziente')}</b><span class="pill">${esc(x.item_type)}</span></div><div>${esc(x.title)}</div><div class="small muted">${esc(x.source_type)} · ${fmt(x.created_at)}</div><button class="btn secondary open-import-patient" data-patient="${x.patient_id}" style="margin-top:8px">Apri paziente</button></div>`).join('')||'<p class="muted">Nessun elemento da verificare.</p>';document.querySelectorAll('.open-import-patient').forEach(b=>b.onclick=()=>{document.querySelector('[data-view="patients"]').click();openPatient(b.dataset.patient)});
 }
}
const PROCEDURE_DOCUMENT='/nomenclatori.html';
const PROCEDURE_INDEX_URL='/nomenclatore-index.json';
function careRow(kind, value={}){
 const med=kind==='med', row=document.createElement('div');row.className='item care-'+kind;
 row.innerHTML=med?
 `<div class="two"><label class="field">Farmaco AIFA<input class="name" value="${esc(value.name||'')}" placeholder="Cerca nome o principio attivo"></label><label class="field">Dose<input class="dose" value="${esc(value.dose||'')}"></label></div><div class="results"></div><div class="two"><label class="field">Via<input class="route" value="${esc(value.route||'Orale')}"></label><label class="field">Orari HH:MM<input class="times" value="${esc((value.times||[]).join(','))}" placeholder="08:00,20:00"></label></div><div class="two"><label class="field">Inizio dopo (giorni)<input class="start" type="number" min="0" value="${esc(value.starts_in_days??0)}"></label><label class="field">Durata (giorni)<input class="duration" type="number" min="1" value="${esc(value.duration_days??'')}"></label></div><label class="field">Istruzioni<input class="instructions" value="${esc(value.instructions||'')}"></label>`:
 `<div class="two"><label class="field">Controllo<input class="name" value="${esc(value.label||'')}"></label><label class="field">Tipo<input class="type" value="${esc(value.type||'controllo')}"></label></div><div class="two"><label class="field">Giorni dalla prestazione<input class="days" type="number" min="0" value="${esc(value.after_days??30)}"></label><label class="field">Promemoria giorni prima<input class="reminders" value="${esc((value.reminder_offsets||[7,1,0]).join(','))}"></label></div><label class="field">Note<input class="notes" value="${esc(value.notes||'')}"></label>`;
 row.insertAdjacentHTML('afterbegin','<div class="care-row-head">'+(med?'Terapia proposta':'Controllo proposto')+'</div>');
 row.innerHTML+='<button type="button" class="btn danger remove">Rimuovi</button>';
 $('care'+(med?'Med':'Follow')+'Rows').appendChild(row);row.querySelector('.remove').onclick=()=>row.remove();
 if(med){let timer;row.querySelector('.name').oninput=()=>{clearTimeout(timer);const q=row.querySelector('.name').value.trim(),box=row.querySelector('.results');if(q.length<2){box.innerHTML='';return}
 timer=setTimeout(async()=>{try{const token=(await sb.auth.getSession()).data.session?.access_token;if(!token)throw Error('Sessione scaduta');
 const response=await fetch(SUPABASE_URL+'/functions/v1/drug-catalog?q='+encodeURIComponent(q),{headers:{Authorization:'Bearer '+token}}),result=await response.json();if(!response.ok)throw Error(result.error||'Catalogo non disponibile');
 box.innerHTML=result.items.map((x,i)=>`<button type="button" class="btn secondary drug-choice" data-i="${i}">${esc(x.name)} · ${esc(x.active||'')} · AIC ${esc(x.aic)}</button>`).join('')||'<span class="muted small">Nessun risultato</span>';
 box.querySelectorAll('.drug-choice').forEach(button=>button.onclick=()=>{row.querySelector('.name').value=result.items[Number(button.dataset.i)].name;box.innerHTML=''});
 }catch(e){box.textContent=e.message||'Errore catalogo'}},300);
 }}}
async function reviewLink(id,accept){
 if(!accept){const{error}=await sb.rpc('clinician_review_link_request',{p_request:id,p_accept:false,p_note:null});if(error)return alert(error.message);await loadPatients();await loadRequests();await loadOverview();return}
 const uid=(await sb.auth.getUser()).data.user.id;
 const {data:request,error:requestError}=await sb.from('patient_clinician_requests').select('patient_id,status').eq('id',id).eq('clinician_id',uid).maybeSingle();
 if(requestError||!request||request.status!=='Pending')return alert('Richiesta non disponibile o già gestita.');
 const {data:patient}=await sb.from('profiles').select('full_name').eq('id',request.patient_id).maybeSingle();
 const {data:protos,error}=await sb.from('monitoring_protocols').select('*').eq('clinician_id',uid).eq('is_active',true);
 if(error)return alert(error.message);
 const index=await fetch(PROCEDURE_INDEX_URL).then(r=>{if(!r.ok)throw Error('HTTP '+r.status);return r.json()}).catch(()=>({items:[]}));
 let panel=$('careReviewPanel');if(!panel){panel=document.createElement('section');panel.id='careReviewPanel';panel.className='card section';$('linkRequestList').after(panel)}
 panel.innerHTML=`<h3>Prestazione e piano di follow-up · ${esc(patient?.full_name||'Paziente')}</h3><p class="muted">Indica cosa è stato eseguito e quando. Controlla e modifica farmaci e controlli prima dell'invio.</p>
 <p><a href="${PROCEDURE_DOCUMENT}" target="_blank" rel="noopener noreferrer">Consulta i nomenclatori e scarica il PDF ufficiale</a></p>
 <label class="field">Cerca tra le prestazioni del Ministero<input id="careSearch" placeholder="Es. visita cardiologica"></label><div id="careCodes"></div>
 <div class="two"><label class="field">Codice, se presente nel nomenclatore<input id="careCode" maxlength="60" placeholder="Es. 89.7A.3"></label><label class="field">Data prestazione<input id="careDate" type="date"></label></div>
 <label class="field">Prestazione eseguita<input id="careLabel" maxlength="500" placeholder="Descrizione esatta"></label>
 <p class="muted small">Le procedure ospedaliere potrebbero non figurare nel nomenclatore ambulatoriale: descrivile senza attribuire un codice improprio.</p>
 <label class="field">Protocollo di partenza<select id="careProtocol"><option value="">Piano personalizzato vuoto</option>${(protos||[]).map(p=>`<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select></label>
 <h4>Farmaci</h4><div id="careMedRows"></div><button type="button" id="careAddMed" class="btn secondary">Aggiungi farmaco</button>
 <h4>Controlli</h4><div id="careFollowRows"></div><button type="button" id="careAddFollow" class="btn secondary">Aggiungi controllo</button>
 <label class="field">Nota clinica interna<textarea id="careNote" rows="2"></textarea></label>
 <div class="row"><button type="button" id="careConfirm" class="btn">Conferma e invia al paziente</button><button type="button" id="careCancel" class="btn secondary">Annulla</button></div><div id="careResult" role="status" aria-live="polite"></div>`;
 $('careDate').max=new Date().toLocaleDateString('en-CA',{timeZone:'Europe/Rome'});
 panel.scrollIntoView({behavior:'smooth',block:'start'});
 $('careSearch').oninput=()=>{const q=$('careSearch').value.toLowerCase().trim();$('careCodes').innerHTML=q.length<2?'':(index.items||[]).filter(p=>(p.code+' '+p.label).toLocaleLowerCase('it-IT').includes(q)).slice(0,30).map(p=>`<button type="button" class="btn secondary code-choice" data-code="${esc(p.code)}" data-label="${esc(p.label)}">${esc(p.code)} · ${esc(p.label)} (pag. ${p.page})</button>`).join('')||'<p class="muted small">Nessun risultato nell’indice; consulta il PDF completo.</p>';$('careCodes').querySelectorAll('.code-choice').forEach(button=>button.onclick=()=>{$('careCode').value=button.dataset.code;$('careLabel').value=button.dataset.label})};
 $('careProtocol').onchange=()=>{const p=(protos||[]).find(x=>x.id===$('careProtocol').value);$('careMedRows').innerHTML='';$('careFollowRows').innerHTML='';(p?.medication_plan||[]).forEach(v=>careRow('med',v));(p?.followup_plan||[]).forEach(v=>careRow('follow',v))};
 $('careAddMed').onclick=()=>careRow('med');$('careAddFollow').onclick=()=>careRow('follow');$('careCancel').onclick=()=>panel.remove();
 $('careConfirm').onclick=async()=>{
  const date=$('careDate').value,label=$('careLabel').value.trim();if(!date||!label||date>$('careDate').max)return out($('careResult'),'Indica prestazione e data non futura.');
  const meds=[...panel.querySelectorAll('.care-med')].map(r=>({name:r.querySelector('.name').value.trim(),dose:r.querySelector('.dose').value.trim(),route:r.querySelector('.route').value.trim(),times:r.querySelector('.times').value.split(',').map(x=>x.trim()).filter(Boolean),starts_in_days:Number(r.querySelector('.start').value||0),duration_days:r.querySelector('.duration').value?Number(r.querySelector('.duration').value):null,instructions:r.querySelector('.instructions').value.trim()}));
  const follow=[...panel.querySelectorAll('.care-follow')].map(r=>({label:r.querySelector('.name').value.trim(),type:r.querySelector('.type').value.trim(),after_days:Number(r.querySelector('.days').value||0),reminder_offsets:r.querySelector('.reminders').value.split(',').map(Number),notes:r.querySelector('.notes').value.trim()}));
  if(meds.some(m=>!m.name||!m.dose||m.starts_in_days<0||m.duration_days!==null&&m.duration_days<1||m.times.some(t=>!/^([01]\d|2[0-3]):[0-5]\d$/.test(t)))||follow.some(f=>!f.label||f.after_days<0||f.reminder_offsets.some(n=>!Number.isInteger(n)||n<0)))return out($('careResult'),'Rivedi dosi, orari e tempi dei controlli.');
  $('careConfirm').disabled=true;out($('careResult'),'Salvataggio in corso…');
  const {data,error:saveError}=await sb.rpc('review_link_with_care',{p_request:id,p_procedure_code:$('careCode').value.trim(),p_procedure_label:label,p_performed_on:date,p_protocol:$('careProtocol').value||null,p_medication_plan:meds,p_followup_plan:follow,p_note:$('careNote').value.trim()||null});
  if(saveError){$('careConfirm').disabled=false;return out($('careResult'),saveError.message)}
  const pushed=data?.outbox_id?await dispatch(data.outbox_id):false;
  await loadPatients();await loadRequests();await loadOverview();
  alert(pushed?'Piano inviato. Push accettata dal servizio; lettura da verificare.':'Piano inviato. Push non confermata; verifica Notifiche inviate.');
 };
}

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
  el.innerHTML='<div class="care-row-head">Farmaco previsto</div><div class="two">'+'<div class="field"><label>Farmaco</label><input class="pm-name" placeholder="Nome / AIFA" value="'+esc(v.name||'')+'"></div><div class="field"><label>Dose</label><input class="pm-dose" placeholder="Es. 100 mg" value="'+esc(v.dose||'')+'"></div></div>'+
    '<div class="two"><div class="field"><label>Via</label><input class="pm-route" value="'+esc(v.route||'Orale')+'"></div><div class="field"><label>Orari</label><input class="pm-times" placeholder="08:00,20:00" value="'+esc((v.times||[]).join(','))+'"></div></div>'+
    '<div class="two"><div class="field"><label>Inizio dopo (giorni)</label><input class="pm-start" type="number" min="0" value="'+esc(v.starts_in_days??0)+'"></div><div class="field"><label>Durata (giorni, vuoto = continuativa)</label><input class="pm-duration" type="number" min="1" value="'+esc(v.duration_days??'')+'"></div></div>'+
    '<div class="field"><label>Istruzioni</label><input class="pm-instr" value="'+esc(v.instructions||'')+'"></div><button type="button" class="btn danger proto-remove">Rimuovi</button>';
  box.appendChild(el);el.querySelector('.proto-remove').onclick=()=>el.remove();
}
function addProtoFollowRow(v={}){
  const box=$('protoFollowList'); if(!box)return;
  const el=document.createElement('div');el.className='item proto-follow-row';
  el.innerHTML='<div class="care-row-head">Controllo previsto</div><div class="two">'+'<div class="field"><label>Controllo</label><input class="pf-label" placeholder="Es. Visita cardiologica" value="'+esc(v.label||'')+'"></div><div class="field"><label>Tipo</label><input class="pf-type" value="'+esc(v.type||'controllo')+'"></div></div>'+
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
    resetProtocolEditor();
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

function resetProtocolEditor(){
  editingProtocol=null;$('protoName').value='';$('protoDesc').value='';$('protoTime').value='09:00';$('protoOffsets').value='7,1,0';$('protoYellow').checked=false;$('protoMissed').checked=false;$('protoShared').checked=true;clearProtocolPlan();$('saveProto').textContent='Salva protocollo';$('cancelProtoEdit').classList.add('hidden');
}
$('cancelProtoEdit').onclick=resetProtocolEditor;
async function loadProtocols(){
  const uid=(await sb.auth.getUser()).data.user?.id;if(!uid)return;
  $('adminProtocolOption').classList.toggle('hidden',me?.role!=='Administrator');
  const {data,error}=await sb.from('monitoring_protocols').select('*').or('clinician_id.eq.'+uid+',and(is_shared.eq.true,clinician_id.neq.'+uid+')').order('created_at',{ascending:false});
  renderGiseTemplates();
  if(error){$('protocolList').innerHTML='<p class="err">'+esc(error.message)+'</p>';return;}
  $('protocolList').innerHTML=(data||[]).map(x=>{
    const own=x.clinician_id===uid,shared=x.is_shared&&!own;
    return `<div class="item"><b>${esc(x.name)}</b><div class="row" style="margin:8px 0"><span class="pill">${shared?'Modello amministratore':x.is_shared?'Condiviso':'Personale'}</span><span class="pill">${x.is_active?'Attivo':'Archiviato'}</span><span class="pill">${(x.medication_plan||[]).length} terapie</span><span class="pill">${(x.followup_plan||[]).length} controlli</span></div><div class="small muted">${esc(x.description||'')} · check-in ${esc(x.checkin_time?.slice(0,5)||'09:00')}</div><div class="row" style="margin-top:10px"><button type="button" class="btn secondary open-saved-proto" data-id="${x.id}">Apri</button>${shared?`<button type="button" class="btn copy-shared-proto" data-id="${x.id}">Copia e personalizza</button>`:own?`<button type="button" class="btn secondary edit-saved-proto" data-id="${x.id}">Modifica</button><button type="button" class="btn secondary status-saved-proto" data-id="${x.id}">${x.is_active?'Archivia':'Riattiva'}</button>`:''}</div><div class="saved-proto-detail hidden" id="saved-${x.id}"><div class="small">${(x.followup_plan||[]).map(f=>`<p>📅 ${esc(f.label)} · dopo ${esc(f.after_days)} giorni</p>`).join('')||'Nessun controllo.'}${(x.medication_plan||[]).map(m=>`<p>💊 ${esc(m.name)} · ${esc(m.dose||'dose da confermare')}</p>`).join('')}</div>${own&&x.is_active?`<button type="button" class="btn apply-saved-proto" data-id="${x.id}">Rivedi per il paziente</button>`:''}</div></div>`;
  }).join('')||'<p class="muted">Nessun protocollo disponibile.</p>';
  document.querySelectorAll('.open-saved-proto').forEach(b=>b.onclick=()=>{const detail=$('saved-'+b.dataset.id);detail.classList.toggle('hidden');b.textContent=detail.classList.contains('hidden')?'Apri':'Chiudi';});
  document.querySelectorAll('.apply-saved-proto').forEach(b=>b.onclick=async()=>{if(!selected)return out($('protoMsg'),'Apri prima il paziente dalla sezione Pazienti, poi torna ai Protocolli.');document.querySelector('[data-view="patients"]').click();await openPatient(selected);$('patientProtocol').value=b.dataset.id;$('patientDetail').querySelector('[data-tab="settings"]')?.click();$('applyProto').click();});
  document.querySelectorAll('.copy-shared-proto').forEach(b=>b.onclick=async()=>{
    const x=data.find(p=>p.id===b.dataset.id);if(!x||!x.is_shared||!x.is_active||me?.role!=='Clinician')return;
    const row={clinician_id:uid,name:x.name,description:x.description,source_reference:x.source_reference||'Modello condiviso dall’amministratore',is_shared:false,checkin_enabled:x.checkin_enabled,checkin_time:x.checkin_time,checkin_frequency:x.checkin_frequency,checkin_weekdays:x.checkin_weekdays,reasons_catalog:x.reasons_catalog,alert_on_yellow:x.alert_on_yellow,alert_on_red:x.alert_on_red,missed_checkin_alert:x.missed_checkin_alert,medication_reminder_enabled:x.medication_reminder_enabled,followup_reminder_offsets:x.followup_reminder_offsets,medication_plan:x.medication_plan,followup_plan:x.followup_plan};
    b.disabled=true;const{error}=await sb.from('monitoring_protocols').insert(row);b.disabled=false;
    if(error)return out($('protoMsg'),error.message);
    out($('protoMsg'),'Copia personale creata. Rivedi il piano prima di applicarlo.',true);await loadProtocols();
  });
  document.querySelectorAll('.edit-saved-proto').forEach(b=>b.onclick=()=>{
    const x=data.find(p=>p.id===b.dataset.id);if(!x||x.clinician_id!==uid)return;
    editingProtocol=x.id;$('protoName').value=x.name;$('protoDesc').value=x.description||'';$('protoTime').value=(x.checkin_time||'09:00').slice(0,5);$('protoOffsets').value=(x.followup_reminder_offsets||[7,1,0]).join(',');$('protoYellow').checked=!!x.alert_on_yellow;$('protoMissed').checked=!!x.missed_checkin_alert;$('protoShared').checked=!!x.is_shared;clearProtocolPlan();(x.medication_plan||[]).forEach(addProtoMedRow);(x.followup_plan||[]).forEach(addProtoFollowRow);$('saveProto').textContent='Salva modifiche';$('cancelProtoEdit').classList.remove('hidden');$('protoName').scrollIntoView({behavior:'smooth',block:'center'});
  });
  document.querySelectorAll('.status-saved-proto').forEach(b=>b.onclick=async()=>{const x=data.find(p=>p.id===b.dataset.id);if(!x||x.clinician_id!==uid)return;if(x.is_active&&!confirm('Archiviare questo protocollo? I percorsi già assegnati non vengono cancellati.'))return;const{error}=await sb.from('monitoring_protocols').update({is_active:!x.is_active}).eq('id',x.id).eq('clinician_id',uid);if(error)return out($('protoMsg'),error.message);await loadProtocols();});
}
$('saveProto').onclick=async()=>{
  const name=$('protoName').value.trim();if(!name)return out($('protoMsg'),'Inserisci il nome.');
  const offsets=$('protoOffsets').value.split(',').map(x=>Number(x.trim())).filter(x=>Number.isInteger(x)&&x>=0&&x<=365);if(!offsets.length)return out($('protoMsg'),'Indica almeno un numero di giorni valido.');
  const uid=(await sb.auth.getUser()).data.user.id,plan=readProtocolPlan();
  const payload={name,description:$('protoDesc').value.trim(),is_shared:me.role==='Administrator'&&$('protoShared').checked,checkin_enabled:true,checkin_time:$('protoTime').value||'09:00',checkin_frequency:'daily',checkin_weekdays:[0,1,2,3,4,5,6],alert_on_yellow:$('protoYellow').checked,alert_on_red:true,missed_checkin_alert:$('protoMissed').checked,medication_reminder_enabled:true,followup_reminder_offsets:offsets,medication_plan:plan.medication_plan,followup_plan:plan.followup_plan,source_reference:$('protoDesc').value.includes('Fonte:')?'SICI-GISE / template verificato dal medico':null};
  const{error}=editingProtocol?await sb.from('monitoring_protocols').update(payload).eq('id',editingProtocol).eq('clinician_id',uid):await sb.from('monitoring_protocols').insert({...payload,clinician_id:uid});
  if(error)return out($('protoMsg'),error.message);out($('protoMsg'),'Protocollo salvato con '+plan.medication_plan.length+' farmaci e '+plan.followup_plan.length+' controlli.',true);resetProtocolEditor();await loadProtocols();
};

const{data:{session}}=await sb.auth.getSession();if(session)boot();
initVoiceCommands({$,sb,getPatients:()=>patients,getSelected:()=>selected,openPatient,romeDay,esc,getRole:()=>me?.role});
if('serviceWorker' in navigator && location.protocol==='https:')navigator.serviceWorker.register('/clinica-sw.js').catch(error=>console.warn('Installazione app non disponibile',error));
let clinicianInstallPrompt=null;
const installButton=$('installClinicianApp');
window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();clinicianInstallPrompt=event;installButton.classList.remove('hidden');});
installButton.onclick=async()=>{if(clinicianInstallPrompt){const prompt=clinicianInstallPrompt;clinicianInstallPrompt=null;installButton.classList.add('hidden');await prompt.prompt();return;}alert('Su iPhone: apri Safari, tocca Condividi e poi “Aggiungi alla schermata Home”.');};
if(/iPhone|iPad|iPod/.test(navigator.userAgent)&&!navigator.standalone)installButton.classList.remove('hidden');
window.addEventListener('appinstalled',()=>installButton.classList.add('hidden'));
}
