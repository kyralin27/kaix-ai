import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) { res.status(500).json({ error: 'Server API key not configured' }); return; }

  try {
    // 1. 轉發請求給 Claude API
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(req.body),
    });

    const data = await response.json();

    // 2. 解析 Claude 回傳的車輛資料，存入 Supabase
    if (data.content?.[0]?.text) {
      try {
        const raw = data.content[0].text.replace(/```json\n?|\n?```/g, '').trim();
        const car = JSON.parse(raw);

        // 只有當辨識到廠牌或車牌時才儲存
        if (car['廠牌'] || car['車牌']) {
          // 里程轉數字
          const mileageStr = (car['里程'] || '').toString().replace(/[^0-9]/g, '');
          const mileage = mileageStr ? parseInt(mileageStr) : null;

          // 開價轉數字（萬→元）
          const priceStr = (car['開價'] || '').toString().replace(/[^0-9.]/g, '');
          const price = priceStr ? Math.round(parseFloat(priceStr) * 10000) : null;

          // 年份轉數字
          const yearStr = (car['年份'] || '').toString().replace(/[^0-9]/g, '');
          const year = yearStr ? parseInt(yearStr.slice(0, 4)) : null;

          // 排氣量轉數字
          const ccStr = (car['排氣量'] || '').toString().replace(/[^0-9]/g, '');
          const engineCc = ccStr ? parseInt(ccStr) : null;

          await supabase.from('cars').insert({
            plate_number: car['車牌'] || null,
            brand:        car['廠牌'] || null,
            model:        car['型號'] || null,
            year:         year,
            engine_cc:    engineCc,
            mileage:      mileage,
            vin:          car['車身號碼'] || null,
            price:        price,
            features:     car['配備'] || [],
            copy_pro:     car['文案_專業版'] || null,
            copy_fb:      car['文案_FB版'] || null,
            copy_honest:  car['文案_誠信版'] || null,
            status:       'available',
          });
        }
      } catch (parseErr) {
        // 解析或儲存失敗不影響前端回傳
        console.error('Supabase 儲存失敗:', parseErr.message);
      }
    }

    // 3. 回傳結果給前端（不變）
    res.status(response.status).json(data);

  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: error.message });
  }
}
