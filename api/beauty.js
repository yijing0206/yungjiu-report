export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const NOTION_TOKEN = process.env.NOTION_TOKEN;
  if (!NOTION_TOKEN) { res.status(500).json({ error: '環境變數未設定' }); return; }

  // 正確的 Notion database ID
  const NOTION_DB_INTENSIVE   = '1c72437f4e1080cf8057eb822b5be04d'; // 密集期
  const NOTION_DB_MAINTENANCE = '1c72437f4e1081d9a02bdaaaf95eae8d'; // 保養期

  async function queryDB(dbId, type) {
    try {
      const r = await fetch(`https://api.notion.com/v1/databases/${dbId}/query`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${NOTION_TOKEN}`,
          'Content-Type': 'application/json',
          'Notion-Version': '2022-06-28',
        },
        body: JSON.stringify({
          filter: {
            or: [
              { property: '預約狀態', select: { equals: '需預約' } },
              { property: '預約狀態', select: { equals: '需追蹤' } },
            ]
          },
          sorts: [{ property: '分級', direction: 'ascending' }],
          page_size: 100,
        }),
      });
      const data = await r.json();
      if (!data.results) return [];

      return data.results.map(page => {
        const p = page.properties;

        const getName = () =>
          p['姓名']?.title?.[0]?.text?.content || '—';
        const getSelect = (key) =>
          p[key]?.select?.name || '';
        const getDate = (key) =>
          p[key]?.date?.start || '';
        const getText = (key) =>
          p[key]?.rich_text?.[0]?.text?.content || '';
        const getNum = (key) =>
          p[key]?.number || 0;

        // 最後施做日期（密集期和保養期欄位名稱可能不同）
        const lastDate =
          getDate('最後施做') ||
          getDate('最後一次施做日期') ||
          getDate('預計回診日期') ||
          getDate('初診日期');

        const daysAgo = lastDate
          ? Math.floor((new Date() - new Date(lastDate)) / 864e5)
          : null;

        return {
          id: page.id,
          name: getName(),
          grade: getSelect('分級'),
          status: getSelect('預約狀態'),
          type,
          lastDate,
          daysAgo,
          nextDate: getDate('預計回診日期'),
          note: getText('備註') || getText('備注'),
          therapy: p['療程']?.multi_select?.map(t => t.name).join('、') || '',
          doneCount: getNum('已完成次數'),
        };
      });
    } catch(e) {
      console.error(`Query ${type} error:`, e.message);
      return [];
    }
  }

  const [intensive, maintenance] = await Promise.all([
    queryDB(NOTION_DB_INTENSIVE, '密集期'),
    queryDB(NOTION_DB_MAINTENANCE, '保養期'),
  ]);

  const all = [...intensive, ...maintenance];

  const gradeOrder = (g) => {
    if (!g) return 5;
    if (g.includes('A+')) return 0;
    if (g.includes('A好') || g.startsWith('A')) return 1;
    if (g.includes('B')) return 2;
    if (g.includes('C')) return 3;
    return 4;
  };

  const urgent = all
    .filter(p => p.status === '需預約')
    .sort((a, b) => gradeOrder(a.grade) - gradeOrder(b.grade) || (b.daysAgo || 0) - (a.daysAgo || 0));

  const tracking = all
    .filter(p => p.status === '需追蹤')
    .sort((a, b) => gradeOrder(a.grade) - gradeOrder(b.grade) || (b.daysAgo || 0) - (a.daysAgo || 0));

  res.status(200).json({
    success: true,
    urgent,
    tracking,
    intensiveTotal: intensive.length,
    maintenanceTotal: maintenance.length,
  });
}
