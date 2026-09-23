import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const GUIDELINE_DOMAINS = [
  "iss.it", "snlg.iss.it", "who.int", "salute.gov.it", "aifa.gov.it",
  "ema.europa.eu", "ecdc.europa.eu", "osservatorionazionalescreening.it",
  "gise.it", "siditalia.it", "aemmedi.it", "siia.it", "aism.it",
  "aiom.it", "reumatologia.it", "sipirs.it", "giornaledicardiologia.it",
  "escardio.org", "eshonline.org", "nice.org.uk", "ersnet.org", "eular.org"
];

type ConversationItem = { role: "user" | "assistant"; content: string };

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, "Content-Type": "application/json; charset=utf-8" },
  });
}

function cleanText(value: unknown, max = 1200) {
  return String(value || "").trim().slice(0, max);
}

function outputText(data: any): string {
  const parts: string[] = [];
  for (const item of data?.output || []) {
    if (item?.type !== "message") continue;
    for (const c of item?.content || []) {
      if (c?.type === "output_text" && c?.text) parts.push(c.text);
    }
  }
  return parts.join("\n").trim();
}

function collectSources(data: any) {
  const out: { title: string; url: string; domain: string }[] = [];
  const seen = new Set<string>();
  const add = (url?: string, title?: string) => {
    if (!url || seen.has(url)) return;
    try {
      const domain = new URL(url).hostname.replace(/^www\./, "");
      seen.add(url);
      out.push({ title: title || domain, url, domain });
    } catch {}
  };
  for (const item of data?.output || []) {
    if (item?.type === "web_search_call") {
      for (const source of item?.action?.sources || []) add(source?.url, source?.title);
    }
    if (item?.type === "message") {
      for (const content of item?.content || []) {
        for (const annotation of content?.annotations || []) {
          if (annotation?.type === "url_citation") add(annotation?.url, annotation?.title);
        }
      }
    }
  }
  return out.slice(0, 10);
}

async function requestKey(req: Request) {
  const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const userAgent = req.headers.get("user-agent") || "unknown";
  const raw = new TextEncoder().encode(`${forwarded}|${userAgent}|medi`);
  const digest = await crypto.subtle.digest("SHA-256", raw);
  return Array.from(new Uint8Array(digest)).map(x => x.toString(16).padStart(2, "0")).join("");
}

async function withinRateLimit(req: Request) {
  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) return false;
  const client = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const key = await requestKey(req);
  const minute = await client.rpc("consume_medi_rate", { p_key_hash: key, p_limit: 16, p_window_seconds: 60 });
  if (minute.error || minute.data !== true) return false;
  const day = await client.rpc("consume_medi_rate", { p_key_hash: key, p_limit: 160, p_window_seconds: 86400 });
  return !day.error && day.data === true;
}

async function reverseApprox(lat: number, lon: number) {
  const rlat = Math.round(lat * 100) / 100;
  const rlon = Math.round(lon * 100) / 100;
  try {
    const u = new URL("https://nominatim.openstreetmap.org/reverse");
    u.searchParams.set("format", "jsonv2");
    u.searchParams.set("lat", String(rlat));
    u.searchParams.set("lon", String(rlon));
    u.searchParams.set("zoom", "10");
    u.searchParams.set("addressdetails", "1");
    const response = await fetch(u, {
      headers: {
        "User-Agent": "Meditaly-Beta/0.6.2 (privacy contact: maiellociro@gmail.com)",
        "Accept-Language": "it",
      },
    });
    if (!response.ok) return null;
    const data = await response.json();
    const address = data?.address || {};
    return {
      city: address.city || address.town || address.village || address.municipality || "",
      region: address.state || address.region || "",
      country: "IT",
    };
  } catch {
    return null;
  }
}

async function loadPatientContext(req: Request) {
  const authorization = req.headers.get("Authorization") || "";
  if (!authorization.startsWith("Bearer ")) {
    return { authenticated: false, doctorLinked: false, firstName: "", context: "" };
  }

  const url = Deno.env.get("SUPABASE_URL") || "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || "";
  if (!url || !anonKey) throw new Error("Configurazione Supabase incompleta");

  const client = createClient(url, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const token = authorization.slice(7);
  const { data: userData, error: userError } = await client.auth.getUser(token);
  const user = userData?.user;
  if (userError || !user) return { authenticated: false, doctorLinked: false, firstName: "", context: "" };

  const [profileResult, linkResult, medicationResult, followupResult, appointmentResult] = await Promise.all([
    client.from("profiles").select("full_name,role").eq("id", user.id).maybeSingle(),
    client.from("patient_clinicians")
      .select("clinician_id,profiles!patient_clinicians_clinician_id_fkey(full_name)")
      .eq("patient_id", user.id).eq("active", true).maybeSingle(),
    client.from("medications")
      .select("name,dose,route,instructions,starts_on,ends_on,active,medication_schedules(time_of_day,weekdays,interval_hours)")
      .eq("patient_id", user.id).eq("active", true).order("created_at", { ascending: false }).limit(20),
    client.from("followup_milestones")
      .select("milestone_label,milestone_type,due_date,completed,notes")
      .eq("patient_id", user.id).eq("completed", false).order("due_date", { ascending: true }).limit(20),
    client.from("appointments")
      .select("status,reason,requested_date,requested_time_window,proposed_start,location_type,location_label")
      .eq("patient_id", user.id).in("status", ["Requested", "Proposed", "Confirmed"])
      .order("created_at", { ascending: false }).limit(10),
  ]);

  const profile = profileResult.data as any;
  if (!profile || !["Patient", "Administrator"].includes(String(profile.role))) {
    return { authenticated: false, doctorLinked: false, firstName: "", context: "" };
  }

  const link = linkResult.data as any;
  const clinicianProfile = Array.isArray(link?.profiles) ? link.profiles[0] : link?.profiles;
  const care = {
    patient_name: profile.full_name || null,
    assigned_clinician: clinicianProfile?.full_name || null,
    active_medications: medicationResult.error ? [] : medicationResult.data || [],
    pending_controls: followupResult.error ? [] : followupResult.data || [],
    active_appointments: appointmentResult.error ? [] : appointmentResult.data || [],
  };

  return {
    authenticated: true,
    doctorLinked: Boolean(link?.clinician_id),
    firstName: cleanText(profile.full_name, 80).split(/\s+/)[0] || "",
    context: JSON.stringify(care),
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Metodo non consentito" }, 405);

  const apiKey = Deno.env.get("OPENAI_API_KEY");
  if (!apiKey) return json({ error: "Motore Medi non ancora configurato sul backend." }, 503);
  if (!(await withinRateLimit(req))) {
    return json({ error: "Hai raggiunto il limite temporaneo di richieste a Medi. Riprova tra poco." }, 429);
  }

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "Richiesta non valida" }, 400); }

  const requestedMode = cleanText(body?.mode, 30);
  const mode = requestedMode === "screening" || requestedMode === "guidelines" ? requestedMode : "conversation";
  const question = cleanText(body?.question, 900);
  const history: ConversationItem[] = Array.isArray(body?.history)
    ? body.history.slice(-8).map((item: any) => ({
        role: item?.role === "assistant" ? "assistant" : "user",
        content: cleanText(item?.content, 1200),
      })).filter((item: ConversationItem) => item.content)
    : [];
  const radius = Math.max(1, Math.min(Number(body?.radius_km || 50), 50));
  if (mode !== "screening" && !question) return json({ error: "Scrivi una domanda per Medi." }, 400);

  let patient = { authenticated: false, doctorLinked: false, firstName: "", context: "" };
  try { patient = await loadPatientContext(req); } catch (error) { console.error("Medi patient context", error); }
  if (mode === "conversation" && !patient.authenticated) {
    return json({ error: "Accedi a Meditaly per parlare con Medi del tuo percorso personale." }, 401);
  }

  let approximate: any = null;
  if (mode === "screening" && Number.isFinite(Number(body?.location?.latitude)) && Number.isFinite(Number(body?.location?.longitude))) {
    approximate = await reverseApprox(Number(body.location.latitude), Number(body.location.longitude));
  }

  const safety = `Sei Medi, assistente conversazionale di Meditaly. Parla in italiano naturale, adulto e professionale, con calore ma senza infantilizzare. Rispondi prima al punto principale, poi aggiungi solo i dettagli davvero utili. Usa frasi brevi, una domanda alla volta e niente formule burocratiche o tono pubblicitario. Non diagnosticare, non prescrivere e non scegliere, sostituire o modificare farmaci, dosi o terapie. Non dichiarare mai che un medico ha letto un messaggio se il sistema non lo conferma. I dati del percorso forniti dal sistema sono dati registrati, non prove che il paziente abbia assunto un farmaco. Se la richiesta implica una decisione clinica personale, spiega il limite e proponi di contattare il medico collegato. In presenza di possibili segnali urgenti invita chiaramente a chiamare il 112 o rivolgersi subito ai servizi sanitari. Non usare URL nel testo destinato alla voce.`;
  const prior = history.length
    ? `\n\nConversazione recente, utile solo per continuità:\n${history.map(item => `${item.role === "assistant" ? "Medi" : "Paziente"}: ${item.content}`).join("\n")}`
    : "";

  let input = "";
  let tools: any[] = [];
  let toolChoice: "auto" | "required" = "auto";
  if (mode === "conversation") {
    input = `${safety}${prior}\n\nDati del percorso del paziente, letti con i suoi permessi RLS:\n${patient.context}\n\nIstruzioni: usa questi dati soltanto quando pertinenti. Per terapie e controlli riporta fedelmente nomi, dosi, orari e date presenti; se un dato manca, dillo. Non dedurre indicazioni cliniche. Se il paziente vuole parlare con il medico, spiegagli che può aprire la chat protetta Meditaly. Per informazioni sanitarie generali che richiedono aggiornamento puoi consultare esclusivamente fonti autorevoli.\n\nDomanda attuale: ${question}`;
    tools = [{ type: "web_search", filters: { allowed_domains: GUIDELINE_DOMAINS }, external_web_access: true, search_context_size: "low" }];
  } else if (mode === "guidelines") {
    input = `${safety}${prior}\n\nCerca la versione più recente pubblicata. Per l'Italia privilegia ISS/SNLG, Ministero della Salute e AIFA; poi società scientifiche pertinenti, OMS e fonti europee. Distingui linee guida, consenso, position paper e materiale divulgativo. Riporta ente e anno quando disponibili. Se le fonti differiscono, descrivi la differenza senza inventare consenso.\n\nRichiesta: ${question}`;
    tools = [{ type: "web_search", filters: { allowed_domains: GUIDELINE_DOMAINS }, external_web_access: true, search_context_size: "medium" }];
    toolChoice = "required";
  } else {
    const place = approximate ? `${approximate.city || ""}${approximate.region ? ", " + approximate.region : ""}` : "località non determinata";
    input = `${safety}${prior}\n\nCerca campagne o programmi di screening realmente attivi o annunciati da fonti istituzionali, Regioni, ASL, Ministero, ISS o Osservatorio Nazionale Screening. L'utente chiede risultati entro circa ${radius} km da ${place}. Non presentare una normale prestazione privata come campagna. Indica organizzatore, screening, luogo, data o periodo, requisiti e fonte ufficiale. Se il raggio non è verificabile, dichiaralo. Argomento aggiuntivo: ${question || "nessuno"}.`;
    tools = [{
      type: "web_search", external_web_access: true, search_context_size: "medium",
      ...(approximate ? { user_location: { type: "approximate", country: "IT", city: approximate.city || undefined, region: approximate.region || undefined, timezone: "Europe/Rome" } } : {}),
    }];
    toolChoice = "required";
  }

  const payload = {
    model: Deno.env.get("MEDI_OPENAI_MODEL") || "gpt-5-mini",
    reasoning: { effort: "low" },
    tools,
    tool_choice: toolChoice,
    include: ["web_search_call.action.sources"],
    input,
    max_output_tokens: mode === "conversation" ? 900 : 1400,
  };

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    console.error("Medi provider error", response.status, data?.error?.code || "unknown");
    if (data?.error?.code === "credit_balance_exhausted" || data?.error?.code === "insufficient_quota") {
      return json({ error: "Il credito API del progetto collegato a Medi è esaurito. Contatta l'amministratore Meditaly." }, 503);
    }
    return json({ error: "Medi non riesce a rispondere in questo momento." }, 502);
  }

  const answer = outputText(data);
  return json({
    answer: answer || "Non ho trovato una risposta sufficientemente affidabile.",
    sources: collectSources(data),
    mode,
    doctor_linked: patient.doctorLinked,
    care_context_used: mode === "conversation",
    radius_km: mode === "screening" ? radius : undefined,
    approximate_location: mode === "screening" ? approximate : undefined,
  });
});
