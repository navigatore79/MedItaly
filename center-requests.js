const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

// Center enrollment lives inside the existing clinical requests page.
export async function renderClinicalCenterRequests(db, host, onAccepted) {
  host.replaceChildren();
  const message=document.createElement('p');
  message.setAttribute('role','status');
  const showError=error=>{message.textContent='Richieste del centro: '+(error?.message||'riprova tra poco.');};
  const {data:centers,error}=await db.rpc('list_my_managed_centers');
  if (error) {host.append(message);showError(error);return;}
  if (!centers?.length) return;
  host.innerHTML='<h2>Richieste al centro</h2><p class="muted">Accetta i pazienti che hanno inserito il codice del centro. Dopo l’approvazione li ritrovi nella dashboard completa.</p>';
  host.append(message);
  for (const center of centers) {
    const section=document.createElement('div');
    section.className='section';
    section.innerHTML=`<h3>${esc(center.name)}</h3><p class="small">Codice per i pazienti: <strong>${esc(center.code||'')}</strong></p>`;
    host.append(section);
    const {data,error}=await db.rpc('center_management_dashboard',{p_center:center.id});
    if (error) {const note=document.createElement('p');note.className='err';note.textContent=error.message;section.append(note);continue;}
    // The dashboard RPC is the authoritative source of the center code.
    section.querySelector('strong').textContent=data.code||center.code||'';
    const list=document.createElement('div');list.className='list';section.append(list);
    if (!data.requests?.length) {list.innerHTML='<p class="muted">Nessuna richiesta in attesa.</p>';continue;}
    for (const request of data.requests) {
      const row=document.createElement('div');row.className='item';
      row.innerHTML=`<b>${esc(request.name||'Paziente')}</b><div class="row" style="margin-top:8px"><button type="button" class="btn" data-accept="true">Accetta</button><button type="button" class="btn secondary" data-accept="false">Rifiuta</button></div>`;
      list.append(row);
      row.querySelectorAll('button').forEach(button=>button.onclick=async()=>{
        const buttons=[...host.querySelectorAll('button')];buttons.forEach(b=>b.disabled=true);
        const accepted=button.dataset.accept==='true';message.textContent='Aggiornamento della richiesta…';
        try {
          const {error}=await db.rpc('center_respond_patient_request',{p_request:request.id,p_accept:accepted});
          if (error) throw error;
          // Remove a completed request before refreshing, so a failed refresh cannot submit it twice.
          row.remove();
          message.textContent=accepted?'Paziente accettato. Lo trovi in Pazienti.':'Richiesta rifiutata.';
          if (accepted) await onAccepted();
          if (!list.children.length) list.innerHTML='<p class="muted">Nessuna richiesta in attesa.</p>';
        } catch(error) {showError(error);}
        finally {buttons.filter(b=>b.isConnected).forEach(b=>b.disabled=false);}
      });
    }
  }
}
