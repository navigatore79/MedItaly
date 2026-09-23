
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function b64url(input) {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function pemToBytes(pem) {
  const base64 = pem.replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "")
    .replace(/\s+/g, "");
  const binary = atob(base64);
  return Uint8Array.from(binary, c => c.charCodeAt(0));
}

async function firebaseAccessToken(sa) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = b64url(JSON.stringify({
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  }));
  const unsigned = header + "." + payload;
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToBytes(sa.private_key),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(unsigned),
  );
  const assertion = unsigned + "." + b64url(new Uint8Array(signature));
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  const json = await response.json();
  if (!response.ok || !json.access_token) {
    throw new Error("FIREBASE_OAUTH_FAILED: " + JSON.stringify(json));
  }
  return json.access_token;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "METHOD_NOT_ALLOWED" }), {
      status: 405, headers: { ...cors, "content-type": "application/json" },
    });
  }

  try {
    const authHeader = req.headers.get("authorization") || "";
    const jwt = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    if (!jwt) throw new Error("AUTH_REQUIRED");

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: userData, error: userError } = await admin.auth.getUser(jwt);
    if (userError || !userData.user) throw new Error("INVALID_SESSION");
    const caller = userData.user.id;

    const body = await req.json();
    const outboxId = body && body.outbox_id;
    if (!outboxId) throw new Error("OUTBOX_REQUIRED");

    const { data: outbox, error: outboxError } = await admin
      .from("push_outbox")
      .select("id,user_id,notification_id,status,title,body")
      .eq("id", outboxId)
      .single();
    if (outboxError || !outbox) throw new Error("OUTBOX_NOT_FOUND");

    const { data: notification, error: notificationError } = await admin
      .from("notifications")
      .select("id,patient_id,sender_id")
      .eq("id", outbox.notification_id)
      .single();
    if (notificationError || !notification) throw new Error("NOTIFICATION_NOT_FOUND");
    if (notification.sender_id !== caller) throw new Error("NOT_ALLOWED");
    if (outbox.user_id !== notification.patient_id) throw new Error("PATIENT_MISMATCH");

    const { data: callerProfile } = await admin
      .from("profiles").select("role,account_active").eq("id", caller).single();
    if (!callerProfile || callerProfile.account_active !== true) throw new Error("ACCOUNT_INACTIVE");

    let allowedClinician = callerProfile.role === "Clinician";
    if (callerProfile.role === "Administrator") {
      const { data: testClinician } = await admin
        .from("clinician_directory")
        .select("clinician_id,specialty,directory_visible")
        .eq("clinician_id", caller)
        .eq("directory_visible", false)
        .maybeSingle();
      allowedClinician = !!testClinician &&
        String(testClinician.specialty || "").toUpperCase().includes("TEST");
    }
    if (!allowedClinician) throw new Error("CLINICIAN_REQUIRED");

    const { data: assignment } = await admin
      .from("patient_clinicians")
      .select("patient_id")
      .eq("patient_id", notification.patient_id)
      .eq("clinician_id", caller)
      .eq("active", true)
      .maybeSingle();
    let testChoice = null;
    if (callerProfile.role === "Administrator") {
      const { data: choice } = await admin
        .from("patient_care_contacts")
        .select("patient_id,initial_choice,choice_completed_at")
        .eq("patient_id", notification.patient_id)
        .eq("test_support_admin_id", caller)
        .eq("initial_choice", "test")
        .not("choice_completed_at", "is", null)
        .maybeSingle();
      testChoice = choice;
    }
    if (callerProfile.role === "Administrator" ? !testChoice : !assignment)
      throw new Error("NOT_ASSIGNED_OR_TEST_CHOICE_REQUIRED");

    const rawServiceAccount = Deno.env.get("FIREBASE_SERVICE_ACCOUNT_JSON");
    if (!rawServiceAccount) {
      return new Response(JSON.stringify({
        ok: false,
        configured: false,
        error: "FIREBASE_SERVICE_ACCOUNT_JSON_MISSING",
      }), { status: 503, headers: { ...cors, "content-type": "application/json" } });
    }

    const sa = JSON.parse(rawServiceAccount);
    const accessToken = await firebaseAccessToken(sa);

    const { data: tokens, error: tokenError } = await admin
      .from("device_push_tokens")
      .select("id,token")
      .eq("user_id", outbox.user_id)
      .eq("platform", "android")
      .eq("active", true);
    if (tokenError) throw tokenError;

    if (!tokens || !tokens.length) {
      await admin.from("push_outbox").update({
        status: "failed",
        last_error: "NO_ACTIVE_DEVICE_TOKENS",
      }).eq("id", outboxId);
      return new Response(JSON.stringify({ ok: true, sent: 0, reason: "NO_ACTIVE_DEVICE_TOKENS" }), {
        headers: { ...cors, "content-type": "application/json" },
      });
    }

    let sent = 0;
    const errors = [];
    for (const t of tokens) {
      const fcmResponse = await fetch(
        "https://fcm.googleapis.com/v1/projects/" + sa.project_id + "/messages:send",
        {
          method: "POST",
          headers: {
            authorization: "Bearer " + accessToken,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            message: {
              token: t.token,
              notification: {
                title: "Meditaly",
                body: "Hai un messaggio su Meditaly",
              },
              data: {
                type: "chat",
                route: "messages",
              },
              android: {
                priority: "high",
                notification: {
                  channel_id: "meditaly_messages",
                  visibility: "PUBLIC",
                  default_sound: true,
                },
              },
            },
          }),
        },
      );
      const responseText = await fcmResponse.text();
      if (fcmResponse.ok) {
        sent++;
      } else {
        errors.push(responseText.slice(0, 800));
        if (responseText.includes("UNREGISTERED") || fcmResponse.status === 404) {
          await admin.from("device_push_tokens").update({ active: false }).eq("id", t.id);
        }
      }
    }

    await admin.from("push_outbox").update({
      status: sent > 0 ? "sent" : "failed",
      sent_at: sent > 0 ? new Date().toISOString() : null,
      last_error: errors.length ? errors.join(" | ").slice(0, 2000) : null,
    }).eq("id", outboxId);

    return new Response(JSON.stringify({ ok: sent > 0, sent, failed: tokens.length - sent }), {
      status: sent > 0 ? 200 : 502,
      headers: { ...cors, "content-type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
      status: 400,
      headers: { ...cors, "content-type": "application/json" },
    });
  }
});
