export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-api-key');

  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) { res.status(500).json({ error: 'Server API key not configured' }); return; }

  try {
    const body = req.body;
    
    // Log for debugging
    console.log('Request body keys:', Object.keys(body || {}));
    console.log('Model:', body?.model);
    
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    });
    
    const text = await response.text();
    console.log('Anthropic response status:', response.status);
    console.log('Anthropic response:', text.slice(0, 200));
    
    try {
      const data = JSON.parse(text);
      res.status(response.status).json(data);
    } catch(e) {
      res.status(500).json({ error: 'Invalid response from Anthropic', raw: text.slice(0, 500) });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}
