export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const NOTION_TOKEN = process.env.NOTION_TOKEN;
  const DATABASE_ID  = process.env.DATABASE_ID;
  const { days = 14 } = req.body || {};

  async function queryDB(dbId) {
    const r = await fetch(`https://api.notion.com/v1/databases/${dbId}/query`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${NOTION_TOKEN}`,
        'Content-Type': 'application/json',
        'Notion-Version': '2022-06-28',
      },
      body: JSON.stringify({
        sorts: [{ property: '日期', direction: 'descending' }],
        page_size: days,
      }),
    });
    const data = await r.json();
    return (data.results || []).map(page => {
      const p = page.properties;
      const n = key => p[key]?.number ?? 0;
      const t = key => p[key]?.rich_text?.[0]?.text?.content || '';
      const ti = key => p[key]?.title?.[0]?.text?.content || '';
      return {
        date:      ti('日期'),
        reporter:  t('填報者'),
        m:         n('早診人數'),
        a:         n('午診人數'),
        e:         n('晚診人數'),
        facial:    n('美顏針人次'),
        nk:        n('針刀人次'),
        h1:        n('轉骨水藥張數'),
        h2:        n('客製水藥張數'),
        fSlot:     n('美顏針開放格數'),
        nkSlot:    n('針刀開放格數'),
        slotRate:  n('整體空檔填滿率'),
        cv:        n('成功轉預約'),
        np:        n('初診諮詢總數'),
        note:      t('今日備注'),
      };
    });
  }

  try {
    const records = await queryDB(DATABASE_ID);

    // 本週（週一到今天）
    const tw = new Date(new Date().getTime() + 8*60*60*1000);
    const dow = tw.getUTCDay(); // 0=日
    const mondayOffset = dow === 0 ? -6 : 1 - dow;
    const monday = new Date(tw);
    monday.setUTCDate(tw.getUTCDate() + mondayOffset);
    monday.setUTCHours(0,0,0,0);

    const lastMonday = new Date(monday);
    lastMonday.setUTCDate(monday.getUTCDate() - 7);
    const lastSunday = new Date(monday);
    lastSunday.setUTCDate(monday.getUTCDate() - 1);

    function parseDate(str) {
      if (!str) return null;
      // 支援 2026/05/27 或 2026年05月27日
      const m = str.match(/(\d{4})[\/\-年](\d{1,2})[\/\-月](\d{1,2})/);
      if (!m) return null;
      return new Date(Date.UTC(+m[1], +m[2]-1, +m[3]));
    }

    function sumRecords(recs) {
      return recs.reduce((acc, r) => ({
        total: acc.total + r.m + r.a + r.e,
        facial: acc.facial + r.facial,
        nk: acc.nk + r.nk,
        h1: acc.h1 + r.h1,
        h2: acc.h2 + r.h2,
        cv: acc.cv + r.cv,
        np: acc.np + r.np,
        days: acc.days + 1,
      }), { total:0, facial:0, nk:0, h1:0, h2:0, cv:0, np:0, days:0 });
    }

    const thisWeek = records.filter(r => {
      const d = parseDate(r.date);
      return d && d >= monday;
    });

    const lastWeek = records.filter(r => {
      const d = parseDate(r.date);
      return d && d >= lastMonday && d <= lastSunday;
    });

    res.status(200).json({
      success: true,
      records,           // 全部最近 N 天
      this_week: { records: thisWeek, summary: sumRecords(thisWeek) },
      last_week: { records: lastWeek, summary: sumRecords(lastWeek) },
    });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
}
