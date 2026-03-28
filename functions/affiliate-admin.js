/**
 * affiliate-admin.js
 *
 * Admin actions for affiliate management (called from OSO dashboard):
 * - approve: Creates Stripe promo code, sends welcome email
 * - reject: Updates status, sends rejection email
 * - record_payout: Logs manual payout
 *
 * Auth: Validates staff session token against staff table.
 *
 * Env vars: SUPABASE_URL, SUPABASE_SERVICE_KEY, STRIPE_SECRET_KEY,
 *           AFFILIATE_COUPON_ID, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET
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

async function validateStaffToken(token) {
  if (!token) return false;
  const res = await sbFetch(
    `/rest/v1/staff?session_token=eq.${encodeURIComponent(token)}&select=id,role&limit=1`
  );
  const rows = await res.json();
  if (!rows || rows.length === 0) return false;
  // Only admin/owner can manage affiliates
  return ['owner', 'admin'].includes(rows[0].role);
}

function generateCode(name) {
  // BONELY-FIRSTNAME or BONELY-RANDOM
  const clean = (name || '').split(/\s+/)[0].replace(/[^a-zA-Z]/g, '').toUpperCase();
  const slug = clean.length >= 3 ? clean : ('AFF' + Date.now().toString(36).toUpperCase().slice(-4));
  return 'BONELY-' + slug;
}

function welcomeEmailHtml({ name, code, referralLink }) {
  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#F7F2EB;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:600px;margin:0 auto;padding:32px 16px;">
    <div style="background:#fff;border-radius:16px;overflow:hidden;border:1px solid rgba(123,92,58,0.12);">
      <div style="background:#4A5E38;padding:28px 32px;text-align:center;">
        <p style="margin:0 0 6px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.14em;color:rgba(255,255,255,0.7);">Welcome to</p>
        <h1 style="margin:0;font-family:Georgia,serif;font-size:28px;font-weight:400;color:#fff;">Bonelyfans</h1>
      </div>
      <div style="padding:32px;">
        <p style="font-size:15px;color:#1C1A17;line-height:1.6;margin:0 0 20px;">Hey ${name}, welcome to the PrimalPantry affiliate programme! Your application has been approved.</p>

        <div style="background:#F0EBE3;border-radius:12px;padding:20px;margin-bottom:20px;">
          <p style="margin:0 0 6px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:#9B7550;">Your Discount Code</p>
          <p style="margin:0;font-family:Georgia,serif;font-size:28px;font-weight:700;color:#1C1A17;letter-spacing:0.05em;">${code}</p>
          <p style="margin:8px 0 0;font-size:13px;color:#8A7D70;">Share this with your audience — they get 10% off</p>
        </div>

        <div style="background:#F0EBE3;border-radius:12px;padding:20px;margin-bottom:20px;">
          <p style="margin:0 0 6px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:#9B7550;">Your Referral Link</p>
          <p style="margin:0;font-size:14px;color:#1C1A17;word-break:break-all;">${referralLink}</p>
          <p style="margin:8px 0 0;font-size:13px;color:#8A7D70;">When someone visits this link, you get credited for their purchase</p>
        </div>

        <div style="background:#F0EBE3;border-radius:12px;padding:20px;margin-bottom:24px;">
          <p style="margin:0 0 6px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:#9B7550;">How It Works</p>
          <ul style="margin:8px 0 0;padding-left:18px;font-size:14px;color:#1C1A17;line-height:1.8;">
            <li>Your audience uses your code or link at checkout</li>
            <li>They get <strong>10% off</strong> their order</li>
            <li>You earn <strong>20% commission</strong> (excl. shipping)</li>
            <li>Track your performance in your affiliate dashboard</li>
          </ul>
        </div>

        <div style="text-align:center;">
          <a href="https://www.primalpantry.co.nz/affiliates/login" style="display:inline-block;background:#4A5E38;color:#fff;text-decoration:none;padding:14px 32px;border-radius:10px;font-weight:700;font-size:14px;">Open Your Dashboard</a>
        </div>
      </div>
      <div style="background:#F7F2EB;padding:20px 32px;text-align:center;border-top:1px solid rgba(123,92,58,0.1);">
        <p style="margin:0;font-size:12px;color:#8A7D70;">PrimalPantry Affiliate Programme · <a href="https://www.primalpantry.co.nz/affiliates" style="color:#7B5C3A;">primalpantry.co.nz/affiliates</a></p>
      </div>
    </div>
  </div>
</body>
</html>`;
}

function rejectionEmailHtml({ name }) {
  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#F7F2EB;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:600px;margin:0 auto;padding:32px 16px;">
    <div style="background:#fff;border-radius:16px;overflow:hidden;border:1px solid rgba(123,92,58,0.12);">
      <div style="background:#7B5C3A;padding:28px 32px;text-align:center;">
        <p style="margin:0 0 6px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.14em;color:rgba(255,255,255,0.7);">Affiliate Programme</p>
        <h1 style="margin:0;font-family:Georgia,serif;font-size:24px;font-weight:400;color:#fff;">Application Update</h1>
      </div>
      <div style="padding:32px;">
        <p style="font-size:15px;color:#1C1A17;line-height:1.6;margin:0 0 16px;">Hey ${name},</p>
        <p style="font-size:14px;color:#1C1A17;line-height:1.7;margin:0 0 16px;">Thanks for your interest in the PrimalPantry affiliate programme. After reviewing your application, we're not able to offer a partnership at this time.</p>
        <p style="font-size:14px;color:#1C1A17;line-height:1.7;margin:0 0 24px;">This isn't necessarily permanent — as your platform grows, feel free to reapply in the future. We'd love to work together when the fit is right.</p>
        <p style="font-size:14px;color:#1C1A17;line-height:1.7;margin:0;">Cheers,<br>The PrimalPantry Team</p>
      </div>
      <div style="background:#F7F2EB;padding:20px 32px;text-align:center;border-top:1px solid rgba(123,92,58,0.1);">
        <p style="margin:0;font-size:12px;color:#8A7D70;">PrimalPantry · <a href="https://www.primalpantry.co.nz" style="color:#7B5C3A;">primalpantry.co.nz</a></p>
      </div>
    </div>
  </div>
</body>
</html>`;
}

async function handleApprove(affiliateId) {
  // Fetch affiliate
  const affRes = await sbFetch(`/rest/v1/affiliates?id=eq.${affiliateId}&select=*&limit=1`);
  const affiliates = await affRes.json();
  if (!affiliates || affiliates.length === 0) return reply(404, { error: 'Affiliate not found.' });

  const aff = affiliates[0];
  if (aff.status === 'approved') return reply(400, { error: 'Already approved.' });

  // Generate code
  let code = generateCode(aff.name);

  // Check uniqueness — if code exists, add random suffix
  const codeCheck = await sbFetch(`/rest/v1/affiliates?affiliate_code=eq.${encodeURIComponent(code)}&select=id&limit=1`);
  const codeExists = await codeCheck.json();
  if (codeExists && codeExists.length > 0) {
    code = code + '-' + Math.random().toString(36).slice(2, 5).toUpperCase();
  }

  // Create Stripe promotion code
  const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
  const couponId = process.env.AFFILIATE_COUPON_ID;

  if (!couponId) {
    return reply(500, { error: 'AFFILIATE_COUPON_ID not configured.' });
  }

  const promoCode = await stripe.promotionCodes.create({
    coupon: couponId,
    code: code,
    metadata: {
      type: 'affiliate',
      affiliate_id: String(aff.id),
    },
  });

  const referralLink = `https://www.primalpantry.co.nz?ref=${code}`;

  // Update affiliate
  await sbFetch(`/rest/v1/affiliates?id=eq.${affiliateId}`, {
    method: 'PATCH',
    body: {
      status: 'approved',
      affiliate_code: code,
      stripe_promo_code_id: promoCode.id,
      referral_link: referralLink,
      approved_at: new Date().toISOString(),
    },
  });

  // Send welcome email
  sendEmail({
    to: aff.email,
    subject: `Welcome to Bonelyfans! Your affiliate code: ${code}`,
    html: welcomeEmailHtml({ name: aff.name, code, referralLink }),
  }).catch(err => console.error('[affiliate-admin] Welcome email error:', err.message));

  return reply(200, { success: true, affiliate_code: code, referral_link: referralLink });
}

async function handleReject(affiliateId) {
  const affRes = await sbFetch(`/rest/v1/affiliates?id=eq.${affiliateId}&select=id,name,email,status&limit=1`);
  const affiliates = await affRes.json();
  if (!affiliates || affiliates.length === 0) return reply(404, { error: 'Affiliate not found.' });

  const aff = affiliates[0];

  await sbFetch(`/rest/v1/affiliates?id=eq.${affiliateId}`, {
    method: 'PATCH',
    body: { status: 'rejected', rejected_at: new Date().toISOString() },
  });

  sendEmail({
    to: aff.email,
    subject: 'Update on your PrimalPantry affiliate application',
    html: rejectionEmailHtml({ name: aff.name }),
  }).catch(err => console.error('[affiliate-admin] Rejection email error:', err.message));

  return reply(200, { success: true });
}

async function handleRecordPayout({ affiliate_id, amount, period_from, period_to, notes, paid_by }) {
  if (!affiliate_id || !amount || amount <= 0) {
    return reply(400, { error: 'affiliate_id and valid amount required.' });
  }

  // Insert payout
  await sbFetch('/rest/v1/affiliate_payouts', {
    method: 'POST',
    prefer: 'return=minimal',
    body: {
      affiliate_id,
      amount,
      period_from: period_from || null,
      period_to: period_to || null,
      notes: notes || null,
      paid_by: paid_by || null,
      created_at: new Date().toISOString(),
    },
  });

  // Update total_paid on affiliate
  const affRes = await sbFetch(`/rest/v1/affiliates?id=eq.${affiliate_id}&select=total_paid&limit=1`);
  const affs = await affRes.json();
  const currentPaid = (affs && affs[0]) ? (affs[0].total_paid || 0) : 0;

  await sbFetch(`/rest/v1/affiliates?id=eq.${affiliate_id}`, {
    method: 'PATCH',
    body: { total_paid: currentPaid + amount },
  });

  return reply(200, { success: true });
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return reply(204, '');
  if (event.httpMethod !== 'POST') return reply(405, { error: 'Method not allowed' });

  try {
    const body = JSON.parse(event.body);
    const { action, token } = body;

    // Validate staff token
    const isStaff = await validateStaffToken(token);
    if (!isStaff) return reply(403, { error: 'Unauthorised.' });

    if (action === 'approve') return await handleApprove(body.affiliate_id);
    if (action === 'reject') return await handleReject(body.affiliate_id);
    if (action === 'record_payout') return await handleRecordPayout(body);

    return reply(400, { error: 'Invalid action.' });

  } catch (err) {
    console.error('[affiliate-admin] Error:', err.message);
    return reply(500, { error: 'Something went wrong: ' + err.message });
  }
};
