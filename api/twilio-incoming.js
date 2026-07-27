// api/twilio-incoming.js
// Receives incoming SMS from homeowners, finds the matching lead,
// generates an AI reply with available calendar slots, and sends it back.

export const config = { api: { bodyParser: false } };

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const TWIML_EMPTY = `<?xml version="1.0" encoding="UTF-8"?><Response></Response>`;

// ── Helpers ───────────────────────────────────────────────────────────────────
async function getRawBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", c => { data += c; });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

function parseForm(raw) {
  const out = {};
  for (const pair of raw.split("&")) {
    const eq = pair.indexOf("=");
    if (eq < 0) continue;
    const k = decodeURIComponent(pair.slice(0, eq));
    const v = decodeURIComponent(pair.slice(eq + 1).replace(/\+/g, " "));
    out[k] = v;
  }
  return out;
}

function twiml(res) {
  res.setHeader("Content-Type", "text/xml");
  return res.status(200).send(TWIML_EMPTY);
}

async function sbGet(table, qs) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${qs}&select=*`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
  });
  if (!r.ok) { console.error("sbGet failed", table, qs, await r.text()); return []; }
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
  if (!sid || !token || !from || !to) {
    console.warn("sendSMS: missing credentials or numbers", { sid:!!sid, token:!!token, from, to });
    return;
  }
  const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ To: to, From: from, Body: body }).toString(),
  });
  const d = await r.json();
  if (d.error_code) console.error("Twilio send error:", d.error_code, d.message);
  else console.log(`✓ SMS sent to ${to}: ${body.slice(0,50)}...`);
}

// ── Slot builder ──────────────────────────────────────────────────────────────
function buildSlots(roofer, existingInspections = []) {
  const raw = roofer.schedule_settings;
  const sched = raw ? (typeof raw === "string" ? JSON.parse(raw) : raw) : {};
  const rawIns = roofer.inspectors;
  const inspectors = rawIns
    ? (Array.isArray(rawIns) ? rawIns : JSON.parse(rawIns))
    : [];
  const inspector = inspectors[0];
  if (!inspector) return [];

  const startHour = parseInt((sched.startTime || "08:00").split(":")[0], 10);
  const endHour   = parseInt((sched.endTime   || "17:00").split(":")[0], 10);
  const dur       = sched.durationMins || 60;

  // Build set of already-booked start times for fast lookup
  const bookedTimes = new Set(
    existingInspections
      .filter(i => i.status === "scheduled" || i.status === "rescheduled")
      .map(i => i.start_iso || i.startISO || "")
      .filter(Boolean)
      .map(iso => iso.slice(0, 16)) // "2026-07-27T08:00"
  );

  // Offer morning, midday, afternoon per day
  const offsets = [0, Math.floor((endHour - startHour) / 2), endHour - startHour - 1]
    .filter(o => o >= 0 && (startHour + o) < endHour);

  const slots = [];
  const d = new Date();
  d.setDate(d.getDate() + 1);
  let attempts = 0;

  while (slots.length < 6 && attempts < 21) {
    attempts++;
    const dow = d.getDay();
    const dayNames = ["sun","mon","tue","wed","thu","fri","sat"];
    const dayKey = dayNames[dow];
    const daySchedule = sched.days?.[dayKey];

    // Skip weekends and days explicitly marked closed
    if (dow === 0 || dow === 6 || daySchedule?.open === false) {
      d.setDate(d.getDate() + 1);
      continue;
    }

    const dateStr = d.toISOString().split("T")[0];

    for (const offset of offsets) {
      const hour = startHour + offset;
      if (hour >= endHour) continue;

      const startISO = `${dateStr}T${String(hour).padStart(2,"0")}:00:00`;
      const slotKey  = startISO.slice(0, 16);

      // Skip if already booked
      if (bookedTimes.has(slotKey)) {
        console.log(`Slot ${slotKey} already booked — skipping`);
        continue;
      }

      const endISO  = new Date(new Date(startISO).getTime() + dur * 60000).toISOString();
      const h12     = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
      const ampm    = hour >= 12 ? "pm" : "am";
      const period  = hour < 12 ? "Morning" : hour < 15 ? "Midday" : "Afternoon";
      const dayStr  = d.toLocaleDateString("en-US", { weekday:"short", month:"short", day:"numeric" });

      slots.push({
        startISO, endISO,
        label: `${dayStr} at ${h12}:00${ampm} (${period})`,
        inspectorId: inspector.id,
        inspectorName: inspector.name || "Inspector",
      });

      if (slots.length >= 6) break;
    }

    d.setDate(d.getDate() + 1);
  }

  return slots;
}

// ── AI reply ──────────────────────────────────────────────────────────────────
async function generateAIReply(lead, roofer, incomingMsg, commSettings, slots) {
  if (!ANTHROPIC_KEY) {
    console.warn("ANTHROPIC_API_KEY not set");
    return null;
  }

  // Immediate opt-out handling — no AI needed
  const lower = incomingMsg.trim().toLowerCase();
  if (["stop","unsubscribe","quit","cancel","end"].includes(lower)) {
    return { reply: "You've been unsubscribed and will receive no further messages. Reply HELP for help.", bookedSlotIndex: null };
  }
  if (lower === "help") {
    return { reply: "For help email skyshieldpro@arkdynamics.io. Reply STOP to unsubscribe.", bookedSlotIndex: null };
  }

  const conversations = Array.isArray(lead.conversations) ? lead.conversations
    : (typeof lead.conversations === "string" ? JSON.parse(lead.conversations) : []);

  const history = conversations
    .filter(c => c.role && c.msg)
    .map(c => ({ role: c.role === "lead" ? "user" : "assistant", content: c.msg }));

  const requireAdult = commSettings?.requireAdultPresent !== false;
  const adultStatus  = lead.adult_confirmed || "unconfirmed";
  const slotLines    = slots.map((s, i) => `Option ${i + 1}: ${s.label}`).join("\n");

  const system = `You are an SMS scheduling assistant for ${roofer?.name || "a roofing company"} texting homeowner ${lead.homeowner || "the homeowner"} about their storm-damaged roof.

GOAL: book a free roof inspection directly in this conversation.

${requireAdult ? `ADULT PRESENCE: Before booking, confirm someone 18+ will be home. Status: ${adultStatus}.` : ""}

AVAILABLE TIMES (these are the ONLY open slots — don't imply others exist):
${slotLines || "No slots available right now — ask for their preferred time and set wantsCustomTime:true"}

HOW TO HANDLE RESPONSES:
- Interest shown → offer all the slots above
- "afternoon" / "PM" → show only Afternoon/Midday slots from the list above
- "morning" / "AM" → show only Morning slots from the list above
- Day name like "Friday" or a date like "the 31st" → check if any slots above are on that day. If yes offer them. If no, be honest that day isn't available and re-offer the slots that ARE available
- "Option 1", "1", "2", "3", bare number → set bookedSlotIndex to that number minus 1 (0-indexed)
- "yes", "sure", "ok" → confirm interest and offer all slots if not yet offered
- "first week of August" or future dates → if no slots are available that far out, be honest and say scheduling opens up as we get closer, and offer what IS available now
- Pricing → inspections are FREE, we work with insurance
- Can't answer → set needsHumanReview:true

WHEN BOOKING: reply must include the full date, time, and inspector name as confirmation.
Keep all messages under 300 characters. Be warm and conversational.

Reply ONLY with this exact JSON (no markdown, no extra text):
{"reply":"message text","adultConfirmed":"unconfirmed","bookedSlotIndex":null,"wantsCustomTime":false,"preferredTime":null,"needsHumanReview":false}`;

  const apiRes = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 400,
      system,
      messages: [...history, { role: "user", content: incomingMsg }],
    }),
  });

  if (!apiRes.ok) {
    console.error("Anthropic API error:", apiRes.status, await apiRes.text());
    return null;
  }

  const apiData = await apiRes.json();
  const raw = apiData.content?.[0]?.text || "";
  console.log("Claude raw response:", raw.slice(0, 200));

  try {
    const parsed = JSON.parse(raw.replace(/```json|```/g, "").trim());
    return {
      reply:           parsed.reply || null,
      adultConfirmed:  ["confirmed","denied","unconfirmed"].includes(parsed.adultConfirmed) ? parsed.adultConfirmed : adultStatus,
      bookedSlotIndex: (typeof parsed.bookedSlotIndex === "number") ? parsed.bookedSlotIndex : null,
      wantsCustomTime: !!parsed.wantsCustomTime,
      preferredTime:   parsed.preferredTime || null,
      needsHumanReview: !!parsed.needsHumanReview,
    };
  } catch (e) {
    console.error("JSON parse failed:", e.message, "raw:", raw.slice(0, 300));
    // Return raw as reply so at least something goes out
    return { reply: raw.slice(0, 300) || null, adultConfirmed: adultStatus, bookedSlotIndex: null, needsHumanReview: false };
  }
}

// ── Main handler ──────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const params = parseForm(await getRawBody(req));
  const fromNumber = params.From;  // homeowner's phone
  const toNumber   = params.To;    // roofer's Twilio number
  const body       = (params.Body || "").trim();

  console.log(`Incoming SMS | From: ${fromNumber} | To: ${toNumber} | Body: "${body}"`);

  if (!fromNumber || !toNumber || !body) return twiml(res);
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_KEY env vars");
    return twiml(res);
  }

  try {
    // 1. Get Twilio credentials from app_state (needed to reply)
    const appRows = await sbGet("app_state", "id=eq.singleton");
    const apiKeys = appRows?.[0]?.api_keys || {};
    const twilio = typeof apiKeys === "string" ? JSON.parse(apiKeys) : apiKeys;
    const twilioKeys = twilio?.twilio;
    console.log("Twilio keys found:", !!twilioKeys?.sid);

    // 2. Find roofer by their Twilio number
    const cleanTo = toNumber.replace(/\s/g, "");
    const rooferRows = await sbGet("roofers", `twilio_from=eq.${encodeURIComponent(cleanTo)}`);
    const roofer = rooferRows?.[0] || null;
    console.log("Roofer found:", roofer?.name || "none", "| Looking for number:", cleanTo);

    // 3. Find lead by homeowner phone number
    const digits = fromNumber.replace(/\D/g, "").slice(-10);
    const leadRows = await sbGet("leads", `phone=ilike.%25${digits}%25`);
    const lead = roofer
      ? (leadRows?.find(l => l.roofer_id === roofer.id) || leadRows?.[0])
      : leadRows?.[0];
    console.log("Lead found:", lead?.homeowner || "none", "| Searched digits:", digits);

    if (!lead) {
      console.log("No lead matched — returning empty TwiML");
      return twiml(res);
    }

    // 4. Parse existing conversations
    const existingConvos = Array.isArray(lead.conversations) ? lead.conversations
      : (typeof lead.conversations === "string" ? JSON.parse(lead.conversations || "[]") : []);

    // Add homeowner message
    existingConvos.push({ role: "lead", msg: body, ts: new Date().toLocaleString() });

    const newStatus = lead.status === "pending" ? "contacted" : lead.status;

    // 5. Generate AI reply if auto-reply is on
    const rawComm = roofer?.comm_settings;
    const commSettings = rawComm
      ? (typeof rawComm === "string" ? JSON.parse(rawComm) : rawComm)
      : {};
    const autoReply = commSettings.aiAutoReply !== false; // default ON
    console.log("Auto-reply enabled:", autoReply, "| Roofer:", roofer?.name);

    let aiResult = null;
    // Fetch roofer's existing inspections to exclude booked slots
    const existingInspections = roofer
      ? ((typeof roofer.inspections === "string"
          ? JSON.parse(roofer.inspections || "[]")
          : roofer.inspections) || [])
      : [];
    const slots = roofer ? buildSlots(roofer, existingInspections) : [];
    console.log("Slots built:", slots.length, "| Booked inspections:", existingInspections.filter(i=>i.status==="scheduled").length);

    if (autoReply) {
      aiResult = await generateAIReply(lead, roofer, body, commSettings, slots);
      console.log("AI result:", JSON.stringify(aiResult)?.slice(0, 200));
    }

    // 6. Send the reply
    if (aiResult?.reply && twilioKeys?.sid && twilioKeys?.token) {
      const fromNum = toNumber; // reply from the roofer's number
      await sendSMS(twilioKeys.sid, twilioKeys.token, fromNum, fromNumber, aiResult.reply);
      existingConvos.push({ role: "ai", msg: aiResult.reply, ts: new Date().toLocaleString() });
    } else if (!aiResult?.reply) {
      console.warn("No reply generated — aiResult:", aiResult);
    } else {
      console.warn("Missing Twilio keys — cannot send reply");
    }

    // 7. Handle booking
    let patchStatus = newStatus;
    let patchNotes  = lead.notes || "";

    if (aiResult?.bookedSlotIndex !== null && aiResult?.bookedSlotIndex !== undefined && slots.length > 0) {
      const slot = slots[aiResult.bookedSlotIndex] ?? slots[0];
      patchStatus = "scheduled";
      patchNotes  = (patchNotes + ` | AI booked: ${slot.label}`).trim();
      console.log(`✓ Booking slot ${aiResult.bookedSlotIndex}: ${slot.label}`);
    }

    if (aiResult?.wantsCustomTime && aiResult?.preferredTime) {
      patchNotes = (patchNotes + ` | Prefers: ${aiResult.preferredTime}`).trim();
    }

    if (aiResult?.needsHumanReview) {
      patchNotes = (patchNotes + " ⚠ Flagged for human review.").trim();
      // Text the roofer urgently
      if (roofer?.phone && twilioKeys?.sid) {
        const urgentMsg = `SkyShield URGENT: ${lead.homeowner} (${lead.phone}) needs your personal reply. Open SkyShield to respond.`;
        await sendSMS(twilioKeys.sid, twilioKeys.token, toNumber, roofer.phone, urgentMsg);
      }
    }

    // 8. Save everything to Supabase
    await sbPatch("leads", `id=eq.${lead.id}`, {
      conversations: existingConvos,
      status: patchStatus,
      notes: patchNotes,
      contacted_at: lead.contacted_at || new Date().toISOString(),
      adult_confirmed: aiResult?.adultConfirmed || lead.adult_confirmed || "unconfirmed",
    });

    console.log(`✓ Done — lead ${lead.id} updated, status: ${patchStatus}`);

  } catch (err) {
    console.error("twilio-incoming unhandled error:", err);
  }

  return twiml(res);
}
