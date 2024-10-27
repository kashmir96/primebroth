const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

exports.handler = async (event) => {
  try {
    console.log("Starting track-event function...");

    const accessToken = 'YOUR_FACEBOOK_ACCESS_TOKEN';
    const pixelId = 'YOUR_PIXEL_ID';

    // Hardcode a minimal payload with value as a floating-point number
    const payload = JSON.stringify({
      data: [
        {
          event_name: "Purchase",
          event_time: Math.floor(Date.now() / 1000),
          action_source: "website",
          custom_data: {
            currency: "NZD",          // Ensure currency is in ISO format
            value: parseFloat(87.9)   // Hardcoded total amount as a float
          },
          user_data: {
            em: "hashed_email_here"   // Example of hashed email
          }
        }
      ]
    });

    console.log("Payload sent to Facebook:", payload);

    const response = await fetch(`https://graph.facebook.com/v13.0/${pixelId}/events?access_token=${accessToken}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
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
