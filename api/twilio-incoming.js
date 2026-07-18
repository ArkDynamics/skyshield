// api/twilio-incoming.js
// Webhook endpoint for incoming SMS replies from homeowners.
// Twilio calls this URL when a message is received on any of your numbers.
// It finds the matching lead by the "To" number (roofer's Twilio number)
// and "From" number (homeowner's phone), saves the message to Supabase,
// and triggers the AI auto-reply if enabled for that roofer.

export const config = { api: { bodyParser: false } };

async function getRawBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", chunk => { data += chunk; });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

function parseFormBody(raw) {
  const params = {};
  for (const pair of raw.split("&")) {
    const [k, v] = pair.split("=");
    if (k) params[decodeURIComponent(k)] = decodeURIComponent((v || "").replace(/\+/g, " "));
  }
  return params;
}

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;

async function sbGet(table, filter) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${filter}&select=*`, {
    headers: {
      "apikey": SUPABASE_SERVICE_KEY,
      "Authorization": `Bearer ${SUPABASE_SERVICE_KEY}`,
    },
  });
  return res.json();
}

async function sbPatch(table, filter, data) {
  await fetch(`${SUPABASE_URL}/rest/v1/${table}?${filter}`, {
    method: "PATCH",
    headers: {
      "apikey": SUPABASE_SERVICE_KEY,
      "Authorization": `Bearer ${SUPABASE_SERVICE_KEY}`,
      "Content-Type": "application/json",
      "Prefer": "return=representation",
    },
    body: JSON.stringify({ ...data, updated_at: new Date().toISOString() }),
  });
}

async function sendSMS(sid, token, from, to, body) {
  await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: "POST",
    headers: {
      "Authorization": `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ To: to, From: from, Body: body }).toString(),
  });
}

async function generateAIReply(lead, roofer, incomingMsg, commSettings) {
  if (!ANTHROPIC_KEY) return null;

  // Check if homeowner said STOP
  const stopWords = ["stop", "unsubscribe", "quit", "cancel", "end"];
  if (stopWords.includes(incomingMsg.trim().toLowerCase())) {
    return "You have been unsubscribed and will receive no further messages from us. Reply HELP for assistance.";
  }

  // Check if homeowner said HELP
  if (incomingMsg.trim().toLowerCase() === "help") {
    return `For help, contact us at ${commSettings?.helpEmail || "skyshieldpro@arkdynamics.io"}. Reply STOP to unsubscribe.`;
  }

  const conversations = lead.conversations || [];
  const history = conversations.map(c => ({
    role: c.role === "lead" ? "user" : "assistant",
    content: c.msg,
  }));

  const systemPrompt = `You are an AI assistant for ${roofer?.name || "a roofing company"}, a professional roofing contractor.
You are responding to SMS messages from homeowners about potential roof damage from recent storms.
Your goal is to be helpful, professional, and guide the homeowner toward scheduling a free inspection.

IMPORTANT RULES:
- Keep responses under 160 characters when possible
- Never make up specific times or dates — say "we'll reach out to confirm a time"
- If they say YES or want to schedule, confirm and say the roofer will call to confirm
- If they decline, be gracious and say to reach out anytime
- If they ask about cost: inspections are FREE
- If they ask about insurance: confirm you work with all major insurance companies
- Sign off with the roofer's first name if available
- Never discuss competitor pricing
- Always be warm and professional`;

  const userMsg = `Homeowner: ${lead.homeowner}
Address: ${lead.address || ""} ${lead.zip}
Storm type: ${lead.stormType}
Their message: "${incomingMsg}"

Reply to their message in a natural, helpful way.`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 200,
      system: systemPrompt,
      messages: [...history, { role: "user", content: userMsg }],
    }),
  });

  const data = await res.json();
  return data.content?.[0]?.text || null;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const rawBody = await getRawBody(req);
  const params = parseFormBody(rawBody);

  const fromNumber = params.From; // homeowner's phone
  const toNumber   = params.To;   // roofer's Twilio number
  const body       = params.Body || "";
  const msgSid     = params.MessageSid;

  console.log(`Incoming SMS: From=${fromNumber} To=${toNumber} Body="${body}"`);

  if (!fromNumber || !toNumber) {
    // Still return TwiML so Twilio doesn't retry
    res.setHeader("Content-Type", "text/xml");
    return res.status(200).send(`<?xml version="1.0" encoding="UTF-8"?><Response></Response>`);
  }

  try {
    // 1. Find the roofer by their Twilio number
    const rooferRows = await sbGet("roofers", `twilio_from=eq.${encodeURIComponent(toNumber)}`);
    const roofer = rooferRows?.[0];

    // 2. Find the lead by homeowner phone number
    // Normalize phone — try both with and without country code
    const normalizedFrom = fromNumber.replace(/^\+1/, "");
    const leadRows = await sbGet("leads",
      `phone=ilike.%25${encodeURIComponent(normalizedFrom.slice(-10))}%25`
    );

    // Filter to leads belonging to this roofer if found
    const lead = roofer
      ? leadRows?.find(l => l.roofer_id === roofer.id) || leadRows?.[0]
      : leadRows?.[0];

    if (!lead) {
      console.log("No matching lead found for", fromNumber);
      res.setHeader("Content-Type", "text/xml");
      return res.status(200).send(`<?xml version="1.0" encoding="UTF-8"?><Response></Response>`);
    }

    // 3. Append the incoming message to the lead's conversation history
    const conversations = lead.conversations || [];
    const newMsg = {
      role: "lead",
      msg: body,
      ts: new Date().toLocaleString(),
      sid: msgSid,
    };
    conversations.push(newMsg);

    // Update lead status to "contacted" if still pending
    const newStatus = lead.status === "pending" ? "contacted" : lead.status;

    // 4. Check if auto-reply is enabled for this roofer
    const commSettings = roofer?.comm_settings || {};
    const autoReplyEnabled = commSettings.autoReply === true || commSettings.autoReply === "true";

    let aiReply = null;
    if (autoReplyEnabled && roofer) {
      aiReply = await generateAIReply(lead, roofer, body, commSettings);
    }

    // 5. If we have an AI reply, send it
    if (aiReply && roofer?.twilio_from) {
      const twilioRows = await sbGet("roofers", `id=eq.${roofer.id}`);
      const r = twilioRows?.[0];
      if (r) {
        // Get Twilio credentials from app_state api_keys
        const appRows = await sbGet("app_state", "id=eq.singleton");
        const apiKeys = appRows?.[0]?.api_keys || {};
        const twilio = apiKeys.twilio;

        if (twilio?.sid && twilio?.token) {
          await sendSMS(twilio.sid, twilio.token, toNumber, fromNumber, aiReply);
          conversations.push({
            role: "ai",
            msg: aiReply,
            ts: new Date().toLocaleString(),
          });
        }
      }
    }

    // 6. Save updated conversation and status to Supabase
    await sbPatch("leads", `id=eq.${lead.id}`, {
      conversations,
      status: newStatus,
      contacted_at: newStatus === "contacted" ? new Date().toISOString() : lead.contacted_at,
    });

    console.log(`✓ Saved reply from ${fromNumber} to lead ${lead.id}`);

  } catch (err) {
    console.error("twilio-incoming error:", err);
  }

  // Always return empty TwiML so Twilio doesn't show the default message
  res.setHeader("Content-Type", "text/xml");
  return res.status(200).send(`<?xml version="1.0" encoding="UTF-8"?><Response></Response>`);
}
