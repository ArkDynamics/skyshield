// api/weather-scan.js
// Proxies WeatherAPI and NOAA Storm Events calls server-side.
// Handles storm detection with full detail extraction:
// hail size, wind speed, tornado magnitude, hurricane category etc.

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { action, apiKey, zip, lat, lng, state, county } = req.body;

  // ── ACTION: scan current alerts for a ZIP ────────────────────────────────
  if (action === "scan_alerts") {
    if (!apiKey || !zip) return res.status(400).json({ error: "apiKey and zip required" });
    try {
      const url = `https://api.weatherapi.com/v1/forecast.json?key=${apiKey}&q=${zip}&days=1&alerts=yes&aqi=no`;
      const r = await fetch(url);
      const data = await r.json();
      if (data.error) return res.status(400).json({ error: data.error.message });

      const alerts = (data.alerts?.alert || []);
      const current = data.current || {};
      const location = data.location || {};

      // Extract structured storm events from alerts
      const storms = [];
      for (const alert of alerts) {
        const parsed = parseAlert(alert, zip, location);
        if (parsed) storms.push(parsed);
      }

      // Also check current conditions for severe weather thresholds
      const currentStorm = checkCurrentConditions(current, zip, location);
      if (currentStorm) storms.push(currentStorm);

      return res.json({ storms, location, current, rawAlerts: alerts });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // ── ACTION: fetch NOAA historical storm events ───────────────────────────
  if (action === "noaa_history") {
    // NOAA Storm Events API — free, no key needed
    // Returns storm events for a given state and date range
    const { state: st, beginDate, endDate } = req.body;
    if (!st) return res.status(400).json({ error: "state required" });

    const begin = beginDate || formatDate(new Date(Date.now() - 90 * 86400000)); // 90 days ago
    const end   = endDate   || formatDate(new Date());

    try {
      // NOAA SWDI API — Severe Weather Data Inventory
      const url = `https://www.ncdc.noaa.gov/swdiws/json/nx3hail/${begin}:${end}?area=${st}`;
      const r = await fetch(url, { headers: { "Accept": "application/json" } });

      if (!r.ok) {
        // Fallback: try NOAA storm events CSV API
        return res.json({ events: [], note: "NOAA data unavailable — try again or check state code" });
      }

      const data = await r.json();
      const events = (data.data || []).map(e => ({
        type: "Hail",
        date: e.ZTIME?.split("T")[0] || begin,
        size: e.SIZE ? `${(parseInt(e.SIZE)/100).toFixed(2)}" diameter` : "Unknown size",
        location: e.LON && e.LAT ? `${e.LAT}, ${e.LON}` : st,
        severity: hailSeverity(e.SIZE),
        source: "NOAA SWDI",
      }));

      return res.json({ events });
    } catch (err) {
      return res.json({ events: [], note: "NOAA request failed: " + err.message });
    }
  }

  // ── ACTION: fetch NOAA storm events for a specific ZIP area ─────────────
  if (action === "noaa_zip_history") {
    const { zip: z } = req.body;
    if (!z) return res.status(400).json({ error: "zip required" });

    try {
      // Use weather.gov API to get county/zone for ZIP, then pull storm events
      const geoUrl = `https://api.weather.gov/points/${lat || 32.7767},${lng || -96.7970}`;
      const geoRes = await fetch(geoUrl, { headers: { "User-Agent": "SkyShieldPro/1.0" } });
      const geoData = await geoRes.json();

      const county = geoData.properties?.county?.split("/").pop() || "";
      const state  = geoData.properties?.relativeLocation?.properties?.state || "";

      if (!county) return res.json({ events: [], note: "Could not resolve county for ZIP" });

      // Pull active NWS alerts for this zone
      const alertUrl = `https://api.weather.gov/alerts/active?zone=${county}`;
      const alertRes = await fetch(alertUrl, { headers: { "User-Agent": "SkyShieldPro/1.0" } });
      const alertData = await alertRes.json();

      const events = (alertData.features || []).map(f => {
        const props = f.properties || {};
        return parseNWSAlert(props, z);
      }).filter(Boolean);

      return res.json({ events, county, state });
    } catch (err) {
      return res.json({ events: [], note: err.message });
    }
  }

  return res.status(400).json({ error: "Unknown action" });
}

// ── HELPERS ─────────────────────────────────────────────────────────────────

function formatDate(d) {
  return d.toISOString().split("T")[0].replace(/-/g, "");
}

function parseAlert(alert, zip, location) {
  const headline = (alert.headline || "").toLowerCase();
  const desc     = (alert.desc || alert.description || "").toLowerCase();
  const full     = headline + " " + desc;

  // Hail detection
  const hailMatch = full.match(/hail(?:\s+up\s+to)?\s+[\w\s]*?(\d+(?:\.\d+)?)\s*(?:inch|in\b|")/i)
    || full.match(/(\d+(?:\.\d+)?)\s*(?:inch|in\b|")\s*hail/i);

  // Wind detection
  const windMatch = full.match(/wind(?:s)?\s+(?:up\s+to\s+|gusts?\s+(?:up\s+to\s+)?)?(\d+)\s*(?:mph|m\.p\.h)/i)
    || full.match(/(\d+)\s*mph\s*(?:wind|gust)/i);

  // Tornado
  const isTornado = full.includes("tornado");
  const tornadoEF = full.match(/ef[\s-]?(\d)/i);

  // Hurricane
  const isHurricane = full.includes("hurricane") || full.includes("tropical storm");
  const hurricaneCat = full.match(/category\s+(\d)/i);

  // Filter: only include if meets our thresholds
  const hailSize    = hailMatch ? parseFloat(hailMatch[1]) : null;
  const windSpeed   = windMatch ? parseInt(windMatch[1])   : null;
  const hasTornado  = isTornado;
  const hasHurricane= isHurricane;

  const qualifies =
    (hailSize !== null) ||                // Any hail, regardless of size
    (windSpeed && windSpeed >= 50) ||     // 50mph+ winds
    hasTornado ||
    hasHurricane ||
    full.includes("severe thunderstorm") ||
    full.includes("flash flood") ||
    full.includes("hail");

  if (!qualifies) return null;

  // Determine storm type and severity
  let type = "Severe Weather";
  let severity = "moderate";
  let detail = {};

  if (hasTornado) {
    type = "Tornado";
    severity = "extreme";
    detail = { efRating: tornadoEF ? "EF"+tornadoEF[1] : "Unknown", description: alert.headline };
  } else if (hasHurricane) {
    type = "Hurricane";
    severity = "extreme";
    detail = { category: hurricaneCat ? "Cat "+hurricaneCat[1] : "Tropical Storm", description: alert.headline };
  } else if (hailSize) {
    type = "Hail";
    severity = hailSize >= 2 ? "extreme" : hailSize >= 1 ? "severe" : "moderate";
    detail = { hailSize: `${hailSize}"`, hailDescription: hailSizeLabel(hailSize) };
  } else if (windSpeed) {
    type = "High Wind";
    severity = windSpeed >= 75 ? "extreme" : windSpeed >= 60 ? "severe" : "moderate";
    detail = { windSpeed: `${windSpeed} mph`, windDescription: windLabel(windSpeed) };
  } else if (full.includes("flash flood")) {
    type = "Flash Flood";
    severity = "severe";
    detail = {};
  } else {
    type = "Severe Thunderstorm";
    severity = "moderate";
    detail = {};
  }

  return {
    id: "s" + Date.now() + Math.random().toString(36).slice(2),
    type,
    severity,
    zip,
    location: location.name || zip,
    date: new Date().toISOString().split("T")[0],
    headline: alert.headline || type,
    detail,
    expires: alert.expires,
    source: "WeatherAPI",
    processed: false,
    lat: location.lat || null,
    lng: location.lon || null,
  };
}

function parseNWSAlert(props, zip) {
  const event = props.event || "";
  const desc  = (props.description || "").toLowerCase();
  const full  = event.toLowerCase() + " " + desc;

  const qualifyingEvents = [
    "tornado warning", "tornado watch", "severe thunderstorm warning",
    "hurricane warning", "hurricane watch", "tropical storm warning",
    "high wind warning", "flash flood warning", "winter storm warning",
  ];

  if (!qualifyingEvents.some(e => full.includes(e))) return null;

  const hailMatch = desc.match(/hail\s+(?:up\s+to\s+)?(\d+(?:\.\d+)?)\s*(?:inch|in\b|")/i);
  const windMatch = desc.match(/wind(?:s|gusts?)?\s+(?:up\s+to\s+)?(\d+)\s*mph/i);
  const efMatch   = desc.match(/ef[\s-]?(\d)/i);

  return {
    id: "nws" + Date.now() + Math.random().toString(36).slice(2),
    type: event,
    severity: full.includes("tornado warning") || full.includes("hurricane warning") ? "extreme" : "severe",
    zip,
    location: props.areaDesc || zip,
    date: (props.sent || new Date().toISOString()).split("T")[0],
    headline: props.headline || event,
    detail: {
      hailSize: hailMatch ? `${hailMatch[1]}"` : null,
      windSpeed: windMatch ? `${windMatch[1]} mph` : null,
      efRating: efMatch ? "EF"+efMatch[1] : null,
    },
    expires: props.expires,
    source: "NWS",
    processed: false,
    lat: null, lng: null,
  };
}

function checkCurrentConditions(current, zip, location) {
  // Flag extreme current conditions even without a formal alert
  const wind = current.wind_mph || 0;
  const gust = current.gust_mph || 0;
  const condition = (current.condition?.text || "").toLowerCase();

  const maxWind = Math.max(wind, gust);
  if (maxWind < 50 && !condition.includes("tornado") && !condition.includes("hurricane")) return null;

  return {
    id: "cond" + Date.now(),
    type: condition.includes("tornado") ? "Tornado" : condition.includes("hurricane") ? "Hurricane" : "High Wind",
    severity: maxWind >= 75 ? "extreme" : "severe",
    zip,
    location: location.name || zip,
    date: new Date().toISOString().split("T")[0],
    headline: `Current conditions: ${current.condition?.text} — ${maxWind.toFixed(0)} mph winds`,
    detail: { windSpeed: `${maxWind.toFixed(0)} mph` },
    source: "WeatherAPI Current",
    processed: false,
    lat: location.lat || null,
    lng: location.lon || null,
  };
}

function hailSeverity(sizeHundredths) {
  const inches = parseInt(sizeHundredths) / 100;
  if (inches >= 2)   return "extreme";
  if (inches >= 1)   return "severe";
  return "moderate";
}

function hailSizeLabel(inches) {
  if (inches >= 4)   return "Grapefruit (4\"+)";
  if (inches >= 2.75)return "Baseball (2.75\")";
  if (inches >= 1.75)return "Golf Ball (1.75\")";
  if (inches >= 1.5) return "Ping Pong Ball (1.5\")";
  if (inches >= 1)   return "Quarter (1\")";
  if (inches >= 0.75)return "Penny (0.75\")";
  return `${inches}" diameter`;
}

function windLabel(mph) {
  if (mph >= 113) return "EF1+ Tornado-force";
  if (mph >= 75)  return "Hurricane-force";
  if (mph >= 58)  return "Severe (damage likely)";
  return "High wind (roof risk)";
}
