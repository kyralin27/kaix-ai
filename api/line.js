import crypto from 'crypto';

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');

  // Verification GET request from LINE
  if (req.method === 'GET') {
    res.status(200).send('OK');
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).send('Method Not Allowed');
    return;
  }

  const channelSecret = process.env.LINE_CHANNEL_SECRET;
  const accessToken   = process.env.LINE_CHANNEL_TOKEN;
  const apiKey        = process.env.ANTHROPIC_API_KEY;

  // Verify LINE signature
  const signature = req.headers['x-line-signature'];
  const body = JSON.stringify(req.body);
  const hash = crypto
    .createHmac('sha256', channelSecret)
    .update(body)
    .digest('base64');

  if (signature !== hash) {
    res.status(401).send('Unauthorized');
    return;
  }

  const events = req.body.events || [];

  for (const event of events) {
    if (event.type !== 'message' || event.message.type !== 'text') continue;

    const userMessage = event.message.text;
    const replyToken  = event.replyToken;

    // Get inventory from a simple storage (you can expand this later)
    const inventoryContext = `你是 KaiX 汽車的 AI 客服助理。請用親切專業的繁體中文回答客戶問題。
如果客戶詢問特定車款，告訴他們可以傳送照片或詢問詳細需求。
如果客戶要預約看車，請他們提供想看車的時間，你會幫他們安排。
保持回答簡潔，不超過200字。`;

    try {
      // Call Claude AI
      const aiResponse = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-5',
          max_tokens: 500,
          system: inventoryContext,
          messages: [{ role: 'user', content: userMessage }],
        }),
      });

      const aiData = await aiResponse.json();
      const replyText = aiData.content?.[0]?.text || '您好！感謝您的詢問，我們會盡快回覆您。';

      // Reply to LINE
      await fetch('https://api.line.me/v2/bot/message/reply', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          replyToken,
          messages: [{ type: 'text', text: replyText }],
        }),
      });

    } catch (error) {
      console.error('Error:', error);
      // Send fallback message
      await fetch('https://api.line.me/v2/bot/message/reply', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          replyToken,
          messages: [{ type: 'text', text: '您好！感謝您的詢問，請稍後我們將盡快回覆您 🙏' }],
        }),
      });
    }
  }

  res.status(200).send('OK');
}
