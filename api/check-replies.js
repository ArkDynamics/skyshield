// api/check-replies.js
// Runs daily at 8am CST via Vercel Cron.
// ONLY handles messages that came in outside business hours (overnight/weekends)
// that the live webhook didn't process. The webhook handles everything in real-time.

export const config = { api: { bodyParser: true } };

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;

async function sbGet(table, qs) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${qs}&select=*`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
  });
  if (!r.ok) { console.error("sbGet failed", table); return []; }
  return r.json();
}

async function sbPatch(table, qs, data) {
  await fetch(`${SUPABASE_URL}/rest/v1/${table}?${qs}`, {
    method: "PATCH",
    headers: {
      apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json", Prefer: "return=minimal",
    },
    body: JSON.stringify({ ...data, updated_at: new Date().toISOString() }),
  });
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

async function getAIReply(lead, roofer, incomingMsg) {
  if (!ANTHROPIC_KEY) return null;

  const lower = incomingMsg.trim().toLowerCase();
  if (["stop","unsubscribe","quit","cancel","end"].includes(lower))
    return { reply:"You've been unsubscribed. Reply HELP for help.", needsHumanReview:false };
  if (lower === "help")
    return { reply:"For help contact skyshieldpro@arkdynamics.io. Reply STOP to opt out.", needsHumanReview:false };

  const conversations = Array.isArray(lead.conversations) ? lead.conversations
    : (typeof lead.conversations === "string" ? JSON.parse(lead.conversations||"[]") : []);

  const history = conversations
    .filter(c => c.role && c.msg)
    .map(c => ({ role: c.role==="lead"?"user":"assistant", content: c.msg }));

  const system = `You are an SMS assistant for ${roofer?.name||"a roofing company"} replying to homeowner ${lead.homeowner||"a homeowner"} about their roof inspection.
Keep replies under 200 characters. Be warm and helpful.
If you can't answer confidently, set needsHumanReview:true.
Reply ONLY as JSON: {"reply":"text","needsHumanReview":false}`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method:"POST",
    headers:{"Content-Type":"application/json","x-api-key":ANTHROPIC_KEY,"anthropic-version":"2023-06-01"},
    body: JSON.stringify({ model:"claude-sonnet-4-6", max_tokens:300, system,
      messages:[...history,{role:"user",content:incomingMsg}] }),
  });

  const raw = (await res.json()).content?.[0]?.text || "";
  try {
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) throw new Error("No JSON");
    return JSON.parse(m[0]);
  } catch {
    const m2 = raw.match(/"reply"\s*:\s*"((?:[^"\\]|\\.)*)"/);
    return { reply: m2?m2[1]:null, needsHumanReview:true };
  }
}

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST")
    return res.status(405).json({ error:"Method not allowed" });

  if (!SUPABASE_URL || !SUPABASE_KEY)
    return res.status(500).json({ error:"Missing env vars" });

  try {
    const appRows = await sbGet("app_state", "id=eq.singleton");
    const apiKeys = appRows?.[0]?.api_keys || {};
    const tw = (typeof apiKeys==="string" ? JSON.parse(apiKeys) : apiKeys)?.twilio;

    if (!tw?.sid || !tw?.token)
      return res.status(200).json({ message:"No Twilio credentials" });

    const rooferRows = await sbGet("roofers", "status=in.(active,trial,test)");
    const roofers = Array.isArray(rooferRows) ? rooferRows : [];

    let processed=0, replied=0, flagged=0;

    for (const roofer of roofers) {
      const twilioFrom = roofer.twilio_from;
      if (!twilioFrom) continue;

      // Get leads for this roofer that have had recent lead-side activity
      const leadRows = await sbGet("leads", `roofer_id=eq.${roofer.id}&status=in.(pending,contacted,scheduled)`);
      const leads = Array.isArray(leadRows) ? leadRows : [];

      const rawComm = roofer.comm_settings;
      const commSettings = rawComm ? (typeof rawComm==="string"?JSON.parse(rawComm):rawComm) : {};
      const autoReply = commSettings.aiAutoReply !== false;

      for (const lead of leads) {
        const convos = Array.isArray(lead.conversations) ? lead.conversations
          : (typeof lead.conversations==="string" ? JSON.parse(lead.conversations||"[]") : []);

        if (!convos.length) continue;

        // Find the last message from the lead
        const lastLeadMsg = [...convos].reverse().find(c => c.role==="lead");
        if (!lastLeadMsg) continue;

        // Check if the last message in the conversation is already an AI/human reply
        // If so, the webhook already handled it — skip
        const lastMsg = convos[convos.length - 1];
        if (lastMsg.role === "ai" || lastMsg.role === "human") continue;

        // The last message is from the lead with no reply yet
        // Check if this SID was already processed
        if (lastLeadMsg.sid) {
          const alreadyProcessed = convos.some(
            c => (c.role==="ai" || c.role==="human") &&
            convos.indexOf(c) > convos.indexOf(lastLeadMsg)
          );
          if (alreadyProcessed) continue;
        }

        // Only process if the unanswered message is recent (last 48 hours)
        // to avoid replying to very old messages
        const msgTime = new Date(lastLeadMsg.ts);
        const hoursAgo = (Date.now() - msgTime.getTime()) / 3600000;
        if (isNaN(hoursAgo) || hoursAgo > 48) continue;

        processed++;
        console.log(`Unanswered msg from ${lead.homeowner}: "${lastLeadMsg.msg?.slice(0,50)}" (${Math.round(hoursAgo)}h ago)`);

        if (!autoReply || !lead.phone) continue;

        const result = await getAIReply(lead, roofer, lastLeadMsg.msg);

        if (result?.reply) {
          const sent = await sendSMS(tw.sid, tw.token, twilioFrom, lead.phone, result.reply);
          if (sent) {
            const newConvos = [...convos, {
              role:"ai", msg:result.reply,
              ts:new Date().toLocaleString(),
              source:"cron",
            }];
            await sbPatch("leads", `id=eq.${lead.id}`, { conversations:newConvos });
            replied++;
          }
        }

        if (result?.needsHumanReview) {
          flagged++;
          const noteFlag = " ⚠ Flagged for human review.";
          if (!lead.notes?.includes("Flagged for human review")) {
            await sbPatch("leads", `id=eq.${lead.id}`, {
              notes: (lead.notes||"") + noteFlag
            });
          }
          if (roofer.phone) {
            await sendSMS(tw.sid, tw.token, twilioFrom, roofer.phone,
              `SkyShield: ${lead.homeowner} replied overnight and needs your response. Open SkyShield.`);
          }
        }
      }
    }

    console.log(`check-replies: ${processed} unanswered found, ${replied} replied, ${flagged} flagged`);
    return res.status(200).json({ success:true, processed, replied, flagged, ts:new Date().toISOString() });

  } catch (err) {
    console.error("check-replies error:", err);
    return res.status(500).json({ error:err.message });
  }
}
