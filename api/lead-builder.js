// api/lead-builder.js
// Pulls homeowner leads for a ZIP using Tracerfy batch skip trace.
// Flow: ZIP → get city/state free → submit to Tracerfy Advanced batch → poll results

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { action, tracerfyKey, zip, jobId } = req.body || {};

  // ── ACTION: build leads for a ZIP ────────────────────────────────────────
  if (action === "build_leads" || action === "get_addresses") {
    if (!tracerfyKey) return res.status(400).json({ error: "tracerfyKey required" });
    if (!zip) return res.status(400).json({ error: "zip required" });

    try {
      // Step 1: Get city/state for this ZIP (free, reliable)
      const zipInfo = await getZipInfo(zip);
      if (!zipInfo) {
        return res.status(404).json({ error: `ZIP ${zip} not found. Check the ZIP code is valid.` });
      }
      console.log(`ZIP ${zip} → ${zipInfo.city}, ${zipInfo.state}`);

      // Step 2: Try Tracerfy Lead Builder endpoint (ZIP-level bulk pull)
      // This is their dedicated endpoint for pulling all homeowners in a ZIP
      const lbRes = await fetch("https://api.tracerfy.com/v1/lead-builder", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${tracerfyKey}`,
          "Content-Type": "application/json",
          "Accept": "application/json",
        },
        body: JSON.stringify({
          zip_code: zip,
          city: zipInfo.city,
          state: zipInfo.state,
          property_type: "SFR", // Single Family Residential
        }),
      });

      const lbText = await lbRes.text();
      console.log(`Tracerfy lead-builder status: ${lbRes.status}, response: ${lbText.slice(0,200)}`);

      // Check if response is JSON
      let lbData;
      try {
        lbData = JSON.parse(lbText);
      } catch {
        // Not JSON — Tracerfy may not support this endpoint on your plan
        // Fall back to batch skip trace
        console.log("Lead Builder endpoint not available, trying batch skip trace...");
        return await runBatchSkipTrace(zip, zipInfo, tracerfyKey, res);
      }

      if (!lbRes.ok) {
        // Lead Builder failed — fall back to batch
        console.log("Lead Builder failed:", lbData.error || lbData.message);
        return await runBatchSkipTrace(zip, zipInfo, tracerfyKey, res);
      }

      // Lead Builder succeeded
      if (lbData.job_id || lbData.queue_id || lbData.id) {
        return res.json({
          success: true,
          jobId: lbData.job_id || lbData.queue_id || lbData.id,
          zip, city: zipInfo.city, state: zipInfo.state,
          source: "lead_builder",
          estimatedSeconds: lbData.estimated_seconds || 90,
        });
      }

      // Synchronous results
      if (lbData.results || lbData.records || lbData.data) {
        const raw = lbData.results || lbData.records || lbData.data || [];
        const leads = parseLeads(Array.isArray(raw) ? raw : [raw], zip);
        return res.json({ success: true, zip, leads, count: leads.length });
      }

      // Unknown format — fall back
      return await runBatchSkipTrace(zip, zipInfo, tracerfyKey, res);

    } catch (err) {
      console.error("build_leads error:", err);
      return res.status(500).json({ error: err.message });
    }
  }

  // ── ACTION: poll for job results ──────────────────────────────────────────
  if (action === "poll" || action === "get_batch_results") {
    if (!tracerfyKey) return res.status(400).json({ error: "tracerfyKey required" });
    if (!jobId) return res.status(400).json({ error: "jobId required" });

    try {
      // Try lead builder status
      for (const endpoint of [
        `https://api.tracerfy.com/v1/lead-builder/${jobId}`,
        `https://api.tracerfy.com/v1/trace/batch/${jobId}`,
        `https://www.tracerfy.com/api/v1/trace/batch/${jobId}/`,
      ]) {
        const r = await fetch(endpoint, {
          headers: { "Authorization": `Bearer ${tracerfyKey}`, "Accept": "application/json" },
        });
        if (!r.ok) continue;

        const text = await r.text();
        let data;
        try { data = JSON.parse(text); } catch { continue; }

        const status = (data.status || "").toLowerCase();
        if (status === "complete" || status === "completed" || status === "done") {
          let raw = data.results || data.records || data.data || [];

          // Download from URL if provided
          if (data.download_url) {
            const dlRes = await fetch(data.download_url, {
              headers: { "Authorization": `Bearer ${tracerfyKey}` },
            });
            const dlText = await dlRes.text();
            try { raw = JSON.parse(dlText); } catch { raw = []; }
          }

          const leads = parseLeads(Array.isArray(raw) ? raw : [], req.body?.zip || "");
          return res.json({ status: "complete", leads, count: leads.length });
        }

        if (status === "failed" || status === "error") {
          return res.json({ status: "failed", error: data.message || "Job failed" });
        }

        return res.json({
          status: status || "pending",
          progress: data.progress || data.percent_complete || null,
          estimatedSeconds: data.estimated_seconds || data.estimated_wait_seconds || null,
        });
      }

      return res.json({ status: "pending" });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(400).json({ error: `Unknown action: ${action}` });
}

// ── Batch skip trace fallback ─────────────────────────────────────────────────
// Submits a list of address seeds to Tracerfy Advanced Skip Trace
// Tracerfy will find the homeowner for each address
async function runBatchSkipTrace(zip, zipInfo, tracerfyKey, res) {
  // Generate a spread of house numbers across the ZIP
  // Tracerfy will look up the actual owner for each address
  const streets = [
    "Main St","Oak Ave","Elm St","Maple Dr","Cedar Ln","Pine St",
    "Washington Blvd","Park Ave","Lake Dr","Hill Rd","Church St","School Rd"
  ];
  const records = [];
  for (const street of streets) {
    for (const num of [100,200,300,400,500,600,700,800,900,1000,1100,1200]) {
      records.push({
        id: `${zip}_${records.length}`,
        address: `${num} ${street}`,
        city: zipInfo.city,
        state: zipInfo.state,
        zip,
      });
    }
  }

  console.log(`Submitting ${records.length} address seeds to Tracerfy batch for ZIP ${zip}`);

  // Try multiple Tracerfy API base URLs
  for (const baseUrl of ["https://api.tracerfy.com/v1", "https://www.tracerfy.com/api/v1"]) {
    try {
      const batchRes = await fetch(`${baseUrl}/trace/batch/`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${tracerfyKey}`,
          "Content-Type": "application/json",
          "Accept": "application/json",
        },
        body: JSON.stringify({ trace_type: "advanced", records }),
      });

      const batchText = await batchRes.text();
      console.log(`Batch ${baseUrl} status: ${batchRes.status}, response: ${batchText.slice(0,200)}`);

      let batchData;
      try { batchData = JSON.parse(batchText); } catch {
        console.log("Non-JSON response from batch endpoint");
        continue;
      }

      if (!batchRes.ok) {
        console.log("Batch failed:", batchData.error || batchData.message);
        continue;
      }

      const jobId = batchData.queue_id || batchData.job_id || batchData.id;
      if (jobId) {
        return res.json({
          success: true,
          jobId,
          zip,
          city: zipInfo.city,
          state: zipInfo.state,
          source: "batch_skip_trace",
          estimatedSeconds: batchData.estimated_wait_seconds || 60,
          count: records.length,
        });
      }
    } catch (err) {
      console.log(`Batch ${baseUrl} error:`, err.message);
    }
  }

  return res.status(500).json({
    error: "Could not submit to Tracerfy. Check your API key is valid and your plan supports batch skip trace.",
    zip,
  });
}

// ── ZIP info lookup ───────────────────────────────────────────────────────────
async function getZipInfo(zip) {
  try {
    const r = await fetch(`https://api.zippopotam.us/us/${zip}`);
    if (!r.ok) return null;
    const d = await r.json();
    const place = d.places?.[0];
    if (!place) return null;
    return { city: place["place name"], state: place["state abbreviation"] };
  } catch {
    return null;
  }
}

// ── Parse Tracerfy results ────────────────────────────────────────────────────
function parseLeads(results, zip) {
  return results
    .map(r => {
      const phones = r.phones || r.phone_numbers || [];
      const phone  = phones.find(p => p.type === "mobile")?.number
        || phones.find(p => p.type === "landline")?.number
        || phones[0]?.number || r.phone || null;

      const emails = r.emails || [];
      const email  = emails[0]?.email || r.email || null;

      const firstName = r.first_name || r.owner_first_name || "";
      const lastName  = r.last_name  || r.owner_last_name  || "";
      const fullName  = r.owner_name || r.name
        || (firstName || lastName ? `${firstName} ${lastName}`.trim() : null);

      const addr = r.property_address || r.address || {};
      const street = typeof addr === "string" ? addr : (addr.street || r.street || "");

      return {
        homeowner: fullName || "Unknown Owner",
        phone: phone ? formatPhone(phone) : null,
        email,
        address: street,
        city: addr.city || r.city || "",
        state: addr.state || r.state || "",
        zip: addr.zip || zip,
      };
    })
    .filter(l => l.phone && l.homeowner !== "Unknown Owner");
}

function formatPhone(raw) {
  const d = String(raw).replace(/\D/g, "");
  if (d.length === 10) return `${d.slice(0,3)}-${d.slice(3,6)}-${d.slice(6)}`;
  if (d.length === 11 && d[0] === "1") return `${d.slice(1,4)}-${d.slice(4,7)}-${d.slice(7)}`;
  return raw;
}
