/**
 * loyalty-send-email.js
 *
 * Loyalty email templates + HTTP handler.
 * Reuses sendEmail() from send-quiz-email.js.
 *
 * POST /.netlify/functions/loyalty-send-email
 * Body: { type, to, data }
 *
 * Types:
 *   spin_invite    — "Crack the code" spin game invite
 *   balance_update — Current points balance
 *   redemption     — Here's your discount code
 *   expiring       — Points expiring soon
 *
 * Env vars: same as send-quiz-email.js + SUPABASE_URL/KEY
 */

const { sendEmail } = require('./send-quiz-email');

const HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

// ── Email Templates ─────────────────────────────────────────────────────────

function spinInviteHtml({ spinUrl, firstName }) {
  const name = firstName || 'there';
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#1a1008;font-family:'DM Sans',Helvetica,Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px;">
<tr><td align="center">
<table width="100%" style="max-width:520px;background:#1a1008;border-radius:16px;overflow:hidden;border:1px solid rgba(200,168,122,0.3);">

  <!-- Header -->
  <tr><td style="padding:40px 32px 20px;text-align:center;">
    <p style="margin:0 0 8px;font-size:0.68rem;font-weight:800;text-transform:uppercase;letter-spacing:0.22em;color:#C8A87A;">PrimalPoints · Crack the Code</p>
    <h1 style="margin:0 0 12px;font-size:2.4rem;font-weight:900;color:#fff;line-height:1.1;">Spin to win<br><span style="color:#C8A87A;">starter points</span></h1>
    <p style="margin:0;font-size:0.95rem;color:rgba(255,255,255,0.6);line-height:1.65;">
      Hey ${name} — we've left some PrimalPoints waiting for you.<br>How many? Spin to find out.
    </p>
  </td></tr>

  <!-- Wheel teaser -->
  <tr><td style="padding:24px 32px;text-align:center;">
    <div style="display:inline-block;width:140px;height:140px;border-radius:50%;background:conic-gradient(#3D5230 0deg 60deg,#C8A87A 60deg 120deg,#3D5230 120deg 180deg,#C8A87A 180deg 240deg,#3D5230 240deg 300deg,#C8A87A 300deg 360deg);box-shadow:0 0 40px rgba(200,168,122,0.25);position:relative;">
      <div style="position:absolute;inset:12px;border-radius:50%;background:#1a1008;display:flex;align-items:center;justify-content:center;">
        <span style="font-size:1.8rem;">🌿</span>
      </div>
    </div>
    <p style="margin:16px 0 0;font-size:0.8rem;color:rgba(255,255,255,0.4);">Up to 2,500 points · One spin only</p>
  </td></tr>

  <!-- CTA -->
  <tr><td style="padding:8px 32px 32px;text-align:center;">
    <a href="${spinUrl}" style="display:inline-block;background:#C8A87A;color:#1a1008;text-decoration:none;padding:16px 40px;border-radius:100px;font-weight:800;font-size:0.95rem;letter-spacing:0.02em;">
      Spin the wheel →
    </a>
    <p style="margin:16px 0 0;font-size:0.72rem;color:rgba(255,255,255,0.35);">This link is personal to you. One use only.</p>
  </td></tr>

  <!-- What are points -->
  <tr><td style="padding:20px 32px;border-top:1px solid rgba(200,168,122,0.15);text-align:center;">
    <p style="margin:0;font-size:0.78rem;color:rgba(255,255,255,0.45);line-height:1.7;">
      ⭐ <strong style="color:rgba(255,255,255,0.65);">What are PrimalPoints?</strong><br>
      Earn on every purchase. Redeem for dollars off. 2,000 pts = $1.
    </p>
  </td></tr>

  <!-- Footer -->
  <tr><td style="padding:16px 32px;text-align:center;">
    <p style="margin:0;font-size:0.65rem;color:rgba(255,255,255,0.25);">PrimalPantry · New Zealand</p>
  </td></tr>

</table>
</td></tr>
</table>
</body></html>`;
}

function balanceUpdateHtml({ balance, expiryDate, firstName, redeemUrl }) {
  const name = firstName || 'there';
  const expiry = expiryDate
    ? new Date(expiryDate).toLocaleDateString('en-NZ', { day: 'numeric', month: 'long', year: 'numeric' })
    : null;
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f5f0e8;font-family:'DM Sans',Helvetica,Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px;">
<tr><td align="center">
<table width="100%" style="max-width:520px;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
  <tr><td style="background:#3D5230;padding:32px;text-align:center;">
    <p style="margin:0 0 4px;font-size:0.68rem;font-weight:800;text-transform:uppercase;letter-spacing:0.18em;color:rgba(255,255,255,0.6);">PrimalPoints Balance</p>
    <h1 style="margin:0;font-size:2.4rem;font-weight:800;color:#fff;">${balance.toLocaleString()}</h1>
    <p style="margin:6px 0 0;font-size:0.85rem;color:rgba(255,255,255,0.75);">points available</p>
  </td></tr>
  <tr><td style="padding:32px;">
    <p style="margin:0 0 20px;font-size:0.95rem;color:#2E1A0E;line-height:1.6;">
      Hey ${name}, here's your current PrimalPoints balance.
      ${expiry ? `Your earliest points expire on <strong>${expiry}</strong>.` : ''}
    </p>
    <div style="background:#f5f0e8;border-radius:10px;padding:18px;margin-bottom:20px;">
      <p style="margin:0 0 8px;font-size:0.78rem;font-weight:700;color:#877B71;text-transform:uppercase;letter-spacing:0.1em;">Worth</p>
      <p style="margin:0;font-size:1.5rem;font-weight:800;color:#3D5230;">$${(balance / 2000).toFixed(2)} off</p>
      <p style="margin:4px 0 0;font-size:0.72rem;color:#877B71;">at 2,000 points = $1</p>
    </div>
    ${balance >= 2000 ? `<a href="${redeemUrl || 'https://www.primalpantry.co.nz/primalpoints/login/'}" style="display:block;background:#3D5230;color:#fff;text-decoration:none;padding:14px;border-radius:10px;font-weight:700;text-align:center;font-size:0.9rem;">Redeem my points →</a>` : `<p style="margin:0;font-size:0.82rem;color:#877B71;">You need 2,000 points to start redeeming. Keep earning!</p>`}
    <p style="margin:16px 0 0;font-size:0.75rem;color:#C8A87A;">⭐ <strong>Earning rate:</strong> 100 points per $1 spent (5% back). Points expire 60 days after they're earned.</p>
  </td></tr>
  <tr><td style="padding:16px 32px;border-top:1px solid #ede5d8;text-align:center;">
    <p style="margin:0;font-size:0.68rem;color:#9c9287;">PrimalPantry · New Zealand</p>
  </td></tr>
</table>
</td></tr>
</table>
</body></html>`;
}

function redemptionEmailHtml({ promoCode, dollarValue, expiryDate, newBalance, firstName }) {
  const name = firstName || 'there';
  const expiry = expiryDate
    ? new Date(expiryDate).toLocaleDateString('en-NZ', { day: 'numeric', month: 'long', year: 'numeric' })
    : '60 days';
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f5f0e8;font-family:'DM Sans',Helvetica,Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px;">
<tr><td align="center">
<table width="100%" style="max-width:520px;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
  <tr><td style="background:#2E1A0E;padding:32px;text-align:center;">
    <p style="margin:0 0 8px;font-size:0.68rem;font-weight:800;text-transform:uppercase;letter-spacing:0.18em;color:rgba(200,168,122,0.8);">PrimalPoints Redemption</p>
    <h1 style="margin:0;font-size:2rem;font-weight:800;color:#fff;">$${dollarValue} off</h1>
    <p style="margin:8px 0 0;font-size:0.9rem;color:rgba(255,255,255,0.7);">your next order — you earned it</p>
  </td></tr>
  <tr><td style="padding:32px;">
    <p style="margin:0 0 20px;font-size:0.95rem;color:#2E1A0E;line-height:1.6;">
      Hey ${name}, here's your discount code — apply it at checkout.
    </p>
    <!-- Code block -->
    <div style="background:#f5f0e8;border:2px dashed #C8A87A;border-radius:12px;padding:24px;text-align:center;margin-bottom:24px;">
      <p style="margin:0 0 6px;font-size:0.7rem;font-weight:700;text-transform:uppercase;letter-spacing:0.12em;color:#877B71;">Your code</p>
      <p style="margin:0;font-size:1.8rem;font-weight:900;color:#2E1A0E;letter-spacing:0.12em;">${promoCode}</p>
      <p style="margin:8px 0 0;font-size:0.72rem;color:#877B71;">Expires ${expiry} · One use only</p>
    </div>
    <p style="margin:0 0 16px;font-size:0.82rem;color:#877B71;line-height:1.6;">
      Enter this code at checkout on <a href="https://www.primalpantry.co.nz" style="color:#3D5230;">primalpantry.co.nz</a>.
      Your remaining balance is <strong style="color:#3D5230;">${newBalance.toLocaleString()} pts</strong>.
    </p>
    <a href="https://www.primalpantry.co.nz/shop/" style="display:block;background:#3D5230;color:#fff;text-decoration:none;padding:14px;border-radius:10px;font-weight:700;text-align:center;font-size:0.9rem;">Shop now →</a>
  </td></tr>
  <tr><td style="padding:16px 32px;border-top:1px solid #ede5d8;text-align:center;">
    <p style="margin:0;font-size:0.68rem;color:#9c9287;">PrimalPantry · New Zealand</p>
  </td></tr>
</table>
</td></tr>
</table>
</body></html>`;
}

function expiringEmailHtml({ expiringPoints, expiryDate, balance, firstName }) {
  const name = firstName || 'there';
  const expiry = new Date(expiryDate).toLocaleDateString('en-NZ', { day: 'numeric', month: 'long', year: 'numeric' });
  const daysLeft = Math.ceil((new Date(expiryDate) - Date.now()) / (1000 * 60 * 60 * 24));
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f5f0e8;font-family:'DM Sans',Helvetica,Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px;">
<tr><td align="center">
<table width="100%" style="max-width:520px;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
  <tr><td style="background:#C8A87A;padding:32px;text-align:center;">
    <p style="margin:0 0 6px;font-size:0.68rem;font-weight:800;text-transform:uppercase;letter-spacing:0.18em;color:rgba(255,255,255,0.75);">PrimalPoints — Heads Up</p>
    <h1 style="margin:0;font-size:1.8rem;font-weight:800;color:#fff;line-height:1.2;">${expiringPoints.toLocaleString()} points<br>expire in ${daysLeft} day${daysLeft !== 1 ? 's' : ''}</h1>
  </td></tr>
  <tr><td style="padding:32px;">
    <p style="margin:0 0 16px;font-size:0.95rem;color:#2E1A0E;line-height:1.6;">
      Hey ${name} — just a heads up that <strong>${expiringPoints.toLocaleString()} of your PrimalPoints</strong> expire on <strong>${expiry}</strong>.
    </p>
    <p style="margin:0 0 20px;font-size:0.85rem;color:#877B71;line-height:1.6;">
      Your total balance is <strong style="color:#3D5230;">${balance.toLocaleString()} pts</strong> — worth <strong style="color:#3D5230;">$${(balance / 2000).toFixed(2)}</strong> off your next order.
    </p>
    <a href="https://www.primalpantry.co.nz/shop/" style="display:block;background:#3D5230;color:#fff;text-decoration:none;padding:14px;border-radius:10px;font-weight:700;text-align:center;font-size:0.9rem;margin-bottom:16px;">Shop before they expire →</a>
    <p style="margin:0;font-size:0.72rem;color:#C8A87A;">⭐ <strong>How to redeem:</strong> Your discount code is generated automatically at checkout on the thank-you page after your next order.</p>
  </td></tr>
  <tr><td style="padding:16px 32px;border-top:1px solid #ede5d8;text-align:center;">
    <p style="margin:0;font-size:0.68rem;color:#9c9287;">PrimalPantry · New Zealand</p>
  </td></tr>
</table>
</td></tr>
</table>
</body></html>`;
}

// ── HTTP Handler ─────────────────────────────────────────────────────────────

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: HEADERS, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: HEADERS, body: JSON.stringify({ error: 'Method not allowed' }) };

  try {
    const { type, to, data } = JSON.parse(event.body || '{}');
    if (!type || !to) return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: 'type and to required' }) };

    let subject, html;

    if (type === 'spin_invite') {
      subject = 'You\'ve got a spin waiting — crack the code';
      html = spinInviteHtml(data || {});
    } else if (type === 'balance_update') {
      subject = `Your PrimalPoints balance: ${(data?.balance || 0).toLocaleString()} pts`;
      html = balanceUpdateHtml(data || {});
    } else if (type === 'redemption') {
      subject = `Your $${data?.dollarValue || ''} PrimalPoints code is here`;
      html = redemptionEmailHtml(data || {});
    } else if (type === 'expiring') {
      subject = `${(data?.expiringPoints || 0).toLocaleString()} PrimalPoints expire soon`;
      html = expiringEmailHtml(data || {});
    } else {
      return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: 'Unknown email type' }) };
    }

    const ok = await sendEmail({ to, subject, html });
    return { statusCode: ok ? 200 : 500, headers: HEADERS, body: JSON.stringify({ ok }) };
  } catch (err) {
    console.error('[loyalty-send-email]', err.message);
    return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ error: 'Internal error' }) };
  }
};

exports.spinInviteHtml = spinInviteHtml;
exports.balanceUpdateHtml = balanceUpdateHtml;
exports.redemptionEmailHtml = redemptionEmailHtml;
exports.expiringEmailHtml = expiringEmailHtml;
