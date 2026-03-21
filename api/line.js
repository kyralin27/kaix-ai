import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';

// ── Supabase 初始化 ──────────────────────────────────────────
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// ── 工具函式 ─────────────────────────────────────────────────

// 下載 LINE 圖片並轉 base64
async function downloadLineImage(messageId, accessToken) {
  const res = await fetch(`https://api-data.line.me/v2/bot/message/${messageId}/content`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const buffer = await res.arrayBuffer();
  return Buffer.from(buffer).toString('base64');
}

// 用 Claude Vision 辨識行照 → 回傳結構化資料
async function ocrLicense(base64Image, apiKey) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-5',
      max_tokens: 500,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: 'image/jpeg', data: base64Image },
          },
          {
            type: 'text',
            text: `這是一張台灣汽車行照或車輛照片，請辨識並以 JSON 格式回傳以下欄位（無法辨識的欄位填 null）：
{
  "plate_number": "車牌號碼",
  "brand": "品牌（如 Toyota）",
  "model": "型號（如 Camry 2.5）",
  "year": 出廠年份數字,
  "engine_cc": 排氣量數字,
  "vin": "車身號碼"
}
只回傳 JSON，不要其他文字。`,
          },
        ],
      }],
    }),
  });
  const data = await res.json();
  const text = data.content?.[0]?.text || '{}';
  try {
    return JSON.parse(text.replace(/```json|```/g, '').trim());
  } catch {
    return {};
  }
}

// 用 Claude 生成三版文案
async function generateCopies(carInfo, apiKey) {
  const carDesc = `
品牌：${carInfo.brand || '未知'} ${carInfo.model || ''}
年份：${carInfo.year || '未知'}
排氣量：${carInfo.engine_cc ? carInfo.engine_cc + 'cc' : '未知'}
里程：${carInfo.mileage ? carInfo.mileage + 'km' : '未知'}
配備：${(carInfo.features || []).join('、') || '待確認'}
`.trim();

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-5',
      max_tokens: 1000,
      messages: [{
        role: 'user',
        content: `根據以下車輛資訊，用繁體中文生成三種風格的銷售文案，以 JSON 格式回傳：

${carDesc}

格式：
{
  "pro": "專業規格版文案（條列規格，適合內行買家，100字內）",
  "fb": "FB爆款吸引版文案（emoji豐富、製造驚喜感，150字內）",
  "honest": "老實誠信版文案（真實描述優缺點，建立信任感，100字內）"
}
只回傳 JSON，不要其他文字。`,
      }],
    }),
  });
  const data = await res.json();
  const text = data.content?.[0]?.text || '{}';
  try {
    return JSON.parse(text.replace(/```json|```/g, '').trim());
  } catch {
    return { pro: '', fb: '', honest: '' };
  }
}

// 回覆 LINE 訊息
async function replyLine(replyToken, messages, accessToken) {
  await fetch('https://api.line.me/v2/bot/message/reply', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ replyToken, messages }),
  });
}

// 查詢庫存（給客戶端 AI 用）
async function getInventory() {
  const { data } = await supabase
    .from('cars')
    .select('brand, model, year, mileage, price, features, status')
    .eq('status', 'available')
    .limit(20);
  return data || [];
}

// ── 主處理器 ─────────────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (req.method === 'GET') { res.status(200).send('OK'); return; }
  if (req.method !== 'POST') { res.status(405).send('Method Not Allowed'); return; }

  const channelSecret = process.env.LINE_CHANNEL_SECRET;
  const accessToken   = process.env.LINE_CHANNEL_TOKEN;
  const apiKey        = process.env.ANTHROPIC_API_KEY;

  // 驗證 LINE 簽名
  const signature = req.headers['x-line-signature'];
  const body = JSON.stringify(req.body);
  const hash = crypto.createHmac('sha256', channelSecret).update(body).digest('base64');
  if (signature !== hash) { res.status(401).send('Unauthorized'); return; }

  const events = req.body.events || [];

  for (const event of events) {
    if (event.type !== 'message') continue;

    const replyToken = event.replyToken;
    const msgType    = event.message.type;

    // ── 圖片訊息：老闆上傳行照 ──────────────────────────────
    if (msgType === 'image') {
      try {
        // 1. 先回覆「辨識中」
        await replyLine(replyToken, [{ type: 'text', text: '📸 收到圖片，辨識中，請稍候...' }], accessToken);

        // 2. 下載圖片
        const base64 = await downloadLineImage(event.message.id, accessToken);

        // 3. OCR 辨識
        const carInfo = await ocrLicense(base64, apiKey);

        // 4. 生成三版文案
        const copies = await generateCopies(carInfo, apiKey);

        // 5. 寫入 Supabase
        const { error } = await supabase
          .from('cars')
          .insert({
            plate_number: carInfo.plate_number,
            brand:        carInfo.brand,
            model:        carInfo.model,
            year:         carInfo.year,
            engine_cc:    carInfo.engine_cc,
            vin:          carInfo.vin,
            copy_pro:     copies.pro,
            copy_fb:      copies.fb,
            copy_honest:  copies.honest,
            status:       'available',
          });

        if (error) throw error;

        // 6. Push 辨識結果 + 三版文案給老闆
        await fetch('https://api.line.me/v2/bot/message/push', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({
            to: event.source.userId,
            messages: [
              {
                type: 'text',
                text: `✅ 車輛已建立！\n\n` +
                  `🚗 ${carInfo.brand || '?'} ${carInfo.model || '?'}\n` +
                  `📅 年份：${carInfo.year || '?'}\n` +
                  `🔧 排氣量：${carInfo.engine_cc || '?'}cc\n` +
                  `🪪 車牌：${carInfo.plate_number || '?'}\n` +
                  `🆔 車身號碼：${carInfo.vin || '?'}\n\n` +
                  `📝 請到後台補充里程與售價！`,
              },
              {
                type: 'text',
                text: `📋 三版文案：\n\n` +
                  `【專業版】\n${copies.pro}\n\n` +
                  `【FB爆款版】\n${copies.fb}\n\n` +
                  `【誠信版】\n${copies.honest}`,
              },
            ],
          }),
        });

      } catch (err) {
        console.error('圖片處理錯誤:', err);
        await fetch('https://api.line.me/v2/bot/message/push', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({
            to: event.source.userId,
            messages: [{ type: 'text', text: '❌ 辨識失敗，請確認圖片是否清晰，或手動輸入車輛資訊。' }],
          }),
        });
      }
      continue;
    }

    // ── 文字訊息：客戶詢車 ───────────────────────────────────
    if (msgType === 'text') {
      const userMessage = event.message.text;

      try {
        // 從資料庫拉庫存
        const inventory = await getInventory();
        const inventoryText = inventory.length > 0
          ? inventory.map(c =>
              `• ${c.brand} ${c.model}（${c.year}年，${c.mileage ? c.mileage + 'km' : '里程待填'}，${c.price ? '$' + c.price.toLocaleString() : '價格洽談'}）`
            ).join('\n')
          : '目前庫存更新中，請直接詢問。';

        const systemPrompt = `你是 KaiX 汽車的 AI 客服助理，請用親切專業的繁體中文回答客戶問題。

【目前庫存】
${inventoryText}

【回覆規則】
- 客戶問有無某車款，根據庫存如實回答
- 客戶問車況細節，告知可以安排看車
- 客戶要預約，請他提供「姓名」和「希望看車時間」
- 回答簡潔，不超過 150 字`;

        const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
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

        const aiData = await aiRes.json();
        const replyText = aiData.content?.[0]?.text || '您好！感謝您的詢問，我們會盡快回覆您。';

        // 記錄詢問到資料庫
        await supabase.from('inquiries').insert({
          platform: 'line',
          user_id: event.source.userId,
          message: userMessage,
        });

        await replyLine(replyToken, [{ type: 'text', text: replyText }], accessToken);

      } catch (err) {
        console.error('文字處理錯誤:', err);
        await replyLine(replyToken, [{ type: 'text', text: '您好！感謝您的詢問，請稍後我們將盡快回覆您 🙏' }], accessToken);
      }
    }
  }

  res.status(200).send('OK');
}
