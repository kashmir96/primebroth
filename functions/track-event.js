const fetch = require('node-fetch');

exports.handler = async (event) => {
  try {
    // Parse the data sent from the "Thank You" page
    const { action, cartTotal, currency, userData } = JSON.parse(event.body);

    const accessToken = 'EAALoG9CF1ZCYBO3Xx2ZAVAK6Cs2h4XgY55ZA17KQZCGPIXaYlG5NZCP8cXzXZBocH95qb0IGiI22wwZBFRu77fgyDXDHIHi7OhcNjDtXfBnyGNU93mTJDbWD8YMiSZBEk4xgw851GBI1mEMvvMbE7zBHhxOk43akaPmsryIae3XMqQXa44OmPi5gLStAqgTfuKYYvQZDZD'; // Replace with your Facebook Conversions API Access Token
    const pixelId = '809100344281173'; // Replace with your Facebook Pixel ID

    // Optional: Unique event ID for deduplication
    const eventId = Date.now() + "_" + Math.random();

    // Send data to Facebook Conversions API
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
            event_id: eventId, // Deduplication ID
          },
        ],
      }),
    });

    // Return success or error
    if (!response.ok) throw new Error('Failed to send conversion data');
    const responseBody = await response.json();

    return {
      statusCode: 200,
      body: JSON.stringify({ message: 'Conversion data sent successfully', response: responseBody }),
    };
  } catch (error) {
    console.error('Error sending conversion data:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Error sending conversion data' }),
    };
  }
};
