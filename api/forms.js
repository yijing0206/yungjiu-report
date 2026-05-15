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
    if (lines.length < 2) return [];
    const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
    return lines.slice(1).map(line => {
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
  }

  // 台灣時間
  function getTWDate() {
    const tw = new Date(new Date().getTime() + 8 * 60 * 60 * 1000);
    return {
      today: `${tw.getUTCFullYear()}/${String(tw.getUTCMonth()+1).padStart(2,'0')}/${String(tw.getUTCDate()).padStart(2,'0')}`,
      month: `${tw.getUTCFullYear()}/${String(tw.getUTCMonth()+1).padStart(2,'0')}`,
      todayFmt: tw.toLocaleDateString('zh-TW',{year:'numeric',month:'2-digit',day:'2-digit'}),
    };
  }

  // 分類（根據第2欄實際內容）
  function classifyItem(item) {
    if (!item) return 'other';
    if (item.includes('針刀') || item.includes('結構')) return 'needle';
    if (item.includes('轉骨') || item.includes('兒科') || item.includes('兒童') || item.includes('成長')) return 'growth';
    if (item.includes('好韻') || item.includes('備孕') || item.includes('產後')) return 'hoyun';
    if (item.includes('水煎藥') || item.includes('水藥')) return 'herbal';
    if (item.includes('美顏針') || item.includes('韓式')) return 'beauty';
    return 'other';
  }

  const typeLabel = { needle:'針刀', growth:'轉骨', hoyun:'好韻', herbal:'水煎藥', beauty:'美顏針', other:'其他' };

  // 欄位取值
  function getField(r, ...keys) {
    for (const k of keys) { if (r[k] && r[k].trim()) return r[k].trim(); }
    return '';
  }
  function getName(r)      { return getField(r, '您的姓名', '小朋友的姓名', '姓名'); }
  function getPhone(r)     { return getField(r, '您的聯絡電話', '聯絡電話', '小朋友的聯絡電話', '電話'); }
  function getStatus(r)    { return getField(r, '處理狀態', '狀態'); }
  function getTimestamp(r) { return getField(r, '時間戳記', 'Timestamp'); }
  function getItem(r)      { return getField(r, '第 2 欄', '您希望諮詢的項目', '諮詢項目'); }

  // 狀態判斷
  function isBooked(s)  { return s.includes('已預約'); }
  // 只追蹤：空白 或 未接需回電
  function isPending(s) { return s === '' || s.includes('未接') || s.includes('回電'); }

  const { today, month, todayFmt } = getTWDate();

  try {
    const [consultRes, beautyRes] = await Promise.all([
      fetch(FORM_CONSULT),
      fetch(FORM_BEAUTY),
    ]);
    const [consultText, beautyText] = await Promise.all([
      consultRes.text(), beautyRes.text(),
    ]);

    const consultRows = parseCSV(consultText);
    const beautyRows  = parseCSV(beautyText);

    // 過濾美顏針
    const targetRows = consultRows.filter(r => classifyItem(getItem(r)) !== 'beauty');

    // 今日
    const todayRows = targetRows.filter(r => getTimestamp(r).startsWith(today));
    const todayByType = { needle:0, growth:0, hoyun:0, herbal:0, other:0 };
    todayRows.forEach(r => {
      const t = classifyItem(getItem(r));
      if (t in todayByType) todayByType[t]++; else todayByType.other++;
    });
    const todayBooked = todayRows.filter(r => isBooked(getStatus(r))).length;

    // 本月
    const monthRows   = targetRows.filter(r => getTimestamp(r).startsWith(month));
    const monthBooked = monthRows.filter(r => isBooked(getStatus(r))).length;
    const monthConvRate = monthRows.length > 0 ? Math.round(monthBooked / monthRows.length * 100) : null;

    // 待跟進：只顯示「空白」或「未接需回電」，且有姓名
    const pendingRows = targetRows
      .filter(r => {
        const name = getName(r);
        const status = getStatus(r);
        return name !== '' && isPending(status);
      })
      .reverse()   // 最新的在前
      .slice(0, 50);

    const pendingFollowup = pendingRows.map(r => ({
      name:    getName(r),
      phone:   getPhone(r),
      item:    getItem(r),
      time:    getTimestamp(r).slice(0, 10),
      status:  getStatus(r) || '未處理',
      type:    typeLabel[classifyItem(getItem(r))] || '其他',
      typeKey: classifyItem(getItem(r)),
    }));

    // 美顏針表單
    const todayBeauty = beautyRows.filter(r => getTimestamp(r).startsWith(today)).length;
    const monthBeauty = beautyRows.filter(r => getTimestamp(r).startsWith(month)).length;

    // 今日 & 昨天是否填報（查 Notion）
    let reportedToday = false, reportedYesterday = false;
    if (NOTION_TOKEN && DATABASE_ID) {
      try {
        const tw = new Date(new Date().getTime() + 8*60*60*1000);
        const ydTW = new Date(tw.getTime() - 24*60*60*1000);
        const ydFmt = ydTW.toLocaleDateString('zh-TW',{year:'numeric',month:'2-digit',day:'2-digit'});

        const qRes = await fetch(`https://api.notion.com/v1/databases/${DATABASE_ID}/query`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${NOTION_TOKEN}`,
            'Content-Type': 'application/json',
            'Notion-Version': '2022-06-28',
          },
          body: JSON.stringify({ page_size: 7, sorts: [{ property: '日期', direction: 'descending' }] }),
        });
        const qData = await qRes.json();
        const dates = (qData.results || []).map(p => p.properties['日期']?.title?.[0]?.text?.content || '');
        reportedToday     = dates.some(d => d === todayFmt);
        reportedYesterday = dates.some(d => d === ydFmt);
      } catch(e) {}
    }

    res.status(200).json({
      success: true,
      report_status: { today: reportedToday, yesterday: reportedYesterday },
      consult: {
        today_total:   todayRows.length,
        today_booked:  todayBooked,
        today_by_type: todayByType,
        month_total:   monthRows.length,
        month_booked:  monthBooked,
        month_conv_rate: monthConvRate,
        pending_followup: pendingFollowup,
      },
      beauty: { today_new: todayBeauty, month_new: monthBeauty },
    });

  } catch(e) {
    res.status(500).json({ error: e.message });
  }
}
