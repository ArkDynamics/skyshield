import { useState, useEffect, useRef, useCallback } from "react";

// ─── SUPABASE CLIENT ──────────────────────────────────────────────────────────
const SUPABASE_URL = "https://zwadqhocdooikfokontb.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inp3YWRxaG9jZG9vaWtmb2tvbnRiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEzODE3OTUsImV4cCI6MjA5Njk1Nzc5NX0.WRN57iGXTGG3LgGfU_EjvvNh0fTuL-Kzp9IhL-t63kw";

async function supabaseAuth(endpoint, body) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "apikey": SUPABASE_ANON_KEY },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error_description || data.msg || data.error || "Authentication failed");
  return data;
}

async function supabaseSignUp(email, password) {
  return supabaseAuth("signup", { email, password });
}
async function supabaseSignIn(email, password) {
  return supabaseAuth("token?grant_type=password", { email, password });
}
async function supabaseRefreshSession(refreshToken) {
  return supabaseAuth("token?grant_type=refresh_token", { refresh_token: refreshToken });
}
async function supabaseResetPassword(email) {
  return supabaseAuth("recover", { email });
}
async function supabaseUpdatePassword(accessToken, newPassword) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", "apikey": SUPABASE_ANON_KEY, "Authorization": `Bearer ${accessToken}` },
    body: JSON.stringify({ password: newPassword }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error_description || data.msg || "Failed to update password");
  return data;
}
async function supabaseGetUser(accessToken) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { "apikey": SUPABASE_ANON_KEY, "Authorization": `Bearer ${accessToken}` },
  });
  if (!res.ok) return null;
  return res.json();
}
async function supabaseQuery(table, accessToken, params="") {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}${params}`, {
    headers: { "apikey": SUPABASE_ANON_KEY, "Authorization": `Bearer ${accessToken||SUPABASE_ANON_KEY}` },
  });
  if (!res.ok) return [];
  return res.json();
}
async function supabaseUpsert(table, accessToken, row) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "apikey": SUPABASE_ANON_KEY, "Authorization": `Bearer ${accessToken}`, "Prefer": "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify(row),
  });
  return res.json();
}
async function supabaseDelete(table, accessToken, idColumn, idValue) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${idColumn}=eq.${encodeURIComponent(idValue)}`, {
    method: "DELETE",
    headers: { "apikey": SUPABASE_ANON_KEY, "Authorization": `Bearer ${accessToken}` },
  });
  return res.ok;
}

// Holds the current session's access token in module scope so data-layer
// functions (save/load/delete helpers below) don't need the token threaded
// through every single call site. Set once on login, cleared on sign out.
let _currentAccessToken = null;
function setCurrentAccessToken(token){ _currentAccessToken = token; }
function getCurrentAccessToken(){ return _currentAccessToken || SUPABASE_ANON_KEY; }

// ─── DATA LAYER: APP STATE <-> SUPABASE ROW SHAPE CONVERSION ─────────────────
// The app's in-memory objects use camelCase and nested structures that mirror
// React state conveniently. Supabase rows use snake_case flat columns (with
// JSONB for nested bits). These functions translate both directions so the
// rest of the app never has to think about the database's column names.

function rooferToRow(r){
  const row = {
    id:r.id, name:r.name, owner:r.owner, email:r.email, phone:r.phone,
    plan:r.plan, status:r.status, territories:r.territories||[],
    revenue:r.revenue||0, leads:r.leads||0, booked:r.booked||0,
    pin:r.pin||null, twilio_from:r.twilioFrom||null,
    inspectors:r.inspectors||[], inspections:r.inspections||[],
    revenue_log:r.revenueLog||[], comm_settings:r.commSettings||DEFAULT_COMM,
    schedule_settings:r.scheduleSettings||DEFAULT_SCHEDULE, notifications:r.notifications||[],
    stripe_customer_id:r.stripeCustomerId||null,
    stripe_subscription_id:r.stripeSubscriptionId||null,
    stripe_status:r.stripeStatus||"none",
    zip_limit:r.zipLimit||PLAN_ZIP_LIMITS[r.plan]||10,
    seat_limit:r.seatLimit||PLAN_SEAT_LIMITS[r.plan]||1,
    billing_cycle:r.billingCycle||"monthly",
    setup_fee_paid:!!r.setupFeePaid,
    zip_bundle:r.zipBundle||null,
    updated_at:new Date().toISOString(),
  };
  if(r.trialStartedAt) row.trial_started_at = r.trialStartedAt;
  return row;
}
function rowToRoofer(row){
  return {
    id:row.id, name:row.name, owner:row.owner, email:row.email, phone:row.phone,
    plan:row.plan, status:row.status, territories:row.territories||[],
    revenue:Number(row.revenue)||0, leads:row.leads||0, booked:row.booked||0,
    pin:row.pin||"", twilioFrom:row.twilio_from||"",
    inspectors:row.inspectors||[], inspections:row.inspections||[],
    revenueLog:row.revenue_log||[], commSettings:row.comm_settings||{...DEFAULT_COMM},
    scheduleSettings:row.schedule_settings||{...DEFAULT_SCHEDULE}, notifications:row.notifications||[],
    stripeCustomerId:row.stripe_customer_id||null,
    stripeSubscriptionId:row.stripe_subscription_id||null,
    stripeStatus:row.stripe_status||"none",
    trialStartedAt:row.trial_started_at||null,
    zipLimit:row.zip_limit||PLAN_ZIP_LIMITS[row.plan]||10,
    seatLimit:row.seat_limit||PLAN_SEAT_LIMITS[row.plan]||1,
    billingCycle:row.billing_cycle||"monthly",
    setupFeePaid:!!row.setup_fee_paid,
    zipBundle:row.zip_bundle||null,
  };
}

// ─── TRIAL HELPERS ────────────────────────────────────────────────────────────
const TRIAL_DAYS = 14;
function trialDaysRemaining(roofer){
  if(!roofer.trialStartedAt) return TRIAL_DAYS; // hasn't started yet
  const start = new Date(roofer.trialStartedAt);
  const expiry = new Date(start.getTime() + TRIAL_DAYS * 24*60*60*1000);
  const remaining = Math.ceil((expiry - new Date()) / (24*60*60*1000));
  return Math.max(0, remaining);
}
function trialExpired(roofer){
  if(roofer.status==="active") return false; // paid, never expires
  if(!roofer.trialStartedAt) return false;   // trial hasn't started
  return trialDaysRemaining(roofer) <= 0;
}

// ─── BILLING API ──────────────────────────────────────────────────────────────
// Calls the Vercel serverless functions in /api/stripe/*.
// VITE_BILLING_KEY must match SKYSHIELD_API_KEY in your Vercel env vars.
const BILLING_KEY = import.meta.env?.VITE_BILLING_KEY||"";

async function billingCall(endpoint, body){
  try{
    const res = await fetch(`/api/stripe${endpoint}`, {
      method:"POST",
      headers:{ "Content-Type":"application/json", "x-skyshield-key":BILLING_KEY },
      body: JSON.stringify(body),
    });
    return res.json();
  }catch(e){
    console.error("Billing API error:", e);
    return { error: e.message };
  }
}


function leadToRow(l){
  return {
    id:l.id, homeowner:l.homeowner, phone:l.phone, address:l.address||"", zip:l.zip, roofer_id:l.rooferId,
    storm_type:l.stormType, status:l.status, notes:l.notes||"",
    contacted_at:l.contactedAt, followup_sent:!!l.followupSent,
    adult_confirmed:l.adultConfirmed||"unconfirmed", conversations:l.conversations||[],
    updated_at:new Date().toISOString(),
  };
}
function rowToLead(row){
  return {
    id:row.id, homeowner:row.homeowner, phone:row.phone, address:row.address||"", zip:row.zip, rooferId:row.roofer_id,
    stormType:row.storm_type, status:row.status, notes:row.notes||"",
    contactedAt:row.contacted_at, followupSent:!!row.followup_sent,
    adultConfirmed:row.adult_confirmed||"unconfirmed", conversations:row.conversations||[],
  };
}
function stormToRow(s){
  return { id:s.id, type:s.type, location:s.location, zip:s.zip, severity:s.severity, date:s.date, processed:!!s.processed, lat:s.lat, lng:s.lng };
}
function rowToStorm(row){
  return { id:row.id, type:row.type, location:row.location, zip:row.zip, severity:row.severity, date:row.date, processed:!!row.processed, lat:row.lat, lng:row.lng };
}

// ─── DATA LAYER: LOAD / SAVE / DELETE ────────────────────────────────────────
// Thin wrappers that fetch/persist each collection. Called once on app load
// (loadAllData) and after every mutating action (the various save*/delete*
// functions), keeping Supabase as the source of truth while local React
// state stays as a fast in-memory mirror for snappy UI updates.

async function loadAllData(){
  const token=getCurrentAccessToken();
  const [rooferRows, leadRows, stormRows, appStateRows, seatRows, zipRows] = await Promise.all([
    supabaseQuery("roofers", token, "?select=*"),
    supabaseQuery("leads", token, "?select=*"),
    supabaseQuery("storms", token, "?select=*"),
    supabaseQuery("app_state", token, "?id=eq.singleton&select=*"),
    supabaseQuery("seats", token, "?select=*"),
    supabaseQuery("zip_territories", token, "?select=*"),
  ]);
  const appState = Array.isArray(appStateRows) && appStateRows[0] ? appStateRows[0] : null;
  return {
    roofers: Array.isArray(rooferRows) ? rooferRows.map(rowToRoofer) : [],
    leads: Array.isArray(leadRows) ? leadRows.map(rowToLead) : [],
    storms: Array.isArray(stormRows) ? stormRows.map(rowToStorm) : [],
    activities: appState?.activities || [],
    scanSettings: appState?.scan_settings || { interval:"daily", startTime:"07:00", lastScan:null },
    apiKeys: appState?.api_keys || {},
    lastSeenVersion: appState?.last_seen_version || "0.0.0",
    seats: Array.isArray(seatRows) ? seatRows.map(r=>({id:r.id,account_id:r.account_id,email:r.email,name:r.name||"",role:r.role,status:r.status,permissionOverrides:r.permission_overrides||{}})) : [],
    zipTerritories: Array.isArray(zipRows) ? zipRows : [],
  };
}

async function saveRoofer(roofer){
  try{ await supabaseUpsert("roofers", getCurrentAccessToken(), rooferToRow(roofer)); }
  catch(e){ console.error("saveRoofer failed:", e); }
}
async function deleteRooferRow(id){
  try{ await supabaseDelete("roofers", getCurrentAccessToken(), "id", id); }
  catch(e){ console.error("deleteRooferRow failed:", e); }
}
async function saveLead(lead){
  try{ await supabaseUpsert("leads", getCurrentAccessToken(), leadToRow(lead)); }
  catch(e){ console.error("saveLead failed:", e); }
}
async function deleteLeadRow(id){
  try{ await supabaseDelete("leads", getCurrentAccessToken(), "id", id); }
  catch(e){ console.error("deleteLeadRow failed:", e); }
}
async function saveStorm(storm){
  try{ await supabaseUpsert("storms", getCurrentAccessToken(), stormToRow(storm)); }
  catch(e){ console.error("saveStorm failed:", e); }
}
async function saveAppState(partial){
  try{
    const row={ id:"singleton", updated_at:new Date().toISOString(), ...partial };
    await supabaseUpsert("app_state", getCurrentAccessToken(), row);
  }catch(e){ console.error("saveAppState failed:", e); }
}

// ─── GLOBAL STYLES ────────────────────────────────────────────────────────────
const FontLoader = () => (
  <style>{`
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&family=Space+Grotesk:wght@500;600;700&display=swap');
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    html { font-size: 14px; }
    body { background: #030e18; color: #e2f8f8; font-family: 'Inter', sans-serif; -webkit-font-smoothing: antialiased; }
    ::-webkit-scrollbar { width: 5px; height: 5px; }
    ::-webkit-scrollbar-track { background: #040f1b; }
    ::-webkit-scrollbar-thumb { background: #2dd4bf; border-radius: 3px; }
    input, select, textarea, button { font-family: 'Inter', sans-serif; }
    table { border-collapse: collapse; }
    a { text-decoration: none; }
  `}</style>
);

// ─── DESIGN TOKENS ────────────────────────────────────────────────────────────
const C = {
  // Backgrounds — Deep Ocean Aurora
  bg:       "#030e18",
  surface:  "#040f1b",
  card:     "#071828",
  cardHov:  "#0a1f32",
  border:   "rgba(80,200,220,0.09)",
  borderAct:"rgba(45,212,191,0.25)",

  // Brand — teal replaces orange throughout
  orange:   "#2dd4bf",
  orangeLt: "#5eead4",
  orangeDim:"rgba(45,212,191,0.12)",

  // Semantic
  green:    "#34d399",
  greenDim: "rgba(52,211,153,0.12)",
  red:      "#f87171",
  redDim:   "rgba(248,113,113,0.12)",
  blue:     "#38bdf8",
  blueDim:  "rgba(56,189,248,0.12)",
  yellow:   "#fbbf24",
  yellowDim:"rgba(251,191,36,0.12)",
  purple:   "#818cf8",
  purpleDim:"rgba(129,140,248,0.12)",

  // Text
  text:     "#ffffff",
  textSub:  "#a0c4d0",
  textMuted:"rgba(160,196,208,0.4)",
};

// ─── CONSTANTS ────────────────────────────────────────────────────────────────
const DEFAULT_COMM = {
  activeHoursStart:"08:00", activeHoursEnd:"18:00",
  activeDays:["Mon","Tue","Wed","Thu","Fri"],
  followupDays:2, coldDays:5,
  aiAutoReply:false, // when true, incoming lead SMS replies get a Claude-generated response
  requireAdultPresent:true, // require AI to confirm an adult (18+) will be present before booking
  templates:{
    initial:"Hi {{name}}, we noticed your area ({{zip}}) was recently hit by a {{storm}} storm. {{company}} offers FREE roof inspections — reply YES to schedule yours today!",
    followup:"Hi {{name}}, just following up on our inspection offer for your home in {{zip}}. We have openings this week — interested?",
    booking:"Hi {{name}}, your roof inspection is confirmed for {{date}} at {{time}} with {{inspector}}. Reply STOP to cancel. — {{company}}",
    adultCheck:"Great! One quick thing before we lock in a time — will someone 18 or older be home during the inspection? Just need a quick yes to confirm.",
  }
};

// ─── VERSION & CHANGELOG ─────────────────────────────────────────────────────
// Bump APP_VERSION with every deploy. Add an entry to CHANGELOG describing
// what changed — this is what users will see in the "What's New" modal.
// Format: { version:"x.x.x", date:"Month DD, YYYY", changes:["...","..."] }
const APP_VERSION = "1.1.0";
const CHANGELOG = [
  {
    version:"1.1.0",
    date:"July 2, 2025",
    changes:[
      "New Deep Ocean Aurora theme — updated colors, backgrounds, and nav styling throughout the app",
      "In-app update notifications — you'll now see what changed after every new version is deployed",
      "Session persistence — you stay logged in across page refreshes without needing to re-enter your password",
      "Full Supabase data persistence — roofers, leads, storms, and API keys now survive code deploys",
      "AI adult-presence verification gate — the AI auto-reply system now confirms an adult will be present before booking any inspection",
    ],
  },
  {
    version:"1.0.0",
    date:"June 30, 2025",
    changes:[
      "Initial release of SkyShield Pro",
      "Admin Command Center with roofer management, storm map, and lead pipeline",
      "Per-roofer Twilio SMS numbers with round-robin lead distribution",
      "Native scheduling engine with real availability, conflict detection, and Google Calendar links",
      "Roofer dashboard with notification bell, calendar, and conversation view",
      "Stripe billing integration and revenue tracking",
    ],
  },
];

const PLAN_PRICES   = { Starter:1500, Pro:2000, Growth:2750 };
const PLAN_PRICES_ANNUAL = { Starter:14997, Pro:19997, Growth:27497 };
const PLAN_COLORS   = { Starter:C.blue, Pro:C.orange, Growth:C.purple, Trial:C.yellow };
const PLAN_ZIP_LIMITS = { Starter:10, Pro:20, Growth:30 };
const PLAN_SEAT_LIMITS = { Starter:1, Pro:1, Growth:3 };
const SETUP_FEE = 500;

const SEAT_ROLES = ["Owner","Office Manager","Sales Rep","Inspector"];

// Permission matrix per role
const ROLE_PERMISSIONS = {
  "Owner":           { billing:true,  inviteSeats:true,  viewAllLeads:true,  assignLeads:true,  updateLeadStatus:true,  scheduleInspections:true,  viewInspections:true,  uploadInspectionNotes:true,  viewStormAlerts:true,  advancedReporting:true,  viewTerritories:true  },
  "Office Manager":  { billing:false, inviteSeats:true,  viewAllLeads:true,  assignLeads:true,  updateLeadStatus:true,  scheduleInspections:true,  viewInspections:true,  uploadInspectionNotes:true,  viewStormAlerts:true,  advancedReporting:true,  viewTerritories:true  },
  "Sales Rep":       { billing:false, inviteSeats:false, viewAllLeads:false, assignLeads:false, updateLeadStatus:true,  scheduleInspections:true,  viewInspections:true,  uploadInspectionNotes:false, viewStormAlerts:true,  advancedReporting:false, viewTerritories:true  },
  "Inspector":       { billing:false, inviteSeats:false, viewAllLeads:false, assignLeads:false, updateLeadStatus:false, scheduleInspections:false, viewInspections:true,  uploadInspectionNotes:true,  viewStormAlerts:false, advancedReporting:false, viewTerritories:false },
};

const PERMISSION_LABELS = {
  billing:"Billing & plan management",
  inviteSeats:"Invite/remove seats",
  viewAllLeads:"View all leads",
  assignLeads:"Assign leads",
  updateLeadStatus:"Update lead status",
  scheduleInspections:"Schedule inspections",
  viewInspections:"View inspections",
  uploadInspectionNotes:"Upload inspection photos/notes",
  viewStormAlerts:"View storm alerts",
  advancedReporting:"Advanced reporting",
  viewTerritories:"View territory/zips",
};

const ZIP_ADDONS = [
  { id:"10-zip",  label:"10-Zip Bundle",    price:500,  original:null,  desc:"Add 10 ZIP codes to your territory" },
  { id:"20-zip",  label:"20-Zip Bundle",    price:800,  original:1000,  desc:"Add 20 ZIP codes — 20% off",  savings:"Save $200/mo" },
  { id:"metro",   label:"Metro Zone Lock",  price:1000, original:null,  desc:"Exclusively own a ZIP — per ZIP/mo" },
  { id:"seat",    label:"Additional Seat",  price:50,   original:null,  desc:"Add a team member seat (max 5 extra)" },
];
const DAYS_OF_WEEK  = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];
const SCAN_INTERVALS= [
  {value:"manual",label:"Manual Only"},{value:"daily",label:"Once Daily"},
  {value:"2h",label:"Every 2 Hours"},{value:"1h",label:"Every Hour"},{value:"30m",label:"Every 30 Min"},
];
const INSPECTION_STATUSES   = ["scheduled","completed","no-show","converted","lost"];
const INS_STATUS_COLORS     = {scheduled:C.blue,completed:C.green,"no-show":C.yellow,converted:C.purple,lost:C.red};

// Default operating hours + appointment settings for a roofer's scheduling calendar.
// hours: per-day open/close window. Closed days simply have open:false.
const DEFAULT_SCHEDULE = {
  durationMins: 60,     // default length of an inspection appointment
  bufferMins: 30,       // gap required between back-to-back appointments
  hours: {
    Mon:{open:true,start:"08:00",end:"17:00"},
    Tue:{open:true,start:"08:00",end:"17:00"},
    Wed:{open:true,start:"08:00",end:"17:00"},
    Thu:{open:true,start:"08:00",end:"17:00"},
    Fri:{open:true,start:"08:00",end:"17:00"},
    Sat:{open:false,start:"09:00",end:"13:00"},
    Sun:{open:false,start:"09:00",end:"13:00"},
  },
};

// ─── STYLE HELPERS ────────────────────────────────────────────────────────────
const T = {
  head: (sz=15,wt=600) => ({ fontFamily:"'Space Grotesk',sans-serif", fontSize:sz, fontWeight:wt, color:C.text }),
  label: { fontSize:11, fontWeight:600, color:C.textMuted, textTransform:"uppercase", letterSpacing:"0.07em" },
};
const card = (extra={}) => ({ background:C.card, border:`1px solid ${C.border}`, borderRadius:10, padding:20, ...extra });
const flex = (gap=0,align="center",justify="flex-start") => ({ display:"flex",alignItems:align,justifyContent:justify,gap });
const grid = (cols,gap=12) => ({ display:"grid", gridTemplateColumns:cols, gap });

// ─── UTILITY FUNCTIONS ────────────────────────────────────────────────────────
function isWithinCommWindow(comm){
  const now=new Date(),days=["Sun","Mon","Tue","Wed","Thu","Fri","Sat"],today=days[now.getDay()];
  if(!comm.activeDays.includes(today)) return false;
  const[sh,sm]=comm.activeHoursStart.split(":").map(Number),[eh]=comm.activeHoursEnd.split(":").map(Number);
  const nowM=now.getHours()*60+now.getMinutes();
  return nowM>=sh*60+sm&&nowM<=eh*60;
}
function fillTemplate(t,v){return t.replace(/{{(\w+)}}/g,(_,k)=>v[k]||"");}

// ─── LEAD DISTRIBUTION ────────────────────────────────────────────────────────
// Splits a batch of leads for one ZIP evenly across all ACTIVE roofers whose
// territory includes that ZIP, round-robin style, so no single homeowner is
// ever assigned to more than one roofer (avoids duplicate/competing SMS).
const DEMO_FIRST_NAMES=["James","Mary","Robert","Patricia","John","Jennifer","Michael","Linda","David","Barbara","William","Elizabeth","Richard","Susan","Joseph","Jessica","Thomas","Sarah","Charles","Karen"];
const DEMO_LAST_NAMES=["Smith","Johnson","Williams","Brown","Jones","Garcia","Miller","Davis","Rodriguez","Martinez","Wilson","Anderson","Taylor","Thomas","Moore","Jackson","Martin","Lee","Perez","Thompson"];
function randomDemoName(){
  const f=DEMO_FIRST_NAMES[Math.floor(Math.random()*DEMO_FIRST_NAMES.length)];
  const l=DEMO_LAST_NAMES[Math.floor(Math.random()*DEMO_LAST_NAMES.length)];
  return `${f} ${l}`;
}
function randomDemoPhone(){
  const n=()=>Math.floor(1000+Math.random()*9000);
  return `972-555-${n()}`.slice(0,12);
}
// roofersForZip: active roofers whose territories include the storm's ZIP.
// leadCount: how many homeowner leads this storm produced in that ZIP.
// Returns an array of {homeowner, phone, rooferId} — one roofer per lead,
// assigned round-robin so leads split as evenly as possible.
function distributeLeadsRoundRobin(roofersForZip, leadCount){
  if(roofersForZip.length===0) return [];
  const assignments=[];
  for(let i=0;i<leadCount;i++){
    const roofer=roofersForZip[i%roofersForZip.length];
    assignments.push({homeowner:randomDemoName(),phone:randomDemoPhone(),rooferId:roofer.id});
  }
  return assignments;
}

// ─── AVAILABILITY / SCHEDULING ENGINE ────────────────────────────────────────
// All math here works in local time using plain Date objects constructed from
// "YYYY-MM-DDTHH:MM:SS" strings — no timezone library needed since everyone
// involved (roofer, inspector, homeowner) is assumed to be in the same locale.

const DOW_NAMES=["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

function toISODate(d){ return d.toISOString().split("T")[0]; }
function pad2(n){ return String(n).padStart(2,"0"); }
function combineDateTime(dateStr,hh,mm){ return `${dateStr}T${pad2(hh)}:${pad2(mm)}:00`; }
function addMinutesISO(iso,mins){
  const d=new Date(iso);
  d.setMinutes(d.getMinutes()+mins);
  return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}:00`;
}
function formatTimeLabel(iso){
  const d=new Date(iso);
  let h=d.getHours(),m=d.getMinutes();
  const ampm=h>=12?"PM":"AM";
  h=h%12; if(h===0) h=12;
  return `${h}:${pad2(m)} ${ampm}`;
}
function formatDateLabel(iso){
  const d=new Date(iso);
  return d.toLocaleDateString(undefined,{weekday:"short",month:"short",day:"numeric"});
}

// Builds a one-click "Add to Google Calendar" link for a single appointment.
// Uses Google's public calendar render endpoint — no OAuth, no API key, no
// setup required. Works for any roofer or inspector the moment they click it.
function googleCalendarLink(ins,roofer){
  const toGCalStamp=iso=>iso.replace(/[-:]/g,"").slice(0,15); // YYYYMMDDTHHMMSS (local time, no Z)
  const start=toGCalStamp(ins.startISO);
  const end=toGCalStamp(ins.endISO);
  const title=encodeURIComponent(`Roof Inspection — ${ins.client}`);
  const details=encodeURIComponent(`Inspector: ${ins.inspector}\nCustomer: ${ins.client}${ins.phone?`\nPhone: ${ins.phone}`:""}\nBooked via SkyShield Pro (${roofer?.name||""})`);
  const location=encodeURIComponent(ins.address||"");
  return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${title}&dates=${start}/${end}&details=${details}&location=${location}`;
}

// Returns true if two [start,end) ISO ranges overlap.
function rangesOverlap(aStart,aEnd,bStart,bEnd){
  return new Date(aStart)<new Date(bEnd) && new Date(bStart)<new Date(aEnd);
}

// Checks whether a candidate appointment conflicts with any existing inspection
// for the SAME inspector, accounting for the roofer's required buffer time.
// excludeId lets a reschedule ignore the appointment being moved.
function hasConflict(inspections,inspectorId,startISO,endISO,bufferMins,excludeId){
  const bufferedStart=addMinutesISO(startISO,-bufferMins);
  const bufferedEnd=addMinutesISO(endISO,bufferMins);
  return inspections.some(ins=>{
    if(ins.id===excludeId) return false;
    if(ins.inspectorId!==inspectorId) return false;
    if(ins.status==="lost"||ins.status==="no-show") return false; // freed-up slots
    return rangesOverlap(bufferedStart,bufferedEnd,ins.startISO,ins.endISO);
  });
}

// Computes all open slots for one inspector on one given date, respecting
// operating hours, appointment duration, buffer time, and existing bookings.
function getOpenSlotsForDay(roofer,inspectorId,dateStr,excludeId){
  const sched=roofer.scheduleSettings||DEFAULT_SCHEDULE;
  const dow=DOW_NAMES[new Date(dateStr+"T12:00:00").getDay()];
  const dayHours=sched.hours[dow];
  if(!dayHours||!dayHours.open) return [];

  const[startH,startM]=dayHours.start.split(":").map(Number);
  const[endH,endM]=dayHours.end.split(":").map(Number);
  const dayStart=combineDateTime(dateStr,startH,startM);
  const dayEnd=combineDateTime(dateStr,endH,endM);
  const duration=sched.durationMins||60;
  const buffer=sched.bufferMins||0;
  const stepMins=30; // slot grid granularity — offer times on the half hour

  const slots=[];
  let cursor=dayStart;
  const now=new Date();
  while(new Date(cursor)<new Date(dayEnd)){
    const slotEnd=addMinutesISO(cursor,duration);
    if(new Date(slotEnd)<=new Date(dayEnd)){
      const inPast=new Date(cursor)<now;
      const conflict=hasConflict(roofer.inspections,inspectorId,cursor,slotEnd,buffer,excludeId);
      if(!inPast&&!conflict) slots.push({startISO:cursor,endISO:slotEnd});
    }
    cursor=addMinutesISO(cursor,stepMins);
  }
  return slots;
}

// Scans forward from today (or a given start date) across `daysAhead` days to
// find the next openings for an inspector. Returns up to `limit` results,
// each carrying both ISO times and pre-formatted labels for display.
function getNextAvailableSlots(roofer,inspectorId,{daysAhead=14,limit=8,fromDate,excludeId}={}){
  const results=[];
  const start=fromDate?new Date(fromDate):new Date();
  for(let i=0;i<daysAhead&&results.length<limit;i++){
    const d=new Date(start); d.setDate(d.getDate()+i);
    const dateStr=toISODate(d);
    const daySlots=getOpenSlotsForDay(roofer,inspectorId,dateStr,excludeId);
    for(const slot of daySlots){
      results.push({...slot,dateStr,dateLabel:formatDateLabel(slot.startISO),timeLabel:formatTimeLabel(slot.startISO)});
      if(results.length>=limit) break;
    }
  }
  return results;
}

function exportToCSV(leads,roofers,filename="leads.csv"){
  const h=["Homeowner","Phone","ZIP","Roofer","Storm","Status","Notes","Messages"];
  const rows=leads.map(l=>{const r=roofers.find(x=>x.id===l.rooferId);return[`"${l.homeowner}"`,`"${l.phone}"`,`"${l.zip}"`,`"${r?.name||""}"`,`"${l.stormType}"`,`"${l.status}"`,`"${(l.notes||"").replace(/"/g,'""')}"`,`"${l.conversations.length} msgs"`].join(",");});
  const csv=[h.join(","),...rows].join("\n"),blob=new Blob([csv],{type:"text/csv"}),url=URL.createObjectURL(blob),a=document.createElement("a");
  a.href=url;a.download=filename;a.click();URL.revokeObjectURL(url);
}

// ─── BASE UI COMPONENTS ───────────────────────────────────────────────────────
function Badge({label,color=C.orange,small=false}){
  const sz=small?10:11;
  return <span style={{display:"inline-flex",alignItems:"center",padding:small?"2px 7px":"3px 9px",borderRadius:4,fontSize:sz,fontWeight:600,background:color+"1a",color,border:`1px solid ${color}33`,letterSpacing:"0.04em",textTransform:"uppercase",whiteSpace:"nowrap",lineHeight:1.4}}>{label}</span>;
}
function Btn({children,variant="default",onClick,style={},disabled,small}){
  const V={
    default:{bg:C.card,color:C.textSub,border:C.border,hov:C.cardHov},
    primary:{bg:C.orange,color:"#fff",border:C.orange},
    success:{bg:C.green,color:"#fff",border:C.green},
    danger: {bg:C.red,  color:"#fff",border:C.red},
    info:   {bg:C.blue, color:"#fff",border:C.blue},
    ghost:  {bg:"transparent",color:C.textMuted,border:"transparent"},
    purple: {bg:C.purple,color:"#fff",border:C.purple},
  };
  const v=V[variant]||V.default;
  return <button onClick={onClick} disabled={disabled} style={{background:v.bg,color:v.color,border:`1px solid ${v.border}`,borderRadius:7,padding:small?"4px 11px":"8px 16px",fontSize:small?11:13,fontWeight:600,cursor:disabled?"not-allowed":"pointer",opacity:disabled?0.45:1,whiteSpace:"nowrap",lineHeight:1.4,...style}}>{children}</button>;
}
function Input({label,value,onChange,type="text",placeholder,style={},onKeyDown}){
  return <div style={{display:"flex",flexDirection:"column",gap:5}}>{label&&<label style={T.label}>{label}</label>}<input type={type} value={value} onChange={e=>onChange(e.target.value)} onKeyDown={onKeyDown} placeholder={placeholder} style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:7,padding:"8px 11px",color:C.text,fontSize:13,outline:"none",width:"100%",...style}}/></div>;
}
function Textarea({label,value,onChange,placeholder,rows=3}){
  return <div style={{display:"flex",flexDirection:"column",gap:5}}>{label&&<label style={T.label}>{label}</label>}<textarea value={value} onChange={e=>onChange(e.target.value)} placeholder={placeholder} rows={rows} style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:7,padding:"8px 11px",color:C.text,fontSize:13,outline:"none",width:"100%",resize:"vertical",lineHeight:1.6}}/></div>;
}
function Select({label,value,onChange,options,style={}}){
  return <div style={{display:"flex",flexDirection:"column",gap:5}}>{label&&<label style={T.label}>{label}</label>}<select value={value} onChange={e=>onChange(e.target.value)} style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:7,padding:"8px 11px",color:C.text,fontSize:13,outline:"none",width:"100%",...style}}>{options.map(o=><option key={o.value||o} value={o.value||o}>{o.label||o}</option>)}</select></div>;
}
function StatCard({label,value,sub,color=C.orange,icon}){
  return <div style={{...card(),display:"flex",flexDirection:"column",gap:6,minWidth:0}}>
    <div style={{...flex(6)}}>{icon&&<span style={{fontSize:16}}>{icon}</span>}<span style={T.label}>{label}</span></div>
    <div style={{...T.head(28,700),color,lineHeight:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{value}</div>
    {sub&&<div style={{fontSize:11,color:C.textMuted}}>{sub}</div>}
  </div>;
}
function Tabs({tabs,active,onChange}){
  return <div style={{display:"flex",borderBottom:`1px solid ${C.border}`,marginBottom:20,overflowX:"auto",gap:0}}>
    {tabs.map(t=><button key={t} onClick={()=>onChange(t)} style={{background:"none",border:"none",cursor:"pointer",padding:"10px 14px",fontSize:13,fontWeight:active===t?600:400,color:active===t?C.orange:C.textMuted,borderBottom:active===t?`2px solid ${C.orange}`:"2px solid transparent",marginBottom:-1,whiteSpace:"nowrap"}}>{t}</button>)}
  </div>;
}
function Modal({title,onClose,children,wide}){
  const w=wide?Math.min(680,window.innerWidth-32):Math.min(480,window.innerWidth-32);
  return <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.7)",zIndex:1000,display:"flex",alignItems:"center",justifyContent:"center",padding:16}} onClick={e=>e.target===e.currentTarget&&onClose()}>
    <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:12,width:w,maxHeight:"90vh",overflow:"auto",boxShadow:"0 24px 60px rgba(0,0,0,0.5)"}}>
      <div style={{...flex(0,"center","space-between"),padding:"16px 20px",borderBottom:`1px solid ${C.border}`}}>
        <span style={T.head(15,600)}>{title}</span>
        <button onClick={onClose} style={{background:"none",border:"none",color:C.textMuted,cursor:"pointer",fontSize:22,lineHeight:1,padding:"0 4px"}}>×</button>
      </div>
      <div style={{padding:20}}>{children}</div>
    </div>
  </div>;
}
function Divider(){return <div style={{height:1,background:C.border,margin:"4px 0"}}/>;}
function SeverityBadge({severity}){return <Badge label={severity} color={{extreme:C.red,severe:C.orange,moderate:C.yellow}[severity]||C.blue}/>;}
function StatusBadge({status}){return <Badge label={status} color={{active:C.green,trial:C.yellow,cancelled:C.red,pending:C.orange,contacted:C.blue,scheduled:C.green,won:C.purple,cold:C.textMuted}[status]||C.textMuted}/>;}

function MiniBarChart({data}){
  const max=Math.max(...data.map(d=>d.value),1);
  return <div style={{display:"flex",alignItems:"flex-end",gap:8,height:72,padding:"4px 0"}}>
    {data.map((d,i)=><div key={i} style={{display:"flex",flexDirection:"column",alignItems:"center",flex:1,gap:4}}>
      <div style={{width:"60%",background:d.color||C.orange,height:`${Math.max((d.value/max)*56,d.value>0?3:0)}px`,borderRadius:"3px 3px 0 0",opacity:0.85}}/>
      <div style={{fontSize:9,color:C.textMuted,textAlign:"center",lineHeight:1.2}}>{d.label}</div>
    </div>)}
  </div>;
}

// ─── TABLE WRAPPER ────────────────────────────────────────────────────────────
function TableWrap({headers,children,empty}){
  return <div style={{...card({padding:0}),overflow:"hidden"}}>
    <div style={{overflowX:"auto"}}>
      <table style={{width:"100%",borderCollapse:"collapse",minWidth:500}}>
        <thead><tr style={{background:C.surface}}>
          {headers.map(h=><th key={h} style={{padding:"10px 14px",textAlign:"left",...T.label,fontWeight:600}}>{h}</th>)}
        </tr></thead>
        <tbody>{children}</tbody>
      </table>
    </div>
    {empty&&<div style={{padding:28,textAlign:"center",color:C.textMuted,fontSize:13}}>{empty}</div>}
  </div>;
}
function TR({children,highlight}){return <tr style={{borderBottom:`1px solid ${C.border}`,background:highlight?"rgba(46,204,113,0.03)":undefined}}>{children}</tr>;}
function TD({children,sub,bold,dim,mono,nowrap,style={}}){
  return <td style={{padding:"10px 14px",fontSize:13,fontWeight:bold?600:400,color:dim?C.textSub:C.text,fontFamily:mono?"monospace":undefined,whiteSpace:nowrap?"nowrap":undefined,...style}}>
    {children}{sub&&<div style={{fontSize:11,color:C.textMuted,marginTop:2}}>{sub}</div>}
  </td>;
}

// ─── API / NETWORK ────────────────────────────────────────────────────────────
async function callClaude(messages,system="",max_tokens=1200){
  const res=await fetch("/api/claude",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({messages,system:system||undefined,max_tokens})});
  const data=await res.json();
  if(data.error) throw new Error(data.error);
  return data.content?.map(b=>b.text||"").join("")||"No response";
}

// ─── LEAD-FACING AI CONVERSATION HANDLER ─────────────────────────────────────
// Generates the AI's next SMS reply to a homeowner lead. Enforces a hard
// requirement (when roofer.commSettings.requireAdultPresent is true): the AI
// must get an explicit yes/no on "will an adult 18+ be present" before it is
// allowed to offer or confirm any appointment time. This is a safety/liability
// gate, not a suggestion — the prompt instructs Claude to refuse to schedule
// until that confirmation is obtained, and the app double-checks lead.adultConfirmed
// before ever actually booking a slot.
async function generateLeadReply(lead,roofer,conversationHistory){
  const comm=roofer.commSettings||DEFAULT_COMM;
  const requireAdult=comm.requireAdultPresent!==false;
  const adultStatus=lead.adultConfirmed||"unconfirmed";

  const sys=`You are an SMS scheduling assistant texting on behalf of ${roofer.name}, a roofing company, with a potential customer named ${lead.homeowner} whose home in ZIP ${lead.zip} was affected by a ${lead.stormType} storm.

Your job: build rapport, confirm interest in a free roof inspection, and move toward booking an appointment.

${requireAdult?`CRITICAL SAFETY RULE — NON-NEGOTIABLE: Before you may offer or confirm ANY appointment time, you must first get an explicit, unambiguous "yes" that someone 18 years or older will be present at the home during the inspection. Do not skip, soften, or assume this. If the homeowner has not yet confirmed this and the conversation is moving toward scheduling, your NEXT message must ask this directly (you can use natural phrasing, e.g. "${comm.templates.adultCheck||"Will someone 18 or older be home during the inspection?"}"). If they say no or refuse to answer, do not schedule — politely explain that an adult needs to be present for the inspection and ask them to let you know when that's possible. Current adult-confirmation status for this lead: ${adultStatus}.`:""}

Keep replies short (SMS-length, under 300 characters), warm, and conversational — not robotic or formal. Never make up specific appointment times yourself; that's handled separately by the app once adult presence is confirmed.

Respond with ONLY a JSON object, no other text, in this exact shape:
{"reply":"the SMS text to send","adultConfirmed":"confirmed"|"denied"|"unconfirmed","readyToSchedule":true|false,"needsHumanReview":true|false}

Set adultConfirmed to "confirmed" only on an explicit yes. Set it to "denied" if they say no or refuse. Otherwise leave it "unconfirmed". Set readyToSchedule to true ONLY if adultConfirmed is "confirmed" AND the homeowner has clearly agreed to be scheduled. Set needsHumanReview to true if the homeowner asks something you can't safely answer (pricing specifics, complaints, anything adversarial, or repeated refusal).`;

  const messages=(conversationHistory||[]).map(c=>({role:c.role==="lead"?"user":"assistant",content:c.msg}));

  const raw=await callClaude(messages,sys,400);
  try{
    const cleaned=raw.replace(/```json|```/g,"").trim();
    const parsed=JSON.parse(cleaned);
    return {
      reply: parsed.reply || "Thanks for the reply — someone from our team will follow up shortly!",
      adultConfirmed: ["confirmed","denied","unconfirmed"].includes(parsed.adultConfirmed) ? parsed.adultConfirmed : adultStatus,
      readyToSchedule: !!parsed.readyToSchedule,
      needsHumanReview: !!parsed.needsHumanReview,
    };
  }catch(e){
    // If parsing fails, fail safe: don't schedule, flag for a human.
    return { reply: raw.slice(0,300), adultConfirmed: adultStatus, readyToSchedule:false, needsHumanReview:true };
  }
}

async function sendTwilioSMS(creds,to,body,fromOverride){
  const{sid,token,from}=creds;
  const fromNumber=fromOverride||from;
  await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,{method:"POST",headers:{"Authorization":`Basic ${btoa(sid+":"+token)}`,"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({To:to,From:fromNumber,Body:body})});
}
async function fetchWeatherAlerts(apiKey,zip){
  const res=await fetch(`https://api.weatherapi.com/v1/alerts.json?key=${apiKey}&q=${zip}`);
  return res.json();
}
let _gcalToken=null,_gcalExpiry=0;
async function getGCalAccessToken(creds){
  if(_gcalToken&&Date.now()<_gcalExpiry-60000) return _gcalToken;
  const res=await fetch("https://oauth2.googleapis.com/token",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({client_id:creds.clientId,client_secret:creds.clientSecret,refresh_token:creds.refreshToken,grant_type:"refresh_token"})});
  const d=await res.json();
  if(d.error) throw new Error(d.error_description||d.error);
  _gcalToken=d.access_token;_gcalExpiry=Date.now()+d.expires_in*1000;
  return _gcalToken;
}

// ─── ACTIVITY FEED ────────────────────────────────────────────────────────────
const ACT_ICONS={storm:"◆",lead:"◈",sms:"→",booking:"▦",revenue:"$",roofer:"◈",system:"◆",followup:"↺"};
function ActivityFeed({activities}){
  if(!activities.length) return <div style={{padding:28,textAlign:"center",color:C.textMuted,fontSize:13}}>No activity recorded yet.</div>;
  return <div>{activities.slice(0,60).map((a,i)=>(
    <div key={i} style={{...flex(12,"flex-start"),padding:"10px 0",borderBottom:`1px solid ${C.border}`}}>
      <div style={{fontSize:15,minWidth:22,marginTop:1}}>{ACT_ICONS[a.type]||"·"}</div>
      <div style={{flex:1,minWidth:0}}>
        <div style={{fontSize:13,color:C.text,lineHeight:1.5}}>{a.message}</div>
        <div style={{fontSize:11,color:C.textMuted,marginTop:2}}>{a.ts}</div>
      </div>
      {a.badge&&<Badge label={a.badge} color={a.badgeColor||C.orange} small/>}
    </div>
  ))}</div>;
}

// ─── NOTIFICATION BELL ────────────────────────────────────────────────────────
// Shows a roofer's own notifications (new bookings, reschedules) with an
// unread count badge. Clicking the bell opens a dropdown and marks them read.
function NotificationBell({roofer,onMarkRead}){
  const[open,setOpen]=useState(false);
  const notifications=roofer.notifications||[];
  const unreadCount=notifications.filter(n=>!n.read).length;
  const ref=useRef(null);

  useEffect(()=>{
    function handleClickOutside(e){ if(ref.current&&!ref.current.contains(e.target)) setOpen(false); }
    document.addEventListener("mousedown",handleClickOutside);
    return()=>document.removeEventListener("mousedown",handleClickOutside);
  },[]);

  function toggle(){
    const next=!open;
    setOpen(next);
    if(next&&unreadCount>0) onMarkRead();
  }

  return <div ref={ref} style={{position:"relative"}}>
    <button onClick={toggle} style={{background:"none",border:"none",cursor:"pointer",position:"relative",padding:"6px",fontSize:18,lineHeight:1,color:C.textSub}}>
      ◉
      {unreadCount>0&&<span style={{position:"absolute",top:0,right:0,background:C.red,color:"#fff",borderRadius:"50%",minWidth:16,height:16,fontSize:10,display:"flex",alignItems:"center",justifyContent:"center",fontWeight:700,padding:"0 3px"}}>{unreadCount>9?"9+":unreadCount}</span>}
    </button>
    {open&&<div style={{position:"absolute",top:"calc(100% + 8px)",right:0,width:320,maxHeight:380,overflowY:"auto",background:C.card,border:`1px solid ${C.border}`,borderRadius:10,boxShadow:"0 16px 40px rgba(0,0,0,0.5)",zIndex:200}}>
      <div style={{padding:"12px 14px",borderBottom:`1px solid ${C.border}`,fontSize:13,fontWeight:600,color:C.text}}>Notifications</div>
      {notifications.length===0
        ?<div style={{padding:24,textAlign:"center",fontSize:12,color:C.textMuted}}>No notifications yet.</div>
        :notifications.map(n=>
          <div key={n.id} style={{padding:"10px 14px",borderBottom:`1px solid ${C.border}`,background:n.read?"transparent":C.orangeDim}}>
            <div style={{fontSize:12,color:C.text,lineHeight:1.5}}>{n.message}</div>
            <div style={{fontSize:10,color:C.textMuted,marginTop:3}}>{n.ts}</div>
          </div>
        )}
    </div>}
  </div>;
}


function StormMap({storms,roofers}){
  const mapRef=useRef(null),inst=useRef(null);
  useEffect(()=>{
    if(inst.current||!window.L) return;
    const L=window.L;
    const map=L.map(mapRef.current,{center:[33.05,-96.72],zoom:9});
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",{attribution:"© OpenStreetMap"}).addTo(map);
    inst.current=map;
    const sc={extreme:C.red,severe:C.orange,moderate:C.yellow};
    storms.filter(s=>s.lat&&s.lng).forEach(st=>{
      L.circleMarker([st.lat,st.lng],{radius:13,fillColor:sc[st.severity]||C.blue,color:"#fff",weight:2,opacity:1,fillOpacity:0.85}).addTo(map).bindPopup(`<b>${st.type}</b><br>${st.location}<br>ZIP: ${st.zip}<br>Severity: ${st.severity}<br>${st.date}`);
    });
    const zc=[C.blue,C.purple,C.green,C.orange,C.red];
    roofers.forEach((r,ri)=>r.territories.forEach(zip=>{
      const st=storms.find(s=>s.zip===zip&&s.lat&&s.lng);
      if(st) L.circle([st.lat,st.lng],{radius:8500,fillColor:zc[ri%zc.length],color:zc[ri%zc.length],weight:1,opacity:0.4,fillOpacity:0.06}).addTo(map).bindPopup(`<b>${r.name}</b><br>Territory: ${zip}`);
    }));
    return()=>{if(inst.current){inst.current.remove();inst.current=null;}};
  },[]);
  return <div style={{borderRadius:10,overflow:"hidden",border:`1px solid ${C.border}`}}>
    <div style={{...flex(10,"center","space-between"),padding:"12px 16px",background:C.surface,borderBottom:`1px solid ${C.border}`}}>
      <span style={T.head(13,600)}>🗺 Storm Map</span>
      <div style={flex(12)}>
        {[{l:"Extreme",c:C.red},{l:"Severe",c:C.orange},{l:"Moderate",c:C.yellow}].map(x=>(
          <div key={x.l} style={flex(5)}><div style={{width:8,height:8,borderRadius:"50%",background:x.c}}/><span style={{fontSize:11,color:C.textSub}}>{x.l}</span></div>
        ))}
      </div>
    </div>
    <div ref={mapRef} style={{height:340,background:C.surface}}/>
  </div>;
}

// ─── AI AGENT ─────────────────────────────────────────────────────────────────
// ─── FLOATING AI HELP WIDGET ─────────────────────────────────────────────────
// A persistent chat bubble in the bottom-right corner of every screen.
// Context-aware — knows the current user's role, what's on screen, and can
// explain any feature or guide them through any action step by step.
function FloatingAIHelp({role, roofer, roofers, leads, storms, currentSection}){
  const[open,setOpen]=useState(false);
  const[msgs,setMsgs]=useState([]);
  const[input,setInput]=useState("");
  const[loading,setLoading]=useState(false);
  const[unread,setUnread]=useState(0);
  const bottomRef=useRef(null);
  const inputRef=useRef(null);

  useEffect(()=>{
    if(open){
      setUnread(0);
      setTimeout(()=>inputRef.current?.focus(),100);
    }
  },[open]);
  useEffect(()=>{ bottomRef.current?.scrollIntoView({behavior:"smooth"}); },[msgs]);

  // Greet on first open
  useEffect(()=>{
    if(open&&msgs.length===0){
      const greeting = role==="admin"
        ? "Hi Noah 👋 I'm your SkyShield Pro assistant. I can help you manage roofers, understand your dashboard, walk you through any feature, or answer questions about the app. What do you need?"
        : `Hi ${roofer?.name||"there"} 👋 I'm your SkyShield Pro assistant. I can help you navigate the app, understand your leads, explain any feature, or walk you through booking an inspection. What can I help with?`;
      setMsgs([{role:"assistant",content:greeting}]);
    }
  },[open]);

  const sys = role==="admin"
    ? `You are SkyShield Pro AI — a helpful in-app assistant for Noah, the admin of SkyShield Pro, a roofing CRM SaaS built by Ark Dynamics.

Your job is to help Noah navigate the app, understand features, troubleshoot issues, and manage his business. Be concise, friendly, and practical. Use bullet points for step-by-step instructions.

CURRENT SECTION: ${currentSection||"Dashboard"}
ROOFERS: ${roofers?.length||0} total, ${roofers?.filter(r=>r.status==="active").length||0} active
LEADS: ${leads?.length||0} total, ${leads?.filter(l=>l.status==="pending").length||0} pending
STORMS: ${storms?.length||0} tracked

APP SECTIONS:
- Command Center: manage roofers, view all leads, storm map, activity feed, AI agent for bulk actions
- Subscriptions & Billing: manage plans, activate/cancel roofers, track MRR, pricing editor
- API Settings: configure Twilio (SMS), WeatherAPI (storm scanning), Google Calendar, Stripe, ATTOM data

KEY FEATURES TO EXPLAIN IF ASKED:
- Storm scanning: auto-detects storms and contacts leads in affected ZIP codes
- Lead pipeline: pending → contacted → scheduled → won
- Per-roofer Twilio numbers: each roofer gets their own SMS number
- AI auto-reply: roofers can enable AI to reply to leads automatically
- Adult presence verification: required before any inspection is booked
- Round-robin lead distribution: leads split fairly across roofers in a ZIP
- Native scheduling: real availability engine with conflict detection
- Stripe billing: activating a roofer creates a subscription and sends them a payment link

Answer questions about the app helpfully. If asked to do something that requires navigating somewhere, tell them exactly where to go step by step.`
    : `You are SkyShield Pro AI — a helpful in-app assistant for ${roofer?.name||"a roofer"} using SkyShield Pro, a roofing CRM by Ark Dynamics.

Your job is to help this roofer navigate the app, understand their leads, and make the most of their tools. Be warm, concise, and practical.

CURRENT SECTION: ${currentSection||"Dashboard"}
THIS ROOFER: ${JSON.stringify({name:roofer?.name,plan:roofer?.plan,territories:roofer?.territories,leads:leads?.length||0})}

ROOFER APP SECTIONS:
- Dashboard: overview of leads, revenue, and inspections
- Leads: manage all your leads, send SMS, book inspections
- Calendar: view and manage upcoming inspections
- Conversations: read and reply to lead text messages
- Settings: comm settings, schedule, inspector management
- AI Agent: use AI to manage leads by typing commands

Explain features clearly. If they ask how to do something, walk them through it step by step. Keep replies short enough to read on a screen.`;

  async function send(){
    if(!input.trim()||loading) return;
    const userMsg={role:"user",content:input};
    const newMsgs=[...msgs,userMsg];
    setMsgs(newMsgs);
    setInput("");
    setLoading(true);
    try{
      const reply=await callClaude(newMsgs,sys,600);
      setMsgs(m=>[...m,{role:"assistant",content:reply}]);
      if(!open) setUnread(u=>u+1);
    }catch(e){
      setMsgs(m=>[...m,{role:"assistant",content:"Sorry, something went wrong. Try again in a moment."}]);
    }
    setLoading(false);
  }

  const SUGGESTIONS = role==="admin"
    ? ["How do I add a roofer?","How does billing work?","How do I scan for storms?","What does round-robin mean?"]
    : ["How do I book an inspection?","What does 'contacted' status mean?","How do I reply to a lead?","How do I add an inspector?"];

  return(
    <>
      {/* Chat window */}
      {open&&<div style={{
        position:"fixed",bottom:84,right:24,zIndex:9998,
        width:360,height:480,
        background:C.card,
        border:`1px solid ${C.borderAct}`,
        borderRadius:18,
        display:"flex",flexDirection:"column",
        boxShadow:`0 24px 60px rgba(0,0,0,0.5),0 0 0 1px ${C.orange}22`,
        overflow:"hidden",
      }}>
        {/* Header */}
        <div style={{
          padding:"14px 16px",
          background:`linear-gradient(135deg,rgba(13,148,136,0.2),rgba(2,132,199,0.15))`,
          borderBottom:`1px solid ${C.border}`,
          display:"flex",alignItems:"center",justifyContent:"space-between",
          flexShrink:0,
        }}>
          <div style={{display:"flex",alignItems:"center",gap:10}}>
            <div style={{
              width:32,height:32,borderRadius:10,
              background:"linear-gradient(135deg,#0d9488,#0284c7)",
              display:"flex",alignItems:"center",justifyContent:"center",fontSize:16,
              boxShadow:"0 4px 12px rgba(13,148,136,0.4)",
            }}>✦</div>
            <div>
              <div style={{fontSize:13,fontWeight:700,color:C.text}}>SkyShield Assistant</div>
              <div style={{fontSize:10,color:C.textSub}}>Powered by Claude · Always here to help</div>
            </div>
          </div>
          <button onClick={()=>setOpen(false)} style={{
            background:"none",border:"none",cursor:"pointer",
            color:C.textMuted,fontSize:18,lineHeight:1,padding:4,
          }}>✕</button>
        </div>

        {/* Messages */}
        <div style={{flex:1,overflowY:"auto",padding:"12px 14px",display:"flex",flexDirection:"column",gap:10}}>
          {msgs.map((m,i)=>(
            <div key={i} style={{
              maxWidth:"88%",
              alignSelf:m.role==="user"?"flex-end":"flex-start",
              background:m.role==="user"?C.orangeDim:C.surface,
              border:`1px solid ${m.role==="user"?C.orange+"33":C.border}`,
              borderRadius:m.role==="user"?"12px 12px 3px 12px":"12px 12px 12px 3px",
              padding:"9px 13px",
              fontSize:12,lineHeight:1.6,color:C.text,
              whiteSpace:"pre-wrap",wordBreak:"break-word",
            }}>{m.content}</div>
          ))}
          {loading&&<div style={{
            alignSelf:"flex-start",background:C.surface,
            border:`1px solid ${C.border}`,borderRadius:"12px 12px 12px 3px",
            padding:"9px 13px",fontSize:12,color:C.textMuted,
          }}>
            <span style={{animation:"pulse 1s infinite"}}>⏳ Thinking...</span>
          </div>}
          {/* Quick suggestion chips — only show when no messages yet */}
          {msgs.length<=1&&!loading&&<div style={{display:"flex",flexWrap:"wrap",gap:6,marginTop:4}}>
            {SUGGESTIONS.map(s=>(
              <button key={s} onClick={()=>{ setInput(s); setTimeout(()=>inputRef.current?.focus(),50); }}
                style={{
                  fontSize:11,fontWeight:500,padding:"5px 11px",borderRadius:20,
                  background:C.orangeDim,color:C.orange,
                  border:`1px solid ${C.orange}33`,cursor:"pointer",
                  textAlign:"left",lineHeight:1.4,
                }}>{s}</button>
            ))}
          </div>}
          <div ref={bottomRef}/>
        </div>

        {/* Input */}
        <div style={{
          padding:"10px 12px",
          borderTop:`1px solid ${C.border}`,
          display:"flex",gap:8,flexShrink:0,
          background:C.surface,
        }}>
          <input ref={inputRef} value={input}
            onChange={e=>setInput(e.target.value)}
            onKeyDown={e=>e.key==="Enter"&&!e.shiftKey&&send()}
            placeholder="Ask me anything about the app..."
            style={{
              flex:1,background:C.card,
              border:`1px solid ${C.border}`,
              borderRadius:10,padding:"8px 12px",
              color:C.text,fontSize:12,outline:"none",
            }}/>
          <button onClick={send} disabled={loading||!input.trim()} style={{
            width:36,height:36,borderRadius:10,flexShrink:0,
            background:input.trim()&&!loading?"linear-gradient(135deg,#0d9488,#0284c7)":C.border,
            border:"none",cursor:input.trim()&&!loading?"pointer":"default",
            display:"flex",alignItems:"center",justifyContent:"center",
            fontSize:16,transition:"background 0.15s",
          }}>➤</button>
        </div>
      </div>}

      {/* Floating bubble button */}
      <button onClick={()=>setOpen(o=>!o)} style={{
        position:"fixed",bottom:24,right:24,zIndex:9999,
        width:52,height:52,borderRadius:"50%",
        background:"linear-gradient(135deg,#0d9488,#0284c7)",
        border:"none",cursor:"pointer",
        display:"flex",alignItems:"center",justifyContent:"center",
        fontSize:22,
        boxShadow:"0 4px 20px rgba(13,148,136,0.5),0 2px 8px rgba(0,0,0,0.3)",
        transition:"transform 0.15s,box-shadow 0.15s",
      }}
        onMouseEnter={e=>e.currentTarget.style.transform="scale(1.1)"}
        onMouseLeave={e=>e.currentTarget.style.transform="scale(1)"}
      >
        {open?"✕":"✦"}
        {/* Unread badge */}
        {!open&&unread>0&&<div style={{
          position:"absolute",top:0,right:0,
          width:18,height:18,borderRadius:"50%",
          background:C.red,color:"#fff",
          fontSize:10,fontWeight:700,
          display:"flex",alignItems:"center",justifyContent:"center",
          border:`2px solid ${C.bg}`,
        }}>{unread}</div>}
      </button>
    </>
  );
}

function AIAgent({roofers,leads,storms,apiKeys,onUpdate,context}){
  const[msgs,setMsgs]=useState([]),[input,setInput]=useState(""),[loading,setLoading]=useState(false);
  const bottomRef=useRef(null);
  useEffect(()=>bottomRef.current?.scrollIntoView({behavior:"smooth"}),[msgs]);

  const sys=`You are SkyShield Pro AI — a CRM assistant for a roofing lead platform by Ark Dynamics.
${context}
ROOFERS: ${JSON.stringify(roofers.map(r=>({id:r.id,name:r.name,plan:r.plan,status:r.status,territories:r.territories,leads:r.leads,booked:r.booked,revenue:r.revenue})))}
LEADS: ${JSON.stringify(leads.map(l=>({id:l.id,homeowner:l.homeowner,zip:l.zip,rooferId:l.rooferId,stormType:l.stormType,status:l.status,notes:l.notes})))}
STORMS: ${JSON.stringify(storms)}
Perform CRM actions by appending <ACTION>{"type":"...","payload":{...}}</ACTION> at the end of your message.
Actions: add_roofer, delete_roofer, edit_roofer, add_lead, delete_lead, edit_lead, lead_status, update_roofer_plan, update_roofer_status, update_lead_notes.
Always explain in plain English first, then include action blocks. Ask for clarification if ambiguous.`;

  async function send(){
    if(!input.trim()) return;
    const userMsg={role:"user",content:input},newMsgs=[...msgs,userMsg];
    setMsgs(newMsgs);setInput("");setLoading(true);
    try{
      const reply=await callClaude(newMsgs,sys,1400);
      const ar=/<ACTION>([\s\S]*?)<\/ACTION>/g;let m;
      while((m=ar.exec(reply))!==null){
        try{
          const{type,payload}=JSON.parse(m[1]);
          if(type==="add_roofer") onUpdate("add_roofer",{roofer:{id:"r"+Date.now(),revenue:0,leads:0,booked:0,status:"trial",inspectors:[],inspections:[],revenueLog:[],commSettings:{...DEFAULT_COMM},scheduleSettings:{...DEFAULT_SCHEDULE},notifications:[],pin:"0000",...payload}});
          else if(type==="delete_roofer") onUpdate("delete_roofer",payload);
          else if(type==="edit_roofer") onUpdate("edit_roofer",payload);
          else if(type==="add_lead") onUpdate("add_lead",{lead:{id:"l"+Date.now(),conversations:[],notes:"",contactedAt:null,followupSent:false,...payload}});
          else if(type==="delete_lead") onUpdate("delete_lead",payload);
          else if(type==="edit_lead") onUpdate("edit_lead",payload);
          else if(type==="lead_status") onUpdate("lead_status",payload);
          else if(type==="update_roofer_plan") onUpdate("update_roofer_plan",payload);
          else if(type==="update_roofer_status") onUpdate("update_roofer_status",payload);
          else if(type==="update_lead_notes") onUpdate("update_lead_notes",payload);
        }catch(e){console.error("Action err",e);}
      }
      setMsgs([...newMsgs,{role:"assistant",content:reply.replace(/<ACTION>[\s\S]*?<\/ACTION>/g,"").trim()}]);
    }catch(e){setMsgs([...newMsgs,{role:"assistant",content:`Error: ${e.message}`}]);}
    setLoading(false);
  }

  return <div style={{display:"flex",flexDirection:"column",height:500,...card()}}>
    <div style={{marginBottom:10,padding:"8px 12px",background:C.greenDim,borderRadius:6,fontSize:12,color:C.green,border:`1px solid ${C.green}22`}}>
      AI Agent active — type commands like "Add Blue Sky Roofing in ZIP 75001 on Pro plan" or "Delete Tom Wiley's lead"
    </div>
    <div style={{flex:1,overflow:"auto",display:"flex",flexDirection:"column",gap:8,padding:2,marginBottom:12}}>
      {msgs.length===0&&<div style={{textAlign:"center",color:C.textMuted,padding:40,fontSize:13,lineHeight:1.7}}>
        <div style={{fontSize:28,marginBottom:12}}>✦</div>
        Try: <strong>"Show all pending leads"</strong> · <strong>"Add a roofer"</strong> · <strong>"Change Apex plan to Elite"</strong>
      </div>}
      {msgs.map((m,i)=><div key={i} style={{padding:"10px 14px",borderRadius:8,fontSize:13,lineHeight:1.6,background:m.role==="user"?C.orangeDim:C.surface,border:`1px solid ${m.role==="user"?C.orange+"33":C.border}`,alignSelf:m.role==="user"?"flex-end":"flex-start",maxWidth:"85%",whiteSpace:"pre-wrap"}}>{m.content}</div>)}
      {loading&&<div style={{padding:"10px 14px",borderRadius:8,background:C.surface,border:`1px solid ${C.border}`,alignSelf:"flex-start",fontSize:13,color:C.textMuted}}>⏳ Thinking...</div>}
      <div ref={bottomRef}/>
    </div>
    <div style={{...flex(8),borderTop:`1px solid ${C.border}`,paddingTop:10}}>
      <input value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>e.key==="Enter"&&!e.shiftKey&&send()}
        placeholder="Command the AI agent..." style={{flex:1,background:C.surface,border:`1px solid ${C.border}`,borderRadius:7,padding:"9px 12px",color:C.text,fontSize:13,outline:"none"}}/>
      <Btn variant="primary" onClick={send} disabled={loading||!input.trim()}>Send</Btn>
    </div>
  </div>;
}

// ─── MODALS ───────────────────────────────────────────────────────────────────
function ConversationModal({lead,roofer,onClose,onSendMessage,onUpdateNotes}){
  const[msg,setMsg]=useState(""),[notes,setNotes]=useState(lead.notes||""),[editing,setEditing]=useState(false);
  const bot=useRef(null);
  useEffect(()=>bot.current?.scrollIntoView({behavior:"smooth"}),[lead.conversations]);
  return <Modal title={`${lead.homeowner} — ${lead.phone}`} onClose={onClose} wide>
    <div style={{display:"flex",flexDirection:"column",gap:12}}>
      <div style={{...flex(12,"center","space-between"),padding:"8px 12px",background:C.surface,borderRadius:7,flexWrap:"wrap",gap:6}}>
        <div style={flex(12)}><span style={{fontSize:12,color:C.textSub}}>{lead.address?`${lead.address}, `:""}ZIP {lead.zip}</span><span style={{fontSize:12,color:C.textSub}}>⛈ {lead.stormType}</span></div>
        <div style={flex(6)}><StatusBadge status={lead.status}/><AdultBadge status={lead.adultConfirmed}/></div>
      </div>
      <div style={{...card({padding:12})}}>
        <div style={{...flex(0,"center","space-between"),marginBottom:editing?8:0}}>
          <span style={T.label}>Notes</span>
          <Btn small variant="ghost" onClick={()=>{if(editing)onUpdateNotes(lead.id,notes);setEditing(!editing);}}>{editing?"Save Notes":"Edit"}</Btn>
        </div>
        {editing?<Textarea value={notes} onChange={setNotes} placeholder="Add notes about this lead..." rows={2}/>:<div style={{fontSize:13,color:notes?C.text:C.textMuted,lineHeight:1.6}}>{notes||"No notes yet — click Edit to add."}</div>}
      </div>
      <div style={{height:270,overflow:"auto",display:"flex",flexDirection:"column",gap:8,padding:2}}>
        {lead.conversations.length===0&&<div style={{textAlign:"center",color:C.textMuted,padding:40,fontSize:13}}>No messages yet.</div>}
        {lead.conversations.map((c,i)=><div key={i} style={{display:"flex",flexDirection:"column",alignItems:c.role==="ai"?"flex-start":"flex-end"}}>
          <div style={{padding:"8px 12px",borderRadius:8,fontSize:13,lineHeight:1.6,maxWidth:"82%",background:c.role==="ai"?C.blueDim:C.greenDim,border:`1px solid ${c.role==="ai"?C.blue+"28":C.green+"28"}`,whiteSpace:"pre-wrap"}}>{c.msg}</div>
          <div style={{fontSize:10,color:C.textMuted,marginTop:2}}>{c.role==="ai"?"AI Agent":"Lead"} · {c.ts}</div>
        </div>)}
        <div ref={bot}/>
      </div>
      <div style={{borderTop:`1px solid ${C.border}`,paddingTop:10}}>
        {roofer&&!isWithinCommWindow(roofer.commSettings)&&<div style={{marginBottom:8}}><Badge label="Outside active comm hours" color={C.yellow} small/></div>}
        <div style={flex(8)}>
          <input value={msg} onChange={e=>setMsg(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey&&msg.trim()){onSendMessage(lead,msg);setMsg("");}}} placeholder="Type a message to send..." style={{flex:1,background:C.surface,border:`1px solid ${C.border}`,borderRadius:7,padding:"9px 12px",color:C.text,fontSize:13,outline:"none"}}/>
          <Btn variant="primary" onClick={()=>{if(msg.trim()){onSendMessage(lead,msg);setMsg("");}}}>Send</Btn>
        </div>
      </div>
    </div>
  </Modal>;
}

function LogRevenueModal({lead,onClose,onSave}){
  const[amount,setAmount]=useState(""),[note,setNote]=useState("");
  return <Modal title="Log Won Job" onClose={onClose}>
    <div style={{display:"flex",flexDirection:"column",gap:14}}>
      <div style={{padding:"10px 14px",background:C.greenDim,borderRadius:7,fontSize:13,border:`1px solid ${C.green}22`}}>Logging revenue for <strong>{lead.homeowner}</strong></div>
      <Input label="Job Amount ($)" type="number" value={amount} onChange={setAmount} placeholder="8500"/>
      <Input label="Note" value={note} onChange={setNote} placeholder="Full replacement, insurance claim"/>
      <div style={{...flex(8,"center","flex-end"),marginTop:4}}>
        <Btn onClick={onClose}>Cancel</Btn>
        <Btn variant="success" onClick={()=>{if(!amount)return;onSave({id:"rv"+Date.now(),leadId:lead.id,homeowner:lead.homeowner,amount:Number(amount),date:new Date().toISOString().split("T")[0],note});onClose();}}>Log Revenue</Btn>
      </div>
    </div>
  </Modal>;
}

function CommSettingsPanel({roofer,onSave}){
  const[cfg,setCfg]=useState(roofer.commSettings||DEFAULT_COMM);
  const f=k=>v=>setCfg(p=>({...p,[k]:v}));
  const ft=k=>v=>setCfg(p=>({...p,templates:{...p.templates,[k]:v}}));
  function toggleDay(day){setCfg(p=>({...p,activeDays:p.activeDays.includes(day)?p.activeDays.filter(d=>d!==day):[...p.activeDays,day]}));}
  return <div style={{display:"flex",flexDirection:"column",gap:16}}>
    <div style={card()}>
      <div style={{...T.head(14,600),marginBottom:14}}>⏰ Active Hours & Follow-Up</div>
      <div style={{...grid("1fr 1fr",12),marginBottom:14}}>
        <Input label="Start Time" type="time" value={cfg.activeHoursStart} onChange={f("activeHoursStart")}/>
        <Input label="End Time" type="time" value={cfg.activeHoursEnd} onChange={f("activeHoursEnd")}/>
      </div>
      <div style={{marginBottom:14}}>
        <div style={{...T.label,marginBottom:8}}>Active Days</div>
        <div style={{...flex(6),flexWrap:"wrap"}}>
          {DAYS_OF_WEEK.map(d=><button key={d} onClick={()=>toggleDay(d)} style={{padding:"5px 11px",borderRadius:6,fontSize:12,fontWeight:600,cursor:"pointer",background:cfg.activeDays.includes(d)?C.orange:C.surface,color:cfg.activeDays.includes(d)?"#fff":C.textSub,border:`1px solid ${cfg.activeDays.includes(d)?C.orange:C.border}`}}>{d}</button>)}
        </div>
      </div>
      <div style={grid("1fr 1fr",12)}>
        <Input label="Follow-up after (days)" type="number" value={cfg.followupDays||2} onChange={v=>setCfg(p=>({...p,followupDays:Number(v)}))}/>
        <Input label="Mark cold after (days)" type="number" value={cfg.coldDays||5} onChange={v=>setCfg(p=>({...p,coldDays:Number(v)}))}/>
      </div>
      <div style={{marginTop:12,padding:"8px 12px",background:C.orangeDim,borderRadius:6,fontSize:12,color:C.textSub,border:`1px solid ${C.orange}22`}}>
        Status: <span style={{color:isWithinCommWindow(cfg)?C.green:C.red,fontWeight:600}}>{isWithinCommWindow(cfg)?"✓ Currently within active hours":"✗ Currently outside active hours"}</span>
      </div>
    </div>
    <div style={card()}>
      <div style={{...T.head(14,600),marginBottom:6}}>Message Templates</div>
      <div style={{fontSize:12,color:C.textMuted,marginBottom:14}}>Variables: {"{{name}}"} {"{{zip}}"} {"{{storm}}"} {"{{company}}"} {"{{date}}"} {"{{time}}"} {"{{inspector}}"}</div>
      <div style={{display:"flex",flexDirection:"column",gap:14}}>
        <Textarea label="Initial Outreach" value={cfg.templates.initial} onChange={ft("initial")} rows={3}/>
        <Textarea label="Follow-Up" value={cfg.templates.followup} onChange={ft("followup")} rows={3}/>
        <Textarea label="Booking Confirmation" value={cfg.templates.booking} onChange={ft("booking")} rows={3}/>
      </div>
    </div>
    <div style={card()}>
      <div style={{...T.head(14,600),marginBottom:6}}>AI Auto-Reply & Safety</div>
      <div style={{fontSize:12,color:C.textMuted,marginBottom:14,lineHeight:1.6}}>When enabled, incoming lead text replies are answered automatically by AI instead of waiting for you to respond manually.</div>

      <div style={{...flex(10,"center","space-between"),padding:"10px 12px",background:C.surface,borderRadius:7,border:`1px solid ${C.border}`,marginBottom:10}}>
        <div>
          <div style={{fontSize:13,fontWeight:600,color:C.text}}>Enable AI Auto-Reply</div>
          <div style={{fontSize:11,color:C.textMuted,marginTop:2}}>AI responds to incoming lead texts automatically</div>
        </div>
        <button onClick={()=>setCfg(p=>({...p,aiAutoReply:!p.aiAutoReply}))} style={{width:40,height:22,borderRadius:11,border:"none",cursor:"pointer",background:cfg.aiAutoReply?C.green:C.border,position:"relative",flexShrink:0}}>
          <div style={{width:18,height:18,borderRadius:"50%",background:"#fff",position:"absolute",top:2,left:cfg.aiAutoReply?20:2,transition:"left 0.15s"}}/>
        </button>
      </div>

      <div style={{...flex(10,"center","space-between"),padding:"10px 12px",background:C.surface,borderRadius:7,border:`1px solid ${C.border}`,marginBottom:cfg.requireAdultPresent!==false?10:0}}>
        <div>
          <div style={{fontSize:13,fontWeight:600,color:C.text}}>Require Adult-Presence Confirmation</div>
          <div style={{fontSize:11,color:C.textMuted,marginTop:2}}>AI will not offer or confirm a time until the lead confirms someone 18+ will be home</div>
        </div>
        <button onClick={()=>setCfg(p=>({...p,requireAdultPresent:p.requireAdultPresent===false?true:false}))} style={{width:40,height:22,borderRadius:11,border:"none",cursor:"pointer",background:cfg.requireAdultPresent!==false?C.green:C.border,position:"relative",flexShrink:0}}>
          <div style={{width:18,height:18,borderRadius:"50%",background:"#fff",position:"absolute",top:2,left:cfg.requireAdultPresent!==false?20:2,transition:"left 0.15s"}}/>
        </button>
      </div>

      {cfg.requireAdultPresent!==false&&<Textarea label="Adult-Presence Check Message" value={cfg.templates.adultCheck||""} onChange={ft("adultCheck")} placeholder="Will someone 18 or older be home during the inspection?" rows={2}/>}

      <div style={{marginTop:12,padding:"10px 12px",background:C.yellowDim,borderRadius:6,fontSize:12,color:C.textSub,border:`1px solid ${C.yellow}22`,lineHeight:1.6}}>
        ⚠ Even with this on, the AI Agent in Command Center and the manual "Book" button will still warn you (not block you) if a lead hasn't confirmed adult presence yet — useful if you've already verified this by phone.
      </div>
    </div>
    <div style={flex(8,"center","flex-end")}>
      <Btn variant="primary" onClick={()=>onSave(cfg)}>Save Communication Settings</Btn>
    </div>
  </div>;
}

// ─── SCHEDULE SETTINGS PANEL ──────────────────────────────────────────────────
// Lets a roofer configure operating hours per day, plus default appointment
// duration and required buffer time between back-to-back inspections.
// This directly powers the availability engine — change it here and every
// open-slot calculation across the app updates immediately.
function ScheduleSettingsPanel({roofer,onSave}){
  const[cfg,setCfg]=useState(roofer.scheduleSettings||DEFAULT_SCHEDULE);
  function updateDay(day,field,value){
    setCfg(p=>({...p,hours:{...p.hours,[day]:{...p.hours[day],[field]:value}}}));
  }
  return <div style={{display:"flex",flexDirection:"column",gap:16}}>
    <div style={card()}>
      <div style={{...T.head(14,600),marginBottom:14}}>⏱ Appointment Settings</div>
      <div style={grid("1fr 1fr",12)}>
        <Input label="Inspection Duration (minutes)" type="number" value={cfg.durationMins} onChange={v=>setCfg(p=>({...p,durationMins:Number(v)||60}))}/>
        <Input label="Buffer Between Appointments (minutes)" type="number" value={cfg.bufferMins} onChange={v=>setCfg(p=>({...p,bufferMins:Number(v)||0}))}/>
      </div>
      <div style={{marginTop:10,fontSize:12,color:C.textMuted,lineHeight:1.6}}>
        Example: with a {cfg.durationMins}-minute duration and {cfg.bufferMins}-minute buffer, back-to-back appointments would run roughly every {cfg.durationMins+cfg.bufferMins} minutes.
      </div>
    </div>
    <div style={card()}>
      <div style={{...T.head(14,600),marginBottom:14}}>🗓 Operating Hours</div>
      <div style={{display:"flex",flexDirection:"column",gap:8}}>
        {DAYS_OF_WEEK.map(day=>{
          const d=cfg.hours[day];
          return <div key={day} style={{...flex(10,"center","space-between"),padding:"8px 10px",background:C.surface,borderRadius:7,border:`1px solid ${C.border}`,flexWrap:"wrap"}}>
            <div style={{display:"flex",alignItems:"center",gap:8,minWidth:90}}>
              <button onClick={()=>updateDay(day,"open",!d.open)} style={{width:36,height:20,borderRadius:10,border:"none",cursor:"pointer",background:d.open?C.green:C.border,position:"relative",transition:"background 0.15s"}}>
                <div style={{width:16,height:16,borderRadius:"50%",background:"#fff",position:"absolute",top:2,left:d.open?18:2,transition:"left 0.15s"}}/>
              </button>
              <span style={{fontSize:13,fontWeight:600,width:36}}>{day}</span>
            </div>
            {d.open ? (
              <div style={{display:"flex",gap:8,alignItems:"center"}}>
                <input type="time" value={d.start} onChange={e=>updateDay(day,"start",e.target.value)} style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:6,padding:"5px 8px",color:C.text,fontSize:12,outline:"none"}}/>
                <span style={{color:C.textMuted,fontSize:12}}>to</span>
                <input type="time" value={d.end} onChange={e=>updateDay(day,"end",e.target.value)} style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:6,padding:"5px 8px",color:C.text,fontSize:12,outline:"none"}}/>
              </div>
            ) : <span style={{fontSize:12,color:C.textMuted}}>Closed</span>}
          </div>;
        })}
      </div>
    </div>
    <div style={{...flex(8,"center","flex-end")}}>
      <Btn variant="primary" onClick={()=>onSave(cfg)}>Save Schedule Settings</Btn>
    </div>
  </div>;
}

function AddRooferModal({onClose,onAdd}){
  const[f,setF]=useState({name:"",owner:"",email:"",phone:"",territories:"",plan:"Starter",pin:"",twilioFrom:""});
  const u=k=>v=>setF(p=>({...p,[k]:v}));
  return <Modal title="Add New Roofer" onClose={onClose}>
    <div style={{display:"flex",flexDirection:"column",gap:13}}>
      <Input label="Company Name" value={f.name} onChange={u("name")} placeholder="Apex Roofing Co"/>
      <Input label="Owner Name" value={f.owner} onChange={u("owner")} placeholder="John Smith"/>
      <div style={grid("1fr 1fr",12)}>
        <Input label="Email" value={f.email} onChange={u("email")} type="email"/>
        <Input label="Phone" value={f.phone} onChange={u("phone")} placeholder="972-555-0100"/>
      </div>
      <Input label="Territories (comma-separated ZIPs)" value={f.territories} onChange={u("territories")} placeholder="75023, 75024, 75025"/>
      <Input label="Twilio SMS Number (From)" value={f.twilioFrom} onChange={u("twilioFrom")} placeholder="+19725550199"/>
      <div style={{fontSize:11,color:C.textMuted,marginTop:-6}}>Each roofer texts leads from their own dedicated Twilio number, kept separate from other roofers.</div>
      <div style={grid("1fr 1fr",12)}>
        <Select label="Plan" value={f.plan} onChange={u("plan")} options={["Starter","Pro","Elite"]}/>
        <Input label="Roofer PIN" value={f.pin} onChange={u("pin")} placeholder="e.g. 1234"/>
      </div>
      <div style={{...flex(8,"center","flex-end"),marginTop:6}}>
        <Btn onClick={onClose}>Cancel</Btn>
        <Btn variant="primary" onClick={()=>{if(!f.name||!f.owner)return;onAdd({id:"r"+Date.now(),...f,territories:f.territories.split(",").map(z=>z.trim()).filter(Boolean),revenue:0,leads:0,booked:0,status:"trial",inspectors:[],inspections:[],revenueLog:[],commSettings:{...DEFAULT_COMM},scheduleSettings:{...DEFAULT_SCHEDULE},notifications:[]});onClose();}}>Add Roofer</Btn>
      </div>
    </div>
  </Modal>;
}

function EditRooferModal({roofer,onClose,onSave}){
  const[f,setF]=useState({name:roofer.name,owner:roofer.owner,email:roofer.email,phone:roofer.phone,territories:roofer.territories.join(", "),plan:roofer.plan,status:roofer.status,pin:roofer.pin||"",twilioFrom:roofer.twilioFrom||""});
  const u=k=>v=>setF(p=>({...p,[k]:v}));
  return <Modal title="Edit Roofer" onClose={onClose}>
    <div style={{display:"flex",flexDirection:"column",gap:13}}>
      <Input label="Company Name" value={f.name} onChange={u("name")}/>
      <Input label="Owner Name" value={f.owner} onChange={u("owner")}/>
      <div style={grid("1fr 1fr",12)}>
        <Input label="Email" value={f.email} onChange={u("email")} type="email"/>
        <Input label="Phone" value={f.phone} onChange={u("phone")}/>
      </div>
      <Input label="Territories (ZIPs, comma-separated)" value={f.territories} onChange={u("territories")}/>
      <Input label="Twilio SMS Number (From)" value={f.twilioFrom} onChange={u("twilioFrom")} placeholder="+19725550199"/>
      <div style={grid("1fr 1fr 1fr",12)}>
        <Select label="Plan" value={f.plan} onChange={u("plan")} options={["Starter","Pro","Elite"]}/>
        <Select label="Status" value={f.status} onChange={u("status")} options={["active","trial","cancelled"]}/>
        <Input label="PIN" value={f.pin} onChange={u("pin")} placeholder="4-digit PIN"/>
      </div>
      <div style={{...flex(8,"center","flex-end"),marginTop:6}}>
        <Btn onClick={onClose}>Cancel</Btn>
        <Btn variant="primary" onClick={()=>{if(!f.name||!f.owner)return;onSave({...roofer,...f,territories:f.territories.split(",").map(z=>z.trim()).filter(Boolean)});onClose();}}>Save Changes</Btn>
      </div>
    </div>
  </Modal>;
}

function EditLeadModal({lead,roofers,onClose,onSave}){
  const[f,setF]=useState({homeowner:lead.homeowner,phone:lead.phone,address:lead.address||"",zip:lead.zip,stormType:lead.stormType,status:lead.status,rooferId:lead.rooferId,notes:lead.notes||""});
  const u=k=>v=>setF(p=>({...p,[k]:v}));
  return <Modal title="Edit Lead" onClose={onClose}>
    <div style={{display:"flex",flexDirection:"column",gap:13}}>
      <Input label="Homeowner Name" value={f.homeowner} onChange={u("homeowner")}/>
      <Input label="Street Address" value={f.address} onChange={u("address")} placeholder="1204 Oak Ln"/>
      <div style={grid("1fr 1fr",12)}>
        <Input label="Phone" value={f.phone} onChange={u("phone")}/>
        <Input label="ZIP" value={f.zip} onChange={u("zip")}/>
      </div>
      <Input label="Storm Type" value={f.stormType} onChange={u("stormType")}/>
      <div style={grid("1fr 1fr",12)}>
        <Select label="Status" value={f.status} onChange={u("status")} options={["pending","contacted","scheduled","won","cold"]}/>
        <Select label="Assigned Roofer" value={f.rooferId} onChange={u("rooferId")} options={roofers.map(r=>({value:r.id,label:r.name}))}/>
      </div>
      <Textarea label="Notes" value={f.notes} onChange={u("notes")} placeholder="Notes about this lead..." rows={2}/>
      <div style={{...flex(8,"center","flex-end"),marginTop:6}}>
        <Btn onClick={onClose}>Cancel</Btn>
        <Btn variant="primary" onClick={()=>{onSave({...lead,...f});onClose();}}>Save Changes</Btn>
      </div>
    </div>
  </Modal>;
}

function AddLeadModal({roofers, defaultRooferId, onClose, onAdd}){
  const[f,setF]=useState({
    homeowner:"", phone:"", address:"", zip:"",
    stormType:"Hail", status:"pending",
    rooferId:defaultRooferId||roofers[0]?.id||"",
    notes:"",
  });
  const u=k=>v=>setF(p=>({...p,[k]:v}));
  function save(){
    if(!f.homeowner.trim()){ alert("Enter the homeowner's name."); return; }
    if(!f.zip.trim()){ alert("Enter a ZIP code."); return; }
    if(!f.rooferId){ alert("Select a roofer to assign this lead to."); return; }
    onAdd({
      id:"l"+Date.now(),
      homeowner:f.homeowner.trim(), phone:f.phone.trim(),
      address:f.address.trim(), zip:f.zip.trim(),
      stormType:f.stormType||"Manual",
      status:f.status, rooferId:f.rooferId,
      notes:f.notes.trim(), conversations:[],
      contactedAt:null, followupSent:false, adultConfirmed:"unconfirmed",
    });
    onClose();
  }
  return(
    <Modal title="Add Lead" onClose={onClose}>
      <div style={{display:"flex",flexDirection:"column",gap:13}}>
        <Input label="Homeowner Name" value={f.homeowner} onChange={u("homeowner")} placeholder="Robert Chen"/>
        <Input label="Street Address" value={f.address} onChange={u("address")} placeholder="1204 Oak Ln"/>
        <div style={grid("1fr 1fr",12)}>
          <Input label="Phone" value={f.phone} onChange={u("phone")} placeholder="972-555-0101"/>
          <Input label="ZIP Code" value={f.zip} onChange={u("zip")} placeholder="75023"/>
        </div>
        <div style={grid("1fr 1fr",12)}>
          <Select label="Storm Type" value={f.stormType} onChange={u("stormType")}
            options={["Hail","Wind","Tornado","Flood","Manual"]}/>
          <Select label="Status" value={f.status} onChange={u("status")}
            options={["pending","contacted","scheduled"]}/>
        </div>
        {roofers.length>1&&<Select label="Assign to Roofer" value={f.rooferId} onChange={u("rooferId")}
          options={roofers.map(r=>({value:r.id,label:r.name}))}/>}
        <Textarea label="Notes (optional)" value={f.notes} onChange={u("notes")}
          placeholder="Any details about this lead..." rows={2}/>
        <div style={{...flex(8,"center","flex-end"),marginTop:4}}>
          <Btn onClick={onClose}>Cancel</Btn>
          <Btn variant="primary" onClick={save}>Add Lead</Btn>
        </div>
      </div>
    </Modal>
  );
}

function AddInspectorModal({onClose,onAdd}){
  const[f,setF]=useState({name:"",phone:"",zones:""});
  const u=k=>v=>setF(p=>({...p,[k]:v}));
  return <Modal title="Add Inspector" onClose={onClose}>
    <div style={{display:"flex",flexDirection:"column",gap:13}}>
      <Input label="Name" value={f.name} onChange={u("name")} placeholder="Jake Torres"/>
      <Input label="Phone" value={f.phone} onChange={u("phone")} placeholder="972-555-0200"/>
      <Input label="ZIP Zones (comma-separated)" value={f.zones} onChange={u("zones")} placeholder="75023, 75024"/>
      <div style={{...flex(8,"center","flex-end"),marginTop:6}}>
        <Btn onClick={onClose}>Cancel</Btn>
        <Btn variant="primary" onClick={()=>{if(!f.name)return;onAdd({id:"i"+Date.now(),...f,zones:f.zones.split(",").map(z=>z.trim()).filter(Boolean)});onClose();}}>Add Inspector</Btn>
      </div>
    </div>
  </Modal>;
}

// ─── AVAILABILITY PICKER ──────────────────────────────────────────────────────
// Shared component used by both the New Appointment modal and the Reschedule
// modal. Lets the roofer pick an inspector, jump between days, and tap an
// open slot. Slots already reflect operating hours, duration, buffer time,
// and existing bookings — so anything shown here is guaranteed conflict-free.
function AvailabilityPicker({roofer,inspectorId,onInspectorChange,selectedISO,onSelectSlot,excludeId}){
  const[dateStr,setDateStr]=useState(toISODate(new Date()));
  const inspector=roofer.inspectors.find(i=>i.id===inspectorId);
  const slots=inspectorId?getOpenSlotsForDay(roofer,inspectorId,dateStr,excludeId):[];
  const sched=roofer.scheduleSettings||DEFAULT_SCHEDULE;
  const dow=DOW_NAMES[new Date(dateStr+"T12:00:00").getDay()];
  const dayOpen=sched.hours[dow]?.open;

  function shiftDay(delta){
    const d=new Date(dateStr+"T12:00:00");
    d.setDate(d.getDate()+delta);
    setDateStr(toISODate(d));
  }

  const nextAvailable=inspectorId?getNextAvailableSlots(roofer,inspectorId,{limit:1,excludeId}):[];

  return <div style={{display:"flex",flexDirection:"column",gap:12}}>
    <Select label="Inspector" value={inspectorId||""} onChange={onInspectorChange} options={[{value:"",label:"Select inspector..."},...roofer.inspectors.map(i=>({value:i.id,label:i.name}))]}/>

    {inspectorId&&<>
      <div style={{...flex(0,"center","space-between")}}>
        <Btn small variant="ghost" onClick={()=>shiftDay(-1)}>‹ Prev</Btn>
        <div style={{textAlign:"center"}}>
          <div style={{fontSize:13,fontWeight:600}}>{new Date(dateStr+"T12:00:00").toLocaleDateString(undefined,{weekday:"long",month:"short",day:"numeric"})}</div>
        </div>
        <Btn small variant="ghost" onClick={()=>shiftDay(1)}>Next ›</Btn>
      </div>

      {!dayOpen ? (
        <div style={{padding:"14px",textAlign:"center",fontSize:12,color:C.textMuted,background:C.surface,borderRadius:7}}>
          {inspector?.name} is closed on {dow}s.
          {nextAvailable[0]&&<div style={{marginTop:8}}><Btn small variant="info" onClick={()=>{setDateStr(nextAvailable[0].dateStr);}}>Jump to next opening — {nextAvailable[0].dateLabel}</Btn></div>}
        </div>
      ) : slots.length===0 ? (
        <div style={{padding:"14px",textAlign:"center",fontSize:12,color:C.textMuted,background:C.surface,borderRadius:7}}>
          No open slots this day — fully booked or already past.
          {nextAvailable[0]&&<div style={{marginTop:8}}><Btn small variant="info" onClick={()=>{setDateStr(nextAvailable[0].dateStr);}}>Jump to next opening — {nextAvailable[0].dateLabel} at {nextAvailable[0].timeLabel}</Btn></div>}
        </div>
      ) : (
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(84px,1fr))",gap:6,maxHeight:180,overflowY:"auto",padding:2}}>
          {slots.map(s=>{
            const isSelected=selectedISO===s.startISO;
            return <button key={s.startISO} onClick={()=>onSelectSlot(s)} style={{padding:"8px 6px",borderRadius:6,fontSize:12,fontWeight:600,cursor:"pointer",background:isSelected?C.orange:C.surface,color:isSelected?"#fff":C.textSub,border:`1px solid ${isSelected?C.orange:C.border}`}}>{formatTimeLabel(s.startISO)}</button>;
          })}
        </div>
      )}
    </>}
  </div>;
}

// ─── NEW / RESCHEDULE APPOINTMENT MODAL ──────────────────────────────────────
// Handles three flows in one modal:
//  1. Booking a specific lead (leadToBook passed in) — pre-fills name/phone/zip
//  2. A roofer manually adding a customer who called them directly (no lead)
//  3. Rescheding an existing inspection (existingInspection passed in)
function AddInspectionModal({roofer,onClose,onAdd,onReschedule,leadToBook,existingInspection,leads}){
  const isReschedule=!!existingInspection;
  const[customerMode,setCustomerMode]=useState(leadToBook?"lead":"manual"); // "lead" | "manual"
  const[selectedLeadId,setSelectedLeadId]=useState(leadToBook?.id||"");
  const[client,setClient]=useState(existingInspection?.client||leadToBook?.homeowner||"");
  const[phone,setPhone]=useState(leadToBook?.phone||"");
  const[address,setAddress]=useState(existingInspection?.address||"");
  const[inspectorId,setInspectorId]=useState(existingInspection?.inspectorId||"");
  const[selectedSlot,setSelectedSlot]=useState(existingInspection?{startISO:existingInspection.startISO,endISO:existingInspection.endISO}:null);
  const[error,setError]=useState("");

  const bookableLeads=(leads||[]).filter(l=>l.rooferId===roofer.id&&["pending","contacted","scheduled"].includes(l.status));

  function handleLeadSelect(leadId){
    setSelectedLeadId(leadId);
    const lead=bookableLeads.find(l=>l.id===leadId);
    if(lead){ setClient(lead.homeowner); setPhone(lead.phone); setAddress(lead.zip); }
  }

  function handleSave(){
    if(!client.trim()){ setError("Enter the customer's name."); return; }
    if(!inspectorId){ setError("Select an inspector."); return; }
    if(!selectedSlot){ setError("Pick an available time slot."); return; }
    if(customerMode==="lead"&&selectedLeadId){
      const lead=bookableLeads.find(l=>l.id===selectedLeadId);
      const comm=roofer.commSettings||DEFAULT_COMM;
      if(lead&&comm.requireAdultPresent!==false&&lead.adultConfirmed!=="confirmed"){
        if(!window.confirm(`${lead.homeowner} has not yet confirmed that an adult (18+) will be present during the inspection. Continue booking anyway?`)) return;
      }
    }
    setError("");
    const inspector=roofer.inspectors.find(i=>i.id===inspectorId);
    const payload={
      id:existingInspection?.id||"ins"+Date.now(),
      client:client.trim(), address:address.trim(),
      startISO:selectedSlot.startISO, endISO:selectedSlot.endISO,
      inspectorId, inspector:inspector?.name||"TBD",
      status:existingInspection?.status||"scheduled",
      source:customerMode==="lead"?"lead":"manual",
      leadId:customerMode==="lead"?selectedLeadId:undefined,
      phone:phone.trim(),
    };
    if(isReschedule) onReschedule(payload); else onAdd(payload);
    onClose();
  }

  return <Modal title={isReschedule?"Reschedule Inspection":"Schedule Inspection"} onClose={onClose} wide>
    <div style={{display:"flex",flexDirection:"column",gap:14}}>
      {!isReschedule&&<div style={{display:"flex",gap:4,background:C.surface,borderRadius:7,padding:4}}>
        {[["lead","Existing Lead"],["manual","New Customer (called in)"]].map(([v,label])=>
          <button key={v} onClick={()=>setCustomerMode(v)} style={{flex:1,padding:"7px",borderRadius:5,border:"none",cursor:"pointer",fontSize:12,fontWeight:600,background:customerMode===v?C.orange:"transparent",color:customerMode===v?"#fff":C.textMuted}}>{label}</button>
        )}
      </div>}

      {!isReschedule&&customerMode==="lead"&&(
        bookableLeads.length===0
          ?<div style={{fontSize:12,color:C.textMuted,padding:"10px 12px",background:C.surface,borderRadius:7}}>No bookable leads right now — switch to "New Customer" to add one manually.</div>
          :<Select label="Select Lead" value={selectedLeadId} onChange={handleLeadSelect} options={[{value:"",label:"Choose a lead..."},...bookableLeads.map(l=>({value:l.id,label:`${l.homeowner} — ${l.zip}`}))]}/>
      )}

      {(isReschedule||customerMode==="manual"||selectedLeadId)&&<>
        <div style={grid("1fr 1fr",12)}>
          <Input label="Customer Name" value={client} onChange={setClient} placeholder="John Smith" style={isReschedule||customerMode==="lead"?{}:undefined}/>
          <Input label="Phone" value={phone} onChange={setPhone} placeholder="972-555-0100"/>
        </div>
        <Input label="Address" value={address} onChange={setAddress} placeholder="1234 Oak Ln, Plano TX 75023"/>
      </>}

      <Divider/>

      <AvailabilityPicker roofer={roofer} inspectorId={inspectorId} onInspectorChange={setInspectorId} selectedISO={selectedSlot?.startISO} onSelectSlot={setSelectedSlot} excludeId={existingInspection?.id}/>

      {selectedSlot&&<div style={{padding:"10px 12px",background:C.greenDim,borderRadius:7,fontSize:13,color:C.green,border:`1px solid ${C.green}22`}}>
        ✓ {formatDateLabel(selectedSlot.startISO)} at {formatTimeLabel(selectedSlot.startISO)}
      </div>}

      {error&&<div style={{color:C.red,fontSize:12,padding:"7px 10px",background:C.redDim,borderRadius:6}}>{error}</div>}

      <div style={{...flex(8,"center","flex-end"),marginTop:4}}>
        <Btn onClick={onClose}>Cancel</Btn>
        <Btn variant="primary" onClick={handleSave}>{isReschedule?"Save New Time":"Schedule Inspection"}</Btn>
      </div>
    </div>
  </Modal>;
}

// ─── SCAN SCHEDULER ───────────────────────────────────────────────────────────
function ScanScheduler({scanSettings,onChange}){
  const[st,setSt]=useState(scanSettings);
  const upd=k=>v=>{const n={...st,[k]:v};setSt(n);onChange(n);};
  return <div style={card()}>
    <div style={{...T.head(13,600),marginBottom:14}}>⚡ Auto Storm Scan Schedule</div>
    <div style={grid("1fr 1fr",12)}>
      <Select label="Frequency" value={st.interval} onChange={upd("interval")} options={SCAN_INTERVALS}/>
      <Input label="Daily Start Time" type="time" value={st.startTime} onChange={upd("startTime")}/>
    </div>
    <div style={{marginTop:10,padding:"8px 12px",background:C.orangeDim,borderRadius:6,fontSize:12,color:C.textSub,border:`1px solid ${C.orange}22`}}>
      {st.interval==="manual"?"⚠ Manual only — use Run Scan button":`✓ ${SCAN_INTERVALS.find(i=>i.value===st.interval)?.label} starting at ${st.startTime}`}
      {st.lastScan&&<span style={{marginLeft:8,color:C.textMuted}}>· Last: {st.lastScan}</span>}
    </div>
  </div>;
}

// ─── LOGIN SCREEN ─────────────────────────────────────────────────────────────
// ─── WHAT'S NEW MODAL ────────────────────────────────────────────────────────
// Shows automatically when the user logs in and the app version is newer than
// the last version they acknowledged. Dismissing it saves the current version
// to Supabase so it won't show again until the next deploy.
function WhatsNewModal({onDismiss}){
  return(
    <div style={{
      position:"fixed",inset:0,zIndex:9999,
      background:"rgba(0,0,0,0.7)",backdropFilter:"blur(4px)",
      display:"flex",alignItems:"center",justifyContent:"center",padding:20,
    }}>
      <div style={{
        background:C.card,border:`1px solid ${C.borderAct}`,
        borderRadius:16,width:"100%",maxWidth:520,
        boxShadow:`0 24px 60px rgba(0,0,0,0.5),0 0 0 1px ${C.orange}22`,
        overflow:"hidden",
      }}>
        {/* Header */}
        <div style={{
          padding:"20px 24px 16px",
          background:`linear-gradient(135deg,rgba(13,148,136,0.15),rgba(2,132,199,0.1))`,
          borderBottom:`1px solid ${C.border}`,
        }}>
          <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:6}}>
            <div style={{
              width:36,height:36,borderRadius:10,
              background:"linear-gradient(135deg,#0d9488,#0284c7)",
              display:"flex",alignItems:"center",justifyContent:"center",fontSize:18,
              boxShadow:"0 4px 14px rgba(13,148,136,0.4)",flexShrink:0,
            }}>⛈</div>
            <div>
              <div style={{fontSize:16,fontWeight:700,color:C.text,letterSpacing:"-0.01em"}}>
                What's New in SkyShield Pro
              </div>
              <div style={{fontSize:11,color:C.textSub,marginTop:1}}>
                Version {CHANGELOG[0].version} · {CHANGELOG[0].date}
              </div>
            </div>
          </div>
        </div>

        {/* Changelog entries — most recent first */}
        <div style={{padding:"16px 24px",maxHeight:360,overflowY:"auto"}}>
          {CHANGELOG.map((entry,ei)=>(
            <div key={entry.version} style={{marginBottom:ei<CHANGELOG.length-1?20:0}}>
              {ei>0&&(
                <div style={{fontSize:12,fontWeight:600,color:C.textSub,
                  marginBottom:10,paddingTop:4,
                  borderTop:`1px solid ${C.border}`}}>
                  v{entry.version} · {entry.date}
                </div>
              )}
              <div style={{display:"flex",flexDirection:"column",gap:8}}>
                {entry.changes.map((change,ci)=>(
                  <div key={ci} style={{display:"flex",alignItems:"flex-start",gap:10}}>
                    <div style={{
                      width:18,height:18,borderRadius:"50%",flexShrink:0,marginTop:1,
                      background:ei===0?`${C.orange}18`:`${C.border}`,
                      border:`1px solid ${ei===0?C.orange+"44":C.border}`,
                      display:"flex",alignItems:"center",justifyContent:"center",
                      fontSize:9,color:ei===0?C.orange:C.textMuted,fontWeight:700,
                    }}>✓</div>
                    <div style={{fontSize:13,color:ei===0?C.text:C.textSub,lineHeight:1.5}}>
                      {change}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div style={{
          padding:"14px 24px",
          borderTop:`1px solid ${C.border}`,
          display:"flex",justifyContent:"flex-end",
        }}>
          <button onClick={onDismiss} style={{
            fontSize:13,fontWeight:600,
            padding:"9px 24px",borderRadius:9,
            background:`linear-gradient(135deg,#0d9488,#0284c7)`,
            color:"#fff",border:"none",cursor:"pointer",
            boxShadow:"0 4px 14px rgba(13,148,136,0.35)",
          }}>Got it</button>
        </div>
      </div>
    </div>
  );
}

// ─── LANDING PAGE ─────────────────────────────────────────────────────────────
function LandingPage({onSignIn, showLogin, onLoginSuccess}){
  const[demoName,setDemoName]=useState("");
  const[demoEmail,setDemoEmail]=useState("");
  const[demoPhone,setDemoPhone]=useState("");
  const[demoSent,setDemoSent]=useState(false);
  const[count,setCount]=useState({leads:0,storms:0,mrr:0,booked:0});
  const[mapDots,setMapDots]=useState([]);
  const[smsStep,setSmsStep]=useState(0);

  // Animate counters on mount
  useEffect(()=>{
    const targets={leads:247,storms:18,mrr:12388,booked:94};
    const duration=1800;
    const steps=60;
    let step=0;
    const t=setInterval(()=>{
      step++;
      const p=Math.min(step/steps,1);
      const ease=1-Math.pow(1-p,3);
      setCount({
        leads:Math.floor(targets.leads*ease),
        storms:Math.floor(targets.storms*ease),
        mrr:Math.floor(targets.mrr*ease),
        booked:Math.floor(targets.booked*ease),
      });
      if(step>=steps) clearInterval(t);
    },duration/steps);
    return()=>clearInterval(t);
  },[]);

  // Animate storm map dots
  useEffect(()=>{
    const ZIPS=[
      {x:52,y:38,label:"75023",severity:"severe"},
      {x:58,y:32,label:"75034",severity:"extreme"},
      {x:44,y:44,label:"75002",severity:"moderate"},
      {x:62,y:41,label:"75025",severity:"severe"},
      {x:48,y:29,label:"75035",severity:"moderate"},
      {x:55,y:48,label:"75013",severity:"extreme"},
    ];
    let i=0;
    const t=setInterval(()=>{
      if(i<ZIPS.length){ setMapDots(d=>[...d,{...ZIPS[i],id:i,born:Date.now()}]); i++; }
      else{ setMapDots([]); i=0; }
    },600);
    return()=>clearInterval(t);
  },[]);

  // Animate SMS conversation
  const SMS_STEPS=[
    {role:"ai",msg:"Hi Sarah! We noticed your area (75023) was hit by a hail storm. Apex Roofing offers FREE roof inspections — reply YES to schedule!"},
    {role:"lead",msg:"YES please, when can you come?"},
    {role:"ai",msg:"Great! We have openings tomorrow at 10am or 2pm. Which works better for you?"},
    {role:"lead",msg:"10am works!"},
    {role:"ai",msg:"Perfect! Your inspection is confirmed for tomorrow at 10am with Jake Torres. See you then!"},
  ];
  useEffect(()=>{
    if(smsStep>=SMS_STEPS.length) return;
    const delay=smsStep===0?800:1400;
    const t=setTimeout(()=>setSmsStep(s=>s+1),delay);
    return()=>clearTimeout(t);
  },[smsStep]);

  const sevColor=s=>s==="extreme"?"#f87171":s==="severe"?"#fbbf24":"#38bdf8";

  const FEATURES=[
    {icon:"◆",title:"Storm Intelligence",desc:"Automatically detects hail, tornado, and wind events in your service area and instantly generates leads from affected homeowners."},
    {icon:"→",title:"AI-Powered Outreach",desc:"Sends personalized SMS to leads the moment a storm hits. AI handles replies, qualifies leads, and schedules inspections automatically."},
    {icon:"▦",title:"Smart Scheduling",desc:"Real-time availability engine books inspections without double-booking. Inspectors get notified instantly via SMS."},
    {icon:"◈",title:"Multi-Roofer CRM",desc:"Manage your entire team from one dashboard. Each roofer gets their own number, leads, calendar, and performance stats."},
    {icon:"$",title:"Stripe Billing Built In",desc:"Subscription management, invoicing, and payment tracking all handled automatically. Know your MRR at a glance."},
    {icon:"◉",title:"Lead Pipeline",desc:"Track every lead from first contact to closed deal. Round-robin distribution ensures fair assignment across your team."},
  ];

  const[billingCycle,setBillingCycle]=useState("monthly");

  const PLANS=[
    {name:"Starter",
      monthly:1500, annual:14997, annualMonthly:1250,
      color:C.blue,
      features:["1 user","1 city","10 ZIP codes","Standard storm alerts","Lead dashboard","Inspection scheduling"],
      zipLimit:10, seats:1,
    },
    {name:"Pro",
      monthly:2000, annual:19997, annualMonthly:1666,
      color:C.orange, popular:true,
      features:["1 user","1 city","20 ZIP codes","Priority storm alerts","Lead dashboard","Inspection scheduling"],
      zipLimit:20, seats:1,
    },
    {name:"Growth",
      monthly:2750, annual:27497, annualMonthly:2291,
      color:C.purple,
      features:["3 users","2 cities","30 ZIP codes","Priority storm alerts","Lead dashboard","Inspection scheduling","Advanced reporting"],
      zipLimit:30, seats:3,
    },
  ];

  const LANDING_ADDONS=[
    {label:"Additional Seat",price:"$50/mo",desc:"Add a team member seat",note:"Max 5 per account"},
    {label:"10-Zip Bundle",price:"$500/mo",desc:"Expand your territory by 10 ZIPs",note:null},
    {label:"20-Zip Bundle",price:"$800/mo",strikethrough:"$1,000/mo",desc:"Expand by 20 ZIPs",note:"Save 20%"},
    {label:"Metro Zone Lock",price:"$1,000/mo per ZIP",desc:"Exclusively own a ZIP — no other roofers",note:"Removes all competitors from that ZIP"},
  ];

  const TESTIMONIALS=[
    {name:"Marcus H.",company:"Apex Roofing Co",text:"We went from manually tracking leads in spreadsheets to a fully automated storm response system. Booked 18 inspections in the first week."},
    {name:"Diane R.",company:"Summit Storm Pros",text:"The AI handles all the initial SMS replies. By the time I look at my dashboard, leads are already qualified and ready to schedule."},
    {name:"Steve N.",company:"Ironclad Roofing",text:"Finally a CRM built specifically for roofing. Every feature makes sense for how we actually work after storms."},
  ];

  if(showLogin) return <LoginScreen onLoginSuccess={onLoginSuccess}/>;

  return(
    <div style={{minHeight:"100vh",background:C.bg,fontFamily:"'Inter',sans-serif",color:C.text,overflowX:"hidden"}}>

      {/* ── HERO BACKGROUND GRAPHICS ── */}
      <div style={{position:"fixed",inset:0,zIndex:0,pointerEvents:"none",overflow:"hidden"}}>
        {/* Radial glows */}
        <div style={{position:"absolute",top:"-20%",left:"-10%",width:700,height:700,borderRadius:"50%",
          background:"radial-gradient(circle,rgba(13,148,136,0.12) 0%,transparent 70%)"}}/>
        <div style={{position:"absolute",top:"-10%",right:"-10%",width:600,height:600,borderRadius:"50%",
          background:"radial-gradient(circle,rgba(2,132,199,0.1) 0%,transparent 70%)"}}/>
        <div style={{position:"absolute",bottom:"20%",right:"5%",width:400,height:400,borderRadius:"50%",
          background:"radial-gradient(circle,rgba(45,212,191,0.06) 0%,transparent 70%)"}}/>
        {/* Grid */}
        <div style={{position:"absolute",inset:0,
          backgroundImage:"linear-gradient(rgba(45,212,191,0.03) 1px,transparent 1px),linear-gradient(90deg,rgba(45,212,191,0.03) 1px,transparent 1px)",
          backgroundSize:"60px 60px"}}/>
        {/* Floating orbs */}
        {[
          {x:"15%",y:"20%",size:6,color:"#2dd4bf",delay:0},
          {x:"82%",y:"15%",size:4,color:"#38bdf8",delay:0.5},
          {x:"70%",y:"60%",size:5,color:"#818cf8",delay:1},
          {x:"25%",y:"70%",size:3,color:"#2dd4bf",delay:1.5},
          {x:"90%",y:"80%",size:4,color:"#38bdf8",delay:0.8},
          {x:"40%",y:"85%",size:3,color:"#818cf8",delay:0.3},
        ].map((orb,i)=>(
          <div key={i} style={{
            position:"absolute",left:orb.x,top:orb.y,
            width:orb.size,height:orb.size,borderRadius:"50%",
            background:orb.color,
            boxShadow:`0 0 ${orb.size*4}px ${orb.color}`,
            animation:`pulse ${2+orb.delay}s ease-in-out infinite alternate`,
          }}/>
        ))}
        <style>{`
          @keyframes pulse { from{opacity:0.3;transform:scale(1)} to{opacity:1;transform:scale(1.5)} }
          @keyframes fadeUp { from{opacity:0;transform:translateY(16px)} to{opacity:1;transform:translateY(0)} }
          @keyframes ripple { 0%{transform:scale(0.5);opacity:0.8} 100%{transform:scale(2.5);opacity:0} }
          @keyframes slideIn { from{opacity:0;transform:translateX(-10px)} to{opacity:1;transform:translateX(0)} }
          @keyframes blink { 0%,100%{opacity:1} 50%{opacity:0} }
        `}</style>
      </div>

      {/* ── NAV ── */}
      <nav style={{position:"sticky",top:0,zIndex:100,
        background:"rgba(3,14,24,0.9)",backdropFilter:"blur(20px)",
        borderBottom:`1px solid ${C.border}`,padding:"0 24px"}}>
        <div style={{maxWidth:1100,margin:"0 auto",height:60,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
          <div style={{display:"flex",alignItems:"center",gap:10}}>
            <div style={{width:32,height:32,borderRadius:9,background:"linear-gradient(135deg,#0d9488,#0284c7)",
              display:"flex",alignItems:"center",justifyContent:"center",fontSize:16,
              boxShadow:"0 4px 14px rgba(13,148,136,0.4)"}}>⛈</div>
            <div style={{fontFamily:"'Space Grotesk',sans-serif",fontSize:16,fontWeight:700,letterSpacing:"-0.02em",color:"#fff"}}>
              Sky<span style={{color:C.orange}}>Shield</span> Pro
            </div>
          </div>
          <div style={{display:"flex",alignItems:"center",gap:28}}>
            {["Features","Pricing","Contact"].map(l=>(
              <a key={l} href={`#${l.toLowerCase()}`}
                style={{fontSize:13,fontWeight:500,color:C.textSub,textDecoration:"none",cursor:"pointer"}}>
                {l}
              </a>
            ))}
          </div>
          <div style={{display:"flex",gap:10}}>
            <button onClick={onSignIn} style={{fontSize:13,fontWeight:600,padding:"8px 18px",borderRadius:8,
              background:"transparent",color:C.textSub,border:`1px solid ${C.border}`,cursor:"pointer"}}>
              Sign In
            </button>
            <button onClick={()=>document.getElementById("contact").scrollIntoView({behavior:"smooth"})}
              style={{fontSize:13,fontWeight:600,padding:"8px 18px",borderRadius:8,
              background:"linear-gradient(135deg,#0d9488,#0284c7)",color:"#fff",border:"none",cursor:"pointer",
              boxShadow:"0 4px 14px rgba(13,148,136,0.35)"}}>
              Start Free Trial
            </button>
          </div>
        </div>
      </nav>

      {/* ── HERO ── */}
      <section style={{position:"relative",zIndex:1,maxWidth:1100,margin:"0 auto",padding:"80px 24px 60px",textAlign:"center"}}>
        <div style={{display:"inline-flex",alignItems:"center",gap:8,
          background:`${C.orange}14`,border:`1px solid ${C.orange}33`,
          borderRadius:30,padding:"5px 14px",marginBottom:24,
          animation:"fadeUp 0.6s ease forwards"}}>
          <span style={{width:6,height:6,borderRadius:"50%",background:C.orange,display:"inline-block",
            animation:"pulse 1.5s ease-in-out infinite"}}/>
          <span style={{fontSize:12,fontWeight:600,color:C.orange}}>Built exclusively for roofing companies</span>
        </div>
        <h1 style={{fontFamily:"'Space Grotesk',sans-serif",fontSize:58,fontWeight:800,
          lineHeight:1.08,letterSpacing:"-0.03em",color:"#fff",marginBottom:20,
          animation:"fadeUp 0.7s ease forwards"}}>
          Turn Every Storm Into a<br/>
          <span style={{background:"linear-gradient(135deg,#2dd4bf,#38bdf8)",
            WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent"}}>
            Booked Inspection
          </span>
        </h1>
        <p style={{fontSize:18,color:C.textSub,lineHeight:1.7,maxWidth:560,margin:"0 auto 36px",
          animation:"fadeUp 0.8s ease forwards"}}>
          SkyShield Pro automatically detects storms, contacts homeowners by SMS, qualifies leads with AI, and books inspections — all before your competitors even know the storm hit.
        </p>
        <div style={{display:"flex",gap:12,justifyContent:"center",flexWrap:"wrap",marginBottom:16,
          animation:"fadeUp 0.9s ease forwards"}}>
          <button onClick={()=>document.getElementById("contact").scrollIntoView({behavior:"smooth"})}
            style={{fontSize:15,fontWeight:700,padding:"15px 34px",borderRadius:10,
            background:"linear-gradient(135deg,#0d9488,#0284c7)",color:"#fff",border:"none",cursor:"pointer",
            boxShadow:"0 6px 24px rgba(13,148,136,0.45)"}}>
            Start 14-Day Free Trial →
          </button>
          <button onClick={()=>document.getElementById("contact").scrollIntoView({behavior:"smooth"})}
            style={{fontSize:15,fontWeight:600,padding:"15px 34px",borderRadius:10,
            background:"transparent",color:C.text,border:`1px solid ${C.border}`,cursor:"pointer"}}>
            Book a Demo
          </button>
        </div>
        <div style={{fontSize:12,color:C.textMuted,marginBottom:60}}>
          No credit card required · 14-day free trial · Cancel anytime
        </div>

        {/* ── ANIMATED STAT COUNTERS ── */}
        <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:12,marginBottom:40}}>
          {[
            {label:"Leads Generated",value:count.leads.toLocaleString(),suffix:"+",color:"#2dd4bf"},
            {label:"Storms Tracked",value:count.storms,suffix:"",color:"#38bdf8"},
            {label:"Monthly Revenue",value:"$"+count.mrr.toLocaleString(),suffix:"",color:"#4ade80"},
            {label:"Inspections Booked",value:count.booked,suffix:"%",color:"#818cf8"},
          ].map(s=>(
            <div key={s.label} style={{background:"rgba(255,255,255,0.03)",backdropFilter:"blur(20px)",
              border:`1px solid rgba(255,255,255,0.07)`,borderRadius:14,padding:"20px 16px",
              boxShadow:"inset 0 1px 0 rgba(255,255,255,0.06)"}}>
              <div style={{fontFamily:"'Space Grotesk',sans-serif",fontSize:32,fontWeight:800,
                color:s.color,lineHeight:1,marginBottom:6}}>{s.value}{s.suffix}</div>
              <div style={{fontSize:11,fontWeight:600,color:C.textSub,textTransform:"uppercase",
                letterSpacing:"0.08em"}}>{s.label}</div>
            </div>
          ))}
        </div>

        {/* ── DASHBOARD PREVIEW ── */}
        <div style={{background:"rgba(7,24,40,0.9)",border:`1px solid ${C.border}`,
          borderRadius:18,padding:20,backdropFilter:"blur(20px)",
          boxShadow:"0 40px 80px rgba(0,0,0,0.5),0 0 0 1px rgba(45,212,191,0.08)",
          textAlign:"left"}}>
          {/* Fake browser chrome */}
          <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:14,paddingBottom:12,
            borderBottom:`1px solid ${C.border}`}}>
            {["#f87171","#fbbf24","#4ade80"].map((c,i)=>(
              <div key={i} style={{width:10,height:10,borderRadius:"50%",background:c}}/>
            ))}
            <div style={{flex:1,background:C.surface,borderRadius:6,padding:"4px 12px",
              fontSize:10,color:C.textMuted,marginLeft:8}}>
              skyshield-sigma.vercel.app
            </div>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10,marginBottom:12}}>
            {[{l:"Active Leads",v:"24",c:C.orange},{l:"Booked Today",v:"7",c:"#2dd4bf"},{l:"MRR",v:"$2,388",c:"#4ade80"},{l:"Storms",v:"3",c:C.blue}].map(s=>(
              <div key={s.l} style={{background:C.surface,borderRadius:10,padding:"12px 14px",border:`1px solid ${C.border}`}}>
                <div style={{fontSize:9,fontWeight:600,color:C.textSub,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:6}}>{s.l}</div>
                <div style={{fontFamily:"'Space Grotesk',sans-serif",fontSize:22,fontWeight:700,color:s.c}}>{s.v}</div>
              </div>
            ))}
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1.4fr 1fr",gap:10}}>
            <div style={{background:C.surface,borderRadius:10,border:`1px solid ${C.border}`,overflow:"hidden"}}>
              <div style={{padding:"10px 14px",borderBottom:`1px solid ${C.border}`,fontSize:11,fontWeight:600,color:C.textSub}}>Lead Pipeline</div>
              {[{n:"Robert Chen",s:"scheduled",c:"#2dd4bf"},{n:"Linda Park",s:"contacted",c:C.blue},{n:"Tom Wiley",s:"pending",c:C.orange}].map((l,i)=>(
                <div key={i} style={{padding:"9px 14px",borderBottom:i<2?`1px solid ${C.border}`:"none",
                  display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                  <div style={{display:"flex",alignItems:"center",gap:8}}>
                    <div style={{width:26,height:26,borderRadius:7,background:`${l.c}18`,
                      display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,fontWeight:700,color:l.c}}>
                      {l.n[0]}
                    </div>
                    <span style={{fontSize:12,fontWeight:500,color:C.text}}>{l.n}</span>
                  </div>
                  <span style={{fontSize:10,fontWeight:600,padding:"2px 8px",borderRadius:5,
                    background:`${l.c}14`,color:l.c,border:`1px solid ${l.c}28`}}>{l.s}</span>
                </div>
              ))}
            </div>
            <div style={{background:C.surface,borderRadius:10,border:`1px solid ${C.border}`,overflow:"hidden"}}>
              <div style={{padding:"10px 14px",borderBottom:`1px solid ${C.border}`,fontSize:11,fontWeight:600,color:C.textSub}}>Storm Events</div>
              {[{n:"Hail — Plano, TX",d:"Jun 12",s:"severe"},{n:"Tornado — Frisco",d:"Jun 13",s:"extreme"},{n:"Wind — Allen",d:"Jun 14",s:"moderate"}].map((s,i)=>(
                <div key={i} style={{padding:"9px 14px",borderBottom:i<2?`1px solid ${C.border}`:"none",
                  display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                  <div>
                    <div style={{fontSize:11,fontWeight:500,color:C.text}}>{s.n}</div>
                    <div style={{fontSize:9,color:C.textSub,marginTop:1}}>{s.d}</div>
                  </div>
                  <span style={{fontSize:10,fontWeight:600,padding:"2px 8px",borderRadius:5,
                    background:`${sevColor(s.s)}14`,color:sevColor(s.s),
                    border:`1px solid ${sevColor(s.s)}28`}}>{s.s}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── FEATURES ── */}
      <section id="features" style={{position:"relative",zIndex:1,maxWidth:1100,margin:"0 auto",padding:"80px 24px"}}>
        <div style={{textAlign:"center",marginBottom:56}}>
          <div style={{fontSize:12,fontWeight:600,color:C.orange,letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:12}}>Everything You Need</div>
          <h2 style={{fontFamily:"'Space Grotesk',sans-serif",fontSize:40,fontWeight:800,
            letterSpacing:"-0.02em",color:"#fff",marginBottom:14}}>Built for how roofing actually works</h2>
          <p style={{fontSize:16,color:C.textSub,maxWidth:520,margin:"0 auto"}}>
            Every feature was designed around the storm response workflow — from first alert to closed deal.
          </p>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:16}}>
          {FEATURES.map((f,fi)=>(
            <div key={f.title} style={{background:"rgba(255,255,255,0.03)",backdropFilter:"blur(20px)",
              border:`1px solid rgba(255,255,255,0.07)`,borderRadius:16,padding:28,
              boxShadow:"inset 0 1px 0 rgba(255,255,255,0.06)",
              transition:"border-color 0.2s,box-shadow 0.2s"}}
              onMouseEnter={e=>{e.currentTarget.style.borderColor=`${C.orange}44`;e.currentTarget.style.boxShadow=`0 0 30px ${C.orange}11,inset 0 1px 0 rgba(255,255,255,0.08)`;}}
              onMouseLeave={e=>{e.currentTarget.style.borderColor="rgba(255,255,255,0.07)";e.currentTarget.style.boxShadow="inset 0 1px 0 rgba(255,255,255,0.06)";}}>
              <div style={{width:44,height:44,borderRadius:12,
                background:`linear-gradient(135deg,${C.orange}22,${C.orange}11)`,
                border:`1px solid ${C.orange}28`,
                display:"flex",alignItems:"center",justifyContent:"center",
                fontSize:18,fontWeight:700,color:C.orange,marginBottom:16}}>{f.icon}</div>
              <div style={{fontFamily:"'Space Grotesk',sans-serif",fontSize:16,fontWeight:700,color:"#fff",marginBottom:8}}>{f.title}</div>
              <div style={{fontSize:13,color:C.textSub,lineHeight:1.7}}>{f.desc}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ── HOW IT WORKS ── */}
      <section style={{position:"relative",zIndex:1,background:"rgba(255,255,255,0.015)",
        borderTop:`1px solid ${C.border}`,borderBottom:`1px solid ${C.border}`,padding:"80px 24px"}}>
        <div style={{maxWidth:1100,margin:"0 auto"}}>
          <div style={{textAlign:"center",marginBottom:64}}>
            <div style={{fontSize:12,fontWeight:600,color:C.orange,letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:12}}>The Workflow</div>
            <h2 style={{fontFamily:"'Space Grotesk',sans-serif",fontSize:40,fontWeight:800,letterSpacing:"-0.02em",color:"#fff"}}>
              Storm to signed deal in hours, not days
            </h2>
          </div>

          {/* Steps with connecting line */}
          <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:0,position:"relative",marginBottom:64}}>
            <div style={{position:"absolute",top:27,left:"12.5%",right:"12.5%",height:1,
              background:`linear-gradient(90deg,${C.orange}66,${C.blue}66)`,zIndex:0}}/>
            {[
              {n:"01",t:"Storm Detected",d:"SkyShield scans for hail, tornado, and wind events in your ZIP codes around the clock.",icon:"◆"},
              {n:"02",t:"Leads Generated",d:"Homeowners in affected areas are identified and added to your pipeline instantly.",icon:"◈"},
              {n:"03",t:"AI Contacts Them",d:"Personalized SMS goes out within minutes. AI qualifies the lead and books the inspection.",icon:"→"},
              {n:"04",t:"Inspection Booked",d:"Confirmed bookings land in your inspector's calendar. You just show up and close.",icon:"▦"},
            ].map((s,i)=>(
              <div key={i} style={{padding:"0 20px",textAlign:"center",position:"relative",zIndex:1}}>
                <div style={{width:56,height:56,borderRadius:"50%",
                  background:i%2===0?"linear-gradient(135deg,#0d9488,#0284c7)":"rgba(7,24,40,0.9)",
                  border:`1px solid ${i%2===0?C.orange:C.border}`,
                  display:"flex",alignItems:"center",justifyContent:"center",
                  fontFamily:"'Space Grotesk',sans-serif",fontSize:15,fontWeight:800,
                  color:i%2===0?"#fff":C.textSub,
                  margin:"0 auto 20px",
                  boxShadow:i%2===0?"0 8px 24px rgba(13,148,136,0.4)":"none"}}>
                  {s.n}
                </div>
                <div style={{width:32,height:32,borderRadius:8,background:`${C.orange}14`,
                  border:`1px solid ${C.orange}28`,
                  display:"flex",alignItems:"center",justifyContent:"center",
                  fontSize:14,color:C.orange,margin:"0 auto 12px"}}>{s.icon}</div>
                <div style={{fontFamily:"'Space Grotesk',sans-serif",fontSize:15,fontWeight:700,color:"#fff",marginBottom:8}}>{s.t}</div>
                <div style={{fontSize:13,color:C.textSub,lineHeight:1.6}}>{s.d}</div>
              </div>
            ))}
          </div>

          {/* ── STORM MAP + SMS MOCKUP side by side ── */}
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:20}}>

            {/* Animated Storm Map */}
            <div style={{background:"rgba(7,24,40,0.9)",border:`1px solid ${C.border}`,borderRadius:16,padding:20,
              boxShadow:"inset 0 1px 0 rgba(255,255,255,0.06)"}}>
              <div style={{fontSize:12,fontWeight:600,color:C.textSub,textTransform:"uppercase",
                letterSpacing:"0.08em",marginBottom:14,display:"flex",alignItems:"center",gap:8}}>
                <span style={{width:6,height:6,borderRadius:"50%",background:"#f87171",
                  display:"inline-block",animation:"pulse 1s ease-in-out infinite"}}/>
                Live Storm Detection
              </div>
              {/* Map SVG */}
              <div style={{position:"relative",height:200,background:"rgba(13,148,136,0.04)",
                borderRadius:10,border:`1px solid ${C.border}`,overflow:"hidden"}}>
                {/* Grid lines */}
                <svg width="100%" height="100%" style={{position:"absolute",inset:0}}>
                  {[20,40,60,80].map(p=>(
                    <g key={p}>
                      <line x1={`${p}%`} y1="0" x2={`${p}%`} y2="100%" stroke="rgba(45,212,191,0.08)" strokeWidth="1"/>
                      <line x1="0" y1={`${p}%`} x2="100%" y2={`${p}%`} stroke="rgba(45,212,191,0.08)" strokeWidth="1"/>
                    </g>
                  ))}
                  {/* State outline suggestion */}
                  <path d="M 20 40 L 80 35 L 85 80 L 25 85 Z" fill="rgba(45,212,191,0.03)" stroke="rgba(45,212,191,0.15)" strokeWidth="1"/>
                </svg>
                {/* Animated storm dots */}
                {mapDots.map(dot=>(
                  <div key={dot.id} style={{position:"absolute",left:`${dot.x}%`,top:`${dot.y}%`,transform:"translate(-50%,-50%)"}}>
                    {/* Ripple */}
                    <div style={{position:"absolute",width:30,height:30,borderRadius:"50%",
                      border:`1px solid ${sevColor(dot.severity)}`,
                      top:"50%",left:"50%",transform:"translate(-50%,-50%)",
                      animation:"ripple 1.5s ease-out infinite"}}/>
                    {/* Core dot */}
                    <div style={{width:10,height:10,borderRadius:"50%",
                      background:sevColor(dot.severity),
                      boxShadow:`0 0 10px ${sevColor(dot.severity)}`,
                      position:"relative",zIndex:1}}/>
                    {/* Label */}
                    <div style={{position:"absolute",top:14,left:"50%",transform:"translateX(-50%)",
                      fontSize:8,fontWeight:700,color:sevColor(dot.severity),whiteSpace:"nowrap",
                      background:"rgba(3,14,24,0.8)",padding:"1px 4px",borderRadius:3}}>
                      {dot.label}
                    </div>
                  </div>
                ))}
                {/* Legend */}
                <div style={{position:"absolute",bottom:10,right:10,
                  background:"rgba(3,14,24,0.9)",borderRadius:6,padding:"6px 8px",
                  border:`1px solid ${C.border}`,display:"flex",flexDirection:"column",gap:4}}>
                  {[{c:"#f87171",l:"Extreme"},{c:"#fbbf24",l:"Severe"},{c:"#38bdf8",l:"Moderate"}].map(item=>(
                    <div key={item.l} style={{display:"flex",alignItems:"center",gap:5}}>
                      <div style={{width:7,height:7,borderRadius:"50%",background:item.c,
                        boxShadow:`0 0 4px ${item.c}`}}/>
                      <span style={{fontSize:9,color:C.textSub}}>{item.l}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div style={{marginTop:12,fontSize:12,color:C.textSub,lineHeight:1.5}}>
                Storm events detected in real time. Leads auto-generated for every affected ZIP code.
              </div>
            </div>

            {/* SMS Phone Mockup */}
            <div style={{background:"rgba(7,24,40,0.9)",border:`1px solid ${C.border}`,borderRadius:16,padding:20,
              boxShadow:"inset 0 1px 0 rgba(255,255,255,0.06)"}}>
              <div style={{fontSize:12,fontWeight:600,color:C.textSub,textTransform:"uppercase",
                letterSpacing:"0.08em",marginBottom:14,display:"flex",alignItems:"center",gap:8}}>
                <span style={{width:6,height:6,borderRadius:"50%",background:"#4ade80",
                  display:"inline-block",animation:"pulse 1.5s ease-in-out infinite"}}/>
                AI Lead Conversation
              </div>
              {/* Phone frame */}
              <div style={{background:"#060a10",borderRadius:20,border:`2px solid #1a2535`,
                padding:"12px 8px",maxWidth:280,margin:"0 auto",minHeight:200}}>
                {/* Phone notch */}
                <div style={{width:60,height:4,background:"#1a2535",borderRadius:4,margin:"0 auto 12px"}}/>
                {/* Contact header */}
                <div style={{display:"flex",alignItems:"center",gap:8,padding:"0 8px 10px",
                  borderBottom:"1px solid #1a2535",marginBottom:10}}>
                  <div style={{width:28,height:28,borderRadius:"50%",
                    background:"linear-gradient(135deg,rgba(13,148,136,0.5),rgba(2,132,199,0.4))",
                    display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,fontWeight:700,color:"#2dd4bf"}}>S</div>
                  <div>
                    <div style={{fontSize:11,fontWeight:600,color:"#fff"}}>Sarah M. · 75023</div>
                    <div style={{fontSize:9,color:"#4ade80"}}>● AI Assistant Active</div>
                  </div>
                </div>
                {/* Messages */}
                <div style={{display:"flex",flexDirection:"column",gap:8,padding:"0 8px"}}>
                  {SMS_STEPS.slice(0,smsStep).map((msg,i)=>(
                    <div key={i} style={{
                      maxWidth:"85%",
                      alignSelf:msg.role==="ai"?"flex-start":"flex-end",
                      background:msg.role==="ai"?"rgba(13,148,136,0.2)":"rgba(56,189,248,0.15)",
                      border:`1px solid ${msg.role==="ai"?"rgba(45,212,191,0.3)":"rgba(56,189,248,0.25)"}`,
                      borderRadius:msg.role==="ai"?"10px 10px 10px 3px":"10px 10px 3px 10px",
                      padding:"7px 10px",
                      fontSize:10,lineHeight:1.5,color:"#e2f8f8",
                      animation:"slideIn 0.3s ease forwards",
                    }}>{msg.msg}</div>
                  ))}
                  {smsStep<SMS_STEPS.length&&smsStep>0&&(
                    <div style={{alignSelf:"flex-start",display:"flex",gap:3,padding:"8px 10px",
                      background:"rgba(13,148,136,0.1)",borderRadius:"10px 10px 10px 3px",
                      border:"1px solid rgba(45,212,191,0.2)"}}>
                      {[0,1,2].map(i=>(
                        <div key={i} style={{width:5,height:5,borderRadius:"50%",background:"#2dd4bf",
                          animation:`pulse ${0.6+i*0.2}s ease-in-out infinite alternate`}}/>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              <div style={{marginTop:12,fontSize:12,color:C.textSub,lineHeight:1.5,textAlign:"center"}}>
                AI replies instantly, 24/7. No manual effort required.
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── PRICING ── */}
      <section id="pricing" style={{position:"relative",zIndex:1,maxWidth:1100,margin:"0 auto",padding:"80px 24px"}}>
        <div style={{textAlign:"center",marginBottom:48}}>
          <div style={{fontSize:12,fontWeight:600,color:C.orange,letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:12}}>Transparent Pricing</div>
          <h2 style={{fontFamily:"'Space Grotesk',sans-serif",fontSize:40,fontWeight:800,letterSpacing:"-0.02em",color:"#fff",marginBottom:14}}>
            Start free. Upgrade when ready.
          </h2>
          <p style={{fontSize:15,color:C.textSub,marginBottom:24}}>14-day free trial on all plans. No credit card required. One-time $500 setup fee.</p>
          {/* Billing toggle */}
          <div style={{display:"inline-flex",alignItems:"center",gap:0,
            background:"rgba(255,255,255,0.04)",border:`1px solid ${C.border}`,borderRadius:30,padding:4}}>
            <button onClick={()=>setBillingCycle("monthly")} style={{
              padding:"8px 22px",borderRadius:26,fontSize:13,fontWeight:600,cursor:"pointer",border:"none",
              background:billingCycle==="monthly"?"linear-gradient(135deg,#0d9488,#0284c7)":"transparent",
              color:billingCycle==="monthly"?"#fff":C.textSub}}>
              Monthly
            </button>
            <button onClick={()=>setBillingCycle("annual")} style={{
              padding:"8px 22px",borderRadius:26,fontSize:13,fontWeight:600,cursor:"pointer",border:"none",
              background:billingCycle==="annual"?"linear-gradient(135deg,#0d9488,#0284c7)":"transparent",
              color:billingCycle==="annual"?"#fff":C.textSub,display:"flex",alignItems:"center",gap:8}}>
              Annual
              <span style={{fontSize:10,fontWeight:700,background:C.green,color:"#000",
                padding:"2px 8px",borderRadius:10}}>Save 2 months</span>
            </button>
          </div>
        </div>

        {/* Plan cards */}
        <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:16,marginBottom:40}}>
          {PLANS.map(p=>{
            const price = billingCycle==="monthly" ? p.monthly : p.annual;
            const monthlyEquiv = billingCycle==="annual" ? p.annualMonthly : null;
            return(
              <div key={p.name} style={{background:"rgba(255,255,255,0.03)",backdropFilter:"blur(20px)",
                border:`1px solid ${p.popular?p.color+"55":C.border}`,
                borderRadius:18,padding:30,position:"relative",
                boxShadow:p.popular?`0 0 60px ${p.color}18,inset 0 1px 0 rgba(255,255,255,0.08)`:"inset 0 1px 0 rgba(255,255,255,0.05)"}}>
                {p.popular&&<div style={{position:"absolute",top:-13,left:"50%",transform:"translateX(-50%)",
                  background:"linear-gradient(135deg,#0d9488,#0284c7)",color:"#fff",
                  fontSize:10,fontWeight:700,padding:"4px 16px",borderRadius:20,
                  textTransform:"uppercase",letterSpacing:"0.06em",whiteSpace:"nowrap",
                  boxShadow:"0 4px 14px rgba(13,148,136,0.4)"}}>Most Popular</div>}
                <div style={{fontSize:13,fontWeight:700,color:p.color,marginBottom:14,
                  textTransform:"uppercase",letterSpacing:"0.08em"}}>{p.name}</div>
                {/* Price */}
                <div style={{display:"flex",alignItems:"baseline",gap:4,marginBottom:billingCycle==="annual"?4:16}}>
                  <span style={{fontFamily:"'Space Grotesk',sans-serif",fontSize:44,fontWeight:800,color:"#fff"}}>
                    ${billingCycle==="annual"?p.annual.toLocaleString():p.monthly.toLocaleString()}
                  </span>
                  <span style={{fontSize:13,color:C.textSub}}>/{billingCycle==="annual"?"yr":"mo"}</span>
                </div>
                {billingCycle==="annual"&&<div style={{marginBottom:4}}>
                  <span style={{fontSize:12,color:C.textMuted,textDecoration:"line-through"}}>${(p.monthly*12).toLocaleString()}/yr</span>
                  <span style={{fontSize:11,color:C.green,marginLeft:8}}>≈ ${monthlyEquiv?.toLocaleString()}/mo</span>
                </div>}
                <div style={{fontSize:11,color:C.textMuted,marginBottom:20}}>+ one-time $500 setup fee · after 14-day free trial</div>
                <div style={{height:1,background:C.border,marginBottom:18}}/>
                {/* Limits */}
                <div style={{display:"flex",gap:10,marginBottom:16,flexWrap:"wrap"}}>
                  <span style={{fontSize:10,fontWeight:600,padding:"3px 9px",borderRadius:6,
                    background:`${p.color}14`,color:p.color,border:`1px solid ${p.color}28`}}>
                    {p.seats} seat{p.seats>1?"s":""}
                  </span>
                  <span style={{fontSize:10,fontWeight:600,padding:"3px 9px",borderRadius:6,
                    background:`${p.color}14`,color:p.color,border:`1px solid ${p.color}28`}}>
                    {p.zipLimit} ZIPs
                  </span>
                </div>
                <div style={{display:"flex",flexDirection:"column",gap:10,marginBottom:24}}>
                  {p.features.map(f=>(
                    <div key={f} style={{display:"flex",alignItems:"flex-start",gap:10}}>
                      <div style={{width:17,height:17,borderRadius:5,background:`${p.color}14`,
                        border:`1px solid ${p.color}28`,display:"flex",alignItems:"center",justifyContent:"center",
                        fontSize:9,color:p.color,flexShrink:0,marginTop:1}}>✓</div>
                      <span style={{fontSize:13,color:C.textSub,lineHeight:1.4}}>{f}</span>
                    </div>
                  ))}
                </div>
                <button onClick={()=>document.getElementById("contact").scrollIntoView({behavior:"smooth"})}
                  style={{width:"100%",fontSize:14,fontWeight:600,padding:"13px 0",borderRadius:10,cursor:"pointer",
                  background:p.popular?"linear-gradient(135deg,#0d9488,#0284c7)":"transparent",
                  color:p.popular?"#fff":p.color,
                  border:p.popular?"none":`1px solid ${p.color}44`,
                  boxShadow:p.popular?"0 4px 16px rgba(13,148,136,0.4)":"none"}}>
                  Start Free Trial
                </button>
              </div>
            );
          })}
        </div>

        {/* Add-ons */}
        <div style={{background:"rgba(255,255,255,0.02)",border:`1px solid ${C.border}`,
          borderRadius:16,padding:28,backdropFilter:"blur(20px)"}}>
          <div style={{textAlign:"center",marginBottom:24}}>
            <div style={{fontFamily:"'Space Grotesk',sans-serif",fontSize:20,fontWeight:700,color:"#fff",marginBottom:6}}>
              Add-Ons
            </div>
            <div style={{fontSize:13,color:C.textSub}}>Expand your capabilities beyond your base plan</div>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(2,1fr)",gap:12}}>
            {LANDING_ADDONS.map(a=>(
              <div key={a.label} style={{background:"rgba(255,255,255,0.03)",border:`1px solid ${C.border}`,
                borderRadius:12,padding:18,display:"flex",gap:14,alignItems:"flex-start"}}>
                <div style={{width:40,height:40,borderRadius:10,background:`${C.orange}14`,
                  border:`1px solid ${C.orange}28`,display:"flex",alignItems:"center",justifyContent:"center",
                  fontSize:16,color:C.orange,flexShrink:0}}>+</div>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontSize:13,fontWeight:700,color:"#fff",marginBottom:3}}>{a.label}</div>
                  <div style={{display:"flex",alignItems:"baseline",gap:6,marginBottom:4}}>
                    <span style={{fontSize:16,fontWeight:700,color:C.orange}}>{a.price}</span>
                    {a.strikethrough&&<span style={{fontSize:12,color:C.red,textDecoration:"line-through"}}>{a.strikethrough}</span>}
                    {a.strikethrough&&<span style={{fontSize:10,fontWeight:700,background:C.green,color:"#000",padding:"1px 6px",borderRadius:8}}>20% off</span>}
                  </div>
                  <div style={{fontSize:12,color:C.textSub}}>{a.desc}</div>
                  {a.note&&<div style={{fontSize:10,color:C.textMuted,marginTop:3}}>{a.note}</div>}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── TESTIMONIALS ── */}
      <section style={{position:"relative",zIndex:1,background:"rgba(255,255,255,0.015)",

        borderTop:`1px solid ${C.border}`,borderBottom:`1px solid ${C.border}`,padding:"80px 24px"}}>
        <div style={{maxWidth:1100,margin:"0 auto"}}>
          <div style={{textAlign:"center",marginBottom:48}}>
            <div style={{fontSize:12,fontWeight:600,color:C.orange,letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:12}}>What Roofers Say</div>
            <h2 style={{fontFamily:"'Space Grotesk',sans-serif",fontSize:36,fontWeight:800,letterSpacing:"-0.02em",color:"#fff"}}>
              Real results from real roofing companies
            </h2>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:16}}>
            {TESTIMONIALS.map(t=>(
              <div key={t.name} style={{background:"rgba(7,24,40,0.9)",border:`1px solid ${C.border}`,
                borderRadius:16,padding:28,
                boxShadow:"inset 0 1px 0 rgba(255,255,255,0.05)"}}>
                {/* Stars */}
                <div style={{display:"flex",gap:3,marginBottom:16}}>
                  {[1,2,3,4,5].map(i=>(
                    <div key={i} style={{color:C.amber,fontSize:14}}>★</div>
                  ))}
                </div>
                <div style={{fontSize:13,color:C.textSub,lineHeight:1.7,marginBottom:20,fontStyle:"italic"}}>
                  "{t.text}"
                </div>
                <div style={{display:"flex",alignItems:"center",gap:10,paddingTop:16,
                  borderTop:`1px solid ${C.border}`}}>
                  <div style={{width:36,height:36,borderRadius:10,
                    background:"linear-gradient(135deg,rgba(13,148,136,0.4),rgba(2,132,199,0.3))",
                    border:`1px solid ${C.border}`,
                    display:"flex",alignItems:"center",justifyContent:"center",
                    fontSize:14,fontWeight:700,color:C.orange}}>
                    {t.name[0]}
                  </div>
                  <div>
                    <div style={{fontSize:13,fontWeight:600,color:"#fff"}}>{t.name}</div>
                    <div style={{fontSize:11,color:C.textSub}}>{t.company}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CONTACT / CTA ── */}
      <section id="contact" style={{position:"relative",zIndex:1,maxWidth:1100,margin:"0 auto",padding:"80px 24px"}}>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:60,alignItems:"center"}}>
          <div>
            <div style={{fontSize:12,fontWeight:600,color:C.orange,letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:12}}>Get Started</div>
            <h2 style={{fontFamily:"'Space Grotesk',sans-serif",fontSize:38,fontWeight:800,letterSpacing:"-0.02em",color:"#fff",marginBottom:16,lineHeight:1.15}}>
              Ready to capture more storm leads?
            </h2>
            <p style={{fontSize:15,color:C.textSub,lineHeight:1.7,marginBottom:28}}>
              Start your free 14-day trial today or book a demo and we'll walk you through the entire platform live.
            </p>
            <div style={{display:"flex",flexDirection:"column",gap:16}}>
              {[
                {icon:"◆",t:"14-day free trial",d:"Full access to all features, no credit card needed"},
                {icon:"◈",t:"Live demo available",d:"See the platform in action with your own data"},
                {icon:"▦",t:"Same-day onboarding",d:"We'll get you set up and running within hours"},
              ].map(item=>(
                <div key={item.t} style={{display:"flex",alignItems:"flex-start",gap:14}}>
                  <div style={{width:36,height:36,borderRadius:10,
                    background:"linear-gradient(135deg,rgba(13,148,136,0.3),rgba(2,132,199,0.2))",
                    border:`1px solid ${C.orange}33`,
                    display:"flex",alignItems:"center",justifyContent:"center",
                    fontSize:14,color:C.orange,flexShrink:0}}>
                    {item.icon}
                  </div>
                  <div style={{paddingTop:2}}>
                    <div style={{fontSize:14,fontWeight:600,color:"#fff",marginBottom:2}}>{item.t}</div>
                    <div style={{fontSize:12,color:C.textSub}}>{item.d}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Form */}
          <div style={{background:"rgba(7,24,40,0.95)",border:`1px solid ${C.borderAct}`,
            borderRadius:18,padding:34,backdropFilter:"blur(20px)",
            boxShadow:`0 0 60px rgba(45,212,191,0.08),inset 0 1px 0 rgba(255,255,255,0.07)`}}>
            {demoSent
              ? <div style={{textAlign:"center",padding:"20px 0"}}>
                  <div style={{width:56,height:56,borderRadius:16,
                    background:"linear-gradient(135deg,#0d9488,#0284c7)",
                    display:"flex",alignItems:"center",justifyContent:"center",fontSize:24,
                    margin:"0 auto 18px",boxShadow:"0 8px 24px rgba(13,148,136,0.4)"}}>✓</div>
                  <div style={{fontFamily:"'Space Grotesk',sans-serif",fontSize:20,fontWeight:700,color:"#fff",marginBottom:8}}>You're on the list!</div>
                  <div style={{fontSize:13,color:C.textSub,lineHeight:1.6,marginBottom:24}}>
                    Noah will reach out within 24 hours to get you set up.
                  </div>
                  <button onClick={onSignIn} style={{fontSize:13,fontWeight:600,padding:"11px 28px",
                    borderRadius:9,background:"linear-gradient(135deg,#0d9488,#0284c7)",
                    color:"#fff",border:"none",cursor:"pointer",
                    boxShadow:"0 4px 14px rgba(13,148,136,0.35)"}}>
                    Sign In to Your Trial
                  </button>
                </div>
              : <>
                  <div style={{fontFamily:"'Space Grotesk',sans-serif",fontSize:20,fontWeight:700,color:"#fff",marginBottom:4}}>
                    Start Free Trial / Book a Demo
                  </div>
                  <div style={{fontSize:12,color:C.textSub,marginBottom:22}}>
                    No credit card · 14 days free · Cancel anytime
                  </div>
                  <div style={{display:"flex",flexDirection:"column",gap:14}}>
                    {[
                      {label:"Your Name",val:demoName,set:setDemoName,ph:"Marcus Holt"},
                      {label:"Email Address",val:demoEmail,set:setDemoEmail,ph:"marcus@yourcompany.com"},
                      {label:"Phone Number",val:demoPhone,set:setDemoPhone,ph:"972-555-0101"},
                    ].map(f=>(
                      <div key={f.label}>
                        <div style={{fontSize:10,fontWeight:600,color:C.textSub,marginBottom:5,
                          textTransform:"uppercase",letterSpacing:"0.08em"}}>{f.label}</div>
                        <input value={f.val} onChange={e=>f.set(e.target.value)}
                          placeholder={f.ph}
                          style={{width:"100%",background:"rgba(255,255,255,0.04)",
                            border:`1px solid ${C.border}`,borderRadius:9,
                            padding:"11px 14px",color:C.text,fontSize:13,outline:"none",
                            transition:"border-color 0.15s"}}
                          onFocus={e=>e.target.style.borderColor=C.orange+"66"}
                          onBlur={e=>e.target.style.borderColor=C.border}/>
                      </div>
                    ))}
                    <button onClick={()=>{
                      if(!demoName||!demoEmail){alert("Please enter your name and email.");return;}
                      setDemoSent(true);
                    }} style={{fontSize:14,fontWeight:700,padding:"14px 0",borderRadius:10,
                      background:"linear-gradient(135deg,#0d9488,#0284c7)",color:"#fff",border:"none",
                      cursor:"pointer",marginTop:4,
                      boxShadow:"0 4px 16px rgba(13,148,136,0.4)"}}>
                      Get Started Free →
                    </button>
                    <div style={{fontSize:11,color:C.textMuted,textAlign:"center"}}>
                      By submitting you agree to be contacted by Ark Dynamics about SkyShield Pro.
                    </div>
                  </div>
                </>
            }
          </div>
        </div>
      </section>

      {/* ── FOOTER ── */}
      <footer style={{position:"relative",zIndex:1,borderTop:`1px solid ${C.border}`,padding:"32px 24px"}}>
        <div style={{maxWidth:1100,margin:"0 auto",display:"flex",alignItems:"center",
          justifyContent:"space-between",flexWrap:"wrap",gap:16}}>
          <div style={{display:"flex",alignItems:"center",gap:10}}>
            <div style={{width:26,height:26,borderRadius:7,background:"linear-gradient(135deg,#0d9488,#0284c7)",
              display:"flex",alignItems:"center",justifyContent:"center",fontSize:13}}>⛈</div>
            <span style={{fontFamily:"'Space Grotesk',sans-serif",fontSize:14,fontWeight:700,color:"#fff"}}>
              Sky<span style={{color:C.orange}}>Shield</span> Pro
            </span>
            <span style={{fontSize:12,color:C.textMuted}}>by Ark Dynamics</span>
          </div>
          <div style={{display:"flex",gap:20}}>
            {["Features","Pricing","Contact"].map(l=>(
              <a key={l} href={`#${l.toLowerCase()}`}
                style={{fontSize:12,color:C.textMuted,textDecoration:"none"}}>{l}</a>
            ))}
          </div>
          <div style={{fontSize:12,color:C.textMuted}}>
            © {new Date().getFullYear()} Ark Dynamics · skyshieldpro@arkdynamics.io
          </div>
        </div>
      </footer>

    </div>
  );
}


function LoginScreen({onLoginSuccess}){
  const[view,setView]=useState("signin"); // signin | forgot | sent
  const[email,setEmail]=useState(""),[password,setPassword]=useState("");
  const[error,setError]=useState(""),[loading,setLoading]=useState(false);

  async function handleSignIn(){
    if(!email||!password){setError("Please enter your email and password.");return;}
    setLoading(true);setError("");
    try{
      const data=await supabaseSignIn(email.trim(),password);
      onLoginSuccess(data);
    }catch(e){setError(e.message);}
    setLoading(false);
  }

  async function handleForgotPassword(){
    if(!email){setError("Enter your email address first.");return;}
    setLoading(true);setError("");
    try{
      await supabaseResetPassword(email.trim());
      setView("sent");
    }catch(e){setError(e.message);}
    setLoading(false);
  }

  return <div style={{minHeight:"100vh",background:C.bg,display:"flex",alignItems:"center",justifyContent:"center",padding:20}}>
    <div style={{width:"100%",maxWidth:380}}>
      <div style={{textAlign:"center",marginBottom:32}}>
        <div style={{width:56,height:56,borderRadius:14,background:"linear-gradient(135deg,#0d9488,#0284c7)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:26,margin:"0 auto 16px"}}>⛈</div>
        <div style={{...T.head(24,700),letterSpacing:"-0.02em"}}>Sky<span style={{color:C.orange}}>Shield</span> Pro</div>
        <div style={{fontSize:10,color:C.textMuted,letterSpacing:"0.1em",textTransform:"uppercase",marginTop:6}}>Powered by Ark Dynamics</div>
      </div>

      <div style={card({padding:24})}>
        {view==="sent" ? (
          <div style={{textAlign:"center",padding:"10px 0"}}>
            <div style={{fontSize:32,marginBottom:12}}>📧</div>
            <div style={{...T.head(15,600),marginBottom:8}}>Check your email</div>
            <div style={{fontSize:13,color:C.textSub,lineHeight:1.6,marginBottom:18}}>
              We sent a password reset link to <strong style={{color:C.text}}>{email}</strong>. Click the link to set a new password.
            </div>
            <Btn variant="default" onClick={()=>{setView("signin");setError("");}} style={{width:"100%"}}>Back to Sign In</Btn>
          </div>
        ) : view==="forgot" ? (
          <div>
            <div style={{...T.head(15,600),marginBottom:6}}>Reset your password</div>
            <div style={{fontSize:13,color:C.textMuted,marginBottom:18,lineHeight:1.6}}>Enter your account email and we'll send you a link to reset your password.</div>
            <div style={{marginBottom:14}}><Input label="Email" type="email" value={email} onChange={v=>{setEmail(v);setError("");}} placeholder="you@company.com"/></div>
            {error&&<div style={{color:C.red,fontSize:12,marginBottom:12,padding:"7px 10px",background:C.redDim,borderRadius:6}}>{error}</div>}
            <Btn variant="primary" onClick={handleForgotPassword} disabled={loading} style={{width:"100%",padding:"10px",fontSize:14}}>{loading?"Sending...":"Send Reset Link"}</Btn>
            <button onClick={()=>{setView("signin");setError("");}} style={{display:"block",width:"100%",textAlign:"center",background:"none",border:"none",color:C.textMuted,fontSize:12,marginTop:14,cursor:"pointer"}}>← Back to Sign In</button>
          </div>
        ) : (
          <div>
            <div style={{marginBottom:14}}><Input label="Email" type="email" value={email} onChange={v=>{setEmail(v);setError("");}} placeholder="you@company.com"/></div>
            <div style={{marginBottom:8}}><Input label="Password" type="password" value={password} onChange={v=>{setPassword(v);setError("");}} placeholder="Enter your password" onKeyDown={e=>e.key==="Enter"&&handleSignIn()}/></div>
            <button onClick={()=>{setView("forgot");setError("");}} style={{display:"block",background:"none",border:"none",color:C.orange,fontSize:12,marginBottom:16,cursor:"pointer",padding:0}}>Forgot password?</button>
            {error&&<div style={{color:C.red,fontSize:12,marginBottom:12,padding:"7px 10px",background:C.redDim,borderRadius:6}}>{error}</div>}
            <Btn variant="primary" onClick={handleSignIn} disabled={loading} style={{width:"100%",padding:"10px",fontSize:14}}>{loading?"Signing in...":"Sign In"}</Btn>
          </div>
        )}
      </div>
    </div>
  </div>;
}

// ─── RESET PASSWORD SCREEN ────────────────────────────────────────────────────
// Shown when the user arrives via the password-reset email link.
// Supabase appends #access_token=...&type=recovery to the URL.
function ResetPasswordScreen({accessToken,onDone}){
  const[password,setPassword]=useState(""),[confirm,setConfirm]=useState("");
  const[error,setError]=useState(""),[loading,setLoading]=useState(false),[success,setSuccess]=useState(false);

  async function handleReset(){
    if(!password||password.length<6){setError("Password must be at least 6 characters.");return;}
    if(password!==confirm){setError("Passwords do not match.");return;}
    setLoading(true);setError("");
    try{
      await supabaseUpdatePassword(accessToken,password);
      setSuccess(true);
      setTimeout(()=>onDone(),2500);
    }catch(e){setError(e.message);}
    setLoading(false);
  }

  return <div style={{minHeight:"100vh",background:C.bg,display:"flex",alignItems:"center",justifyContent:"center",padding:20}}>
    <div style={{width:"100%",maxWidth:380}}>
      <div style={{textAlign:"center",marginBottom:32}}>
        <div style={{width:56,height:56,borderRadius:14,background:"linear-gradient(135deg,#0d9488,#0284c7)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:26,margin:"0 auto 16px"}}>⛈</div>
        <div style={{...T.head(24,700),letterSpacing:"-0.02em"}}>Sky<span style={{color:C.orange}}>Shield</span> Pro</div>
        <div style={{fontSize:10,color:C.textMuted,letterSpacing:"0.1em",textTransform:"uppercase",marginTop:6}}>Powered by Ark Dynamics</div>
      </div>
      <div style={card({padding:24})}>
        {success ? (
          <div style={{textAlign:"center",padding:"10px 0"}}>
            <div style={{fontSize:32,marginBottom:12}}>✅</div>
            <div style={{...T.head(15,600),marginBottom:8}}>Password updated</div>
            <div style={{fontSize:13,color:C.textSub,lineHeight:1.6}}>Redirecting you to sign in...</div>
          </div>
        ) : (
          <div>
            <div style={{...T.head(15,600),marginBottom:6}}>Set a new password</div>
            <div style={{fontSize:13,color:C.textMuted,marginBottom:18,lineHeight:1.6}}>Choose a new password for your account.</div>
            <div style={{marginBottom:12}}><Input label="New Password" type="password" value={password} onChange={v=>{setPassword(v);setError("");}} placeholder="At least 6 characters"/></div>
            <div style={{marginBottom:14}}><Input label="Confirm Password" type="password" value={confirm} onChange={v=>{setConfirm(v);setError("");}} placeholder="Re-enter password" onKeyDown={e=>e.key==="Enter"&&handleReset()}/></div>
            {error&&<div style={{color:C.red,fontSize:12,marginBottom:12,padding:"7px 10px",background:C.redDim,borderRadius:6}}>{error}</div>}
            <Btn variant="primary" onClick={handleReset} disabled={loading} style={{width:"100%",padding:"10px",fontSize:14}}>{loading?"Updating...":"Update Password"}</Btn>
          </div>
        )}
      </div>
    </div>
  </div>;
}

// ─── LEAD ROW ─────────────────────────────────────────────────────────────────
function AdultBadge({status}){
  const s=status||"unconfirmed";
  if(s==="confirmed") return <Badge label="adult ✓" color={C.green} small/>;
  if(s==="denied") return <Badge label="adult ✗" color={C.red} small/>;
  if(s==="pending") return <Badge label="adult ?" color={C.yellow} small/>;
  return <Badge label="adult —" color={C.textMuted} small/>;
}

function LeadRow({lead,roofers,onSMS,onBook,onEdit,onDelete,onViewConvo,onLogRevenue,showRoofer}){
  const roofer=roofers.find(r=>r.id===lead.rooferId);
  const unread=(lead.conversations||[]).filter(c=>c.role==="lead").length;
  return <TR>
    <TD bold sub={lead.address||(lead.notes?"↳ "+lead.notes.slice(0,40):undefined)}>{lead.homeowner}</TD>
    <TD dim>{lead.phone}</TD>
    <TD>{lead.zip}</TD>
    {showRoofer&&<TD dim>{roofer?.name||"—"}</TD>}
    <TD dim>{lead.stormType}</TD>
    <TD><div style={{display:"flex",gap:4,flexWrap:"wrap"}}><StatusBadge status={lead.status}/><AdultBadge status={lead.adultConfirmed}/></div></TD>
    <TD nowrap>
      <div style={{...flex(4),flexWrap:"wrap"}}>
        <button onClick={()=>onViewConvo(lead)} style={{background:"none",border:"none",cursor:"pointer",fontSize:14,position:"relative",padding:"3px 5px",lineHeight:1}}>
          ⌥{unread>0&&<span style={{position:"absolute",top:-2,right:-2,background:C.orange,color:"#fff",borderRadius:"50%",width:13,height:13,fontSize:8,display:"flex",alignItems:"center",justifyContent:"center",fontWeight:700}}>{unread}</span>}
        </button>
        {lead.status==="pending"&&<Btn small variant="info" onClick={()=>onSMS(lead)}>SMS</Btn>}
        {lead.status==="contacted"&&<Btn small variant="success" onClick={()=>onBook(lead)}>Book</Btn>}
        {lead.status==="scheduled"&&<Btn small variant="purple" onClick={()=>onLogRevenue(lead)}>Won</Btn>}
        <Btn small variant="default" onClick={()=>onEdit(lead)}>Edit</Btn>
        <Btn small variant="danger" onClick={()=>{if(window.confirm("Delete this lead?"))onDelete(lead);}}>✕</Btn>
      </div>
    </TD>
  </TR>;
}

// ─── ROOFER DASHBOARD ─────────────────────────────────────────────────────────
function RooferDashboard({roofer,leads,apiKeys,onUpdate,addActivity}){
  const[tab,setTab]=useState("Overview");
  const[showAddInspector,setShowAddInspector]=useState(false);
  const[bookingModal,setBookingModal]=useState(null); // {leadToBook} | {existingInspection} | {} for blank manual
  const[editingLead,setEditingLead]=useState(null);
  const[viewingConvo,setViewingConvo]=useState(null);
  const[loggingRevenue,setLoggingRevenue]=useState(null);
  const[leadFilter,setLeadFilter]=useState("all");
  const[showAddLead,setShowAddLead]=useState(false);
  const[newZip,setNewZip]=useState("");

  const myLeads=leads.filter(l=>l.rooferId===roofer.id);
  const pending=myLeads.filter(l=>l.status==="pending");
  const contacted=myLeads.filter(l=>l.status==="contacted");
  const scheduled=myLeads.filter(l=>l.status==="scheduled");
  const won=myLeads.filter(l=>l.status==="won");
  const filteredLeads=leadFilter==="all"?myLeads:myLeads.filter(l=>l.status===leadFilter);
  const insStats=INSPECTION_STATUSES.reduce((acc,st)=>({...acc,[st]:roofer.inspections.filter(i=>i.status===st).length}),{});

  async function smsLead(lead){
    const comm=roofer.commSettings||DEFAULT_COMM;
    if(!isWithinCommWindow(comm)&&!window.confirm("Outside active hours. Send anyway?")) return;
    const msg=fillTemplate(comm.templates.initial,{name:lead.homeowner,zip:lead.zip,storm:lead.stormType,company:roofer.name});
    if(apiKeys.twilio?.sid) await sendTwilioSMS(apiKeys.twilio,lead.phone,msg,roofer.twilioFrom);
    onUpdate("lead_status",{leadId:lead.id,status:"contacted"});
    onUpdate("add_conversation",{leadId:lead.id,entry:{role:"ai",msg,ts:new Date().toLocaleString()}});
    onUpdate("set_contacted_at",{leadId:lead.id,ts:new Date().toISOString().split("T")[0]});
    addActivity({type:"sms",message:`SMS sent to ${lead.homeowner} (${roofer.name})`,badge:"contacted",badgeColor:C.blue});
    alert(`SMS sent to ${lead.homeowner}:\n\n${msg}`);
  }
  function bookLead(lead){
    const inspector=roofer.inspectors.find(i=>i.zones.includes(lead.zip))||roofer.inspectors[0];
    if(!inspector){ alert("Add an inspector before booking inspections."); return; }
    const comm=roofer.commSettings||DEFAULT_COMM;
    if(comm.requireAdultPresent!==false&&lead.adultConfirmed!=="confirmed"){
      if(!window.confirm(`${lead.homeowner} has not yet confirmed that an adult (18+) will be present during the inspection. Continue booking anyway? (You can confirm this yourself by phone first.)`)) return;
    }
    const nextSlot=getNextAvailableSlots(roofer,inspector.id,{limit:1})[0];
    if(!nextSlot){ alert("No available slots found in the next 14 days for "+inspector.name+". Check operating hours in Schedule settings."); return; }
    const ins={id:"ins"+Date.now(),client:lead.homeowner,address:(lead.address?`${lead.address}, ${lead.zip}`:lead.zip),phone:lead.phone,startISO:nextSlot.startISO,endISO:nextSlot.endISO,inspectorId:inspector.id,inspector:inspector.name,status:"scheduled",source:"lead",leadId:lead.id};
    onUpdate("book_lead",{leadId:lead.id,rooferId:roofer.id,inspection:ins});
    const msg=fillTemplate(comm.templates.booking,{name:lead.homeowner,date:formatDateLabel(nextSlot.startISO),time:formatTimeLabel(nextSlot.startISO),inspector:inspector.name,company:roofer.name});
    if(apiKeys.twilio?.sid) sendTwilioSMS(apiKeys.twilio,lead.phone,msg,roofer.twilioFrom);
    onUpdate("add_conversation",{leadId:lead.id,entry:{role:"ai",msg,ts:new Date().toLocaleString()}});
    addActivity({type:"booking",message:`Inspection booked for ${lead.homeowner} — ${formatDateLabel(nextSlot.startISO)} at ${formatTimeLabel(nextSlot.startISO)}`,badge:"scheduled",badgeColor:C.green});
    onUpdate("notify_roofer",{rooferId:roofer.id,notification:{type:"booking",message:`New inspection booked: ${lead.homeowner} on ${formatDateLabel(nextSlot.startISO)} at ${formatTimeLabel(nextSlot.startISO)} with ${inspector.name}`,smsText:`SkyShield Pro: New inspection booked — ${lead.homeowner} on ${formatDateLabel(nextSlot.startISO)} at ${formatTimeLabel(nextSlot.startISO)} with ${inspector.name}.`}});
  }
  function sendManualMessage(lead,msg){
    if(apiKeys.twilio?.sid) sendTwilioSMS(apiKeys.twilio,lead.phone,msg,roofer.twilioFrom);
    onUpdate("add_conversation",{leadId:lead.id,entry:{role:"ai",msg,ts:new Date().toLocaleString()}});
  }
  function logRevenue(entry){
    onUpdate("log_revenue",{rooferId:roofer.id,entry});
    onUpdate("lead_status",{leadId:entry.leadId,status:"won"});
    addActivity({type:"revenue",message:`$${entry.amount.toLocaleString()} logged — ${entry.homeowner}`,badge:`$${entry.amount.toLocaleString()}`,badgeColor:C.green});
  }

  const revByMonth=(roofer.revenueLog||[]).reduce((acc,r)=>{const mo=r.date?.slice(0,7)||"?";acc[mo]=(acc[mo]||0)+r.amount;return acc;},{});
  const revChart=Object.entries(revByMonth).slice(-6).map(([label,value])=>({label:label.slice(5),value,color:C.green}));
  const sortedInspections=[...roofer.inspections].sort((a,b)=>new Date(a.startISO)-new Date(b.startISO));
  const groupedIns=sortedInspections.reduce((acc,ins)=>{const d=ins.startISO.split("T")[0];(acc[d]||(acc[d]=[])).push(ins);return acc;},{});
  const ctx=`Roofer: ${roofer.name}. Leads: ${myLeads.length}, Booked: ${scheduled.length}, Won: ${won.length}, Revenue: $${roofer.revenue.toLocaleString()}`;

  return <div>
    {showAddInspector&&<AddInspectorModal onClose={()=>setShowAddInspector(false)} onAdd={insp=>onUpdate("add_inspector",{rooferId:roofer.id,inspector:insp})}/>}
    {bookingModal&&<AddInspectionModal roofer={roofer} leads={leads} leadToBook={bookingModal.leadToBook} existingInspection={bookingModal.existingInspection}
      onClose={()=>setBookingModal(null)}
      onAdd={ins=>{
        onUpdate("add_inspection",{rooferId:roofer.id,inspection:ins});
        if(ins.leadId) onUpdate("lead_status",{leadId:ins.leadId,status:"scheduled"});
        addActivity({type:"booking",message:`Inspection booked for ${ins.client} — ${formatDateLabel(ins.startISO)} at ${formatTimeLabel(ins.startISO)}`,badge:"scheduled",badgeColor:C.green});
        onUpdate("notify_roofer",{rooferId:roofer.id,notification:{type:"booking",message:`New appointment: ${ins.client} on ${formatDateLabel(ins.startISO)} at ${formatTimeLabel(ins.startISO)} with ${ins.inspector}`,smsText:`SkyShield Pro: New appointment booked — ${ins.client} on ${formatDateLabel(ins.startISO)} at ${formatTimeLabel(ins.startISO)} with ${ins.inspector}.`}});
      }}
      onReschedule={ins=>{
        onUpdate("reschedule_inspection",{rooferId:roofer.id,inspection:ins});
        addActivity({type:"booking",message:`${ins.client}'s inspection moved to ${formatDateLabel(ins.startISO)} at ${formatTimeLabel(ins.startISO)}`,badge:"rescheduled",badgeColor:C.yellow});
        onUpdate("notify_roofer",{rooferId:roofer.id,notification:{type:"reschedule",message:`Rescheduled: ${ins.client} moved to ${formatDateLabel(ins.startISO)} at ${formatTimeLabel(ins.startISO)}`,smsText:`SkyShield Pro: ${ins.client}'s inspection was moved to ${formatDateLabel(ins.startISO)} at ${formatTimeLabel(ins.startISO)}.`}});
      }}/>}
    {editingLead&&<EditLeadModal lead={editingLead} roofers={[roofer]} onClose={()=>setEditingLead(null)} onSave={l=>onUpdate("edit_lead",{lead:l})}/>}
    {viewingConvo&&<ConversationModal lead={viewingConvo} roofer={roofer} onClose={()=>setViewingConvo(null)} onSendMessage={sendManualMessage} onUpdateNotes={(id,notes)=>onUpdate("update_lead_notes",{leadId:id,notes})}/>}
    {loggingRevenue&&<LogRevenueModal lead={loggingRevenue} onClose={()=>setLoggingRevenue(null)} onSave={logRevenue}/>}

    <Tabs tabs={["Overview","Leads","Calendar","Schedule","Revenue","Inspectors","Territories","Comm Settings","AI Agent"]} active={tab} onChange={setTab}/>

    {tab==="Overview"&&<div style={{display:"flex",flexDirection:"column",gap:16}}>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(140px,1fr))",gap:12}}>
        <StatCard label="Total Leads" value={myLeads.length} color={C.orange} icon="◈"/>
        <StatCard label="Booked" value={scheduled.length} color={C.blue} icon="▦"/>
        <StatCard label="Won Jobs" value={won.length} color={C.green} icon="✅"/>
        <StatCard label="Revenue" value={`$${roofer.revenue.toLocaleString()}`} color={C.purple} icon="$"/>
        <StatCard label="Conv. Rate" value={`${myLeads.length>0?Math.round(won.length/myLeads.length*100):0}%`} color={C.yellow} icon="📈"/>
      </div>
      <div style={grid("1fr 1fr",16)}>
        <div style={card()}>
          <div style={{...T.head(13,600),marginBottom:14}}>Lead Pipeline</div>
          <MiniBarChart data={[{label:"Total",value:myLeads.length,color:C.orange},{label:"Contacted",value:contacted.length,color:C.blue},{label:"Booked",value:scheduled.length,color:C.purple},{label:"Won",value:won.length,color:C.green}]}/>
        </div>
        <div style={card()}>
          <div style={{...T.head(13,600),marginBottom:14}}>Inspection Outcomes</div>
          <div style={{display:"flex",flexDirection:"column",gap:10}}>
            {INSPECTION_STATUSES.map(st=><div key={st} style={{...flex(0,"center","space-between")}}>
              <Badge label={st} color={INS_STATUS_COLORS[st]} small/>
              <span style={{fontSize:15,fontWeight:700,color:INS_STATUS_COLORS[st]}}>{insStats[st]||0}</span>
            </div>)}
          </div>
        </div>
      </div>
      <div style={card()}>
        <div style={{...T.head(13,600),marginBottom:14}}>Upcoming Inspections</div>
        {(()=>{
          const upcoming=roofer.inspections.filter(i=>i.status==="scheduled"&&new Date(i.startISO)>=new Date()).sort((a,b)=>new Date(a.startISO)-new Date(b.startISO)).slice(0,5);
          if(upcoming.length===0) return <div style={{color:C.textMuted,fontSize:13}}>No upcoming inspections.</div>;
          return upcoming.map(ins=><div key={ins.id} style={{...flex(0,"center","space-between"),padding:"10px 0",borderBottom:`1px solid ${C.border}`}}>
            <div><div style={{fontSize:13,fontWeight:600}}>{ins.client}</div><div style={{fontSize:12,color:C.textSub,marginTop:2}}>{ins.address}</div></div>
            <div style={{textAlign:"right"}}><div style={{fontSize:12,color:C.orange,fontWeight:500}}>{formatDateLabel(ins.startISO)} · {formatTimeLabel(ins.startISO)}</div><div style={{fontSize:12,color:C.textMuted}}>{ins.inspector}</div></div>
          </div>);
        })()}
      </div>
    </div>}

    {tab==="Leads"&&<div>
      <div style={{...flex(0,"center","space-between"),marginBottom:14,flexWrap:"wrap",gap:8}}>
        <div style={{...flex(6),flexWrap:"wrap"}}>
          {["all","pending","contacted","scheduled","won","cold"].map(f=><Btn key={f} small variant={leadFilter===f?"primary":"default"} onClick={()=>setLeadFilter(f)}>{f.charAt(0).toUpperCase()+f.slice(1)}</Btn>)}
        </div>
        <div style={flex(6)}>
          {pending.length>0&&<Btn variant="info" small onClick={()=>pending.forEach(l=>smsLead(l))}>SMS All Pending ({pending.length})</Btn>}
          <Btn variant="default" small onClick={()=>exportToCSV(filteredLeads,[roofer],roofer.name+"-leads.csv")}>⬇ CSV</Btn>
          <Btn variant="primary" small onClick={()=>setShowAddLead(true)}>+ Add Lead</Btn>
        </div>
      </div>
      {showAddLead&&<AddLeadModal roofers={[roofer]} defaultRooferId={roofer.id} onClose={()=>setShowAddLead(false)} onAdd={lead=>{onUpdate("add_lead",{lead});setShowAddLead(false);}}/>}
      <TableWrap headers={["Homeowner","Phone","ZIP","Storm","Status","Actions"]} empty={filteredLeads.length===0?"No leads match this filter.":undefined}>
        {filteredLeads.map(l=><LeadRow key={l.id} lead={l} roofers={[roofer]} onSMS={smsLead} onBook={bookLead} onEdit={setEditingLead} onDelete={l=>onUpdate("delete_lead",{leadId:l.id})} onViewConvo={setViewingConvo} onLogRevenue={setLoggingRevenue} showRoofer={false}/>)}
      </TableWrap>
    </div>}

    {tab==="Calendar"&&<div>
      <div style={{...flex(0,"center","space-between"),marginBottom:14,flexWrap:"wrap",gap:8}}>
        <div style={{fontSize:12,color:C.textMuted}}>{roofer.inspectors.length===0?"Add an inspector first to enable scheduling.":`${roofer.inspectors.length} inspector(s) · ${(roofer.scheduleSettings||DEFAULT_SCHEDULE).durationMins}min appointments`}</div>
        <Btn variant="primary" onClick={()=>setBookingModal({})} disabled={roofer.inspectors.length===0}>+ New Appointment</Btn>
      </div>
      {Object.keys(groupedIns).length===0?<div style={{...card({textAlign:"center",padding:40,color:C.textMuted,fontSize:13})}}>No inspections scheduled. Click "+ New Appointment" to add a walk-in customer or book a lead.</div>:Object.entries(groupedIns).sort().map(([date,insps])=><div key={date} style={{marginBottom:16}}>
        <div style={{...T.head(12,600),color:C.orange,marginBottom:8}}>{new Date(date+"T12:00:00").toLocaleDateString(undefined,{weekday:"long",month:"short",day:"numeric"})}</div>
        {insps.map(ins=><div key={ins.id} style={{...card({marginBottom:8,padding:"14px 16px"})}}>
          <div style={{...flex(0,"flex-start","space-between"),gap:12,flexWrap:"wrap"}}>
            <div>
              <div style={{...flex(6,"center")}}>
                <div style={{fontSize:13,fontWeight:600}}>{ins.client}</div>
                <Badge label={ins.source==="manual"?"called in":"from lead"} color={ins.source==="manual"?C.purple:C.blue} small/>
              </div>
              <div style={{fontSize:12,color:C.textSub,marginTop:2}}>{ins.address}{ins.phone?` · ${ins.phone}`:""}</div>
            </div>
            <div style={{display:"flex",flexDirection:"column",alignItems:"flex-end",gap:6,flexShrink:0}}>
              <div style={{fontSize:12,color:C.orange,fontWeight:500}}>{formatTimeLabel(ins.startISO)}–{formatTimeLabel(ins.endISO)} · {ins.inspector}</div>
              <div style={flex(6)}>
                <select value={ins.status} onChange={e=>onUpdate("update_inspection_status",{rooferId:roofer.id,inspectionId:ins.id,status:e.target.value})} style={{background:C.surface,border:`1px solid ${INS_STATUS_COLORS[ins.status]||C.border}`,borderRadius:5,padding:"3px 8px",color:INS_STATUS_COLORS[ins.status]||C.text,fontSize:11,cursor:"pointer"}}>
                  {INSPECTION_STATUSES.map(st=><option key={st} value={st}>{st}</option>)}
                </select>
                {ins.status==="scheduled"&&<Btn small variant="ghost" onClick={()=>setBookingModal({existingInspection:ins})}>↻ Reschedule</Btn>}
                <a href={googleCalendarLink(ins,roofer)} target="_blank" rel="noreferrer"><Btn small variant="ghost">Add to Google Cal</Btn></a>
              </div>
            </div>
          </div>
        </div>)}
      </div>)}
    </div>}

    {tab==="Schedule"&&<ScheduleSettingsPanel roofer={roofer} onSave={settings=>onUpdate("update_schedule_settings",{rooferId:roofer.id,settings})}/>}

    {tab==="Revenue"&&<div style={{display:"flex",flexDirection:"column",gap:16}}>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(140px,1fr))",gap:12}}>
        <StatCard label="Total Revenue" value={`$${roofer.revenue.toLocaleString()}`} color={C.green} icon="$"/>
        <StatCard label="Won Jobs" value={won.length} color={C.purple} icon="✅"/>
        <StatCard label="Avg Job Value" value={roofer.revenueLog?.length?`$${Math.round(roofer.revenueLog.reduce((s,r)=>s+r.amount,0)/roofer.revenueLog.length).toLocaleString()}`:"—"} color={C.orange} icon="📊"/>
      </div>
      {revChart.length>0&&<div style={card()}><div style={{...T.head(13,600),marginBottom:14}}>Revenue by Month</div><MiniBarChart data={revChart}/></div>}
      <div style={card({padding:0,overflow:"hidden"})}>
        <div style={{...flex(0,"center","space-between"),padding:"12px 16px",borderBottom:`1px solid ${C.border}`}}>
          <span style={T.head(13,600)}>Revenue Log</span>
          <Btn small onClick={()=>{const csv="Homeowner,Amount,Date,Note\n"+(roofer.revenueLog||[]).map(r=>`"${r.homeowner}",$${r.amount},"${r.date}","${r.note||""}"`).join("\n");const b=new Blob([csv],{type:"text/csv"}),u=URL.createObjectURL(b),a=document.createElement("a");a.href=u;a.download=roofer.name+"-revenue.csv";a.click();}}>⬇ Export CSV</Btn>
        </div>
        <TableWrap headers={["Homeowner","Amount","Date","Note"]} empty={(!roofer.revenueLog||roofer.revenueLog.length===0)?"No revenue logged yet. Use the Won button on a scheduled lead.":undefined}>
          {(roofer.revenueLog||[]).map(r=><TR key={r.id}>
            <TD bold>{r.homeowner}</TD>
            <TD style={{color:C.green,fontWeight:700}}>${r.amount.toLocaleString()}</TD>
            <TD dim>{r.date}</TD>
            <TD dim>{r.note||"—"}</TD>
          </TR>)}
        </TableWrap>
      </div>
    </div>}

    {tab==="Inspectors"&&<div>
      <div style={{...flex(0,"center","flex-end"),marginBottom:14}}><Btn variant="primary" onClick={()=>setShowAddInspector(true)}>+ Add Inspector</Btn></div>
      <TableWrap headers={["Name","Phone","ZIP Zones"]} empty={roofer.inspectors.length===0?"No inspectors added yet.":undefined}>
        {roofer.inspectors.map(ins=><TR key={ins.id}>
          <TD bold>{ins.name}</TD>
          <TD dim>{ins.phone}</TD>
          <TD><div style={{...flex(6),flexWrap:"wrap"}}>{ins.zones.map(z=><Badge key={z} label={z} color={C.blue} small/>)}</div></TD>
        </TR>)}
      </TableWrap>
    </div>}

    {tab==="Territories"&&<div>
      <div style={{...flex(8),marginBottom:14}}>
        <input value={newZip} onChange={e=>setNewZip(e.target.value)} placeholder="Enter ZIP code..." style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:7,padding:"8px 12px",color:C.text,fontSize:13,outline:"none",width:200}}/>
        <Btn variant="primary" onClick={()=>{if(newZip.trim()){onUpdate("add_territory",{rooferId:roofer.id,zip:newZip.trim()});setNewZip("");}}}>Add ZIP</Btn>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(110px,1fr))",gap:10}}>
        {roofer.territories.map(zip=><div key={zip} style={{...card({display:"flex",alignItems:"center",justifyContent:"space-between",padding:"10px 14px"})}}><span style={{fontSize:13,fontWeight:600}}>{zip}</span><button onClick={()=>onUpdate("remove_territory",{rooferId:roofer.id,zip})} style={{background:"none",border:"none",color:C.red,cursor:"pointer",fontSize:18,lineHeight:1}}>×</button></div>)}
      </div>
    </div>}

    {tab==="Comm Settings"&&<CommSettingsPanel roofer={roofer} onSave={settings=>onUpdate("update_comm_settings",{rooferId:roofer.id,settings})}/>}
    {tab==="AI Agent"&&<AIAgent roofers={[roofer]} leads={myLeads} storms={[]} apiKeys={apiKeys} onUpdate={onUpdate} context={ctx}/>}
  </div>;
}

// ─── QUICK SMS NUMBER ASSIGNMENT ROW (admin only) ────────────────────────────
function QuickAssignRow({roofer,onSave}){
  const[value,setValue]=useState(roofer.twilioFrom||"");
  const[saved,setSaved]=useState(false);
  const dirty=value!==(roofer.twilioFrom||"");
  function handleSave(){
    onSave(value.trim());
    setSaved(true);
    setTimeout(()=>setSaved(false),1800);
  }
  return <div style={{...flex(10,"center","space-between"),padding:"8px 10px",background:C.surface,borderRadius:7,border:`1px solid ${C.border}`}}>
    <div style={{minWidth:0,flex:"0 0 160px"}}>
      <div style={{fontSize:13,fontWeight:600,color:C.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{roofer.name}</div>
      <div style={{fontSize:10,color:C.textMuted}}>{roofer.territories.join(", ")||"no territories"}</div>
    </div>
    <div style={{flex:1,display:"flex",gap:8,alignItems:"center",minWidth:0}}>
      <input value={value} onChange={e=>setValue(e.target.value)} onKeyDown={e=>e.key==="Enter"&&handleSave()} placeholder="+19725550199"
        style={{flex:1,minWidth:0,background:C.card,border:`1px solid ${dirty?C.orange:C.border}`,borderRadius:6,padding:"6px 10px",color:C.text,fontSize:13,outline:"none"}}/>
      <Btn small variant={saved?"success":"primary"} onClick={handleSave} disabled={!dirty&&!saved} style={{flexShrink:0}}>{saved?"✓ Saved":"Assign"}</Btn>
    </div>
  </div>;
}

// ─── COMMAND CENTER ───────────────────────────────────────────────────────────
function CommandCenter({roofers,leads,storms,apiKeys,onUpdate,onSelectRoofer,scanSettings,onScanSettingsChange,activities,addActivity,zipTerritories}){
  const[tab,setTab]=useState("Overview");
  const[showAddRoofer,setShowAddRoofer]=useState(false);
  const[editingRoofer,setEditingRoofer]=useState(null);
  const[editingLead,setEditingLead]=useState(null);
  const[viewingConvo,setViewingConvo]=useState(null);
  const[loggingRevenue,setLoggingRevenue]=useState(null);
  const[scanStatus,setScanStatus]=useState("");
  const[manualZip,setManualZip]=useState("");
  const[statusFilter,setStatusFilter]=useState("all");
  const[rooferFilter,setRooferFilter]=useState("all");
  const[fetchingTwilio,setFetchingTwilio]=useState(false);
  const[showAddLeadAdmin,setShowAddLeadAdmin]=useState(false);

  const totalMRR=roofers.filter(r=>r.status==="active").reduce((a,r)=>a+PLAN_PRICES[r.plan],0);
  const pending=leads.filter(l=>l.status==="pending");

  const runScan=useCallback(async(auto=false)=>{
    if(!auto) setScanStatus("Scanning...");
    if(apiKeys.weather){
      try{
        const zips=[...new Set([...roofers.flatMap(r=>r.territories),...(zipTerritories||[]).map(zt=>zt.zip_code)])];
        let found=0;
        for(const zip of zips.slice(0,5)){
          const data=await fetchWeatherAlerts(apiKeys.weather,zip);
          (data.alerts?.alert||[]).forEach(a=>{
            const desc=(a.headline||"").toLowerCase();
            if(["hail","tornado","wind","thunderstorm","severe"].some(k=>desc.includes(k))){
              onUpdate("add_storm",{storm:{id:"s"+Date.now()+zip,type:"Weather Alert",location:zip,zip,severity:"severe",date:new Date().toISOString().split("T")[0],processed:false,lat:null,lng:null}});
              found++;
            }
          });
        }
        if(found>0) addActivity({type:"storm",message:`Auto-scan found ${found} new storm alert(s)`,badge:`${found} new`,badgeColor:C.red});
        onScanSettingsChange({...scanSettings,lastScan:new Date().toLocaleString()});
        if(!auto) setScanStatus("✓ Scan complete");
      }catch(e){if(!auto) setScanStatus("Error: "+e.message);}
    } else if(!auto) setScanStatus("⚠ WeatherAPI key not configured.");
    if(!auto) setTimeout(()=>setScanStatus(""),3000);
  },[roofers,apiKeys,scanSettings,onUpdate,onScanSettingsChange,addActivity]);

  useEffect(()=>{
    if(scanSettings.interval==="manual") return;
    const ms={daily:86400000,"2h":7200000,"1h":3600000,"30m":1800000}[scanSettings.interval];
    if(!ms) return;
    const id=setInterval(()=>runScan(true),ms);
    return()=>clearInterval(id);
  },[scanSettings.interval,runScan]);

  // Follow-up automation
  useEffect(()=>{
    const check=()=>{
      const now=new Date();
      leads.forEach(lead=>{
        if(lead.status!=="contacted"||lead.followupSent||!lead.contactedAt) return;
        const roofer=roofers.find(r=>r.id===lead.rooferId);
        const comm=roofer?.commSettings||DEFAULT_COMM;
        const days=Math.floor((now-new Date(lead.contactedAt))/86400000);
        if(days>=(comm.followupDays||2)){
          const msg=fillTemplate(comm.templates.followup,{name:lead.homeowner,zip:lead.zip,storm:lead.stormType,company:roofer?.name||"us"});
          if(apiKeys.twilio?.sid) sendTwilioSMS(apiKeys.twilio,lead.phone,msg,roofer?.twilioFrom);
          onUpdate("add_conversation",{leadId:lead.id,entry:{role:"ai",msg,ts:new Date().toLocaleString()}});
          onUpdate("mark_followup_sent",{leadId:lead.id});
          addActivity({type:"followup",message:`Auto follow-up sent to ${lead.homeowner}`,badge:"follow-up",badgeColor:C.yellow});
        }
        if(days>=(comm.coldDays||5)&&lead.status==="contacted"){
          onUpdate("lead_status",{leadId:lead.id,status:"cold"});
          addActivity({type:"system",message:`${lead.homeowner} marked cold — no response after ${comm.coldDays||5} days`});
        }
      });
    };
    const id=setInterval(check,3600000);
    check();
    return()=>clearInterval(id);
  },[leads,roofers,apiKeys]);

  async function fetchTwilioIncoming(){
    if(!apiKeys.twilio?.sid) return;
    setFetchingTwilio(true);
    try{
      const enc=btoa(apiKeys.twilio.sid+":"+apiKeys.twilio.token);
      const res=await fetch(`https://api.twilio.com/2010-04-01/Accounts/${apiKeys.twilio.sid}/Messages.json?PageSize=20&Direction=inbound`,{headers:{"Authorization":"Basic "+enc}});
      const data=await res.json();
      for(const m of (data.messages||[])){
        const cp=m.from.replace(/\D/g,"");
        const lead=leads.find(l=>l.phone.replace(/\D/g,"")===cp);
        if(!lead) continue;
        if(lead.conversations.some(c=>c.ts===m.date_sent&&c.role==="lead")) continue;

        onUpdate("add_conversation",{leadId:lead.id,entry:{role:"lead",msg:m.body,ts:m.date_sent}});
        addActivity({type:"sms",message:`Reply from ${lead.homeowner}: "${m.body.slice(0,60)}"`,badge:"reply",badgeColor:C.green});

        const roofer=roofers.find(r=>r.id===lead.rooferId);
        const comm=roofer?.commSettings||DEFAULT_COMM;
        if(roofer&&comm.aiAutoReply){
          try{
            const history=[...lead.conversations,{role:"lead",msg:m.body,ts:m.date_sent}];
            const result=await generateLeadReply(lead,roofer,history);

            if(result.adultConfirmed!==(lead.adultConfirmed||"unconfirmed")){
              onUpdate("update_adult_confirmed",{leadId:lead.id,status:result.adultConfirmed});
              if(result.adultConfirmed==="confirmed") addActivity({type:"system",message:`${lead.homeowner} confirmed an adult will be present for the inspection`,badge:"verified",badgeColor:C.green});
              if(result.adultConfirmed==="denied") addActivity({type:"system",message:`${lead.homeowner} indicated no adult will be present — booking paused`,badge:"blocked",badgeColor:C.red});
            }

            if(apiKeys.twilio?.sid) await sendTwilioSMS(apiKeys.twilio,lead.phone,result.reply,roofer.twilioFrom);
            onUpdate("add_conversation",{leadId:lead.id,entry:{role:"ai",msg:result.reply,ts:new Date().toLocaleString()}});

            // Only ever auto-book once the adult-presence gate is actually satisfied.
            const requireAdult=comm.requireAdultPresent!==false;
            const gateOk=!requireAdult||result.adultConfirmed==="confirmed";
            if(result.readyToSchedule&&gateOk&&lead.status!=="scheduled"){
              const inspector=roofer.inspectors.find(i=>i.zones.includes(lead.zip))||roofer.inspectors[0];
              const nextSlot=inspector?getNextAvailableSlots(roofer,inspector.id,{limit:1})[0]:null;
              if(inspector&&nextSlot){
                const ins={id:"ins"+Date.now(),client:lead.homeowner,address:(lead.address?`${lead.address}, ${lead.zip}`:lead.zip),phone:lead.phone,startISO:nextSlot.startISO,endISO:nextSlot.endISO,inspectorId:inspector.id,inspector:inspector.name,status:"scheduled",source:"lead",leadId:lead.id};
                onUpdate("book_lead",{leadId:lead.id,rooferId:roofer.id,inspection:ins});
                const bookMsg=fillTemplate(comm.templates.booking,{name:lead.homeowner,date:formatDateLabel(nextSlot.startISO),time:formatTimeLabel(nextSlot.startISO),inspector:inspector.name,company:roofer.name});
                if(apiKeys.twilio?.sid) await sendTwilioSMS(apiKeys.twilio,lead.phone,bookMsg,roofer.twilioFrom);
                onUpdate("add_conversation",{leadId:lead.id,entry:{role:"ai",msg:bookMsg,ts:new Date().toLocaleString()}});
                onUpdate("notify_roofer",{rooferId:roofer.id,notification:{type:"booking",message:`AI booked: ${lead.homeowner} on ${formatDateLabel(nextSlot.startISO)} at ${formatTimeLabel(nextSlot.startISO)} (adult presence confirmed)`,smsText:`SkyShield Pro: AI booked an inspection — ${lead.homeowner} on ${formatDateLabel(nextSlot.startISO)} at ${formatTimeLabel(nextSlot.startISO)}. Adult presence confirmed.`}});
                addActivity({type:"booking",message:`AI auto-booked ${lead.homeowner} — adult presence confirmed`,badge:"auto-booked",badgeColor:C.purple});
              }
            }

            if(result.needsHumanReview){
              onUpdate("update_lead_notes",{leadId:lead.id,notes:((lead.notes||"")+" ⚠ AI flagged this conversation for human review.").trim()});
              addActivity({type:"system",message:`${lead.homeowner}'s conversation flagged for human review`,badge:"review",badgeColor:C.yellow});
            }
          }catch(e){ console.error("AI auto-reply failed:",e); }
        }
      }
    }catch(e){}
    setFetchingTwilio(false);
  }

  const filteredLeads=leads.filter(l=>(statusFilter==="all"||l.status===statusFilter)&&(rooferFilter==="all"||l.rooferId===rooferFilter));

  async function smsLead(lead){
    const roofer=roofers.find(r=>r.id===lead.rooferId);
    const comm=roofer?.commSettings||DEFAULT_COMM;
    if(!isWithinCommWindow(comm)&&!window.confirm("Outside active hours. Send anyway?")) return;
    const msg=fillTemplate(comm.templates.initial,{name:lead.homeowner,zip:lead.zip,storm:lead.stormType,company:roofer?.name||"us"});
    if(apiKeys.twilio?.sid) await sendTwilioSMS(apiKeys.twilio,lead.phone,msg,roofer?.twilioFrom);
    onUpdate("lead_status",{leadId:lead.id,status:"contacted"});
    onUpdate("add_conversation",{leadId:lead.id,entry:{role:"ai",msg,ts:new Date().toLocaleString()}});
    onUpdate("set_contacted_at",{leadId:lead.id,ts:new Date().toISOString().split("T")[0]});
    addActivity({type:"sms",message:`SMS sent to ${lead.homeowner}`,badge:"contacted",badgeColor:C.blue});
    alert(`SMS to ${lead.homeowner}:\n\n${msg}`);
  }
  function bookLead(lead){
    const roofer=roofers.find(r=>r.id===lead.rooferId);
    const inspector=roofer?.inspectors.find(i=>i.zones.includes(lead.zip))||roofer?.inspectors[0];
    if(!roofer||!inspector){ alert("This roofer has no inspectors set up yet — add one before booking."); return; }
    const comm=roofer?.commSettings||DEFAULT_COMM;
    if(comm.requireAdultPresent!==false&&lead.adultConfirmed!=="confirmed"){
      if(!window.confirm(`${lead.homeowner} has not yet confirmed that an adult (18+) will be present during the inspection. Continue booking anyway?`)) return;
    }
    const nextSlot=getNextAvailableSlots(roofer,inspector.id,{limit:1})[0];
    if(!nextSlot){ alert("No available slots found in the next 14 days for "+inspector.name+"."); return; }
    const ins={id:"ins"+Date.now(),client:lead.homeowner,address:(lead.address?`${lead.address}, ${lead.zip}`:lead.zip),phone:lead.phone,startISO:nextSlot.startISO,endISO:nextSlot.endISO,inspectorId:inspector.id,inspector:inspector.name,status:"scheduled",source:"lead",leadId:lead.id};
    onUpdate("book_lead",{leadId:lead.id,rooferId:lead.rooferId,inspection:ins});
    const msg=fillTemplate(comm.templates.booking,{name:lead.homeowner,date:formatDateLabel(nextSlot.startISO),time:formatTimeLabel(nextSlot.startISO),inspector:inspector.name,company:roofer?.name||"us"});
    if(apiKeys.twilio?.sid) sendTwilioSMS(apiKeys.twilio,lead.phone,msg,roofer?.twilioFrom);
    onUpdate("add_conversation",{leadId:lead.id,entry:{role:"ai",msg,ts:new Date().toLocaleString()}});
    addActivity({type:"booking",message:`Inspection booked for ${lead.homeowner} — ${formatDateLabel(nextSlot.startISO)} at ${formatTimeLabel(nextSlot.startISO)}`,badge:"booked",badgeColor:C.green});
    onUpdate("notify_roofer",{rooferId:roofer.id,notification:{type:"booking",message:`New inspection booked: ${lead.homeowner} on ${formatDateLabel(nextSlot.startISO)} at ${formatTimeLabel(nextSlot.startISO)} with ${inspector.name}`,smsText:`SkyShield Pro: New inspection booked — ${lead.homeowner} on ${formatDateLabel(nextSlot.startISO)} at ${formatTimeLabel(nextSlot.startISO)} with ${inspector.name}.`}});
  }
  function sendManualMessage(lead,msg){
    const roofer=roofers.find(r=>r.id===lead.rooferId);
    if(apiKeys.twilio?.sid&&roofer) sendTwilioSMS(apiKeys.twilio,lead.phone,msg,roofer.twilioFrom);
    onUpdate("add_conversation",{leadId:lead.id,entry:{role:"ai",msg,ts:new Date().toLocaleString()}});
  }
  function logRevenue(entry){
    const lead=leads.find(l=>l.id===entry.leadId);
    onUpdate("log_revenue",{rooferId:lead?.rooferId,entry});
    onUpdate("lead_status",{leadId:entry.leadId,status:"won"});
    addActivity({type:"revenue",message:`$${entry.amount.toLocaleString()} logged — ${entry.homeowner}`,badge:`$${entry.amount.toLocaleString()}`,badgeColor:C.green});
  }

  const ctx=`Platform: ${roofers.length} roofers, ${leads.length} leads, ${pending.length} pending, ${storms.length} storms, $${totalMRR.toLocaleString()} MRR.`;

  return <div>
    {showAddRoofer&&<AddRooferModal onClose={()=>setShowAddRoofer(false)} onAdd={r=>{onUpdate("add_roofer",{roofer:r});addActivity({type:"roofer",message:`New roofer: ${r.name}`,badge:r.plan,badgeColor:PLAN_COLORS[r.plan]});}}/>}
    {editingRoofer&&<EditRooferModal roofer={editingRoofer} onClose={()=>setEditingRoofer(null)} onSave={r=>onUpdate("edit_roofer",{roofer:r})}/>}
    {editingLead&&<EditLeadModal lead={editingLead} roofers={roofers} onClose={()=>setEditingLead(null)} onSave={l=>onUpdate("edit_lead",{lead:l})}/>}
    {viewingConvo&&<ConversationModal lead={viewingConvo} roofer={roofers.find(r=>r.id===viewingConvo.rooferId)} onClose={()=>setViewingConvo(null)} onSendMessage={sendManualMessage} onUpdateNotes={(id,notes)=>onUpdate("update_lead_notes",{leadId:id,notes})}/>}
    {loggingRevenue&&<LogRevenueModal lead={loggingRevenue} onClose={()=>setLoggingRevenue(null)} onSave={logRevenue}/>}

    <Tabs tabs={["Overview","Storms","Roofers","All Leads","Conversations","Activity","AI Agent"]} active={tab} onChange={setTab}/>

    {tab==="Overview"&&<div style={{display:"flex",flexDirection:"column",gap:16}}>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(140px,1fr))",gap:12}}>
        <StatCard label="Monthly Revenue" value={`$${totalMRR.toLocaleString()}`} color={C.green} icon="$"/>
        <StatCard label="Active Clients" value={roofers.filter(r=>r.status==="active").length} color={C.orange} icon="◈"/>
        <StatCard label="Total Leads" value={leads.length} color={C.blue} icon="◈"/>
        <StatCard label="Inspections" value={leads.filter(l=>l.status==="scheduled").length} color={C.purple} icon="▦"/>
        <StatCard label="Storms" value={storms.length} color={C.red} icon="⛈"/>
      </div>
      <ScanScheduler scanSettings={scanSettings} onChange={onScanSettingsChange}/>
      <div style={grid("1fr 1fr",16)}>
        <div style={card()}>
          <div style={{...T.head(13,600),marginBottom:14}}>⛈ Recent Storms</div>
          {storms.slice(0,4).map(st=><div key={st.id} style={{...flex(12,"center","space-between"),padding:"9px 0",borderBottom:`1px solid ${C.border}`}}>
            <div><div style={{fontSize:13,fontWeight:500}}>{st.type} — {st.location}</div><div style={{fontSize:11,color:C.textMuted,marginTop:2}}>{st.date} · ZIP {st.zip}</div></div>
            <SeverityBadge severity={st.severity}/>
          </div>)}
          {storms.length===0&&<div style={{color:C.textMuted,fontSize:13}}>No storms detected yet.</div>}
        </div>
        <div style={card()}>
          <div style={{...T.head(13,600),marginBottom:14}}>Roofer Performance</div>
          {roofers.map(r=><div key={r.id} onClick={()=>onSelectRoofer(r)} style={{...flex(12,"center","space-between"),padding:"9px 0",borderBottom:`1px solid ${C.border}`,cursor:"pointer"}} onMouseEnter={e=>e.currentTarget.style.background=C.cardHov} onMouseLeave={e=>e.currentTarget.style.background=""}>
            <div><div style={{fontSize:13,fontWeight:500}}>{r.name}</div><div style={{fontSize:11,color:C.textMuted,marginTop:2}}>{r.leads} leads · {r.booked} booked · ${(r.revenue/1000).toFixed(0)}k</div></div>
            <div style={flex(6)}><Badge label={r.plan} color={PLAN_COLORS[r.plan]} small/><StatusBadge status={r.status}/>{r.status==="trial"&&!trialExpired(r)&&<Badge label={`${trialDaysRemaining(r)}d left`} color={trialDaysRemaining(r)<=5?C.red:C.yellow} small/>}{trialExpired(r)&&<Badge label="Trial Expired" color={C.red} small/>}</div>
          </div>)}
        </div>
      </div>
      <div style={card()}>
        <div style={{...T.head(13,600),marginBottom:14}}>📋 Recent Activity</div>
        <ActivityFeed activities={activities.slice(0,8)}/>
      </div>
      <StormMap storms={storms} roofers={roofers}/>
    </div>}

    {tab==="Storms"&&<div style={{display:"flex",flexDirection:"column",gap:16}}>
      <ScanScheduler scanSettings={scanSettings} onChange={onScanSettingsChange}/>
      <div style={{...flex(0,"center","space-between"),flexWrap:"wrap",gap:8}}>
        <div style={flex(8)}>
          <Btn variant="primary" onClick={()=>runScan(false)}>⚡ Run Scan Now</Btn>
          {scanStatus&&<span style={{fontSize:12,color:C.textSub}}>{scanStatus}</span>}
        </div>
        <div style={flex(8)}>
          <input value={manualZip} onChange={e=>setManualZip(e.target.value)} placeholder="Enter ZIP..." style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:7,padding:"8px 12px",color:C.text,fontSize:13,outline:"none",width:130}}/>
          <Btn variant="info" onClick={()=>{
            if(!manualZip.trim())return;
            const zip=manualZip.trim();
            const eligible=roofers.filter(r=>r.status==="active"&&(r.territories.includes(zip)||(zipTerritories||[]).some(zt=>zt.account_id===r.id&&zt.zip_code===zip)));
            if(eligible.length===0){ alert("No active roofer covers ZIP "+zip); setManualZip(""); return; }
            // Assign to whichever eligible roofer currently has the fewest pending leads in this ZIP (fairness)
            const r=eligible.reduce((least,cur)=>{
              const curPending=leads.filter(l=>l.rooferId===cur.id&&l.zip===zip&&l.status==="pending").length;
              const leastPending=leads.filter(l=>l.rooferId===least.id&&l.zip===zip&&l.status==="pending").length;
              return curPending<leastPending?cur:least;
            },eligible[0]);
            onUpdate("add_lead",{lead:{id:"l"+Date.now(),homeowner:randomDemoName(),phone:randomDemoPhone(),zip,rooferId:r.id,stormType:"Manual",status:"pending",conversations:[],notes:"",contactedAt:null,followupSent:false}});
            addActivity({type:"lead",message:`Manual lead for ${r.name} in ZIP ${zip}`});
            alert("Lead created for "+r.name);
            setManualZip("");
          }}>+ Campaign</Btn>
        </div>
      </div>
      <TableWrap headers={["Type","Location","ZIP","Severity","Date","Status","Action"]}>
        {storms.map(st=><TR key={st.id}>
          <TD bold>{st.type}</TD>
          <TD>{st.location}</TD>
          <TD>{st.zip}</TD>
          <TD><SeverityBadge severity={st.severity}/></TD>
          <TD dim>{st.date}</TD>
          <TD><Badge label={st.processed?"processed":"new"} color={st.processed?C.green:C.orange} small/></TD>
          <TD>{!st.processed&&<Btn small variant="primary" onClick={()=>{
            const eligible=roofers.filter(r=>r.status==="active"&&(r.territories.includes(st.zip)||(zipTerritories||[]).some(zt=>zt.account_id===r.id&&zt.zip_code===st.zip)));
            if(eligible.length===0){ alert("No active roofers cover ZIP "+st.zip+"."); return; }
            const leadCount=Math.max(1,Math.min(eligible.length*3,12)); // demo volume, scales with coverage
            const assignments=distributeLeadsRoundRobin(eligible,leadCount);
            assignments.forEach(a=>onUpdate("add_lead",{lead:{id:"l"+Date.now()+Math.random(),homeowner:a.homeowner,phone:a.phone,zip:st.zip,rooferId:a.rooferId,stormType:st.type,status:"pending",conversations:[],notes:"",contactedAt:null,followupSent:false}}));
            onUpdate("process_storm",{stormId:st.id});
            const perRoofer=eligible.map(r=>`${r.name}: ${assignments.filter(a=>a.rooferId===r.id).length}`).join(", ");
            addActivity({type:"storm",message:`Storm ${st.location} processed — ${assignments.length} lead(s) split across ${eligible.length} roofer(s)`,badge:`${eligible.length} roofers`,badgeColor:C.orange});
            alert(`Processed: ${assignments.length} leads distributed.\n${perRoofer}\n\nEach homeowner was assigned to exactly one roofer — no duplicate outreach.`);
          }}>Process</Btn>}</TD>
        </TR>)}
      </TableWrap>
      <StormMap storms={storms} roofers={roofers}/>
    </div>}

    {tab==="Roofers"&&<div>
      <div style={{...flex(0,"center","flex-end"),marginBottom:14}}><Btn variant="primary" onClick={()=>setShowAddRoofer(true)}>+ Add Roofer</Btn></div>

      <div style={{...card(),marginBottom:20}}>
        <div style={{...flex(0,"center","space-between"),marginBottom:14}}>
          <div style={T.head(13,600)}>📱 SMS Number Assignment <span style={{color:C.textMuted,fontWeight:400}}>(admin only)</span></div>
          <Badge label={`${roofers.filter(r=>r.twilioFrom).length}/${roofers.length} assigned`} color={roofers.every(r=>r.twilioFrom)?C.green:C.yellow} small/>
        </div>
        <div style={{fontSize:12,color:C.textMuted,marginBottom:14,lineHeight:1.6}}>
          Assign each roofer their own dedicated Twilio number from your account. Buy more numbers in your Twilio console under Phone Numbers → Buy a Number — they all share the Account SID/Token set in API Settings.
        </div>
        <div style={{display:"flex",flexDirection:"column",gap:8}}>
          {roofers.map(r=><QuickAssignRow key={r.id} roofer={r} onSave={(num)=>onUpdate("edit_roofer",{roofer:{...r,twilioFrom:num}})}/>)}
        </div>
      </div>

      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(280px,1fr))",gap:16}}>
        {roofers.map(r=><div key={r.id} onClick={()=>onSelectRoofer(r)} style={{...card(),cursor:"pointer",transition:"all 0.15s"}} onMouseEnter={e=>{e.currentTarget.style.background=C.cardHov;e.currentTarget.style.borderColor=C.borderAct;}} onMouseLeave={e=>{e.currentTarget.style.background=C.card;e.currentTarget.style.borderColor=C.border;}}>
          <div style={{...flex(0,"center","space-between"),marginBottom:6}}>
            <div style={T.head(14,600)}>{r.name}</div>
            <div style={flex(5)}>
              <Badge label={r.plan} color={PLAN_COLORS[r.plan]} small/>
              <StatusBadge status={r.status}/>
              {(r.notifications||[]).filter(n=>!n.read).length>0&&<Badge label={`${(r.notifications||[]).filter(n=>!n.read).length}`} color={C.red} small/>}
            </div>
          </div>
          <div style={{fontSize:12,color:C.textMuted,marginBottom:14}}>{r.owner} · {r.email}</div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8,marginBottom:14,padding:"10px 0",borderTop:`1px solid ${C.border}`,borderBottom:`1px solid ${C.border}`}}>
            {[["Leads",r.leads,C.orange],["Booked",r.booked,C.blue],["Rev","$"+(r.revenue/1000).toFixed(0)+"k",C.green],["Pend",leads.filter(l=>l.rooferId===r.id&&l.status==="pending").length,C.textSub]].map(([lbl,val,clr])=><div key={lbl} style={{textAlign:"center"}}><div style={{fontSize:16,fontWeight:700,color:clr,lineHeight:1.2}}>{val}</div><div style={{...T.label,fontSize:9,marginTop:3}}>{lbl}</div></div>)}
          </div>
          <div style={{marginBottom:10}}>
            <div style={{...T.label,marginBottom:6}}>Territories</div>
            <div style={{...flex(5),flexWrap:"wrap"}}>{r.territories.map(z=><Badge key={z} label={z} color={C.blue} small/>)}</div>
          </div>
          <div style={{marginBottom:10,fontSize:11,color:r.twilioFrom?C.textMuted:C.yellow}}>
            📱 {r.twilioFrom?`SMS from ${r.twilioFrom}`:"⚠ No dedicated Twilio number set"}
          </div>
          <div style={{...flex(6,"center","flex-end")}} onClick={e=>e.stopPropagation()}>
            <Btn small onClick={()=>setEditingRoofer(r)}>Edit</Btn>
            <Btn small variant="danger" onClick={()=>{if(window.confirm("Delete "+r.name+"? This also deletes their leads."))onUpdate("delete_roofer",{rooferId:r.id});}}>Delete</Btn>
          </div>
        </div>)}
      </div>
    </div>}

    {tab==="All Leads"&&<div>
      <div style={{...flex(0,"center","space-between"),marginBottom:14,flexWrap:"wrap",gap:8}}>
        <div style={{...flex(6),flexWrap:"wrap"}}>
          <Select value={statusFilter} onChange={setStatusFilter} options={[{value:"all",label:"All Status"},{value:"pending",label:"Pending"},{value:"contacted",label:"Contacted"},{value:"scheduled",label:"Scheduled"},{value:"won",label:"Won"},{value:"cold",label:"Cold"}]} style={{width:150}}/>
          <Select value={rooferFilter} onChange={setRooferFilter} options={[{value:"all",label:"All Roofers"},...roofers.map(r=>({value:r.id,label:r.name}))]} style={{width:170}}/>
        </div>
        <div style={flex(6)}>
          {pending.length>0&&<Btn variant="info" small onClick={async()=>{for(const l of pending)await smsLead(l);}}>SMS All Pending ({pending.length})</Btn>}
          <Btn small onClick={()=>exportToCSV(filteredLeads,roofers,"all-leads.csv")}>⬇ CSV</Btn>
          {apiKeys.twilio?.sid&&<Btn variant="ghost" small onClick={fetchTwilioIncoming} disabled={fetchingTwilio}>{fetchingTwilio?"Fetching...":"⟳ Fetch Replies"}</Btn>}
          <Btn variant="primary" small onClick={()=>setShowAddLeadAdmin(true)}>+ Add Lead</Btn>
        </div>
      </div>
      {showAddLeadAdmin&&<AddLeadModal roofers={roofers} onClose={()=>setShowAddLeadAdmin(false)} onAdd={lead=>{onUpdate("add_lead",{lead});setShowAddLeadAdmin(false);}}/>}
      <TableWrap headers={["Homeowner","Phone","ZIP","Roofer","Storm","Status","Actions"]} empty={filteredLeads.length===0?"No leads match this filter.":undefined}>
        {filteredLeads.map(l=><LeadRow key={l.id} lead={l} roofers={roofers} onSMS={smsLead} onBook={bookLead} onEdit={setEditingLead} onDelete={l=>onUpdate("delete_lead",{leadId:l.id})} onViewConvo={setViewingConvo} onLogRevenue={setLoggingRevenue} showRoofer={true}/>)}
      </TableWrap>
    </div>}

    {tab==="Conversations"&&<div>
      <div style={{...flex(0,"center","space-between"),marginBottom:14}}>
        <span style={{fontSize:13,color:C.textSub}}>All lead conversations. Leads with replies are highlighted green.</span>
        {apiKeys.twilio?.sid&&<Btn variant="info" small onClick={fetchTwilioIncoming} disabled={fetchingTwilio}>{fetchingTwilio?"Fetching...":"⟳ Fetch New Replies"}</Btn>}
      </div>
      <TableWrap headers={["Homeowner","Roofer","Status","Messages","Last Message",""]} empty={leads.filter(l=>l.conversations?.length>0).length===0?"No conversations yet.":undefined}>
        {leads.filter(l=>l.conversations?.length>0).map(lead=>{
          const r=roofers.find(x=>x.id===lead.rooferId),last=lead.conversations[lead.conversations.length-1],hasReply=lead.conversations.some(c=>c.role==="lead");
          return <TR key={lead.id} highlight={hasReply}>
            <TD bold sub={hasReply?"● REPLIED":undefined} style={hasReply?{color:C.green}:{}}>{lead.homeowner}</TD>
            <TD dim>{r?.name||"—"}</TD>
            <TD><StatusBadge status={lead.status}/></TD>
            <TD>{lead.conversations.length}</TD>
            <TD dim style={{maxWidth:180}}><div style={{overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{last?.msg}</div><div style={{fontSize:10,color:C.textMuted,marginTop:2}}>{last?.ts}</div></TD>
            <TD><Btn small variant="info" onClick={()=>setViewingConvo(lead)}>View</Btn></TD>
          </TR>;
        })}
      </TableWrap>
    </div>}

    {tab==="Activity"&&<div style={card()}>
      <div style={{...flex(0,"center","space-between"),marginBottom:14}}>
        <span style={T.head(14,600)}>Activity Feed</span>
        <div style={flex(8)}>
          <Badge label={`${activities.length} events`} color={C.textMuted} small/>
          {activities.length>0&&<Btn small variant="danger" onClick={()=>{if(window.confirm("Clear all activity? This cannot be undone.")) onUpdate("clear_activities",{});}}>Clear All</Btn>}
        </div>
      </div>
      <ActivityFeed activities={activities}/>
    </div>}

    {tab==="AI Agent"&&<AIAgent roofers={roofers} leads={leads} storms={storms} apiKeys={apiKeys} onUpdate={onUpdate} context={ctx}/>}
  </div>;
}

// ─── SUBSCRIPTIONS & BILLING ──────────────────────────────────────────────────
// ─── PRICING EDITOR ──────────────────────────────────────────────────────────
// ─── PERMISSION HELPERS ────────────────────────────────────────────────────
function resolvePermissions(role, overrides={}){
  const base = ROLE_PERMISSIONS[role] || ROLE_PERMISSIONS["Sales Rep"];
  return {...base, ...overrides};
}

function hasPermission(seat, feature){
  if(!seat) return false;
  if(seat.role==="Owner") return true;
  const perms = resolvePermissions(seat.role, seat.permissionOverrides||{});
  return !!perms[feature];
}

// ─── SEATS PANEL ──────────────────────────────────────────────────────────
function SeatsPanel({roofer, seats, onUpdate, apiKeys}){
  const[showInvite,setShowInvite]=useState(false);
  const[inviteEmail,setInviteEmail]=useState("");
  const[inviteRole,setInviteRole]=useState("Sales Rep");
  const[inviting,setInviting]=useState(false);
  const[editingSeat,setEditingSeat]=useState(null);

  const includedSeats = PLAN_SEAT_LIMITS[roofer.plan]||1;
  const maxExtra = 5;
  const totalAllowed = includedSeats + maxExtra;
  const activeSeats = seats.filter(s=>s.status!=="suspended");

  async function sendInvite(){
    if(!inviteEmail.trim()){ alert("Enter an email address."); return; }
    if(activeSeats.length>=totalAllowed){ alert(`Seat limit reached (${totalAllowed} max for ${roofer.plan} + 5 extras). Remove a seat or upgrade.`); return; }
    setInviting(true);
    try{
      const token = "inv_"+Date.now()+"_"+Math.random().toString(36).slice(2);
      // Save invite token to Supabase
      await supabaseUpsert("invite_tokens", getCurrentAccessToken(), {
        token, account_id:roofer.id, email:inviteEmail.trim(), role:inviteRole,
        expires_at: new Date(Date.now()+7*24*60*60*1000).toISOString(), used:false,
      });
      const newSeat = {
        id:"seat_"+Date.now(), account_id:roofer.id,
        email:inviteEmail.trim(), name:"", role:inviteRole, status:"invited",
        permission_overrides:{},
      };
      await supabaseUpsert("seats", getCurrentAccessToken(), newSeat);
      onUpdate("add_seat",{rooferId:roofer.id, seat:newSeat});
      alert(`Invite sent to ${inviteEmail}. They'll receive a link to set up their account (valid 7 days).`);
      setInviteEmail(""); setInviteRole("Sales Rep"); setShowInvite(false);
    }catch(e){ alert("Failed to send invite: "+e.message); }
    setInviting(false);
  }

  async function removeSeat(seat){
    if(seat.role==="Owner"){ alert("Cannot remove the account Owner."); return; }
    if(!window.confirm(`Remove ${seat.email} from this account?`)) return;
    await supabaseDelete("seats", getCurrentAccessToken(), "id", seat.id);
    onUpdate("remove_seat",{rooferId:roofer.id, seatId:seat.id});
  }

  async function toggleSuspend(seat){
    const newStatus = seat.status==="suspended"?"active":"suspended";
    await supabaseUpsert("seats", getCurrentAccessToken(), {id:seat.id, status:newStatus, account_id:roofer.id});
    onUpdate("update_seat",{rooferId:roofer.id, seat:{...seat,status:newStatus}});
  }

  async function savePermissionOverrides(seat, overrides){
    await supabaseUpsert("seats", getCurrentAccessToken(), {id:seat.id, account_id:roofer.id, permission_overrides:overrides});
    onUpdate("update_seat",{rooferId:roofer.id, seat:{...seat,permissionOverrides:overrides}});
    setEditingSeat(null);
  }

  const roleColor = r=>r==="Owner"?C.orange:r==="Office Manager"?C.blue:r==="Sales Rep"?C.green:C.purple;

  return(
    <div style={{display:"flex",flexDirection:"column",gap:16}}>
      {/* Header */}
      <div style={{...card(),display:"flex",alignItems:"center",justifyContent:"space-between"}}>
        <div>
          <div style={T.head(14,600)}>Team Seats</div>
          <div style={{fontSize:12,color:C.textSub,marginTop:3}}>
            {activeSeats.length} of {totalAllowed} seats used · {includedSeats} included in {roofer.plan} plan · up to {maxExtra} additional at $50/mo each
          </div>
        </div>
        <Btn variant="primary" onClick={()=>setShowInvite(true)}>+ Invite Member</Btn>
      </div>

      {/* Invite modal */}
      {showInvite&&<Modal title="Invite Team Member" onClose={()=>setShowInvite(false)}>
        <div style={{display:"flex",flexDirection:"column",gap:12}}>
          <Input label="Email Address" value={inviteEmail} onChange={setInviteEmail} placeholder="team@yourcompany.com"/>
          <Select label="Role" value={inviteRole} onChange={setInviteRole} options={SEAT_ROLES.filter(r=>r!=="Owner")}/>
          <div style={{background:C.surface,borderRadius:8,padding:12,border:`1px solid ${C.border}`}}>
            <div style={{fontSize:11,fontWeight:600,color:C.textSub,marginBottom:8}}>DEFAULT PERMISSIONS FOR {inviteRole.toUpperCase()}</div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6}}>
              {Object.entries(PERMISSION_LABELS).map(([k,label])=>{
                const has = ROLE_PERMISSIONS[inviteRole]?.[k];
                return(
                  <div key={k} style={{display:"flex",alignItems:"center",gap:6,fontSize:11,color:has?C.text:C.textMuted}}>
                    <span style={{color:has?C.green:C.border,fontSize:10}}>{has?"✓":"✗"}</span>{label}
                  </div>
                );
              })}
            </div>
          </div>
          <div style={{...flex(8,"center","flex-end"),marginTop:4}}>
            <Btn onClick={()=>setShowInvite(false)}>Cancel</Btn>
            <Btn variant="primary" onClick={sendInvite} disabled={inviting}>{inviting?"Sending...":"Send Invite"}</Btn>
          </div>
        </div>
      </Modal>}

      {/* Permission edit modal */}
      {editingSeat&&<PermissionEditModal
        seat={editingSeat}
        onSave={overrides=>savePermissionOverrides(editingSeat,overrides)}
        onClose={()=>setEditingSeat(null)}
      />}

      {/* Seat list */}
      <div style={card({padding:0,overflow:"hidden"})}>
        <table style={{width:"100%",borderCollapse:"collapse"}}>
          <thead><tr style={{background:C.surface}}>
            {["Member","Role","Status","Permissions","Actions"].map(h=>(
              <th key={h} style={{padding:"10px 16px",textAlign:"left",fontSize:10,fontWeight:600,
                color:C.textSub,textTransform:"uppercase",letterSpacing:"0.07em",
                borderBottom:`1px solid ${C.border}`}}>{h}</th>
            ))}
          </tr></thead>
          <tbody>
            {seats.length===0&&<tr><td colSpan={5} style={{padding:24,textAlign:"center",color:C.textMuted,fontSize:13}}>No team members yet. Invite someone to get started.</td></tr>}
            {seats.map((seat,i)=>(
              <tr key={seat.id} style={{borderBottom:i<seats.length-1?`1px solid ${C.border}`:"none"}}>
                <td style={{padding:"12px 16px"}}>
                  <div style={{fontSize:13,fontWeight:600,color:C.text}}>{seat.name||seat.email}</div>
                  {seat.name&&<div style={{fontSize:11,color:C.textSub,marginTop:1}}>{seat.email}</div>}
                </td>
                <td style={{padding:"12px 16px"}}>
                  <Badge label={seat.role} color={roleColor(seat.role)} small/>
                </td>
                <td style={{padding:"12px 16px"}}>
                  <Badge label={seat.status}
                    color={seat.status==="active"?C.green:seat.status==="invited"?C.yellow:C.red} small/>
                </td>
                <td style={{padding:"12px 16px"}}>
                  {seat.role!=="Owner"&&<Btn small onClick={()=>setEditingSeat(seat)}>Edit Perms</Btn>}
                  {seat.role==="Owner"&&<span style={{fontSize:11,color:C.textMuted}}>Full access</span>}
                </td>
                <td style={{padding:"12px 16px"}}>
                  <div style={flex(6)}>
                    {seat.role!=="Owner"&&<>
                      <Btn small variant={seat.status==="suspended"?"success":"warning"}
                        onClick={()=>toggleSuspend(seat)}>
                        {seat.status==="suspended"?"Restore":"Suspend"}
                      </Btn>
                      <Btn small variant="danger" onClick={()=>removeSeat(seat)}>Remove</Btn>
                    </>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Role legend */}
      <div style={card()}>
        <div style={{fontSize:12,fontWeight:600,color:C.textSub,marginBottom:12}}>ROLE PERMISSION MATRIX</div>
        <div style={{overflowX:"auto"}}>
          <table style={{width:"100%",borderCollapse:"collapse",fontSize:11}}>
            <thead><tr style={{background:C.surface}}>
              <th style={{padding:"8px 12px",textAlign:"left",color:C.textSub,borderBottom:`1px solid ${C.border}`,whiteSpace:"nowrap"}}>Permission</th>
              {SEAT_ROLES.map(r=>(
                <th key={r} style={{padding:"8px 12px",textAlign:"center",color:roleColor(r),
                  borderBottom:`1px solid ${C.border}`,whiteSpace:"nowrap"}}>{r}</th>
              ))}
            </tr></thead>
            <tbody>{Object.entries(PERMISSION_LABELS).map(([k,label],i,arr)=>(
              <tr key={k} style={{borderBottom:i<arr.length-1?`1px solid ${C.border}`:"none"}}>
                <td style={{padding:"7px 12px",color:C.text}}>{label}</td>
                {SEAT_ROLES.map(r=>(
                  <td key={r} style={{padding:"7px 12px",textAlign:"center"}}>
                    <span style={{color:ROLE_PERMISSIONS[r]?.[k]?C.green:C.border,fontSize:13}}>
                      {ROLE_PERMISSIONS[r]?.[k]?"✓":"✗"}
                    </span>
                  </td>
                ))}
              </tr>
            ))}</tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function PermissionEditModal({seat, onSave, onClose}){
  const base = ROLE_PERMISSIONS[seat.role]||{};
  const[overrides,setOverrides]=useState(seat.permissionOverrides||{});

  function effective(k){ return overrides.hasOwnProperty(k)?overrides[k]:base[k]; }
  function toggle(k){ setOverrides(p=>({...p,[k]:!effective(k)})); }
  function reset(k){ setOverrides(p=>{const n={...p};delete n[k];return n;}); }

  return(
    <Modal title={`Edit Permissions — ${seat.name||seat.email}`} onClose={onClose}>
      <div style={{fontSize:12,color:C.textSub,marginBottom:14}}>
        Base role: <strong style={{color:C.text}}>{seat.role}</strong>. Toggling overrides the default. Click the reset icon to restore the default.
      </div>
      <div style={{display:"flex",flexDirection:"column",gap:8,marginBottom:16}}>
        {Object.entries(PERMISSION_LABELS).map(([k,label])=>{
          const isOverridden = overrides.hasOwnProperty(k);
          const val = effective(k);
          return(
            <div key={k} style={{display:"flex",alignItems:"center",gap:10,padding:"8px 12px",
              background:isOverridden?`${C.orange}08`:C.surface,
              border:`1px solid ${isOverridden?C.orange+"33":C.border}`,borderRadius:7}}>
              <button onClick={()=>toggle(k)} style={{
                width:36,height:20,borderRadius:10,border:"none",cursor:"pointer",
                background:val?C.green:C.border,position:"relative",flexShrink:0,
              }}>
                <div style={{width:16,height:16,borderRadius:"50%",background:"#fff",
                  position:"absolute",top:2,left:val?18:2,transition:"left 0.15s"}}/>
              </button>
              <div style={{flex:1,fontSize:12,color:val?C.text:C.textMuted}}>{label}</div>
              {isOverridden&&<button onClick={()=>reset(k)} style={{fontSize:10,color:C.textMuted,
                background:"none",border:"none",cursor:"pointer"}} title="Reset to role default">↺ reset</button>}
              {isOverridden&&<Badge label="override" color={C.orange} small/>}
            </div>
          );
        })}
      </div>
      <div style={{...flex(8,"center","flex-end")}}>
        <Btn onClick={onClose}>Cancel</Btn>
        <Btn variant="primary" onClick={()=>onSave(overrides)}>Save Permissions</Btn>
      </div>
    </Modal>
  );
}

// ─── ZIP TERRITORY PANEL ──────────────────────────────────────────────────
function ZipTerritoryPanel({roofer, zipTerritories, allZipData, onUpdate}){
  const[search,setSearch]=useState("");
  const[view,setView]=useState("list"); // list | map
  const[adding,setAdding]=useState(null); // zip being added/purchased
  const[confirmZip,setConfirmZip]=useState(null);

  const myZips = zipTerritories.filter(z=>z.account_id===roofer.id);
  const zipLimit = roofer.zipLimit||PLAN_ZIP_LIMITS[roofer.plan]||10;
  const usedZips = myZips.length;

  // Compute availability for each zip
  function zipStatus(zip){
    const entries = allZipData.filter(z=>z.zip_code===zip);
    const exclusive = entries.find(z=>z.is_exclusive);
    if(exclusive) return exclusive.account_id===roofer.id?"mine-exclusive":"locked";
    const count = entries.length;
    const mine = entries.find(z=>z.account_id===roofer.id);
    if(mine) return "mine";
    if(count>=3) return "full";
    if(count===2) return "limited";
    return "open";
  }

  const statusColor = s=>{
    if(s==="mine"||s==="mine-exclusive") return C.green;
    if(s==="open") return C.teal||"#2dd4bf";
    if(s==="limited") return C.yellow;
    if(s==="full") return C.red;
    if(s==="locked") return C.textMuted;
    return C.border;
  };
  const statusLabel = s=>{
    if(s==="mine") return "Yours";
    if(s==="mine-exclusive") return "Yours (Exclusive)";
    if(s==="open") return "Open";
    if(s==="limited") return "Limited";
    if(s==="full") return "Full";
    if(s==="locked") return "Locked";
    return s;
  };

  // Get unique ZIPs in the system
  const allKnownZips = [...new Set([
    ...allZipData.map(z=>z.zip_code),
    ...myZips.map(z=>z.zip_code),
  ])].sort();

  const filteredZips = allKnownZips.filter(z=>z.includes(search.trim()));

  async function claimZip(zip, isExclusive=false){
    const status = zipStatus(zip);
    if(status==="locked"){ alert("This ZIP is exclusively locked by another account."); return; }
    if(status==="full"&&!isExclusive){ alert("This ZIP is full (3/3 slots taken)."); return; }
    if(status==="mine"||status==="mine-exclusive"){ alert("You already own this ZIP."); return; }

    if(usedZips>=zipLimit&&!isExclusive){
      alert(`You've used all ${zipLimit} ZIP slots on your ${roofer.plan} plan. Purchase a zip bundle or upgrade your plan.`);
      return;
    }

    const cost = isExclusive ? 1000 : 0;
    const msg = isExclusive
      ? `Add exclusive Metro Zone Lock on ZIP ${zip} for $1,000/mo? This removes all other roofers from this ZIP.`
      : `Add ZIP ${zip} to your territory?`;

    if(!window.confirm(msg)) return;

    try{
      const newZip = {
        id:"zip_"+Date.now(),
        zip_code:zip,
        account_id:roofer.id,
        is_exclusive:isExclusive,
        monthly_cost:cost,
      };
      await supabaseUpsert("zip_territories", getCurrentAccessToken(), newZip);
      // Init round-robin entry
      await supabaseUpsert("lead_round_robin", getCurrentAccessToken(), {
        zip_code:zip, account_id:roofer.id,
        last_served_at:new Date(0).toISOString(),
      });
      onUpdate("add_zip_territory",{rooferId:roofer.id, zipEntry:newZip});
      alert(`ZIP ${zip} added to your territory!`);
    }catch(e){
      alert("Failed to claim ZIP: "+e.message);
    }
  }

  async function removeZip(zip){
    if(!window.confirm(`Remove ZIP ${zip} from your territory?`)) return;
    try{
      await supabaseDelete("zip_territories", getCurrentAccessToken(), "zip_code", zip);
      onUpdate("remove_zip_territory",{rooferId:roofer.id, zip});
    }catch(e){
      alert("Failed to remove ZIP: "+e.message);
    }
  }

  return(
    <div style={{display:"flex",flexDirection:"column",gap:16}}>
      {/* Header */}
      <div style={card({display:"flex",alignItems:"center",justifyContent:"space-between"})}>
        <div>
          <div style={T.head(14,600)}>ZIP Territory Management</div>
          <div style={{fontSize:12,color:C.textSub,marginTop:3}}>
            {usedZips} / {zipLimit} ZIPs used · {roofer.plan} plan includes {PLAN_ZIP_LIMITS[roofer.plan]} ZIPs
          </div>
        </div>
        <div style={flex(8)}>
          <div style={{...flex(4),background:C.surface,border:`1px solid ${C.border}`,
            borderRadius:8,overflow:"hidden"}}>
            {["list","map"].map(v=>(
              <button key={v} onClick={()=>setView(v)} style={{
                padding:"6px 16px",fontSize:12,fontWeight:600,
                background:view===v?C.orange:"transparent",
                color:view===v?"#000":C.textSub,
                border:"none",cursor:"pointer",textTransform:"capitalize",
              }}>{v}</button>
            ))}
          </div>
        </div>
      </div>

      {/* ZIP usage bar */}
      <div style={card()}>
        <div style={{...flex(0,"center","space-between"),marginBottom:8}}>
          <span style={{fontSize:12,fontWeight:600,color:C.text}}>ZIP Allowance</span>
          <span style={{fontSize:12,color:C.textSub}}>{usedZips}/{zipLimit}</span>
        </div>
        <div style={{height:6,background:C.border,borderRadius:3,overflow:"hidden"}}>
          <div style={{height:"100%",width:`${Math.min(100,(usedZips/zipLimit)*100)}%`,
            background:usedZips>=zipLimit?C.red:`linear-gradient(90deg,${C.orange},${C.blue})`,
            borderRadius:3,transition:"width 0.3s"}}/>
        </div>
        {usedZips>=zipLimit&&<div style={{fontSize:11,color:C.red,marginTop:6}}>
          ZIP limit reached. Purchase a bundle below or upgrade your plan.
        </div>}
      </div>

      {/* Search + list/map */}
      <div style={card()}>
        <div style={{marginBottom:12}}>
          <input value={search} onChange={e=>setSearch(e.target.value)}
            placeholder="Search ZIP codes..."
            style={{width:"100%",background:C.surface,border:`1px solid ${C.border}`,
              borderRadius:8,padding:"8px 12px",color:C.text,fontSize:13,outline:"none"}}/>
        </div>

        {view==="list"&&<div style={{display:"flex",flexDirection:"column",gap:6,maxHeight:320,overflowY:"auto"}}>
          {/* My ZIPs first */}
          {myZips.filter(z=>z.zip_code.includes(search)).map(z=>(
            <div key={z.zip_code} style={{display:"flex",alignItems:"center",gap:10,
              padding:"9px 12px",background:C.surface,borderRadius:8,
              border:`1px solid ${C.green}33`}}>
              <div style={{width:8,height:8,borderRadius:"50%",background:C.green,flexShrink:0}}/>
              <div style={{flex:1}}>
                <span style={{fontSize:13,fontWeight:600,color:C.text}}>{z.zip_code}</span>
                {z.is_exclusive&&<Badge label="Exclusive" color={C.orange} small/>}
              </div>
              <Badge label="Yours" color={C.green} small/>
              <Btn small variant="danger" onClick={()=>removeZip(z.zip_code)}>Remove</Btn>
            </div>
          ))}
          {/* Other available ZIPs */}
          {filteredZips.filter(z=>!myZips.some(m=>m.zip_code===z)).map(zip=>{
            const st = zipStatus(zip);
            const entries = allZipData.filter(z2=>z2.zip_code===zip);
            return(
              <div key={zip} style={{display:"flex",alignItems:"center",gap:10,
                padding:"9px 12px",background:C.surface,borderRadius:8,
                border:`1px solid ${C.border}`,opacity:st==="locked"||st==="full"?0.5:1}}>
                <div style={{width:8,height:8,borderRadius:"50%",background:statusColor(st),flexShrink:0}}/>
                <div style={{flex:1}}>
                  <span style={{fontSize:13,fontWeight:500,color:C.text}}>{zip}</span>
                  <span style={{fontSize:10,color:C.textSub,marginLeft:8}}>
                    {st!=="locked"&&st!=="mine"&&`${entries.length}/3 slots taken`}
                  </span>
                </div>
                <Badge label={statusLabel(st)} color={statusColor(st)} small/>
                {st==="open"||st==="limited"?<>
                  <Btn small variant="success" onClick={()=>claimZip(zip)}>Claim</Btn>
                  <Btn small variant="warning" onClick={()=>claimZip(zip,true)}>Lock $1k/mo</Btn>
                </>:
                st==="locked"?<span style={{fontSize:10,color:C.textMuted}}>🔒 Locked</span>:null}
              </div>
            );
          })}
          {filteredZips.length===0&&myZips.filter(z=>z.zip_code.includes(search)).length===0&&
            <div style={{textAlign:"center",color:C.textMuted,fontSize:13,padding:16}}>
              No ZIPs found. Enter a ZIP code above to search or claim a new one.
            </div>
          }
          {/* Add any ZIP manually */}
          {search.length>=5&&!allKnownZips.includes(search)&&(
            <div style={{display:"flex",alignItems:"center",gap:10,
              padding:"9px 12px",background:`${C.orange}08`,borderRadius:8,
              border:`1px solid ${C.orange}33`}}>
              <div style={{width:8,height:8,borderRadius:"50%",background:C.orange,flexShrink:0}}/>
              <div style={{flex:1,fontSize:13,color:C.text}}>New ZIP: {search}</div>
              <Badge label="Open" color={C.green} small/>
              <Btn small variant="success" onClick={()=>claimZip(search)}>Claim</Btn>
              <Btn small variant="warning" onClick={()=>claimZip(search,true)}>Lock $1k/mo</Btn>
            </div>
          )}
        </div>}

        {view==="map"&&<ZipMapView myZips={myZips} allZipData={allZipData} onClaim={claimZip}/>}
      </div>

      {/* Add-ons */}
      <div style={card()}>
        <div style={{...T.head(13,600),marginBottom:12}}>ZIP Expansion Add-ons</div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
          {ZIP_ADDONS.filter(a=>a.id!=="seat").map(addon=>(
            <div key={addon.id} style={{background:C.surface,border:`1px solid ${C.border}`,
              borderRadius:10,padding:14,position:"relative"}}>
              {addon.savings&&<div style={{position:"absolute",top:-8,right:12,
                background:C.green,color:"#000",fontSize:9,fontWeight:700,
                padding:"2px 8px",borderRadius:10}}>{addon.savings}</div>}
              <div style={{fontSize:13,fontWeight:600,color:C.text,marginBottom:4}}>{addon.label}</div>
              <div style={{display:"flex",alignItems:"baseline",gap:4,marginBottom:4}}>
                <span style={{fontSize:20,fontWeight:700,color:C.orange}}>${addon.price}</span>
                <span style={{fontSize:11,color:C.textSub}}>/mo</span>
                {addon.original&&<span style={{fontSize:11,color:C.red,textDecoration:"line-through",marginLeft:4}}>${addon.original}/mo</span>}
              </div>
              <div style={{fontSize:11,color:C.textSub,marginBottom:10}}>{addon.desc}</div>
              <Btn small variant="primary" onClick={()=>alert("Routes to Stripe checkout — wire up your Stripe price ID for "+addon.id)}>
                Add {addon.label}
              </Btn>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// Simple grid-based map view for ZIPs
function ZipMapView({myZips, allZipData, onClaim}){
  const statusColor=s=>s==="mine"||s==="mine-exclusive"?C.green:s==="open"?"#2dd4bf":s==="limited"?C.yellow:s==="full"?C.red:C.textMuted;

  const allZips=[...new Set([...myZips.map(z=>z.zip_code),...allZipData.map(z=>z.zip_code)])].sort();

  return(
    <div>
      <div style={{fontSize:11,color:C.textSub,marginBottom:10}}>
        Interactive map placeholder — integrate with Google Maps or Mapbox by adding your API key. Below shows your current ZIPs as a visual grid.
      </div>
      <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
        {allZips.map(zip=>{
          const myEntry=myZips.find(z=>z.zip_code===zip);
          const count=allZipData.filter(z=>z.zip_code===zip).length;
          const exclusive=allZipData.find(z=>z.zip_code===zip&&z.is_exclusive);
          const st=myEntry?(myEntry.is_exclusive?"mine-exclusive":"mine"):exclusive?"locked":count>=3?"full":count===2?"limited":"open";
          return(
            <div key={zip} onClick={()=>(!myEntry&&st!=="locked"&&st!=="full")&&onClaim(zip)}
              title={`ZIP ${zip} — ${st} · ${count}/3 slots`}
              style={{
                width:56,height:44,borderRadius:7,display:"flex",flexDirection:"column",
                alignItems:"center",justifyContent:"center",cursor:!myEntry&&st!=="locked"&&st!=="full"?"pointer":"default",
                background:`${statusColor(st)}18`,border:`1px solid ${statusColor(st)}44`,
                transition:"transform 0.1s",
              }}
              onMouseEnter={e=>{if(!myEntry)e.currentTarget.style.transform="scale(1.05)";}}
              onMouseLeave={e=>e.currentTarget.style.transform="scale(1)"}>
              <div style={{fontSize:10,fontWeight:700,color:statusColor(st)}}>{zip}</div>
              {st==="locked"&&<div style={{fontSize:8,color:C.textMuted}}>🔒</div>}
              {(st==="mine"||st==="mine-exclusive")&&<div style={{fontSize:8,color:C.green}}>✓</div>}
              {st!=="mine"&&st!=="mine-exclusive"&&st!=="locked"&&<div style={{fontSize:8,color:statusColor(st)}}>{count}/3</div>}
            </div>
          );
        })}
      </div>
      <div style={{display:"flex",gap:14,marginTop:12,flexWrap:"wrap"}}>
        {[{c:"#2dd4bf",l:"Open"},{c:C.yellow,l:"Limited (2/3)"},{c:C.red,l:"Full"},{c:C.green,l:"Yours"},{c:C.textMuted,l:"Locked"}].map(item=>(
          <div key={item.l} style={{display:"flex",alignItems:"center",gap:5,fontSize:11,color:C.textSub}}>
            <div style={{width:8,height:8,borderRadius:2,background:item.c}}/>
            {item.l}
          </div>
        ))}
      </div>
    </div>
  );
}

function PricingEditor({pricing,setPricing,roofers}){
  const[editingPlan,setEditingPlan]=useState(null); // plan name being edited
  const[showAdd,setShowAdd]=useState(false);
  const[newPlan,setNewPlan]=useState({name:"",price:"",features:[""]});
  const planColors=[C.blue,C.orange,C.purple,C.green,C.yellow];
  const planKeys=Object.keys(pricing);

  function colorFor(plan){
    const i=planKeys.indexOf(plan);
    return planColors[i%planColors.length];
  }

  function saveEdit(plan,data){
    setPricing(p=>({...p,[plan]:data}));
    setEditingPlan(null);
  }

  function deletePlan(plan){
    if(roofers.some(r=>r.plan===plan)){
      alert(`Cannot delete "${plan}" — ${roofers.filter(r=>r.plan===plan).length} client(s) are on this plan. Move them first.`);
      return;
    }
    if(!window.confirm(`Delete the "${plan}" plan?`)) return;
    setPricing(p=>{const n={...p};delete n[plan];return n;});
  }

  function addPlan(){
    const name=newPlan.name.trim();
    if(!name){ alert("Plan name required."); return; }
    if(pricing[name]){ alert("A plan with that name already exists."); return; }
    const price=Number(newPlan.price);
    if(!price||price<0){ alert("Enter a valid price."); return; }
    const features=newPlan.features.map(f=>f.trim()).filter(Boolean);
    setPricing(p=>({...p,[name]:{price,features}}));
    setNewPlan({name:"",price:"",features:[""]});
    setShowAdd(false);
  }

  return(
    <div style={{display:"flex",flexDirection:"column",gap:16}}>
      <div style={{...flex(0,"center","flex-end")}}>
        <Btn variant="primary" onClick={()=>setShowAdd(true)}>+ Add Plan</Btn>
      </div>

      {/* Add plan modal */}
      {showAdd&&<Modal title="Add New Plan" onClose={()=>setShowAdd(false)}>
        <div style={{display:"flex",flexDirection:"column",gap:12}}>
          <Input label="Plan Name" value={newPlan.name} onChange={v=>setNewPlan(p=>({...p,name:v}))} placeholder="e.g. Enterprise"/>
          <Input label="Monthly Price ($)" value={newPlan.price} onChange={v=>setNewPlan(p=>({...p,price:v}))} type="number" placeholder="997"/>
          <div>
            <div style={{fontSize:12,fontWeight:600,color:C.textSub,marginBottom:8}}>Features</div>
            <div style={{display:"flex",flexDirection:"column",gap:6}}>
              {newPlan.features.map((f,i)=>(
                <div key={i} style={flex(8)}>
                  <input value={f}
                    onChange={e=>setNewPlan(p=>({...p,features:p.features.map((x,j)=>j===i?e.target.value:x)}))}
                    placeholder={`Feature ${i+1}`}
                    style={{flex:1,background:C.surface,border:`1px solid ${C.border}`,borderRadius:6,padding:"6px 10px",color:C.text,fontSize:13}}/>
                  {newPlan.features.length>1&&<Btn small variant="danger" onClick={()=>setNewPlan(p=>({...p,features:p.features.filter((_,j)=>j!==i)}))}>✕</Btn>}
                </div>
              ))}
              <Btn small onClick={()=>setNewPlan(p=>({...p,features:[...p.features,""]}))}>+ Add Feature</Btn>
            </div>
          </div>
          <div style={{...flex(8,"center","flex-end"),marginTop:4}}>
            <Btn onClick={()=>setShowAdd(false)}>Cancel</Btn>
            <Btn variant="primary" onClick={addPlan}>Add Plan</Btn>
          </div>
        </div>
      </Modal>}

      {/* Edit plan modal */}
      {editingPlan&&<EditPlanModal
        plan={editingPlan}
        data={pricing[editingPlan]}
        color={colorFor(editingPlan)}
        onSave={data=>saveEdit(editingPlan,data)}
        onClose={()=>setEditingPlan(null)}
      />}

      {/* Plan cards */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(240px,1fr))",gap:16}}>
        {planKeys.map((plan,pi)=>{
          const data=pricing[plan];
          const color=planColors[pi%planColors.length];
          const activeCount=roofers.filter(r=>r.plan===plan&&r.status==="active").length;
          return(
            <div key={plan} style={card({position:"relative",border:`1px solid ${color}33`})}>
              {/* Actions */}
              <div style={{position:"absolute",top:10,right:10,display:"flex",gap:5}}>
                <Btn small variant="default" onClick={()=>setEditingPlan(plan)}>Edit</Btn>
                <Btn small variant="danger" onClick={()=>deletePlan(plan)}>✕</Btn>
              </div>
              <div style={{...T.head(16,700),color,marginBottom:6,paddingRight:100}}>{plan}</div>
              <div style={{display:"flex",alignItems:"baseline",gap:3,marginBottom:14}}>
                <span style={{fontSize:13,color:C.textMuted}}>$</span>
                <span style={{fontSize:34,fontWeight:700,color,lineHeight:1}}>{data.price.toLocaleString()}</span>
                <span style={{fontSize:12,color:C.textMuted}}>/mo</span>
              </div>
              <div style={{display:"flex",flexDirection:"column",gap:7,marginBottom:14}}>
                {data.features.map((f,i)=>(
                  <div key={i} style={flex(8)}>
                    <span style={{color,fontSize:12,flexShrink:0}}>✓</span>
                    <span style={{fontSize:12,color:C.textSub}}>{f}</span>
                  </div>
                ))}
              </div>
              <div style={{padding:"7px 11px",background:`${color}12`,borderRadius:6,
                fontSize:12,color:C.textMuted,border:`1px solid ${color}22`}}>
                {activeCount} active · ${(data.price*activeCount).toLocaleString()}/mo revenue
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function EditPlanModal({plan,data,color,onSave,onClose}){
  const[price,setPrice]=useState(String(data.price));
  const[features,setFeatures]=useState([...data.features]);

  function save(){
    const p=Number(price);
    if(!p||p<0){ alert("Enter a valid price."); return; }
    const f=features.map(x=>x.trim()).filter(Boolean);
    if(!f.length){ alert("Add at least one feature."); return; }
    onSave({price:p,features:f});
  }

  return(
    <Modal title={`Edit Plan — ${plan}`} onClose={onClose}>
      <div style={{display:"flex",flexDirection:"column",gap:12}}>
        <div style={{display:"flex",alignItems:"baseline",gap:6}}>
          <span style={{fontSize:13,color:C.textMuted}}>$</span>
          <input type="number" value={price} onChange={e=>setPrice(e.target.value)}
            style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:7,
              padding:"8px 12px",color,fontSize:24,fontWeight:700,width:120,outline:"none"}}/>
          <span style={{fontSize:13,color:C.textMuted}}>/mo</span>
        </div>
        <div>
          <div style={{fontSize:12,fontWeight:600,color:C.textSub,marginBottom:8}}>Features</div>
          <div style={{display:"flex",flexDirection:"column",gap:6}}>
            {features.map((f,i)=>(
              <div key={i} style={flex(8)}>
                <input value={f} onChange={e=>setFeatures(fs=>fs.map((x,j)=>j===i?e.target.value:x))}
                  style={{flex:1,background:C.surface,border:`1px solid ${C.border}`,
                    borderRadius:6,padding:"6px 10px",color:C.text,fontSize:13}}/>
                {features.length>1&&<Btn small variant="danger" onClick={()=>setFeatures(fs=>fs.filter((_,j)=>j!==i))}>✕</Btn>}
              </div>
            ))}
            <Btn small onClick={()=>setFeatures(fs=>[...fs,""])}>+ Add Feature</Btn>
          </div>
        </div>
        <div style={{...flex(8,"center","flex-end"),marginTop:4}}>
          <Btn onClick={onClose}>Cancel</Btn>
          <Btn variant="primary" onClick={save}>Save Changes</Btn>
        </div>
      </div>
    </Modal>
  );
}

function Subscriptions({roofers,seats,zipTerritories,onUpdate}){
  const[tab,setTab]=useState("Clients");
  const[showInvite,setShowInvite]=useState(false);
  const[iName,setIName]=useState(""),[iEmail,setIEmail]=useState("");
  const[pricing,setPricing]=useState({
    Starter:{price:1500,features:["1 user","1 city","10 ZIP codes","Standard storm alerts","Lead dashboard","Inspection scheduling"]},
    Pro:{price:2000,features:["1 user","1 city","20 ZIP codes","Priority storm alerts","Lead dashboard","Inspection scheduling"]},
    Growth:{price:2750,features:["3 users","2 cities","30 ZIP codes","Priority storm alerts","Lead dashboard","Inspection scheduling","Advanced reporting"]},
  });
  const mrr=roofers.filter(r=>r.status==="active").reduce((s,r)=>s+(pricing[r.plan]?.price||PLAN_PRICES[r.plan]||0),0);

  return <div>
    {showInvite&&<Modal title="Invite Client" onClose={()=>setShowInvite(false)}>
      <div style={{display:"flex",flexDirection:"column",gap:13}}>
        <Input label="Company Name" value={iName} onChange={setIName} placeholder="Apex Roofing"/>
        <Input label="Email" value={iEmail} onChange={setIEmail} type="email" placeholder="owner@company.com"/>
        <div style={{...flex(8,"center","flex-end"),marginTop:4}}>
          <Btn onClick={()=>setShowInvite(false)}>Cancel</Btn>
          <Btn variant="primary" onClick={()=>{if(!iName||!iEmail)return;onUpdate("add_roofer",{roofer:{id:"r"+Date.now(),name:iName,owner:iName,email:iEmail,phone:"",plan:"Starter",status:"trial",territories:[],revenue:0,leads:0,booked:0,inspectors:[],inspections:[],revenueLog:[],commSettings:{...DEFAULT_COMM},scheduleSettings:{...DEFAULT_SCHEDULE},notifications:[],pin:"0000",zipLimit:10,seatLimit:1}});setShowInvite(false);setIEmail("");setIName("");alert(`Invite sent to ${iEmail}`);}}>Send Invite</Btn>
        </div>
      </div>
    </Modal>}
    <Tabs tabs={["Clients","Seats","Territories","Pricing","Billing"]} active={tab} onChange={setTab}/>

    {tab==="Clients"&&<div>
      <div style={{...flex(0,"center","flex-end"),marginBottom:14}}><Btn variant="primary" onClick={()=>setShowInvite(true)}>+ Invite Client</Btn></div>
      <TableWrap headers={["Company","Owner","Email","Plan","Status","MRR","Action"]}>
        {roofers.map(r=><TR key={r.id}>
          <TD bold>{r.name}</TD>
          <TD>{r.owner}</TD>
          <TD dim>{r.email}</TD>
          <TD><select value={r.plan} onChange={async e=>{
            const newPlan=e.target.value;
            onUpdate("update_roofer_plan",{rooferId:r.id,plan:newPlan});
            if(r.stripeSubscriptionId&&r.stripeStatus==="active"){
              const result=await billingCall("/stripe/update-subscription",{rooferId:r.id,newPlan});
              if(result.error) alert("Plan updated locally but Stripe error: "+result.error);
            }
          }} style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:5,padding:"3px 8px",color:C.text,fontSize:12}}>{Object.keys(pricing).map(p=><option key={p}>{p}</option>)}</select></TD>
          <TD><StatusBadge status={r.status}/>{r.stripeStatus&&r.stripeStatus!=="none"&&r.stripeStatus!=="active"&&<Badge label={r.stripeStatus} color={C.red} small/>}</TD>
          <TD style={{color:C.green,fontWeight:600}}>{r.status==="active"?`$${(pricing[r.plan]?.price||0).toLocaleString()}/mo`:"—"}</TD>
          <TD>
            {r.status!=="active"&&r.status!=="past_due"
              ?<Btn small variant="success" onClick={async()=>{
                  onUpdate("update_roofer_status",{rooferId:r.id,status:"active"});
                  const result=await billingCall("/stripe/create-subscription",{rooferId:r.id,name:r.name,email:r.email,plan:r.plan});
                  if(result.paymentLink){
                    onUpdate("update_roofer_stripe",{rooferId:r.id,stripeCustomerId:result.customerId,stripeSubscriptionId:result.subscriptionId,stripeStatus:"incomplete"});
                    if(window.confirm(`Subscription created! Open payment link for ${r.name} to enter their card?\n\n${result.paymentLink}`)){
                      window.open(result.paymentLink,"_blank");
                    }
                  }else if(result.error){
                    alert("Billing error: "+result.error+"\n\nRoofer was activated locally but Stripe subscription was not created.");
                  }
                }}>Activate</Btn>
              :<Btn small variant="danger" onClick={async()=>{
                  if(!window.confirm(`Cancel ${r.name}'s subscription? They'll keep access until the end of their billing period.`)) return;
                  onUpdate("update_roofer_status",{rooferId:r.id,status:"cancelled"});
                  const result=await billingCall("/stripe/cancel-subscription",{rooferId:r.id});
                  if(result.error) alert("Billing error: "+result.error);
                }}>Cancel</Btn>
            }
            {r.stripeStatus==="past_due"&&<Btn small variant="warning" onClick={async()=>{
              const result=await billingCall("/stripe/payment-link",{rooferId:r.id,plan:r.plan});
              if(result.url) window.open(result.url,"_blank");
            }}>💳 Resend Link</Btn>}
          </TD>
        </TR>)}
      </TableWrap>
    </div>}

    {tab==="Pricing"&&<PricingEditor pricing={pricing} setPricing={setPricing} roofers={roofers} onUpdate={onUpdate}/>}
    {tab==="Seats"&&<div style={{marginTop:14}}>
      {roofers.length===0
        ? <div style={{...card(),textAlign:"center",color:C.textMuted,padding:32}}>No clients yet. Invite a client first to manage their seats.</div>
        : roofers.map(r=>(
          <div key={r.id} style={{marginBottom:16}}>
            <div style={{fontSize:13,fontWeight:600,color:C.textSub,marginBottom:8,paddingLeft:2}}>
              {r.name} — {r.plan} plan
            </div>
            <SeatsPanel
              roofer={r}
              seats={seats.filter(s=>s.account_id===r.id)}
              onUpdate={onUpdate}
              apiKeys={{}}
            />
          </div>
        ))
      }
    </div>}
    {tab==="Territories"&&<div style={{marginTop:14}}>
      {roofers.length===0
        ? <div style={{...card(),textAlign:"center",color:C.textMuted,padding:32}}>No clients yet. Invite a client first to manage their territories.</div>
        : roofers.map(r=>(
          <div key={r.id} style={{marginBottom:20}}>
            <div style={{fontSize:13,fontWeight:600,color:C.textSub,marginBottom:8,paddingLeft:2}}>
              {r.name} — {r.plan} plan
            </div>
            <ZipTerritoryPanel
              roofer={r}
              zipTerritories={zipTerritories.filter(z=>z.account_id===r.id)}
              allZipData={zipTerritories}
              onUpdate={onUpdate}
            />
          </div>
        ))
      }
    </div>}

    {tab==="Billing"&&<div style={{display:"flex",flexDirection:"column",gap:16}}>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(150px,1fr))",gap:12}}>
        <StatCard label="Total MRR" value={`$${mrr.toLocaleString()}`} color={C.green} sub="Active clients" icon="$"/>
        <StatCard label="Active Clients" value={roofers.filter(r=>r.status==="active").length} color={C.orange} icon="◈"/>
        <StatCard label="Annual Run Rate" value={`$${(mrr*12).toLocaleString()}`} color={C.blue} icon="📈"/>
      </div>
      <TableWrap headers={["Company","Plan","Status","Monthly","Next Billing"]}>
        {roofers.map(r=><TR key={r.id}>
          <TD bold>{r.name}</TD>
          <TD><Badge label={r.plan} color={PLAN_COLORS[r.plan]} small/></TD>
          <TD><StatusBadge status={r.status}/></TD>
          <TD style={{color:r.status==="active"?C.green:C.textMuted,fontWeight:r.status==="active"?600:400}}>{r.status==="active"?`$${(pricing[r.plan]?.price||0).toLocaleString()}`:"—"}</TD>
          <TD dim>{r.status==="active"?"Jul 1, 2025":"—"}</TD>
        </TR>)}
      </TableWrap>
    </div>}
  </div>;
}

// ─── API SETTINGS ─────────────────────────────────────────────────────────────
function APISettings({apiKeys,onUpdate}){
  const[keys,setKeys]=useState({weather:apiKeys.weather||"",twilioSid:apiKeys.twilio?.sid||"",twilioToken:apiKeys.twilio?.token||"",twilioPhone:apiKeys.twilio?.from||"",googleCalClientId:apiKeys.googleCal?.clientId||"",googleCalClientSecret:apiKeys.googleCal?.clientSecret||"",googleCalRefreshToken:apiKeys.googleCal?.refreshToken||"",attom:apiKeys.attom||"",stripePublishable:apiKeys.stripe?.publishable||"",stripeSecret:apiKeys.stripe?.secret||""});
  const[testResults,setTestResults]=useState({});

  function save(){onUpdate("api_keys",{weather:keys.weather,twilio:keys.twilioSid?{sid:keys.twilioSid,token:keys.twilioToken,from:keys.twilioPhone}:null,googleCal:keys.googleCalClientId?{clientId:keys.googleCalClientId,clientSecret:keys.googleCalClientSecret,refreshToken:keys.googleCalRefreshToken}:null,attom:keys.attom,stripe:keys.stripeSecret?{publishable:keys.stripePublishable,secret:keys.stripeSecret}:null});alert("API keys saved!");}

  async function testService(name){
    setTestResults(p=>({...p,[name]:"Testing..."}));
    try{
      if(name==="weather"&&keys.weather){const r=await fetch(`https://api.weatherapi.com/v1/current.json?key=${keys.weather}&q=75023`);const d=await r.json();setTestResults(p=>({...p,[name]:d.error?"❌ "+d.error.message:"✓ Connected — "+d.location?.name}));}
      else if(name==="googleCal"&&keys.googleCalClientId){const t=await getGCalAccessToken({clientId:keys.googleCalClientId,clientSecret:keys.googleCalClientSecret,refreshToken:keys.googleCalRefreshToken});setTestResults(p=>({...p,[name]:t?"✓ Token refreshed successfully":"❌ Failed"}));}
      else if(name==="twilio"&&keys.twilioSid){const r=await fetch(`https://api.twilio.com/2010-04-01/Accounts/${keys.twilioSid}.json`,{headers:{"Authorization":"Basic "+btoa(keys.twilioSid+":"+keys.twilioToken)}});const d=await r.json();setTestResults(p=>({...p,[name]:d.friendly_name?"✓ "+d.friendly_name:"❌ "+(d.message||"Invalid credentials")}));}
      else if(name==="attom"&&keys.attom){const r=await fetch("https://api.gateway.attomdata.com/propertyapi/v1.0.0/property/basicprofile?postalcode=75023&pagesize=1",{headers:{"apikey":keys.attom,"Accept":"application/json"}});const d=await r.json();setTestResults(p=>({...p,[name]:d.property?"✓ Connected":"❌ "+(d.status?.msg||"Invalid key")}));}
      else if(name==="stripe"&&keys.stripeSecret){const r=await fetch("https://api.stripe.com/v1/balance",{headers:{"Authorization":"Bearer "+keys.stripeSecret}});const d=await r.json();setTestResults(p=>({...p,[name]:d.object==="balance"?"✓ Connected":"❌ "+(d.error?.message||"Invalid key")}));}
      else if(name==="claude"){const r=await callClaude([{role:"user",content:"Reply with exactly: SkyShield connected"}]);setTestResults(p=>({...p,[name]:"✓ "+r.trim().slice(0,40)}));}
      else setTestResults(p=>({...p,[name]:"⚠ Enter key above and try again"}));
    }catch(e){setTestResults(p=>({...p,[name]:"❌ "+e.message}));}
  }

  const services=[
    {id:"weather",name:"WeatherAPI.com",desc:"Storm alert scanning",link:"https://www.weatherapi.com/",fields:[{k:"weather",label:"API Key"}]},
    {id:"twilio",name:"Twilio SMS",desc:"Account credentials (shared) + default fallback number",link:"https://www.twilio.com/",fields:[{k:"twilioSid",label:"Account SID"},{k:"twilioToken",label:"Auth Token",pw:true},{k:"twilioPhone",label:"Default From Number (fallback)"}]},
    {id:"googleCal",name:"Google Calendar",desc:"Inspection scheduling sync",link:"https://console.cloud.google.com/",fields:[{k:"googleCalClientId",label:"Client ID"},{k:"googleCalClientSecret",label:"Client Secret",pw:true},{k:"googleCalRefreshToken",label:"Refresh Token",pw:true}]},
    {id:"attom",name:"ATTOM Property Data",desc:"Property data enrichment",link:"https://www.attomdata.com/",fields:[{k:"attom",label:"API Key"}]},
    {id:"stripe",name:"Stripe",desc:"Subscription billing",link:"https://dashboard.stripe.com/",fields:[{k:"stripePublishable",label:"Publishable Key"},{k:"stripeSecret",label:"Restricted Key",pw:true}]},
    {id:"claude",name:"Claude AI (Built-in)",desc:"Powers AI Agent & SMS generation",link:"https://console.anthropic.com/",fields:[]},
  ];
  const configured=id=>{if(id==="twilio")return !!keys.twilioSid;if(id==="googleCal")return !!keys.googleCalClientId&&!!keys.googleCalRefreshToken;if(id==="stripe")return !!keys.stripeSecret;if(id==="claude")return true;return !!keys[id];};

  return <div>
    <div style={{...flex(0,"center","space-between"),marginBottom:20}}>
      <div><div style={T.head(18,700)}>API Configuration</div><div style={{fontSize:13,color:C.textMuted,marginTop:4}}>Connect services to unlock full automation</div></div>
      <Btn variant="primary" onClick={save}>Save All Keys</Btn>
    </div>
    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(300px,1fr))",gap:16}}>
      {services.map(svc=><div key={svc.id} style={card()}>
        <div style={{...flex(0,"center","space-between"),marginBottom:svc.fields.length?14:0}}>
          <div><div style={T.head(13,600)}>{svc.name}</div><div style={{fontSize:12,color:C.textMuted,marginTop:3}}>{svc.desc}</div></div>
          <Badge label={configured(svc.id)?"connected":"not set"} color={configured(svc.id)?C.green:C.textMuted} small/>
        </div>
        {svc.fields.length>0&&<div style={{display:"flex",flexDirection:"column",gap:10}}>{svc.fields.map(f=><Input key={f.k} label={f.label} type={f.pw?"password":"text"} value={keys[f.k]} onChange={v=>setKeys(p=>({...p,[f.k]:v}))} placeholder="Enter key..."/>)}</div>}
        {svc.id==="claude"&&<div style={{padding:"8px 12px",background:C.greenDim,borderRadius:6,fontSize:12,color:C.green,border:`1px solid ${C.green}22`}}>✓ Claude AI is pre-configured and ready to use.</div>}
        <div style={{...flex(0,"center","space-between"),marginTop:14}}>
          <a href={svc.link} target="_blank" rel="noreferrer" style={{fontSize:12,color:C.blue}}>Get API Key ↗</a>
          <Btn small onClick={()=>testService(svc.id)}>Test Connection</Btn>
        </div>
        {testResults[svc.id]&&<div style={{marginTop:8,padding:"6px 10px",borderRadius:5,fontSize:12,color:testResults[svc.id].startsWith("✓")?C.green:testResults[svc.id].startsWith("⚠")?C.yellow:C.red,background:testResults[svc.id].startsWith("✓")?C.greenDim:testResults[svc.id].startsWith("⚠")?C.yellowDim:C.redDim}}>{testResults[svc.id]}</div>}
      </div>)}
    </div>
    <div style={{marginTop:20,padding:"14px 16px",background:C.blueDim,borderRadius:8,border:`1px solid ${C.blue}22`}}>
      <div style={{fontSize:13,fontWeight:600,color:C.text,marginBottom:6}}>📱 Per-Roofer SMS Numbers</div>
      <div style={{fontSize:12,color:C.textSub,lineHeight:1.7}}>
        Each roofer should have their own Twilio phone number so their texts come from a number leads recognize as that specific company — and so two roofers never appear to be texting from the same line. Set each roofer's number under <strong>Command Center → Roofers → Edit</strong>. Buy additional numbers from the same Twilio account under <strong>Phone Numbers → Buy a Number</strong> in your Twilio console; they'll all share the Account SID and Auth Token configured above. If a roofer has no number set, messages fall back to the default number above.
      </div>
    </div>
  </div>;
}

// ─── MAIN APP ─────────────────────────────────────────────────────────────────
export default function App(){
  const[roofers,setRoofers]=useState([]);
  const[seats,setSeats]=useState([]);
  const[zipTerritories,setZipTerritories]=useState([]);
  const[leads,setLeads]=useState([]);
  const[storms,setStorms]=useState([]);
  const[apiKeys,setApiKeys]=useState({});
  const[activeSection,setActiveSection]=useState("Command Center");
  const[selectedRoofer,setSelectedRoofer]=useState(null);
  const[scanSettings,setScanSettings]=useState({interval:"daily",startTime:"07:00",lastScan:null});
  const[activities,setActivities]=useState([{type:"system",message:"SkyShield Pro initialized and ready.",ts:new Date().toLocaleString(),badge:"ready",badgeColor:C.green}]);
  const[auth,setAuth]=useState({loggedIn:false,role:null,roofer:null,session:null});
  const[resetToken,setResetToken]=useState(null);
  const[checkingSession,setCheckingSession]=useState(true);
  const[dataLoaded,setDataLoaded]=useState(false);
  const[dataLoadError,setDataLoadError]=useState(null);
  const[showWhatsNew,setShowWhatsNew]=useState(false);
  const[showLogin,setShowLogin]=useState(false);

  // Detect Supabase password-recovery link (#access_token=...&type=recovery),
  // then attempt to restore a previous session from persistent storage so the
  // user doesn't have to log in again every time they refresh the page.
  useEffect(()=>{
    (async()=>{
      const hash=window.location.hash;
      if(hash&&hash.includes("type=recovery")){
        const params=new URLSearchParams(hash.startsWith("#")?hash.slice(1):hash);
        const token=params.get("access_token");
        if(token){ setResetToken(token); setCheckingSession(false); return; }
      }

      try{
        const refreshToken=localStorage.getItem("skyshield_refresh_token");
        if(refreshToken){
          const sessionData=await supabaseRefreshSession(refreshToken);
          if(sessionData?.access_token){
            handleLoginSuccess(sessionData, true);
            setCheckingSession(false);
            return;
          }
        }
      }catch(e){
        // No stored session, or it's expired/invalid — fall through to login screen.
      }
      setCheckingSession(false);
    })();
  },[]);

  // Once logged in, load real data from Supabase. Replaces the demo data
  // entirely — this is what makes roofers/leads/etc survive page reloads
  // and code deploys instead of resetting every time.
  useEffect(()=>{
    if(!auth.loggedIn) return;
    let cancelled=false;
    (async()=>{
      try{
        const data=await loadAllData();
        if(cancelled) return;
        setRoofers(data.roofers);
        setLeads(data.leads);
        setStorms(data.storms);
        setActivities(data.activities.length>0?data.activities:[{type:"system",message:"SkyShield Pro initialized and ready.",ts:new Date().toLocaleString(),badge:"ready",badgeColor:C.green}]);
        setScanSettings(data.scanSettings);
        setApiKeys(data.apiKeys);
        setSeats(data.seats||[]);
        setZipTerritories(data.zipTerritories||[]);
        // Show "What's New" if the user hasn't seen this version yet
        if((data.lastSeenVersion||"0.0.0")!==APP_VERSION) setShowWhatsNew(true);
        setDataLoaded(true);
      }catch(e){
        console.error("Failed to load data from Supabase:",e);
        setDataLoadError(e.message);
        setDataLoaded(true); // proceed with whatever local state exists rather than blocking the app
      }
    })();
    return()=>{cancelled=true;};
  },[auth.loggedIn]);

  // Debounced auto-save: whenever roofers/leads/storms/activities/scanSettings/
  // apiKeys change, persist the changed records to Supabase shortly after.
  // Debouncing avoids hammering the database on every keystroke in a text field.
  const saveTimers=useRef({});
  function debouncedSave(key,fn,delay=800){
    clearTimeout(saveTimers.current[key]);
    saveTimers.current[key]=setTimeout(fn,delay);
  }

  const prevRoofers=useRef(roofers);
  useEffect(()=>{
    if(!dataLoaded) return;
    const prev=prevRoofers.current;
    prevRoofers.current=roofers;
    // Save any roofer whose record changed since the last render.
    roofers.forEach(r=>{
      const before=prev.find(p=>p.id===r.id);
      if(!before||JSON.stringify(before)!==JSON.stringify(r)){
        debouncedSave("roofer:"+r.id, ()=>saveRoofer(r));
      }
    });
    // Detect deletions: roofer existed before but not now.
    prev.forEach(p=>{
      if(!roofers.some(r=>r.id===p.id)) deleteRooferRow(p.id);
    });
  },[roofers,dataLoaded]);

  const prevLeads=useRef(leads);
  useEffect(()=>{
    if(!dataLoaded) return;
    const prev=prevLeads.current;
    prevLeads.current=leads;
    leads.forEach(l=>{
      const before=prev.find(p=>p.id===l.id);
      if(!before||JSON.stringify(before)!==JSON.stringify(l)){
        debouncedSave("lead:"+l.id, ()=>saveLead(l));
      }
    });
    prev.forEach(p=>{
      if(!leads.some(l=>l.id===p.id)) deleteLeadRow(p.id);
    });
  },[leads,dataLoaded]);

  const prevStorms=useRef(storms);
  useEffect(()=>{
    if(!dataLoaded) return;
    const prev=prevStorms.current;
    prevStorms.current=storms;
    storms.forEach(s=>{
      const before=prev.find(p=>p.id===s.id);
      if(!before||JSON.stringify(before)!==JSON.stringify(s)){
        debouncedSave("storm:"+s.id, ()=>saveStorm(s));
      }
    });
  },[storms,dataLoaded]);

  useEffect(()=>{
    if(!dataLoaded) return;
    debouncedSave("appstate", ()=>saveAppState({ activities, scan_settings:scanSettings, api_keys:apiKeys }));
  },[activities,scanSettings,apiKeys,dataLoaded]);

  // Determine role from email: configure your admin email(s) here
  const ADMIN_EMAILS=["noah.arkdynamics@gmail.com"];

  function handleLoginSuccess(sessionData, isRestoring){
    setCurrentAccessToken(sessionData.access_token);
    if(sessionData.refresh_token){
      try{ localStorage.setItem("skyshield_refresh_token", sessionData.refresh_token); }catch(e){}
    }
    const email=sessionData.user?.email||"";
    const isAdmin=ADMIN_EMAILS.includes(email.toLowerCase());
    if(isAdmin){
      setAuth({loggedIn:true,role:"admin",roofer:null,session:sessionData});
    } else {
      // Match roofer by email. On a fresh login, `roofers` is already loaded
      // by this point. On session restoration (page refresh), `roofers` may
      // still be empty — store the email so a follow-up effect can re-match
      // once roofer data finishes loading from Supabase.
      const matched=roofers.find(r=>r.email?.toLowerCase()===email.toLowerCase());
      if(matched){
        setAuth({loggedIn:true,role:"roofer",roofer:matched,session:sessionData});
        setSelectedRoofer(matched);
        setActiveSection("Roofer Dashboard");
      } else if(isRestoring){
        // Defer final roofer assignment until data loads; mark as pending.
        setAuth({loggedIn:true,role:"roofer",roofer:{id:sessionData.user.id,email,name:email,owner:email,phone:"",plan:"Starter",status:"trial",territories:[],revenue:0,leads:0,booked:0,inspectors:[],inspections:[],revenueLog:[],commSettings:{...DEFAULT_COMM},scheduleSettings:{...DEFAULT_SCHEDULE},notifications:[]},session:sessionData,pendingMatch:true});
      } else {
        setAuth({loggedIn:true,role:"roofer",roofer:{id:sessionData.user.id,name:email,owner:email,email,phone:"",plan:"Starter",status:"trial",territories:[],revenue:0,leads:0,booked:0,inspectors:[],inspections:[],revenueLog:[],commSettings:{...DEFAULT_COMM},scheduleSettings:{...DEFAULT_SCHEDULE},notifications:[]},session:sessionData});
      }
    }
  }

  // Once roofer data finishes loading after a restored session, re-match the
  // logged-in roofer by email in case the initial match (during restoration,
  // before data was loaded) used a placeholder record.
  useEffect(()=>{
    if(!dataLoaded||!auth.loggedIn||auth.role!=="roofer"||!auth.pendingMatch) return;
    const email=auth.roofer?.email?.toLowerCase();
    const matched=roofers.find(r=>r.email?.toLowerCase()===email);
    if(matched){
      setAuth(p=>({...p,roofer:matched,pendingMatch:false}));
      setSelectedRoofer(matched);
      setActiveSection("Roofer Dashboard");
    } else {
      setAuth(p=>({...p,pendingMatch:false}));
    }
  },[dataLoaded,roofers]);

  function dismissWhatsNew(){
    setShowWhatsNew(false);
    saveAppState({last_seen_version:APP_VERSION});
  }

  function handleSignOut(){
    setCurrentAccessToken(null);
    try{ localStorage.removeItem("skyshield_refresh_token"); }catch(e){}
    setAuth({loggedIn:false,role:null,roofer:null,session:null});
    setSelectedRoofer(null);
    setActiveSection("Command Center");
    setDataLoaded(false);
  }

  // Load Leaflet map library
  useEffect(()=>{
    if(window.L) return;
    const link=document.createElement("link");link.rel="stylesheet";link.href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";document.head.appendChild(link);
    const script=document.createElement("script");script.src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";document.head.appendChild(script);
  },[]);

  function addActivity(entry){setActivities(p=>[{...entry,ts:new Date().toLocaleString()},...p].slice(0,200));}

  function handleUpdate(action,payload){
    switch(action){
      case "add_roofer":setRoofers(p=>[...p,{...payload.roofer,trialStartedAt:payload.roofer.trialStartedAt||new Date().toISOString()}]);break;
      case "notify_roofer":
        setRoofers(p=>p.map(r=>r.id===payload.rooferId?{...r,notifications:[{id:"n"+Date.now()+Math.random(),...payload.notification,read:false,ts:new Date().toLocaleString()},...(r.notifications||[])].slice(0,50)}:r));
        setSelectedRoofer(p=>p&&p.id===payload.rooferId?{...p,notifications:[{id:"n"+Date.now()+Math.random(),...payload.notification,read:false,ts:new Date().toLocaleString()},...(p.notifications||[])].slice(0,50)}:p);
        if(apiKeys.twilio?.sid){
          const roofer=roofers.find(r=>r.id===payload.rooferId);
          if(roofer?.phone) sendTwilioSMS(apiKeys.twilio,roofer.phone,payload.notification.smsText||payload.notification.message,roofer.twilioFrom).catch(()=>{});
        }
        break;
      case "mark_notifications_read":
        setRoofers(p=>p.map(r=>r.id===payload.rooferId?{...r,notifications:(r.notifications||[]).map(n=>({...n,read:true}))}:r));
        setSelectedRoofer(p=>p&&p.id===payload.rooferId?{...p,notifications:(p.notifications||[]).map(n=>({...n,read:true}))}:p);
        break;
      case "add_lead":setLeads(p=>[...p,payload.lead]);setRoofers(p=>p.map(r=>r.id===payload.lead.rooferId?{...r,leads:r.leads+1}:r));addActivity({type:"lead",message:`New lead: ${payload.lead.homeowner} (${payload.lead.zip})`});break;
      case "add_storm":if(!storms.some(s=>s.zip===payload.storm.zip&&s.date===payload.storm.date)){setStorms(p=>[...p,payload.storm]);addActivity({type:"storm",message:`Storm detected: ${payload.storm.type} in ${payload.storm.location}`,badge:payload.storm.severity,badgeColor:{extreme:C.red,severe:C.orange,moderate:C.yellow}[payload.storm.severity]||C.blue});}break;
      case "process_storm":setStorms(p=>p.map(s=>s.id===payload.stormId?{...s,processed:true}:s));break;
      case "lead_status":setLeads(p=>p.map(l=>l.id===payload.leadId?{...l,status:payload.status}:l));break;
      case "add_conversation":setLeads(p=>p.map(l=>l.id===payload.leadId?{...l,conversations:[...(l.conversations||[]),payload.entry]}:l));break;
      case "update_lead_notes":setLeads(p=>p.map(l=>l.id===payload.leadId?{...l,notes:payload.notes}:l));break;
      case "clear_activities":setActivities([]);break;
      case "add_seat":setSeats(p=>[...p,payload.seat]);break;
      case "remove_seat":setSeats(p=>p.filter(s=>s.id!==payload.seatId));break;
      case "update_seat":setSeats(p=>p.map(s=>s.id===payload.seat.id?{...s,...payload.seat}:s));break;
      case "add_zip_territory":setZipTerritories(p=>[...p,payload.zipEntry]);break;
      case "remove_zip_territory":setZipTerritories(p=>p.filter(z=>!(z.zip_code===payload.zip&&z.account_id===payload.rooferId)));break;
      case "update_adult_confirmed":setLeads(p=>p.map(l=>l.id===payload.leadId?{...l,adultConfirmed:payload.status}:l));break;
      case "set_contacted_at":setLeads(p=>p.map(l=>l.id===payload.leadId?{...l,contactedAt:payload.ts}:l));break;
      case "mark_followup_sent":setLeads(p=>p.map(l=>l.id===payload.leadId?{...l,followupSent:true}:l));break;
      case "book_lead":setLeads(p=>p.map(l=>l.id===payload.leadId?{...l,status:"scheduled"}:l));setRoofers(p=>p.map(r=>r.id===payload.rooferId?{...r,booked:r.booked+1,inspections:[...r.inspections,payload.inspection]}:r));setSelectedRoofer(p=>p&&p.id===payload.rooferId?{...p,booked:p.booked+1,inspections:[...p.inspections,payload.inspection]}:p);break;
      case "log_revenue":setRoofers(p=>p.map(r=>r.id===payload.rooferId?{...r,revenue:r.revenue+payload.entry.amount,revenueLog:[...(r.revenueLog||[]),payload.entry]}:r));setSelectedRoofer(p=>p&&p.id===payload.rooferId?{...p,revenue:p.revenue+payload.entry.amount,revenueLog:[...(p.revenueLog||[]),payload.entry]}:p);break;
      case "update_inspection_status":setRoofers(p=>p.map(r=>r.id===payload.rooferId?{...r,inspections:r.inspections.map(i=>i.id===payload.inspectionId?{...i,status:payload.status}:i)}:r));setSelectedRoofer(p=>p&&p.id===payload.rooferId?{...p,inspections:p.inspections.map(i=>i.id===payload.inspectionId?{...i,status:payload.status}:i)}:p);break;
      case "add_inspector":setRoofers(p=>p.map(r=>r.id===payload.rooferId?{...r,inspectors:[...r.inspectors,payload.inspector]}:r));setSelectedRoofer(p=>p&&p.id===payload.rooferId?{...p,inspectors:[...p.inspectors,payload.inspector]}:p);break;
      case "add_inspection":setRoofers(p=>p.map(r=>r.id===payload.rooferId?{...r,inspections:[...r.inspections,payload.inspection]}:r));setSelectedRoofer(p=>p&&p.id===payload.rooferId?{...p,inspections:[...p.inspections,payload.inspection]}:p);break;
      case "reschedule_inspection":setRoofers(p=>p.map(r=>r.id===payload.rooferId?{...r,inspections:r.inspections.map(i=>i.id===payload.inspection.id?{...i,...payload.inspection}:i)}:r));setSelectedRoofer(p=>p&&p.id===payload.rooferId?{...p,inspections:p.inspections.map(i=>i.id===payload.inspection.id?{...i,...payload.inspection}:i)}:p);break;
      case "update_schedule_settings":setRoofers(p=>p.map(r=>r.id===payload.rooferId?{...r,scheduleSettings:payload.settings}:r));setSelectedRoofer(p=>p&&p.id===payload.rooferId?{...p,scheduleSettings:payload.settings}:p);break;
      case "add_territory":setRoofers(p=>p.map(r=>r.id===payload.rooferId&&!r.territories.includes(payload.zip)?{...r,territories:[...r.territories,payload.zip]}:r));setSelectedRoofer(p=>p&&p.id===payload.rooferId&&!p.territories.includes(payload.zip)?{...p,territories:[...p.territories,payload.zip]}:p);break;
      case "remove_territory":setRoofers(p=>p.map(r=>r.id===payload.rooferId?{...r,territories:r.territories.filter(z=>z!==payload.zip)}:r));setSelectedRoofer(p=>p&&p.id===payload.rooferId?{...p,territories:p.territories.filter(z=>z!==payload.zip)}:p);break;
      case "update_roofer_plan":setRoofers(p=>p.map(r=>r.id===payload.rooferId?{...r,plan:payload.plan}:r));break;
      case "update_roofer_status":setRoofers(p=>p.map(r=>r.id===payload.rooferId?{...r,status:payload.status}:r));break;
      case "update_roofer_stripe":setRoofers(p=>p.map(r=>r.id===payload.rooferId?{...r,stripeCustomerId:payload.stripeCustomerId,stripeSubscriptionId:payload.stripeSubscriptionId,stripeStatus:payload.stripeStatus}:r));break;
      case "update_comm_settings":setRoofers(p=>p.map(r=>r.id===payload.rooferId?{...r,commSettings:payload.settings}:r));setSelectedRoofer(p=>p&&p.id===payload.rooferId?{...p,commSettings:payload.settings}:p);break;
      case "api_keys":setApiKeys(payload);break;
      case "delete_roofer":setRoofers(p=>p.filter(r=>r.id!==payload.rooferId));setLeads(p=>p.filter(l=>l.rooferId!==payload.rooferId));if(selectedRoofer?.id===payload.rooferId)setSelectedRoofer(null);break;
      case "edit_roofer":setRoofers(p=>p.map(r=>r.id===payload.roofer.id?{...r,...payload.roofer}:r));setSelectedRoofer(p=>p&&p.id===payload.roofer.id?{...p,...payload.roofer}:p);break;
      case "delete_lead":setLeads(p=>p.filter(l=>l.id!==payload.leadId));break;
      case "edit_lead":setLeads(p=>p.map(l=>l.id===payload.lead.id?{...l,...payload.lead}:l));break;
      default:break;
    }
  }

  function selectRoofer(roofer){setSelectedRoofer(roofer);setActiveSection("Roofer Dashboard");}

  // ── NAV CONFIG ────────────────────────────────────────────────────────────
  const navSections=["Command Center","Subscriptions & Billing","API Settings"];
  const navStyle=(active)=>({border:"none",cursor:"pointer",padding:"6px 12px",borderRadius:6,fontSize:13,fontWeight:500,color:active?C.orange:C.textSub,background:active?C.orangeDim:"transparent"});

  // ── SHOW RESET PASSWORD SCREEN (from email link) ──────────────────────────
  if(resetToken) return <><FontLoader/><ResetPasswordScreen accessToken={resetToken} onDone={()=>{setResetToken(null);window.location.hash="";}}/></>;

  // ── SHOW LOGIN ─────────────────────────────────────────────────────────────
  if(checkingSession) return <><FontLoader/><div style={{minHeight:"100vh",background:C.bg}}/></>;
  if(!auth.loggedIn) return <><FontLoader/><LandingPage onSignIn={()=>setShowLogin(true)} showLogin={showLogin} onLoginSuccess={handleLoginSuccess}/></>;

  // ── LOADING DATA FROM SUPABASE ─────────────────────────────────────────────
  if(!dataLoaded) return <><FontLoader/><div style={{minHeight:"100vh",background:C.bg,display:"flex",alignItems:"center",justifyContent:"center"}}>
    <div style={{textAlign:"center"}}>
      <div style={{width:40,height:40,borderRadius:10,background:"linear-gradient(135deg,#0d9488,#0284c7)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:20,margin:"0 auto 14px"}}>⛈</div>
      <div style={{fontSize:13,color:C.textMuted}}>Loading your data...</div>
    </div>
  </div></>;

  // ── ROOFER VIEW ────────────────────────────────────────────────────────────
  if(auth.role==="roofer"){
    const live=roofers.find(r=>r.id===auth.roofer.id)||auth.roofer;

    // Payment gate — block access if subscription is past_due or cancelled
    if(live.stripeStatus==="past_due"||live.status==="past_due"){
      return <div style={{minHeight:"100vh",background:C.bg,backgroundImage:"radial-gradient(ellipse at 0% 0%,rgba(13,148,136,0.13) 0%,transparent 45%),radial-gradient(ellipse at 100% 100%,rgba(2,132,199,0.09) 0%,transparent 40%)",display:"flex",alignItems:"center",justifyContent:"center",padding:20}}><FontLoader/>
        <div style={{...card(),maxWidth:460,width:"100%",textAlign:"center",padding:36}}>
          <div style={{fontSize:28,marginBottom:16,color:"#f87171",fontWeight:700}}>!</div>
          <div style={{...T.head(20,700),marginBottom:8,color:C.red}}>Payment Required</div>
          <div style={{fontSize:13,color:C.textSub,lineHeight:1.6,marginBottom:24}}>
            Your SkyShield Pro subscription payment failed. Your account has been temporarily suspended. Please update your payment method to restore access.
          </div>
          <div style={{display:"flex",flexDirection:"column",gap:10}}>
            <Btn variant="primary" onClick={async()=>{
              const result=await billingCall("/stripe/payment-link",{rooferId:live.id,plan:live.plan});
              if(result.url) window.open(result.url,"_blank");
              else alert("Could not generate payment link. Please contact support.");
            }}>Update Payment Method</Btn>
            <Btn variant="ghost" onClick={handleSignOut}>Sign Out</Btn>
          </div>
          <div style={{fontSize:11,color:C.textMuted,marginTop:16}}>
            Questions? Contact noah.arkdynamics@gmail.com
          </div>
        </div>
      </div>;
    }

    // Trial expiry gate — show upgrade wall when 14-day trial has ended
    if(trialExpired(live)){
      return <div style={{minHeight:"100vh",background:C.bg,backgroundImage:"radial-gradient(ellipse at 0% 0%,rgba(13,148,136,0.13) 0%,transparent 45%),radial-gradient(ellipse at 100% 100%,rgba(2,132,199,0.09) 0%,transparent 40%)",display:"flex",alignItems:"center",justifyContent:"center",padding:20}}><FontLoader/>
        <div style={{...card(),maxWidth:480,width:"100%",textAlign:"center",padding:40,border:`1px solid ${C.borderAct}`}}>
          <div style={{width:56,height:56,borderRadius:16,background:"linear-gradient(135deg,#0d9488,#0284c7)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:26,margin:"0 auto 20px",boxShadow:"0 8px 24px rgba(13,148,136,0.4)"}}>⛈</div>
          <div style={{...T.head(22,700),marginBottom:8}}>Your Trial Has Ended</div>
          <div style={{fontSize:13,color:C.textSub,lineHeight:1.7,marginBottom:28}}>
            Your 14-day free trial of SkyShield Pro has expired. Choose a plan below to keep access to your leads, inspections, and all your data — no data is lost.
          </div>
          {/* Plan options */}
          <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:10,marginBottom:24}}>
            {[{name:"Starter",price:297},{name:"Pro",price:497},{name:"Elite",price:997}].map(p=>(
              <div key={p.name} style={{...card({padding:"16px 12px",textAlign:"center"}),border:`1px solid ${p.name==="Pro"?C.orange+"66":C.border}`,position:"relative"}}>
                {p.name==="Pro"&&<div style={{position:"absolute",top:-10,left:"50%",transform:"translateX(-50%)",background:C.orange,color:"#000",fontSize:9,fontWeight:700,padding:"2px 10px",borderRadius:10,textTransform:"uppercase",whiteSpace:"nowrap"}}>Most Popular</div>}
                <div style={{fontSize:13,fontWeight:700,color:C.text,marginBottom:4}}>{p.name}</div>
                <div style={{fontSize:22,fontWeight:800,color:C.orange,lineHeight:1}}>${p.price}</div>
                <div style={{fontSize:10,color:C.textSub,marginBottom:12}}>/month</div>
                <Btn variant={p.name==="Pro"?"primary":"default"} small onClick={async()=>{
                  const result=await billingCall("/stripe/create-subscription",{rooferId:live.id,name:live.name,email:live.email,plan:p.name});
                  if(result.paymentLink) window.open(result.paymentLink,"_blank");
                  else alert("Error generating payment link. Please contact support.");
                }}>Choose {p.name}</Btn>
              </div>
            ))}
          </div>
          <div style={{fontSize:11,color:C.textMuted,marginBottom:16}}>No contracts · Cancel anytime · Your data is safe</div>
          <Btn variant="ghost" small onClick={handleSignOut}>Sign Out</Btn>
        </div>
      </div>;
    }

    // Show trial banner if active and expiring soon (5 days or less)
    const daysLeft=trialDaysRemaining(live);
    const showTrialBanner=live.status==="trial"&&daysLeft<=5&&daysLeft>0;

    return <div style={{minHeight:"100vh",background:C.bg,backgroundImage:"radial-gradient(ellipse at 0% 0%,rgba(13,148,136,0.13) 0%,transparent 45%),radial-gradient(ellipse at 100% 100%,rgba(2,132,199,0.09) 0%,transparent 40%)"}}><FontLoader/>
      {showWhatsNew&&<WhatsNewModal onDismiss={dismissWhatsNew}/>}
      {showTrialBanner&&<div style={{background:`linear-gradient(90deg,${C.amber}22,${C.amber}11)`,borderBottom:`1px solid ${C.amber}44`,padding:"8px 20px",display:"flex",alignItems:"center",justifyContent:"space-between",gap:12}}>
        <div style={{fontSize:12,color:C.amber,fontWeight:500}}>Your free trial expires in <strong>{daysLeft} day{daysLeft===1?"":"s"}</strong>. Upgrade now to keep access to all your data and leads.</div>
        <Btn small variant="warning" onClick={async()=>{
          const result=await billingCall("/stripe/create-subscription",{rooferId:live.id,name:live.name,email:live.email,plan:live.plan||"Starter"});
          if(result.paymentLink) window.open(result.paymentLink,"_blank");
        }}>Upgrade Now</Btn>
      </div>}
      <nav style={{position:"sticky",top:0,zIndex:100,background:C.surface,borderBottom:`1px solid ${C.border}`,padding:"0 20px"}}>
        <div style={{maxWidth:1300,margin:"0 auto",...flex(0,"center","space-between"),height:54}}>
          <div style={flex(10)}>
            <div style={{width:30,height:30,borderRadius:8,background:`linear-gradient(135deg,#0d9488,#0284c7)`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:14}}>⛈</div>
            <div><div style={T.head(14,700)}>Sky<span style={{color:C.orange}}>Shield</span> Pro</div><div style={{fontSize:9,color:C.textMuted,textTransform:"uppercase",letterSpacing:"0.08em"}}>Ark Dynamics</div></div>
          </div>
          <div style={flex(10)}><span style={{fontSize:13,color:C.textSub,fontWeight:500}}>{live.name}</span><Badge label={live.plan} color={PLAN_COLORS[live.plan]} small/><NotificationBell roofer={live} onMarkRead={()=>handleUpdate("mark_notifications_read",{rooferId:live.id})}/><Btn small variant="ghost" onClick={handleSignOut}>Sign Out</Btn></div>
        </div>
      </nav>
      <main style={{maxWidth:1300,margin:"0 auto",padding:"24px 20px"}}>
        <div style={{marginBottom:20}}><div style={T.head(22,700)}>{live.name}</div><div style={{...flex(8),marginTop:8}}><Badge label={live.plan} color={PLAN_COLORS[live.plan]}/><StatusBadge status={live.status}/></div></div>
        <RooferDashboard roofer={live} leads={leads} apiKeys={apiKeys} onUpdate={handleUpdate} addActivity={addActivity}/>
      </main>
      <FloatingAIHelp role="roofer" roofer={live} leads={leads.filter(l=>l.rooferId===live.id)} storms={[]} currentSection="Roofer Dashboard"/>
    </div>;
  }

  // ── ADMIN VIEW ─────────────────────────────────────────────────────────────
  return <div style={{minHeight:"100vh",background:C.bg,backgroundImage:"radial-gradient(ellipse at 0% 0%,rgba(13,148,136,0.13) 0%,transparent 45%),radial-gradient(ellipse at 100% 100%,rgba(2,132,199,0.09) 0%,transparent 40%)"}}><FontLoader/>
      {showWhatsNew&&<WhatsNewModal onDismiss={dismissWhatsNew}/>}
    <nav style={{position:"sticky",top:0,zIndex:100,background:C.surface,borderBottom:`1px solid ${C.border}`,padding:"0 20px"}}>
      <div style={{maxWidth:1300,margin:"0 auto",...flex(0,"center","space-between"),height:54}}>

        {/* Logo */}
        <div style={flex(10)}>
          <div style={{width:32,height:32,borderRadius:8,background:"linear-gradient(135deg,#0d9488,#0284c7)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:16,flexShrink:0}}>⛈</div>
          <div>
            <div style={T.head(15,700)}>Sky<span style={{color:C.orange}}>Shield</span> Pro</div>
            <div style={{fontSize:9,color:C.textMuted,textTransform:"uppercase",letterSpacing:"0.08em",marginTop:1}}>Powered by Ark Dynamics</div>
          </div>
        </div>

        {/* Nav links */}
        <div style={flex(2)}>
          {navSections.map(sec=><button key={sec} onClick={()=>{setActiveSection(sec);setSelectedRoofer(null);}} style={navStyle(activeSection===sec&&!selectedRoofer)}>{sec}</button>)}
          {selectedRoofer&&<div style={flex(6)}>
            <span style={{color:C.textMuted,fontSize:12}}>›</span>
            <button onClick={()=>setSelectedRoofer(null)} style={{background:"none",border:"none",cursor:"pointer",color:C.textSub,fontSize:13}}>Command Center</button>
            <span style={{color:C.textMuted,fontSize:12}}>›</span>
            <span style={{fontSize:13,color:C.orange,fontWeight:600}}>{selectedRoofer.name}</span>
          </div>}
        </div>

        {/* Status + sign out */}
        <div style={flex(12)}>
          {dataLoadError&&<Badge label="⚠ Sync error" color={C.red} small/>}
          <div style={{...flex(5),fontSize:12,color:C.textMuted}}><span style={{color:C.green,fontSize:8}}>●</span>{roofers.filter(r=>r.status==="active").length} active</div>
          <div style={{...flex(5),fontSize:12,color:C.textMuted}}><span style={{color:C.orange,fontSize:8}}>●</span>{leads.filter(l=>l.status==="pending").length} pending</div>
          {scanSettings.interval!=="manual"&&<div style={{...flex(5),fontSize:12,color:C.textMuted}}><span style={{color:C.blue,fontSize:8}}>●</span>auto-scan</div>}
          <Btn small variant="ghost" onClick={handleSignOut}>Sign Out</Btn>
        </div>
      </div>
    </nav>

    <main style={{maxWidth:1300,margin:"0 auto",padding:"24px 20px"}}>
      <div style={{marginBottom:22}}>
        <div style={T.head(22,700)}>{selectedRoofer?selectedRoofer.name:activeSection}</div>
        {selectedRoofer&&<div style={{...flex(8),marginTop:8}}>
          <Badge label={selectedRoofer.plan} color={PLAN_COLORS[selectedRoofer.plan]}/>
          <StatusBadge status={selectedRoofer.status}/>
          <span style={{fontSize:12,color:C.textMuted}}>{selectedRoofer.owner} · {selectedRoofer.email}</span>
        </div>}
      </div>

      {selectedRoofer
        ?<RooferDashboard roofer={roofers.find(r=>r.id===selectedRoofer.id)||selectedRoofer} leads={leads} apiKeys={apiKeys} onUpdate={handleUpdate} addActivity={addActivity}/>
        :activeSection==="Command Center"
          ?<CommandCenter roofers={roofers} leads={leads} storms={storms} apiKeys={apiKeys} onUpdate={handleUpdate} onSelectRoofer={selectRoofer} scanSettings={scanSettings} onScanSettingsChange={setScanSettings} activities={activities} addActivity={addActivity} zipTerritories={zipTerritories}/>
          :activeSection==="Subscriptions & Billing"
            ?<Subscriptions roofers={roofers} seats={seats} zipTerritories={zipTerritories} onUpdate={handleUpdate}/>
            :<APISettings apiKeys={apiKeys} onUpdate={handleUpdate}/>
      }
    </main>
    <FloatingAIHelp role="admin" roofers={roofers} leads={leads} storms={storms} currentSection={activeSection}/>
  </div>;
}
