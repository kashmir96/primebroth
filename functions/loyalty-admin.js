/**
 * loyalty-admin.js
 *
 * Staff-only endpoint for managing the PrimalPoints loyalty program.
 * Authenticated via the OSO_STAFF_TOKEN env var (same token as other
 * dashboard endpoints).
 *
 * GET  /.netlify/functions/loyalty-admin?action=balance&email=x@y.com
 * GET  /.netlify/functions/loyalty-admin?action=leaderboard&limit=20
 * GET  /.netlify/functions/loyalty-admin?action=stats
 * GET  /.netlify/functions/loyalty-admin?action=log&limit=50&offset=0&type=purchase
 *
 * POST /.netlify/functions/loyalty-admin
 *   { action: 'award_bonus', email, points, description }
 *   { action: 'award_bonus_bulk', emails: [], points, description }
 *   { action: 'send_spin_invite', emails: [] }
 *   { action: 'send_balance_email', emails: [] }
 *   { action: 'update_settings', settings: { points_per_dollar, points_to_dollar_rate, min_redemption_points, double_points_active, double_points_sku, double_points_until } }
 *   { action: 'expire_points' }  — mark all expired rows (runs sweep)
 *
 * Env vars required:
 *   SUPABASE_URL, SUPABASE_SERVICE_KEY, OSO_STAFF_TOKEN
 *   (Gmail vars via send-quiz-email.js for email sending)
 */

const { sendEmail } = require('./send-quiz-email');

const HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type': 'application/json',
};

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

async function validateToken(token) {
  if (!token) return null;
  const res = await sbFetch(`/rest/v1/staff?session_token=eq.${encodeURIComponent(token)}&select=id,role&limit=1`);
  const rows = await res.json();
  return Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
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

function spinInviteHtml({ spinUrl }) {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f5f0e8;font-family:'DM Sans',Helvetica,Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px;">
<tr><td align="center">
<table width="100%" style="max-width:520px;background:#1a1008;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.18);">
  <tr><td style="padding:40px 32px 32px;text-align:center;">
    <div style="font-size:2.5rem;margin-bottom:16px;">🎡</div>
    <p style="margin:0 0 6px;font-size:0.7rem;font-weight:800;text-transform:uppercase;letter-spacing:0.18em;color:rgba(200,168,122,0.7);">PrimalPoints</p>
    <h1 style="margin:0;font-size:2rem;font-weight:800;color:#fff;line-height:1.2;">Crack the Code</h1>
    <p style="margin:12px 0 0;font-size:1rem;color:rgba(255,255,255,0.7);line-height:1.6;">You have a free spin waiting — win up to 2,500 PrimalPoints instantly.</p>
  </td></tr>
  <tr><td style="padding:0 32px 36px;text-align:center;">
    <div style="background:rgba(255,255,255,0.06);border-radius:12px;padding:16px;margin-bottom:24px;">
      <p style="margin:0 0 6px;font-size:0.75rem;color:rgba(200,168,122,0.7);text-transform:uppercase;letter-spacing:0.1em;font-weight:700;">Win one of these</p>
      <p style="margin:0;font-size:1.3rem;font-weight:800;color:#C8A87A;">250 · 500 · 750 · 1,000 · 1,500 · 2,500</p>
      <p style="margin:4px 0 0;font-size:0.75rem;color:rgba(255,255,255,0.4);">100 pts = $1 off your next order</p>
    </div>
    <a href="${spinUrl}" style="display:inline-block;background:linear-gradient(135deg,#C8A87A 0%,#D4A84B 100%);color:#1a1008;padding:15px 36px;border-radius:100px;font-weight:800;font-size:1rem;text-decoration:none;">🎡 Spin Now</a>
    <p style="margin:14px 0 0;font-size:0.7rem;color:rgba(255,255,255,0.3);">One spin per link · Valid 30 days</p>
  </td></tr>
  <tr><td style="padding:18px 32px;border-top:1px solid rgba(255,255,255,0.07);text-align:center;">
    <p style="margin:0;font-size:0.7rem;color:rgba(255,255,255,0.25);">PrimalPantry · New Zealand</p>
  </td></tr>
</table>
</td></tr>
</table>
</body></html>`;
}

function balanceEmailHtml({ email, balance, expiryDate, minRedeem, redeemRate }) {
  const worth = Math.floor(balance / redeemRate);
  const expiry = expiryDate
    ? new Date(expiryDate).toLocaleDateString('en-NZ', { day: 'numeric', month: 'long', year: 'numeric' })
    : null;
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f5f0e8;font-family:'DM Sans',Helvetica,Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px;">
<tr><td align="center">
<table width="100%" style="max-width:520px;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
  <tr><td style="background:linear-gradient(135deg,#3D5230 0%,#4E6840 100%);padding:32px;text-align:center;">
    <p style="margin:0 0 6px;font-size:0.7rem;font-weight:800;text-transform:uppercase;letter-spacing:0.18em;color:rgba(255,255,255,0.65);">PrimalPoints</p>
    <h1 style="margin:0;font-size:2.2rem;font-weight:800;color:#fff;">${balance.toLocaleString()}</h1>
    <p style="margin:8px 0 0;font-size:0.9rem;color:rgba(255,255,255,0.8);">points in your account</p>
  </td></tr>
  <tr><td style="padding:32px;">
    <div style="background:#f5f0e8;border-radius:12px;padding:20px;text-align:center;margin-bottom:24px;">
      <p style="margin:0 0 4px;font-size:0.72rem;font-weight:700;text-transform:uppercase;letter-spacing:0.12em;color:#877B71;">Worth</p>
      <p style="margin:0;font-size:2rem;font-weight:800;color:#3D5230;">$${worth} off</p>
      ${expiry ? `<p style="margin:6px 0 0;font-size:0.72rem;color:#877B71;">Points expire ${expiry}</p>` : ''}
    </div>
    ${balance >= minRedeem
      ? `<p style="margin:0 0 20px;font-size:0.9rem;color:#2E1A0E;line-height:1.6;">You have enough points to redeem! Head to <a href="https://www.primalpantry.co.nz" style="color:#3D5230;">primalpantry.co.nz</a>, place your order and you'll be able to redeem your points at checkout.</p>`
      : `<p style="margin:0 0 20px;font-size:0.9rem;color:#2E1A0E;line-height:1.6;">You're ${(minRedeem - balance).toLocaleString()} points away from your first redemption. Keep shopping to earn more!</p>`
    }
    <p style="margin:0;font-size:0.78rem;color:#C8A87A;">⭐ <strong>How it works:</strong> Earn points on every purchase. 100 points = $1 off.</p>
  </td></tr>
  <tr><td style="padding:20px 32px;border-top:1px solid #ede5d8;text-align:center;">
    <p style="margin:0;font-size:0.72rem;color:#9c9287;">PrimalPantry · New Zealand</p>
  </td></tr>
</table>
</td></tr>
</table>
</body></html>`;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return reply(204, '');

  // Auth check — same session token pattern as dashboard-data.js
  const token = event.headers?.authorization?.replace('Bearer ', '') || event.queryStringParameters?.token;
  const staff = await validateToken(token);
  if (!staff) {
    return reply(401, { error: 'Unauthorized' });
  }

  try {
    // ── GET actions ──────────────────────────────────────────────────────
    if (event.httpMethod === 'GET') {
      const action = event.queryStringParameters?.action;

      // Balance lookup
      if (action === 'balance') {
        const email = event.queryStringParameters?.email;
        if (!email) return reply(400, { error: 'email required' });
        const now = new Date().toISOString();

        const [rowsRes, settingsRes] = await Promise.all([
          sbFetch(`/rest/v1/loyalty_points?email=eq.${encodeURIComponent(email.toLowerCase())}&select=*&order=created_at.desc`),
          sbFetch('/rest/v1/loyalty_settings?id=eq.1&select=*'),
        ]);
        const rows = await rowsRes.json();
        const settingsArr = await settingsRes.json();
        const settings = settingsArr?.[0] || { points_to_dollar_rate: 100, min_redemption_points: 500 };

        const balance = Array.isArray(rows) ? rows.reduce((sum, r) => {
          if (r.expires_at === null || r.expires_at > now) return sum + r.points;
          return sum;
        }, 0) : 0;

        return reply(200, { email, balance, transactions: rows || [], settings });
      }

      // Leaderboard
      if (action === 'leaderboard') {
        const limit = parseInt(event.queryStringParameters?.limit) || 20;
        const now = new Date().toISOString();
        const res = await sbFetch(`/rest/v1/loyalty_points?select=email,points,expires_at`);
        const rows = await res.json();

        if (!Array.isArray(rows)) return reply(200, { leaderboard: [] });

        const totals = {};
        rows.forEach(r => {
          if (!totals[r.email]) totals[r.email] = 0;
          if (r.expires_at === null || r.expires_at > now) totals[r.email] += r.points;
        });

        const leaderboard = Object.entries(totals)
          .map(([email, balance]) => ({ email, balance: Math.max(0, balance) }))
          .filter(x => x.balance > 0)
          .sort((a, b) => b.balance - a.balance)
          .slice(0, limit);

        return reply(200, { leaderboard });
      }

      // Stats
      if (action === 'stats') {
        const now = new Date().toISOString();
        const res = await sbFetch(`/rest/v1/loyalty_points?select=email,points,type,expires_at`);
        const rows = await res.json();

        if (!Array.isArray(rows)) return reply(200, { total_issued: 0, total_redeemed: 0, outstanding: 0, customers: 0 });

        const totalIssued = rows.filter(r => r.points > 0).reduce((s, r) => s + r.points, 0);
        const totalRedeemed = rows.filter(r => r.points < 0 && r.type === 'redeem').reduce((s, r) => s + Math.abs(r.points), 0);
        const customers = new Set(rows.map(r => r.email)).size;

        const byEmail = {};
        rows.forEach(r => {
          if (!byEmail[r.email]) byEmail[r.email] = 0;
          if (r.expires_at === null || r.expires_at > now) byEmail[r.email] += r.points;
        });
        const outstanding = Object.values(byEmail).reduce((s, v) => s + Math.max(0, v), 0);

        return reply(200, { total_issued: totalIssued, total_redeemed: totalRedeemed, outstanding, customers });
      }

      // Transaction log
      if (action === 'log') {
        const limit = parseInt(event.queryStringParameters?.limit) || 50;
        const offset = parseInt(event.queryStringParameters?.offset) || 0;
        const type = event.queryStringParameters?.type;

        let path = `/rest/v1/loyalty_points?select=*&order=created_at.desc&limit=${limit}&offset=${offset}`;
        if (type) path += `&type=eq.${encodeURIComponent(type)}`;

        const res = await sbFetch(path);
        const rows = await res.json();
        return reply(200, { rows: rows || [] });
      }

      // Settings
      if (action === 'settings') {
        const res = await sbFetch('/rest/v1/loyalty_settings?id=eq.1&select=*');
        const rows = await res.json();
        return reply(200, rows?.[0] || {});
      }

      return reply(400, { error: 'Unknown action' });
    }

    // ── POST actions ─────────────────────────────────────────────────────
    if (event.httpMethod !== 'POST') return reply(405, { error: 'Method not allowed' });

    const body = JSON.parse(event.body || '{}');
    const { action } = body;

    // Award bonus to single email
    if (action === 'award_bonus') {
      const { email, points, description } = body;
      if (!email || !points) return reply(400, { error: 'email and points required' });

      const expiresAt = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString();
      await sbFetch('/rest/v1/loyalty_points', {
        method: 'POST',
        prefer: 'return=minimal',
        body: {
          email: email.toLowerCase(),
          points: Math.floor(Number(points)),
          type: 'bonus',
          description: description || `Staff bonus — ${Math.floor(Number(points))} pts`,
          expires_at: expiresAt,
        },
      });

      const newBalance = await getBalance(email.toLowerCase());
      console.log(`[loyalty-admin] Bonus: ${points}pts → ${email}`);
      return reply(200, { ok: true, new_balance: newBalance });
    }

    // Award bonus to multiple emails
    if (action === 'award_bonus_bulk') {
      const { emails, points, description } = body;
      if (!Array.isArray(emails) || !points) return reply(400, { error: 'emails array and points required' });

      const expiresAt = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString();
      const rows = emails.map(e => ({
        email: e.toLowerCase().trim(),
        points: Math.floor(Number(points)),
        type: 'bonus',
        description: description || `Staff bonus — ${Math.floor(Number(points))} pts`,
        expires_at: expiresAt,
      }));

      await sbFetch('/rest/v1/loyalty_points', {
        method: 'POST',
        prefer: 'return=minimal',
        body: rows,
      });

      console.log(`[loyalty-admin] Bulk bonus: ${points}pts → ${emails.length} customers`);
      return reply(200, { ok: true, awarded: emails.length });
    }

    // Send spin invite(s)
    if (action === 'send_spin_invite') {
      const { emails } = body;
      if (!Array.isArray(emails) || emails.length === 0) return reply(400, { error: 'emails array required' });

      let sent = 0;
      for (const email of emails) {
        const e = email.toLowerCase().trim();
        const spinToken = Math.random().toString(36).slice(2) + Date.now().toString(36);
        const spinUrl = `https://www.primalpantry.co.nz/primalpoints/spin/?t=${spinToken}`;

        try {
          await sbFetch('/rest/v1/loyalty_spins', {
            method: 'POST',
            prefer: 'return=minimal',
            body: { email: e, token: spinToken },
          });

          await sendEmail({
            to: e,
            subject: 'You have a free spin waiting 🎡',
            html: spinInviteHtml({ spinUrl }),
          });

          sent++;
        } catch (err) {
          console.warn(`[loyalty-admin] Spin invite failed for ${e}:`, err.message);
        }
      }

      console.log(`[loyalty-admin] Sent spin invites to ${sent}/${emails.length}`);
      return reply(200, { ok: true, sent });
    }

    // Send balance emails
    if (action === 'send_balance_email') {
      const { emails } = body;
      if (!Array.isArray(emails) || emails.length === 0) return reply(400, { error: 'emails array required' });

      const settingsRes = await sbFetch('/rest/v1/loyalty_settings?id=eq.1&select=*');
      const settingsArr = await settingsRes.json();
      const settings = settingsArr?.[0] || { points_to_dollar_rate: 100, min_redemption_points: 500 };

      let sent = 0;
      for (const email of emails) {
        const e = email.toLowerCase().trim();
        try {
          const now = new Date().toISOString();
          const rowsRes = await sbFetch(`/rest/v1/loyalty_points?email=eq.${encodeURIComponent(e)}&select=points,expires_at`);
          const rows = await rowsRes.json();
          const balance = Array.isArray(rows) ? rows.reduce((sum, r) => {
            if (r.expires_at === null || r.expires_at > now) return sum + r.points;
            return sum;
          }, 0) : 0;

          if (balance <= 0) continue; // skip zero-balance customers

          const activeExpiries = (rows || [])
            .filter(r => r.points > 0 && r.expires_at && r.expires_at > now)
            .map(r => r.expires_at)
            .sort();
          const expiryDate = activeExpiries[0] || null;

          await sendEmail({
            to: e,
            subject: `Your PrimalPoints balance: ${balance.toLocaleString()} pts 🌿`,
            html: balanceEmailHtml({
              email: e,
              balance,
              expiryDate,
              minRedeem: settings.min_redemption_points,
              redeemRate: settings.points_to_dollar_rate,
            }),
          });

          sent++;
        } catch (err) {
          console.warn(`[loyalty-admin] Balance email failed for ${e}:`, err.message);
        }
      }

      console.log(`[loyalty-admin] Sent balance emails to ${sent}/${emails.length}`);
      return reply(200, { ok: true, sent });
    }

    // Update settings
    if (action === 'update_settings') {
      const { settings } = body;
      if (!settings) return reply(400, { error: 'settings object required' });

      const allowed = ['points_per_dollar', 'points_to_dollar_rate', 'min_redemption_points', 'double_points_active', 'double_points_sku', 'double_points_until'];
      const patch = {};
      for (const k of allowed) {
        if (settings[k] !== undefined) patch[k] = settings[k];
      }
      patch.updated_at = new Date().toISOString();

      await sbFetch('/rest/v1/loyalty_settings?id=eq.1', {
        method: 'PATCH',
        prefer: 'return=minimal',
        body: patch,
      });

      console.log('[loyalty-admin] Settings updated:', Object.keys(patch).join(', '));
      return reply(200, { ok: true });
    }

    // Expire points sweep — create negative rows for all expired positive rows
    if (action === 'expire_points') {
      const now = new Date().toISOString();
      // Find expired positive rows that haven't been offset yet
      const res = await sbFetch(
        `/rest/v1/loyalty_points?expires_at=lt.${encodeURIComponent(now)}&points=gt.0&type=neq.expire&select=*`
      );
      const expired = await res.json();
      if (!Array.isArray(expired) || expired.length === 0) {
        return reply(200, { ok: true, expired: 0 });
      }

      // Group by email
      const byEmail = {};
      expired.forEach(r => {
        if (!byEmail[r.email]) byEmail[r.email] = 0;
        byEmail[r.email] += r.points;
      });

      const expireRows = Object.entries(byEmail).map(([email, points]) => ({
        email,
        points: -points,
        type: 'expire',
        description: `Points expired`,
        expires_at: null,
      }));

      await sbFetch('/rest/v1/loyalty_points', {
        method: 'POST',
        prefer: 'return=minimal',
        body: expireRows,
      });

      console.log(`[loyalty-admin] Expired ${expireRows.length} customer point batches`);
      return reply(200, { ok: true, expired: expireRows.length });
    }

    return reply(400, { error: 'Unknown action' });
  } catch (err) {
    console.error('[loyalty-admin] Error:', err.message);
    return reply(500, { error: 'Internal error' });
  }
};
