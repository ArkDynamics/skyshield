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

  const startHour = inspector.schedule
    ? parseInt((inspector.schedule.startTime || "08:00").split(":")[0], 10)
    : parseInt((sched.startTime || "08:00").split(":")[0], 10);
  const endHour = inspector.schedule
    ? parseInt((inspector.schedule.endTime || "17:00").split(":")[0], 10)
    : parseInt((sched.endTime || "17:00").split(":")[0], 10);
  const dur = sched.durationMins || 60;

  // Get working days from inspector schedule or default weekdays
  const inspDays = inspector.schedule?.days;
  function isDayActive(dayKey){
    if(inspDays) return inspDays[dayKey] !== false && (inspDays[dayKey] || ["mon","tue","wed","thu","fri"].includes(dayKey));
    return ["mon","tue","wed","thu","fri"].includes(dayKey);
  }

  const bufferMins = sched.bufferMins || 30;

  // Build set of blocked time ranges (booked slot + buffer on each side)
  const blockedRanges = existingInspections
    .filter(i => i.status === "scheduled" || i.status === "rescheduled")
    .map(i => {
      const start = new Date(i.startISO || i.start_iso);
      const end   = new Date(i.endISO   || i.end_iso   || i.startISO);
      return {
        start: new Date(start.getTime() - bufferMins * 60000),
        end:   new Date(end.getTime()   + bufferMins * 60000),
        inspectorId: i.inspectorId,
      };
    });

  function isConflict(dateStr, hour) {
    const slotStart = new Date(`${dateStr}T${String(hour).padStart(2,"0")}:00:00`);
    const slotEnd   = new Date(slotStart.getTime() + dur * 60000);
    return blockedRanges.some(r =>
      (r.inspectorId === inspector.id || !r.inspectorId) &&
      slotStart < r.end && slotEnd > r.start
    );
  }

  // Build set of already-booked start times (for exact match check)
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

  while (attempts < 45) { // 45 calendar days covers ~30 business days
    attempts++;
    const dow = d.getDay();
    const dayNames = ["sun","mon","tue","wed","thu","fri","sat"];
    const dayKey = dayNames[dow];
    const daySchedule = sched.days?.[dayKey];

    // Skip if inspector is off this day
    if (!isDayActive(dayKey) || daySchedule?.open === false) {
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
      if (isConflict(dateStr, hour)) continue;

      // Calculate endISO without timezone conversion issues
      // Add duration minutes directly to the hour:minute without using Date math
      const endHourRaw = hour + Math.floor(dur / 60);
      const endMinRaw  = dur % 60;
      const endISO = `${dateStr}T${String(endHourRaw).padStart(2,"0")}:${String(endMinRaw).padStart(2,"0")}:00`;
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
  if (!ANTHROPIC_KEY) { console.warn("ANTHROPIC_API_KEY not set"); return null; }

  const lower = incomingMsg.trim().toLowerCase();
  if (["stop","unsubscribe","quit","cancel","end"].includes(lower))
    return { reply: "You've been unsubscribed. Reply HELP for help.", bookedSlot: null };
  if (lower === "help")
    return { reply: "For help email skyshieldpro@arkdynamics.io. Reply STOP to opt out.", bookedSlot: null };

  const conversations = Array.isArray(lead.conversations) ? lead.conversations
    : (typeof lead.conversations === "string" ? JSON.parse(lead.conversations || "[]") : []);

  const history = conversations
    .filter(c => c.role && c.msg)
    .map(c => ({ role: c.role === "lead" ? "user" : "assistant", content: c.msg }));

  const requireAdult = commSettings?.requireAdultPresent !== false;
  const adultStatus  = lead.adult_confirmed || "unconfirmed";
  const h12 = h => `${h===0?12:h>12?h-12:h}:00${h>=12?"pm":"am"}`;

  // Give each slot a permanent number with its exact ISO embedded
  const slotList = slots.map((s, i) =>
    `Option ${i+1}: ${s.label} [ISO:${s.startISO}]`
  ).join("\n");

  const isScheduled = lead.status === "scheduled";
  const existingBooking = isScheduled ? (lead.notes||"").match(/AI booked: ([^|]+)/)?.[1]?.trim() : null;

  const system = `You are an SMS scheduling assistant for ${roofer?.name || "a roofing company"} texting homeowner ${lead.homeowner || "the homeowner"} about a storm-damaged roof.

GOAL: book a free roof inspection in this SMS conversation.

${isScheduled && existingBooking ? `CURRENT APPOINTMENT: ${existingBooking}. They may want to reschedule or cancel.` : ""}

WORKING HOURS: ${h12(startHour)} to ${h12(endHour)} Monday–Friday.

AVAILABLE SLOTS (use these exact numbers and ISOs when booking):
${slotList || "No slots available — ask for preferred time and set wantsCustomTime:true"}

EXACT CONVERSATION FLOW:
Step 1 - Interest shown ("yes", "sure", etc.) → offer 3-4 spread-out options from list above (show date and time, NOT the [ISO:...] part)
Step 2 - They name a day ("the 19th", "Friday") → show all times available that day, numbered
Step 3 - They pick a time ("2pm", "option 3", a number) → BEFORE booking, ask about adult presence: "Perfect! Just to confirm — will someone 18 or older be home during the inspection?"
Step 4 - They say yes/confirm adult → set adultConfirmed:"confirmed" AND set bookedSlotISO to the EXACT [ISO:...] value from the slot they chose. Confirm booking in reply.
Step 5 - They say no adult → explain adult must be present, ask when someone will be home

OTHER CASES:
- Simple short replies ("ok", "sounds good", "great") → continue conversation naturally, don't repeat yourself
- "reschedule" / "change" → set isReschedule:true, offer new slots
- "cancel" / "never mind" → set isCancelled:true, be warm
- Pricing questions → FREE inspections, work with all insurance
- Anything you can't confidently answer → set needsHumanReview:true

CRITICAL RULE: Only set bookedSlotISO when adultConfirmed is "confirmed". Copy the ISO EXACTLY from [ISO:...] — do not modify or guess.

Keep replies under 300 chars. Be warm and natural.

Respond ONLY with valid JSON (no markdown, no text outside the braces):
{"reply":"message text","adultConfirmed":"unconfirmed","bookedSlotISO":null,"isReschedule":false,"isCancelled":false,"wantsCustomTime":false,"preferredTime":null,"needsHumanReview":false}`;

  const apiRes = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type":"application/json", "x-api-key":ANTHROPIC_KEY, "anthropic-version":"2023-06-01" },
    body: JSON.stringify({ model:"claude-sonnet-4-6", max_tokens:600, system, messages:[...history,{role:"user",content:incomingMsg}] }),
  });

  if (!apiRes.ok) { console.error("Anthropic error:", apiRes.status); return null; }

  const raw = (await apiRes.json()).content?.[0]?.text || "";
  console.log("Claude raw:", raw.slice(0,400));

  try {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("No JSON");
    const p = JSON.parse(match[0]);

    // Find exact slot by ISO
    let bookedSlot = null;
    if (p.bookedSlotISO) {
      bookedSlot = slots.find(s => s.startISO === p.bookedSlotISO)
        || slots.find(s => s.startISO.slice(0,16) === p.bookedSlotISO.slice(0,16));
      if (!bookedSlot) console.warn("bookedSlotISO not matched:", p.bookedSlotISO);
    }

    return {
      reply:           p.reply || null,
      adultConfirmed:  ["confirmed","denied","unconfirmed"].includes(p.adultConfirmed) ? p.adultConfirmed : adultStatus,
      bookedSlot,
      bookedSlotISO:   bookedSlot?.startISO || null,
      isReschedule:    !!p.isReschedule,
      isCancelled:     !!p.isCancelled,
      wantsCustomTime: !!p.wantsCustomTime,
      preferredTime:   p.preferredTime || null,
      needsHumanReview: !!p.needsHumanReview,
    };
  } catch(e) {
    console.error("Parse fail:", e.message, raw.slice(0,200));
    const m = raw.match(/"reply"\s*:\s*"((?:[^"\\]|\\.)*)"/);
    return { reply: m ? m[1].replace(/\\n/g,"\n").replace(/\\"/g,'"') : null, adultConfirmed: adultStatus, bookedSlot: null };
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

    // 7. Handle booking / reschedule
    let patchStatus = newStatus;
    let patchNotes  = lead.notes || "";
    let bookedSlot  = null;

    // Auto-detect reschedule: if lead is already scheduled and AI is booking a new slot
    const autoReschedule = aiResult?.isReschedule
      || (lead.status === "scheduled" && (aiResult?.bookedSlot || aiResult?.bookedSlotISO));

    if ((aiResult?.bookedSlot || aiResult?.bookedSlotISO) && slots.length > 0) {
      bookedSlot = aiResult.bookedSlot
        || slots.find(s => s.startISO === aiResult.bookedSlotISO)
        || slots.find(s => s.startISO?.slice(0,16) === aiResult.bookedSlotISO?.slice(0,16));

      if (!bookedSlot) {
        console.warn("Could not match slot, skipping booking");
      } else {
        patchStatus = "scheduled";
        const action = autoReschedule ? "AI rescheduled" : "AI booked";
        // Remove old booking note, add new one
        patchNotes = patchNotes.replace(/\s*\|\s*AI (booked|rescheduled):[^|]*/g, "").trim();
        patchNotes = (patchNotes + ` | ${action}: ${bookedSlot.label}`).trim();
        console.log(`✓ ${action}: ${bookedSlot.label} for ${lead.homeowner}`);

        if (roofer) {
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
            reminderSent: false,
            createdAt: new Date().toISOString(),
          };

          let updatedInspections;
          if (autoReschedule) {
            // Find by leadId OR homeowner name — update in place
            const existingIdx = existingInspections.findIndex(
              i => i.leadId === lead.id || i.client === lead.homeowner
            );
            if (existingIdx >= 0) {
              updatedInspections = existingInspections.map((ins, idx) =>
                idx === existingIdx
                  ? { ...ins, startISO: bookedSlot.startISO, endISO: bookedSlot.endISO,
                      status: "rescheduled", reminderSent: false }
                  : ins
              );
              console.log(`✓ Rescheduled inspection for ${lead.homeowner} to ${bookedSlot.label}`);
            } else {
              updatedInspections = [...existingInspections, newInspection];
              console.log(`✓ No existing found, created new inspection`);
            }
          } else {
            updatedInspections = [...existingInspections, newInspection];
          }

          await sbPatch("roofers", `id=eq.${roofer.id}`, { inspections: updatedInspections });
          console.log(`✓ Roofer calendar updated`);

          // Notify roofer
          if (twilioKeys?.sid && twilioKeys?.token && roofer.phone) {
            const act = autoReschedule ? "rescheduled" : "booked";
            await sendSMS(twilioKeys.sid, twilioKeys.token, toNumber, roofer.phone,
              `SkyShield: ${lead.homeowner} ${act}! ${bookedSlot.label.split(" (")[0]}. Check your calendar.`);
          }
        }
      }
    }

    // Handle cancellation
    if (aiResult?.isCancelled) {
      patchStatus = "cold";
      patchNotes  = (patchNotes + " | Cancelled by homeowner via SMS.").trim();

      if (roofer) {
        // Remove inspection from calendar
        const updatedInspections = existingInspections.filter(i =>
          i.leadId !== lead.id && i.client !== lead.homeowner
        );
        await sbPatch("roofers", `id=eq.${roofer.id}`, { inspections: updatedInspections });
        console.log(`✓ Removed inspection for ${lead.homeowner} — cancelled`);

        // Notify roofer
        if (twilioKeys?.sid && twilioKeys?.token && roofer.phone) {
          await sendSMS(twilioKeys.sid, twilioKeys.token, toNumber, roofer.phone,
            `SkyShield: ${lead.homeowner} cancelled their inspection. Lead marked as cold.`);
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
