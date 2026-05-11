export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const NOTION_TOKEN   = process.env.NOTION_TOKEN;
  const DB_NEEDLEKNIFE = 'c7f6417629714133b9f72222dc23ae4c';
  const DB_GROWTH      = 'ce25d630e14c4c9f945c3f5bb68f7bb2';

  if (!NOTION_TOKEN) { res.status(500).json({ error: '環境變數未設定' }); return; }

  const today = new Date().toISOString().split('T')[0];

  async function queryDB(dbId, therapyLabel) {
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
            and: [
              { property: '下次回診日', date: { on_or_before: today } },
              { property: '預約狀態', select: { equals: '需預約' } },
            ]
          },
          sorts: [{ property: '下次回診日', direction: 'ascending' }],
          page_size: 20,
        }),
      });
      const data = await r.json();
      return (data.results || []).map(page => {
        const p = page.properties;
        const nextDate = p['下次回診日']?.date?.start || '';
        const daysOver = nextDate
          ? Math.floor((new Date(today) - new Date(nextDate)) / 864e5)
          : 0;
        return {
          id: page.id,
          name: p['姓名']?.title?.[0]?.text?.content || '—',
          chart_no: p['病歷號']?.rich_text?.[0]?.text?.content || '',
          next_date: nextDate,
          days_over: daysOver,
          therapy: therapyLabel,
        };
      });
    } catch(e) {
      return [];
    }
  }

  const [nkPatients, growthPatients] = await Promise.all([
    queryDB(DB_NEEDLEKNIFE, '針刀'),
    queryDB(DB_GROWTH, '轉骨'),
  ]);

  res.status(200).json({
    success: true,
    patients: [...nkPatients, ...growthPatients].sort((a,b) => b.days_over - a.days_over),
  });
}
