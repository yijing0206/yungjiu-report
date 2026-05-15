export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const NOTION_TOKEN = process.env.NOTION_TOKEN;
  const FORM_CONSULT = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQumUQmNnouGxOqA5LMEMBD0RcZlvL7EY8s4EXnIYimsZn2GRqZp71a9xu-cAYj1O2-TbnE5xORQn4N/pub?gid=375734688&single=true&output=csv';

  const NOTION_DB_INTENSIVE   = '1c72437f-4e10-80cf-8057-eb822b5be04d'; // 密集期
  const NOTION_DB_MAINTENANCE = '1c72437f-4e10-81d9-a02b-daaf95eae8d';  // 保養期

  function parseCSV(text) {
    const lines = text.trim().split('\n');
    if (lines.length < 2) return [];
    const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
    return lines.slice(1).map(line => {
      const cols = []; let cur = '', inQ = false;
      for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (c === '"') inQ = !inQ;
        else if (c === ',' && !inQ) { cols.push(cur.trim()); cur = ''; }
        else cur += c;
      }
      cols.push(cur.trim());
      const row = {};
      headers.forEach((h, i) => { row[h] = (cols[i]||'').replace(/^"|"$/g,'').trim(); });
      return row;
    });
  }

  function daysSince(dateStr) {
    if (!dateStr) return null;
    const d = new Date(dateStr);
    if (isNaN(d)) return null;
    return Math.floor((new Date() - d) / 864e5);
  }

  // 1. 流失預警：從 Notion 抓美顏針患者
  async function getAtRiskPatients() {
    async function queryDB(dbId, lastDateKey, isInactive) {
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
                { property: '預約狀態', status: { does_not_equal: '已結案' } },
              ]
            },
            page_size: 100,
          }),
        });
        const data = await r.json();
        if (!data.results) return [];
        return data.results.map(page => {
          const p = page.properties;
          const getName = () => p['姓名']?.title?.[0]?.text?.content || '—';
          const getDate = (key) => p[key]?.date?.start || '';
          const getSelect = (key) => p[key]?.select?.name || '';
          const getStatus = () => p['預約狀態']?.status?.name || '';

          const lastDate = getDate(lastDateKey) || getDate('最後回診日期') || getDate('初診日期');
          const days = daysSince(lastDate);

          return {
            id: page.id,
            name: getName(),
            grade: getSelect('分級'),
            status: getStatus(),
            lastDate,
            daysAgo: days,
            type: isInactive ? '密集期' : '保養期',
          };
        }).filter(p => p.name !== '—' && p.daysAgo !== null && p.daysAgo >= 60);
      } catch(e) { return []; }
    }

    const [intensive, maintenance] = await Promise.all([
      queryDB(NOTION_DB_INTENSIVE, '最後回診日期', true),
      queryDB(NOTION_DB_MAINTENANCE, '最後一次施做日期', false),
    ]);

    const gradeOrder = g => {
      if (!g) return 5;
      if (g.includes('A+')) return 0;
      if (g.startsWith('A')) return 1;
      if (g.includes('B')) return 2;
      if (g.includes('C')) return 3;
      return 4;
    };

    return [...intensive, ...maintenance]
      .sort((a, b) => gradeOrder(a.grade) - gradeOrder(b.grade) || b.daysAgo - a.daysAgo);
  }

  // 2. 來源分析：從 Google 試算表
  async function getSourceAnalysis() {
    try {
      const r = await fetch(FORM_CONSULT);
      const text = await r.text();
      const rows = parseCSV(text);

      // 本月
      const tw = new Date(new Date().getTime() + 8*60*60*1000);
      const thisMonth = `${tw.getUTCFullYear()}/${String(tw.getUTCMonth()+1).padStart(2,'0')}`;
      const lastMonthD = new Date(tw.getTime());
      lastMonthD.setUTCMonth(lastMonthD.getUTCMonth()-1);
      const lastMonth = `${lastMonthD.getUTCFullYear()}/${String(lastMonthD.getUTCMonth()+1).padStart(2,'0')}`;

      function getSource(r) {
        return r['您如何認識我們？'] || r['如何認識我們'] || r['認識我們的管道'] || Object.values(r)[3] || '';
      }
      function getStatus(r) { return r['處理狀態'] || r['狀態'] || ''; }
      function getTimestamp(r) { return r['時間戳記'] || r['Timestamp'] || ''; }
      function isBeauty(r) {
        const item = r['第 2 欄'] || Object.values(r)[1] || '';
        return item.includes('美顏針') || item.includes('韓式');
      }

      // 過濾美顏針
      const targetRows = rows.filter(r => !isBeauty(r));

      function analyzeSource(sourceRows) {
        const sourceMap = {};
        sourceRows.forEach(r => {
          let src = getSource(r);
          // 標準化來源名稱
          if (src.includes('Instagram') || src.includes('IG') || src.includes('ig')) src = 'Instagram';
          else if (src.includes('Facebook') || src.includes('FB') || src.includes('臉書')) src = 'Facebook';
          else if (src.includes('Google') || src.includes('google')) src = 'Google';
          else if (src.includes('親友') || src.includes('介紹') || src.includes('口碑')) src = '親友介紹';
          else if (src.includes('醫師') || src.includes('中醫') || src.includes('官')) src = '醫師社群';
          else if (!src) src = '其他';
          else src = '其他';

          if (!sourceMap[src]) sourceMap[src] = { total: 0, booked: 0 };
          sourceMap[src].total++;
          if (getStatus(r).includes('已預約')) sourceMap[src].booked++;
        });
        return Object.entries(sourceMap)
          .map(([name, d]) => ({
            name,
            total: d.total,
            booked: d.booked,
            rate: d.total > 0 ? Math.round(d.booked/d.total*100) : 0,
          }))
          .sort((a, b) => b.total - a.total);
      }

      const monthRows = targetRows.filter(r => getTimestamp(r).startsWith(thisMonth));
      const lastMonthRows = targetRows.filter(r => getTimestamp(r).startsWith(lastMonth));

      return {
        this_month: {
          total: monthRows.length,
          booked: monthRows.filter(r => getStatus(r).includes('已預約')).length,
          by_source: analyzeSource(monthRows),
        },
        last_month: {
          total: lastMonthRows.length,
          booked: lastMonthRows.filter(r => getStatus(r).includes('已預約')).length,
          by_source: analyzeSource(lastMonthRows),
        },
      };
    } catch(e) { return null; }
  }

  try {
    const [atRisk, sourceAnalysis] = await Promise.all([
      getAtRiskPatients(),
      getSourceAnalysis(),
    ]);

    res.status(200).json({
      success: true,
      at_risk: atRisk,
      source_analysis: sourceAnalysis,
    });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
}
