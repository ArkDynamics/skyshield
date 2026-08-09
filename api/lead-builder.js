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
            content: `Use your Tracerfy tools to find residential homeowner leads in ZIP code ${zip}. Limit to 25 results maximum to control costs. I need each person's full name, phone number, and street address. Return ONLY a raw JSON array, no other text:
[{"homeowner":"Full Name","phone":"555-123-4567","address":"123 Main St","zip":"${zip}"}]
If no results, return: []`,
          }],
        }),
      });

      const data = await r.json();
      console.log("MCP status:", r.status);
      console.log("Content types:", JSON.stringify((data.content||[]).map(b=>({type:b.type,name:b.name||undefined}))));

      if (!r.ok) {
        return res.status(500).json({ error: data.error?.message || "Anthropic API error", detail: data });
      }

      // Collect all content — text, tool results, MCP tool results
      const allText = [];
      const toolResults = [];

      for (const block of (data.content || [])) {
        if (block.type === "text") {
          allText.push(block.text);
        }
        if (block.type === "tool_result" || block.type === "mcp_tool_result") {
          const content = block.content;
          if (Array.isArray(content)) {
            for (const c of content) {
              if (c.type === "text") toolResults.push(c.text);
            }
          } else if (typeof content === "string") {
            toolResults.push(content);
          }
        }
      }

      const fullText = [...allText, ...toolResults].join("\n");
      console.log("Full text (first 500):", fullText.slice(0, 500));

      // Try to parse JSON array from anywhere in the response
      const jsonMatch = fullText.match(/\[[\s\S]*?\]/);
      if (jsonMatch) {
        try {
          const parsed = JSON.parse(jsonMatch[0]);
          if (Array.isArray(parsed) && parsed.length > 0) {
            const leads = parsed
              .filter(l => l.phone || l.homeowner || l.name)
              .map(l => ({
                homeowner: l.homeowner || l.name || l.owner || `${l.first_name||""} ${l.last_name||""}`.trim() || "Unknown",
                phone: formatPhone(l.phone || l.phone_number || ""),
                email: l.email || null,
                address: l.address || l.street || "",
                city: l.city || "",
                state: l.state || "",
                zip: l.zip || l.zip_code || zip,
              }))
              .filter(l => l.phone && l.homeowner !== "Unknown");

            console.log(`✓ Parsed ${leads.length} leads from JSON`);
            return res.json({ success: true, zip, leads, count: leads.length });
          }
        } catch (e) {
          console.error("JSON parse error:", e.message);
        }
      }

      // No structured JSON — return raw so we can inspect what Tracerfy actually sent
      console.log("No JSON array found. Full response:", fullText.slice(0, 1000));
      return res.json({
        success: false,
        zip,
        leads: [],
        debug: {
          contentTypes: (data.content||[]).map(b => b.type),
          textSample: fullText.slice(0, 800),
          stopReason: data.stop_reason,
        },
        error: "Tracerfy returned data but it couldn't be parsed. See debug field for raw response.",
      });

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
