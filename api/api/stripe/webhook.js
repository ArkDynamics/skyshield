// api/stripe/webhook.js
// Stripe sends payment events here. This is the source of truth for
// subscription status — updates Supabase directly whenever something changes.
//
// IMPORTANT: In Vercel dashboard, set this route to NOT parse the body.
// Go to vercel.json and add the rawBody config (see vercel.json in this project).

const { stripe, sbPatch } = require("../_lib");

// Vercel needs raw body for Stripe signature verification
export const config = {
  api: { bodyParser: false },
};

async function getRawBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", chunk => { data += chunk; });
    req.on("end", () => resolve(Buffer.from(data)));
    req.on("error", reject);
  });
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const rawBody = await getRawBody(req);
  const sig = req.headers["stripe-signature"];

  let event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error("Webhook signature failed:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  const data = event.data.object;
  console.log(`Stripe event: ${event.type}`);

  try {
    switch (event.type) {

      // ── Payment succeeded → activate the roofer ────────────────────────────
      case "invoice.payment_succeeded": {
        if (!data.subscription) break;
        const sub = await stripe.subscriptions.retrieve(data.subscription);
        const rooferId = sub.metadata?.rooferId;
        if (rooferId) {
          await sbPatch("roofers", `id=eq.${rooferId}`, {
            status: "active",
            stripe_status: "active",
          });
          console.log(`✓ Activated roofer ${rooferId}`);
        }
        break;
      }

      // ── Payment failed → suspend the roofer ────────────────────────────────
      case "invoice.payment_failed": {
        if (!data.subscription) break;
        const sub = await stripe.subscriptions.retrieve(data.subscription);
        const rooferId = sub.metadata?.rooferId;
        if (rooferId) {
          await sbPatch("roofers", `id=eq.${rooferId}`, {
            status: "past_due",
            stripe_status: "past_due",
          });
          console.log(`✗ Suspended roofer ${rooferId} — payment failed`);
        }
        break;
      }

      // ── Subscription cancelled → deactivate ────────────────────────────────
      case "customer.subscription.deleted": {
        const rooferId = data.metadata?.rooferId;
        if (rooferId) {
          await sbPatch("roofers", `id=eq.${rooferId}`, {
            status: "cancelled",
            stripe_status: "cancelled",
          });
          console.log(`✗ Cancelled roofer ${rooferId}`);
        }
        break;
      }

      // ── Subscription updated (plan change, reactivation, etc.) ─────────────
      case "customer.subscription.updated": {
        const rooferId = data.metadata?.rooferId;
        if (rooferId) {
          await sbPatch("roofers", `id=eq.${rooferId}`, {
            stripe_status: data.status,
          });
        }
        break;
      }

      default:
        break;
    }
  } catch (err) {
    // Log but still return 200 — Stripe will retry on non-200 responses
    console.error("Webhook handler error:", err);
  }

  return res.json({ received: true });
};
