const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

exports.handler = async (event) => {
  try {
    console.log("Starting track-event function...");

    // Check if event body is present
    if (!event.body) {
      throw new Error('No data received in the request body');
    }

    console.log("Request body received:", event.body);

    // Parse data from the request body
    const { action, cartTotal, currency, userData } = JSON.parse(event.body);

    console.log("Parsed request data:", { action, cartTotal, currency, userData });

    const accessToken = 'EAALoG9CF1ZCYBO3Xx2ZAVAK6Cs2h4XgY55ZA17KQZCGPIXaYlG5NZCP8cXzXZBocH95qb0IGiI22wwZBFRu77fgyDXDHIHi7OhcNjDtXfBnyGNU93mTJDbWD8YMiSZBEk4xgw851GBI1mEMvvMbE7zBHhxOk43akaPmsryIae3XMqQXa44OmPi5gLStAqgTfuKYYvQZDZD'; // Replace with your Facebook Conversions API Access Token
    const pixelId = '809100344281173'; // Replace with your Facebook Pixel ID

    const eventId = Date.now() + "_" + Math.random();

    console.log("Sending data to Facebook Conversions API...");

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
            event_id: eventId,
          },
        ],
      }),
    });

    console.log("Facebook API response status:", response.status);

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Error response from Facebook API:", errorText);
      throw new Error('Failed to send conversion data to Facebook');
    }

    const responseBody = await response.json();
    console.log("Facebook API response:", responseBody);

    return {
      statusCode: 200,
      body: JSON.stringify({ message: 'Conversion data sent successfully', response: responseBody }),
    };

  } catch (error) {
    console.error('Error in track-event function:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Server error in track-event function', details: error.message }),
    };
  }
};
