/**
 * quiz-submit.js
 *
 * Handles skin compatibility quiz submissions:
 * 1. Generates a personalised blurb via Claude API
 * 2. Saves quiz lead to Supabase
 * 3. Optionally sends results email
 *
 * Env vars required:
 *   ANTHROPIC_API_KEY     — Claude API key
 *   SUPABASE_URL          — Supabase project URL
 *   SUPABASE_SERVICE_KEY  — Supabase service_role key
 */

const HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

function reply(code, body) {
  return { statusCode: code, headers: HEADERS, body: JSON.stringify(body) };
}

async function generateBlurb(answers, products) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  const concerns = (answers.concerns || []).join(', ');
  const areas = (answers.areas || []).join(', ');
  const preference = answers.preference === 'premium' ? 'premium targeted ingredients' : 'simple, traditional approach';
  const sensitivity = answers.sensitivity || 5;
  const productList = products.join(', ');

  const prompt = `You are a skincare advisor for Primal Pantry, a New Zealand tallow skincare brand. Write exactly 100 words as a personalised skin compatibility summary.

Customer profile:
- Concerns: ${concerns}
- Problem areas: ${areas}
- Prefers: ${preference}
- Sensitivity: ${sensitivity}/10
- Severity: ${answers.severity || 'n/a'}
- Matched products: ${productList}

Rules:
- Address the customer directly ("your skin", "you")
- Explain WHY each product is compatible with their specific skin profile
- If Reviana products are recommended, position them as premium and online-exclusive
- NEVER mention products being available in retail stores
- Emphasise how the products work together as a routine
- Mention specific ingredients that are relevant to their skin type
- Tone: knowledgeable, warm, confident — like a trusted advisor, not a salesperson
- CRITICAL: Do NOT make any therapeutic or medical claims. Do NOT use words like "heal", "cure", "treat", "relieve", "reduce inflammation", "anti-inflammatory", "soothe irritation", or any language that implies the products fix a medical condition. Instead, talk about skin compatibility, nourishment, moisture, and supporting healthy skin
- End with encouragement to try the full routine together`;

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 256,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!res.ok) {
      console.error('[quiz-submit] Claude API error:', res.status);
      return null;
    }

    const data = await res.json();
    return data.content && data.content[0] ? data.content[0].text : null;
  } catch (err) {
    console.error('[quiz-submit] Claude API error:', err.message);
    return null;
  }
}

async function saveToSupabase(answers, email, products, utm) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return;

  try {
    await fetch(`${url}/rest/v1/quiz_leads`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: key,
        Authorization: `Bearer ${key}`,
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({
        email: email || null,
        concerns: answers.concerns || [],
        areas: answers.areas || [],
        preference: answers.preference || null,
        sensitivity: answers.sensitivity || null,
        allergens: answers.allergens || [],
        severity: answers.severity || null,
        frequency: answers.frequency || null,
        age_group: answers.ageGroup || null,
        gender: answers.gender || null,
        tried_before: answers.triedBefore || [],
        recommended_products: products,
        utm_source: utm.source || null,
        utm_medium: utm.medium || null,
        utm_campaign: utm.campaign || null,
        utm_term: utm.term || null,
        utm_content: utm.content || null,
        referrer: utm.referrer || null,
        landing_page: utm.landingPage || null,
        created_at: new Date().toISOString(),
      }),
    });
  } catch (err) {
    console.error('[quiz-submit] Supabase save error:', err.message);
  }
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return reply(204, '');
  if (event.httpMethod !== 'POST') return reply(405, { error: 'Method not allowed' });

  try {
    const { answers, products, email, action, utm } = JSON.parse(event.body);

    // Generate blurb
    const blurb = await generateBlurb(answers, products || []);

    // Save lead
    await saveToSupabase(answers, email, products || [], utm || {});

    return reply(200, { blurb: blurb || '', saved: true });
  } catch (err) {
    console.error('[quiz-submit] Error:', err.message);
    return reply(500, { error: 'Internal error' });
  }
};
