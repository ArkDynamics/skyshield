// api/check-replies.js
// Runs automatically via Vercel Cron every morning at 8am CST (14:00 UTC).
// Fetches any unanswered inbound SMS from Twilio, processes each one
// through the AI, saves conversations to Supabase, and fires priority
// notifications for anything the AI can't handle.
//
// vercel.json cron: {"path": "/api/check-replies", "schedule": "0 14 * * *"}

export const config = { api: { bodyParser: true } };

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;

async function sbGet(table, qs) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${qs}&select=*`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
  });
  if (!r.ok) { console.error("sbGet failed", table, await r.text()); return []; }
  return r.json();
}

async function sbPatch(table, qs, data) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${qs}`, {
    method: "PATCH",
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify({ ...data, updated_at: new Date().toISOString() }),
  });
  if (!r.ok) console.error("sbPatch failed", table, await r.text());
}

async function sendSMS(sid, token, from, to, body) {
  const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ To: to, From: from, Body: body }).toString(),
  });
  const d = await r.json();
  if (d.error_code) console.error("SMS error:", d.error_code, d.message);
  return !d.error_code;
}

async function getAIReply(lead, roofer, incomingMsg, commSettings) {
  if (!ANTHROPIC_KEY) return null;

  const lower = incomingMsg.trim().toLowerCase();
  if (["stop","unsubscribe","quit","cancel","end"].includes(lower))
    return { reply: "You've been unsubscribed. Reply HELP for help.", needsHumanReview: false };
  if (lower === "help")
    return { reply: "For help email skyshieldpro@arkdynamics.io. Reply STOP to unsubscribe.", needsHumanReview: false };

  const conversations = Array.isArray(lead.conversations) ? lead.conversations
    : (typeof lead.conversations === "string" ? JSON.parse(lead.conversations || "[]") : []);

  const history = conversations
    .filter(c => c.role && c.msg)
    .map(c => ({ role: c.role === "lead" ? "user" : "assistant", content: c.msg }));

  const system = `You are an SMS assistant for ${roofer?.name || "a roofing company"} replying to homeowner ${lead.homeowner || "a homeowner"}.
Keep replies under 200 characters. Be warm and helpful.
If you genuinely cannot answer (complex insurance questions, pricing disputes, complaints), set needsHumanReview:true.
Reply ONLY as JSON: {"reply":"text","needsHumanReview":false}`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type":"application/json", "x-api-key":ANTHROPIC_KEY, "anthropic-version":"2023-06-01" },
    body: JSON.stringify({ model:"claude-sonnet-4-6", max_tokens:300, system,
      messages: [...history, { role:"user", content:incomingMsg }] }),
  });

  const raw = (await res.json()).content?.[0]?.text || "";
  try {
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) throw new Error("No JSON");
    return JSON.parse(m[0]);
  } catch {
    const m2 = raw.match(/"reply"\s*:\s*"((?:[^"\\]|\\.)*)"/);
    return { reply: m2 ? m2[1] : null, needsHumanReview: true };
  }
}

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST")
    return res.status(405).json({ error: "Method not allowed" });

  if (!SUPABASE_URL || !SUPABASE_KEY)
    return res.status(500).json({ error: "Missing env vars" });

  try {
    // Get app config — Twilio credentials live in app_state
    const appRows = await sbGet("app_state", "id=eq.singleton");
    const apiKeys = appRows?.[0]?.api_keys || {};
    const twilio = typeof apiKeys === "string" ? JSON.parse(apiKeys) : apiKeys;
    const tw = twilio?.twilio;

    if (!tw?.sid || !tw?.token)
      return res.status(200).json({ message: "No Twilio credentials configured" });

    // Get all active roofers
    const rooferRows = await sbGet("roofers", "status=in.(active,trial,test)");
    const roofers = Array.isArray(rooferRows) ? rooferRows : [];

    let processed = 0, replied = 0, flagged = 0;

    for (const roofer of roofers) {
      // Fetch last 50 inbound messages for this roofer's Twilio number
      const twilioFrom = roofer.twilio_from;
      if (!twilioFrom) continue;

      const msgRes = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${tw.sid}/Messages.json?To=${encodeURIComponent(twilioFrom)}&PageSize=50`,
        { headers: { Authorization: `Basic ${Buffer.from(`${tw.sid}:${tw.token}`).toString("base64")}` } }
      );
      const msgData = await msgRes.json();
      const inboundMsgs = (msgData.messages || []).filter(m => m.direction === "inbound");

      if (!inboundMsgs.length) continue;

      // Get leads for this roofer
      const leadRows = await sbGet("leads", `roofer_id=eq.${roofer.id}`);
      const leads = Array.isArray(leadRows) ? leadRows : [];

      const rawComm = roofer.comm_settings;
      const commSettings = rawComm
        ? (typeof rawComm === "string" ? JSON.parse(rawComm) : rawComm)
        : {};
      const autoReply = commSettings.aiAutoReply !== false;

      for (const msg of inboundMsgs) {
        const fromNumber = msg.from;
        const body = msg.body?.trim();
        const msgDate = new Date(msg.date_sent);
        if (!body) continue;

        // Find matching lead
        const digits = fromNumber.replace(/\D/g, "").slice(-10);
        const lead = leads.find(l => l.phone?.replace(/\D/g,"").slice(-10) === digits);
        if (!lead) continue;

        // Check if we already have this message in conversations
        const convos = Array.isArray(lead.conversations) ? lead.conversations
          : (typeof lead.conversations === "string" ? JSON.parse(lead.conversations || "[]") : []);

        const alreadyLogged = convos.some(c =>
          c.role === "lead" && c.msg === body &&
          Math.abs(new Date(c.ts) - msgDate) < 60000
        );
        if (alreadyLogged) continue;

        processed++;

        // Log the incoming message
        const newConvos = [...convos, { role:"lead", msg:body, ts:msgDate.toLocaleString() }];
        let patchData = {
          conversations: newConvos,
          status: lead.status === "pending" ? "contacted" : lead.status,
          contacted_at: lead.contacted_at || new Date().toISOString(),
        };

        // Generate AI reply if enabled
        if (autoReply) {
          const result = await getAIReply(lead, roofer, body, commSettings);

          if (result?.reply) {
            const sent = await sendSMS(tw.sid, tw.token, twilioFrom, fromNumber, result.reply);
            if (sent) {
              newConvos.push({ role:"ai", msg:result.reply, ts:new Date().toLocaleString() });
              replied++;
            }
          }

          if (result?.needsHumanReview) {
            flagged++;
            const noteFlag = " ⚠ Flagged for human review.";
            if (!lead.notes?.includes(noteFlag)) {
              patchData.notes = (lead.notes || "") + noteFlag;
            }
            // SMS the roofer
            if (roofer.phone) {
              await sendSMS(tw.sid, tw.token, twilioFrom, roofer.phone,
                `SkyShield URGENT: ${lead.homeowner} (${lead.phone}) needs your personal reply. Open SkyShield now.`);
            }
          }
        }

        patchData.conversations = newConvos;
        await sbPatch("leads", `id=eq.${lead.id}`, patchData);
      }
    }

    console.log(`check-replies: ${processed} new msgs, ${replied} replied, ${flagged} flagged`);
    return res.status(200).json({ success:true, processed, replied, flagged, timestamp: new Date().toISOString() });

  } catch (err) {
    console.error("check-replies error:", err);
    return res.status(500).json({ error: err.message });
  }
}
