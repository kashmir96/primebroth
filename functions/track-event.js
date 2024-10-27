const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

exports.handler = async (event) => {
  try {
    if (!event.body) {
      throw new Error('No data received in the request body');
    }

    const { action, cartTotal, currency, userData } = JSON.parse(event.body);

    const accessToken = 'EAALoG9CF1ZCYBO3Xx2ZAVAK6Cs2h4XgY55ZA17KQZCGPIXaYlG5NZCP8cXzXZBocH95qb0IGiI22wwZBFRu77fgyDXDHIHi7OhcNjDtXfBnyGNU93mTJDbWD8YMiSZBEk4xgw851GBI1mEMvvMbE7zBHhxOk43akaPmsryIae3XMqQXa44OmPi5gLStAqgTfuKYYvQZDZD';
    const pixelId = '809100344281173';

    const eventId = Date.now() + "_" + Math.random();

    const response = await fetch(`https://graph.facebook.com/v13.0/${pixelId}/events?access_token=${accessToken}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        data: [
          {
            event_name: action,
            event_time: Math.floor(Date.now() / 1000),
            user_data: userData,
            custom_data: {
              currency: currency,
              value: parseFloat(cartTotal),
            },
            action_source: 'website',
            event_id: eventId,
          },
        ],
      }),
    });

    if (!response.ok) throw new Error('Failed to send conversion data');

    const responseBody = await response.json();

    return {
      statusCode: 200,
      body: JSON.stringify({ message: 'Conversion data sent successfully', response: responseBody }),
    };

  } catch (error) {
    console.error('Error in track-event function:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Server error in track-event function' }),
    };
  }
};
