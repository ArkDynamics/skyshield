// api/lead-builder.js
// Builds homeowner lead lists for a ZIP code using:
// 1. OpenAddresses (free) — gets all residential addresses in the ZIP
// 2. Tracerfy Advanced Skip Trace ($0.04/hit) — finds owner name + phone + email
// Called when a storm is processed to auto-generate leads for affected ZIPs.

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { action, tracerfyKey, zip, addresses, jobId } = req.body;

  // ── ACTION: get addresses for a ZIP from OpenAddresses ───────────────────
  if (action === "get_addresses") {
    if (!zip) return res.status(400).json({ error: "zip required" });
    try {
      // Use the Census Bureau's free geocoding/address API to get addresses by ZIP
      // This hits the Census TIGER/Line address dataset — completely free, no key needed
      const addresses = await getAddressesForZip(zip);
      return res.json({ success: true, zip, count: addresses.length, addresses });
    } catch (err) {
      console.error("get_addresses error:", err);
      return res.status(500).json({ error: err.message });
    }
  }

  // ── ACTION: batch skip trace a list of addresses ─────────────────────────
  if (action === "skip_trace_batch") {
    if (!tracerfyKey) return res.status(400).json({ error: "tracerfyKey required" });
    if (!addresses || !addresses.length) return res.status(400).json({ error: "addresses array required" });

    try {
      // Submit batch job to Tracerfy
      const batchRes = await fetch("https://www.tracerfy.com/api/v1/trace/batch/", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${tracerfyKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          trace_type: "advanced", // address only → returns owner + phone + email
          records: addresses.map((addr, i) => ({
            id: `${zip}_${i}`,
            address: addr.street,
            city: addr.city,
            state: addr.state,
            zip: addr.zip || zip,
          })),
        }),
      });

      const batchData = await batchRes.json();

      if (!batchRes.ok) {
        return res.status(batchRes.status).json({ error: batchData.error || "Tracerfy batch error", detail: batchData });
      }

      return res.json({
        success: true,
        jobId: batchData.queue_id,
        estimatedSeconds: batchData.estimated_wait_seconds,
        count: addresses.length,
      });
    } catch (err) {
      console.error("skip_trace_batch error:", err);
      return res.status(500).json({ error: err.message });
    }
  }

  // ── ACTION: check batch job status and get results ───────────────────────
  if (action === "get_batch_results") {
    if (!tracerfyKey || !jobId) return res.status(400).json({ error: "tracerfyKey and jobId required" });

    try {
      const statusRes = await fetch(`https://www.tracerfy.com/api/v1/trace/batch/${jobId}/`, {
        headers: { "Authorization": `Bearer ${tracerfyKey}` },
      });
      const statusData = await statusRes.json();

      if (statusData.status === "complete" && statusData.download_url) {
        // Fetch the results
        const resultsRes = await fetch(statusData.download_url, {
          headers: { "Authorization": `Bearer ${tracerfyKey}` },
        });
        const results = await resultsRes.json();

        // Parse into clean lead objects
        const leads = parseTracerfyResults(results, zip);
        return res.json({ status: "complete", leads, raw: results });
      }

      return res.json({
        status: statusData.status || "pending",
        progress: statusData.progress || null,
        estimatedSeconds: statusData.estimated_wait_seconds || null,
      });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // ── ACTION: instant single address skip trace ─────────────────────────────
  if (action === "skip_trace_instant") {
    if (!tracerfyKey) return res.status(400).json({ error: "tracerfyKey required" });
    const { street, city, state } = req.body;
    if (!street) return res.status(400).json({ error: "street required" });

    try {
      const r = await fetch("https://www.tracerfy.com/api/v1/trace/instant/", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${tracerfyKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ address: street, city, state, zip, trace_type: "advanced" }),
      });
      const data = await r.json();
      if (!r.ok) return res.status(r.status).json({ error: data.error || "Tracerfy error" });

      const lead = parseTracerfyResult(data, zip);
      return res.json({ success: true, lead });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(400).json({ error: "Unknown action" });
}

// ── Get all residential addresses for a ZIP using multiple free sources ──────
async function getAddressesForZip(zip) {
  const addresses = [];

  try {
    // Source 1: Census Bureau Geocoding API — returns addresses in a ZIP
    // This uses the TIGER/Line address database, free, no API key needed
    const censusUrl = `https://geocoding.geo.census.gov/geocoder/locations/address?street=&city=&state=&zip=${zip}&benchmark=Public_AR_Current&format=json`;
    const censusRes = await fetch(censusUrl, {
      headers: { "User-Agent": "SkyShieldPro/1.0 (noah.arkdynamics@gmail.com)" }
    });

    if (censusRes.ok) {
      const censusData = await censusRes.json();
      // Census geocoder returns matched addresses
      if (censusData.result?.addressMatches) {
        for (const match of censusData.result.addressMatches) {
          addresses.push({
            street: match.matchedAddress?.split(",")[0] || "",
            city: match.addressComponents?.city || "",
            state: match.addressComponents?.state || "",
            zip,
            lat: match.coordinates?.y || null,
            lng: match.coordinates?.x || null,
          });
        }
      }
    }
  } catch (e) {
    console.warn("Census API failed:", e.message);
  }

  // Source 2: OpenStreetMap Nominatim — query for residential addresses in ZIP
  // Free, no API key, but rate-limited to 1 req/sec
  try {
    const osmUrl = `https://nominatim.openstreetmap.org/search?postalcode=${zip}&country=US&addressdetails=1&limit=50&format=json`;
    const osmRes = await fetch(osmUrl, {
      headers: { "User-Agent": "SkyShieldPro/1.0 (noah.arkdynamics@gmail.com)" }
    });

    if (osmRes.ok) {
      const osmData = await osmRes.json();
      for (const item of osmData) {
        if (item.type === "house" || item.type === "residential" || item.class === "building") {
          const addr = item.address || {};
          addresses.push({
            street: `${addr.house_number || ""} ${addr.road || ""}`.trim(),
            city: addr.city || addr.town || addr.village || "",
            state: addr.state || "",
            zip,
            lat: parseFloat(item.lat) || null,
            lng: parseFloat(item.lon) || null,
          });
        }
      }
    }
  } catch (e) {
    console.warn("OSM Nominatim failed:", e.message);
  }

  // Deduplicate by street address
  const seen = new Set();
  return addresses.filter(a => {
    if (!a.street || seen.has(a.street.toLowerCase())) return false;
    seen.add(a.street.toLowerCase());
    return true;
  });
}

// ── Parse Tracerfy batch results into clean lead objects ─────────────────────
function parseTracerfyResults(results, zip) {
  const records = Array.isArray(results) ? results : (results.results || results.data || []);
  return records
    .map(r => parseTracerfyResult(r, zip))
    .filter(l => l.phone); // only keep records where we got a phone number
}

function parseTracerfyResult(r, zip) {
  // Tracerfy returns phones as array, take the first mobile number or first available
  const phones = r.phones || r.phone_numbers || [];
  const phone = phones.find(p => p.type === "mobile")?.number
    || phones.find(p => p.type === "landline")?.number
    || phones[0]?.number
    || r.phone
    || null;

  const emails = r.emails || [];
  const email = emails[0]?.email || r.email || null;

  const ownerName = r.owner_name || r.name || r.first_name
    ? `${r.first_name || ""} ${r.last_name || ""}`.trim()
    : (r.owner_name || r.name || "Unknown Owner");

  const address = r.property_address || r.address || {};

  return {
    homeowner: ownerName,
    phone: phone ? formatPhone(phone) : null,
    email,
    address: address.street || r.street || "",
    zip: address.zip || zip,
    city: address.city || r.city || "",
    state: address.state || r.state || "",
    propertyDetails: {
      bedrooms: r.bedrooms || null,
      bathrooms: r.bathrooms || null,
      sqft: r.square_feet || null,
      yearBuilt: r.year_built || null,
      propertyType: r.property_type || null,
    },
    mailingAddress: r.mailing_address || null,
    source: "tracerfy",
  };
}

function formatPhone(raw) {
  const digits = String(raw).replace(/\D/g, "");
  if (digits.length === 10) return `${digits.slice(0,3)}-${digits.slice(3,6)}-${digits.slice(6)}`;
  if (digits.length === 11 && digits[0] === "1") return `${digits.slice(1,4)}-${digits.slice(4,7)}-${digits.slice(7)}`;
  return raw;
}
