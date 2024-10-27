const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

exports.handler = async (event) => {
  try {
    console.log("Starting track-event function...");

    if (!event.body) {
      throw new Error('No data received in the request body');
    }

    // Parse data from the request body
    const { action, cartTotal, currency, userData } = JSON.parse(event.body);
    console.log("Parsed request data:", { action, cartTotal, currency, userData });

    const accessToken = 'EAALoG9CF1ZCYBO3Xx2ZAVAK6Cs2h4XgY55ZA17KQZCGPIXaYlG5NZCP8cXzXZBocH95qb0IGiI22wwZBFRu77fgyDXDHIHi7OhcNjDtXfBnyGNU93mTJDbWD8YMiSZBEk4xgw851GBI1mEMvvMbE7zBHhxOk43akaPmsryIae3XMqQXa44OmPi5gLStAqgTfuKYYvQZDZD';
    const pixelId = '809100344281173';
    const eventId = Date.now() + "_" + Math.random();

    // Parameter checks
    if (!action || typeof action !== 'string') {
      console.warn("Invalid or missing action:", action);
      throw new Error("Invalid or missing 'action' parameter");
    }

    if (!currency || typeof currency !== 'string') {
      console.warn("Invalid or missing currency:", currency);
      throw new Error("Invalid or missing 'currency' parameter");
    }

    if (!cartTotal || isNaN(parseFloat(cartTotal))) {
      console.warn("Invalid or missing cartTotal:", cartTotal);
      throw new Error("Invalid or missing 'cartTotal' parameter");
    }

    if (!userData || typeof userData !== 'object') {
      console.warn("Invalid or missing userData:", userData);
      throw new Error("Invalid or missing 'userData' parameter");
    }

    console.log("All parameters validated. Sending data to Facebook Conversions API...");

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

    const responseBody = await response.json();

    if (!response.ok) {
      console.error("Error response from Facebook API:", responseBody);
      throw new Error(`Failed to send conversion data to Facebook: ${responseBody.error?.message || 'Unknown error'}`);
    }

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
