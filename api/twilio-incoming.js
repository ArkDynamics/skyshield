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
// Generates every available hour within working hours across the next 2 weeks.
// This way when a homeowner asks for "2pm" or "3:30pm" the AI can check
// if that time is genuinely available and offer it directly.
function buildSlots(roofer, existingInspections = []) {
  const raw = roofer.schedule_settings;
  const sched = raw ? (typeof raw === "string" ? JSON.parse(raw) : raw) : {};
  const rawIns = roofer.inspectors;
  const inspectors = rawIns
    ? (Array.isArray(rawIns) ? rawIns : JSON.parse(rawIns))
    : [];
  const inspector = inspectors[0];
  if (!inspector) return { slots: [], startHour: 8, endHour: 17, dur: 60 };

  const startHour = parseInt((sched.startTime || "08:00").split(":")[0], 10);
  const endHour   = parseInt((sched.endTime   || "17:00").split(":")[0], 10);
  const dur       = sched.durationMins || 60;

  // Build set of already-booked start times
  const bookedTimes = new Set(
    existingInspections
      .filter(i => i.status === "scheduled" || i.status === "rescheduled")
      .map(i => (i.start_iso || i.startISO || "").slice(0, 16))
      .filter(Boolean)
  );

  // Parse time blocks
  const rawBlocks = roofer.time_blocks || roofer.timeBlocks;
  const timeBlocks = rawBlocks
    ? (Array.isArray(rawBlocks) ? rawBlocks : (typeof rawBlocks === "string" ? JSON.parse(rawBlocks) : []))
    : [];

  function isBlocked(dateStr, hour) {
    return timeBlocks.some(blk => {
      if (blk.date !== dateStr) return false;
      if (blk.allDay) return true;
      const blkStart = parseInt((blk.startTime || "00:00").split(":")[0], 10);
      const blkEnd   = parseInt((blk.endTime   || "23:59").split(":")[0], 10);
      return hour >= blkStart && hour < blkEnd;
    });
  }

  const slots = [];
  const d = new Date();
  d.setDate(d.getDate() + 1);
  let attempts = 0;

  while (attempts < 21) {
    attempts++;
    const dow = d.getDay();
    const dayNames = ["sun","mon","tue","wed","thu","fri","sat"];
    const dayKey = dayNames[dow];
    const daySchedule = sched.days?.[dayKey];

    if (dow === 0 || dow === 6 || daySchedule?.open === false) {
      d.setDate(d.getDate() + 1);
      continue;
    }

    const dateStr = d.toISOString().split("T")[0];
    const dayStr  = d.toLocaleDateString("en-US", { weekday:"long", month:"short", day:"numeric" });

    // Every hour within working hours
    for (let hour = startHour; hour < endHour; hour++) {
      const startISO = `${dateStr}T${String(hour).padStart(2,"0")}:00:00`;
      const slotKey  = startISO.slice(0, 16);

      if (bookedTimes.has(slotKey)) continue;
      if (isBlocked(dateStr, hour)) continue;

      const endISO = new Date(new Date(startISO).getTime() + dur * 60000).toISOString();
      const h12    = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
      const ampm   = hour >= 12 ? "pm" : "am";
      const period = hour < 12 ? "Morning" : hour < 15 ? "Midday" : "Afternoon";

      slots.push({
        startISO, endISO,
        label: `${dayStr} at ${h12}:00${ampm} (${period})`,
        date: dateStr,
        hour,
        dayOfWeek: dayNames[dow],
        inspectorId: inspector.id,
        inspectorName: inspector.name || "Inspector",
      });
    }

    d.setDate(d.getDate() + 1);
  }

  return { slots, startHour, endHour, dur, inspector };
}


// ── AI reply ──────────────────────────────────────────────────────────────────
async function generateAIReply(lead, roofer, incomingMsg, commSettings, slots, startHour=8, endHour=17) {
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

  // Convert hour to 12h label for display
  const h12 = h => `${h===0?12:h>12?h-12:h}:00${h>=12?"pm":"am"}`;
  const startLabel = h12(startHour);
  const endLabel   = h12(endHour);

  // Build a condensed slot list showing unique days and available hours
  // Group slots by date to keep the prompt concise
  const slotsByDate = {};
  slots.forEach((s, i) => {
    if (!slotsByDate[s.date]) slotsByDate[s.date] = { label: s.label.split(" at ")[0], hours: [], indices: [] };
    slotsByDate[s.date].hours.push(h12(s.hour));
    slotsByDate[s.date].indices.push(i);
  });
  const slotSummary = Object.entries(slotsByDate).slice(0, 10)
    .map(([date, info]) => `${info.label}: ${info.hours.join(", ")}`)
    .join("\n");

  const isScheduled = lead.status === "scheduled";
  const existingBooking = isScheduled ? (lead.notes || "").match(/AI booked: ([^|]+)/)?.[1]?.trim() : null;

  const system = `You are an SMS scheduling assistant for ${roofer?.name || "a roofing company"} texting homeowner ${lead.homeowner || "the homeowner"} about their storm-damaged roof.

GOAL: book or reschedule a free roof inspection directly in this conversation.

${isScheduled && existingBooking ? `CURRENT APPOINTMENT: ${existingBooking}. The homeowner may be asking to reschedule this.` : ""}
${requireAdult ? `ADULT PRESENCE: Confirm someone 18+ will be home before booking. Current status: ${adultStatus}.` : ""}

WORKING HOURS: ${startLabel} to ${endLabel} weekdays. Any time within these hours on an available day can be offered.

AVAILABLE DAYS AND TIMES (every hour shown is open and unbooked):
${slotSummary || "No availability right now — ask for their preferred time and set wantsCustomTime:true"}

HOW TO RESPOND:
- Interest / "yes" → offer 3-4 options spread across different days
- "reschedule", "change my appointment", "can we move it" → acknowledge current booking, offer new slots, set isReschedule:true
- "2pm", "3pm", any specific time → check if that hour is within working hours and available. Offer it across available days
- "tomorrow at 2pm" → check if tomorrow is available and 2pm is within hours. If yes, offer it
- "afternoon" → offer slots 12pm-end of day
- "morning" → offer slots start-12pm
- "Friday" / day name → check available days. If not available, offer nearest day
- "next week" → filter to next calendar week
- Bare number "1","2","3" → selecting from last listed options — set bookedSlotIndex to correct 0-based index in full slots array
- Pricing → FREE inspections, work with all insurance companies
- Can't answer → set needsHumanReview:true

When offering times, list them clearly numbered.
WHEN BOOKING/RESCHEDULING: confirm with full date, time, and inspector name.
Keep messages under 300 characters. Be warm and conversational.

Reply ONLY with this exact JSON (no markdown):
{"reply":"message text","adultConfirmed":"unconfirmed","bookedSlotIndex":null,"isReschedule":false,"wantsCustomTime":false,"preferredTime":null,"needsHumanReview":false}`;

  const apiRes = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 600,
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
      isReschedule:    !!parsed.isReschedule,
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
    // Fetch roofer's existing inspections and time blocks to exclude from slots
    const existingInspections = roofer
      ? ((typeof roofer.inspections === "string"
          ? JSON.parse(roofer.inspections || "[]")
          : roofer.inspections) || [])
      : [];
    const slotData = roofer ? buildSlots(roofer, existingInspections) : { slots:[], startHour:8, endHour:17, dur:60, inspector:null };
    const slots = slotData.slots;
    const { startHour, endHour, dur } = slotData;
    console.log("Slots built:", slots.length, "| Hours:", startHour, "-", endHour);

    if (autoReply) {
      aiResult = await generateAIReply(lead, roofer, body, commSettings, slots, startHour, endHour);
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
    let bookedSlot  = null;

    if (aiResult?.bookedSlotIndex !== null && aiResult?.bookedSlotIndex !== undefined && slots.length > 0) {
      bookedSlot  = slots[aiResult.bookedSlotIndex] ?? slots[0];
      patchStatus = "scheduled";
      const action = aiResult.isReschedule ? "AI rescheduled" : "AI booked";
      patchNotes  = (patchNotes + ` | ${action}: ${bookedSlot.label}`).trim();
      console.log(`✓ ${action} slot ${aiResult.bookedSlotIndex}: ${bookedSlot.label}`);

      if (bookedSlot && roofer) {
        const newInspection = {
          id: "ins_" + Date.now(),
          client: lead.homeowner || "Unknown",
          address: lead.address ? `${lead.address}, ${lead.zip || ""}` : (lead.zip || ""),
          phone: lead.phone || fromNumber,
          startISO: bookedSlot.startISO,
          endISO: bookedSlot.endISO,
          inspectorId: bookedSlot.inspectorId || null,
          inspector: bookedSlot.inspectorName || "Inspector",
          status: "scheduled",
          source: "ai_sms",
          leadId: lead.id,
          createdAt: new Date().toISOString(),
        };

        let updatedInspections;
        if (aiResult.isReschedule) {
          // Find existing inspection for this lead and update it
          const existingIdx = existingInspections.findIndex(i => i.leadId === lead.id || i.client === lead.homeowner);
          if (existingIdx >= 0) {
            updatedInspections = existingInspections.map((ins, idx) =>
              idx === existingIdx
                ? { ...ins, startISO: bookedSlot.startISO, endISO: bookedSlot.endISO, status: "rescheduled" }
                : ins
            );
            console.log(`✓ Rescheduled existing inspection ${existingInspections[existingIdx].id}`);
          } else {
            // No existing found — create new
            updatedInspections = [...existingInspections, newInspection];
          }
        } else {
          updatedInspections = [...existingInspections, newInspection];
        }

        await sbPatch("roofers", `id=eq.${roofer.id}`, { inspections: updatedInspections });
        console.log(`✓ Inspection record saved to roofer`);

        // Notify roofer by SMS
        if (twilioKeys?.sid && twilioKeys?.token && roofer.phone) {
          const action2 = aiResult.isReschedule ? "rescheduled" : "booked";
          const notifyMsg = `SkyShield: ${lead.homeowner} ${action2}! ${bookedSlot.label.split(" (")[0]}. Check your calendar.`;
          await sendSMS(twilioKeys.sid, twilioKeys.token, toNumber, roofer.phone, notifyMsg);
        }
      }
    }

    if (aiResult?.wantsCustomTime && aiResult?.preferredTime) {
      patchNotes = (patchNotes + ` | Prefers: ${aiResult.preferredTime}`).trim();
    }

    if (aiResult?.needsHumanReview) {
      patchNotes = (patchNotes + " ⚠ Flagged for human review.").trim();
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
