import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// 查詢庫存
async function getInventory() {
  const { data } = await supabase
    .from('cars')
    .select('brand, model, year, mileage, price, features, status')
    .eq('status', 'available')
    .limit(20);
  return data || [];
}

// 組庫存文字
function buildInventoryText(inventory) {
  if (!inventory.length) return '目前庫存更新中，請直接詢問。';
  return inventory.map(c =>
    `• ${c.brand} ${c.model}（${c.year}年，${c.mileage ? c.mileage + 'km' : '里程待填'}，${c.price ? '$' + c.price.toLocaleString() : '價格洽談'}）`
  ).join('\n');
}

// 用 Claude 生成回覆
async function replyWithClaude(senderId, userMessage, accessToken, apiKey, platform) {
  // 拉庫存
  const inventory = await getInventory();
  const inventoryText = buildInventoryText(inventory);

  const systemPrompt = `你是 KaiX 汽車的 AI 客服助理，請用親切專業的繁體中文回答客戶問題。

【目前庫存】
${inventoryText}

【回覆規則】
- 客戶問有無某車款，根據庫存如實回答
- 客戶問車況細節，告知可以安排看車
- 客戶要預約，請他提供「姓名」和「希望看車時間」
- 回答簡潔，不超過 150 字`;

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

  // 記錄詢問（修正：用 try/catch 取代 .catch）
  try {
    await supabase.from('inquiries').insert({
      platform: platform,
      user_id: senderId,
      message: userMessage,
    });
  } catch (err) {
    console.error('記錄失敗:', err.message);
  }

  // 回覆訊息
  const apiVersion = platform === 'ig' ? 'v21.0' : 'v18.0';
  const replyRes = await fetch(`https://graph.facebook.com/${apiVersion}/me/messages?access_token=${accessToken}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      recipient: { id: senderId },
      message: { text: replyText },
    }),
  });

  const replyData = await replyRes.json();
  console.log(`[${platform}] 回覆結果:`, JSON.stringify(replyData));
}

export default async function handler(req, res) {
  // Webhook 驗證（GET）
  if (req.method === 'GET') {
    const mode      = req.query['hub.mode'];
    const token     = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    if (mode === 'subscribe' && token === process.env.FB_VERIFY_TOKEN) {
      return res.status(200).send(challenge);
    }
    return res.status(403).send('Forbidden');
  }

  // 接收訊息（POST）
  if (req.method === 'POST') {
    const body      = req.body;
    const apiKey    = process.env.ANTHROPIC_API_KEY;
    const pageToken = process.env.FB_PAGE_TOKEN;
    const igToken   = process.env.IG_ACCESS_TOKEN || process.env.FB_PAGE_TOKEN;

    console.log('收到資料:', JSON.stringify(body));

    try {
      const isInstagram = body.object === 'instagram';
      const accessToken = isInstagram ? igToken : pageToken;
      const platform    = isInstagram ? 'ig' : 'fb';
      const entries     = body.entry || [];

      for (const entry of entries) {
        const events = entry.messaging || [];
        for (const event of events) {
          if (!event.message || !event.message.text || event.message.is_echo) continue;
          const senderId    = event.sender.id;
          const userMessage = event.message.text;
          console.log(`[${platform}] 收到訊息:`, senderId, userMessage);
          await replyWithClaude(senderId, userMessage, accessToken, apiKey, platform);
        }
      }
    } catch (error) {
      console.error('Error:', error);
    }

    return res.status(200).send('OK');
  }
}
