/**
 * affiliate-auth.js
 *
 * Handles affiliate authentication via magic links:
 *
 * action: 'request_link'
 *   - Looks up approved affiliate by email
 *   - Generates crypto random token with 1-hour expiry
 *   - Emails magic link to affiliate
 *
 * action: 'verify_token'
 *   - Validates token (not expired, not used)
 *   - Marks token as used
 *   - Creates session token on affiliate row
 *   - Returns affiliate data + session_token
 *
 * Env vars required:
 *   SUPABASE_URL          — Supabase project URL
 *   SUPABASE_SERVICE_KEY  — Supabase service_role key
 *   GOOGLE_CLIENT_ID      — Google OAuth client ID
 *   GOOGLE_CLIENT_SECRET  — Google OAuth client secret
 *   GMAIL_REFRESH_TOKEN   — Gmail refresh token
 */

// ALTER TABLE affiliates ADD COLUMN IF NOT EXISTS session_token text;

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

function magicLinkEmailHtml({ name, loginUrl }) {
  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#F7F2EB;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:600px;margin:0 auto;padding:32px 16px;">
    <div style="background:#fff;border-radius:16px;overflow:hidden;border:1px solid rgba(123,92,58,0.12);">
      <div style="background:#7B5C3A;padding:28px 32px;text-align:center;">
        <p style="margin:0 0 6px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.14em;color:rgba(255,255,255,0.7);">Affiliate Dashboard</p>
        <h1 style="margin:0;font-family:Georgia,serif;font-size:24px;font-weight:400;color:#fff;">Your Login Link</h1>
      </div>
      <div style="padding:32px;text-align:center;">
        <p style="font-size:15px;color:#1C1A17;line-height:1.6;margin:0 0 8px;">Hey ${name},</p>
        <p style="font-size:14px;color:#8A7D70;line-height:1.6;margin:0 0 24px;">Click below to access your affiliate dashboard. This link expires in 1 hour.</p>

        <div style="text-align:center;margin-bottom:24px;">
          <a href="${loginUrl}" style="display:inline-block;background:#4A5E38;color:#fff;text-decoration:none;padding:14px 32px;border-radius:10px;font-weight:700;font-size:14px;">Open Dashboard</a>
        </div>

        <p style="font-size:12px;color:#8A7D70;line-height:1.6;margin:0;">
          If you didn't request this link, you can safely ignore this email.
        </p>
      </div>
      <div style="background:#F7F2EB;padding:20px 32px;text-align:center;border-top:1px solid rgba(123,92,58,0.1);">
        <p style="margin:0;font-size:12px;color:#8A7D70;">PrimalPantry Affiliate Programme</p>
      </div>
    </div>
  </div>
</body>
</html>`;
}

async function handleRequestLink(email) {
  if (!email || !email.match(/.+@.+\..+/)) {
    // Don't reveal whether email exists — always return success
    return reply(200, { success: true, message: 'If an approved affiliate account exists for this email, a login link has been sent.' });
  }

  // Look up approved affiliate
  const affRes = await sbFetch(
    `/rest/v1/affiliates?email=eq.${encodeURIComponent(email.toLowerCase())}&status=eq.approved&select=id,name,email&limit=1`
  );
  const affiliates = await affRes.json();

  if (!affiliates || affiliates.length === 0) {
    // Don't reveal that no account exists
    return reply(200, { success: true, message: 'If an approved affiliate account exists for this email, a login link has been sent.' });
  }

  const affiliate = affiliates[0];

  // Generate token
  const token = crypto.randomBytes(32).toString('hex'); // 64 chars
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hour

  // Insert token
  const tokenRes = await sbFetch('/rest/v1/affiliate_tokens', {
    method: 'POST',
    prefer: 'return=minimal',
    body: {
      affiliate_id: affiliate.id,
      token,
      expires_at: expiresAt,
      used: false,
      created_at: new Date().toISOString(),
    },
  });

  if (!tokenRes.ok) {
    console.error('[affiliate-auth] Token insert error:', await tokenRes.text());
    return reply(500, { error: 'Something went wrong. Please try again.' });
  }

  // Send magic link email (non-blocking)
  const loginUrl = `https://www.primalpantry.co.nz/affiliates/login?token=${token}`;
  sendEmail({
    to: affiliate.email,
    subject: 'Your PrimalPantry Affiliate Login Link',
    html: magicLinkEmailHtml({ name: affiliate.name, loginUrl }),
  }).catch(err => console.error('[affiliate-auth] Email send error:', err.message));

  return reply(200, { success: true, message: 'If an approved affiliate account exists for this email, a login link has been sent.' });
}

async function handleVerifyToken(token) {
  if (!token || token.length !== 64) {
    return reply(400, { error: 'Invalid or expired login link.' });
  }

  // Look up token
  const tokenRes = await sbFetch(
    `/rest/v1/affiliate_tokens?token=eq.${encodeURIComponent(token)}&used=eq.false&select=*&limit=1`
  );
  const tokens = await tokenRes.json();

  if (!tokens || tokens.length === 0) {
    return reply(400, { error: 'Invalid or expired login link.' });
  }

  const tokenRow = tokens[0];

  // Check expiry
  if (new Date(tokenRow.expires_at) < new Date()) {
    return reply(400, { error: 'This login link has expired. Please request a new one.' });
  }

  // Mark token as used
  await sbFetch(`/rest/v1/affiliate_tokens?id=eq.${tokenRow.id}`, {
    method: 'PATCH',
    body: { used: true },
  });

  // Generate session token
  const sessionToken = crypto.randomBytes(32).toString('hex'); // 64 chars

  // Update affiliate with session token
  await sbFetch(`/rest/v1/affiliates?id=eq.${tokenRow.affiliate_id}`, {
    method: 'PATCH',
    body: { session_token: sessionToken },
  });

  // Fetch affiliate data
  const affRes = await sbFetch(
    `/rest/v1/affiliates?id=eq.${tokenRow.affiliate_id}&select=id,name,email,affiliate_code,referral_link,total_clicks,total_orders,total_revenue,total_commission,total_paid&limit=1`
  );
  const affiliates = await affRes.json();

  if (!affiliates || affiliates.length === 0) {
    return reply(500, { error: 'Something went wrong. Please try again.' });
  }

  const affiliate = affiliates[0];

  return reply(200, {
    success: true,
    session_token: sessionToken,
    affiliate: {
      name: affiliate.name,
      email: affiliate.email,
      affiliate_code: affiliate.affiliate_code,
      referral_link: affiliate.referral_link,
      total_clicks: affiliate.total_clicks || 0,
      total_orders: affiliate.total_orders || 0,
      total_revenue: affiliate.total_revenue || 0,
      total_commission: affiliate.total_commission || 0,
      total_paid: affiliate.total_paid || 0,
    },
  });
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return reply(204, '');
  if (event.httpMethod !== 'POST') return reply(405, { error: 'Method not allowed' });

  try {
    const { action, email, token } = JSON.parse(event.body);

    if (action === 'request_link') {
      return await handleRequestLink(email);
    }

    if (action === 'verify_token') {
      return await handleVerifyToken(token);
    }

    return reply(400, { error: 'Invalid action. Use "request_link" or "verify_token".' });

  } catch (err) {
    console.error('[affiliate-auth] Error:', err.message);
    return reply(500, { error: 'Something went wrong. Please try again.' });
  }
};
