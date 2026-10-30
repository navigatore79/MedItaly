const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const folded=value=>String(value||'').normalize('NFD').replace(/\p{Diacritic}/gu,'').toLocaleLowerCase('it-IT');
const romeDay=date=>new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Rome',year:'numeric',month:'2-digit',day:'2-digit'}).format(date);

export function conversationTime(value,now=new Date()) {
  if (!value) return '';
  const date=new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  if (romeDay(date)===romeDay(now)) return new Intl.DateTimeFormat('it-IT',{timeZone:'Europe/Rome',hour:'2-digit',minute:'2-digit'}).format(date);
  const yesterday=new Date(romeDay(now)+'T12:00:00Z');yesterday.setUTCDate(yesterday.getUTCDate()-1);
  if (romeDay(date)===romeDay(yesterday)) return 'Ieri';
  return new Intl.DateTimeFormat('it-IT',{timeZone:'Europe/Rome',day:'2-digit',month:'2-digit',...(romeDay(date).slice(0,4)!==romeDay(now).slice(0,4)?{year:'2-digit'}:{})}).format(date);
}

export function createPatientConversations({db,host,getOwnerId,onChat,onRecord,onCompose}) {
  let rows=[],query='',unreadOnly=false,version=0,loaded=false,failed=false;
  host.innerHTML=`<div class="conversation-heading"><div><p class="eyebrow">IL TUO CENTRO · I TUOI PAZIENTI</p><h1>Comunicazioni</h1><p>Un elenco semplice. Ogni paziente, la sua conversazione.</p></div><button type="button" class="btn conversation-compose" aria-label="Nuova comunicazione"><span aria-hidden="true">＋</span><span class="conversation-compose-label"> Nuova comunicazione</span></button></div>
    <section class="conversation-panel" aria-label="Conversazioni dei pazienti"><div class="conversation-toolbar"><label class="conversation-search"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/></svg><span class="sr-only">Cerca un paziente</span><input type="search" placeholder="Cerca un paziente" autocomplete="off"></label><button type="button" class="conversation-refresh" aria-label="Aggiorna le conversazioni">↻</button></div>
    <div class="conversation-filters" role="group" aria-label="Filtra le conversazioni"><button type="button" data-filter="all" aria-pressed="true">Tutti <span class="conversation-total">0</span></button><button type="button" data-filter="unread" aria-pressed="false">Non lette <span class="conversation-unread-total">0</span></button></div>
    <p class="conversation-status" role="status" aria-live="polite"></p><ul class="conversation-list" aria-label="Elenco pazienti"></ul><p class="conversation-footer">Le comunicazioni restano individuali tra il paziente e il medico.</p></section>`;
  const list=host.querySelector('.conversation-list'),status=host.querySelector('.conversation-status'),refresh=host.querySelector('.conversation-refresh');
  host.querySelector('.conversation-compose').onclick=onCompose;
  host.querySelector('input').oninput=event=>{query=event.target.value;render();};
  host.querySelectorAll('[data-filter]').forEach(button=>button.onclick=()=>{unreadOnly=button.dataset.filter==='unread';host.querySelectorAll('[data-filter]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));render();});
  refresh.onclick=()=>load();
  function render() {
    const focused=document.activeElement?.closest('.conversation-row');
    const focusId=focused?.dataset.patient,focusRecord=document.activeElement?.classList.contains('conversation-record');
    const owner=getOwnerId();
    const visible=rows.filter(row=>(!unreadOnly||Number(row.unread_count)>0)&&folded(row.full_name).includes(folded(query)))
      .sort((a,b)=>(Date.parse(b.last_sent_at)||0)-(Date.parse(a.last_sent_at)||0)||String(a.full_name||'').localeCompare(String(b.full_name||''),'it',{sensitivity:'base'})||a.patient_id.localeCompare(b.patient_id));
    host.querySelector('.conversation-total').textContent=rows.length;
    host.querySelector('.conversation-unread-total').textContent=rows.filter(row=>Number(row.unread_count)>0).length;
    list.innerHTML=visible.map(row=>{
      const name=row.full_name||'Paziente',initials=name.trim().split(/\s+/).filter(Boolean).slice(0,2).map(word=>word[0]).join('').toUpperCase()||'P';
      const unread=Number(row.unread_count)||0,body=row.has_audio?'Messaggio vocale':row.last_body?.trim()||'Nessuna comunicazione. Scrivi al paziente.',prefix=row.last_sender_id===owner?'Tu: ':'';
      const time=conversationTime(row.last_sent_at),fullTime=row.last_sent_at?new Intl.DateTimeFormat('it-IT',{timeZone:'Europe/Rome',dateStyle:'long',timeStyle:'short'}).format(new Date(row.last_sent_at)):'';
      return `<li class="conversation-row${unread?' has-unread':''}" data-patient="${escape(row.patient_id)}"><button type="button" class="conversation-open" aria-label="Apri comunicazioni con ${escape(name)}${unread?', '+unread+' non lette':''}"><span class="conversation-avatar" aria-hidden="true">${escape(initials)}</span><span class="conversation-copy"><span class="conversation-name">${escape(name)}</span><span class="conversation-preview">${row.has_audio?'<span aria-hidden="true">♫ </span>':''}${escape(prefix+body)}</span></span><span class="conversation-meta"><time datetime="${escape(row.last_sent_at||'')}" title="${escape(fullTime)}">${escape(time)}</time>${unread?`<span class="conversation-badge" aria-label="${unread} comunicazioni non lette">${unread>99?'99+':unread}</span>`:''}</span></button><button type="button" class="conversation-record" aria-label="Apri scheda clinica di ${escape(name)}" title="Apri scheda clinica"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V2h6v2M9 10h6m-6 4h6m-6 4h3"/></svg><span>Scheda</span></button></li>`;
    }).join('')||`<li class="conversation-empty"><strong>${failed&&!loaded?'Elenco non disponibile':query?'Nessun paziente trovato':unreadOnly?'Tutto letto':loaded?'Il tuo elenco pazienti è qui':'Caricamento delle conversazioni…'}</strong><p>${failed&&!loaded?'Tocca Aggiorna per riprovare.':query?'Prova un altro nome o cognome.':unreadOnly?'Non ci sono comunicazioni da leggere.':loaded?'I pazienti compariranno dopo l’accettazione della richiesta al medico o al centro.':''}</p></li>`;
    list.querySelectorAll('.conversation-row').forEach(row=>{
      row.querySelector('.conversation-open').onclick=()=>open(row,onChat);
      row.querySelector('.conversation-record').onclick=()=>open(row,onRecord);
    });
    if(focusId)[...list.querySelectorAll('.conversation-row')].find(row=>row.dataset.patient===focusId)?.querySelector(focusRecord?'.conversation-record':'.conversation-open')?.focus({preventScroll:true});
  }
  async function open(row,action) {
    const buttons=[...row.querySelectorAll('button')];buttons.forEach(b=>b.disabled=true);
    try {await action(row.dataset.patient);}catch(error){status.textContent='Apertura non riuscita: '+(error?.message||'riprova.');}
    finally{buttons.filter(b=>b.isConnected).forEach(b=>b.disabled=false);}
  }
  async function load() {
    const request=++version;failed=false;refresh.disabled=true;list.setAttribute('aria-busy','true');
    if(!loaded){status.textContent='Caricamento delle conversazioni…';render();}
    try {
      const {data,error}=await db.rpc('clinician_conversation_summaries');
      if(request!==version)return;
      if(error)throw error;
      rows=Array.isArray(data)?data:[];loaded=true;status.textContent='';render();
    }catch(error){if(request===version){failed=true;status.textContent='Elenco non aggiornato. '+(error?.message||'Riprova con Aggiorna.');if(!loaded)render();}}
    finally{if(request===version){refresh.disabled=false;list.setAttribute('aria-busy','false');}}
  }
  return {load};
}
