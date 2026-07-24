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

async function generateAIReply(lead, roofer, incomingMsg, commSettings, availableSlots=[]) {
  if (!ANTHROPIC_KEY) return null;

  // Handle opt-out keywords immediately
  const stopWords = ["stop", "unsubscribe", "quit", "cancel", "end"];
  if (stopWords.includes(incomingMsg.trim().toLowerCase())) {
    return { reply: "You have been unsubscribed and will receive no further messages. Reply HELP for assistance.", bookedSlotIndex: null };
  }
  if (incomingMsg.trim().toLowerCase() === "help") {
    return { reply: `For help contact ${commSettings?.helpEmail || "skyshieldpro@arkdynamics.io"}. Reply STOP to unsubscribe.`, bookedSlotIndex: null };
  }

  const conversations = lead.conversations || [];
  const history = conversations.map(c => ({
    role: c.role === "lead" ? "user" : "assistant",
    content: c.msg,
  }));

  const slotLines = availableSlots.slice(0,6).map((s,i)=>`Option ${i+1}: ${s.label||s.startISO}`).join("\n");
  const requireAdult = commSettings?.requireAdultPresent !== false;
  const adultStatus = lead.adult_confirmed || "unconfirmed";

  const systemPrompt = `You are an SMS scheduling assistant for ${roofer?.name || "a roofing company"} texting homeowner ${lead.homeowner} about their storm-damaged roof in ZIP ${lead.zip}.

Your goal: qualify interest, confirm adult presence if needed, offer appointment times, and BOOK directly in this conversation.

${requireAdult ? `ADULT PRESENCE: Confirm someone 18+ will be home before booking. Current status: ${adultStatus}.` : ""}

ALL AVAILABLE SLOTS (offer the ones that match what they ask for):
${slotLines || "No pre-built slots — ask for their preferred time and set wantsCustomTime:true"}

HANDLING COMMON RESPONSES:
- "afternoon", "afternoon times", "PM" → offer only the slots labeled (Afternoon) or (Midday)
- "morning" → offer only slots labeled (Morning)
- "Friday works", "Monday", any day name → offer slots for that specific day
- "Option 1", "Option 2", "#1", "1", "2", "3" → treat as selecting that numbered option, set bookedSlotIndex
- "Do you?" or short follow-ups → they are following up on your last question, continue naturally
- Pricing questions → inspections are FREE, insurance claims handled at no upfront cost
- Any question you cannot answer confidently → set needsHumanReview:true and explain a team member will follow up

IMPORTANT: When bookedSlotIndex is set, include the full booking confirmation in the reply with date, time, and inspector name.

Reply ONLY with valid JSON — no markdown, no extra text:
{"reply":"SMS text under 300 chars","adultConfirmed":"confirmed"|"denied"|"unconfirmed","bookedSlotIndex":null|0|1|2|3|4|5,"wantsCustomTime":false|true,"preferredTime":null|"string","needsHumanReview":false|true}`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 400,
      system: systemPrompt,
      messages: [...history, { role: "user", content: incomingMsg }],
    }),
  });

  const data = await res.json();
  const raw = data.content?.[0]?.text || "";
  try {
    const parsed = JSON.parse(raw.replace(/```json|```/g,"").trim());
    return {
      reply: parsed.reply || null,
      adultConfirmed: parsed.adultConfirmed || adultStatus,
      bookedSlotIndex: parsed.bookedSlotIndex ?? null,
      wantsCustomTime: !!parsed.wantsCustomTime,
      preferredTime: parsed.preferredTime || null,
      needsHumanReview: !!parsed.needsHumanReview,
    };
  } catch(e) {
    return { reply: raw.slice(0, 300) || null, adultConfirmed: adultStatus, bookedSlotIndex: null };
  }
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
    const rawComm = roofer?.comm_settings;
    const commSettings = typeof rawComm === "string" ? JSON.parse(rawComm) : (rawComm || {});
    const autoReplyEnabled = commSettings.aiAutoReply === true || commSettings.aiAutoReply === "true"
      || Object.keys(commSettings).length === 0;

    let aiResult = null;
    if (autoReplyEnabled && roofer) {
      // Build available slots from roofer's schedule for the next 3 available times
      const schedSettings = typeof roofer.schedule_settings === "string"
        ? JSON.parse(roofer.schedule_settings) : (roofer.schedule_settings || {});
      const inspectors = Array.isArray(roofer.inspectors) ? roofer.inspectors
        : typeof roofer.inspectors === "string" ? JSON.parse(roofer.inspectors) : [];
      const inspector = inspectors[0]; // first inspector

      // Build available slots across next several weekdays at multiple times
      const slots = [];
      if (inspector) {
        const startHour = parseInt((schedSettings.startTime || "08:00").split(":")[0]);
        const endHour   = parseInt((schedSettings.endTime   || "17:00").split(":")[0]);
        const dur = schedSettings.durationMins || 60;
        // Offer slots at: morning (start), midday (start+2), and afternoon (end-2)
        const timeOffsets = [0, 2, Math.max(2, endHour - startHour - 2)];
        let d = new Date();
        d.setDate(d.getDate() + 1);
        let attempts = 0;
        while (slots.length < 6 && attempts < 14) {
          attempts++;
          const dow = d.getDay();
          const dayNames = ["sun","mon","tue","wed","thu","fri","sat"];
          const dayKey = dayNames[dow];
          const daySchedule = schedSettings.days?.[dayKey];
          if (daySchedule?.open !== false && dow !== 0 && dow !== 6) {
            const dateStr = d.toISOString().split("T")[0];
            for (const offset of timeOffsets) {
              const hour = startHour + offset;
              if (hour >= endHour) continue;
              const startISO = `${dateStr}T${String(hour).padStart(2,"0")}:00:00`;
              const endISO = new Date(new Date(startISO).getTime() + dur * 60000).toISOString();
              const h12 = hour > 12 ? hour - 12 : hour;
              const ampm = hour >= 12 ? "pm" : "am";
              const timeStr = `${h12}:00${ampm}`;
              const dayLabel = d.toLocaleDateString("en-US",{weekday:"short",month:"short",day:"numeric"});
              const period = hour < 12 ? "Morning" : hour < 15 ? "Midday" : "Afternoon";
              slots.push({
                startISO, endISO,
                label: `${dayLabel} at ${timeStr} (${period})`,
                inspectorId: inspector.id,
                inspectorName: inspector.name,
              });
              if (slots.length >= 6) break;
            }
          }
          d.setDate(d.getDate() + 1);
        }
      }

      aiResult = await generateAIReply(lead, roofer, body, commSettings, slots);
    }

    // 5. Send reply and handle booking
    if (aiResult?.reply && toNumber) {
      const appRows = await sbGet("app_state", "id=eq.singleton");
      const apiKeys = appRows?.[0]?.api_keys || {};
      const twilioKeys = typeof apiKeys === "string" ? JSON.parse(apiKeys).twilio : apiKeys?.twilio;

      if (twilioKeys?.sid && twilioKeys?.token) {
        await sendSMS(twilioKeys.sid, twilioKeys.token, toNumber, fromNumber, aiResult.reply);
        conversations.push({
          role: "ai",
          msg: aiResult.reply,
          ts: new Date().toLocaleString(),
        });
      }

      // Book the inspection if homeowner selected a slot
      const slots = aiResult._slots || [];
      if (aiResult.bookedSlotIndex !== null && aiResult.bookedSlotIndex !== undefined) {
        const slot = availableSlots[aiResult.bookedSlotIndex] || availableSlots[0];
        const patchData = {
          status: "scheduled",
          conversations,
          contacted_at: lead.contacted_at || new Date().toISOString(),
          notes: ((lead.notes||"") + ` | AI booked: ${slot?.label||"slot "+(aiResult.bookedSlotIndex+1)}`).trim(),
        };
        if (aiResult.adultConfirmed) patchData.adult_confirmed = aiResult.adultConfirmed;
        await sbPatch("leads", `id=eq.${lead.id}`, patchData);
        console.log(`✓ AI booked slot ${aiResult.bookedSlotIndex} for ${lead.homeowner}`);
        res.setHeader("Content-Type","text/xml");
        return res.status(200).send(`<?xml version="1.0" encoding="UTF-8"?><Response></Response>`);
      }

      // Update adult confirmed if changed
      if (aiResult.adultConfirmed && aiResult.adultConfirmed !== (lead.adult_confirmed || "unconfirmed")) {
        conversations.push({type:"system",adultConfirmed:aiResult.adultConfirmed});
      }
    }

    // 6. Save updated conversation and status to Supabase
    const newNotes = aiResult?.needsHumanReview
      ? ((lead.notes || "") + " ⚠ Flagged for human review.").trim()
      : lead.notes;

    await sbPatch("leads", `id=eq.${lead.id}`, {
      conversations,
      status: newStatus,
      contacted_at: newStatus === "contacted" ? new Date().toISOString() : lead.contacted_at,
      adult_confirmed: aiResult?.adultConfirmed || lead.adult_confirmed,
      notes: newNotes,
    });

    // 7. If human review needed, SMS the roofer directly
    if (aiResult?.needsHumanReview && roofer?.phone) {
      const appRows = await sbGet("app_state", "id=eq.singleton");
      const apiKeys = appRows?.[0]?.api_keys || {};
      const twilioKeys = typeof apiKeys === "string" ? JSON.parse(apiKeys).twilio : apiKeys?.twilio;
      if (twilioKeys?.sid && twilioKeys?.token) {
        const urgentMsg = `SkyShield URGENT: ${lead.homeowner} (${lead.phone}) needs your personal reply — AI couldn't handle their question. Open SkyShield to respond now.`;
        await sendSMS(twilioKeys.sid, twilioKeys.token, twilioKeys.from, roofer.phone, urgentMsg);
        console.log(`✓ Sent priority alert to roofer ${roofer.phone}`);
      }
    }

    console.log(`✓ Processed reply from ${fromNumber} for lead ${lead.id}`);

  } catch (err) {
    console.error("twilio-incoming error:", err);
  }

  // Always return empty TwiML so Twilio doesn't show the default message
  res.setHeader("Content-Type", "text/xml");
  return res.status(200).send(`<?xml version="1.0" encoding="UTF-8"?><Response></Response>`);
}
