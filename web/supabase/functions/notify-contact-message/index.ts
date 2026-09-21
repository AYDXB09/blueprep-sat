import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// Triggered by a Postgres trigger on contact_messages (migration
// notify_contact_message_trigger), NOT a client-facing endpoint — auth is a
// shared secret header (CONTACT_WEBHOOK_SECRET) set by the DB trigger and
// checked here, not a Supabase JWT (verify_jwt is disabled for this function
// deliberately, since the caller is Postgres, not a logged-in user).
//
// Redeploy after editing: supabase functions deploy notify-contact-message
// --project-ref qjoeqscehyjyrhtfexyg (or via the supabase-blueprep MCP's
// deploy_edge_function tool). Secrets (RESEND_API_KEY, CONTACT_WEBHOOK_SECRET,
// NOTIFY_TO) live in the project's Edge Function secrets, not in this file or
// .env — NOTIFY_TO moved out of source 2026-09-21 (was a hardcoded personal
// email, fine functionally but exposed in this public repo's source).

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
const WEBHOOK_SECRET = Deno.env.get("CONTACT_WEBHOOK_SECRET")!;
const NOTIFY_TO = Deno.env.get("NOTIFY_TO")!;

Deno.serve(async (req: Request) => {
  if (req.headers.get("x-webhook-secret") !== WEBHOOK_SECRET) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { record } = await req.json();
  const { email, subject, message, created_at } = record;

  const resendRes = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: "BluePrep <onboarding@resend.dev>",
      to: [NOTIFY_TO],
      reply_to: email,
      subject: `[BluePrep Contact] ${subject}`,
      text: `From: ${email}\nSent: ${created_at}\n\n${message}`,
    }),
  });

  if (!resendRes.ok) {
    const body = await resendRes.text();
    console.error("Resend send failed", resendRes.status, body);
    return new Response(body, { status: 502 });
  }

  return new Response("ok", { status: 200 });
});
