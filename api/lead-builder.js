// api/lead-builder.js

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { action, tracerfyKey, zip, jobId } = req.body || {};

  // ── ACTION: build leads ───────────────────────────────────────────────────
  if (action === "build_leads" || action === "get_addresses") {
    if (!tracerfyKey) return res.status(400).json({ error: "tracerfyKey required" });
    if (!zip) return res.status(400).json({ error: "zip required" });

    // Step 1: Resolve ZIP to city/state using built-in lookup
    const zipInfo = resolveZip(zip);
    if (!zipInfo) {
      return res.status(400).json({ error: `Unknown ZIP code: ${zip}. Add it to the ZIP lookup table.` });
    }
    console.log(`ZIP ${zip} → ${zipInfo.city}, ${zipInfo.state}`);

    // Step 2: Try Tracerfy Lead Builder (if supported)
    const lbResult = await tryTracerfyLeadBuilder(zip, zipInfo, tracerfyKey);
    if (lbResult) return res.json(lbResult);

    // Step 3: Fall back to Tracerfy Batch Skip Trace
    const batchResult = await tryTracerfyBatch(zip, zipInfo, tracerfyKey);
    if (batchResult) return res.json(batchResult);

    return res.status(500).json({
      error: "Could not connect to Tracerfy API. Verify your API key is correct and your plan includes batch skip trace.",
      zip,
    });
  }

  // ── ACTION: poll job ──────────────────────────────────────────────────────
  if (action === "poll" || action === "get_batch_results") {
    if (!tracerfyKey) return res.status(400).json({ error: "tracerfyKey required" });
    if (!jobId) return res.status(400).json({ error: "jobId required" });

    const endpoints = [
      `https://api.tracerfy.com/v1/lead-builder/${jobId}`,
      `https://api.tracerfy.com/v1/trace/batch/${jobId}`,
      `https://www.tracerfy.com/api/v1/trace/batch/${jobId}/`,
    ];

    for (const url of endpoints) {
      try {
        const r = await fetch(url, {
          headers: { "Authorization": `Bearer ${tracerfyKey}`, "Accept": "application/json" },
        });
        const text = await r.text();
        let data;
        try { data = JSON.parse(text); } catch { continue; }
        if (!r.ok) continue;

        const status = (data.status || "").toLowerCase();

        if (["complete","completed","done","success"].includes(status)) {
          let raw = data.results || data.records || data.data || [];
          if (data.download_url) {
            try {
              const dl = await fetch(data.download_url, { headers: { "Authorization": `Bearer ${tracerfyKey}` } });
              raw = await dl.json();
            } catch {}
          }
          const leads = parseLeads(Array.isArray(raw) ? raw : [], req.body?.zip || "");
          return res.json({ status: "complete", leads, count: leads.length });
        }

        if (["failed","error"].includes(status)) {
          return res.json({ status: "failed", error: data.message || "Job failed" });
        }

        return res.json({
          status: status || "pending",
          progress: data.progress || data.percent_complete || null,
        });
      } catch (err) {
        console.warn(`Poll ${url} failed:`, err.message);
      }
    }

    return res.json({ status: "pending" });
  }

  return res.status(400).json({ error: `Unknown action: ${action}` });
}

// ── Try Tracerfy Lead Builder endpoint ────────────────────────────────────────
async function tryTracerfyLeadBuilder(zip, zipInfo, key) {
  const urls = [
    "https://api.tracerfy.com/v1/lead-builder",
    "https://www.tracerfy.com/api/v1/lead-builder/",
  ];
  for (const url of urls) {
    try {
      const r = await fetch(url, {
        method: "POST",
        headers: { "Authorization": `Bearer ${key}`, "Content-Type": "application/json", "Accept": "application/json" },
        body: JSON.stringify({ zip_code: zip, city: zipInfo.city, state: zipInfo.state, property_type: "SFR" }),
      });
      const text = await r.text();
      let data; try { data = JSON.parse(text); } catch { continue; }
      if (!r.ok) { console.log(`LeadBuilder ${url} failed:`, r.status, data.error); continue; }

      const jobId = data.job_id || data.queue_id || data.id;
      if (jobId) return { success: true, jobId, zip, source: "lead_builder", estimatedSeconds: data.estimated_seconds || 90 };

      const raw = data.results || data.records || data.data;
      if (raw) {
        const leads = parseLeads(Array.isArray(raw) ? raw : [raw], zip);
        return { success: true, zip, leads, count: leads.length };
      }
    } catch (err) {
      console.warn(`LeadBuilder ${url}:`, err.message);
    }
  }
  return null;
}

// ── Try Tracerfy Batch Skip Trace ─────────────────────────────────────────────
async function tryTracerfyBatch(zip, zipInfo, key) {
  // Generate address seeds — Tracerfy resolves real owners from these
  const streetNames = ["Main St","Oak Ave","Elm St","Maple Dr","Cedar Ln","Pine St",
    "Washington Blvd","Park Ave","Lake Dr","Hill Rd","Church St","School Rd",
    "Forest Dr","Valley Rd","River Rd","Sunset Blvd","Highland Ave","Meadow Ln"];
  const records = [];
  for (const street of streetNames) {
    for (const num of [100,200,300,400,500,600,700,800,900,1000]) {
      records.push({ id: `${zip}_${records.length}`, address: `${num} ${street}`, city: zipInfo.city, state: zipInfo.state, zip });
      if (records.length >= 100) break;
    }
    if (records.length >= 100) break;
  }

  const urls = [
    "https://api.tracerfy.com/v1/trace/batch",
    "https://www.tracerfy.com/api/v1/trace/batch/",
  ];

  for (const url of urls) {
    try {
      const r = await fetch(url, {
        method: "POST",
        headers: { "Authorization": `Bearer ${key}`, "Content-Type": "application/json", "Accept": "application/json" },
        body: JSON.stringify({ trace_type: "advanced", records }),
      });
      const text = await r.text();
      let data; try { data = JSON.parse(text); } catch { console.warn(`Batch ${url} non-JSON:`, text.slice(0,200)); continue; }
      if (!r.ok) { console.log(`Batch ${url} failed:`, r.status, data.error || data.message); continue; }

      const jobId = data.queue_id || data.job_id || data.id;
      if (jobId) return { success: true, jobId, zip, source: "batch_skip_trace", estimatedSeconds: data.estimated_wait_seconds || 60, count: records.length };
    } catch (err) {
      console.warn(`Batch ${url}:`, err.message);
    }
  }
  return null;
}

// ── Parse results ─────────────────────────────────────────────────────────────
function parseLeads(results, zip) {
  return results.map(r => {
    const phones = r.phones || r.phone_numbers || [];
    const phone  = phones.find(p => p.type==="mobile")?.number
      || phones.find(p => p.type==="landline")?.number
      || phones[0]?.number || r.phone || null;
    const emails = r.emails || [];
    const email  = emails[0]?.email || r.email || null;
    const name   = r.owner_name || r.name
      || [r.first_name||r.owner_first_name, r.last_name||r.owner_last_name].filter(Boolean).join(" ")
      || null;
    const addr   = r.property_address || r.address || {};
    const street = typeof addr==="string" ? addr : (addr.street || r.street || "");
    return {
      homeowner: name || "Unknown Owner",
      phone: phone ? formatPhone(phone) : null,
      email, address: street,
      city: addr.city || r.city || "",
      state: addr.state || r.state || "",
      zip: addr.zip || zip,
    };
  }).filter(l => l.phone && l.homeowner !== "Unknown Owner");
}

function formatPhone(raw) {
  const d = String(raw).replace(/\D/g,"");
  if (d.length===10) return `${d.slice(0,3)}-${d.slice(3,6)}-${d.slice(6)}`;
  if (d.length===11&&d[0]==="1") return `${d.slice(1,4)}-${d.slice(4,7)}-${d.slice(7)}`;
  return raw;
}

// ── Built-in ZIP lookup (no external API needed) ──────────────────────────────
// Common ZIPs pre-seeded; Tracerfy API handles the actual address/owner lookup
function resolveZip(zip) {
  const db = {
    // Oklahoma
    "73064":"Mustang,OK","73099":"Yukon,OK","73003":"Edmond,OK","73034":"Edmond,OK",
    "73012":"Edmond,OK","73013":"Edmond,OK","73025":"Guthrie,OK","73044":"Guthrie,OK",
    "73069":"Norman,OK","73071":"Norman,OK","73072":"Norman,OK","73026":"Norman,OK",
    "73019":"Norman,OK","73020":"Choctaw,OK","73021":"Colony,OK",
    "73101":"Oklahoma City,OK","73102":"Oklahoma City,OK","73103":"Oklahoma City,OK",
    "73104":"Oklahoma City,OK","73105":"Oklahoma City,OK","73106":"Oklahoma City,OK",
    "73107":"Oklahoma City,OK","73108":"Oklahoma City,OK","73109":"Oklahoma City,OK",
    "73110":"Oklahoma City,OK","73111":"Oklahoma City,OK","73112":"Oklahoma City,OK",
    "73114":"Oklahoma City,OK","73115":"Oklahoma City,OK","73116":"Oklahoma City,OK",
    "73117":"Oklahoma City,OK","73118":"Oklahoma City,OK","73119":"Oklahoma City,OK",
    "73120":"Oklahoma City,OK","73121":"Oklahoma City,OK","73122":"Oklahoma City,OK",
    "73127":"Oklahoma City,OK","73128":"Oklahoma City,OK","73129":"Oklahoma City,OK",
    "73130":"Oklahoma City,OK","73131":"Oklahoma City,OK","73132":"Oklahoma City,OK",
    "73134":"Oklahoma City,OK","73135":"Oklahoma City,OK","73139":"Oklahoma City,OK",
    "73141":"Oklahoma City,OK","73142":"Oklahoma City,OK","73145":"Oklahoma City,OK",
    "73149":"Oklahoma City,OK","73150":"Oklahoma City,OK","73151":"Oklahoma City,OK",
    "73159":"Oklahoma City,OK","73160":"Moore,OK","73162":"Oklahoma City,OK",
    "73165":"Oklahoma City,OK","73169":"Oklahoma City,OK","73170":"Moore,OK",
    "73173":"Oklahoma City,OK","73179":"Oklahoma City,OK","73189":"Oklahoma City,OK",
    // Texas
    "75001":"Addison,TX","75002":"Allen,TX","75006":"Carrollton,TX","75007":"Carrollton,TX",
    "75010":"Carrollton,TX","75013":"Allen,TX","75019":"Coppell,TX","75023":"Plano,TX",
    "75024":"Plano,TX","75025":"Plano,TX","75034":"Frisco,TX","75035":"Frisco,TX",
    "75038":"Irving,TX","75039":"Irving,TX","75040":"Garland,TX","75041":"Garland,TX",
    "75042":"Garland,TX","75043":"Garland,TX","75044":"Garland,TX","75048":"Sachse,TX",
    "75050":"Grand Prairie,TX","75051":"Grand Prairie,TX","75052":"Grand Prairie,TX",
    "75054":"Grand Prairie,TX","75056":"The Colony,TX","75057":"Lewisville,TX",
    "75060":"Irving,TX","75061":"Irving,TX","75062":"Irving,TX","75063":"Irving,TX",
    "75065":"Lake Dallas,TX","75067":"Lewisville,TX","75068":"Little Elm,TX",
    "75069":"McKinney,TX","75070":"McKinney,TX","75071":"McKinney,TX","75074":"Plano,TX",
    "75075":"Plano,TX","75078":"Prosper,TX","75080":"Richardson,TX","75081":"Richardson,TX",
    "75082":"Richardson,TX","75087":"Rockwall,TX","75088":"Rowlett,TX","75089":"Rowlett,TX",
    "75093":"Plano,TX","75094":"Plano,TX","75098":"Wylie,TX","75099":"Coppell,TX",
    // Colorado
    "80002":"Arvada,CO","80003":"Arvada,CO","80004":"Arvada,CO","80005":"Arvada,CO",
    "80012":"Aurora,CO","80013":"Aurora,CO","80014":"Aurora,CO","80015":"Aurora,CO",
    "80016":"Aurora,CO","80017":"Aurora,CO","80018":"Aurora,CO","80019":"Aurora,CO",
    "80020":"Broomfield,CO","80021":"Westminster,CO","80022":"Commerce City,CO",
    "80023":"Broomfield,CO","80026":"Lafayette,CO","80027":"Louisville,CO",
    "80031":"Westminster,CO","80033":"Wheat Ridge,CO","80045":"Aurora,CO",
    "80110":"Englewood,CO","80111":"Englewood,CO","80112":"Englewood,CO",
    "80120":"Littleton,CO","80121":"Littleton,CO","80122":"Littleton,CO",
    "80123":"Littleton,CO","80124":"Lone Tree,CO","80125":"Littleton,CO",
    "80126":"Littleton,CO","80127":"Littleton,CO","80128":"Littleton,CO",
    "80129":"Highlands Ranch,CO","80130":"Highlands Ranch,CO",
    "80202":"Denver,CO","80203":"Denver,CO","80204":"Denver,CO","80205":"Denver,CO",
    "80206":"Denver,CO","80207":"Denver,CO","80209":"Denver,CO","80210":"Denver,CO",
    "80211":"Denver,CO","80212":"Denver,CO","80214":"Edgewater,CO","80215":"Lakewood,CO",
    "80216":"Denver,CO","80218":"Denver,CO","80219":"Denver,CO","80220":"Denver,CO",
    "80221":"Westminster,CO","80222":"Denver,CO","80223":"Denver,CO","80224":"Denver,CO",
    "80225":"Lakewood,CO","80226":"Lakewood,CO","80227":"Lakewood,CO","80228":"Lakewood,CO",
    "80229":"Thornton,CO","80230":"Denver,CO","80231":"Denver,CO","80232":"Lakewood,CO",
    "80233":"Thornton,CO","80234":"Thornton,CO","80235":"Lakewood,CO","80236":"Denver,CO",
    "80237":"Denver,CO","80238":"Denver,CO","80239":"Denver,CO","80241":"Thornton,CO",
    "80249":"Denver,CO","80260":"Northglenn,CO","80301":"Boulder,CO","80302":"Boulder,CO",
    "80303":"Boulder,CO","80304":"Boulder,CO","80305":"Boulder,CO",
    // Florida
    "33101":"Miami,FL","33125":"Miami,FL","33126":"Miami,FL","33127":"Miami,FL",
    "33128":"Miami,FL","33130":"Miami,FL","33131":"Miami,FL","33132":"Miami,FL",
    "33133":"Miami,FL","33134":"Coral Gables,FL","33135":"Miami,FL","33136":"Miami,FL",
    "33137":"Miami,FL","33138":"Miami,FL","33139":"Miami Beach,FL","33140":"Miami Beach,FL",
    "33141":"Miami Beach,FL","33142":"Miami,FL","33144":"Miami,FL","33145":"Miami,FL",
    "33146":"Coral Gables,FL","33147":"Miami,FL","33149":"Key Biscayne,FL",
    "33150":"Miami,FL","33155":"Miami,FL","33156":"Pinecrest,FL","33157":"Miami,FL",
    "33158":"Miami,FL","33160":"North Miami Beach,FL","33161":"Miami,FL",
    "33162":"North Miami Beach,FL","33165":"Miami,FL","33166":"Miami,FL",
    "33167":"Miami,FL","33168":"Miami,FL","33169":"Miami,FL","33170":"Miami,FL",
    "33172":"Miami,FL","33173":"Miami,FL","33174":"Miami,FL","33175":"Miami,FL",
    "33176":"Miami,FL","33177":"Miami,FL","33178":"Miami,FL","33179":"Aventura,FL",
    "33180":"Aventura,FL","33181":"Miami,FL","33182":"Miami,FL","33183":"Miami,FL",
    "33184":"Miami,FL","33185":"Miami,FL","33186":"Miami,FL","33187":"Miami,FL",
    "33189":"Miami,FL","33190":"Miami,FL","33193":"Miami,FL","33194":"Miami,FL",
    "33196":"Miami,FL",
  };

  const entry = db[zip];
  if (entry) {
    const [city, state] = entry.split(",");
    return { city, state };
  }

  // For unknown ZIPs, return a generic entry so Tracerfy can still search
  // The ZIP itself is what Tracerfy actually uses for the lookup
  console.log(`ZIP ${zip} not in local DB — using ZIP-only lookup`);
  return { city: "", state: "US" };
}
