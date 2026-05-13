export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  // Google 試算表 CSV 連結
  const FORM_CONSULT = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQumUQmNnouGxOqA5LMEMBD0RcZlvL7EY8s4EXnIYimsZn2GRqZp71a9xu-cAYj1O2-TbnE5xORQn4N/pub?gid=375734688&single=true&output=csv';
  const FORM_BEAUTY  = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vThUyrXeZZp6tOziYUIgPO-2HztR2aEZA0YAFQhurvSCTlyQvK_vaONqWsidc5KZUTaAxgYE-07KIl9/pub?output=csv';

  function parseCSV(text) {
    const lines = text.trim().split('\n');
    if (lines.length < 2) return [];
    const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
    return lines.slice(1).map(line => {
      // 處理有引號的欄位
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
      headers.forEach((h, i) => { row[h] = (cols[i] || '').replace(/^"|"$/g, ''); });
      return row;
    });
  }

  function getToday() {
    const d = new Date();
    return `${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')}`;
  }

  function getThisMonth() {
    const d = new Date();
    return `${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,'0')}`;
  }

  // 分類諮詢項目
  function classifyItem(item) {
    if (!item) return '其他';
    if (item.includes('針刀') || item.includes('結構')) return '針刀';
    if (item.includes('轉骨') || item.includes('成長') || item.includes('兒科')) return '轉骨';
    if (item.includes('美顏針') || item.includes('美顔針')) return '美顏針';
    if (item.includes('備孕') || item.includes('產後')) return '其他';
    if (item.includes('水煎藥') || item.includes('調理')) return '其他';
    return '其他';
  }

  const today = getToday();
  const thisMonth = getThisMonth();

  try {
    // 抓兩個試算表
    const [consultRes, beautyRes] = await Promise.all([
      fetch(FORM_CONSULT),
      fetch(FORM_BEAUTY),
    ]);

    const [consultText, beautyText] = await Promise.all([
      consultRes.text(),
      beautyRes.text(),
    ]);

    const consultRows = parseCSV(consultText);
    const beautyRows = parseCSV(beautyText);

    // ── 針刀/轉骨/其他表單分析 ──
    const todayConsult = consultRows.filter(r => {
      const ts = r['時間戳記'] || r['Timestamp'] || '';
      return ts.startsWith(today);
    });

    const thisMonthConsult = consultRows.filter(r => {
      const ts = r['時間戳記'] || r['Timestamp'] || '';
      return ts.startsWith(thisMonth);
    });

    // 今日按項目分類
    const todayByType = { needle: 0, growth: 0, beauty: 0, other: 0 };
    todayConsult.forEach(r => {
      const item = r['您希望諮詢的項目'] || r['諮詢項目'] || r['項目'] || '';
      const type = classifyItem(item);
      if (type === '針刀') todayByType.needle++;
      else if (type === '轉骨') todayByType.growth++;
      else if (type === '美顏針') todayByType.beauty++;
      else todayByType.other++;
    });

    // 本月轉單率
    const monthBooked = thisMonthConsult.filter(r => {
      const status = r['處理狀態'] || r['狀態'] || '';
      return status.includes('已預約');
    }).length;
    const monthConvRate = thisMonthConsult.length > 0
      ? Math.round(monthBooked / thisMonthConsult.length * 100)
      : null;

    // 待跟進名單（未接需回電）
    const pendingFollowup = consultRows
      .filter(r => {
        const status = r['處理狀態'] || r['狀態'] || '';
        return status.includes('未接') || status.includes('回電') || status === '';
      })
      .slice(-20) // 最近 20 筆
      .map(r => ({
        name: r['您的姓名'] || r['姓名'] || r['名字'] || '—',
        phone: r['您的聯絡電話'] || r['電話'] || '',
        item: r['您希望諮詢的項目'] || r['諮詢項目'] || '',
        time: r['時間戳記'] || r['Timestamp'] || '',
        status: r['處理狀態'] || r['狀態'] || '未處理',
        type: classifyItem(r['您希望諮詢的項目'] || r['諮詢項目'] || ''),
      }))
      .reverse(); // 最新的在前

    // ── 美顏針表單分析 ──
    const todayBeauty = beautyRows.filter(r => {
      const ts = r['時間戳記'] || r['Timestamp'] || '';
      return ts.startsWith(today);
    }).length;

    const thisMonthBeauty = beautyRows.filter(r => {
      const ts = r['時間戳記'] || r['Timestamp'] || '';
      return ts.startsWith(thisMonth);
    }).length;

    res.status(200).json({
      success: true,
      consult: {
        today_total: todayConsult.length,
        today_by_type: todayByType,
        month_total: thisMonthConsult.length,
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
