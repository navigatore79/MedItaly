export function safeSourceUrl(value){try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password?u.href:null;}catch{return null;}}
export function renderMediAnswer(box,data){
 box.replaceChildren();const article=document.createElement('article');article.className='clinical-answer';
 const title=document.createElement('strong');title.textContent='Medi · Gemini';article.append(title);
 const answer=document.createElement('p');answer.textContent=data.answer;article.append(answer);
 if(data.sources?.length){const sources=document.createElement('div');sources.className='clinical-sources';
 const label=document.createElement('strong');label.textContent='Fonti della risposta';sources.append(label);
 for(const source of data.sources){const url=safeSourceUrl(source.url);if(!url)continue;const link=document.createElement('a');link.href=url;link.target='_blank';link.rel='noopener noreferrer';link.textContent=source.title||'Apri fonte';sources.append(link);}article.append(sources);}
 if(data.searchSuggestions){const frame=document.createElement('iframe');frame.className='medi-search-suggestions';frame.title='Suggerimenti Google Search';frame.setAttribute('sandbox','allow-popups allow-popups-to-escape-sandbox');frame.referrerPolicy='no-referrer';frame.srcdoc=data.searchSuggestions;article.append(frame);}
 const note=document.createElement('small');note.textContent='Informazioni generali da verificare nelle fonti originali. Medi non modifica terapie o cartelle.';article.append(note);box.append(article);
}
export function initMediGemini({sb,getRole}){
 const form=document.getElementById('mediGeminiForm'),input=document.getElementById('mediGeminiQuestion'),send=document.getElementById('mediGeminiSend'),status=document.getElementById('mediGeminiStatus'),box=document.getElementById('voiceClinicalResult');let busy=false;
 async function ask(question){
  if(getRole()!=='Clinician')throw Error('Domande cliniche riservate al medico approvato.');
  if(busy)throw Error('Attendi la risposta di Medi.');
  question=String(question).trim();if(question.length<4||question.length>600)throw Error('Scrivi una domanda tra 4 e 600 caratteri.');
  busy=true;send.disabled=true;box.replaceChildren();box.setAttribute('aria-busy','true');status.textContent='Medi sta consultando Gemini…';
  try{const{data,error}=await sb.functions.invoke('medi-clinician-gemini',{body:{question}});
   if(error||data?.error){let message=data?.error;if(!message&&error?.context?.json){try{message=(await error.context.json()).error;}catch{}}throw Error(message||'Gemini non disponibile. Riprova più tardi.');}
   if(data?.provider!=='gemini'||!data?.answer)throw Error('Risposta Gemini non valida.');
   renderMediAnswer(box,data);status.textContent='Risposta ricevuta da Gemini.';return data.answer;
  }catch(e){status.textContent=e.message||'Richiesta non riuscita.';throw e;}finally{busy=false;send.disabled=false;box.removeAttribute('aria-busy');}
 }
 form?.addEventListener('submit',async e=>{e.preventDefault();try{await ask(input.value);}catch(e){status.textContent=e.message;}});
 document.getElementById('mediGeminiClear')?.addEventListener('click',()=>{if(busy)return;input.value='';box.replaceChildren();status.textContent='';input.focus();});
 return{ask};
}
