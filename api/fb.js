export default async function handler(req, res) {
  if (req.method === 'GET') {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    if (mode === 'subscribe' && token === process.env.FB_VERIFY_TOKEN) {
      return res.status(200).send(challenge);
    } else {
      return res.status(403).send('Forbidden');
    }
  }

  if (req.method === 'POST') {
    const body = req.body;
    const apiKey = process.env.ANTHROPIC_API_KEY;
    const pageToken = process.env.FB_PAGE_TOKEN;
    const igToken = process.env.IG_ACCESS_TOKEN;

    const systemPrompt = `你是 KaiX 汽車的 AI 客服助理。請用親切專業的繁體中文回答客戶問題。
如果客戶詢問特定車款，告訴他們可以傳送照片或詢問詳細需求。
如果客戶要預約看車，請他們提供想看車的時間，你會幫他們安排。
保持回答簡潔，不超過200字。`;

    console.log('收到資料:', JSON.stringify(body));

    try {
      const isInstagram = body.object === 'instagram';
      const accessToken = isInstagram ? igToken : pageToken;
      const entries = body.entry || [];

      for (const entry of entries) {
        const events = entry.messaging || [];
        for (const event of events) {
          if (!event.message || !event.message.text || event.message.is_echo) continue;
          const senderId = event.sender.id;
          const userMessage = event.message.text;
          console.log('處理訊息:', senderId, userMessage);
          await replyWithClaude(senderId, userMessage, accessToken, apiKey, systemPrompt, isInstagram);
        }
      }
    } catch (error) {
      console.error('Error:', error);
    }

    return res.status(200).send('OK');
  }
}

async function replyWithClaude(senderId, userMessage, accessToken, apiKey, systemPrompt, isInstagram) {
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
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    }),
  });

  const aiData = await aiResponse.json();
  const replyText = aiData.content?.[0]?.text || '您好！感謝您的詢問，我們會盡快回覆您。';

  console.log('回覆:', replyText);

  const apiVersion = isInstagram ? 'v21.0' : 'v18.0';

  const replyRes = await fetch(`https://graph.facebook.com/${apiVersion}/me/messages?access_token=${accessToken}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      recipient: { id: senderId },
      message: { text: replyText },
    }),
  });

  const replyData = await replyRes.json();
  console.log('回覆結果:', JSON.stringify(replyData));
}
