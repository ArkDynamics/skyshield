// api/lead-builder.js
// Pulls homeowner leads for a ZIP using Tracerfy MCP via Claude.
// No API key guessing — Claude calls Tracerfy tools directly via MCP.

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const TRACERFY_MCP  = "https://mcp.tracerfy.com/u/trmcp_RLsGh7-BMtn8Nwu2MWY-HMiDYtpJdfjg2df2iMfUEA4/mcp";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { action, zip, jobId } = req.body || {};

  if (!ANTHROPIC_KEY) return res.status(500).json({ error: "ANTHROPIC_API_KEY not set" });

  // ── ACTION: diagnose / list available Tracerfy tools ─────────────────────
  if (action === "diagnose") {
    try {
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": ANTHROPIC_KEY,
          "anthropic-version": "2023-06-01",
          "anthropic-beta": "mcp-client-2025-04-04",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
          max_tokens: 1024,
          mcp_servers: [{ type: "url", url: TRACERFY_MCP, name: "tracerfy" }],
          messages: [{ role: "user", content: "List all available tools you have access to from Tracerfy. What can you do?" }],
        }),
      });
      const data = await r.json();
      const text = data.content?.filter(b => b.type === "text").map(b => b.text).join("\n") || "";
      const tools = data.content?.filter(b => b.type === "tool_use").map(b => b.name) || [];
      return res.json({ success: true, tools, response: text.slice(0, 500), raw: data.content?.slice(0,3) });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // ── ACTION: build leads for a ZIP ────────────────────────────────────────
  if (action === "build_leads" || action === "get_addresses") {
    if (!zip) return res.status(400).json({ error: "zip required" });

    try {
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": ANTHROPIC_KEY,
          "anthropic-version": "2023-06-01",
          "anthropic-beta": "mcp-client-2025-04-04",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
          max_tokens: 4096,
          mcp_servers: [{ type: "url", url: TRACERFY_MCP, name: "tracerfy" }],
          messages: [{
            role: "user",
            content: `Use Tracerfy to find residential homeowner leads for ZIP code ${zip}.
Pull as many homeowners as possible — I need their full name, phone number, and address.
Return ONLY a JSON array with no other text, in this exact format:
[{"homeowner":"Full Name","phone":"555-123-4567","address":"123 Main St","zip":"${zip}"},...]
If there are no results return an empty array: []`,
          }],
        }),
      });

      const data = await r.json();
      console.log("Tracerfy MCP response status:", r.status);
      console.log("Content blocks:", data.content?.map(b => b.type).join(", "));

      if (!r.ok) {
        return res.status(500).json({ error: data.error?.message || "Anthropic API error", detail: data });
      }

      // Extract text content
      const textBlocks = (data.content || []).filter(b => b.type === "text");
      const fullText = textBlocks.map(b => b.text).join("\n");

      // Parse JSON array from response
      const jsonMatch = fullText.match(/\[[\s\S]*\]/);
      if (!jsonMatch) {
        console.log("No JSON array in response:", fullText.slice(0, 500));
        // Maybe Tracerfy returned tool results directly
        const toolResults = (data.content || []).filter(b => b.type === "tool_result" || b.type === "mcp_tool_result");
        if (toolResults.length) {
          return res.json({ success: true, zip, leads: [], raw: toolResults, message: "Got tool results but couldn't parse leads — check raw" });
        }
        return res.json({ success: true, zip, leads: [], message: "No leads found for ZIP " + zip + ". Response: " + fullText.slice(0, 200) });
      }

      let leads = [];
      try {
        const parsed = JSON.parse(jsonMatch[0]);
        leads = parsed.filter(l => l.phone && l.homeowner).map(l => ({
          homeowner: l.homeowner || l.name || "Unknown",
          phone: formatPhone(l.phone),
          email: l.email || null,
          address: l.address || "",
          city: l.city || "",
          state: l.state || "",
          zip: l.zip || zip,
        }));
      } catch (e) {
        console.error("JSON parse failed:", e.message);
        return res.json({ success: false, zip, leads: [], error: "Could not parse Tracerfy results" });
      }

      console.log(`✓ ZIP ${zip}: ${leads.length} leads from Tracerfy MCP`);
      return res.json({ success: true, zip, leads, count: leads.length });

    } catch (err) {
      console.error("build_leads error:", err);
      return res.status(500).json({ error: err.message });
    }
  }

  // ── ACTION: poll (not needed with MCP — sync response) ───────────────────
  if (action === "poll" || action === "get_batch_results") {
    return res.json({ status: "complete", leads: [], message: "MCP returns results synchronously — no polling needed" });
  }

  return res.status(400).json({ error: `Unknown action: ${action}` });
}

function formatPhone(raw) {
  const d = String(raw || "").replace(/\D/g, "");
  if (d.length === 10) return `${d.slice(0,3)}-${d.slice(3,6)}-${d.slice(6)}`;
  if (d.length === 11 && d[0] === "1") return `${d.slice(1,4)}-${d.slice(4,7)}-${d.slice(7)}`;
  return raw;
}
