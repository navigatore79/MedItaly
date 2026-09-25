import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.116.0";

const url = Deno.env.get("SUPABASE_URL") || "";
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const db = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
const dashboard = "https://med-italy.vercel.app/";

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
  if (row.kind === "red_checkin") {
    const checkinId = row.event_key.split(":")[1];
    const { data: checkin, error } = await db.from("patient_daily_checkins")
      .select("patient_id,status").eq("id", checkinId).maybeSingle();
    if (error) throw error;
    if (!checkin || checkin.status !== "red" || !patients.includes(checkin.patient_id)) return "skip";
    subject = "Meditaly · Segnalazione da valutare";
    content = `Un paziente collegato ha indicato di non sentirsi bene. Apri la panoramica clinica per vedere la segnalazione e i dettagli nel portale protetto.\n\n${dashboard}\n\nQuesta email è una notifica e non sostituisce i canali di emergenza.`;
  } else if (row.kind === "daily_report") {
    const [{ data: checkins, error: checkinError }, { data: intakes, error: intakeError }] = await Promise.all([
      db.from("patient_daily_checkins").select("patient_id,status")
        .in("patient_id", patients).eq("checkin_date", row.report_day),
      db.from("medication_intakes").select("patient_id,status")
        .in("patient_id", patients).eq("intake_date", row.report_day),
    ]);
    if (checkinError || intakeError) throw checkinError || intakeError;
    const count = (list: any[], status: string) => list.filter(x => x.status === status).length;
    subject = `Meditaly · Riepilogo del ${row.report_day}`;
    content = `Riepilogo dei dati registrati oggi dai pazienti collegati (${row.report_day}, ora italiana):\n\n` +
      `Pazienti collegati: ${patients.length}\n` +
      `Check-in: ${(checkins || []).length} (bene: ${count(checkins || [], "green")}, così così: ${count(checkins || [], "yellow")}, non sto bene: ${count(checkins || [], "red")})\n` +
      `Assunzioni registrate: ${(intakes || []).length} (assunte: ${count(intakes || [], "taken")}, non assunte: ${count(intakes || [], "skipped")}, non ricordate: ${count(intakes || [], "unknown")})\n\n` +
      `Per sapere chi ha registrato i dati e consultarne i dettagli, accedi alla dashboard protetta:\n${dashboard}\n\nLe registrazioni si basano sulle dichiarazioni dei pazienti.`;
  } else return "skip";

  const sent = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "Idempotency-Key": row.event_key,
    },
    body: JSON.stringify({ from: sender, to: [email], subject, text: content }),
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
