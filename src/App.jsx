import { useState, useEffect, useRef } from "react";

// ─── FONTS ───────────────────────────────────────────────────────────────────
const FontLoader = () => (
  <style>{`
    @import url('https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700;800&family=Syne:wght@400;600;700;800&display=swap');
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { background: #06080f; color: #e2e8f0; font-family: 'Outfit', sans-serif; }
    ::-webkit-scrollbar { width: 4px; height: 4px; }
    ::-webkit-scrollbar-track { background: #0d1117; }
    ::-webkit-scrollbar-thumb { background: #f97316; border-radius: 2px; }
    input, select, textarea { font-family: 'Outfit', sans-serif; }
    * { transition: background-color 0.15s ease, border-color 0.15s ease, opacity 0.15s ease; }
  `}</style>
);

// ─── DESIGN TOKENS ───────────────────────────────────────────────────────────
const C = {
  bg: "#06080f",
  card: "rgba(255,255,255,0.03)",
  cardHover: "rgba(255,255,255,0.055)",
  border: "rgba(255,255,255,0.07)",
  borderHover: "rgba(249,115,22,0.4)",
  orange: "#f97316",
  orangeDim: "rgba(249,115,22,0.15)",
  green: "#22c55e",
  greenDim: "rgba(34,197,94,0.15)",
  red: "#ef4444",
  redDim: "rgba(239,68,68,0.15)",
  blue: "#3b82f6",
  blueDim: "rgba(59,130,246,0.15)",
  yellow: "#eab308",
  yellowDim: "rgba(234,179,8,0.15)",
  purple: "#a855f7",
  text: "#e2e8f0",
  textMuted: "#64748b",
  textDim: "#94a3b8",
};

// ─── DEMO DATA ────────────────────────────────────────────────────────────────
const INIT_ROOFERS = [
  {
    id: "r1", name: "Apex Roofing Co", owner: "Marcus Holt", email: "marcus@apexroofing.com",
    phone: "972-555-0101", plan: "Pro", status: "active",
    territories: ["75023","75024","75025"], revenue: 57000, leads: 42, booked: 18,
    inspectors: [
      { id: "i1", name: "Jake Torres", phone: "972-555-0201", zones: ["75023","75024"] },
      { id: "i2", name: "Priya Shah", phone: "972-555-0202", zones: ["75025"] },
    ],
    inspections: [
      { id: "ins1", client: "Robert Chen", address: "1204 Oak Ln, Plano TX 75023", date: "2025-06-15", time: "9:00 AM", inspector: "Jake Torres", status: "scheduled" },
      { id: "ins2", client: "Linda Park", address: "876 Elm St, Plano TX 75024", date: "2025-06-16", time: "11:00 AM", inspector: "Priya Shah", status: "scheduled" },
    ],
  },
  {
    id: "r2", name: "Summit Storm Pros", owner: "Diane Reeves", email: "diane@summitstorm.com",
    phone: "972-555-0102", plan: "Starter", status: "active",
    territories: ["75034","75035"], revenue: 24000, leads: 19, booked: 8,
    inspectors: [
      { id: "i3", name: "Carl Watts", phone: "972-555-0203", zones: ["75034","75035"] },
    ],
    inspections: [
      { id: "ins3", client: "Amy Johnson", address: "543 Maple Ave, Frisco TX 75034", date: "2025-06-17", time: "2:00 PM", inspector: "Carl Watts", status: "scheduled" },
    ],
  },
  {
    id: "r3", name: "Ironclad Roofing", owner: "Steve Nolan", email: "steve@ironcladroofing.com",
    phone: "972-555-0103", plan: "Pro", status: "trial",
    territories: ["75002","75013"], revenue: 6000, leads: 7, booked: 2,
    inspectors: [
      { id: "i4", name: "Monica Ruiz", phone: "972-555-0204", zones: ["75002","75013"] },
    ],
    inspections: [],
  },
];

const INIT_STORMS = [
  { id: "s1", type: "Hail", location: "Plano, TX", zip: "75023", severity: "severe", date: "2025-06-12", processed: false },
  { id: "s2", type: "Tornado", location: "Frisco, TX", zip: "75034", severity: "extreme", date: "2025-06-13", processed: false },
  { id: "s3", type: "Wind", location: "Allen, TX", zip: "75013", severity: "moderate", date: "2025-06-14", processed: true },
];

const INIT_LEADS = [
  { id: "l1", homeowner: "Robert Chen", phone: "972-555-1001", zip: "75023", rooferId: "r1", stormType: "Hail", status: "scheduled" },
  { id: "l2", homeowner: "Linda Park", phone: "972-555-1002", zip: "75024", rooferId: "r1", stormType: "Hail", status: "contacted" },
  { id: "l3", homeowner: "Tom Wiley", phone: "972-555-1003", zip: "75025", rooferId: "r1", stormType: "Hail", status: "pending" },
  { id: "l4", homeowner: "Amy Johnson", phone: "972-555-1004", zip: "75034", rooferId: "r2", stormType: "Tornado", status: "scheduled" },
  { id: "l5", homeowner: "Gary Foster", phone: "972-555-1005", zip: "75035", rooferId: "r2", stormType: "Tornado", status: "pending" },
  { id: "l6", homeowner: "Nina Ortiz", phone: "972-555-1006", zip: "75002", rooferId: "r3", stormType: "Wind", status: "pending" },
  { id: "l7", homeowner: "Brian Cox", phone: "972-555-1007", zip: "75013", rooferId: "r3", stormType: "Wind", status: "contacted" },
];

const PLAN_PRICES = { Starter: 297, Pro: 497, Elite: 997 };
const PLAN_COLORS = { Starter: C.blue, Pro: C.orange, Elite: C.purple, Trial: C.yellow };

// ─── REUSABLE UI COMPONENTS ───────────────────────────────────────────────────

const s = {
  h: (x) => ({ fontFamily: "'Syne', sans-serif", ...x }),
  flex: (gap=0, align="center", justify="flex-start") => ({ display:"flex", alignItems:align, justifyContent:justify, gap }),
  card: (extra={}) => ({
    background: C.card, border: `1px solid ${C.border}`, borderRadius: 12,
    padding: 20, ...extra,
  }),
};

function Badge({ label, color=C.orange, small }) {
  return (
    <span style={{
      display:"inline-block", padding: small ? "2px 8px" : "3px 10px",
      borderRadius: 20, fontSize: small ? 10 : 11, fontWeight: 600,
      background: color + "22", color, border: `1px solid ${color}44`,
      letterSpacing: "0.05em", textTransform: "uppercase",
    }}>{label}</span>
  );
}

function Btn({ children, variant="default", onClick, style={}, disabled, small }) {
  const variants = {
    default: { bg: "rgba(255,255,255,0.06)", color: C.text, border: C.border },
    primary:  { bg: C.orange, color: "#000", border: C.orange },
    success:  { bg: C.green, color: "#000", border: C.green },
    danger:   { bg: C.red, color: "#fff", border: C.red },
    info:     { bg: C.blue, color: "#fff", border: C.blue },
    ghost:    { bg: "transparent", color: C.textDim, border: "transparent" },
  };
  const v = variants[variant] || variants.default;
  return (
    <button onClick={onClick} disabled={disabled} style={{
      background: v.bg, color: v.color, border: `1px solid ${v.border}`,
      borderRadius: 8, padding: small ? "4px 12px" : "8px 16px",
      fontSize: small ? 12 : 13, fontWeight: 600, cursor: disabled ? "not-allowed" : "pointer",
      opacity: disabled ? 0.5 : 1, fontFamily: "'Outfit', sans-serif",
      whiteSpace: "nowrap", ...style,
    }}>{children}</button>
  );
}

function Input({ label, value, onChange, type="text", placeholder, style={} }) {
  return (
    <div style={{ display:"flex", flexDirection:"column", gap: 6 }}>
      {label && <label style={{ fontSize: 12, color: C.textDim, fontWeight: 500 }}>{label}</label>}
      <input type={type} value={value} onChange={e=>onChange(e.target.value)} placeholder={placeholder}
        style={{
          background:"rgba(255,255,255,0.04)", border:`1px solid ${C.border}`,
          borderRadius: 8, padding: "9px 12px", color: C.text, fontSize: 13,
          outline:"none", width:"100%", ...style,
        }} />
    </div>
  );
}

function Select({ label, value, onChange, options, style={} }) {
  return (
    <div style={{ display:"flex", flexDirection:"column", gap: 6 }}>
      {label && <label style={{ fontSize: 12, color: C.textDim, fontWeight: 500 }}>{label}</label>}
      <select value={value} onChange={e=>onChange(e.target.value)}
        style={{
          background:"#0d1117", border:`1px solid ${C.border}`,
          borderRadius: 8, padding: "9px 12px", color: C.text, fontSize: 13,
          outline:"none", width:"100%", ...style,
        }}>
        {options.map(o => <option key={o.value||o} value={o.value||o}>{o.label||o}</option>)}
      </select>
    </div>
  );
}

function StatCard({ label, value, sub, color=C.orange, icon }) {
  return (
    <div style={{ ...s.card(), flex:1, minWidth: 140 }}>
      <div style={{ fontSize: 11, color: C.textMuted, fontWeight: 500, textTransform:"uppercase", letterSpacing:"0.08em", marginBottom: 8 }}>{label}</div>
      <div style={{ ...s.h({ fontSize: 28, fontWeight: 800, color }), lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: C.textDim, marginTop: 6 }}>{sub}</div>}
    </div>
  );
}

function Tabs({ tabs, active, onChange }) {
  return (
    <div style={{ ...s.flex(4), borderBottom: `1px solid ${C.border}`, marginBottom: 20, paddingBottom: 0 }}>
      {tabs.map(t => (
        <button key={t} onClick={()=>onChange(t)} style={{
          background:"none", border:"none", cursor:"pointer",
          padding:"10px 16px", fontSize: 13, fontWeight: active===t ? 700 : 400,
          color: active===t ? C.orange : C.textDim,
          borderBottom: active===t ? `2px solid ${C.orange}` : "2px solid transparent",
          fontFamily:"'Outfit',sans-serif", marginBottom: -1,
        }}>{t}</button>
      ))}
    </div>
  );
}

function Modal({ title, onClose, children, wide }) {
  return (
    <div style={{
      position:"fixed", inset:0, background:"rgba(0,0,0,0.75)", zIndex: 1000,
      display:"flex", alignItems:"center", justifyContent:"center", padding: 20,
    }} onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div style={{
        background:"#0d1117", border:`1px solid ${C.border}`, borderRadius: 16,
        width: wide ? 640 : 460, maxHeight:"85vh", overflow:"auto",
        boxShadow:"0 25px 80px rgba(0,0,0,0.6)",
      }}>
        <div style={{ ...s.flex(0,"center","space-between"), padding:"18px 24px", borderBottom:`1px solid ${C.border}` }}>
          <span style={s.h({ fontSize: 16, fontWeight: 700 })}>{title}</span>
          <button onClick={onClose} style={{ background:"none", border:"none", color: C.textMuted, cursor:"pointer", fontSize: 20, lineHeight:1 }}>×</button>
        </div>
        <div style={{ padding: 24 }}>{children}</div>
      </div>
    </div>
  );
}

function SeverityBadge({ severity }) {
  const map = { extreme: C.red, severe: C.orange, moderate: C.yellow };
  return <Badge label={severity} color={map[severity]||C.blue} />;
}

function StatusBadge({ status }) {
  const map = { active: C.green, trial: C.yellow, cancelled: C.red, pending: C.orange, contacted: C.blue, scheduled: C.green };
  return <Badge label={status} color={map[status]||C.textDim} />;
}

// ─── MINI BAR CHART ───────────────────────────────────────────────────────────
function MiniBarChart({ data }) {
  const max = Math.max(...data.map(d=>d.value), 1);
  return (
    <div style={{ ...s.flex(8,"flex-end"), height: 80 }}>
      {data.map((d,i) => (
        <div key={i} style={{ ...s.flex(2,"flex-end","center"), flexDirection:"column", flex:1 }}>
          <div style={{
            width: "70%", background: C.orange,
            height: `${(d.value/max)*64}px`, borderRadius: "3px 3px 0 0",
            opacity: 0.7 + 0.3*(d.value/max),
          }} />
          <div style={{ fontSize: 9, color: C.textMuted, marginTop: 4, textAlign:"center" }}>{d.label}</div>
        </div>
      ))}
    </div>
  );
}

// ─── API HELPERS ──────────────────────────────────────────────────────────────
async function callClaude(apiKey, messages, system="", max_tokens=700) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens,
      system: system || undefined,
      messages,
    }),
  });
  const data = await res.json();
  return data.content?.map(b=>b.text||"").join("") || "No response";
}

async function sendTwilioSMS(creds, to, body) {
  const { sid, token, from } = creds;
  const encoded = btoa(`${sid}:${token}`);
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: "POST",
    headers: { "Authorization": `Basic ${encoded}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ To: to, From: from, Body: body }),
  });
  return res.json();
}

async function fetchWeatherAlerts(apiKey, zip) {
  const res = await fetch(`https://api.weatherapi.com/v1/alerts.json?key=${apiKey}&q=${zip}`);
  return res.json();
}

// ─── GOOGLE CALENDAR REFRESH TOKEN HELPER ────────────────────────────────────
let _gcalAccessToken = null;
let _gcalTokenExpiry = 0;

async function getGCalAccessToken(creds) {
  const { clientId, clientSecret, refreshToken } = creds;
  if (!clientId || !clientSecret || !refreshToken) throw new Error("Missing Google Calendar credentials");
  if (_gcalAccessToken && Date.now() < _gcalTokenExpiry - 60000) return _gcalAccessToken;
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error_description || data.error);
  _gcalAccessToken = data.access_token;
  _gcalTokenExpiry = Date.now() + (data.expires_in * 1000);
  return _gcalAccessToken;
}

async function addGCalEvent(creds, event) {
  const token = await getGCalAccessToken(creds);
  const res = await fetch("https://www.googleapis.com/calendar/v3/calendars/primary/events", {
    method: "POST",
    headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(event),
  });
  return res.json();
}

async function listGCalEvents(creds) {
  const token = await getGCalAccessToken(creds);
  const now = new Date().toISOString();
  const res = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${now}&maxResults=20&singleEvents=true&orderBy=startTime`, {
    headers: { "Authorization": `Bearer ${token}` },
  });
  return res.json();
}

// ─── AI CHAT COMPONENT ────────────────────────────────────────────────────────
function AIChat({ context, apiKeys }) {
  const [msgs, setMsgs] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef(null);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior:"smooth" }); }, [msgs]);

  async function send() {
    if (!input.trim()) return;
    const userMsg = { role:"user", content: input };
    const newMsgs = [...msgs, userMsg];
    setMsgs(newMsgs);
    setInput("");
    setLoading(true);
    try {
      const reply = await callClaude(null, newMsgs, context, 700);
      setMsgs([...newMsgs, { role:"assistant", content: reply }]);
    } catch(e) {
      setMsgs([...newMsgs, { role:"assistant", content: `Error: ${e.message}` }]);
    }
    setLoading(false);
  }

  return (
    <div style={{ display:"flex", flexDirection:"column", height: 480, ...s.card() }}>
      <div style={{ flex:1, overflow:"auto", display:"flex", flexDirection:"column", gap: 12, padding: 4, marginBottom: 12 }}>
        {msgs.length===0 && (
          <div style={{ textAlign:"center", color: C.textMuted, padding: 40, fontSize: 13 }}>
            💬 Ask me anything about your storm leads, roofers, or campaigns...
          </div>
        )}
        {msgs.map((m,i) => (
          <div key={i} style={{
            padding: "10px 14px", borderRadius: 10, fontSize: 13, lineHeight: 1.6,
            background: m.role==="user" ? C.orangeDim : "rgba(255,255,255,0.04)",
            border: `1px solid ${m.role==="user" ? C.orange+"33" : C.border}`,
            alignSelf: m.role==="user" ? "flex-end" : "flex-start",
            maxWidth: "80%", whiteSpace:"pre-wrap",
          }}>{m.content}</div>
        ))}
        {loading && (
          <div style={{ padding:"10px 14px", borderRadius: 10, background:"rgba(255,255,255,0.04)", border:`1px solid ${C.border}`, alignSelf:"flex-start", fontSize: 13, color: C.textMuted }}>
            ⏳ Thinking...
          </div>
        )}
        <div ref={bottomRef} />
      </div>
      <div style={{ ...s.flex(8), borderTop:`1px solid ${C.border}`, paddingTop: 12 }}>
        <input value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>e.key==="Enter"&&!e.shiftKey&&send()}
          placeholder="Ask about storms, leads, campaigns..." style={{
            flex:1, background:"rgba(255,255,255,0.04)", border:`1px solid ${C.border}`,
            borderRadius: 8, padding:"9px 12px", color: C.text, fontSize: 13, outline:"none",
            fontFamily:"'Outfit',sans-serif",
          }} />
        <Btn variant="primary" onClick={send} disabled={loading||!input.trim()}>Send</Btn>
      </div>
    </div>
  );
}

// ─── ADD ROOFER MODAL ─────────────────────────────────────────────────────────
function AddRooferModal({ onClose, onAdd }) {
  const [form, setForm] = useState({ name:"", owner:"", email:"", phone:"", territories:"", plan:"Starter" });
  const f = (k) => (v) => setForm(p=>({...p,[k]:v}));
  function submit() {
    if (!form.name || !form.owner) return;
    onAdd({
      id: "r"+Date.now(), ...form,
      territories: form.territories.split(",").map(z=>z.trim()).filter(Boolean),
      revenue:0, leads:0, booked:0, status:"trial", inspectors:[], inspections:[],
    });
    onClose();
  }
  return (
    <Modal title="Add New Roofer" onClose={onClose}>
      <div style={{ display:"flex", flexDirection:"column", gap: 14 }}>
        <Input label="Company Name" value={form.name} onChange={f("name")} placeholder="Apex Roofing Co" />
        <Input label="Owner Name" value={form.owner} onChange={f("owner")} placeholder="John Smith" />
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap: 12 }}>
          <Input label="Email" value={form.email} onChange={f("email")} type="email" />
          <Input label="Phone" value={form.phone} onChange={f("phone")} placeholder="972-555-0100" />
        </div>
        <Input label="Territories (comma-separated ZIPs)" value={form.territories} onChange={f("territories")} placeholder="75023, 75024, 75025" />
        <Select label="Plan" value={form.plan} onChange={f("plan")} options={["Starter","Pro","Elite"]} />
        <div style={{ ...s.flex(8), justifyContent:"flex-end", marginTop: 8 }}>
          <Btn onClick={onClose}>Cancel</Btn>
          <Btn variant="primary" onClick={submit}>Add Roofer</Btn>
        </div>
      </div>
    </Modal>
  );
}

// ─── ADD INSPECTOR MODAL ──────────────────────────────────────────────────────
function AddInspectorModal({ onClose, onAdd }) {
  const [form, setForm] = useState({ name:"", phone:"", zones:"" });
  const f = (k) => (v) => setForm(p=>({...p,[k]:v}));
  function submit() {
    if (!form.name) return;
    onAdd({ id:"i"+Date.now(), ...form, zones: form.zones.split(",").map(z=>z.trim()).filter(Boolean) });
    onClose();
  }
  return (
    <Modal title="Add Inspector" onClose={onClose}>
      <div style={{ display:"flex", flexDirection:"column", gap: 14 }}>
        <Input label="Name" value={form.name} onChange={f("name")} placeholder="Jake Torres" />
        <Input label="Phone" value={form.phone} onChange={f("phone")} placeholder="972-555-0200" />
        <Input label="ZIP Zones (comma-separated)" value={form.zones} onChange={f("zones")} placeholder="75023, 75024" />
        <div style={{ ...s.flex(8), justifyContent:"flex-end", marginTop: 8 }}>
          <Btn onClick={onClose}>Cancel</Btn>
          <Btn variant="primary" onClick={submit}>Add Inspector</Btn>
        </div>
      </div>
    </Modal>
  );
}

// ─── ADD INSPECTION MODAL ─────────────────────────────────────────────────────
function AddInspectionModal({ roofer, onClose, onAdd }) {
  const [form, setForm] = useState({ client:"", address:"", date:"", time:"9:00 AM", inspector:"" });
  const f = (k) => (v) => setForm(p=>({...p,[k]:v}));
  function submit() {
    if (!form.client || !form.date) return;
    onAdd({ id:"ins"+Date.now(), ...form, status:"scheduled" });
    onClose();
  }
  const inspOptions = roofer.inspectors.map(i=>({ value: i.name, label: i.name }));
  const timeOptions = ["8:00 AM","9:00 AM","10:00 AM","11:00 AM","12:00 PM","1:00 PM","2:00 PM","3:00 PM","4:00 PM"];
  return (
    <Modal title="Add Inspection" onClose={onClose}>
      <div style={{ display:"flex", flexDirection:"column", gap: 14 }}>
        <Input label="Client Name" value={form.client} onChange={f("client")} placeholder="John Smith" />
        <Input label="Address" value={form.address} onChange={f("address")} placeholder="1234 Oak Ln, Plano TX 75023" />
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap: 12 }}>
          <Input label="Date" value={form.date} onChange={f("date")} type="date" />
          <Select label="Time" value={form.time} onChange={f("time")} options={timeOptions} />
        </div>
        <Select label="Inspector" value={form.inspector} onChange={f("inspector")} options={[{value:"",label:"Select inspector..."}, ...inspOptions]} />
        <div style={{ ...s.flex(8), justifyContent:"flex-end", marginTop: 8 }}>
          <Btn onClick={onClose}>Cancel</Btn>
          <Btn variant="primary" onClick={submit}>Schedule</Btn>
        </div>
      </div>
    </Modal>
  );
}

// ─── LEAD ROW COMPONENT ───────────────────────────────────────────────────────
function LeadRow({ lead, roofers, onSMS, onBook, showRoofer }) {
  const roofer = roofers.find(r=>r.id===lead.rooferId);
  return (
    <tr style={{ borderBottom:`1px solid ${C.border}` }}>
      <td style={{ padding:"10px 12px", fontSize:13 }}>{lead.homeowner}</td>
      <td style={{ padding:"10px 12px", fontSize:13, color:C.textDim }}>{lead.phone}</td>
      <td style={{ padding:"10px 12px", fontSize:13 }}>{lead.zip}</td>
      {showRoofer && <td style={{ padding:"10px 12px", fontSize:13 }}>{roofer?.name||"—"}</td>}
      <td style={{ padding:"10px 12px", fontSize:13 }}>{lead.stormType}</td>
      <td style={{ padding:"10px 12px" }}><StatusBadge status={lead.status} /></td>
      <td style={{ padding:"10px 12px" }}>
        <div style={s.flex(6)}>
          {lead.status==="pending" && <Btn small variant="info" onClick={()=>onSMS(lead)}>SMS</Btn>}
          {lead.status==="contacted" && <Btn small variant="success" onClick={()=>onBook(lead)}>Book</Btn>}
          {lead.status==="scheduled" && <span style={{fontSize:12,color:C.green}}>✓ Booked</span>}
        </div>
      </td>
    </tr>
  );
}

// ─── ROOFER DASHBOARD ─────────────────────────────────────────────────────────
function RooferDashboard({ roofer, leads, apiKeys, onUpdate, onBack }) {
  const [tab, setTab] = useState("Overview");
  const [showAddInspector, setShowAddInspector] = useState(false);
  const [showAddInspection, setShowAddInspection] = useState(false);
  const [leadFilter, setLeadFilter] = useState("all");
  const [newZip, setNewZip] = useState("");

  const myLeads = leads.filter(l=>l.rooferId===roofer.id);
  const pending = myLeads.filter(l=>l.status==="pending");
  const contacted = myLeads.filter(l=>l.status==="contacted");
  const scheduled = myLeads.filter(l=>l.status==="scheduled");

  const filteredLeads = leadFilter==="all" ? myLeads : myLeads.filter(l=>l.status===leadFilter);

  async function smsLead(lead) {
    const msg = await callClaude(null, [{role:"user",content:`Generate a short friendly SMS (under 160 chars) for a roofing inspection outreach to ${lead.homeowner} at ${lead.zip} after a ${lead.stormType} storm. Sign off as ${roofer.name}.`}]);
    if (apiKeys.twilio?.sid) {
      await sendTwilioSMS(apiKeys.twilio, lead.phone, msg);
    }
    onUpdate("lead_status", { leadId: lead.id, status:"contacted" });
    alert(`SMS sent to ${lead.homeowner}:\n\n${msg}`);
  }

  async function smsAllPending() {
    for (const lead of pending) { await smsLead(lead); }
  }

  function bookLead(lead) {
    const inspector = roofer.inspectors.find(i=>i.zones.includes(lead.zip)) || roofer.inspectors[0];
    const today = new Date();
    today.setDate(today.getDate()+2);
    const dateStr = today.toISOString().split("T")[0];
    onUpdate("book_lead", { leadId: lead.id, rooferId: roofer.id, inspection:{
      id:"ins"+Date.now(), client: lead.homeowner,
      address: `${lead.zip}`, date: dateStr, time:"10:00 AM",
      inspector: inspector?.name||"TBD", status:"scheduled",
    }});
  }

  const chartData = [
    { label:"Leads", value: myLeads.length },
    { label:"Contacted", value: contacted.length },
    { label:"Booked", value: scheduled.length },
    { label:"Revenue", value: Math.round(roofer.revenue/1000) },
  ];

  const groupedInspections = roofer.inspections.reduce((acc,ins)=>{
    (acc[ins.date]||(acc[ins.date]=[])).push(ins);
    return acc;
  }, {});

  const systemCtx = `You are an AI assistant for ${roofer.name}. They have ${myLeads.length} leads, ${scheduled.length} scheduled inspections, and $${roofer.revenue.toLocaleString()} revenue. Territories: ${roofer.territories.join(", ")}.`;

  return (
    <div>
      {showAddInspector && (
        <AddInspectorModal onClose={()=>setShowAddInspector(false)}
          onAdd={(insp)=>onUpdate("add_inspector",{rooferId:roofer.id,inspector:insp})} />
      )}
      {showAddInspection && (
        <AddInspectionModal roofer={roofer} onClose={()=>setShowAddInspection(false)}
          onAdd={(ins)=>onUpdate("add_inspection",{rooferId:roofer.id,inspection:ins})} />
      )}

      <Tabs tabs={["Overview","Leads","Calendar","Inspectors","Territories","AI Agent"]} active={tab} onChange={setTab} />

      {tab==="Overview" && (
        <div>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:12, marginBottom:20 }}>
            <StatCard label="Total Leads" value={myLeads.length} color={C.orange} />
            <StatCard label="Inspections" value={scheduled.length} color={C.blue} />
            <StatCard label="Conversions" value={`${myLeads.length>0?Math.round(scheduled.length/myLeads.length*100):0}%`} color={C.green} />
            <StatCard label="Revenue" value={`$${(roofer.revenue/1000).toFixed(0)}k`} color={C.purple} />
          </div>
          <div style={{ ...s.card({ marginBottom:16, padding:20 }) }}>
            <div style={s.h({fontSize:14,fontWeight:700,marginBottom:12})}>Lead Pipeline</div>
            <MiniBarChart data={chartData} />
          </div>
          <div style={s.card()}>
            <div style={s.h({fontSize:14,fontWeight:700,marginBottom:12})}>Upcoming Inspections</div>
            {roofer.inspections.length===0
              ? <div style={{color:C.textMuted,fontSize:13}}>No inspections scheduled yet.</div>
              : roofer.inspections.slice(0,5).map(ins=>(
                <div key={ins.id} style={{...s.flex(12,"center","space-between"),padding:"10px 0",borderBottom:`1px solid ${C.border}`}}>
                  <div>
                    <div style={{fontSize:13,fontWeight:600}}>{ins.client}</div>
                    <div style={{fontSize:12,color:C.textDim}}>{ins.address}</div>
                  </div>
                  <div style={{textAlign:"right"}}>
                    <div style={{fontSize:12,color:C.orange}}>{ins.date} {ins.time}</div>
                    <div style={{fontSize:12,color:C.textDim}}>{ins.inspector}</div>
                  </div>
                </div>
              ))
            }
          </div>
        </div>
      )}

      {tab==="Leads" && (
        <div>
          <div style={{...s.flex(10,"center","space-between"),marginBottom:16}}>
            <div style={s.flex(8)}>
              {["all","pending","contacted","scheduled"].map(f=>(
                <Btn key={f} small variant={leadFilter===f?"primary":"default"} onClick={()=>setLeadFilter(f)}>
                  {f.charAt(0).toUpperCase()+f.slice(1)}
                </Btn>
              ))}
            </div>
            {pending.length>0 && <Btn variant="info" small onClick={smsAllPending}>SMS All Pending ({pending.length})</Btn>}
          </div>
          <div style={{...s.card({padding:0,overflow:"hidden"})}}>
            <table style={{width:"100%",borderCollapse:"collapse"}}>
              <thead>
                <tr style={{background:"rgba(255,255,255,0.03)"}}>
                  {["Homeowner","Phone","ZIP","Storm","Status","Action"].map(h=>(
                    <th key={h} style={{padding:"10px 12px",textAlign:"left",fontSize:11,color:C.textMuted,fontWeight:600,textTransform:"uppercase",letterSpacing:"0.06em"}}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredLeads.map(lead=>(
                  <LeadRow key={lead.id} lead={lead} roofers={[roofer]}
                    onSMS={smsLead} onBook={bookLead} showRoofer={false} />
                ))}
              </tbody>
            </table>
            {filteredLeads.length===0&&<div style={{padding:20,color:C.textMuted,fontSize:13,textAlign:"center"}}>No leads found.</div>}
          </div>
        </div>
      )}

      {tab==="Calendar" && (
        <div>
          <div style={{...s.flex(0,"center","flex-end"),marginBottom:16}}>
            <Btn variant="primary" onClick={()=>setShowAddInspection(true)}>+ Add Inspection</Btn>
          </div>
          {Object.keys(groupedInspections).length===0
            ? <div style={{...s.card({textAlign:"center",padding:40,color:C.textMuted,fontSize:13})}}>No inspections scheduled.</div>
            : Object.entries(groupedInspections).map(([date, insps])=>(
              <div key={date} style={{marginBottom:16}}>
                <div style={s.h({fontSize:13,fontWeight:700,color:C.orange,marginBottom:8})}>{date}</div>
                {insps.map(ins=>(
                  <div key={ins.id} style={{...s.card({marginBottom:8,padding:"12px 16px"})}}>
                    <div style={s.flex(16,"center","space-between")}>
                      <div>
                        <div style={{fontSize:13,fontWeight:600}}>{ins.client}</div>
                        <div style={{fontSize:12,color:C.textDim}}>{ins.address}</div>
                      </div>
                      <div style={{textAlign:"right"}}>
                        <div style={{fontSize:12,color:C.orange}}>{ins.time}</div>
                        <div style={{fontSize:12,color:C.textDim}}>{ins.inspector}</div>
                        <StatusBadge status={ins.status} />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ))
          }
        </div>
      )}

      {tab==="Inspectors" && (
        <div>
          <div style={{...s.flex(0,"center","flex-end"),marginBottom:16}}>
            <Btn variant="primary" onClick={()=>setShowAddInspector(true)}>+ Add Inspector</Btn>
          </div>
          <div style={{...s.card({padding:0,overflow:"hidden"})}}>
            <table style={{width:"100%",borderCollapse:"collapse"}}>
              <thead>
                <tr style={{background:"rgba(255,255,255,0.03)"}}>
                  {["Name","Phone","ZIP Zones"].map(h=>(
                    <th key={h} style={{padding:"10px 12px",textAlign:"left",fontSize:11,color:C.textMuted,fontWeight:600,textTransform:"uppercase"}}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {roofer.inspectors.map(ins=>(
                  <tr key={ins.id} style={{borderBottom:`1px solid ${C.border}`}}>
                    <td style={{padding:"10px 12px",fontSize:13,fontWeight:600}}>{ins.name}</td>
                    <td style={{padding:"10px 12px",fontSize:13,color:C.textDim}}>{ins.phone}</td>
                    <td style={{padding:"10px 12px"}}>
                      <div style={s.flex(6,undefined,undefined)}>{ins.zones.map(z=><Badge key={z} label={z} color={C.blue} small />)}</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {roofer.inspectors.length===0&&<div style={{padding:20,color:C.textMuted,fontSize:13,textAlign:"center"}}>No inspectors added yet.</div>}
          </div>
        </div>
      )}

      {tab==="Territories" && (
        <div>
          <div style={{...s.flex(8),marginBottom:16}}>
            <input value={newZip} onChange={e=>setNewZip(e.target.value)} placeholder="Add ZIP code..."
              style={{background:"rgba(255,255,255,0.04)",border:`1px solid ${C.border}`,borderRadius:8,padding:"9px 12px",color:C.text,fontSize:13,outline:"none",width:180,fontFamily:"'Outfit',sans-serif"}} />
            <Btn variant="primary" onClick={()=>{
              if(newZip.trim()){onUpdate("add_territory",{rooferId:roofer.id,zip:newZip.trim()});setNewZip("");}
            }}>Add ZIP</Btn>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(120px,1fr))",gap:10}}>
            {roofer.territories.map(zip=>(
              <div key={zip} style={{...s.card({display:"flex",alignItems:"center",justifyContent:"space-between",padding:"10px 14px"})}}>
                <span style={{fontSize:13,fontWeight:600}}>{zip}</span>
                <button onClick={()=>onUpdate("remove_territory",{rooferId:roofer.id,zip})}
                  style={{background:"none",border:"none",color:C.red,cursor:"pointer",fontSize:16,lineHeight:1}}>×</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab==="AI Agent" && <AIChat context={systemCtx} apiKeys={apiKeys} />}
    </div>
  );
}

// ─── COMMAND CENTER ───────────────────────────────────────────────────────────
function CommandCenter({ roofers, leads, storms, apiKeys, onUpdate, onSelectRoofer }) {
  const [tab, setTab] = useState("Overview");
  const [showAddRoofer, setShowAddRoofer] = useState(false);
  const [scanStatus, setScanStatus] = useState("");
  const [manualZip, setManualZip] = useState("");
  const [leadStatusFilter, setLeadStatusFilter] = useState("all");
  const [leadRooferFilter, setLeadRooferFilter] = useState("all");

  const totalMRR = roofers.filter(r=>r.status==="active").reduce((s,r)=>s+PLAN_PRICES[r.plan],0);
  const activeClients = roofers.filter(r=>r.status==="active").length;
  const pending = leads.filter(l=>l.status==="pending");

  async function runScan() {
    setScanStatus("Scanning...");
    if (apiKeys.weather) {
      try {
        const zips = [...new Set(roofers.flatMap(r=>r.territories))];
        for (const zip of zips.slice(0,3)) {
          const data = await fetchWeatherAlerts(apiKeys.weather, zip);
          const alerts = data.alerts?.alert || [];
          alerts.forEach(a=>{
            const desc = (a.headline||"").toLowerCase();
            const isStorm = ["hail","tornado","wind","thunderstorm","severe"].some(k=>desc.includes(k));
            if(isStorm) onUpdate("add_storm",{storm:{id:"s"+Date.now()+zip,type:"Weather Alert",location:zip,zip,severity:"severe",date:new Date().toISOString().split("T")[0],processed:false}});
          });
        }
        setScanStatus("✓ Scan complete");
      } catch(e) { setScanStatus("Error: "+e.message); }
    } else {
      setScanStatus("⚠ WeatherAPI key not configured. Using demo data.");
    }
    setTimeout(()=>setScanStatus(""),3000);
  }

  const filteredLeads = leads.filter(l=>{
    if(leadStatusFilter!=="all"&&l.status!==leadStatusFilter) return false;
    if(leadRooferFilter!=="all"&&l.rooferId!==leadRooferFilter) return false;
    return true;
  });

  async function smsLead(lead) {
    const roofer = roofers.find(r=>r.id===lead.rooferId);
    const msg = await callClaude(null,[{role:"user",content:`Short SMS (under 160 chars) for storm roof inspection outreach to ${lead.homeowner} in ${lead.zip} after ${lead.stormType} storm. Sign as ${roofer?.name||"us"}.`}]);
    if(apiKeys.twilio?.sid) await sendTwilioSMS(apiKeys.twilio,lead.phone,msg);
    onUpdate("lead_status",{leadId:lead.id,status:"contacted"});
    alert(`SMS to ${lead.homeowner}:\n\n${msg}`);
  }

  function bookLead(lead) {
    const roofer = roofers.find(r=>r.id===lead.rooferId);
    const inspector = roofer?.inspectors.find(i=>i.zones.includes(lead.zip))||roofer?.inspectors[0];
    const d = new Date(); d.setDate(d.getDate()+2);
    onUpdate("book_lead",{leadId:lead.id,rooferId:lead.rooferId,inspection:{
      id:"ins"+Date.now(),client:lead.homeowner,address:lead.zip,
      date:d.toISOString().split("T")[0],time:"10:00 AM",
      inspector:inspector?.name||"TBD",status:"scheduled",
    }});
  }

  const systemCtx = `You are SkyShield Pro AI. Current data: ${roofers.length} roofers, ${leads.length} total leads, ${pending.length} pending, ${storms.length} storm events, $${totalMRR.toLocaleString()} MRR. Storms: ${storms.map(s=>`${s.type} in ${s.location}`).join(", ")}.`;

  return (
    <div>
      {showAddRoofer && (
        <AddRooferModal onClose={()=>setShowAddRoofer(false)}
          onAdd={(r)=>onUpdate("add_roofer",{roofer:r})} />
      )}

      <Tabs tabs={["Overview","Storms","Roofers","All Leads","AI Agent"]} active={tab} onChange={setTab} />

      {tab==="Overview" && (
        <div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:12,marginBottom:20}}>
            <StatCard label="MRR" value={`$${totalMRR.toLocaleString()}`} color={C.green} />
            <StatCard label="Active Clients" value={activeClients} color={C.orange} />
            <StatCard label="Total Leads" value={leads.length} color={C.blue} />
            <StatCard label="Inspections" value={leads.filter(l=>l.status==="scheduled").length} color={C.purple} />
            <StatCard label="Storms Detected" value={storms.length} color={C.red} />
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16}}>
            <div style={s.card()}>
              <div style={s.h({fontSize:14,fontWeight:700,marginBottom:12})}>⛈ Recent Storm Events</div>
              {storms.map(storm=>(
                <div key={storm.id} style={{...s.flex(12,"center","space-between"),padding:"10px 0",borderBottom:`1px solid ${C.border}`}}>
                  <div>
                    <div style={{fontSize:13,fontWeight:600}}>{storm.type} — {storm.location}</div>
                    <div style={{fontSize:12,color:C.textDim}}>{storm.date} · ZIP {storm.zip}</div>
                  </div>
                  <SeverityBadge severity={storm.severity} />
                </div>
              ))}
            </div>
            <div style={s.card()}>
              <div style={s.h({fontSize:14,fontWeight:700,marginBottom:12})}>🏢 Roofer Performance</div>
              {roofers.map(roofer=>(
                <div key={roofer.id} onClick={()=>onSelectRoofer(roofer)}
                  style={{...s.flex(12,"center","space-between"),padding:"10px 0",borderBottom:`1px solid ${C.border}`,cursor:"pointer"}}
                  onMouseEnter={e=>{e.currentTarget.style.opacity=0.8;}} onMouseLeave={e=>{e.currentTarget.style.opacity=1;}}>
                  <div>
                    <div style={{fontSize:13,fontWeight:600}}>{roofer.name}</div>
                    <div style={{fontSize:12,color:C.textDim}}>{roofer.leads} leads · {roofer.booked} booked</div>
                  </div>
                  <div style={s.flex(8)}>
                    <Badge label={roofer.plan} color={PLAN_COLORS[roofer.plan]} small />
                    <StatusBadge status={roofer.status} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {tab==="Storms" && (
        <div>
          <div style={{...s.flex(10,"center","space-between"),marginBottom:16}}>
            <div style={s.flex(10)}>
              <Btn variant="primary" onClick={runScan}>⚡ Run Scan Now</Btn>
              {scanStatus&&<span style={{fontSize:12,color:C.textDim}}>{scanStatus}</span>}
            </div>
            <div style={s.flex(8)}>
              <input value={manualZip} onChange={e=>setManualZip(e.target.value)} placeholder="Manual ZIP..."
                style={{background:"rgba(255,255,255,0.04)",border:`1px solid ${C.border}`,borderRadius:8,padding:"8px 12px",color:C.text,fontSize:13,outline:"none",width:140,fontFamily:"'Outfit',sans-serif"}} />
              <Btn variant="info" onClick={()=>{
                if(!manualZip.trim()) return;
                const zip=manualZip.trim();
                const roofer=roofers.find(r=>r.territories.includes(zip));
                if(roofer){
                  onUpdate("add_lead",{lead:{id:"l"+Date.now(),homeowner:"Storm Lead - "+zip,phone:"000-000-0000",zip,rooferId:roofer.id,stormType:"Manual",status:"pending"}});
                  alert(`Lead created for ${roofer.name} in ZIP ${zip}`);
                } else {
                  alert("No roofer found for ZIP "+zip);
                }
                setManualZip("");
              }}>+ Campaign</Btn>
            </div>
          </div>
          <div style={s.card({padding:0,overflow:"hidden"})}>
            <table style={{width:"100%",borderCollapse:"collapse"}}>
              <thead>
                <tr style={{background:"rgba(255,255,255,0.03)"}}>
                  {["Storm Type","Location","ZIP","Severity","Date","Status","Action"].map(h=>(
                    <th key={h} style={{padding:"10px 12px",textAlign:"left",fontSize:11,color:C.textMuted,fontWeight:600,textTransform:"uppercase"}}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {storms.map(storm=>(
                  <tr key={storm.id} style={{borderBottom:`1px solid ${C.border}`}}>
                    <td style={{padding:"10px 12px",fontSize:13,fontWeight:600}}>{storm.type}</td>
                    <td style={{padding:"10px 12px",fontSize:13}}>{storm.location}</td>
                    <td style={{padding:"10px 12px",fontSize:13}}>{storm.zip}</td>
                    <td style={{padding:"10px 12px"}}><SeverityBadge severity={storm.severity} /></td>
                    <td style={{padding:"10px 12px",fontSize:13,color:C.textDim}}>{storm.date}</td>
                    <td style={{padding:"10px 12px"}}><Badge label={storm.processed?"processed":"unprocessed"} color={storm.processed?C.green:C.orange} small /></td>
                    <td style={{padding:"10px 12px"}}>
                      {!storm.processed && (
                        <Btn small variant="primary" onClick={()=>{
                          const matched = roofers.filter(r=>r.territories.includes(storm.zip));
                          matched.forEach(roofer=>{
                            onUpdate("add_lead",{lead:{id:"l"+Date.now()+Math.random(),homeowner:"Storm Prospect "+storm.zip,phone:"000-000-0000",zip:storm.zip,rooferId:roofer.id,stormType:storm.type,status:"pending"}});
                          });
                          onUpdate("process_storm",{stormId:storm.id});
                          alert(`Processed: ${matched.length} roofer(s) notified.`);
                        }}>Process</Btn>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab==="Roofers" && (
        <div>
          <div style={{...s.flex(0,"center","flex-end"),marginBottom:16}}>
            <Btn variant="primary" onClick={()=>setShowAddRoofer(true)}>+ Add Roofer</Btn>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(300px,1fr))",gap:16}}>
            {roofers.map(roofer=>(
              <div key={roofer.id} onClick={()=>onSelectRoofer(roofer)}
                style={{...s.card({cursor:"pointer"})}}
                onMouseEnter={e=>{e.currentTarget.style.background=C.cardHover;e.currentTarget.style.borderColor=C.borderHover;}}
                onMouseLeave={e=>{e.currentTarget.style.background=C.card;e.currentTarget.style.borderColor=C.border;}}>
                <div style={s.flex(10,"center","space-between")}>
                  <div style={s.h({fontSize:15,fontWeight:700})}>{roofer.name}</div>
                  <div style={s.flex(6)}>
                    <Badge label={roofer.plan} color={PLAN_COLORS[roofer.plan]} small />
                    <StatusBadge status={roofer.status} />
                  </div>
                </div>
                <div style={{fontSize:12,color:C.textDim,marginTop:4}}>{roofer.owner} · {roofer.email}</div>
                <div style={{...s.flex(20),marginTop:14}}>
                  <div style={{textAlign:"center"}}>
                    <div style={s.h({fontSize:20,fontWeight:800,color:C.orange})}>{roofer.leads}</div>
                    <div style={{fontSize:10,color:C.textMuted,textTransform:"uppercase"}}>Leads</div>
                  </div>
                  <div style={{textAlign:"center"}}>
                    <div style={s.h({fontSize:20,fontWeight:800,color:C.blue})}>{roofer.booked}</div>
                    <div style={{fontSize:10,color:C.textMuted,textTransform:"uppercase"}}>Booked</div>
                  </div>
                  <div style={{textAlign:"center"}}>
                    <div style={s.h({fontSize:20,fontWeight:800,color:C.green})}>${(roofer.revenue/1000).toFixed(0)}k</div>
                    <div style={{fontSize:10,color:C.textMuted,textTransform:"uppercase"}}>Revenue</div>
                  </div>
                  <div style={{textAlign:"center"}}>
                    <div style={s.h({fontSize:20,fontWeight:800,color:C.textDim})}>{leads.filter(l=>l.rooferId===roofer.id&&l.status==="pending").length}</div>
                    <div style={{fontSize:10,color:C.textMuted,textTransform:"uppercase"}}>Pending</div>
                  </div>
                </div>
                <div style={{marginTop:12}}>
                  <div style={{fontSize:11,color:C.textMuted,marginBottom:6}}>TERRITORIES</div>
                  <div style={s.flex(6)}>{roofer.territories.map(z=><Badge key={z} label={z} color={C.blue} small />)}</div>
                </div>
                <div style={{marginTop:10,fontSize:12,color:C.textDim}}>{roofer.inspectors.length} inspector{roofer.inspectors.length!==1?"s":""}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab==="All Leads" && (
        <div>
          <div style={{...s.flex(10,"center","space-between"),marginBottom:16}}>
            <div style={s.flex(8)}>
              <Select value={leadStatusFilter} onChange={setLeadStatusFilter}
                options={[{value:"all",label:"All Status"},{value:"pending",label:"Pending"},{value:"contacted",label:"Contacted"},{value:"scheduled",label:"Scheduled"}]} />
              <Select value={leadRooferFilter} onChange={setLeadRooferFilter}
                options={[{value:"all",label:"All Roofers"},...roofers.map(r=>({value:r.id,label:r.name}))]} />
            </div>
            {pending.length>0 && (
              <Btn variant="info" small onClick={async()=>{ for(const l of pending){await smsLead(l);} }}>
                SMS All Pending ({pending.length})
              </Btn>
            )}
          </div>
          <div style={s.card({padding:0,overflow:"hidden"})}>
            <table style={{width:"100%",borderCollapse:"collapse"}}>
              <thead>
                <tr style={{background:"rgba(255,255,255,0.03)"}}>
                  {["Homeowner","Phone","ZIP","Roofer","Storm","Status","Action"].map(h=>(
                    <th key={h} style={{padding:"10px 12px",textAlign:"left",fontSize:11,color:C.textMuted,fontWeight:600,textTransform:"uppercase"}}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredLeads.map(lead=>(
                  <LeadRow key={lead.id} lead={lead} roofers={roofers}
                    onSMS={smsLead} onBook={bookLead} showRoofer={true} />
                ))}
              </tbody>
            </table>
            {filteredLeads.length===0&&<div style={{padding:20,color:C.textMuted,fontSize:13,textAlign:"center"}}>No leads found.</div>}
          </div>
        </div>
      )}

      {tab==="AI Agent" && <AIChat context={systemCtx} apiKeys={apiKeys} />}
    </div>
  );
}

// ─── SUBSCRIPTIONS & BILLING ──────────────────────────────────────────────────
function Subscriptions({ roofers, apiKeys, onUpdate }) {
  const [tab, setTab] = useState("Clients");
  const [showInvite, setShowInvite] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteName, setInviteName] = useState("");
  const [pricing, setPricing] = useState({
    Starter: { price:297, features:["Up to 50 leads/mo","1 territory","Email support","Basic analytics"] },
    Pro:     { price:497, features:["Up to 200 leads/mo","3 territories","SMS automation","Priority support","Full analytics"] },
    Elite:   { price:997, features:["Unlimited leads","10 territories","Full AI automation","Dedicated manager","White-label option"] },
  });

  const mrr = roofers.filter(r=>r.status==="active").reduce((s,r)=>s+(pricing[r.plan]?.price||PLAN_PRICES[r.plan]),0);

  function updatePlanPrice(plan, price) {
    setPricing(p=>({...p,[plan]:{...p[plan],price:Number(price)}}));
  }

  async function inviteClient() {
    if(!inviteName||!inviteEmail) return;
    onUpdate("add_roofer",{roofer:{
      id:"r"+Date.now(),name:inviteName,owner:inviteName,email:inviteEmail,
      phone:"",plan:"Starter",status:"trial",territories:[],revenue:0,leads:0,booked:0,inspectors:[],inspections:[],
    }});
    setShowInvite(false);
    setInviteEmail(""); setInviteName("");
    alert(`Invitation sent to ${inviteEmail}`);
  }

  return (
    <div>
      {showInvite && (
        <Modal title="Invite Client" onClose={()=>setShowInvite(false)}>
          <div style={{display:"flex",flexDirection:"column",gap:14}}>
            <Input label="Company Name" value={inviteName} onChange={setInviteName} placeholder="Apex Roofing" />
            <Input label="Email" value={inviteEmail} onChange={setInviteEmail} type="email" placeholder="owner@company.com" />
            <div style={{...s.flex(8),justifyContent:"flex-end",marginTop:8}}>
              <Btn onClick={()=>setShowInvite(false)}>Cancel</Btn>
              <Btn variant="primary" onClick={inviteClient}>Send Invite</Btn>
            </div>
          </div>
        </Modal>
      )}

      <Tabs tabs={["Clients","Pricing","Billing"]} active={tab} onChange={setTab} />

      {tab==="Clients" && (
        <div>
          <div style={{...s.flex(0,"center","flex-end"),marginBottom:16}}>
            <Btn variant="primary" onClick={()=>setShowInvite(true)}>+ Invite Client</Btn>
          </div>
          <div style={s.card({padding:0,overflow:"hidden"})}>
            <table style={{width:"100%",borderCollapse:"collapse"}}>
              <thead>
                <tr style={{background:"rgba(255,255,255,0.03)"}}>
                  {["Company","Owner","Email","Plan","Status","MRR","Actions"].map(h=>(
                    <th key={h} style={{padding:"10px 12px",textAlign:"left",fontSize:11,color:C.textMuted,fontWeight:600,textTransform:"uppercase"}}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {roofers.map(roofer=>(
                  <tr key={roofer.id} style={{borderBottom:`1px solid ${C.border}`}}>
                    <td style={{padding:"10px 12px",fontSize:13,fontWeight:600}}>{roofer.name}</td>
                    <td style={{padding:"10px 12px",fontSize:13}}>{roofer.owner}</td>
                    <td style={{padding:"10px 12px",fontSize:12,color:C.textDim}}>{roofer.email}</td>
                    <td style={{padding:"10px 12px"}}>
                      <select value={roofer.plan}
                        onChange={e=>onUpdate("update_roofer_plan",{rooferId:roofer.id,plan:e.target.value})}
                        style={{background:"#0d1117",border:`1px solid ${C.border}`,borderRadius:6,padding:"4px 8px",color:C.text,fontSize:12,fontFamily:"'Outfit',sans-serif"}}>
                        {["Starter","Pro","Elite"].map(p=><option key={p}>{p}</option>)}
                      </select>
                    </td>
                    <td style={{padding:"10px 12px"}}><StatusBadge status={roofer.status} /></td>
                    <td style={{padding:"10px 12px",fontSize:13,color:C.green}}>${pricing[roofer.plan]?.price||0}/mo</td>
                    <td style={{padding:"10px 12px"}}>
                      <div style={s.flex(6)}>
                        {roofer.status!=="active"
                          ? <Btn small variant="success" onClick={()=>onUpdate("update_roofer_status",{rooferId:roofer.id,status:"active"})}>Activate</Btn>
                          : <Btn small variant="danger" onClick={()=>onUpdate("update_roofer_status",{rooferId:roofer.id,status:"cancelled"})}>Cancel</Btn>
                        }
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab==="Pricing" && (
        <div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:16}}>
            {Object.entries(pricing).map(([plan,data])=>(
              <div key={plan} style={{...s.card({position:"relative"}),border:plan==="Pro"?`1px solid ${C.orange}55`:undefined}}>
                {plan==="Pro"&&<div style={{position:"absolute",top:-12,left:"50%",transform:"translateX(-50%)",background:C.orange,color:"#000",fontSize:10,fontWeight:700,padding:"3px 10px",borderRadius:10,textTransform:"uppercase"}}>Most Popular</div>}
                <div style={s.h({fontSize:16,fontWeight:800,marginBottom:8})}>{plan}</div>
                <div style={{display:"flex",alignItems:"baseline",gap:4,marginBottom:16}}>
                  <span style={s.h({fontSize:11,color:C.textMuted})}>$</span>
                  <input type="number" value={data.price}
                    onChange={e=>updatePlanPrice(plan,e.target.value)}
                    style={{background:"none",border:"none",color:PLAN_COLORS[plan],fontSize:36,fontWeight:800,fontFamily:"'Syne',sans-serif",width:100,outline:"none"}} />
                  <span style={{fontSize:12,color:C.textMuted}}>/mo</span>
                </div>
                <div style={{display:"flex",flexDirection:"column",gap:8}}>
                  {data.features.map(f=>(
                    <div key={f} style={{...s.flex(8),fontSize:13}}>
                      <span style={{color:PLAN_COLORS[plan]}}>✓</span>
                      <span style={{color:C.textDim}}>{f}</span>
                    </div>
                  ))}
                </div>
                <div style={{marginTop:16,padding:"10px 14px",background:C.orangeDim,borderRadius:8,fontSize:12,color:C.textDim}}>
                  💡 At {roofers.filter(r=>r.plan===plan&&r.status==="active").length} active clients → ${(data.price*roofers.filter(r=>r.plan===plan&&r.status==="active").length).toLocaleString()}/mo
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab==="Billing" && (
        <div>
          <div style={{...s.flex(0,"center","space-between"),marginBottom:16}}>
            <div style={s.h({fontSize:18,fontWeight:700})}>Monthly Billing Summary</div>
            <Btn variant="info" onClick={()=>alert("Configure Stripe API key first")}>Configure Stripe →</Btn>
          </div>
          <div style={{...s.flex(12),marginBottom:16}}>
            <StatCard label="Total MRR" value={`$${mrr.toLocaleString()}`} color={C.green} sub="Active clients only" />
            <StatCard label="Active Clients" value={roofers.filter(r=>r.status==="active").length} color={C.orange} />
            <StatCard label="Annual Run Rate" value={`$${(mrr*12).toLocaleString()}`} color={C.blue} />
          </div>
          <div style={s.card({padding:0,overflow:"hidden"})}>
            <table style={{width:"100%",borderCollapse:"collapse"}}>
              <thead>
                <tr style={{background:"rgba(255,255,255,0.03)"}}>
                  {["Company","Plan","Status","Monthly","Next Billing"].map(h=>(
                    <th key={h} style={{padding:"10px 12px",textAlign:"left",fontSize:11,color:C.textMuted,fontWeight:600,textTransform:"uppercase"}}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {roofers.map(roofer=>(
                  <tr key={roofer.id} style={{borderBottom:`1px solid ${C.border}`}}>
                    <td style={{padding:"10px 12px",fontSize:13,fontWeight:600}}>{roofer.name}</td>
                    <td style={{padding:"10px 12px"}}><Badge label={roofer.plan} color={PLAN_COLORS[roofer.plan]} small /></td>
                    <td style={{padding:"10px 12px"}}><StatusBadge status={roofer.status} /></td>
                    <td style={{padding:"10px 12px",fontSize:13,color:roofer.status==="active"?C.green:C.textMuted}}>
                      {roofer.status==="active"?`$${(pricing[roofer.plan]?.price||0).toLocaleString()}`:"—"}
                    </td>
                    <td style={{padding:"10px 12px",fontSize:12,color:C.textDim}}>
                      {roofer.status==="active"?"Jul 1, 2025":"—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── API SETTINGS ─────────────────────────────────────────────────────────────
function APISettings({ apiKeys, onUpdate }) {
  const [keys, setKeys] = useState({
    weather: apiKeys.weather||"",
    twilioSid: apiKeys.twilio?.sid||"",
    twilioToken: apiKeys.twilio?.token||"",
    twilioPhone: apiKeys.twilio?.from||"",
    googleCalClientId: apiKeys.googleCal?.clientId||"",
    googleCalClientSecret: apiKeys.googleCal?.clientSecret||"",
    googleCalRefreshToken: apiKeys.googleCal?.refreshToken||"",
    attom: apiKeys.attom||"",
    stripePublishable: apiKeys.stripe?.publishable||"",
    stripeSecret: apiKeys.stripe?.secret||"",
  });
  const [testResults, setTestResults] = useState({});

  function save() {
    onUpdate("api_keys", {
      weather: keys.weather,
      twilio: keys.twilioSid ? { sid:keys.twilioSid, token:keys.twilioToken, from:keys.twilioPhone } : null,
      googleCal: keys.googleCalClientId ? { clientId:keys.googleCalClientId, clientSecret:keys.googleCalClientSecret, refreshToken:keys.googleCalRefreshToken } : null,
      attom: keys.attom,
      stripe: keys.stripeSecret ? { publishable:keys.stripePublishable, secret:keys.stripeSecret } : null,
    });
    alert("API keys saved!");
  }

  async function testService(name) {
    setTestResults(p=>({...p,[name]:"Testing..."}));
    try {
      if(name==="weather"&&keys.weather) {
        const r = await fetch(`https://api.weatherapi.com/v1/current.json?key=${keys.weather}&q=75023`);
        const d = await r.json();
        setTestResults(p=>({...p,[name]:d.error?"❌ "+d.error.message:"✓ Connected — "+d.location?.name}));
      } else if(name==="googleCal"&&keys.googleCalClientId) {
        try {
          const creds = { clientId:keys.googleCalClientId, clientSecret:keys.googleCalClientSecret, refreshToken:keys.googleCalRefreshToken };
          const token = await getGCalAccessToken(creds);
          setTestResults(p=>({...p,[name]:token?"✓ Connected — token refreshed successfully":"❌ Failed to get token"}));
        } catch(e) { setTestResults(p=>({...p,[name]:"❌ "+e.message})); }
      } else if(name==="twilio"&&keys.twilioSid) {
        try {
          const encoded = btoa(keys.twilioSid+":"+keys.twilioToken);
          const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${keys.twilioSid}.json`, {
            headers: { "Authorization": "Basic "+encoded },
          });
          const d = await r.json();
          setTestResults(p=>({...p,[name]:d.friendly_name?"✓ Connected — "+d.friendly_name:"❌ "+(d.message||"Invalid credentials")}));
        } catch(e) { setTestResults(p=>({...p,[name]:"❌ "+e.message})); }
      } else if(name==="attom"&&keys.attom) {
        try {
          const r = await fetch("https://api.gateway.attomdata.com/propertyapi/v1.0.0/property/basicprofile?postalcode=75023&pagesize=1", {
            headers: { "apikey": keys.attom, "Accept": "application/json" },
          });
          const d = await r.json();
          setTestResults(p=>({...p,[name]:d.property?"✓ Connected — ATTOM data live":"❌ "+(d.status?.msg||"Invalid API key")}));
        } catch(e) { setTestResults(p=>({...p,[name]:"❌ "+e.message})); }
      } else if(name==="stripe"&&keys.stripeSecret) {
        try {
          const r = await fetch("https://api.stripe.com/v1/balance", {
            headers: { "Authorization": "Bearer "+keys.stripeSecret },
          });
          const d = await r.json();
          setTestResults(p=>({...p,[name]:d.object==="balance"?"✓ Connected — Stripe balance retrieved":"❌ "+(d.error?.message||"Invalid key")}));
        } catch(e) { setTestResults(p=>({...p,[name]:"❌ "+e.message})); }
      } else if(name==="claude") {
        const r = await callClaude(null,[{role:"user",content:"Say 'SkyShield connected' and nothing else"}]);
        setTestResults(p=>({...p,[name]:"✓ "+r.trim()}));
      } else {
        setTestResults(p=>({...p,[name]:"⚠ Enter key and try again"}));
      }
    } catch(e) {
      setTestResults(p=>({...p,[name]:"❌ "+e.message}));
    }
  }

  const services = [
    { id:"weather", name:"WeatherAPI.com", desc:"Storm alert scanning", link:"https://www.weatherapi.com/", fields:[{k:"weather",label:"API Key"}] },
    { id:"twilio", name:"Twilio SMS", desc:"Automated SMS outreach", link:"https://www.twilio.com/", fields:[{k:"twilioSid",label:"Account SID"},{k:"twilioToken",label:"Auth Token",type:"password"},{k:"twilioPhone",label:"From Phone Number"}] },
    { id:"googleCal", name:"Google Calendar", desc:"Inspection scheduling sync", link:"https://console.cloud.google.com/", fields:[{k:"googleCalClientId",label:"Client ID"},{k:"googleCalClientSecret",label:"Client Secret",type:"password"},{k:"googleCalRefreshToken",label:"Refresh Token",type:"password"}] },
    { id:"attom", name:"ATTOM Property Data", desc:"Property data enrichment", link:"https://www.attomdata.com/", fields:[{k:"attom",label:"API Key"}] },
    { id:"stripe", name:"Stripe", desc:"Subscription billing", link:"https://dashboard.stripe.com/", fields:[{k:"stripePublishable",label:"Publishable Key"},{k:"stripeSecret",label:"Restricted Key",type:"password"}] },
    { id:"claude", name:"Claude AI (Built-in)", desc:"AI agent & SMS generation", link:"https://console.anthropic.com/", fields:[] },
  ];

  const configured = (id) => {
    if(id==="twilio") return !!keys.twilioSid;
    if(id==="googleCal") return !!keys.googleCalClientId&&!!keys.googleCalRefreshToken;
    if(id==="stripe") return !!keys.stripeSecret;
    if(id==="claude") return true;
    return !!keys[id];
  };

  return (
    <div>
      <div style={{...s.flex(0,"center","space-between"),marginBottom:20}}>
        <div>
          <div style={s.h({fontSize:18,fontWeight:700})}>API Configuration</div>
          <div style={{fontSize:13,color:C.textDim,marginTop:4}}>Connect services to unlock full automation</div>
        </div>
        <Btn variant="primary" onClick={save}>Save All Keys</Btn>
      </div>

      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(320px,1fr))",gap:16,marginBottom:24}}>
        {services.map(svc=>(
          <div key={svc.id} style={s.card()}>
            <div style={s.flex(10,"center","space-between")}>
              <div>
                <div style={s.h({fontSize:14,fontWeight:700})}>{svc.name}</div>
                <div style={{fontSize:12,color:C.textDim}}>{svc.desc}</div>
              </div>
              <Badge label={configured(svc.id)?"connected":"not set"} color={configured(svc.id)?C.green:C.textMuted} small />
            </div>
            {svc.fields.length>0 && (
              <div style={{display:"flex",flexDirection:"column",gap:10,marginTop:14}}>
                {svc.fields.map(f=>(
                  <Input key={f.k} label={f.label} type={f.type||"password"} value={keys[f.k]}
                    onChange={v=>setKeys(p=>({...p,[f.k]:v}))} placeholder="Enter key..." />
                ))}
              </div>
            )}
            {svc.id==="claude"&&<div style={{marginTop:12,padding:"10px 12px",background:C.greenDim,borderRadius:8,fontSize:12,color:C.green}}>✓ Claude AI is pre-configured and ready to use in all AI Agent tabs and SMS generation.</div>}
            <div style={{...s.flex(8),marginTop:14,justifyContent:"space-between"}}>
              <a href={svc.link} target="_blank" rel="noreferrer" style={{fontSize:12,color:C.blue,textDecoration:"none"}}>Get Key ↗</a>
              <Btn small onClick={()=>testService(svc.id)}>Test Connection</Btn>
            </div>
            {testResults[svc.id]&&<div style={{marginTop:8,fontSize:12,color:testResults[svc.id].startsWith("✓")?C.green:testResults[svc.id].startsWith("⚠")?C.yellow:C.red}}>{testResults[svc.id]}</div>}
          </div>
        ))}
      </div>

      <div style={s.card()}>
        <div style={s.h({fontSize:14,fontWeight:700,marginBottom:12})}>🚀 Quick Setup Guide</div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
          {[
            ["1. WeatherAPI","Sign up at weatherapi.com → Get free API key → Paste above → Test → Run Scan in Command Center"],
            ["2. Twilio SMS","Create Twilio account → Get SID + Token + Phone number → Paste above → SMS automation unlocked"],
            ["3. Google Calendar","Google Cloud → Enable Calendar API → Create OAuth Client ID (Web) → OAuth Playground → get refresh token → paste Client ID + Secret + Refresh Token above"],
            ["4. Stripe","Create Stripe account → Dashboard → API Keys → Copy secret key → Billing sync and customer creation enabled"],
          ].map(([title,steps])=>(
            <div key={title} style={{padding:"12px 16px",background:"rgba(255,255,255,0.02)",borderRadius:8,border:`1px solid ${C.border}`}}>
              <div style={{fontSize:12,fontWeight:700,color:C.orange,marginBottom:6}}>{title}</div>
              <div style={{fontSize:12,color:C.textDim,lineHeight:1.7}}>{steps}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── MAIN APP ─────────────────────────────────────────────────────────────────
export default function App() {
  const [roofers, setRoofers] = useState(INIT_ROOFERS);
  const [leads, setLeads] = useState(INIT_LEADS);
  const [storms, setStorms] = useState(INIT_STORMS);
  const [apiKeys, setApiKeys] = useState({});
  const [activeSection, setActiveSection] = useState("Command Center");
  const [selectedRoofer, setSelectedRoofer] = useState(null);

  function handleUpdate(action, payload) {
    switch(action) {
      case "add_roofer":
        setRoofers(p=>[...p, payload.roofer]);
        break;
      case "add_lead":
        setLeads(p=>[...p, payload.lead]);
        setRoofers(p=>p.map(r=>r.id===payload.lead.rooferId?{...r,leads:r.leads+1}:r));
        break;
      case "add_storm":
        setStorms(p=>[...p, payload.storm]);
        break;
      case "process_storm":
        setStorms(p=>p.map(s=>s.id===payload.stormId?{...s,processed:true}:s));
        break;
      case "lead_status":
        setLeads(p=>p.map(l=>l.id===payload.leadId?{...l,status:payload.status}:l));
        break;
      case "book_lead":
        setLeads(p=>p.map(l=>l.id===payload.leadId?{...l,status:"scheduled"}:l));
        setRoofers(p=>p.map(r=>r.id===payload.rooferId
          ?{...r,booked:r.booked+1,inspections:[...r.inspections,payload.inspection]}:r));
        setSelectedRoofer(p=>p&&p.id===payload.rooferId
          ?{...p,booked:p.booked+1,inspections:[...p.inspections,payload.inspection]}:p);
        break;
      case "add_inspector":
        setRoofers(p=>p.map(r=>r.id===payload.rooferId?{...r,inspectors:[...r.inspectors,payload.inspector]}:r));
        setSelectedRoofer(p=>p&&p.id===payload.rooferId?{...p,inspectors:[...p.inspectors,payload.inspector]}:p);
        break;
      case "add_inspection":
        setRoofers(p=>p.map(r=>r.id===payload.rooferId?{...r,inspections:[...r.inspections,payload.inspection]}:r));
        setSelectedRoofer(p=>p&&p.id===payload.rooferId?{...p,inspections:[...p.inspections,payload.inspection]}:p);
        break;
      case "add_territory":
        setRoofers(p=>p.map(r=>r.id===payload.rooferId&&!r.territories.includes(payload.zip)?{...r,territories:[...r.territories,payload.zip]}:r));
        setSelectedRoofer(p=>p&&p.id===payload.rooferId&&!p.territories.includes(payload.zip)?{...p,territories:[...p.territories,payload.zip]}:p);
        break;
      case "remove_territory":
        setRoofers(p=>p.map(r=>r.id===payload.rooferId?{...r,territories:r.territories.filter(z=>z!==payload.zip)}:r));
        setSelectedRoofer(p=>p&&p.id===payload.rooferId?{...p,territories:p.territories.filter(z=>z!==payload.zip)}:p);
        break;
      case "update_roofer_plan":
        setRoofers(p=>p.map(r=>r.id===payload.rooferId?{...r,plan:payload.plan}:r));
        break;
      case "update_roofer_status":
        setRoofers(p=>p.map(r=>r.id===payload.rooferId?{...r,status:payload.status}:r));
        break;
      case "api_keys":
        setApiKeys(payload);
        break;
      default: break;
    }
  }

  function selectRoofer(roofer) {
    setSelectedRoofer(roofer);
    setActiveSection("Roofer Dashboard");
  }

  const sections = ["Command Center","Subscriptions & Billing","API Settings"];

  return (
    <div style={{ minHeight:"100vh", background: C.bg, fontFamily:"'Outfit',sans-serif" }}>
      <FontLoader />

      <nav style={{
        position:"sticky", top:0, zIndex:100,
        background:"rgba(6,8,15,0.95)", backdropFilter:"blur(12px)",
        borderBottom:`1px solid ${C.border}`,
        padding:"0 24px",
      }}>
        <div style={{ maxWidth:1400, margin:"0 auto", ...s.flex(0,"center","space-between"), height:56 }}>
          <div style={s.flex(10)}>
            <div style={{
              width:32, height:32, borderRadius:8,
              background:`linear-gradient(135deg, ${C.orange}, #dc2626)`,
              display:"flex", alignItems:"center", justifyContent:"center",
              fontSize:16, fontWeight:800, color:"#000",
            }}>⛈</div>
            <div style={{display:"flex",flexDirection:"column",gap:1}}>
              <span style={s.h({fontSize:16,fontWeight:800,letterSpacing:"-0.02em"})}>
                Sky<span style={{color:C.orange}}>Shield</span> Pro
              </span>
              <span style={{fontSize:9,color:C.textMuted,letterSpacing:"0.08em",textTransform:"uppercase",fontWeight:500}}>powered by Ark Dynamics</span>
            </div>
          </div>

          <div style={s.flex(4)}>
            {sections.map(sec=>(
              <button key={sec} onClick={()=>{setActiveSection(sec);setSelectedRoofer(null);}}
                style={{
                  background:"none", border:"none", cursor:"pointer",
                  padding:"6px 14px", borderRadius:8, fontSize:13, fontWeight:500,
                  color: activeSection===sec&&!selectedRoofer ? C.orange : C.textDim,
                  background: activeSection===sec&&!selectedRoofer ? C.orangeDim : "none",
                  fontFamily:"'Outfit',sans-serif",
                }}>{sec}</button>
            ))}
            {selectedRoofer && (
              <div style={s.flex(6)}>
                <span style={{color:C.textMuted,fontSize:13}}>›</span>
                <button onClick={()=>setSelectedRoofer(null)}
                  style={{background:"none",border:"none",cursor:"pointer",color:C.textDim,fontSize:13,fontFamily:"'Outfit',sans-serif"}}>
                  Command Center
                </button>
                <span style={{color:C.textMuted,fontSize:13}}>›</span>
                <span style={{fontSize:13,color:C.orange,fontWeight:600}}>{selectedRoofer.name}</span>
              </div>
            )}
          </div>

          <div style={s.flex(8)}>
            <div style={{fontSize:12,color:C.textMuted}}>
              <span style={{color:C.green}}>●</span> {roofers.filter(r=>r.status==="active").length} active
            </div>
            <div style={{fontSize:12,color:C.textMuted}}>
              <span style={{color:C.orange}}>●</span> {leads.filter(l=>l.status==="pending").length} pending
            </div>
          </div>
        </div>
      </nav>

      <main style={{ maxWidth:1400, margin:"0 auto", padding:"28px 24px" }}>
        <div style={{ marginBottom:24 }}>
          <h1 style={s.h({fontSize:26,fontWeight:800,letterSpacing:"-0.03em"})}>
            {selectedRoofer ? selectedRoofer.name : activeSection}
          </h1>
          {selectedRoofer && (
            <div style={{...s.flex(10),marginTop:8}}>
              <Badge label={selectedRoofer.plan} color={PLAN_COLORS[selectedRoofer.plan]} />
              <StatusBadge status={selectedRoofer.status} />
              <span style={{fontSize:13,color:C.textDim}}>{selectedRoofer.owner} · {selectedRoofer.email}</span>
            </div>
          )}
        </div>

        {selectedRoofer ? (
          <RooferDashboard
            roofer={selectedRoofer}
            leads={leads}
            apiKeys={apiKeys}
            onUpdate={handleUpdate}
            onBack={()=>setSelectedRoofer(null)}
          />
        ) : activeSection==="Command Center" ? (
          <CommandCenter roofers={roofers} leads={leads} storms={storms} apiKeys={apiKeys} onUpdate={handleUpdate} onSelectRoofer={selectRoofer} />
        ) : activeSection==="Subscriptions & Billing" ? (
          <Subscriptions roofers={roofers} apiKeys={apiKeys} onUpdate={handleUpdate} />
        ) : (
          <APISettings apiKeys={apiKeys} onUpdate={handleUpdate} />
        )}
      </main>
    </div>
  );
}
