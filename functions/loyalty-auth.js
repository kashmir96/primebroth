/**
 * loyalty-auth.js
 *
 * Magic-link auth for PrimalPoints dashboard.
 * Modelled on affiliate-auth.js.
 *
 * Actions:
 *   request_link  — send magic link to email (if they have points)
 *   verify_token  — exchange magic-link token for session
 *   validate      — check session token is still valid
 *   balance       — get balance (requires session_token, not email)
 *
 * Security:
 *   - Magic link requests rate-limited to 3 per email per hour
 *   - Balance endpoint requires authenticated session
 *
 * Env vars: SUPABASE_URL, SUPABASE_SERVICE_KEY, GOOGLE_CLIENT_ID,
 *           GOOGLE_CLIENT_SECRET, GMAIL_REFRESH_TOKEN
 */

const crypto = require('crypto');
const { sendEmail } = require('./send-quiz-email');

const HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
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

// ── Shared: resolve session token → email ─────────────────────────────────────

async function resolveSession(sessionToken) {
  if (!sessionToken || sessionToken.length !== 64) return null;
  const res = await sbFetch(
    `/rest/v1/loyalty_sessions?session_token=eq.${encodeURIComponent(sessionToken)}&select=email,expires_at&limit=1`
  );
  const sessions = await res.json();
  if (!Array.isArray(sessions) || sessions.length === 0) return null;
  const session = sessions[0];
  if (new Date(session.expires_at) < new Date()) return null;
  return session.email;
}

function magicLinkHtml({ loginUrl }) {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#F7F2EB;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:600px;margin:0 auto;padding:32px 16px;">
    <div style="background:#fff;border-radius:16px;overflow:hidden;border:1px solid rgba(123,92,58,0.12);">
      <div style="background:#3D5230;padding:28px 32px;text-align:center;">
        <p style="margin:0 0 6px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.14em;color:rgba(255,255,255,0.7);">PrimalPoints</p>
        <h1 style="margin:0;font-family:Georgia,serif;font-size:24px;font-weight:400;color:#fff;">Your Login Link</h1>
      </div>
      <div style="padding:32px;text-align:center;">
        <p style="font-size:15px;color:#1C1A17;line-height:1.6;margin:0 0 8px;">Hey there,</p>
        <p style="font-size:14px;color:#8A7D70;line-height:1.6;margin:0 0 24px;">Click below to view your PrimalPoints balance and redeem your rewards. This link expires in 1 hour.</p>
        <div style="text-align:center;margin-bottom:24px;">
          <a href="${loginUrl}" style="display:inline-block;background:#3D5230;color:#fff;text-decoration:none;padding:14px 32px;border-radius:10px;font-weight:700;font-size:14px;">View My Points</a>
        </div>
        <p style="font-size:12px;color:#8A7D70;line-height:1.6;margin:0;">
          If you didn't request this link, you can safely ignore this email.
        </p>
      </div>
      <div style="background:#F7F2EB;padding:20px 32px;text-align:center;border-top:1px solid rgba(123,92,58,0.1);">
        <p style="margin:0;font-size:12px;color:#8A7D70;">PrimalPantry PrimalPoints</p>
      </div>
    </div>
  </div>
</body>
</html>`;
}

// ── Request Link ──────────────────────────────────────────────────────────────

async function handleRequestLink(email) {
  if (!email || !email.match(/.+@.+\..+/)) {
    return reply(200, { success: true, message: 'If a PrimalPoints account exists for this email, a login link has been sent.' });
  }

  const emailLower = email.toLowerCase();

  // Rate limit: max 3 magic link requests per email per hour
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const rateRes = await sbFetch(
    `/rest/v1/loyalty_tokens?email=eq.${encodeURIComponent(emailLower)}&created_at=gte.${encodeURIComponent(oneHourAgo)}&select=id`
  );
  const recentTokens = await rateRes.json();
  if (Array.isArray(recentTokens) && recentTokens.length >= 3) {
    return reply(429, { error: 'Too many login requests. Please wait an hour and try again.' });
  }

  // Generate token — send link to any valid email (new visitors see 0 balance + shop prompt)
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hour

  const tokenRes = await sbFetch('/rest/v1/loyalty_tokens', {
    method: 'POST',
    prefer: 'return=minimal',
    body: {
      email: emailLower,
      token,
      expires_at: expiresAt,
      used: false,
      created_at: new Date().toISOString(),
    },
  });

  if (!tokenRes.ok) {
    console.error('[loyalty-auth] Token insert error:', await tokenRes.text());
    return reply(500, { error: 'Something went wrong. Please try again.' });
  }

  // Send magic link email (non-blocking, same pattern as affiliate-auth)
  const loginUrl = `https://www.primalpantry.co.nz/primalpoints/login/?token=${token}`;
  sendEmail({
    to: emailLower,
    subject: 'Your PrimalPoints Login Link',
    html: magicLinkHtml({ loginUrl }),
  }).catch(err => console.error('[loyalty-auth] Email send error:', err.message));

  return reply(200, { success: true, message: 'If a PrimalPoints account exists for this email, a login link has been sent.' });
}

// ── Verify Token ──────────────────────────────────────────────────────────────

async function handleVerifyToken(token) {
  if (!token || token.length !== 64) {
    return reply(400, { error: 'Invalid or expired login link.' });
  }

  const tokenRes = await sbFetch(
    `/rest/v1/loyalty_tokens?token=eq.${encodeURIComponent(token)}&used=eq.false&select=*&limit=1`
  );
  const tokens = await tokenRes.json();

  if (!Array.isArray(tokens) || tokens.length === 0) {
    return reply(400, { error: 'Invalid or expired login link.' });
  }

  const tokenRow = tokens[0];

  if (new Date(tokenRow.expires_at) < new Date()) {
    return reply(400, { error: 'This login link has expired. Please request a new one.' });
  }

  // Mark used
  await sbFetch(`/rest/v1/loyalty_tokens?id=eq.${tokenRow.id}`, {
    method: 'PATCH',
    body: { used: true },
  });

  // Create session (30 days)
  const sessionToken = crypto.randomBytes(32).toString('hex');
  const sessionExpiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

  await sbFetch('/rest/v1/loyalty_sessions', {
    method: 'POST',
    prefer: 'return=minimal',
    body: {
      email: tokenRow.email,
      session_token: sessionToken,
      created_at: new Date().toISOString(),
      expires_at: sessionExpiry,
    },
  });

  return reply(200, {
    success: true,
    session_token: sessionToken,
    email: tokenRow.email,
  });
}

// ── Validate Session ──────────────────────────────────────────────────────────

async function handleValidate(sessionToken) {
  if (!sessionToken || sessionToken.length !== 64) {
    return reply(401, { error: 'Invalid session.' });
  }

  const res = await sbFetch(
    `/rest/v1/loyalty_sessions?session_token=eq.${encodeURIComponent(sessionToken)}&select=email,expires_at&limit=1`
  );
  const sessions = await res.json();

  if (!Array.isArray(sessions) || sessions.length === 0) {
    return reply(401, { error: 'Invalid session.' });
  }

  const session = sessions[0];

  if (new Date(session.expires_at) < new Date()) {
    return reply(401, { error: 'Session expired. Please log in again.' });
  }

  return reply(200, { success: true, email: session.email });
}

// ── Authenticated Balance ─────────────────────────────────────────────────────

async function handleBalance(sessionToken) {
  const email = await resolveSession(sessionToken);
  if (!email) return reply(401, { error: 'Invalid session.' });

  const now = new Date().toISOString();

  const [rowsRes, settingsRes] = await Promise.all([
    sbFetch(`/rest/v1/loyalty_points?email=eq.${encodeURIComponent(email)}&select=points,expires_at,created_at`),
    sbFetch('/rest/v1/loyalty_settings?id=eq.1&select=points_to_dollar_rate,min_redemption_points,points_per_dollar'),
  ]);

  const rows = await rowsRes.json();
  const settingsArr = await settingsRes.json();
  const settings = settingsArr?.[0] || { points_to_dollar_rate: 2000, min_redemption_points: 2000, points_per_dollar: 100 };

  if (!Array.isArray(rows)) {
    return reply(200, { balance: 0, pending_expiry: 0, expiry_date: null, ...settings });
  }

  const balance = rows.reduce((sum, r) => {
    if (r.expires_at === null || r.expires_at > now) return sum + r.points;
    return sum;
  }, 0);

  const soon = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const expiringSoon = rows
    .filter(r => r.expires_at && r.expires_at > now && r.expires_at <= soon && r.points > 0)
    .reduce((sum, r) => sum + r.points, 0);

  const activeExpiries = rows
    .filter(r => r.points > 0 && r.expires_at && r.expires_at > now)
    .map(r => r.expires_at)
    .sort();

  return reply(200, {
    balance: Math.max(0, balance),
    pending_expiry: expiringSoon,
    expiry_date: activeExpiries[0] || null,
    points_to_dollar_rate: settings.points_to_dollar_rate,
    min_redemption_points: settings.min_redemption_points,
    points_per_dollar: settings.points_per_dollar,
  });
}

// ── Handler ───────────────────────────────────────────────────────────────────

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return reply(204, '');
  if (event.httpMethod !== 'POST') return reply(405, { error: 'Method not allowed' });

  try {
    const { action, email, token, session_token } = JSON.parse(event.body || '{}');

    if (action === 'request_link') return await handleRequestLink(email);
    if (action === 'verify_token') return await handleVerifyToken(token);
    if (action === 'validate') return await handleValidate(session_token);
    if (action === 'balance') return await handleBalance(session_token);
    return reply(400, { error: 'Invalid action.' });
  } catch (err) {
    console.error('[loyalty-auth] Error:', err.message);
    return reply(500, { error: 'Something went wrong. Please try again.' });
  }
};

// Export resolveSession for use by loyalty-redeem.js
exports.resolveSession = resolveSession;
