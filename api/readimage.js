export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
  if (!ANTHROPIC_KEY) { res.status(500).json({ error: 'API Key 未設定' }); return; }

  const { image } = req.body;
  if (!image) { res.status(400).json({ error: '沒有收到圖片' }); return; }

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-opus-4-5',
        max_tokens: 500,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: 'image/jpeg', data: image }
            },
            {
              type: 'text',
              text: `這是中醫診所的每日報表。請讀取以下數字並以JSON格式回傳，找不到的欄位填null：
{
  "morning": 早診人數（健保初診+複診合計，或從"早診"欄位讀取）,
  "afternoon": 午診人數,
  "evening": 晚診人數,
  "total_patients": 總人頭數,
  "facial": 美顏針人次（自費），
  "needleknife": 針刀人次（自費），
  "herbal_custom": 客製水藥張數,
  "herbal_growth": 轉骨水藥張數,
  "revenue": 實收金額（數字，不含$符號）,
  "selfpay_amount": 自費金額合計,
  "doctor_details": "各醫師姓名:自費人次:自費金額的字串，用分號分隔"
}
只回傳JSON，不要其他文字。`
            }
          ]
        }]
      })
    });

    const result = await response.json();
    const text = result.content?.[0]?.text || '';
    let data = {};
    try {
      const clean = text.replace(/```json|```/g, '').trim();
      data = JSON.parse(clean.match(/\{[\s\S]*\}/)?.[0] || clean);
    } catch(e) {
      return res.status(400).json({ error: '無法解析AI回傳的數字，請手動填寫' });
    }
    res.status(200).json({ success: true, data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
