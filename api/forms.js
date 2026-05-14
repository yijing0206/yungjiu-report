export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const NOTION_TOKEN = process.env.NOTION_TOKEN;
  const DATABASE_ID  = process.env.DATABASE_ID;

  const FORM_CONSULT = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQumUQmNnouGxOqA5LMEMBD0RcZlvL7EY8s4EXnIYimsZn2GRqZp71a9xu-cAYj1O2-TbnE5xORQn4N/pub?gid=375734688&single=true&output=csv';
  const FORM_BEAUTY  = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vThUyrXeZZp6tOziYUIgPO-2HztR2aEZA0YAFQhurvSCTlyQvK_vaONqWsidc5KZUTaAxgYE-07KIl9/pub?output=csv';

  function parseCSV(text) {
    const lines = text.trim().split('\n');
    if (lines.length < 2) return { headers: [], rows: [] };
    const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
    const rows = lines.slice(1).map(line => {
      const cols = [];
      let cur = '', inQuote = false;
      for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (c === '"') { inQuote = !inQuote; }
        else if (c === ',' && !inQuote) { cols.push(cur.trim()); cur = ''; }
        else { cur += c; }
      }
      cols.push(cur.trim());
      const row = {};
      headers.forEach((h, i) => { row[h] = (cols[i] || '').replace(/^"|"$/g, '').trim(); });
      return row;
    });
    return { headers, rows };
  }

  function getToday() {
    const d = new Date();
    // 台灣時區
    const tw = new Date(d.getTime() + 8 * 60 * 60 * 1000);
    return `${tw.getUTCFullYear()}/${String(tw.getUTCMonth()+1).padStart(2,'0')}/${String(tw.getUTCDate()).padStart(2,'0')}`;
  }

  function getThisMonth() {
    const d = new Date();
    const tw = new Date(d.getTime() + 8 * 60 * 60 * 1000);
    return `${tw.getUTCFullYear()}/${String(tw.getUTCMonth()+1).padStart(2,'0')}`;
  }

  // 分類諮詢項目（根據第二欄內容）
  function classifyItem(item) {
    if (!item) return 'other';
    const s = item.toLowerCase();
    if (s.includes('針刀') || s.includes('結構')) return 'needle';
    if (s.includes('轉骨') || s.includes('成長') || s.includes('兒科') || s.includes('兒童')) return 'growth';
    if (s.includes('好韻') || s.includes('備孕') || s.includes('產後') || s.includes('婦')) return 'hoyun';
    if (s.includes('水煎藥') || s.includes('水藥') || s.includes('調理')) return 'herbal';
    if (s.includes('美顏針') || s.includes('美顔針') || s.includes('韓式')) return 'beauty';
    return 'other';
  }

  const typeLabel = { needle:'針刀', growth:'轉骨', hoyun:'好韻', herbal:'水煎藥', beauty:'美顏針', other:'其他' };

  // 處理狀態判斷
  function isBooked(status) {
    return status.includes('已預約') && !status.includes('不用再追');
  }
  function isPending(status) {
    return status.includes('未接') || status.includes('回電') || status === '' || (status === '已發簡訊' && !status.includes('不用再追'));
  }
  function isDone(status) {
    return status.includes('不用再追') || (status.includes('已預約') && status.includes('不用再追'));
  }

  const today = getToday();
  const thisMonth = getThisMonth();

  try {
    const [consultRes, beautyRes] = await Promise.all([
      fetch(FORM_CONSULT),
      fetch(FORM_BEAUTY),
    ]);
    const [consultText, beautyText] = await Promise.all([
      consultRes.text(),
      beautyRes.text(),
    ]);

    const { rows: consultRows } = parseCSV(consultText);
    const { rows: beautyRows } = parseCSV(beautyText);

    // 過濾非美顏針的諮詢（第二欄不是美顏針的才處理）
    const nonBeautyRows = consultRows.filter(r => {
      const col2 = r['第 2 欄'] || r['您希望諮詢的項目'] || Object.values(r)[1] || '';
      return classifyItem(col2) !== 'beauty';
    });

    // 找到姓名欄和狀態欄
    function getName(r) {
      return r['您的姓名'] || r['姓名'] || r['小朋友的姓名'] || '';
    }
    function getPhone(r) {
      return r['聯絡電話'] || r['您的聯絡電話'] || r['小朋友的聯絡電話'] || '';
    }
    function getStatus(r) {
      return r['處理狀態'] || r['狀態'] || '';
    }
    function getTimestamp(r) {
      return r['時間戳記'] || r['Timestamp'] || '';
    }
    function getItemCol(r) {
      return r['第 2 欄'] || r['您希望諮詢的項目'] || Object.values(r)[1] || '';
    }

    // 今日新填單
    const todayRows = nonBeautyRows.filter(r => getTimestamp(r).startsWith(today));
    const thisMonthRows = nonBeautyRows.filter(r => getTimestamp(r).startsWith(thisMonth));

    // 今日分類
    const todayByType = { needle:0, growth:0, hoyun:0, herbal:0, other:0 };
    todayRows.forEach(r => {
      const t = classifyItem(getItemCol(r));
      if (t in todayByType) todayByType[t]++;
      else todayByType.other++;
    });

    // 今日已預約
    const todayBooked = todayRows.filter(r => isBooked(getStatus(r))).length;

    // 本月統計
    const monthBooked = thisMonthRows.filter(r => isBooked(getStatus(r))).length;
    const monthConvRate = thisMonthRows.length > 0
      ? Math.round(monthBooked / thisMonthRows.length * 100) : null;

    // 待跟進：未接需回電，有姓名，排除美顏針，最近30筆
    const pendingRows = nonBeautyRows
      .filter(r => {
        const name = getName(r);
        const status = getStatus(r);
        return name && name.trim() !== '' && isPending(status) && !isDone(status);
      })
      .slice(-50)
      .reverse()
      .slice(0, 30);

    const pendingFollowup = pendingRows.map(r => ({
      name: getName(r),
      phone: getPhone(r),
      item: getItemCol(r),
      time: getTimestamp(r).slice(0, 10),
      status: getStatus(r),
      type: typeLabel[classifyItem(getItemCol(r))] || '其他',
      typeKey: classifyItem(getItemCol(r)),
    }));

    // 美顏針表單
    const todayBeauty = beautyRows.filter(r => {
      const ts = r['時間戳記'] || r['Timestamp'] || '';
      return ts.startsWith(today);
    }).length;
    const thisMonthBeauty = beautyRows.filter(r => {
      const ts = r['時間戳記'] || r['Timestamp'] || '';
      return ts.startsWith(thisMonth);
    }).length;

    // 今日是否已填報（從 Notion 查詢）
    let reportedToday = false;
    let reportedYesterday = false;
    if (NOTION_TOKEN && DATABASE_ID) {
      try {
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        const yd = yesterday.toLocaleDateString('zh-TW',{year:'numeric',month:'2-digit',day:'2-digit'});

        const qRes = await fetch(`https://api.notion.com/v1/databases/${DATABASE_ID}/query`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${NOTION_TOKEN}`,
            'Content-Type': 'application/json',
            'Notion-Version': '2022-06-28',
          },
          body: JSON.stringify({ page_size: 5, sorts: [{ property: '日期', direction: 'descending' }] }),
        });
        const qData = await qRes.json();
        const recentDates = (qData.results || []).map(p => p.properties['日期']?.title?.[0]?.text?.content || '');

        // 今天的日期格式
        const tw = new Date(new Date().getTime() + 8*60*60*1000);
        const todayFmt = tw.toLocaleDateString('zh-TW',{year:'numeric',month:'2-digit',day:'2-digit'});
        reportedToday = recentDates.some(d => d === todayFmt);
        reportedYesterday = recentDates.some(d => d === yd);
      } catch(e) {}
    }

    res.status(200).json({
      success: true,
      report_status: { today: reportedToday, yesterday: reportedYesterday },
      consult: {
        today_total: todayRows.length,
        today_booked: todayBooked,
        today_by_type: todayByType,
        month_total: thisMonthRows.length,
        month_booked: monthBooked,
        month_conv_rate: monthConvRate,
        pending_followup: pendingFollowup,
      },
      beauty: {
        today_new: todayBeauty,
        month_new: thisMonthBeauty,
      },
    });

  } catch(e) {
    res.status(500).json({ error: e.message });
  }
}
