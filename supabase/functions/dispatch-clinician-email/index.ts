import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.116.0";

const url = Deno.env.get("SUPABASE_URL") || "";
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const db = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
const dashboard = "https://med-italy.vercel.app/";
const escapeHtml = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch] || ch));
function romeCutoff(day: string) {
 const [y,m,d]=day.split('-').map(Number), desired=Date.UTC(y,m-1,d,20);
 const formatter=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Rome',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
 let guess=desired;
 for(let i=0;i<3;i++){const p=Object.fromEntries(formatter.formatToParts(new Date(guess)).map(x=>[x.type,x.value]));guess-=Date.UTC(+p.year,+p.month-1,+p.day,+p.hour,+p.minute,+p.second)-desired;}
 return new Date(guess).toISOString();
}
const activityLabels: Record<string,string>={patient_daily_checkins:'aggiornamenti di salute',medication_intakes:'registrazioni terapia',care_questionnaire_responses:'questionari',medical_reports:'referti caricati',patient_vaccine_declarations:'aggiornamenti vaccinazioni',appointments:'aggiornamenti appuntamenti',patient_journal_entries:'condivisioni diario',chat_messages:'messaggi dal paziente'};
async function dailyReport(clinicianId: string,patientIds: string[],reportDay: string){
 const previous=new Date(Date.parse(reportDay+'T12:00:00Z')-86400000).toISOString().slice(0,10);
 const start=romeCutoff(previous),end=romeCutoff(reportDay);
 const profiles=await db.from('profiles').select('id,full_name').in('id',patientIds);if(profiles.error)throw profiles.error;
 const names=new Map((profiles.data||[]).map(p=>[p.id,p.full_name||'Paziente']));
 const counts=new Map<string,Record<string,number>>();
 for(let offset=0;;offset+=1000){
  const result=await db.from('clinician_patient_activity').select('id,patient_id,kind').eq('clinician_id',clinicianId).gte('occurred_at',start).lt('occurred_at',end).order('id').range(offset,offset+999);
  if(result.error)throw result.error;
  for(const event of result.data||[]){if(!names.has(event.patient_id))continue;const n=counts.get(event.patient_id)||{};n[event.kind]=(n[event.kind]||0)+1;counts.set(event.patient_id,n);}
  if((result.data||[]).length<1000)break;
 }
 const rows=[...counts].map(([id,n])=>({id,name:names.get(id)||'Paziente',labels:Object.entries(n).map(([kind,total])=>`${total} ${activityLabels[kind]||'attività'}`)})).sort((a,b)=>a.name.localeCompare(b.name,'it'));
 const period=`Dalle 20:00 del ${previous} alle 20:00 del ${reportDay} (ora italiana)`;
 const link=(id:string)=>`${dashboard}?patient=${encodeURIComponent(id)}&tab=summary`;
 const caveat='Sono incluse le attività ricevute dal server nel periodo, anche se registrate prima offline. Il diario privato non condiviso resta escluso. I dettagli sono nella dashboard protetta.';
 const text=`Riepilogo Meditaly · ${period}\n\n`+(rows.length?rows.map(x=>`${x.name}: ${x.labels.join(', ')}\n${link(x.id)}`).join('\n\n'):'Nessuna attività ricevuta nel periodo.')+`\n\n${caveat}`;
 const html=`<!doctype html><html lang="it"><head><meta charset="utf-8"><title>Riepilogo Meditaly</title></head><body style="font-family:Arial,sans-serif;color:#203c2c;padding:24px"><h1>Riepilogo quotidiano</h1><p>${escapeHtml(period)}</p>${rows.length?rows.map(x=>`<p><strong>${escapeHtml(x.name)}</strong><br>${escapeHtml(x.labels.join(' · '))}<br><a href="${link(x.id)}">Apri scheda</a></p>`).join(''):'<p>Nessuna attività ricevuta nel periodo.</p>'}<p>${escapeHtml(caveat)}</p></body></html>`;
 return {text,html};
}

function response(body: object, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

async function dispatch(row: any, apiKey: string, sender: string) {
  const { data: profile, error: profileError } = await db.from("profiles")
    .select("role,account_active").eq("id", row.clinician_id).single();
  if (profileError) throw profileError;
  if (!profile?.account_active || !["Clinician", "Administrator"].includes(profile.role)) return "skip";

  const { data: account, error: accountError } = await db.auth.admin.getUserById(row.clinician_id);
  if (accountError) throw accountError;
  const email = account?.user?.email;
  if (!email || !account.user.email_confirmed_at) return "skip";

  const { data: links, error: linkError } = await db.from("patient_clinicians")
    .select("patient_id").eq("clinician_id", row.clinician_id).eq("active", true);
  if (linkError) throw linkError;
  const patients = (links || []).map(x => x.patient_id);
  if (!patients.length) return "skip";
  if(row.kind!=="daily_report"&&Date.now()-Date.parse(row.created_at)>86400000)return "skip";

  let subject: string;
  let content: string;
  let html: string | undefined;
  if (row.kind === "red_checkin") {
    const checkinId = row.event_key.split(":")[1];
    const { data: checkin, error } = await db.from("patient_daily_checkins")
      .select("patient_id,status").eq("id", checkinId).maybeSingle();
    if (error) throw error;
    if (!checkin || checkin.status !== "red" || !patients.includes(checkin.patient_id)) return "skip";
    subject = "Meditaly · Segnalazione da valutare";
    content = `Un paziente collegato ha indicato di non sentirsi bene. Apri la panoramica clinica per vedere la segnalazione e i dettagli nel portale protetto.\n\n${dashboard}\n\nQuesta email è una notifica e non sostituisce i canali di emergenza.`;
  } else if(row.kind === "chat_message") {
    const messageId=row.event_key.split(":")[1];
    const {data:message,error}=await db.from("chat_messages").select("sender_id,recipient_id").eq("id",messageId).maybeSingle();
    if(error)throw error;
    if(!message || message.recipient_id!==row.clinician_id || !patients.includes(message.sender_id))return "skip";
    subject="Meditaly · Nuovo messaggio da un paziente";
    content=`Hai ricevuto un nuovo messaggio. Accedi alla dashboard per leggerlo e rispondere.\n\n${dashboard}?patient=${encodeURIComponent(message.sender_id)}&tab=chat`;
  } else if (row.kind === "daily_report") {
    subject = row.payload_subject || `Meditaly · Riepilogo del ${row.report_day}`;
    if (row.payload_text) { content = row.payload_text; html = row.payload_html || undefined; }
    else {
      const report = await dailyReport(row.clinician_id, patients, row.report_day);
      content = report.text; html = report.html;
      const { error: snapshotError } = await db.from("clinician_email_outbox")
        .update({ payload_subject: subject, payload_text: content, payload_html: html }).eq("id", row.id).eq("status", "processing");
      if (snapshotError) throw snapshotError;
    }
  } else return "skip";

  const sent = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "Idempotency-Key": row.event_key,
    },
    body: JSON.stringify({ from: sender, to: [email], subject, text: content, ...(html ? { html } : {}) }),
  });
  if (!sent.ok) throw new Error(`RESEND_HTTP_${sent.status}`);
  const result = await sent.json();
  if (!result?.id) throw new Error("RESEND_MISSING_ID");
  const { error: updateError } = await db.from("clinician_email_outbox")
    .update({ status: "sent", resend_id: result.id, sent_at: new Date().toISOString() })
    .eq("id", row.id).eq("status", "processing");
  if (updateError) throw updateError;
  return "sent";
}

Deno.serve(async req => {
  if (req.method !== "POST") return response({ error: "METHOD_NOT_ALLOWED" }, 405);
  const given = req.headers.get("x-meditaly-cron-secret") || "";
  if (!given || !serviceKey) return response({ error: "UNAUTHORIZED" }, 401);
  const { data: secret, error: secretError } = await db.from("internal_job_secrets")
    .select("secret_value").eq("name", "daily-checkin").single();
  if (secretError || !secret?.secret_value || given !== secret.secret_value)
    return response({ error: "UNAUTHORIZED" }, 401);

  const apiKey = Deno.env.get("RESEND_API_KEY") || "";
  const sender = Deno.env.get("RESEND_FROM_EMAIL") || "";


  const { error: queueError } = await db.rpc("enqueue_clinician_daily_email_reports");
  if (queueError) return response({ error: "QUEUE_ERROR" }, 500);
  if (!apiKey || !sender) return response({ error: "RESEND_NOT_CONFIGURED", missing: [!apiKey&&"RESEND_API_KEY",!sender&&"RESEND_FROM_EMAIL"].filter(Boolean) }, 503);
  const { data: rows, error: claimError } = await db.rpc("claim_clinician_email_outbox");
  if (claimError) return response({ error: "CLAIM_ERROR" }, 500);

  const results = { sent: 0, skipped: 0, retry: 0 };
  for (const row of rows || []) {
    try {
      const result = await dispatch(row, apiKey, sender);
      if (result === "skip") {
        await db.from("clinician_email_outbox").update({ status: "skipped", last_error: "RECIPIENT_OR_EVENT_NO_LONGER_ELIGIBLE", last_error_at: new Date().toISOString() })
          .eq("id", row.id).eq("status", "processing");
        results.skipped++;
      } else results.sent++;
    } catch (error) {
      await db.from("clinician_email_outbox")
        .update({ status: row.attempts >= 8 ? "failed" : "pending",
          last_error: error instanceof Error && /^RESEND_[A-Z0-9_]+$/.test(error.message) ? error.message : "DELIVERY_FAILED", last_error_at: new Date().toISOString(),
          next_attempt_at: new Date(Date.now() + 5 * 60_000).toISOString() })
        .eq("id", row.id).eq("status", "processing");
      results.retry++;
    }
  }
  return response(results);
});
