// api/send-reminders.js
// Called daily (via Vercel Cron) to send reminder texts to homeowners
// the day before their scheduled inspection.
//
// Set up in vercel.json:
// "crons": [{"path": "/api/send-reminders", "schedule": "0 18 * * *"}]
// This runs every day at 6pm UTC (noon-1pm CST depending on DST)

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

async function sbGet(table, qs) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${qs}&select=*`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
  });
  return r.json();
}

async function sbPatch(table, qs, data) {
  await fetch(`${SUPABASE_URL}/rest/v1/${table}?${qs}`, {
    method: "PATCH",
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
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

function formatApptTime(startISO) {
  const d = new Date(startISO);
  return d.toLocaleString("en-US", {
    weekday: "long", month: "long", day: "numeric",
    hour: "numeric", minute: "2-digit", hour12: true,
  });
}

export default async function handler(req, res) {
  // Allow GET (for cron) or POST (for manual trigger)
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return res.status(500).json({ error: "Missing Supabase env vars" });
  }

  try {
    // Get Twilio credentials from app_state
    const appRows = await sbGet("app_state", "id=eq.singleton");
    const apiKeys = appRows?.[0]?.api_keys || {};
    const twilio = typeof apiKeys === "string" ? JSON.parse(apiKeys) : apiKeys;
    const twilioKeys = twilio?.twilio;

    if (!twilioKeys?.sid || !twilioKeys?.token) {
      return res.status(200).json({ message: "No Twilio credentials configured" });
    }

    // Get all roofers with their inspections
    const rooferRows = await sbGet("roofers", "status=in.(active,trial,test)");
    const roofers = Array.isArray(rooferRows) ? rooferRows : [];

    // Tomorrow's date range
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = tomorrow.toISOString().split("T")[0]; // "2026-08-06"

    let remindersSent = 0;
    let remindersSkipped = 0;

    for (const roofer of roofers) {
      const rawIns = roofer.inspections;
      const inspections = rawIns
        ? (Array.isArray(rawIns) ? rawIns : JSON.parse(rawIns))
        : [];

      // Find inspections scheduled for tomorrow that haven't had a reminder sent
      const tomorrowInspections = inspections.filter(ins =>
        ins.status === "scheduled" &&
        ins.startISO?.startsWith(tomorrowStr) &&
        !ins.reminderSent &&
        ins.phone
      );

      if (!tomorrowInspections.length) continue;

      // Get the roofer's Twilio number
      const rawComm = roofer.comm_settings;
      const commSettings = rawComm
        ? (typeof rawComm === "string" ? JSON.parse(rawComm) : rawComm)
        : {};
      const fromNumber = roofer.twilio_from || twilioKeys.from;

      if (!fromNumber) {
        console.warn(`Roofer ${roofer.name} has no Twilio number`);
        continue;
      }

      const updatedInspections = [...inspections];

      for (const ins of tomorrowInspections) {
        const apptTime = formatApptTime(ins.startISO);
        const msg = `Hi ${ins.client?.split(" ")[0] || "there"}, just a reminder that your free roof inspection with ${roofer.name} is scheduled for tomorrow — ${apptTime}. Reply CANCEL to cancel or RESCHEDULE to change. See you then!`;

        const sent = await sendSMS(twilioKeys.sid, twilioKeys.token, fromNumber, ins.phone, msg);

        if (sent) {
          // Mark reminder as sent on this inspection
          const idx = updatedInspections.findIndex(i => i.id === ins.id);
          if (idx >= 0) updatedInspections[idx] = { ...updatedInspections[idx], reminderSent: true };
          remindersSent++;
          console.log(`✓ Reminder sent to ${ins.client} (${ins.phone}) for ${tomorrowStr}`);
        } else {
          remindersSkipped++;
        }
      }

      // Save updated inspections back to roofer
      await sbPatch("roofers", `id=eq.${roofer.id}`, { inspections: updatedInspections });
    }

    console.log(`Reminders complete: ${remindersSent} sent, ${remindersSkipped} failed`);
    return res.status(200).json({
      success: true,
      date: tomorrowStr,
      remindersSent,
      remindersSkipped,
    });

  } catch (err) {
    console.error("send-reminders error:", err);
    return res.status(500).json({ error: err.message });
  }
}
