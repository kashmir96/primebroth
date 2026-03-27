/**
 * send-quiz-email.js
 *
 * Shared Gmail sending utility for quiz emails.
 * Uses the same gmail_accounts OAuth tokens as the OSO dashboard.
 *
 * Env vars required:
 *   SUPABASE_URL          — Supabase project URL
 *   SUPABASE_SERVICE_KEY  — Supabase service_role key
 *   GOOGLE_CLIENT_ID      — Google OAuth client ID
 *   GOOGLE_CLIENT_SECRET  — Google OAuth client secret
 *   GMAIL_ACCOUNT_ID      — ID of the gmail_accounts row to send from
 */

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

function encodeBase64Url(str) {
  return Buffer.from(str, 'utf-8').toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function getAccountTokens() {
  const accountId = process.env.GMAIL_ACCOUNT_ID;
  if (!accountId) {
    // Fall back to first active account
    const res = await sbFetch('/rest/v1/gmail_accounts?active=eq.true&select=*&limit=1');
    const rows = await res.json();
    if (!rows || rows.length === 0) return null;
    return refreshIfNeeded(rows[0]);
  }
  const res = await sbFetch(`/rest/v1/gmail_accounts?id=eq.${accountId}&active=eq.true&select=*`);
  const rows = await res.json();
  if (!rows || rows.length === 0) return null;
  return refreshIfNeeded(rows[0]);
}

async function refreshIfNeeded(row) {
  if (new Date(row.expires_at) < new Date(Date.now() + 60000)) {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: row.refresh_token,
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
      }).toString(),
    });
    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) {
      console.error('[send-quiz-email] Token refresh failed:', tokenData);
      return null;
    }
    const expiresAt = new Date(Date.now() + tokenData.expires_in * 1000).toISOString();
    await sbFetch(`/rest/v1/gmail_accounts?id=eq.${row.id}`, {
      method: 'PATCH',
      body: { access_token: tokenData.access_token, expires_at: expiresAt },
    });
    row.access_token = tokenData.access_token;
  }
  return row;
}

/**
 * sendEmail({ to, subject, html })
 * Returns true on success, false on failure.
 */
async function sendEmail({ to, subject, html }) {
  try {
    const acct = await getAccountTokens();
    if (!acct) {
      console.error('[send-quiz-email] No active Gmail account found');
      return false;
    }

    const lines = [
      `From: PrimalPantry <${acct.email_address}>`,
      `To: ${to}`,
      `Subject: ${subject}`,
      'Content-Type: text/html; charset=utf-8',
      'MIME-Version: 1.0',
      '',
      html,
    ];

    const raw = encodeBase64Url(lines.join('\r\n'));

    const sendRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${acct.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ raw }),
    });

    const sendData = await sendRes.json();
    if (!sendRes.ok) {
      console.error('[send-quiz-email] Gmail send error:', sendData);
      return false;
    }

    console.log(`[send-quiz-email] Sent to ${to} | gmail_id: ${sendData.id}`);
    return true;
  } catch (err) {
    console.error('[send-quiz-email] Error:', err.message);
    return false;
  }
}

// ── Email templates ──────────────────────────────────────────────────────────

function resultsEmailHtml({ products, blurb }) {
  const productList = (products || []).map(p =>
    `<li style="margin-bottom:6px;">${p}</li>`
  ).join('');

  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#F7F2EB;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:600px;margin:0 auto;padding:32px 16px;">
    <div style="background:#fff;border-radius:16px;overflow:hidden;border:1px solid rgba(123,92,58,0.12);">

      <!-- Header -->
      <div style="background:#7B5C3A;padding:28px 32px;text-align:center;">
        <p style="margin:0 0 6px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.14em;color:rgba(255,255,255,0.7);">Your Skin Profile Report</p>
        <h1 style="margin:0;font-family:Georgia,serif;font-size:24px;font-weight:400;color:#fff;">Your Personalised Routine</h1>
      </div>

      <!-- Body -->
      <div style="padding:32px;">
        ${blurb ? `
        <div style="background:#F0EBE3;border-radius:12px;padding:20px;margin-bottom:24px;">
          <p style="margin:0 0 6px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:#9B7550;">Your Skin Summary</p>
          <p style="margin:0;font-size:14px;line-height:1.7;color:#1C1A17;">${blurb}</p>
        </div>
        ` : ''}

        <h2 style="font-family:Georgia,serif;font-size:18px;font-weight:400;color:#1C1A17;margin:0 0 12px;">Your Matched Products</h2>
        <ul style="margin:0 0 24px;padding-left:20px;color:#1C1A17;font-size:14px;line-height:1.7;">
          ${productList}
        </ul>

        <div style="text-align:center;margin-bottom:24px;">
          <a href="https://www.primalpantry.co.nz/skin-quiz/" style="display:inline-block;background:#4A5E38;color:#fff;text-decoration:none;padding:14px 32px;border-radius:10px;font-weight:700;font-size:14px;">View Your Full Report</a>
        </div>

        <p style="font-size:12px;color:#8A7D70;line-height:1.6;margin:0;">
          This is not medical advice. As with any new skincare, we recommend a patch test first. If you have concerns about your skin, please speak to your GP or dermatologist.
        </p>
      </div>

      <!-- Footer -->
      <div style="background:#F7F2EB;padding:20px 32px;text-align:center;border-top:1px solid rgba(123,92,58,0.1);">
        <p style="margin:0;font-size:12px;color:#8A7D70;">PrimalPantry · Made in Christchurch, NZ · <a href="https://www.primalpantry.co.nz" style="color:#7B5C3A;">primalpantry.co.nz</a></p>
      </div>
    </div>
  </div>
</body>
</html>`;
}

function referrerEmailHtml({ code, expiryDate }) {
  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#F7F2EB;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:600px;margin:0 auto;padding:32px 16px;">
    <div style="background:#fff;border-radius:16px;overflow:hidden;border:1px solid rgba(123,92,58,0.12);">
      <div style="background:#7B5C3A;padding:28px 32px;text-align:center;">
        <p style="margin:0 0 6px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.14em;color:rgba(255,255,255,0.7);">Referral Reward</p>
        <h1 style="margin:0;font-family:Georgia,serif;font-size:24px;font-weight:400;color:#fff;">Your $5 Off Code</h1>
      </div>
      <div style="padding:32px;text-align:center;">
        <p style="font-size:15px;color:#1C1A17;line-height:1.6;margin:0 0 24px;">Thanks for sharing PrimalPantry with a friend! Here's your $5 off code — use it on your next order.</p>

        <div style="background:#F0EBE3;border:2px dashed #C4A07A;border-radius:12px;padding:20px;margin-bottom:24px;">
          <p style="margin:0 0 6px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:#9B7550;">Your Code</p>
          <p style="margin:0;font-family:Georgia,serif;font-size:28px;font-weight:700;color:#1C1A17;letter-spacing:0.05em;">${code}</p>
          <p style="margin:8px 0 0;font-size:12px;color:#8A7D70;">Expires ${expiryDate} · One use only</p>
        </div>

        <p style="font-size:13px;color:#8A7D70;margin:0 0 20px;">Enter this code in the <strong style="color:#1C1A17;">promo code field</strong> at checkout on primalpantry.co.nz</p>

        <a href="https://www.primalpantry.co.nz/shop/" style="display:inline-block;background:#4A5E38;color:#fff;text-decoration:none;padding:14px 32px;border-radius:10px;font-weight:700;font-size:14px;">Shop Now</a>
      </div>
      <div style="background:#F7F2EB;padding:20px 32px;text-align:center;border-top:1px solid rgba(123,92,58,0.1);">
        <p style="margin:0;font-size:12px;color:#8A7D70;">PrimalPantry · Made in Christchurch, NZ · <a href="https://www.primalpantry.co.nz" style="color:#7B5C3A;">primalpantry.co.nz</a></p>
      </div>
    </div>
  </div>
</body>
</html>`;
}

function friendEmailHtml({ code, expiryDate, referrerEmail }) {
  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#F7F2EB;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:600px;margin:0 auto;padding:32px 16px;">
    <div style="background:#fff;border-radius:16px;overflow:hidden;border:1px solid rgba(123,92,58,0.12);">
      <div style="background:#7B5C3A;padding:28px 32px;text-align:center;">
        <p style="margin:0 0 6px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.14em;color:rgba(255,255,255,0.7);">A Friend Shared This With You</p>
        <h1 style="margin:0;font-family:Georgia,serif;font-size:24px;font-weight:400;color:#fff;">$5 Off Your First Order</h1>
      </div>
      <div style="padding:32px;text-align:center;">
        <p style="font-size:15px;color:#1C1A17;line-height:1.6;margin:0 0 8px;">Someone who cares about your skin sent you this.</p>
        <p style="font-size:13px;color:#8A7D70;margin:0 0 24px;">Take the free skin quiz to find your perfect tallow skincare routine — then use this code at checkout.</p>

        <div style="background:#F0EBE3;border:2px dashed #C4A07A;border-radius:12px;padding:20px;margin-bottom:24px;">
          <p style="margin:0 0 6px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:#9B7550;">Your Code</p>
          <p style="margin:0;font-family:Georgia,serif;font-size:28px;font-weight:700;color:#1C1A17;letter-spacing:0.05em;">${code}</p>
          <p style="margin:8px 0 0;font-size:12px;color:#8A7D70;">Expires ${expiryDate} · One use only · New customers only</p>
        </div>

        <p style="font-size:13px;color:#8A7D70;margin:0 0 20px;">Enter this code in the <strong style="color:#1C1A17;">promo code field</strong> at checkout on primalpantry.co.nz</p>

        <a href="https://www.primalpantry.co.nz/skin-quiz/?utm_source=referral&utm_medium=email&utm_campaign=friend-voucher" style="display:inline-block;background:#4A5E38;color:#fff;text-decoration:none;padding:14px 32px;border-radius:10px;font-weight:700;font-size:14px;">Take the Free Skin Quiz</a>
      </div>
      <div style="background:#F7F2EB;padding:20px 32px;text-align:center;border-top:1px solid rgba(123,92,58,0.1);">
        <p style="margin:0;font-size:12px;color:#8A7D70;">PrimalPantry · Made in Christchurch, NZ · <a href="https://www.primalpantry.co.nz" style="color:#7B5C3A;">primalpantry.co.nz</a></p>
      </div>
    </div>
  </div>
</body>
</html>`;
}

function referrerRewardEmailHtml({ code, expiryDate }) {
  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#F7F2EB;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:600px;margin:0 auto;padding:32px 16px;">
    <div style="background:#fff;border-radius:16px;overflow:hidden;border:1px solid rgba(123,92,58,0.12);">
      <div style="background:#4A5E38;padding:28px 32px;text-align:center;">
        <p style="margin:0 0 6px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.14em;color:rgba(255,255,255,0.7);">Referral Reward Unlocked</p>
        <h1 style="margin:0;font-family:Georgia,serif;font-size:24px;font-weight:400;color:#fff;">Your friend placed an order!</h1>
      </div>
      <div style="padding:32px;text-align:center;">
        <p style="font-size:15px;color:#1C1A17;line-height:1.6;margin:0 0 8px;">Your friend used their referral code — so here's your $5 off as a thank you for spreading the word.</p>
        <p style="font-size:13px;color:#8A7D70;margin:0 0 24px;">Valid on orders over $25.</p>

        <div style="background:#F0EBE3;border:2px dashed #C4A07A;border-radius:12px;padding:20px;margin-bottom:24px;">
          <p style="margin:0 0 6px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:#9B7550;">Your Code</p>
          <p style="margin:0;font-family:Georgia,serif;font-size:28px;font-weight:700;color:#1C1A17;letter-spacing:0.05em;">${code}</p>
          <p style="margin:8px 0 0;font-size:12px;color:#8A7D70;">Expires ${expiryDate} · One use only · Orders over $25</p>
        </div>

        <p style="font-size:13px;color:#8A7D70;margin:0 0 20px;">Enter this code in the <strong style="color:#1C1A17;">promo code field</strong> at checkout on primalpantry.co.nz</p>

        <a href="https://www.primalpantry.co.nz/shop/" style="display:inline-block;background:#4A5E38;color:#fff;text-decoration:none;padding:14px 32px;border-radius:10px;font-weight:700;font-size:14px;">Shop Now</a>
      </div>
      <div style="background:#F7F2EB;padding:20px 32px;text-align:center;border-top:1px solid rgba(123,92,58,0.1);">
        <p style="margin:0;font-size:12px;color:#8A7D70;">PrimalPantry · Made in Christchurch, NZ · <a href="https://www.primalpantry.co.nz" style="color:#7B5C3A;">primalpantry.co.nz</a></p>
      </div>
    </div>
  </div>
</body>
</html>`;
}

module.exports = { sendEmail, resultsEmailHtml, referrerEmailHtml, referrerRewardEmailHtml, friendEmailHtml };

// ── Netlify handler (for direct HTTP calls if needed) ──
exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return reply(204, '');
  if (event.httpMethod !== 'POST') return reply(405, { error: 'Method not allowed' });
  try {
    const { to, subject, html } = JSON.parse(event.body);
    if (!to || !subject || !html) return reply(400, { error: 'to, subject, html required' });
    const ok = await sendEmail({ to, subject, html });
    return ok ? reply(200, { success: true }) : reply(500, { error: 'Send failed' });
  } catch (err) {
    return reply(500, { error: err.message });
  }
};
