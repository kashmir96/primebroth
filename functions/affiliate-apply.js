/**
 * affiliate-apply.js
 *
 * Handles new affiliate applications:
 * 1. Validates required fields
 * 2. Inserts into affiliates table with status 'pending'
 * 3. Sends notification email to staff via Gmail
 *
 * Env vars required:
 *   SUPABASE_URL          — Supabase project URL
 *   SUPABASE_SERVICE_KEY  — Supabase service_role key
 *   GOOGLE_CLIENT_ID      — Google OAuth client ID
 *   GOOGLE_CLIENT_SECRET  — Google OAuth client secret
 *   GMAIL_REFRESH_TOKEN   — Gmail refresh token (fallback if no gmail_accounts row)
 */

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

function applicationEmailHtml({ name, email, social_links, website, audience_size, reason }) {
  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#F7F2EB;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:600px;margin:0 auto;padding:32px 16px;">
    <div style="background:#fff;border-radius:16px;overflow:hidden;border:1px solid rgba(123,92,58,0.12);">
      <div style="background:#7B5C3A;padding:28px 32px;text-align:center;">
        <p style="margin:0 0 6px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.14em;color:rgba(255,255,255,0.7);">Affiliate Programme</p>
        <h1 style="margin:0;font-family:Georgia,serif;font-size:24px;font-weight:400;color:#fff;">New Application</h1>
      </div>
      <div style="padding:32px;">
        <table style="width:100%;border-collapse:collapse;font-size:14px;color:#1C1A17;">
          <tr><td style="padding:8px 12px;font-weight:700;color:#7B5C3A;vertical-align:top;width:140px;">Name</td><td style="padding:8px 12px;">${name}</td></tr>
          <tr style="background:#F7F2EB;"><td style="padding:8px 12px;font-weight:700;color:#7B5C3A;vertical-align:top;">Email</td><td style="padding:8px 12px;"><a href="mailto:${email}" style="color:#4A5E38;">${email}</a></td></tr>
          <tr><td style="padding:8px 12px;font-weight:700;color:#7B5C3A;vertical-align:top;">Social Links</td><td style="padding:8px 12px;">${social_links || 'Not provided'}</td></tr>
          <tr style="background:#F7F2EB;"><td style="padding:8px 12px;font-weight:700;color:#7B5C3A;vertical-align:top;">Website</td><td style="padding:8px 12px;">${website || 'Not provided'}</td></tr>
          <tr><td style="padding:8px 12px;font-weight:700;color:#7B5C3A;vertical-align:top;">Audience Size</td><td style="padding:8px 12px;">${audience_size || 'Not provided'}</td></tr>
          <tr style="background:#F7F2EB;"><td style="padding:8px 12px;font-weight:700;color:#7B5C3A;vertical-align:top;">Why they want to join</td><td style="padding:8px 12px;">${reason || 'Not provided'}</td></tr>
        </table>

        <div style="text-align:center;margin-top:28px;">
          <a href="https://oso.primalpantry.co.nz/affiliates" style="display:inline-block;background:#4A5E38;color:#fff;text-decoration:none;padding:14px 32px;border-radius:10px;font-weight:700;font-size:14px;">Review in Dashboard</a>
        </div>
      </div>
      <div style="background:#F7F2EB;padding:20px 32px;text-align:center;border-top:1px solid rgba(123,92,58,0.1);">
        <p style="margin:0;font-size:12px;color:#8A7D70;">PrimalPantry Affiliate Programme</p>
      </div>
    </div>
  </div>
</body>
</html>`;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return reply(204, '');
  if (event.httpMethod !== 'POST') return reply(405, { error: 'Method not allowed' });

  try {
    const { name, email, social_links, website, audience_size, reason, terms_accepted } = JSON.parse(event.body);

    // ── Validation ──
    if (!name || !email || !reason || !terms_accepted) {
      return reply(400, { error: 'Name, email, reason, and terms acceptance are required.' });
    }
    if (!email.match(/.+@.+\..+/)) {
      return reply(400, { error: 'Please enter a valid email address.' });
    }
    if (!terms_accepted) {
      return reply(400, { error: 'You must accept the terms to apply.' });
    }

    // ── Check for duplicate application ──
    const existingRes = await sbFetch(
      `/rest/v1/affiliates?email=eq.${encodeURIComponent(email.toLowerCase())}&select=id,status&limit=1`
    );
    const existing = await existingRes.json();
    if (existing && existing.length > 0) {
      return reply(400, { error: 'An application with this email already exists.' });
    }

    // ── Insert into affiliates table ──
    const insertRes = await sbFetch('/rest/v1/affiliates', {
      method: 'POST',
      prefer: 'return=representation',
      body: {
        name,
        email: email.toLowerCase(),
        social_links: social_links || null,
        website: website || null,
        audience_size: audience_size || null,
        reason,
        terms_accepted: true,
        status: 'pending',
        created_at: new Date().toISOString(),
      },
    });

    if (!insertRes.ok) {
      const err = await insertRes.text();
      console.error('[affiliate-apply] Supabase insert error:', err);
      return reply(500, { error: 'Failed to submit application. Please try again.' });
    }

    // ── Send notification email to staff (non-blocking) ──
    const emailHtml = applicationEmailHtml({ name, email, social_links, website, audience_size, reason });

    Promise.all([
      sendEmail({
        to: 'trixy.cain@primalpantry.co.nz',
        subject: `New Affiliate Application \u2014 ${name}`,
        html: emailHtml,
      }),
      sendEmail({
        to: 'curtis@primalpantry.co.nz',
        subject: `New Affiliate Application \u2014 ${name}`,
        html: emailHtml,
      }),
    ]).catch(err => console.error('[affiliate-apply] Email send error:', err.message));

    return reply(200, { success: true, message: 'Application submitted successfully.' });

  } catch (err) {
    console.error('[affiliate-apply] Error:', err.message);
    return reply(500, { error: 'Something went wrong. Please try again.' });
  }
};
