/**
 * quiz-stats.js
 *
 * Returns public-facing quiz conversion stats for display on the quiz page.
 * Cached for 5 minutes to avoid hammering Supabase.
 */

const HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
  'Cache-Control': 'public, max-age=300',
};

let cachedStats = null;
let cacheTime = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: HEADERS, body: '' };
  }

  // Return cached if fresh
  if (cachedStats && Date.now() - cacheTime < CACHE_TTL) {
    return { statusCode: 200, headers: HEADERS, body: JSON.stringify(cachedStats) };
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ quizzes: 0, orders: 0, revenue: 0 }) };
  }

  const headers = {
    'Content-Type': 'application/json',
    apikey: supabaseKey,
    Authorization: `Bearer ${supabaseKey}`,
  };

  try {
    // Count total quiz submissions
    const quizRes = await fetch(`${supabaseUrl}/rest/v1/quiz_leads?select=id`, {
      headers: { ...headers, Prefer: 'count=exact' },
      method: 'HEAD',
    });
    const quizCount = parseInt(quizRes.headers.get('content-range')?.split('/')[1] || '0', 10);

    // Count converted quizzes (have order_id) and sum revenue
    const convertedRes = await fetch(`${supabaseUrl}/rest/v1/quiz_leads?order_id=not.is.null&select=order_id`, {
      headers,
    });
    const converted = await convertedRes.json();
    const orderIds = (converted || []).map(c => c.order_id).filter(Boolean);

    let revenue = 0;
    if (orderIds.length > 0) {
      const orderRes = await fetch(`${supabaseUrl}/rest/v1/orders?id=in.(${orderIds.join(',')})&select=total_value`, {
        headers,
      });
      const orders = await orderRes.json();
      revenue = (orders || []).reduce((sum, o) => sum + (o.total_value || 0), 0);
    }

    // Referral stats
    const referralSentRes = await fetch(`${supabaseUrl}/rest/v1/quiz_referrals?select=id`, {
      headers: { ...headers, Prefer: 'count=exact' },
      method: 'HEAD',
    });
    const referralSentCount = parseInt(referralSentRes.headers.get('content-range')?.split('/')[1] || '0', 10);

    const referralRedeemedRes = await fetch(`${supabaseUrl}/rest/v1/quiz_referrals?referrer_rewarded=eq.true&select=id`, {
      headers: { ...headers, Prefer: 'count=exact' },
      method: 'HEAD',
    });
    const referralRedeemedCount = parseInt(referralRedeemedRes.headers.get('content-range')?.split('/')[1] || '0', 10);

    cachedStats = {
      quizzes: quizCount,
      orders: orderIds.length,
      revenue: Math.round(revenue),
      referrals_sent: referralSentCount,
      referrals_redeemed: referralRedeemedCount,
    };
    cacheTime = Date.now();

    return { statusCode: 200, headers: HEADERS, body: JSON.stringify(cachedStats) };
  } catch (err) {
    console.error('[quiz-stats] Error:', err.message);
    return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ quizzes: 0, orders: 0, revenue: 0 }) };
  }
};
