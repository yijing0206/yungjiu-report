export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  const NOTION_TOKEN = process.env.NOTION_TOKEN;
  const DATABASE_ID  = process.env.DATABASE_ID;
  if (!NOTION_TOKEN || !DATABASE_ID) {
    res.status(500).json({ error: '環境變數未設定' }); return;
  }

  const d = req.body;

  // 計算填滿率
  const facialRate = d.slot_facial_total > 0
    ? Math.round((d.f || 0) / d.slot_facial_total * 100) : null;
  const nkRate = d.slot_nk_total > 0
    ? Math.round((d.nk || 0) / d.slot_nk_total * 100) : null;

  // 整體空檔填滿率
  const totalSlots = (d.slot_facial_total || 0) + (d.slot_nk_total || 0);
  const totalFilled = (d.f || 0) + (d.nk || 0);
  const overallRate = totalSlots > 0 ? Math.round(totalFilled / totalSlots * 100) : null;

  const props = {
    "日期":           { title: [{ text: { content: d.date || '' } }] },
    "早診人數":       { number: d.m  || 0 },
    "午診人數":       { number: d.a  || 0 },
    "晚診人數":       { number: d.e  || 0 },
    "美顏針人次":     { number: d.f  || 0 },
    "針刀人次":       { number: d.nk || 0 },
    "轉骨水藥張數":   { number: d.h1 || 0 },
    "客製水藥張數":   { number: d.h2 || 0 },
    "填報者":         { rich_text: [{ text: { content: d.reporter || '' } }] },
    "今日備注":       { rich_text: [{ text: { content: d.note || '' } }] },
    "今日跟進人數":   { number: d.fu || 0 },
    "成功轉預約":     { number: d.cv || 0 },
    "初診諮詢總數":   { number: d.np_consult || 0 },
    "美顏針開放格數": { number: d.slot_facial_total || 0 },
    "針刀開放格數":   { number: d.slot_nk_total || 0 },
  };

  // 填滿率（有值才存）
  if (facialRate !== null) props["美顏針填滿率"] = { number: facialRate };
  if (nkRate !== null)     props["針刀填滿率"]   = { number: nkRate };
  if (overallRate !== null) props["整體空檔填滿率"] = { number: overallRate };

  try {
    const response = await fetch('https://api.notion.com/v1/pages', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${NOTION_TOKEN}`,
        'Content-Type': 'application/json',
        'Notion-Version': '2022-06-28',
      },
      body: JSON.stringify({ parent: { database_id: DATABASE_ID }, properties: props }),
    });
    const result = await response.json();
    if (!response.ok) { res.status(400).json({ error: result.message || '寫入失敗' }); return; }
    res.status(200).json({ success: true, id: result.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
