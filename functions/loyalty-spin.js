/**
 * loyalty-spin.js
 *
 * Handles the PrimalPoints "Crack the Code" spin-to-win game.
 *
 * GET  /.netlify/functions/loyalty-spin?token=XXX
 *   → { valid, already_spun, points_won? }
 *
 * POST /.netlify/functions/loyalty-spin
 *   Body: { token, action: 'spin' }
 *   → { points_won, new_balance }
 *
 *   Body: { token, action: 'share', friend_emails: ['a@b.com', ...] }
 *   → { sent: number }
 *
 * Env vars required:
 *   SUPABASE_URL, SUPABASE_SERVICE_KEY
 *   (Gmail vars for share invites via send-quiz-email.js)
 */

const { sendEmail } = require('./send-quiz-email');

const HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

// Points tiers — wheel segments. Weights determine probability.
const SPIN_TIERS = [
  { points: 250,  weight: 35 },
  { points: 500,  weight: 30 },
  { points: 750,  weight: 20 },
  { points: 1000, weight: 10 },
  { points: 1500, weight: 4  },
  { points: 2500, weight: 1  },
];

function pickPoints() {
  const total = SPIN_TIERS.reduce((s, t) => s + t.weight, 0);
  let r = Math.random() * total;
  for (const tier of SPIN_TIERS) {
    r -= tier.weight;
    if (r <= 0) return tier.points;
  }
  return SPIN_TIERS[0].points;
}

function reply(code, body) {
  return { statusCode: code, headers: HEADERS, body: JSON.stringify(body) };
}

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

async function getBalance(email) {
  const now = new Date().toISOString();
  const res = await sbFetch(`/rest/v1/loyalty_points?email=eq.${encodeURIComponent(email)}&select=points,expires_at`);
  const rows = await res.json();
  if (!Array.isArray(rows)) return 0;
  return rows.reduce((sum, r) => {
    if (r.expires_at === null || r.expires_at > now) return sum + r.points;
    return sum;
  }, 0);
}

async function getSpinRow(token) {
  const res = await sbFetch(`/rest/v1/loyalty_spins?token=eq.${encodeURIComponent(token)}&select=*`);
  const rows = await res.json();
  return Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
}

function spinInviteEmailHtml({ spinUrl, fromEmail }) {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f5f0e8;font-family:'DM Sans',Helvetica,Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px;">
<tr><td align="center">
<table width="100%" style="max-width:520px;background:#1a1008;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.18);">

  <!-- Header -->
  <tr><td style="padding:40px 32px 32px;text-align:center;">
    <!-- Roulette wheel SVG -->
    <div style="width:80px;height:80px;border-radius:50%;background:linear-gradient(135deg,#C8A87A 0%,#D4A84B 50%,#C8A87A 100%);margin:0 auto 20px;display:flex;align-items:center;justify-content:center;font-size:2rem;">🎡</div>
    <p style="margin:0 0 6px;font-size:0.7rem;font-weight:800;text-transform:uppercase;letter-spacing:0.18em;color:rgba(200,168,122,0.7);">PrimalPoints</p>
    <h1 style="margin:0;font-size:2rem;font-weight:800;color:#fff;line-height:1.2;">Crack the Code</h1>
    <p style="margin:12px 0 0;font-size:1rem;color:rgba(255,255,255,0.75);line-height:1.6;">Spin the wheel — win up to 2,500 PrimalPoints instantly</p>
  </td></tr>

  <!-- Body -->
  <tr><td style="padding:0 32px 32px;">
    <div style="background:rgba(255,255,255,0.06);border-radius:12px;padding:20px;margin-bottom:24px;text-align:center;">
      <p style="margin:0 0 8px;font-size:0.82rem;color:rgba(200,168,122,0.8);text-transform:uppercase;letter-spacing:0.1em;font-weight:700;">Possible prizes</p>
      <p style="margin:0;font-size:1.5rem;font-weight:800;color:#C8A87A;letter-spacing:0.05em;">250 · 500 · 750 · 1,000 · 1,500 · 2,500</p>
      <p style="margin:6px 0 0;font-size:0.78rem;color:rgba(255,255,255,0.45);">PrimalPoints = real $ off your next order</p>
    </div>

    ${fromEmail ? `<p style="margin:0 0 20px;font-size:0.88rem;color:rgba(255,255,255,0.65);text-align:center;line-height:1.6;">Your friend <strong style="color:rgba(200,168,122,0.9);">${fromEmail}</strong> thought you'd love this.</p>` : ''}

    <div style="text-align:center;">
      <a href="${spinUrl}" style="display:inline-block;background:linear-gradient(135deg,#C8A87A 0%,#D4A84B 100%);color:#1a1008;padding:16px 36px;border-radius:100px;font-weight:800;font-size:1rem;text-decoration:none;letter-spacing:0.02em;">
        🎡 Spin Now — it's free
      </a>
    </div>
    <p style="margin:16px 0 0;font-size:0.72rem;color:rgba(255,255,255,0.35);text-align:center;line-height:1.6;">One spin per link · Points credited to your account instantly · Valid 30 days</p>
  </td></tr>

  <!-- Footer -->
  <tr><td style="padding:20px 32px;border-top:1px solid rgba(255,255,255,0.08);text-align:center;">
    <p style="margin:0;font-size:0.72rem;color:rgba(255,255,255,0.3);">PrimalPantry · New Zealand</p>
  </td></tr>

</table>
</td></tr>
</table>
</body></html>`;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return reply(204, '');

  // ── GET: validate token ──────────────────────────────────────────────────
  if (event.httpMethod === 'GET') {
    const token = event.queryStringParameters?.token;
    if (!token) return reply(400, { error: 'token required' });

    const row = await getSpinRow(token);
    if (!row) return reply(404, { error: 'Invalid or expired spin link' });

    return reply(200, {
      valid: true,
      already_spun: !!row.spun_at,
      points_won: row.points_won || null,
      email: row.email || null,
    });
  }

  if (event.httpMethod !== 'POST') return reply(405, { error: 'Method not allowed' });

  try {
    const { token, action, friend_emails } = JSON.parse(event.body || '{}');
    if (!token) return reply(400, { error: 'token required' });

    const row = await getSpinRow(token);
    if (!row) return reply(404, { error: 'Invalid or expired spin link' });

    // ── action: spin ─────────────────────────────────────────────────────
    if (action === 'spin' || !action) {
      if (row.spun_at) {
        return reply(409, { error: 'Already spun', points_won: row.points_won });
      }

      const pointsWon = pickPoints();
      const now = new Date().toISOString();
      const expiresAt = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString();

      // Record the spin
      await sbFetch(`/rest/v1/loyalty_spins?id=eq.${row.id}`, {
        method: 'PATCH',
        prefer: 'return=minimal',
        body: {
          points_won: pointsWon,
          spun_at: now,
        },
      });

      // Award points (if email is known)
      if (row.email) {
        await sbFetch('/rest/v1/loyalty_points', {
          method: 'POST',
          prefer: 'return=minimal',
          body: {
            email: row.email.toLowerCase(),
            points: pointsWon,
            type: 'spin',
            description: `Spin to win — ${pointsWon.toLocaleString()} pts`,
            expires_at: expiresAt,
          },
        });

        const newBalance = await getBalance(row.email.toLowerCase());
        console.log(`[loyalty-spin] ${row.email} spun → ${pointsWon}pts | balance: ${newBalance}`);
        return reply(200, { points_won: pointsWon, new_balance: Math.max(0, newBalance) });
      }

      console.log(`[loyalty-spin] Anonymous spin → ${pointsWon}pts (no email on token)`);
      return reply(200, { points_won: pointsWon, new_balance: null });
    }

    // ── action: share ─────────────────────────────────────────────────────
    if (action === 'share') {
      if (!Array.isArray(friend_emails) || friend_emails.length === 0) {
        return reply(400, { error: 'friend_emails array required' });
      }

      const fromEmail = row.email;
      let sent = 0;

      for (const fe of friend_emails.slice(0, 5)) {
        const friendEmail = fe.trim().toLowerCase();
        if (!friendEmail.match(/.+@.+\..+/)) continue;

        // Create a unique spin token for this friend
        const friendToken = Math.random().toString(36).slice(2) + Date.now().toString(36);
        const spinUrl = `https://www.primalpantry.co.nz/primalpoints/spin/?t=${friendToken}`;

        try {
          // Insert spin row for friend
          await sbFetch('/rest/v1/loyalty_spins', {
            method: 'POST',
            prefer: 'return=minimal',
            body: {
              email: friendEmail,
              token: friendToken,
            },
          });

          // Send invite email
          await sendEmail({
            to: friendEmail,
            subject: `${fromEmail ? fromEmail.split('@')[0] : 'A friend'} sent you a free spin 🎡`,
            html: spinInviteEmailHtml({ spinUrl, fromEmail }),
          });

          sent++;
        } catch (err) {
          console.warn(`[loyalty-spin] Failed to send invite to ${friendEmail}:`, err.message);
        }
      }

      // Record friends shared on the spin row
      await sbFetch(`/rest/v1/loyalty_spins?id=eq.${row.id}`, {
        method: 'PATCH',
        prefer: 'return=minimal',
        body: {
          friends_shared: friend_emails.slice(0, 5).map(e => e.trim().toLowerCase()),
        },
      });

      console.log(`[loyalty-spin] ${fromEmail} shared with ${sent} friends`);
      return reply(200, { sent });
    }

    return reply(400, { error: 'Unknown action' });
  } catch (err) {
    console.error('[loyalty-spin] Error:', err.message);
    return reply(500, { error: 'Internal error' });
  }
};
