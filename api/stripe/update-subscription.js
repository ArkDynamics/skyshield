// api/stripe/update-subscription.js
// Called when admin changes a roofer's plan — updates the Stripe subscription
// and applies prorated charges automatically.

const { stripe, PRICE_IDS, sbGet, sbPatch, checkAuth, setCors } = require("../_lib");

module.exports = async function handler(req, res) {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!checkAuth(req, res)) return;

  const { rooferId, newPlan } = req.body;
  if (!rooferId || !newPlan) {
    return res.status(400).json({ error: "rooferId and newPlan are required" });
  }

  const priceId = PRICE_IDS[newPlan];
  if (!priceId) {
    return res.status(400).json({ error: `No Stripe price ID for plan: ${newPlan}` });
  }

  try {
    const rows = await sbGet("roofers", `id=eq.${rooferId}`);
    const roofer = rows[0];
    if (!roofer?.stripe_subscription_id) {
      return res.status(400).json({ error: "No Stripe subscription found for this roofer" });
    }

    const subscription = await stripe.subscriptions.retrieve(roofer.stripe_subscription_id);
    const itemId = subscription.items.data[0].id;

    await stripe.subscriptions.update(roofer.stripe_subscription_id, {
      items: [{ id: itemId, price: priceId }],
      proration_behavior: "create_prorations",
      metadata: { plan: newPlan },
    });

    await sbPatch("roofers", `id=eq.${rooferId}`, { plan: newPlan });

    return res.json({ success: true });

  } catch (err) {
    console.error("update-subscription error:", err);
    return res.status(500).json({ error: err.message });
  }
};
