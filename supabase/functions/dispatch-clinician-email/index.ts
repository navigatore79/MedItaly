import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.116.0";

const url = Deno.env.get("SUPABASE_URL") || "";
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const db = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
const dashboard = "https://med-italy.vercel.app/";
const escapeHtml = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch] || ch));
function romeMidnight(day: string) {
  const [year, month, date] = day.split("-").map(Number);
  const desired = Date.UTC(year, month - 1, date);
  const formatter = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Rome", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
  let guess = desired;
  for (let i = 0; i < 3; i++) {
    const parts = Object.fromEntries(formatter.formatToParts(new Date(guess)).map(part => [part.type, part.value]));
    const observed = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
    guess -= observed - desired;
  }
  return new Date(guess).toISOString();
}
async function dailyReport(clinicianId: string, patientIds: string[], reportDay: string) {
  const nextDay = new Date(Date.parse(reportDay + "T12:00:00Z") + 86400000).toISOString().slice(0, 10);
  const start = romeMidnight(reportDay), end = romeMidnight(nextDay);
  const [profiles, checkins, intakes, chats, journal] = await Promise.all([
    db.from("profiles").select("id,full_name").in("id", patientIds),
    db.from("patient_daily_checkins").select("patient_id,status").in("patient_id", patientIds).eq("checkin_date", reportDay),
    db.from("medication_intakes").select("patient_id,status").in("patient_id", patientIds).eq("intake_date", reportDay),
    db.from("chat_messages").select("sender_id,recipient_id").gte("sent_at", start).lt("sent_at", end).or(`sender_id.eq.${clinicianId},recipient_id.eq.${clinicianId}`).limit(2000),
    db.from("patient_journal_entries").select("patient_id").eq("shared_with", clinicianId).gte("shared_at", start).lt("shared_at", end).limit(1000),
  ]);
  for (const result of [profiles, checkins, intakes, chats, journal]) if (result.error) throw result.error;
  const names = new Map((profiles.data || []).map(p => [p.id, p.full_name || "Paziente"]));
  const rows = patientIds.map(id => {
    const checkin = (checkins.data || []).filter(x => x.patient_id === id).length;
    const intake = (intakes.data || []).filter(x => x.patient_id === id).length;
    const messages = (chats.data || []).filter(x => (x.sender_id === id && x.recipient_id === clinicianId) || (x.sender_id === clinicianId && x.recipient_id === id)).length;
    const shared = (journal.data || []).filter(x => x.patient_id === id).length;
    const labels = [checkin && "check-in", intake && `${intake} registrazioni terapia`, messages && `${messages} messaggi`, shared && `${shared} condivisioni diario`].filter(Boolean) as string[];
    return { id, name: names.get(id) || "Paziente", labels, messages };
  }).filter(x => x.labels.length).sort((a, b) => a.name.localeCompare(b.name, "it"));
  const urlFor = (id: string, tab: string) => `${dashboard}?patient=${encodeURIComponent(id)}&tab=${tab}`;
  const text = `Riepilogo Meditaly del ${reportDay} · ${rows.length} pazienti con interazioni (${patientIds.length} collegati).\n\n` +
    (rows.length ? rows.map(x => `${x.name}: ${x.labels.join(", ")}\nApri scheda: ${urlFor(x.id, "summary")}\n${x.messages ? `Rispondi nella chat: ${urlFor(x.id, "chat")}\n` : ""}`).join("\n") : "Nessuna interazione registrata oggi.\n") +
    "\nI dettagli clinici sono disponibili soltanto dopo l'accesso alla dashboard. Le registrazioni sono dichiarazioni dei pazienti.";
  const items = rows.map(x => `<tr><td style="padding:12px;border-bottom:1px solid #e4ece6"><strong>${escapeHtml(x.name)}</strong><br><span style="color:#587061">${escapeHtml(x.labels.join(" · "))}</span></td><td style="padding:12px;border-bottom:1px solid #e4ece6;white-space:nowrap"><a href="${urlFor(x.id, "summary")}" style="color:#276044;font-weight:700">Apri scheda</a>${x.messages ? `<br><a href="${urlFor(x.id, "chat")}" style="color:#276044;font-weight:700">Rispondi</a>` : ""}</td></tr>`).join("");
  const html = `<!doctype html><html lang="it"><head><meta charset="utf-8"><title>Riepilogo Meditaly</title></head><body style="font-family:Arial,sans-serif;background:#f4f8f5;color:#203c2c;padding:20px"><main style="max-width:620px;margin:auto;background:#fff;border:1px solid #dce9df;border-radius:16px;padding:24px"><h1 style="font-size:23px;margin:0 0 8px">Riepilogo quotidiano</h1><p>${escapeHtml(reportDay)} · ${rows.length} pazienti con interazioni</p>${rows.length ? `<table role="presentation" style="border-collapse:collapse;width:100%">${items}</table>` : "<p>Nessuna interazione registrata oggi.</p>"}<p style="color:#5d7664;font-size:13px">Apri i collegamenti dopo aver effettuato l'accesso. Dettagli clinici e messaggi sono disponibili solo nella dashboard protetta.</p></main></body></html>`;
  return { text, html };
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
  if (!apiKey || !sender) return response({ error: "RESEND_NOT_CONFIGURED" }, 503);

  const { error: queueError } = await db.rpc("enqueue_clinician_daily_email_reports");
  if (queueError) return response({ error: "QUEUE_ERROR" }, 500);
  const { data: rows, error: claimError } = await db.rpc("claim_clinician_email_outbox");
  if (claimError) return response({ error: "CLAIM_ERROR" }, 500);

  const results = { sent: 0, skipped: 0, retry: 0 };
  for (const row of rows || []) {
    try {
      const result = await dispatch(row, apiKey, sender);
      if (result === "skip") {
        await db.from("clinician_email_outbox").update({ status: "sent", sent_at: new Date().toISOString() })
          .eq("id", row.id).eq("status", "processing");
        results.skipped++;
      } else results.sent++;
    } catch (_error) {
      await db.from("clinician_email_outbox")
        .update({ status: row.attempts >= 8 ? "failed" : "pending",
          next_attempt_at: new Date(Date.now() + 5 * 60_000).toISOString() })
        .eq("id", row.id).eq("status", "processing");
      results.retry++;
    }
  }
  return response(results);
});
