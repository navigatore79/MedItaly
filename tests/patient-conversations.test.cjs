const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {JSDOM}=require(process.env.JSDOM_MODULE||'jsdom');
const root=path.join(__dirname,'..'),source=fs.readFileSync(path.join(root,'patient-conversations.js'),'utf8');
function setup(rpc){
 const dom=new JSDOM('<section id="overview"><div id="inbox"></div></section>');
 const context=vm.createContext({document:dom.window.document,Intl,Date,console});
 vm.runInContext(source.replaceAll('export function','function'),context);
 const actions=[];
 const inbox=context.createPatientConversations({db:{rpc},host:dom.window.document.getElementById('inbox'),getOwnerId:()=> 'doctor',onChat:async id=>actions.push(['chat',id]),onRecord:async id=>actions.push(['record',id]),onCompose:()=>actions.push(['compose'])});
 return {dom,context,inbox,actions,doc:dom.window.document};
}
const rows=[
 {patient_id:'quiet',full_name:'Èlia Esempio',last_body:'Un messaggio precedente',last_sender_id:'quiet',last_sent_at:'2026-10-27T08:00:00Z',unread_count:1},
 {patient_id:'silent',full_name:'Anna Demo',last_sent_at:null,unread_count:0},
 {patient_id:'recent',full_name:'Mario Dimostrativo',last_body:'Confermo il controllo',last_sender_id:'doctor',last_sent_at:'2026-10-30T08:00:00Z',unread_count:0},
 {patient_id:'voice',full_name:'Rosa Demo',has_audio:true,last_sender_id:'voice',last_sent_at:'2026-10-29T08:00:00Z',unread_count:125}
];
test('inbox sorts by conversation activity and preserves quiet and no-message patients',async()=>{
 const s=setup(async name=>{assert.equal(name,'clinician_conversation_summaries');return {data:rows};});await s.inbox.load();
 assert.deepEqual([...s.doc.querySelectorAll('.conversation-row')].map(n=>n.dataset.patient),['recent','voice','quiet','silent']);
 assert.match(s.doc.querySelector('.conversation-preview').textContent,/Tu: Confermo/);
 assert.match(s.doc.querySelector('[data-patient="voice"]').textContent,/Messaggio vocale/);
 assert.equal(s.doc.querySelector('.conversation-badge').textContent,'99+');
 assert.match(s.doc.querySelector('[data-patient="silent"]').textContent,/Nessuna comunicazione/);
 assert.equal(s.doc.querySelector('.conversation-unread-total').textContent,'2');
 assert.doesNotMatch(s.doc.getElementById('overview').textContent,/triage|check-in|Richiedono attenzione/i);
});
test('search, unread filter, chat, clinical record and compose actions work independently',async()=>{
 const s=setup(async()=>({data:rows}));await s.inbox.load();
 s.doc.querySelector('[data-filter="unread"]').click();assert.equal(s.doc.querySelectorAll('.conversation-row').length,2);
 const input=s.doc.querySelector('input');input.value='elia';input.dispatchEvent(new s.dom.window.Event('input'));
 assert.equal(s.doc.querySelector('.conversation-name').textContent,'Èlia Esempio');
 await s.doc.querySelector('.conversation-open').onclick();await s.doc.querySelector('.conversation-record').onclick();s.doc.querySelector('.conversation-compose').click();
 assert.deepEqual(s.actions,[['chat','quiet'],['record','quiet'],['compose']]);
 input.value='nobody';input.dispatchEvent(new s.dom.window.Event('input'));assert.match(s.doc.querySelector('.conversation-empty').textContent,/Nessun paziente trovato/);
});
test('API errors preserve the previous list and refresh can recover without fake zero counters',async()=>{
 let fail=true;const s=setup(async()=>fail?{error:{message:'Rete assente'}}:{data:rows});
 await s.inbox.load();assert.match(s.doc.querySelector('[role="status"]').textContent,/Rete assente/);assert.match(s.doc.querySelector('.conversation-empty').textContent,/Elenco non disponibile/);
 fail=false;await s.inbox.load();assert.equal(s.doc.querySelectorAll('.conversation-row').length,4);
 fail=true;await s.inbox.load();assert.equal(s.doc.querySelectorAll('.conversation-row').length,4);assert.equal(s.doc.querySelector('.conversation-unread-total').textContent,'2');
 fail=false;await s.inbox.load();assert.equal(s.doc.querySelector('[role="status"]').textContent,'');
});
test('late API responses cannot replace a newer inbox refresh; names and message bodies are escaped',async()=>{
 let resolve;let calls=0;const s=setup(()=>++calls===1?new Promise(r=>resolve=r):Promise.resolve({data:[{patient_id:'safe',full_name:'<img src=x onerror=alert(1)>',last_body:'<script>bad()</script>',last_sent_at:'2026-10-30T08:00:00Z'}]}));
 const old=s.inbox.load();await s.inbox.load();resolve({data:rows});await old;
 assert.equal(s.doc.querySelectorAll('.conversation-row').length,1);assert.equal(s.doc.querySelectorAll('img,script').length,0);assert.match(s.doc.querySelector('.conversation-name').textContent,/<img/);
});
test('Rome timestamps distinguish today, yesterday and the calendar year',()=>{
 const s=setup(async()=>({data:[]}));
 assert.equal(s.context.conversationTime('2026-10-30T08:00:00Z',new Date('2026-10-30T23:30:00+01:00')),'09:00');
 assert.equal(s.context.conversationTime('2026-10-29T08:00:00Z',new Date('2026-10-30T12:00:00Z')),'Ieri');
 assert.equal(s.context.conversationTime('2025-01-02T08:00:00Z',new Date('2026-10-30T12:00:00Z')),'02/01/25');
 assert.equal(s.context.conversationTime('2026-03-29T08:00:00Z',new Date('2026-03-30T00:30:00+02:00')),'Ieri');
});
test('messages are marked read only when the conversation is visible, and only for displayed incoming IDs',async()=>{
 const app=fs.readFileSync(path.join(root,'app.js'),'utf8'),start=app.indexOf('function conversationVisible('),end=app.indexOf('\nlet overviewRefreshTimer',start);
 const dom=new JSDOM('<section id="patients" class="hidden"><div id="chat"></div><p id="chatMsg"></p></section>'),updates=[],filters=[];
 const chain={in:(...a)=>{filters.push(['in',...a]);return chain;},eq:(...a)=>{filters.push(['eq',...a]);return chain;},then:yes=>Promise.resolve({data:null}).then(yes)};
 const context=vm.createContext({selected:'patient',me:{id:'doctor'},$:id=>dom.window.document.getElementById(id),sb:{from:table=>({update:data=>{updates.push({table,data});return chain;}})},queueOverviewRefresh(){},out:(n,t)=>n.textContent=t,Date});
 vm.runInContext(app.slice(start,end),context);
 const messages=[{id:'unread',sender_id:'patient',recipient_id:'doctor',is_read:false},{id:'outgoing',sender_id:'doctor',recipient_id:'patient',is_read:false},{id:'old',sender_id:'patient',recipient_id:'doctor',is_read:true}];
 await context.markConversationRead('patient',messages);assert.equal(updates.length,0);
 dom.window.document.getElementById('patients').classList.remove('hidden');await context.markConversationRead('patient',messages);
 assert.equal(updates.length,1);assert.deepEqual(JSON.parse(JSON.stringify(filters[0])),['in','id',['unread']]);
 assert.ok(filters.some(f=>f[0]==='eq'&&f[1]==='recipient_id'&&f[2]==='doctor'));
 assert.ok(filters.some(f=>f[0]==='eq'&&f[1]==='sender_id'&&f[2]==='patient'));
});

test('realtime refreshes the overview for other patients, outgoing messages and read updates',async()=>{
 const app=fs.readFileSync(path.join(root,'app.js'),'utf8'),start=app.indexOf('function ensureDashboardChatRealtime(){'),end=app.indexOf('\n}\n',start)+2;
 const handlers=[];let refreshes=0;
 const channel={on:(type,filter,callback)=>{handlers.push({filter,callback});return channel;},subscribe:()=>channel};
 const context=vm.createContext({dashboardChatChannel:null,chatUserId:'doctor',selected:null,sb:{channel:()=>channel},queueOverviewRefresh:()=>refreshes++});
 vm.runInContext(app.slice(start,end),context);context.ensureDashboardChatRealtime();
 const incoming=handlers.find(h=>h.filter.filter==='recipient_id=eq.doctor');
 await incoming.callback({eventType:'INSERT',new:{sender_id:'unselected-patient'}});
 await incoming.callback({eventType:'UPDATE',new:{sender_id:'unselected-patient'}});
 await handlers.find(h=>h.filter.filter==='sender_id=eq.doctor').callback();
 assert.equal(refreshes,3);
});
