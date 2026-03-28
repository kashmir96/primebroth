/**
 * loyalty-earn.js
 *
 * Awards PrimalPoints to a customer after a successful purchase.
 * Called internally from checkout-completed.js — not a public endpoint.
 *
 * Also handles:
 *  - Double points (global or per-SKU)
 *  - Sending post-purchase points email
 *
 * Env vars required:
 *   SUPABASE_URL          — Supabase project URL
 *   SUPABASE_SERVICE_KEY  — Supabase service_role key
 *   (Gmail env vars via send-quiz-email.js for email sending)
 */

const { sendEmail } = require('./send-quiz-email');

const HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

function sbFetch(path, opts = {}) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  return fetch(`${url}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      apikey: key,
      Authorization: `Bearer ${key}`,
      ...(opts.prefer ? { Prefer: opts.prefer } : {}),
    },
    method: opts.method || 'GET',
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
}

async function getSettings() {
  const res = await sbFetch('/rest/v1/loyalty_settings?id=eq.1&select=*');
  const rows = await res.json();
  return rows && rows[0] ? rows[0] : {
    points_per_dollar: 100,
    points_to_dollar_rate: 100,
    min_redemption_points: 500,
    double_points_active: false,
    double_points_sku: null,
    double_points_until: null,
  };
}

async function getBalance(email) {
  const now = new Date().toISOString();
  const res = await sbFetch(
    `/rest/v1/loyalty_points?email=eq.${encodeURIComponent(email.toLowerCase())}&select=points,expires_at`
  );
  const rows = await res.json();
  if (!Array.isArray(rows)) return 0;
  return rows.reduce((sum, r) => {
    // Count point if it hasn't expired (expires_at null = never expires for negative/redeem rows)
    if (r.expires_at === null || r.expires_at > now) return sum + r.points;
    return sum;
  }, 0);
}

function purchaseEmailHtml({ email, pointsEarned, newBalance, orderTotal, expiryDate }) {
  const expiry = new Date(expiryDate).toLocaleDateString('en-NZ', { day: 'numeric', month: 'long', year: 'numeric' });
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f5f0e8;font-family:'DM Sans',Helvetica,Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px;">
<tr><td align="center">
<table width="100%" style="max-width:520px;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">

  <!-- Header -->
  <tr><td style="background:linear-gradient(135deg,#3D5230 0%,#4E6840 100%);padding:32px;text-align:center;">
    <p style="margin:0 0 6px;font-size:0.7rem;font-weight:800;text-transform:uppercase;letter-spacing:0.18em;color:rgba(255,255,255,0.65);">PrimalPoints</p>
    <h1 style="margin:0;font-size:2.2rem;font-weight:800;color:#fff;">+${pointsEarned.toLocaleString()}</h1>
    <p style="margin:8px 0 0;font-size:0.9rem;color:rgba(255,255,255,0.8);">points just landed in your account</p>
  </td></tr>

  <!-- Body -->
  <tr><td style="padding:32px;">
    <p style="margin:0 0 20px;font-size:0.95rem;color:#2E1A0E;line-height:1.6;">
      Thanks for your order — you just earned <strong>${pointsEarned.toLocaleString()} PrimalPoints</strong> on your $${orderTotal.toFixed(2)} purchase.
    </p>

    <!-- Balance card -->
    <div style="background:#f5f0e8;border-radius:12px;padding:20px;text-align:center;margin-bottom:24px;">
      <p style="margin:0 0 4px;font-size:0.72rem;font-weight:700;text-transform:uppercase;letter-spacing:0.12em;color:#877B71;">Your total balance</p>
      <p style="margin:0;font-size:2rem;font-weight:800;color:#3D5230;">${newBalance.toLocaleString()} pts</p>
      <p style="margin:6px 0 0;font-size:0.72rem;color:#877B71;">Points expire ${expiry}</p>
    </div>

    <p style="margin:0 0 8px;font-size:0.85rem;color:#877B71;line-height:1.6;">
      PrimalPoints can be redeemed for dollars off your next order.
      ${newBalance >= 500 ? `<strong style="color:#3D5230;">You have enough to redeem right now!</strong>` : `Keep earning — you're ${(500 - newBalance).toLocaleString()} pts away from your first redemption.`}
    </p>

    <p style="margin:16px 0 0;font-size:0.78rem;color:#C8A87A;">
      ⭐ <strong>What are PrimalPoints?</strong> Earn points on every purchase and redeem them for dollars off future orders. 100 points = $1.
    </p>
  </td></tr>

  <!-- Footer -->
  <tr><td style="padding:20px 32px;border-top:1px solid #ede5d8;text-align:center;">
    <p style="margin:0;font-size:0.72rem;color:#9c9287;">PrimalPantry · New Zealand</p>
    <p style="margin:4px 0 0;font-size:0.68rem;color:#c4b9ae;">Points expire 60 days from the date they were earned.</p>
  </td></tr>

</table>
</td></tr>
</table>
</body></html>`;
}

/**
 * Main export — called directly (not as HTTP handler) from checkout-completed.js
 */
async function awardLoyaltyPoints({ email, totalValue, lineItems, orderId }) {
  try {
    if (!email || !totalValue) return;
    const emailLower = email.toLowerCase();

    const settings = await getSettings();

    // Calculate points — check for double points
    let multiplier = 1;
    if (settings.double_points_active) {
      const now = new Date();
      const until = settings.double_points_until ? new Date(settings.double_points_until) : null;
      const expired = until && now > until;
      if (!expired) {
        if (!settings.double_points_sku) {
          multiplier = 2; // global double points
        } else {
          // Check if any line item matches the SKU
          const hasMatchingSku = (lineItems || []).some(li => {
            const sku = li.price?.product?.metadata?.sku || li.price?.product?.name || '';
            return sku.toLowerCase().includes(settings.double_points_sku.toLowerCase());
          });
          if (hasMatchingSku) multiplier = 2;
        }
      }
    }

    const pointsEarned = Math.round(totalValue * settings.points_per_dollar * multiplier);
    const expiresAt = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString(); // 60 days

    // Insert points row
    await sbFetch('/rest/v1/loyalty_points', {
      method: 'POST',
      prefer: 'return=minimal',
      body: {
        email: emailLower,
        points: pointsEarned,
        type: 'purchase',
        order_id: orderId || null,
        description: multiplier > 1
          ? `${multiplier}× double points on $${totalValue.toFixed(2)} order`
          : `Purchase — $${totalValue.toFixed(2)} order`,
        expires_at: expiresAt,
      },
    });

    console.log(`[loyalty-earn] Awarded ${pointsEarned} pts to ${emailLower} (×${multiplier})`);

    // Send email
    const newBalance = await getBalance(emailLower);
    await sendEmail({
      to: email,
      subject: `You earned ${pointsEarned.toLocaleString()} PrimalPoints 🌿`,
      html: purchaseEmailHtml({
        email,
        pointsEarned,
        newBalance,
        orderTotal: totalValue,
        expiryDate: expiresAt,
      }),
    });
  } catch (err) {
    console.error('[loyalty-earn] Error:', err.message);
  }
}

// HTTP handler (for direct calls / testing)
exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: HEADERS, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: HEADERS, body: JSON.stringify({ error: 'Method not allowed' }) };
  try {
    const { email, totalValue, lineItems, orderId } = JSON.parse(event.body || '{}');
    await awardLoyaltyPoints({ email, totalValue, lineItems, orderId });
    return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ ok: true }) };
  } catch (err) {
    return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ error: err.message }) };
  }
};

exports.awardLoyaltyPoints = awardLoyaltyPoints;
