// api/twilio-send.js
// Proxies Twilio SMS calls server-side so credentials stay safe
// and CORS doesn't block the request from the browser.

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { sid, token, from, to, body } = req.body;

  if (!sid || !token || !from || !to || !body) {
    return res.status(400).json({ error: "Missing required fields: sid, token, from, to, body" });
  }

  try {
    const credentials = Buffer.from(`${sid}:${token}`).toString("base64");

    const response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,
      {
        method: "POST",
        headers: {
          "Authorization": `Basic ${credentials}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ To: to, From: from, Body: body }).toString(),
      }
    );

    const data = await response.json();

    if (!response.ok) {
      console.error("Twilio error:", data);
      return res.status(response.status).json({ error: data.message || "Twilio error", detail: data });
    }

    return res.json({ success: true, sid: data.sid, status: data.status });

  } catch (err) {
    console.error("twilio-send error:", err);
    return res.status(500).json({ error: err.message });
  }
}
