/**
 * quiz-progress.js
 *
 * Saves partial quiz progress so we can track where users drop off.
 * Upserts to quiz_sessions table keyed on session_id.
 *
 * Called client-side on every step advance (fire-and-forget).
 *
 * Env vars required:
 *   SUPABASE_URL          — Supabase project URL
 *   SUPABASE_SERVICE_KEY  — Supabase service_role key
 *
 * Supabase table required:
 *   CREATE TABLE quiz_sessions (
 *     id              BIGSERIAL PRIMARY KEY,
 *     session_id      TEXT UNIQUE NOT NULL,
 *     step_index      INT,
 *     step_name       TEXT,
 *     answers         JSONB,
 *     completed       BOOLEAN DEFAULT FALSE,
 *     email           TEXT,
 *     utm_source      TEXT,
 *     utm_medium      TEXT,
 *     utm_campaign    TEXT,
 *     referrer        TEXT,
 *     landing_page    TEXT,
 *     created_at      TIMESTAMPTZ DEFAULT NOW(),
 *     updated_at      TIMESTAMPTZ DEFAULT NOW()
 *   );
 */

const HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: HEADERS, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: HEADERS, body: JSON.stringify({ error: 'Method not allowed' }) };

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ error: 'Missing env' }) };

  try {
    const { sessionId, stepIndex, stepName, answers, completed, utm } = JSON.parse(event.body || '{}');
    if (!sessionId) return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: 'Missing sessionId' }) };

    const record = {
      session_id:   sessionId,
      step_index:   stepIndex ?? 0,
      step_name:    stepName || null,
      answers:      answers || {},
      completed:    completed === true,
      email:        (answers && answers.email) || null,
      utm_source:   (utm && utm.source) || null,
      utm_medium:   (utm && utm.medium) || null,
      utm_campaign: (utm && utm.campaign) || null,
      referrer:     (utm && utm.referrer) || null,
      landing_page: (utm && utm.landingPage) || null,
      updated_at:   new Date().toISOString(),
    };

    const res = await fetch(`${url}/rest/v1/quiz_sessions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: key,
        Authorization: `Bearer ${key}`,
        Prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify(record),
    });

    if (!res.ok) {
      const text = await res.text();
      console.error('[quiz-progress] Supabase error:', res.status, text);
      return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ error: 'DB error' }) };
    }

    return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ ok: true }) };
  } catch (err) {
    console.error('[quiz-progress] Error:', err.message);
    return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ error: 'Internal error' }) };
  }
};
