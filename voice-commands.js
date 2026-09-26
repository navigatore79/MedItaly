// Limited natural-language commands for the signed-in clinician. No transcript is persisted.
const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLocaleLowerCase('it-IT').replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();

export function parseVoiceIntent(transcript) {
  const text = normalize(transcript).replace(/^medi\s+/, '');
  const open = text.match(/\bapri\s+(?:(?:la\s+)?scheda\s+(?:del\s+)?|il\s+)?paziente\s+(.+?)(?=\s+e poi\b|\s+(?:elencami|mostrami|leggimi|modifica|togli)\b|$)/);
  const message = text.match(/\b(?:invia|scrivi|prepara)\s+(?:un\s+)?messaggio\s+(?:al\s+)?paziente\s+(.+?)(?=\s+e\s+(?:(?:poi\s+)?(?:seleziona|apri|mostrami))\b|$)/);
  const replace = text.match(/\b(?:togli|sospendi)\s+(.+?)\s+e\s+(?:inserisci|aggiungi)\s+(.+?)(?:\s+(?:per\s+)?(una|due|tre|quattro|cinque|sei|\d+)\s+volte?\s+al\s+giorno)?$/);
  const number = {una:1,due:2,tre:3,quattro:4,cinque:5,sei:6};
  return {
    patient: open?.[1]?.trim() || null,
    page: text.match(/\b(?:apri|mostra|vai\s+(?:a|alla|alle|ai))\s+(?:la\s+pagina\s+|la\s+sezione\s+|i\s+)?(panoramica|pazienti|messaggi|agenda|appuntamenti|amministrazione|protocolli|notifiche|richieste|profilo)\b/)?.[1] || null,
    messagePatient: message?.[1]?.trim() || null,
    openMessages: Boolean(message) || /\b(?:apri|seleziona|mostrami)\s+(?:la\s+)?scheda\s+messagg(?:io|i)\b/.test(text),
    listTherapy: /\b(?:elencami|mostrami|leggimi|dimmi)\b.*\bterapi[ae]\b|\bterapi[ae]\s+in\s+corso\b/.test(text),
    replacement: replace ? { oldName: replace[1].trim(), newName: replace[2].trim(), frequency: number[replace[3]] || Number(replace[3]) || null } : null,
  };
}

export function parseWelcomeAnswer(transcript) {
  const words = normalize(transcript).replace(/^medi\s+/, '').split(' ');
  if (words.some(word => ['si','certo','va','okay','ok'].includes(word))) return 'yes';
  if (words.some(word => ['no','negativo'].includes(word))) return 'no';
  return null;
}

export function initVoiceCommands({ $, sb, getPatients, getSelected, openPatient, romeDay, esc, getRole, preparePatientView, preparePage }) {
  const toggle = $('voiceToggle'), panel = $('voicePanel'), listen = $('voiceListen');
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  let recognition = null, active = false, busy = false, timer = null, messageFlow = null, lookupName = false;
  let welcomeStage = null, welcomeRecognition = null, welcomeTimer = null, welcomeSpeechTimer = null, welcomeDeadline = 0, welcomeRun = 0;
  const status = message => { $('voiceResult').textContent = message; };
  function renderState(state = 'idle') {
    panel.dataset.state = state;
    const labels = {
      idle: ['Microfono spento', 'Come posso aiutarti?', 'Attiva il microfono quando vuoi parlare con Medi. Rimarrà in ascolto finché non lo fermi.'],
      starting: ['Attivazione in corso', 'Consenti il microfono', 'Se il browser chiede il permesso, scegli Consenti per questo sito.'],
      listening: ['In ascolto', lookupName ? 'Dimmi nome e cognome del paziente' : messageFlow?.stage === 'dictation' ? 'Detta il tuo messaggio' : messageFlow?.stage === 'review' ? 'Pronuncia «invia»' : 'Dimmi cosa vuoi fare', lookupName ? 'Cercherò solo tra i pazienti collegati al tuo account.' : messageFlow?.stage === 'review' ? 'Puoi anche cambiare il testo qui sotto o dire «cambia messaggio».' : 'Medi tornerà in ascolto dopo ogni risposta.'],
      working: ['Sto elaborando', 'Un momento…', 'Sto verificando il comando e il paziente selezionato.'],
      review: ['Conferma necessaria', 'Controlla prima di inviare', 'Verifica destinatario e testo. Poi di’ «invia» o premi il pulsante.'],
    };
    const [label, title, hint] = labels[state];
    $('voiceState').textContent = label; $('voicePrompt').textContent = title; $('voiceHint').textContent = hint;
  }
  function stop() {
    active = false; lookupName = false; clearTimeout(timer);
    if (recognition) { try { recognition.abort(); } catch {} recognition = null; }
    if ('speechSynthesis' in window) speechSynthesis.cancel();
    listen.textContent = 'Attiva microfono'; listen.setAttribute('aria-pressed', 'false'); renderState(messageFlow?.stage === 'review' ? 'review' : 'idle');
  }
  function scheduleListen() {
    if (!active || busy || document.hidden || panel.classList.contains('hidden')) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (!active || busy) return;
      try { recognition.start(); renderState('starting'); }
      catch (error) { stop(); status('Impossibile riattivare il microfono: ' + (error.message || 'controlla il permesso del browser.')); }
    }, 350);
  }
  function reply(message, aloud = false) {
    status(message);
    renderState(messageFlow?.stage === 'review' ? 'review' : active ? 'working' : 'idle');
    if (!aloud || !active || !('speechSynthesis' in window)) return Promise.resolve();
    return new Promise(resolve => {
      speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(message.slice(0, 600));
      utterance.lang = 'it-IT'; utterance.rate = 1;
      utterance.onend = resolve; utterance.onerror = resolve;
      speechSynthesis.speak(utterance);
      setTimeout(resolve, 16000);
    });
  }
  async function readActiveTherapy(patient) {
    const { data, error } = await sb.from('medications').select('id,name,dose,route,starts_on,ends_on,active,medication_schedules(time_of_day)')
      .eq('patient_id', patient.patient_id).eq('active', true).order('created_at', { ascending: false });
    if (error) throw error;
    const day = romeDay();
    return (data || []).filter(m => (!m.starts_on || m.starts_on <= day) && (!m.ends_on || m.ends_on >= day));
  }
  function matchPatient(name) {
    const pool = getPatients();
    const key = normalize(name);
    let matches = pool.filter(p => normalize(p.profile?.full_name) === key);
    if (!matches.length && key) matches = pool.filter(p => normalize(p.profile?.full_name).includes(key));
    if (matches.length !== 1) throw Error(matches.length ? 'Nome ambiguo: seleziona il paziente dalla lista.' : 'Paziente non trovato tra quelli assegnati al tuo account.');
    return matches[0];
  }
  function clearWelcomeAudio() {
    clearTimeout(welcomeTimer);clearTimeout(welcomeSpeechTimer);
    if(welcomeRecognition){const old=welcomeRecognition;welcomeRecognition=null;try{old.abort();}catch{}}
    if('speechSynthesis' in window)speechSynthesis.cancel();
  }
  function stopWelcomeFlow(){welcomeRun++;welcomeStage=null;clearWelcomeAudio();}
  function welcomeStatus(message){$('patientVoiceStatus').textContent=message;}
  function finishWelcomeNo(){stopWelcomeFlow();stop();$('patientVoiceWelcome').close();}
  async function openWelcomePatient(raw){
    const name=normalize(raw).replace(/^(?:medi\s+)?(?:apri\s+)?(?:(?:la\s+)?scheda\s+(?:del\s+)?|il\s+)?paziente\s+/,'');
    if(name.split(' ').filter(Boolean).length<2){welcomeStatus('Indica nome e cognome. Puoi ripetere l’ascolto o scriverli nel campo.');clearWelcomeAudio();return;}
    try{
      const patient=matchPatient(name);
      stopWelcomeFlow();$('patientVoiceWelcome').close();
      await preparePatientView();
      const nav=document.querySelector('[data-view="patients"]');
      if(!nav||nav.classList.contains('hidden'))throw Error('La pagina Pazienti non è disponibile per questo account.');
      await nav.onclick();await openPatient(patient.patient_id);
      status('Scheda di '+(patient.profile?.full_name||'paziente')+' aperta.');
    }catch(error){welcomeStatus(error.message||'Paziente non trovato. Scrivi nome e cognome nel campo.');}
  }
  function listenWelcomeWindow(run){
    if(run!==welcomeRun||!welcomeStage||document.hidden)return;
    clearTimeout(welcomeSpeechTimer);
    if(!Recognition){welcomeStatus('Ascolto vocale non disponibile in questo browser. Usa i pulsanti o scrivi nome e cognome.');return;}
    let heard=false,closing=false;
    const finish=()=>{if(run!==welcomeRun||!welcomeStage)return;clearTimeout(welcomeTimer);welcomeRecognition=null;welcomeStatus(welcomeStage==='decision'?'Non ho sentito una risposta. Di’ «sì» o «no» dopo “Attiva ascolto”, oppure usa i pulsanti.':'Non ho sentito il nome. Tocca “Attiva ascolto” o scrivi nome e cognome.');};
    const start=()=>{
      if(run!==welcomeRun||!welcomeStage||document.hidden)return;
      const rec=new Recognition();welcomeRecognition=rec;rec.lang='it-IT';rec.continuous=false;rec.interimResults=false;
      rec.onstart=()=>{if(run!==welcomeRun)return;if(!welcomeDeadline)welcomeDeadline=Date.now()+4000;welcomeStatus(welcomeStage==='decision'?'Ascolto per 4 secondi: rispondi «sì» oppure «no».':'Ascolto per 4 secondi: dimmi nome e cognome.');clearTimeout(welcomeTimer);welcomeTimer=setTimeout(()=>{closing=true;try{rec.stop();}catch{finish();}setTimeout(()=>{if(run===welcomeRun&&welcomeRecognition===rec)finish();},600);},Math.max(0,welcomeDeadline-Date.now()));};
      rec.onresult=event=>{if(run!==welcomeRun)return;heard=true;const raw=event.results[event.resultIndex][0].transcript;$('voiceHeard').textContent=raw;
        if(welcomeStage==='decision'){const answer=parseWelcomeAnswer(raw);if(answer==='yes')return promptWelcome('name');if(answer==='no')return finishWelcomeNo();heard=false;welcomeStatus('Risposta non chiara. Di’ «sì» o «no», oppure usa i pulsanti.');}
        else openWelcomePatient(raw);
      };
      rec.onerror=event=>{if(run!==welcomeRun||event.error==='aborted'||event.error==='no-speech')return;
        heard=true;closing=true;clearTimeout(welcomeTimer);welcomeStatus(event.error==='not-allowed'||event.error==='service-not-allowed'?'Il browser ha bloccato il microfono. Usa i pulsanti oppure “Attiva ascolto” dopo aver dato il permesso.':'Ascolto non disponibile: '+event.error+'. Usa i pulsanti o il campo nome.');};
      rec.onend=()=>{if(run!==welcomeRun||!welcomeStage||heard)return;if(closing||Date.now()>=welcomeDeadline){finish();return;}setTimeout(start,100);};
      try{rec.start();welcomeStatus('Attivazione del microfono…');}
      catch(error){welcomeRecognition=null;welcomeStatus('Il browser richiede un tocco per attivare il microfono. Premi “Attiva ascolto”.');}
    };
    start();
  }
  function promptWelcome(stage){
    stopWelcomeFlow();welcomeStage=stage;welcomeDeadline=0;const run=welcomeRun;
    $('patientVoiceWelcomeTitle').textContent=stage==='decision'?'Vuoi richiamare la scheda di un paziente?':'Dimmi nome e cognome del paziente';
    $('patientVoiceWelcomeHelp').textContent=stage==='decision'?'Dopo la domanda Medi ascolta per 4 secondi. «Sì» apre la ricerca; «no» ferma tutto.':'Medi ascolta nome e cognome per 4 secondi. Puoi anche inserirli nel campo.';
    $('patientVoiceNameEntry').classList.toggle('hidden',stage!=='name');$('patientVoiceYes').classList.toggle('hidden',stage==='name');
    welcomeStatus('Medi sta ponendo la domanda…');
    if(!('speechSynthesis' in window)){listenWelcomeWindow(run);return;}
    let started=false;const begin=()=>{if(started||run!==welcomeRun)return;started=true;listenWelcomeWindow(run);};
    const prompt=stage==='decision'?'Vuoi che apra la scheda di un paziente? Rispondi sì o no.':'Dimmi nome e cognome del paziente da aprire.';
    try{const utterance=new SpeechSynthesisUtterance(prompt);utterance.lang='it-IT';utterance.rate=1;utterance.onend=begin;utterance.onerror=begin;speechSynthesis.speak(utterance);welcomeSpeechTimer=setTimeout(()=>{if(run===welcomeRun){speechSynthesis.cancel();begin();}},5000);}
    catch{begin();}
  }
  function makeDraft(patient, medication, proposed) {
    const box = $('voiceDraft');
    box.innerHTML = `<div class="voice-review"><h3>Verifica sostituzione terapia</h3><p>La voce ha proposto di sospendere <strong>${esc(medication.name)}</strong> e inserire <strong>${esc(proposed.newName)}</strong> per <strong>${esc(patient.profile?.full_name || 'il paziente')}</strong>. Nessuna modifica è stata ancora salvata.</p>
      <div class="two"><label class="field">Farmaco nuovo<input id="voiceNewName" value="${esc(proposed.newName)}" required></label><label class="field">Dose prescritta<input id="voiceDose" placeholder="Es. 500 mg" required></label></div>
      <div class="two"><label class="field">Via di somministrazione<input id="voiceRoute" placeholder="Es. orale" required></label><label class="field">Orari HH:MM separati da virgole<input id="voiceTimes" placeholder="Es. 08:00,20:00" required></label></div>
      <div class="two"><label class="field">Inizio<input id="voiceStart" type="date" value="${romeDay()}" required></label><label class="field">Fine (facoltativa)<input id="voiceEnd" type="date"></label></div>
      <label class="field">Istruzioni<textarea id="voiceInstructions" rows="2"></textarea></label><p class="small muted">Frequenza riconosciuta: ${proposed.frequency ? `${proposed.frequency} volte al giorno` : 'non specificata'}. Verifica nome, dose e orari sul piano clinico prima di confermare.</p>
      <div class="row"><button id="voiceConfirm" type="button" class="btn">Conferma sostituzione</button><button id="voiceCancel" type="button" class="btn secondary">Annulla</button></div><div id="voiceDraftResult" role="status"></div></div>`;
    $('voiceCancel').onclick = () => { box.innerHTML = ''; status('Bozza annullata. Nessuna terapia modificata.'); renderState(active ? 'listening' : 'idle'); };
    $('voiceConfirm').onclick = async () => {
      const times = $('voiceTimes').value.split(',').map(x => x.trim()).filter(Boolean);
      const name = $('voiceNewName').value.trim(), dose = $('voiceDose').value.trim(), route = $('voiceRoute').value.trim();
      const start = $('voiceStart').value, end = $('voiceEnd').value || null;
      if (!name || !dose || !route || !start || !times.length ||
        times.some(x => !/^([01]\d|2[0-3]):[0-5]\d$/.test(x)) || new Set(times).size !== times.length || end && end < start ||
        proposed.frequency && times.length !== proposed.frequency) {
        $('voiceDraftResult').textContent = 'Controlla farmaco, dose, via, data e orari. Il numero di orari deve corrispondere alla frequenza pronunciata.';
        return;
      }
      if (!getPatients().some(x => x.patient_id === patient.patient_id)) return status('Paziente non più assegnato: aggiorna la dashboard.');
      const button = $('voiceConfirm'); button.disabled = true;
      const { error } = await sb.rpc('clinician_confirm_medication_replacement', {
        p_patient: patient.patient_id, p_old_medication: medication.id,
        p_new_name: name, p_dose: dose, p_route: route, p_times: times,
        p_starts_on: start, p_ends_on: end, p_instructions: $('voiceInstructions').value.trim(),
      });
      if (error) { button.disabled = false; $('voiceDraftResult').textContent = 'Modifica non salvata: ' + error.message; return; }
      box.innerHTML = ''; status('Sostituzione confermata e registrata.');
      await openPatient(patient.patient_id);
      $('patientDetail').querySelector('[data-tab="therapy"]')?.click();
    };
  }
  async function handleMessageFlow(raw, aloud) {
    const command = normalize(raw).replace(/^medi\s+/, '');
    if (/^(annulla|cancella messaggio)$/.test(command)) {
      messageFlow = null; $('voiceDraft').innerHTML = '';
      return reply('Messaggio annullato. Non ho inviato nulla.', aloud);
    }
    if (!messageFlow) return false;
    if (messageFlow.stage === 'dictation') {
      if (/^invia$/.test(command)) return reply('Il messaggio è vuoto. Dettalo prima di dire invia.', aloud);
      const body = raw.trim();
      if (body.length > 4000) return reply('Il messaggio supera 4000 caratteri. Dettane uno più breve.', aloud);
      messageFlow.body = body; messageFlow.stage = 'review';
      $('chatText').value = body;
      $('voiceDraft').innerHTML = `<div class="voice-review"><span class="voice-label">PASSO 3 DI 3 · CONFERMA</span><h3>Messaggio da verificare</h3><p>Destinatario: <strong>${esc(messageFlow.patient.profile?.full_name || 'Paziente')}</strong></p><label for="voiceMessageBody" class="voice-label">TESTO DEL MESSAGGIO</label><textarea id="voiceMessageBody" class="voice-message-preview" maxlength="4000" rows="4">${esc(body)}</textarea><p class="small muted">Controlla il testo: l’invio avviene solo con un nuovo «invia» o premendo il pulsante.</p><div class="voice-review-actions"><button id="voiceMessageSend" type="button" class="btn">Invia messaggio</button><button id="voiceMessageRedo" type="button" class="btn secondary">Detta di nuovo</button><button id="voiceMessageCancel" type="button" class="btn secondary">Annulla</button></div></div>`;
      $('voiceMessageSend').onclick = () => processCommand(false, 'invia');
      $('voiceMessageRedo').onclick = () => processCommand(false, 'cambia messaggio');
      $('voiceMessageCancel').onclick = () => { messageFlow = null; $('voiceDraft').innerHTML = ''; status('Messaggio annullato.'); renderState(active ? 'listening' : 'idle'); };
      return reply('Testo acquisito. Verificalo sullo schermo e di’ invia per spedire, oppure cambia messaggio.', aloud);
    }
    if (/^(cambia messaggio|modifica messaggio|riscrivi)$/.test(command)) {
      messageFlow.stage = 'dictation'; messageFlow.body = '';
      $('voiceDraft').innerHTML = '';
      return reply('Detta il nuovo messaggio.', aloud);
    }
    if (!/^(invia|conferma invio|invia messaggio)$/.test(command))
      return reply('Il messaggio è pronto. Di’ invia, cambia messaggio oppure annulla.', aloud);
    const flow = messageFlow;
    if (!getPatients().some(x => x.patient_id === flow.patient.patient_id)) {
      messageFlow = null; return reply('Paziente non più assegnato. Il messaggio non è stato inviato.', aloud);
    }
    if (getSelected() !== flow.patient.patient_id) {
      await openPatient(flow.patient.patient_id);
      $('patientDetail').querySelector('[data-tab="chat"]')?.click();
    }
    if (getRole() !== 'Clinician') return reply('Sessione medico terminata. Il messaggio non è stato inviato.', aloud);
    const reviewedBody = $('voiceMessageBody')?.value.trim() || '';
    if (!reviewedBody) return reply('Il messaggio è vuoto. Scrivi o detta un testo prima di inviare.', aloud);
    $('chatText').value = reviewedBody;
    await $('sendChat').onclick();
    const result = $('chatMsg')?.textContent || '';
    if (!result.includes('Messaggio registrato')) return reply(result || 'Invio non riuscito. Il messaggio resta nella bozza.', aloud);
    messageFlow = null; $('voiceDraft').innerHTML = '';
    return reply('Messaggio registrato per ' + (flow.patient.profile?.full_name || 'il paziente') + '. Medi è di nuovo in ascolto.', aloud);
  }
  async function execute(raw, aloud = false) {
    if (!['Clinician','Administrator'].includes(getRole())) return reply('Sessione non autorizzata.', aloud);
    if (lookupName) {
      const name = normalize(raw).replace(/^(?:medi\s+)?(?:apri\s+)?(?:(?:la\s+)?scheda\s+(?:del\s+)?|il\s+)?paziente\s+/, '');
      const patient = matchPatient(name);
      await preparePatientView();
      const nav=document.querySelector('[data-view="patients"]');
      if(nav?.classList.contains('hidden'))return reply('Passa a “Pazienti del mio account” per aprire la scheda.',aloud);
      lookupName = false;
      await nav.onclick();
      await openPatient(patient.patient_id);
      return reply(`Ho aperto la scheda di ${patient.profile?.full_name || 'il paziente'}.`, aloud);
    }
    const intent = parseVoiceIntent(raw);
    if (messageFlow) return handleMessageFlow(raw, aloud);
    if(intent.page && !intent.patient){
      const pages={panoramica:'overview',pazienti:'patients',messaggi:'messages',agenda:'appointments',appuntamenti:'appointments',amministrazione:'admin',protocolli:'protocols',notifiche:'delivery',richieste:'requests',profilo:'profile'};
      await preparePage(pages[intent.page]);
      const target=document.querySelector(`.nav button[data-view="${pages[intent.page]}"]`);
      if(!target||target.classList.contains('hidden'))return reply('Questa pagina non è disponibile nell’area selezionata.',aloud);
      await target.onclick();return reply(`Ho aperto ${intent.page}.`,aloud);
    }
    let patient = intent.messagePatient ? matchPatient(intent.messagePatient) : intent.patient ? matchPatient(intent.patient) : getPatients().find(x => x.patient_id === getSelected());
    if (!patient) return reply('Indica il nome del paziente assegnato: per esempio Medi apri paziente seguito dal nome.', aloud);
    if (intent.patient || intent.messagePatient) {
      await preparePatientView();
      const nav=document.querySelector('[data-view="patients"]');
      if(nav?.classList.contains('hidden'))return reply('Passa a “Pazienti del mio account” per aprire la scheda.',aloud);
      await nav.onclick();
      await openPatient(patient.patient_id);
    }
    if(getRole()!=='Clinician'&&(intent.listTherapy||intent.replacement||intent.openMessages))return reply('Nell’area amministratore posso aprire la scheda e navigare le pagine. I comandi clinici richiedono l’account medico.',aloud);
    if (intent.openMessages) {
      $('patientDetail').querySelector('[data-tab="chat"]')?.click();
      messageFlow = { patient, stage: 'dictation', body: '' };
      $('voiceDraft').innerHTML = `<div class="voice-review"><span class="voice-label">PASSO 2 DI 3 · DETTATURA</span><h3>Nuovo messaggio per ${esc(patient.profile?.full_name || 'il paziente')}</h3><p>Il prossimo ascolto acquisisce il testo. Potrai rileggerlo e correggerlo prima dell’invio.</p><button id="voiceMessageCancel" type="button" class="btn secondary">Annulla</button></div>`;
      $('voiceMessageCancel').onclick = () => { messageFlow = null; $('voiceDraft').innerHTML = ''; status('Messaggio annullato.'); renderState(active ? 'listening' : 'idle'); };
      return reply('Scheda messaggi aperta. Detta ora il messaggio per ' + (patient.profile?.full_name || 'il paziente') + '.', aloud);
    }
    if (!intent.listTherapy && !intent.replacement) return reply(`Ho aperto ${patient.profile?.full_name || 'il paziente'}.`, aloud);
    const meds = await readActiveTherapy(patient);
    let message = '';
    if (intent.listTherapy) {
      message = meds.length ? `Terapie attive di ${patient.profile?.full_name}: ` + meds.map(m =>
        `${m.name}, ${m.dose || 'dose non indicata'}, ${(m.medication_schedules || []).map(x => x.time_of_day?.slice(0,5)).filter(Boolean).join(' e ') || 'orari non indicati'}`).join('; ') + '.' : 'Nessuna terapia attiva registrata.';
    }
    if (intent.replacement) {
      const matches = meds.filter(m => normalize(m.name).includes(normalize(intent.replacement.oldName)));
      if (matches.length !== 1) throw Error(matches.length ? 'Farmaco ambiguo: verifica la terapia del paziente.' : 'Farmaco da sospendere non trovato tra le terapie attive.');
      makeDraft(patient, matches[0], intent.replacement);
      message += (message ? ' ' : '') + 'Ho preparato una bozza di sostituzione. Compila dose, via e orari, poi conferma manualmente.';
    }
    return reply(message, aloud);
  }
  async function processCommand(aloud = false, override = null) {
    if (busy) return;
    const raw = override || $('voiceText').value.trim();
    if (!raw) return status('Pronuncia o scrivi un comando.');
    busy = true; $('voiceHeard').textContent = raw; renderState('working');
    try { await execute(raw, aloud); }
    catch (error) { await reply(error.message || 'Comando non riconosciuto.', aloud); }
    finally { busy = false; scheduleListen(); }
  }
  toggle.onclick = () => {
    const open = panel.classList.toggle('hidden');
    toggle.setAttribute('aria-expanded', String(!open));
    if (open) stop(); else panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  $('voiceClose').onclick = () => { stop(); messageFlow = null; $('voiceDraft').innerHTML = ''; panel.classList.add('hidden'); toggle.setAttribute('aria-expanded', 'false'); };
  document.querySelectorAll('[data-voice-example]').forEach(button => button.onclick = () => {
    $('voiceText').value = button.dataset.voiceExample;
    $('voiceText').focus();
    $('voiceText').setSelectionRange($('voiceText').value.length, $('voiceText').value.length);
  });
  $('voiceRun').onclick = () => processCommand(false);
  $('voiceText').onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); processCommand(false); } };
  listen.onclick = () => {
    if (active) return stop();
    if (!Recognition) return status('Questo browser non offre il riconoscimento vocale. Prova Chrome o Safari aggiornato, oppure usa il comando scritto.');
    recognition = new Recognition(); recognition.lang = 'it-IT'; recognition.continuous = false; recognition.interimResults = false;
    recognition.onresult = event => { $('voiceText').value = event.results[event.resultIndex][0].transcript; processCommand(true); };
    recognition.onstart = () => { if (active) renderState('listening'); };
    recognition.onerror = event => {
      if (event.error === 'no-speech' || event.error === 'aborted') return;
      const errors = {
        'not-allowed': 'Permesso microfono negato. Abilitalo dalle impostazioni del sito nel browser e riprova.',
        'service-not-allowed': 'Riconoscimento vocale bloccato dal browser. Controlla i permessi del sito.',
        'audio-capture': 'Nessun microfono disponibile. Controlla il dispositivo e i permessi del browser.',
        network: 'Servizio vocale non raggiungibile. Riprova con una connessione attiva o usa il comando scritto.',
        'language-not-supported': 'Riconoscimento in italiano non disponibile in questo browser.',
      };
      stop(); status(errors[event.error] || `Riconoscimento interrotto (${event.error}). Riprova o usa il comando scritto.`);
    };
    recognition.onend = scheduleListen;
    active = true; listen.textContent = 'Ferma ascolto'; listen.setAttribute('aria-pressed', 'true'); renderState('starting');
    try { recognition.start(); }
    catch (error) { stop(); status('Impossibile avviare il microfono: ' + (error.message || 'controlla il permesso del browser.')); }
  };
  document.addEventListener('visibilitychange', () => { if (document.hidden){stopWelcomeFlow();stop();} });
  $('logout').addEventListener('click', () => {stopWelcomeFlow();stop();});
  return {
    stop,
    startWelcomeFlow(){if(['Clinician','Administrator'].includes(getRole()))promptWelcome('decision');},
    answerWelcomeYes(){if(welcomeStage==='decision')promptWelcome('name');},
    answerWelcomeNo:finishWelcomeNo,
    retryWelcome(){if(welcomeStage){const stage=welcomeStage;stopWelcomeFlow();welcomeStage=stage;welcomeDeadline=0;listenWelcomeWindow(welcomeRun);}},
    openWelcomeName:openWelcomePatient,
    stopWelcomeFlow,
    startPatientLookup(){
      if(getRole()!=='Clinician'&&getRole()!=='Administrator')return;
      if(panel.classList.contains('hidden'))toggle.click();
      lookupName=true;status('Dimmi nome e cognome del paziente collegato al tuo account.');
      renderState('listening');
      if(!active)listen.click();
      $('voiceText').placeholder='Nome e cognome del paziente';
    },
  };
}
