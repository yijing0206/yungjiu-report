export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const NOTION_TOKEN = process.env.NOTION_TOKEN;
  if (!NOTION_TOKEN) { res.status(500).json({ error: '環境變數未設定' }); return; }

  // 保養期 和 密集期 的 database collection ID
  const DB_MAINTENANCE = '1c72437f-4e10-81d5-bf14-000b434635a8';
  const DB_INTENSIVE   = '1c72437f-4e10-80d5-9e45-000b512203ef';

  // Notion API 用的 database ID（從 URL 取）
  const NOTION_DB_MAINTENANCE = '1c72437f4e1081d9a02bdaaaf95eae8d';
  const NOTION_DB_INTENSIVE   = '1c72437f4e1080cf8057eb822b5be04d';

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
          page_size: 50,
        }),
      });
      const data = await r.json();
      if (!data.results) return [];

      return data.results.map(page => {
        const p = page.properties;
        const getName = () => p['姓名']?.title?.[0]?.text?.content || p['名字']?.title?.[0]?.text?.content || '—';
        const getSelect = (key) => p[key]?.select?.name || '';
        const getDate = (key) => p[key]?.date?.start || '';
        const getText = (key) => p[key]?.rich_text?.[0]?.text?.content || '';

        // 計算距離最後施做的天數
        const lastDate = getDate('最後施做') || getDate('最後一次施做日期') || getDate('上次回診');
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
          note: getText('備注') || getText('備註'),
          therapy: getText('療程') || getSelect('療程'),
        };
      });
    } catch(e) {
      console.error(`Query ${type} error:`, e.message);
      return [];
    }
  }

  const [maintenance, intensive] = await Promise.all([
    queryDB(NOTION_DB_MAINTENANCE, '保養期'),
    queryDB(NOTION_DB_INTENSIVE, '密集期'),
  ]);

  // 排序：A+ > A > B > C，同等級按天數降序
  const gradeOrder = (g) => {
    if (!g) return 5;
    if (g.includes('A+')) return 0;
    if (g.includes('A好') || g.includes('A ')) return 1;
    if (g.includes('B')) return 2;
    if (g.includes('C')) return 3;
    return 4;
  };

  const urgent = [...maintenance, ...intensive]
    .filter(p => p.status === '需預約')
    .sort((a, b) => gradeOrder(a.grade) - gradeOrder(b.grade) || (b.daysAgo || 0) - (a.daysAgo || 0));

  const tracking = [...maintenance, ...intensive]
    .filter(p => p.status === '需追蹤')
    .sort((a, b) => gradeOrder(a.grade) - gradeOrder(b.grade) || (b.daysAgo || 0) - (a.daysAgo || 0));

  res.status(200).json({
    success: true,
    urgent,
    tracking,
    total: maintenance.length + intensive.length,
  });
}
