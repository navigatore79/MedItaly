import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const ORIGIN = "https://med-italy.vercel.app";
const CORS = { "Access-Control-Allow-Origin": ORIGIN, "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const DOMAINS = ["iss.it", "snlg.iss.it", "salute.gov.it", "aifa.gov.it", "medicinali.aifa.gov.it", "ema.europa.eu", "escardio.org", "rcp.ac.uk", "who.int", "nice.org.uk"];
const reply = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { ...CORS, "Content-Type": "application/json; charset=utf-8" } });
function outputText(data: any) {
  return (data?.output || []).filter((x: any) => x.type === "message")
    .flatMap((x: any) => x.content || []).filter((x: any) => x.type === "output_text").map((x: any) => x.text || "").join("\n").trim();
}
function sources(data: any) {
  const seen = new Set<string>(); const out: { title: string; url: string; domain: string }[] = [];
  const add = (url: string, title: string) => { try { const domain = new URL(url).hostname.replace(/^www\./, ""); if (!url.startsWith("https://") || seen.has(url) || !DOMAINS.some(d => domain === d || domain.endsWith("." + d))) return; seen.add(url); out.push({ title: title || domain, url, domain }); } catch {} };
  for (const item of data?.output || []) {
    if (item.type === "web_search_call") for (const source of item.action?.sources || []) add(source.url, source.title);
    if (item.type === "message") for (const content of item.content || []) for (const annotation of content.annotations || []) if (annotation.type === "url_citation") add(annotation.url, annotation.title);
  }
  return out.slice(0, 8);
}
Deno.serve(async req => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return reply({ error: "Metodo non consentito." }, 405);
  const token = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return reply({ error: "Accedi alla dashboard medico." }, 401);
  const url = Deno.env.get("SUPABASE_URL") || "", key = Deno.env.get("SUPABASE_ANON_KEY") || "";
  const client = createClient(url, key, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false, autoRefreshToken: false } });
  const { data: auth, error: authError } = await client.auth.getUser(token);
  if (authError || !auth.user) return reply({ error: "Sessione non valida." }, 401);
  const { data: profile, error: profileError } = await client.from("profiles").select("role,account_active").eq("id", auth.user.id).single();
  if (profileError || profile?.role !== "Clinician" || !profile.account_active) return reply({ error: "Accesso riservato al medico approvato." }, 403);
  let body: any; try { body = await req.json(); } catch { return reply({ error: "Richiesta non valida." }, 400); }
  // Medi ricerca solo contenuti pubblici generali. Non leggiamo dati dei pazienti.
  const question = String(body?.question || "").trim().slice(0, 180);
  if (question.length < 4 || /\b(paziente|assistito|nato|nata|codice fiscale|cartella|anamnesi|età|anni|mg|ml|@|\d{2,})\b/i.test(question))
    return reply({ error: "Usa una domanda generale senza dati del paziente, dosi o identificativi." }, 400);
  const apiKey = Deno.env.get("OPENAI_API_KEY");
  if (!apiKey) return reply({ error: "Motore Medi non configurato." }, 503);
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const limiter = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const raw = new TextEncoder().encode(`clinician:${auth.user.id}`);
  const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", raw))).map(b => b.toString(16).padStart(2, "0")).join("");
  const limit = await limiter.rpc("consume_medi_rate", { p_key_hash: digest, p_limit: 160, p_window_seconds: 86400 });
  if (limit.error || limit.data !== true) return reply({ error: "Limite giornaliero di Medi raggiunto." }, 429);
  const drug = /farmac|medicinal|principio attivo|composizion|interazion|controindicazion/i.test(question);
  const prompt = `Sei Medi per medici, assistente informativo clinico in italiano. Rispondi con tono naturale e preciso a un medico approvato. Il tuo ambito è solo sanitario. Cerca fonti pubbliche aggiornate; cita ente, data se disponibile e sezione rilevante. Protocolli e linee guida: privilegia ISS/SNLG, Ministero e società scientifiche ufficiali; distingui versione, ambito e forza della fonte. Farmaci: usa AIFA Banca Dati/RCP e, se pertinenti, EMA; distingui nome commerciale, principio attivo, dosaggio/formulazione, indicazioni e interazioni documentate. Per interazioni fra due farmaci indica solo quelle verificabili nell'RCP e segnala quando i dati non bastano. Non inventare una composizione o dichiarare assenza di interazioni. Non prescrivere, modificare piani o suggerire decisioni terapeutiche individuali. Non includere URL nel testo letto ad alta voce; i collegamenti sono mostrati separatamente. Non conosci alcun dato del paziente.\nDomanda generale: ${question}`;
  let response: Response;
  try { response = await fetch("https://api.openai.com/v1/responses", { method: "POST", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: "gpt-5-mini", reasoning: { effort: "low" }, input: prompt, tools: [{ type: "web_search", filters: { allowed_domains: DOMAINS }, search_context_size: "medium" }], tool_choice: "required", include: ["web_search_call.action.sources"], max_output_tokens: 1200, store: false }) }); }
  catch { return reply({ error: "Medi non è disponibile ora." }, 503); }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) return reply({ error: data?.error?.code === "credit_balance_exhausted" ? "Credito API esaurito." : "Medi non è disponibile ora." }, 503);
  const citations = sources(data), answer = outputText(data);
  if (drug && !citations.some(s => /(^|\.)(aifa\.gov\.it|ema\.europa\.eu)$/.test(s.domain))) return reply({ answer: "Non ho trovato un RCP AIFA o EMA verificabile per questa domanda. Consulta la scheda del medicinale prima di valutare composizione e interazioni.", sources: [{ title: "Banca Dati dei Farmaci AIFA", url: "https://medicinali.aifa.gov.it/", domain: "medicinali.aifa.gov.it" }] });
  if (!citations.length) return reply({ answer: "Non ho trovato una fonte pubblica verificabile per rispondere. Cerca nel catalogo SNLG/ISS e verifica il documento originale.", sources: [{ title: "Sistema Nazionale Linee Guida ISS", url: "https://snlg.iss.it/", domain: "snlg.iss.it" }] });
  return reply({ answer: answer || "Non ho trovato informazioni sufficientemente verificabili.", sources: citations });
});
