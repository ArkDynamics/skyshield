// api/_lib.js — shared helpers for all Vercel API functions
// Uses native fetch (Node 18+) and native Stripe SDK

const Stripe = require("stripe");
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

const PRICE_IDS = {
  Starter: process.env.STRIPE_PRICE_STARTER,
  Pro:     process.env.STRIPE_PRICE_PRO,
  Elite:   process.env.STRIPE_PRICE_ELITE,
};

async function sbGet(table, filter) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${filter}&select=*`, {
    headers: {
      "apikey": SUPABASE_SERVICE_KEY,
      "Authorization": `Bearer ${SUPABASE_SERVICE_KEY}`,
    },
  });
  return res.json();
}

async function sbPatch(table, filter, data) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${filter}`, {
    method: "PATCH",
    headers: {
      "apikey": SUPABASE_SERVICE_KEY,
      "Authorization": `Bearer ${SUPABASE_SERVICE_KEY}`,
      "Content-Type": "application/json",
      "Prefer": "return=representation",
    },
    body: JSON.stringify({ ...data, updated_at: new Date().toISOString() }),
  });
  return res.json();
}

function checkAuth(req, res) {
  if (req.headers["x-skyshield-key"] !== process.env.SKYSHIELD_API_KEY) {
    res.status(401).json({ error: "Unauthorized" });
    return false;
  }
  return true;
}

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", process.env.FRONTEND_URL || "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-skyshield-key");
}

module.exports = { stripe, PRICE_IDS, sbGet, sbPatch, checkAuth, setCors };
