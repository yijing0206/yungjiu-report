export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  const NOTION_TOKEN = process.env.NOTION_TOKEN;
  // 針刀和轉骨各自的 data source ID
  const DB_NEEDLEKNIFE = process.env.DB_NEEDLEKNIFE || '8562ef64-a59c-4b61-bb22-57d1723b10ed';
  const DB_GROWTH      = process.env.DB_GROWTH      || '1ce45d8a-0b17-4962-b46a-676a4d6de3fb';

  if (!NOTION_TOKEN) { res.status(500).json({ error: '環境變數未設定' }); return; }

  const { name, chart_no, therapy, date } = req.body;
  // therapy: 'needleknife' | 'growth'
  if (!name || !therapy) { res.status(400).json({ error: '缺少必要欄位' }); return; }

  const isNK = therapy === 'needleknife';
  const daysToFirst = isNK ? 7 : 14;
  const dbId = isNK ? DB_NEEDLEKNIFE : DB_GROWTH;

  const today = date ? new Date(date) : new Date();
  const firstVisit = new Date(today);
  firstVisit.setDate(firstVisit.getDate() + daysToFirst);
  const firstVisitStr = firstVisit.toISOString().split('T')[0];
  const todayStr = today.toISOString().split('T')[0];

  const props = {
    "姓名": { title: [{ text: { content: name } }] },
    "病歷號": { rich_text: [{ text: { content: chart_no || '' } }] },
    "預約狀態": { select: { name: '需預約' } },
    "date:初診日期:start": todayStr,
    "date:初診日期:is_datetime": 0,
    "date:下次回診日:start": firstVisitStr,
    "date:下次回診日:is_datetime": 0,
  };

  if (isNK) {
    props["階段"] = { select: { name: '密集期' } };
    props["已完成次數"] = { number: 0 };
  } else {
    props["階段"] = { select: { name: '初診追蹤' } };
  }

  try {
    // Notion API 用 database_id 寫入，這裡用 data source 對應的 database
    const dbMap = {
      '8562ef64-a59c-4b61-bb22-57d1723b10ed': 'c7f6417629714133b9f72222dc23ae4c', // 針刀
      '1ce45d8a-0b17-4962-b46a-676a4d6de3fb': 'ce25d630e14c4c9f945c3f5bb68f7bb2', // 轉骨
    };
    const notionDbId = dbMap[dbId] || dbId;

    // 重新整理 properties 為 Notion API 格式
    const notionProps = {
      "姓名": { title: [{ text: { content: name } }] },
      "病歷號": { rich_text: [{ text: { content: chart_no || '' } }] },
      "預約狀態": { select: { name: '需預約' } },
      "初診日期": { date: { start: todayStr } },
      "下次回診日": { date: { start: firstVisitStr } },
    };
    if (isNK) {
      notionProps["階段"] = { select: { name: '密集期' } };
      notionProps["已完成次數"] = { number: 0 };
    } else {
      notionProps["階段"] = { select: { name: '初診追蹤' } };
    }

    const response = await fetch('https://api.notion.com/v1/pages', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${NOTION_TOKEN}`,
        'Content-Type': 'application/json',
        'Notion-Version': '2022-06-28',
      },
      body: JSON.stringify({ parent: { database_id: notionDbId }, properties: notionProps }),
    });
    const result = await response.json();
    if (!response.ok) { res.status(400).json({ error: result.message || '寫入失敗' }); return; }
    res.status(200).json({ success: true, firstVisit: firstVisitStr });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
