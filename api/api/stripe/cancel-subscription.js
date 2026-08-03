// api/stripe/cancel-subscription.js
// Called when admin cancels a roofer — cancels at period end so they
// keep access until the billing cycle finishes, then access stops.

const { stripe, sbGet, sbPatch, checkAuth, setCors } = require("../_lib");

module.exports = async function handler(req, res) {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!checkAuth(req, res)) return;

  const { rooferId } = req.body;
  if (!rooferId) return res.status(400).json({ error: "rooferId is required" });

  try {
    const rows = await sbGet("roofers", `id=eq.${rooferId}`);
    const roofer = rows[0];
    if (!roofer?.stripe_subscription_id) {
      return res.status(400).json({ error: "No Stripe subscription found" });
    }

    // cancel_at_period_end: true means they keep access until the billing period ends
    await stripe.subscriptions.update(roofer.stripe_subscription_id, {
      cancel_at_period_end: true,
    });

    await sbPatch("roofers", `id=eq.${rooferId}`, {
      stripe_status: "canceling",
      status: "canceling",
    });

    return res.json({ success: true });

  } catch (err) {
    console.error("cancel-subscription error:", err);
    return res.status(500).json({ error: err.message });
  }
};
