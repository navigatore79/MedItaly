import {createClient} from 'https://esm.sh/@supabase/supabase-js@2.116.0';
const db=createClient('https://ejlhgtodmcadmdhbujkf.supabase.co','sb_publishable_QoVgKCNOTSbrXFgXdusqfA_5_OM5jwM');
const $=id=>document.getElementById(id),esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let user=null;
const say=s=>$('message').textContent=s;
$('loginForm').onsubmit=async e=>{e.preventDefault();const b=e.currentTarget.querySelector('button');b.disabled=true;try{const {error}=await db.auth.signInWithPassword({email:$('email').value.trim(),password:$('password').value});if(error)throw error;$('password').value='';await boot();}catch(e){say(e.message);}finally{b.disabled=false;}};
$('logout').onclick=async()=>{await db.auth.signOut();location.reload();};
async function mfa(){
 $('mfa').hidden=false;$('workspace').hidden=true;
 const {data,error}=await db.auth.mfa.listFactors();if(error)throw error;
 let factor=data.totp.find(x=>x.status==='verified')||data.totp[0];
 if(!factor){$('mfa').innerHTML='<h2>Proteggi l’accesso</h2><p>Configura il secondo fattore con un’app Authenticator.</p><button id="enroll">Configura secondo fattore</button>';$('enroll').onclick=async()=>{try{const {data,error}=await db.auth.mfa.enroll({factorType:'totp',friendlyName:'Meditaly Centro'});if(error)throw error;factor=data;$('mfa').replaceChildren();const image=new Image();image.alt='Codice QR per configurare il secondo fattore';image.src=data.totp.qr_code;$('mfa').append(image);code(factor);}catch(e){say(e.message);}};
 }else code(factor);
}
function code(factor){
 $('mfa').insertAdjacentHTML('beforeend','<form id="otpForm"><label>Codice Authenticator<input id="otp" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required></label><button>Verifica</button></form>');
 $('otpForm').onsubmit=async e=>{e.preventDefault();const b=e.currentTarget.querySelector('button');b.disabled=true;const {error}=await db.auth.mfa.challengeAndVerify({factorId:factor.id,code:$('otp').value});if(error){say('Codice non valido o scaduto. Riprova.');b.disabled=false;return;}await db.auth.refreshSession();await boot();};
}
async function boot(){
 say('');const {data:{user:u},error}=await db.auth.getUser();if(error&&!u)return;if(!u)return;user=u;$('access').hidden=true;
 const assurance=await db.auth.mfa.getAuthenticatorAssuranceLevel();if(assurance.error)throw assurance.error;if(assurance.data.currentLevel!=='aal2'){await mfa();return;}
 $('mfa').hidden=true;
 const [membership,profile,centers]=await Promise.all([db.from('center_managers').select('center_id,active').eq('user_id',user.id).eq('active',true),db.from('profiles').select('role,account_active').eq('id',user.id).single(),db.rpc('list_patient_centers')]);
 for(const result of [membership,profile,centers])if(result.error)throw result.error;
 if(!profile.data.account_active)throw Error('Account non attivo.');
 const ids=new Set(membership.data.map(x=>x.center_id)),list=centers.data.filter(x=>profile.data.role==='Administrator'||ids.has(x.id));
 $('workspace').hidden=false;$('center').innerHTML=list.map(c=>`<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('');
 if(!list.length){say('Il tuo account non ha ancora un centro abilitato. Contatta l’amministratore.');$('dashboard').replaceChildren();return;}
 $('center').onchange=load;$('refresh').onclick=load;await load();
}
async function load(){
 $('dashboard').textContent='Caricamento…';say('');
 const {data,error}=await db.rpc('center_management_dashboard',{p_center:$('center').value});if(error){$('dashboard').replaceChildren();say(error.message);return;}
 $('dashboard').innerHTML=`<h2>${esc(data.center)}</h2><p class="stats">${data.patients.length} pazienti associati · ${data.requests.length} richieste in attesa</p><div class="panel"><h3>Richieste di associazione</h3>${data.requests.map(r=>`<article><strong>${esc(r.name)}</strong><span>${esc(new Date(r.created_at).toLocaleDateString('it-IT'))}</span><button data-request="${esc(r.id)}" data-accept="true">Accetta</button><button class="reject" data-request="${esc(r.id)}" data-accept="false">Rifiuta</button></article>`).join('')||'<p>Nessuna richiesta in attesa.</p>'}</div><div class="panel"><h3>Pazienti del centro</h3>${data.patients.map(p=>`<article><strong>${esc(p.name)}</strong><span>Associato al centro</span></article>`).join('')||'<p>Nessun paziente associato.</p>'}</div>`;
 $('dashboard').querySelectorAll('[data-request]').forEach(b=>b.onclick=async()=>{const buttons=[...$('dashboard').querySelectorAll('[data-request]')];buttons.forEach(x=>x.disabled=true);const {error}=await db.rpc('center_respond_patient_request',{p_request:b.dataset.request,p_accept:b.dataset.accept==='true'});if(error){say(error.message);buttons.forEach(x=>x.disabled=false);return;}await load();say('Richiesta aggiornata.');});
}
boot().catch(e=>say(e.message));
