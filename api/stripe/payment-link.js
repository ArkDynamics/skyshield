// api/stripe/payment-link.js
// Returns a fresh Stripe payment link — used when a roofer's payment failed
// and the admin wants to resend them a link to update their card.

const { stripe, PRICE_IDS, checkAuth, setCors } = require("../_lib");

module.exports = async function handler(req, res) {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!checkAuth(req, res)) return;

  const { rooferId, plan } = req.body;
  if (!rooferId || !plan) return res.status(400).json({ error: "rooferId and plan are required" });

  const priceId = PRICE_IDS[plan];
  if (!priceId) return res.status(400).json({ error: `No price ID for plan: ${plan}` });

  try {
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
    return res.json({ url: paymentLink.url });
  } catch (err) {
    console.error("payment-link error:", err);
    return res.status(500).json({ error: err.message });
  }
};
