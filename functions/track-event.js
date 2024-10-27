const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

exports.handler = async (event) => {
  try {
    console.log("Starting track-event function...");

    if (!event.body) {
      throw new Error('No data received in the request body');
    }

    const { action, value, currency, userData } = JSON.parse(event.body);
    console.log("Parsed request data:", { action, value, currency, userData });

    const accessToken = 'EAALoG9CF1ZCYBOyvZAbhR9ygXqcy7SUZB43l5t9oQ9rClWQVpYe2Wfi1RcAgheI49dvjiR6kRDI4pXFlt62uFcZAQFdjRuOSc8uukd6aPMFBMOuWNYFaxMHTot8xw8ZALcwSrWsnuuCRokJSyMKLaIBimmnrAG2IZBRivEK4wfbxl2iVOfdbNlXW9BbJ3qZBJAH8gZDZD';
    const pixelId = '809100344281173';
    const eventId = Date.now() + "_" + Math.random();
    const testEventCode = "TEST59478"; // Add your test code here

    // Parameter validation checks
    if (!action || typeof action !== 'string') {
      console.warn("Invalid or missing action:", action);
      throw new Error("Invalid or missing 'action' parameter");
    }

    if (!currency || typeof currency !== 'string' || currency.length !== 3) {
      console.warn("Invalid or missing currency:", currency);
      throw new Error("Invalid or missing 'currency' parameter - should be a 3-letter ISO code");
    }

    if (value === undefined || isNaN(parseFloat(value))) {
      console.warn("Invalid or missing value (total cost):", value);
      throw new Error("Invalid or missing 'value' parameter");
    }

    if (!userData || typeof userData !== 'object' || !userData.em) {
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
              currency: currency.toUpperCase(),
              value: parseFloat(value),
            },
            action_source: 'website',
            event_id: eventId,
            test_event_code: testEventCode // Add the test_event_code here
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