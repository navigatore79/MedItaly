(function(){
 'use strict';
 let sb=null,uid=null,patient=false,active=null,inboxTimer=null,polling=false,starting=false,disposed=0;
 const validId=id=>typeof id==='string'&&/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id);
 const terminal=new Set(['ended','rejected','missed','failed']);
 const labels={ended:'Chiamata terminata',rejected:'Chiamata rifiutata',missed:'Chiamata senza risposta',failed:'Chiamata interrotta'};
 const style=document.createElement('style');style.textContent=`.meditaly-call{position:fixed;inset:0;z-index:10001;display:grid;place-items:center;background:#0e3151ed;color:white;padding:24px}.meditaly-call-card{width:min(760px,100%);text-align:center;max-height:100%;overflow:auto}.meditaly-call-video{position:relative;margin:16px auto;background:#10251f;border-radius:20px;overflow:hidden}.meditaly-call-video video[data-remote]{width:100%;max-height:48vh;object-fit:contain;display:block}.meditaly-call-video video[data-local]{position:absolute;right:12px;bottom:12px;width:25%;max-height:120px;object-fit:cover;border-radius:12px;border:2px solid white;transform:scaleX(-1)}.meditaly-call h2{font-size:28px;margin:14px 0}.meditaly-call-avatar{width:88px;height:88px;border-radius:50%;background:#ffffff26;display:grid;place-items:center;font-size:40px;margin:auto}.meditaly-call-actions{display:flex;justify-content:center;gap:12px;flex-wrap:wrap;margin-top:28px}.meditaly-call button{border:0;border-radius:16px;min-height:52px;padding:12px 20px;font:inherit;cursor:pointer;background:white;color:#173e58}.meditaly-call button[data-answer]{background:#24aa72;color:white}.meditaly-call button[data-end],.meditaly-call button[data-reject]{background:#dc474a;color:white}.meditaly-call button:disabled{opacity:.5}.meditaly-call [hidden]{display:none!important}.meditaly-call-status{min-height:42px;margin-top:16px}.meditaly-call small{display:block;margin:16px 0;color:#d3e4f3}`;document.head.append(style);
 async function rpc(name,args){const {data,error}=await sb.rpc(name,args);if(error)throw error;return Array.isArray(data)?data[0]:data;}
 function message(text){if(active)active.status.textContent=text;else alert(text);}
 function create(call,name,incoming){
  window.MeditalyAudio?.cancel();const video=call.media_mode==='video';const node=document.createElement('section');node.className='meditaly-call';node.setAttribute('role','dialog');node.setAttribute('aria-modal','true');node.setAttribute('aria-label',incoming?(video?'Videochiamata in ingresso Meditaly':'Chiamata in ingresso Meditaly'):(video?'Videochiamata Meditaly':'Chiamata Meditaly'));
  node.innerHTML='<div class="meditaly-call-card"><div class="meditaly-call-avatar">☎</div><p data-kind></p><h2></h2><div class="meditaly-call-status" role="status" aria-live="polite"></div><small>La chiamata non viene registrata.</small><div class="meditaly-call-video" hidden><video data-remote autoplay playsinline aria-label="Video del partecipante"></video><video data-local autoplay playsinline muted aria-label="Il tuo video"></video></div><div class="meditaly-call-actions"><button data-answer>Rispondi</button><button data-reject>Rifiuta</button><button data-mute hidden>Microfono acceso</button><button data-camera hidden>Videocamera accesa</button><button data-speaker hidden>Vivavoce</button><button data-audio hidden>Attiva audio</button><button data-end hidden>Termina</button><button data-close hidden>Chiudi</button></div></div>';
  node.querySelector('[data-kind]').textContent=video?'Meditaly · Videochiamata':'Meditaly · Chiamata vocale';node.querySelector('h2').textContent=name;document.body.append(node);
  const c={call,node,status:node.querySelector('[role="status"]'),pc:null,stream:null,audio:video?node.querySelector('[data-remote]'):document.createElement('audio'),localVideo:node.querySelector('[data-local]'),video,timer:null,cursor:0,candidates:[],signalQueue:Promise.resolve(),seen:new Set(),lastBeat:0,accepting:false,ending:false,connectionTimer:null,guard:disposed,user:uid};active=c;c.audio.autoplay=true;c.audio.setAttribute('playsinline','');if(!video)node.append(c.audio);
  const button=key=>node.querySelector(`[data-${key}]`);
  button('answer').hidden=!incoming;button('reject').hidden=!incoming;button('end').hidden=incoming;
  c.status.textContent=incoming?(video?'Il medico ti invita a una videochiamata. La videocamera si attiva dopo Rispondi.':'Il medico ti sta chiamando.'):'Chiamata in corso…';
  button('answer').onclick=()=>answer(c);button('reject').onclick=()=>finish(c,'reject');button('end').onclick=()=>finish(c,'end');button('close').onclick=()=>clear(c);
  button('mute').onclick=()=>{if(!c.stream)return;const enabled=!c.stream.getAudioTracks()[0]?.enabled;c.stream.getAudioTracks().forEach(t=>t.enabled=enabled);button('mute').textContent=enabled?'Microfono acceso':'Microfono spento';button('mute').setAttribute('aria-pressed',String(!enabled));};
  button('camera').onclick=()=>{if(!c.stream)return;const enabled=!c.stream.getVideoTracks()[0]?.enabled;c.stream.getVideoTracks().forEach(t=>t.enabled=enabled);button('camera').textContent=enabled?'Videocamera accesa':'Videocamera spenta';button('camera').setAttribute('aria-pressed',String(!enabled));};
  button('speaker').hidden=!window.AndroidBridge?.setCallSpeaker;button('speaker').onclick=()=>{const enabled=button('speaker').getAttribute('aria-pressed')!=='true';window.AndroidBridge?.setCallSpeaker?.(enabled);button('speaker').setAttribute('aria-pressed',String(enabled));button('speaker').textContent=enabled?'Vivavoce attivo':'Vivavoce';};
  button('audio').onclick=()=>c.audio.play().then(()=>button('audio').hidden=true).catch(()=>message('Consenti la riproduzione audio.'));
  c.timer=setInterval(()=>poll(c),2000);return c;
 }
 const owns=c=>active===c&&uid===c.user&&disposed===c.guard&&!c.ending;
 function clear(c){if(!c)return;window.AndroidBridge?.dismissCallNotification?.(c.call.id);clearInterval(c.timer);clearTimeout(c.connectionTimer);c.pc?.close();c.stream?.getTracks().forEach(t=>t.stop());c.audio.pause();c.audio.srcObject=null;c.localVideo.pause();c.localVideo.srcObject=null;c.node.remove();window.AndroidBridge?.setCallAudioActive?.(c.call.id,false);window.MeditalyAudio?.resumeAssistants();if(active===c)active=null;}
 async function finish(c,action){if(!owns(c))return;c.ending=true;let result=null;try{result=await rpc('update_voice_call',{p_call:c.call.id,p_action:action});}catch(_){message('Connessione persa. Chiamata chiusa sul dispositivo.');}finally{if(active===c)clear(c);}return result;}
 function complete(c,status){window.AndroidBridge?.dismissCallNotification?.(c.call.id);clearInterval(c.timer);clearTimeout(c.connectionTimer);c.pc?.close();c.stream?.getTracks().forEach(t=>t.stop());c.audio.pause();c.audio.srcObject=null;c.localVideo.pause();c.localVideo.srcObject=null;window.AndroidBridge?.setCallAudioActive?.(c.call.id,false);window.MeditalyAudio?.resumeAssistants();c.ending=true;c.node.querySelector('.meditaly-call-video').hidden=true;c.status.textContent=labels[status]||'Chiamata terminata';c.node.querySelectorAll('button').forEach(b=>b.hidden=!b.hasAttribute('data-close'));}
 async function config(){const {data,error}=await sb.functions.invoke('voice-call',{body:{action:'config'}});if(error||!data?.iceServers?.length)throw new Error('Chiamate e videochiamate richiedono la configurazione del servizio di collegamento. Contatta l’amministratore Meditaly.');return data.iceServers;}
 async function microphone(c,servers){
  if(!navigator.mediaDevices?.getUserMedia||!window.RTCPeerConnection)throw new Error('Aggiorna il browser o Android System WebView per le chiamate.');
  window.MeditalyAudio?.pauseAssistants();const stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true},video:c.video?{facingMode:'user',width:{ideal:640},height:{ideal:480},frameRate:{ideal:24,max:30}}:false});
  if(!owns(c)){stream.getTracks().forEach(t=>t.stop());return false;}c.stream=stream;if(c.video){c.localVideo.muted=true;c.localVideo.srcObject=stream;c.localVideo.play().catch(()=>{});c.node.querySelector('.meditaly-call-video').hidden=false;c.node.querySelector('[data-camera]').hidden=false;}window.AndroidBridge?.setCallAudioActive?.(c.call.id,true);c.pc=new RTCPeerConnection({iceServers:servers});
  stream.getTracks().forEach(track=>c.pc.addTrack(track,stream));
  c.pc.onicecandidate=e=>{if(e.candidate&&owns(c)){c.signalQueue=c.signalQueue.then(()=>owns(c)?rpc('send_voice_call_signal',{p_call:c.call.id,p_kind:'ice',p_payload:e.candidate.toJSON()}):null).catch(()=>{if(owns(c))message('Connessione audio in preparazione…');});}};
  c.pc.ontrack=e=>{if(!owns(c))return;if(!c.remoteStream)c.remoteStream=new MediaStream();if(!c.remoteStream.getTracks().includes(e.track))c.remoteStream.addTrack(e.track);c.audio.srcObject=c.remoteStream;c.audio.play().catch(()=>c.node.querySelector('[data-audio]').hidden=false);};
  c.pc.onconnectionstatechange=()=>{if(!owns(c))return;const status=c.pc.connectionState;if(status==='connected'){clearTimeout(c.connectionTimer);c.status.textContent=c.video?'In videochiamata':'In chiamata';c.node.querySelector('[data-mute]').hidden=false;if(window.AndroidBridge?.setCallSpeaker)c.node.querySelector('[data-speaker]').hidden=false;window.AndroidBridge?.setCallAudioActive?.(c.call.id,true);}else if(status==='failed'){finish(c,'fail');}else if(status==='disconnected'){c.status.textContent='Connessione instabile…';clearTimeout(c.connectionTimer);c.connectionTimer=setTimeout(()=>{if(owns(c)&&c.pc.connectionState!=='connected')finish(c,'fail');},15000);}};
  return true;
 }
 async function start(recipient,name,mode='audio'){
  if(!['audio','video'].includes(mode)||!validId(recipient))return;
  if(starting||active||!sb||!uid||patient||window.MeditalyAudio?.busy())return;starting=true;const epoch=disposed,owner=uid;let streamCall=null;
  try{const servers=await config();if(epoch!==disposed||uid!==owner)return;
   const call=await rpc(mode==='video'?'start_media_call':'start_voice_call',mode==='video'?{p_patient:recipient,p_mode:mode}:{p_patient:recipient});if(epoch!==disposed||uid!==owner){await sb.rpc('update_voice_call',{p_call:call.id,p_action:'end'});return;}const c=create(call,name,false);streamCall=c;
   if(!await microphone(c,servers))return;
   const offer=await c.pc.createOffer();if(!owns(c))return;await c.pc.setLocalDescription(offer);await rpc('send_voice_call_signal',{p_call:call.id,p_kind:'offer',p_payload:{type:offer.type,sdp:offer.sdp}});
   if(!owns(c))return;const {data,error}=await sb.functions.invoke('voice-call',{body:{action:'notify',call_id:call.id}});if(error||!data?.ok)c.status.textContent='Chiamata avviata; avviso al telefono non confermato.';else c.status.textContent='Squilla…';
  }catch(e){if(streamCall){await finish(streamCall,'fail');}alert(e.message==='CALL_BUSY'?'Il paziente o il medico è già in una chiamata.':e.message||'Impossibile avviare la chiamata.');}finally{starting=false;}
 }
 async function answer(c){
  if(!owns(c)||c.accepting||c.call.status!=='ringing')return;c.accepting=true;c.node.querySelector('[data-answer]').disabled=true;c.status.textContent=c.video?'Collegamento video…':'Collegamento audio…';
  try{const servers=await config();if(!owns(c))return;if(!await microphone(c,servers))return;
   const result=await rpc('update_voice_call',{p_call:c.call.id,p_action:'accept'});if(!owns(c))return;c.call=result;c.connectionTimer=setTimeout(()=>{if(owns(c)&&c.pc?.connectionState!=='connected')finish(c,'fail');},45000);if(result.status!=='accepted'){complete(c,result.status);return;}
   c.node.querySelector('[data-answer]').hidden=true;c.node.querySelector('[data-reject]').hidden=true;c.node.querySelector('[data-end]').hidden=false;await poll(c);
  }catch(e){if(owns(c)){c.stream?.getTracks().forEach(t=>t.stop());c.pc?.close();c.pc=null;c.stream=null;c.localVideo.srcObject=null;c.node.querySelector('.meditaly-call-video').hidden=true;window.AndroidBridge?.setCallAudioActive?.(c.call.id,false);window.MeditalyAudio?.resumeAssistants();c.status.textContent=e.name==='NotAllowedError'?(c.video?'Consenti microfono e videocamera, poi riprova.':'Consenti il microfono, poi riprova.'):e.message||'Impossibile collegarsi. Riprova.';c.node.querySelector('[data-answer]').disabled=false;}}
  finally{c.accepting=false;}
 }
 async function poll(c){
  if(!owns(c)||c.polling)return;c.polling=true;
  try{const beat=Date.now()-c.lastBeat>15000;const call=await rpc('update_voice_call',{p_call:c.call.id,p_action:beat?'heartbeat':'read'});if(!owns(c))return;if(beat)c.lastBeat=Date.now();c.call=call;if(terminal.has(call.status)){complete(c,call.status);return;}
   if(!c.pc||(patient&&call.status!=='accepted'))return;const {data,error}=await sb.from('voice_call_signals').select('id,sender_id,kind,payload').eq('call_id',call.id).gt('id',c.cursor).order('id').limit(300);if(error)throw error;
   for(const signal of data||[]){if(!owns(c))return;if(signal.sender_id===uid){c.cursor=signal.id;continue;}
    if(signal.kind==='offer'&&patient&&!c.pc.remoteDescription){await c.pc.setRemoteDescription(signal.payload);const answer=await c.pc.createAnswer();await c.pc.setLocalDescription(answer);await rpc('send_voice_call_signal',{p_call:call.id,p_kind:'answer',p_payload:{type:answer.type,sdp:answer.sdp}});}
    else if(signal.kind==='answer'&&!patient&&!c.pc.remoteDescription)await c.pc.setRemoteDescription(signal.payload);
    else if(signal.kind==='ice')c.candidates.push(signal.payload);
    c.cursor=signal.id;
   }
   if(c.pc.remoteDescription){for(const candidate of c.candidates.splice(0))await c.pc.addIceCandidate(candidate);}
  }catch(_){if(owns(c))c.status.textContent='Verifica della connessione…';}finally{c.polling=false;}
 }
 async function incoming(id,action){
  if(!sb||!uid||!patient||!validId(id))return false;
  if(active){if(active.call.id===id&&action==='reject')await finish(active,'reject');else if(active.call.id===id&&action==='answer')await answer(active);return active?.call.id===id;}
  const epoch=disposed;try{const call=await rpc('update_voice_call',{p_call:id,p_action:'read'});if(epoch!==disposed||call.patient_id!==uid||call.status!=='ringing')return false;
   const {data:doctor}=await sb.from('profiles').select('full_name').eq('id',call.clinician_id).maybeSingle();if(epoch!==disposed||active)return false;const c=create(call,doctor?.full_name||'Il tuo medico',true);
   window.AndroidBridge?.dismissCallNotification?.(id);
   if(action==='reject')await finish(c,'reject');else if(action==='answer')await answer(c);return true;
  }catch(_){return false;}
 }
 async function checkInbox(){if(!sb||!uid||!patient||active||polling)return;polling=true;const epoch=disposed;try{const {data,error}=await sb.from('voice_calls').select('id').eq('patient_id',uid).eq('status','ringing').gt('expires_at',new Date().toISOString()).order('created_at',{ascending:false}).limit(1);if(!error&&epoch===disposed&&data?.[0])await incoming(data[0].id);}finally{polling=false;}}
 function init(client,userId,isPatient){if(sb===client&&uid===userId&&patient===isPatient)return;disposed++;clearInterval(inboxTimer);if(active)clear(active);sb=client;uid=userId;patient=isPatient;if(uid&&patient){inboxTimer=setInterval(()=>checkInbox().catch(()=>{}),8000);checkInbox().catch(()=>{});}}
 async function history(root,peer){
 if(!root||!sb||!uid)return;const owner=uid;root.textContent='';
 const {data,error}=await sb.from('voice_calls').select('id,status,created_at,answered_at,ended_at,clinician_id,patient_id,expires_at,media_mode').or(`and(clinician_id.eq.${owner},patient_id.eq.${peer}),and(clinician_id.eq.${peer},patient_id.eq.${owner})`).order('created_at',{ascending:false}).limit(10);
 if(!root.isConnected||owner!==uid)return;if(error){root.textContent='Registro chiamate non disponibile.';return;}if(!data?.length)return;
 const details=document.createElement('details'),summary=document.createElement('summary');summary.textContent='☎ Chiamate recenti';details.append(summary);
 const statuses={ringing:'In attesa di risposta',accepted:'In corso',ended:'Terminata',rejected:'Rifiutata',missed:'Senza risposta',failed:'Interrotta'};
 for(let row of data){if(!terminal.has(row.status)&&Date.parse(row.expires_at)<Date.now()){try{row=await rpc('update_voice_call',{p_call:row.id,p_action:'read'});}catch(_){}if(!root.isConnected||owner!==uid)return;}const line=document.createElement('p');line.textContent=new Date(row.created_at).toLocaleString('it-IT')+' · '+(row.media_mode==='video'?'Videochiamata':'Chiamata')+' · '+(statuses[row.status]||row.status);details.append(line);}root.append(details);
 }
 window.MeditalyCalls={init,start,incoming,history,busy:()=>!!active||starting};
 window.openMeditalyCall=(id,action)=>{if(!uid)return false;incoming(id,action).catch(()=>{});return true;};
 window.addEventListener('pagehide',()=>{if(active){const c=active;sb.rpc('update_voice_call',{p_call:c.call.id,p_action:'end'}).catch(()=>{});clear(c);}});
 window.addEventListener('meditaly-communication-start',()=>{});
})();
