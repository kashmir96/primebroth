const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

exports.handler = async () => {
  const accessToken = 'EAALoG9CF1ZCYBO3Xx2ZAVAK6Cs2h4XgY55ZA17KQZCGPIXaYlG5NZCP8cXzXZBocH95qb0IGiI22wwZBFRu77fgyDXDHIHi7OhcNjDtXfBnyGNU93mTJDbWD8YMiSZBEk4xgw851GBI1mEMvvMbE7zBHhxOk43akaPmsryIae3XMqQXa44OmPi5gLStAqgTfuKYYvQZDZD';
  const pixelId = '809100344281173';

  try {
    const response = await fetch(`https://graph.facebook.com/v13.0/${pixelId}/events?access_token=${accessToken}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        data: [
          {
            event_name: "Purchase",
            event_time: Math.floor(Date.now() / 1000),
            action_source: "website",
          }
        ],
      }),
    });

    const responseBody = await response.json();

    return response.ok
      ? {
          statusCode: 200,
          body: JSON.stringify({ message: 'Event sent successfully', response: responseBody }),
        }
      : {
          statusCode: response.status,
          body: JSON.stringify({ error: 'Failed to send event', details: responseBody.error?.message || 'Unknown error' }),
        };

  } catch (error) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Server error', details: error.message }),
    };
  }
};
