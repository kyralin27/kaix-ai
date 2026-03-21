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

    try {
      console.log('收到資料:', JSON.stringify(body));
      const entries = body.entry || [];
      for (const entry of entries) {
        // 同時檢查 messaging 和 changes（IG 用 changes）
        const messagingEvents = entry.messaging || [];
        const changesEvents = (entry.changes || [])
          .filter(c => c.field === 'messages')
          .map(c => c.value);

        // 處理 FB Messenger
        for (const event of messagingEvents) {
          if (!event.message || !event.message.text) continue;
          const senderId = event.sender.id;
          const userMessage = event.message.text;
          await replyWithClaude(senderId, userMessage, pageToken, apiKey, systemPrompt);
        }

        // 處理 IG
        for (const change of changesEvents) {
          if (!change.messages) continue;
          for (const msg of change.messages) {
            if (!msg.text) continue;
            const senderId = change.sender.id || msg.from?.id;
            const userMessage = msg.text;
            await replyWithClaude(senderId, userMessage, igToken, apiKey, systemPrompt);
          }
        }
      }
    } catch (error) {
      console.error('Error:', error);
    }

    return res.status(200).send('OK');
  }
}

async function replyWithClaude(senderId, userMessage, accessToken, apiKey, systemPrompt) {
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

  await fetch(`https://graph.facebook.com/v18.0/me/messages?access_token=${accessToken}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      recipient: { id: senderId },
      message: { text: replyText },
    }),
  });
}
