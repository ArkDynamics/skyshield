// api/stripe/create-subscription.js
// Called when admin activates a roofer — creates Stripe customer + subscription
// and returns a payment link for the roofer to enter their card.

const { stripe, PRICE_IDS, sbPatch, checkAuth, setCors } = require("../_lib");

module.exports = async function handler(req, res) {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!checkAuth(req, res)) return;

  const { rooferId, name, email, plan } = req.body;
  if (!rooferId || !email || !plan) {
    return res.status(400).json({ error: "rooferId, email, and plan are required" });
  }

  const priceId = PRICE_IDS[plan];
  if (!priceId) {
    return res.status(400).json({ error: `No Stripe price ID configured for plan: ${plan}. Add STRIPE_PRICE_${plan.toUpperCase()} to your Vercel env vars.` });
  }

  try {
    // Create or reuse Stripe customer
    let customer;
    const existing = await stripe.customers.list({ email, limit: 1 });
    if (existing.data.length > 0) {
      customer = existing.data[0];
    } else {
      customer = await stripe.customers.create({ name, email, metadata: { rooferId } });
    }

    // Create subscription — starts incomplete until card is provided
    const subscription = await stripe.subscriptions.create({
      customer: customer.id,
      items: [{ price: priceId }],
      payment_behavior: "default_incomplete",
      payment_settings: { save_default_payment_method: "on_subscription" },
      metadata: { rooferId, plan },
    });

    // Create a hosted payment link so the roofer can enter their card
    const paymentLink = await stripe.paymentLinks.create({
      line_items: [{ price: priceId, quantity: 1 }],
      metadata: { rooferId, plan },
      after_completion: {
        type: "redirect",
        redirect: {
          url: `${process.env.FRONTEND_URL || "https://your-app.vercel.app"}?payment=success`,
        },
      },
    });

    // Save Stripe IDs to Supabase
    await sbPatch("roofers", `id=eq.${rooferId}`, {
      stripe_customer_id: customer.id,
      stripe_subscription_id: subscription.id,
      stripe_status: "incomplete",
    });

    return res.json({
      success: true,
      customerId: customer.id,
      subscriptionId: subscription.id,
      paymentLink: paymentLink.url,
    });

  } catch (err) {
    console.error("create-subscription error:", err);
    return res.status(500).json({ error: err.message });
  }
};
