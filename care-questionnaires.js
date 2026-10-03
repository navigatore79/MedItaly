/* Daily follow-up draft; questions are assigned and versioned by the clinician. */
const POST_PCI_QUESTIONS=[
 {id:'chest',label:'Nelle ultime 24 ore hai avuto dolore o pressione al petto?',type:'choice',required:true,options:['No','Sì, ora','Sì, poi passato'],alert_values:['Sì, ora']},
 {id:'breath',label:'Hai avuto affanno nuovo o più forte del solito?',type:'choice',required:true,options:['No','Sì, durante attività','Sì, anche a riposo'],alert_values:['Sì, anche a riposo']},
 {id:'faint',label:'Hai avuto uno svenimento o una forte sensazione di mancamento?',type:'choice',required:true,options:['No','Sì'],alert_values:['Sì']},
 {id:'bleeding',label:'Hai notato sanguinamenti?',type:'choice',required:true,options:['No','Piccolo sanguinamento o lividi','Sangue abbondante, feci nere o vomito con sangue'],alert_values:['Sangue abbondante, feci nere o vomito con sangue']},
 {id:'access',label:'Nel punto della puntura per l’angioplastica ci sono nuovi problemi?',type:'choice',required:true,options:['No','Dolore, gonfiore o arrossamento','Sanguinamento che non si ferma','Non applicabile'],alert_values:['Sanguinamento che non si ferma']},
 {id:'medicines',label:'Hai assunto i farmaci prescritti, compresi gli antiaggreganti se previsti?',type:'choice',required:true,options:['Sì, tutti','Ho saltato almeno una dose','Non ricordo','Ho un problema con la terapia']},
 {id:'pulse',label:'Hai avuto palpitazioni nuove o prolungate?',type:'choice',required:true,options:['No','Sì']},
 {id:'activity',label:'Rispetto a ieri, come vanno le attività consentite dal medico?',type:'choice',required:true,options:['Come prima o meglio','Faccio più fatica','Non ho svolto attività']},
 {id:'note',label:'Vuoi aggiungere qualcosa per il medico?',type:'text',required:false}
];
const POST_PCI_SOURCES=[
 'https://www.escardio.org/guidelines/clinical-practice-guidelines/all-esc-practice-guidelines/acute-coronary-syndromes/',
 'https://www.giornaledicardiologia.it/anticipazioni/articoli/40099/'
];

export async function renderQuestionnaireManager(sb,patient,clinician){
 const detail=document.getElementById('patientDetail');if(!detail)return;
 const tab=document.createElement('button');tab.dataset.tab='careQuestionnaires';tab.textContent='Questionari';detail.querySelector('.tabs').append(tab);
 const panel=document.createElement('div');panel.className='tabp hidden';panel.id='careQuestionnaires';detail.querySelector('.card').append(panel);
 panel.innerHTML='<h3>Questionario quotidiano del paziente</h3><p>Assegna una versione verificata da te. Il modello post-angioplastica è una bozza basata sui temi delle linee guida ESC e del consenso SICI-GISE/SICOA, senza punteggio clinico validato.</p><label class="field">Titolo<input id="cqTitle" value="Controllo quotidiano post-angioplastica" maxlength="150"></label><label class="field">Versione<input id="cqVersion" value="1" maxlength="30"></label><div id="cqEditor"></div><button class="btn secondary" id="cqAdd">Aggiungi domanda</button> <button class="btn" id="cqAssign">Assegna al paziente</button><p id="cqStatus" role="status"></p><h3>Versioni assegnate e risposte</h3><div id="cqHistory"></div>';
 const draft=structuredClone(POST_PCI_QUESTIONS);
 const editor=panel.querySelector('#cqEditor');
 const draw=()=>{editor.replaceChildren();draft.forEach((q,i)=>{
  const row=document.createElement('section');row.className='card';
  row.innerHTML='<label class="field">Domanda<input class="cqLabel" maxlength="250"></label><label class="field">Tipo<select class="cqType"><option value="choice">Scelta singola</option><option value="text">Testo libero</option></select></label><label class="field">Risposte (una per riga)<textarea class="cqOptions" rows="3"></textarea></label><label><input class="cqRequired" type="checkbox"> Obbligatoria</label> <button class="btn secondary cqRemove" type="button">Rimuovi</button>';
  row.querySelector('.cqLabel').value=q.label;row.querySelector('.cqType').value=q.type;row.querySelector('.cqOptions').value=(q.options||[]).join('\n');row.querySelector('.cqRequired').checked=q.required;
  row.querySelector('.cqLabel').oninput=e=>{q.label=e.target.value;delete q.alert_values;};
  row.querySelector('.cqType').onchange=e=>{q.type=e.target.value;delete q.alert_values;};
  row.querySelector('.cqOptions').oninput=e=>{q.options=e.target.value.split('\n').map(s=>s.trim()).filter(Boolean);delete q.alert_values;};
  row.querySelector('.cqRequired').onchange=e=>q.required=e.target.checked;
  row.querySelector('.cqRemove').onclick=()=>{draft.splice(i,1);draw();};editor.append(row);
 });};draw();
 panel.querySelector('#cqAdd').onclick=()=>{if(draft.length>=30)return;draft.push({id:'q'+crypto.randomUUID().replaceAll('-',''),label:'Nuova domanda',type:'choice',required:true,options:['No','Sì']});draw();};
 const refresh=async()=>{
  const host=panel.querySelector('#cqHistory');const {data,error}=await sb.from('care_questionnaire_assignments').select('*').eq('patient_id',patient).eq('clinician_id',clinician).order('created_at',{ascending:false});
  if(!panel.isConnected)return;host.replaceChildren();if(error){host.textContent='Impossibile caricare i questionari: '+error.message;return;}
  for(const a of data||[]){
   const card=document.createElement('section');card.className='card';const h=document.createElement('h4');h.textContent=a.title+' · versione '+a.version_label+(a.active?' · attivo':' · chiuso');card.append(h);
   if(a.active){const disable=document.createElement('button');disable.className='btn secondary';disable.textContent='Chiudi assegnazione';disable.onclick=async()=>{const r=await sb.from('care_questionnaire_assignments').update({active:false}).eq('id',a.id);if(r.error)panel.querySelector('#cqStatus').textContent=r.error.message;else refresh();};card.append(disable);}
   const responses=await sb.from('care_questionnaire_responses').select('*').eq('assignment_id',a.id).order('response_date',{ascending:false}).limit(30);
   if(responses.error){const p=document.createElement('p');p.textContent='Risposte non disponibili.';card.append(p);}
   for(const response of responses.data||[]){const d=document.createElement('details'),summary=document.createElement('summary');summary.textContent=response.response_date;d.append(summary);a.questions.forEach(q=>{const p=document.createElement('p');p.textContent=q.label+': '+(response.answers[q.id]||'—');d.append(p);});card.append(d);}
   host.append(card);
  }
 };
 panel.querySelector('#cqAssign').onclick=async e=>{
  const title=panel.querySelector('#cqTitle').value.trim();const status=panel.querySelector('#cqStatus');
  if(!title||!draft.length||draft.some(q=>!q.label.trim()||(q.type==='choice'&&!(q.options?.length)))){status.textContent='Completa titolo, domande e opzioni.';return;}
  e.target.disabled=true;const {error}=await sb.from('care_questionnaire_assignments').insert({patient_id:patient,clinician_id:clinician,title,version_label:panel.querySelector('#cqVersion').value.trim()||'1',questions:draft,sources:POST_PCI_SOURCES});e.target.disabled=false;
  status.textContent=error?'Assegnazione non riuscita: '+error.message:'Questionario assegnato. Il paziente lo trova in Il tuo percorso → Questionari.';if(!error)await refresh();
 };
 await refresh();
}
