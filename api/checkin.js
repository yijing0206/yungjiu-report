export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  const NOTION_TOKEN = process.env.NOTION_TOKEN;
  if (!NOTION_TOKEN) { res.status(500).json({ error: '環境變數未設定' }); return; }

  const { page_id, therapy } = req.body;
  if (!page_id) { res.status(400).json({ error: '缺少 page_id' }); return; }

  // 標記已回診：預約狀態改為「已預約」（代表這次回診完成）
  // 對於第一次追蹤，勾選後就結案追蹤（不再出現在提醒清單）
  const props = {
    "預約狀態": { select: { name: '已預約' } },
  };

  try {
    const response = await fetch(`https://api.notion.com/v1/pages/${page_id}`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${NOTION_TOKEN}`,
        'Content-Type': 'application/json',
        'Notion-Version': '2022-06-28',
      },
      body: JSON.stringify({ properties: props }),
    });
    const result = await response.json();
    if (!response.ok) { res.status(400).json({ error: result.message || '更新失敗' }); return; }
    res.status(200).json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
