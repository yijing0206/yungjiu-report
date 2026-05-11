export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const NOTION_TOKEN   = process.env.NOTION_TOKEN;
  const DATABASE_ID    = process.env.DATABASE_ID;
  const ANTHROPIC_KEY  = process.env.ANTHROPIC_API_KEY;

  // 抓本週 Notion 填報資料
  let weekData = [];
  try {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const isoDate = sevenDaysAgo.toISOString().split('T')[0];

    const queryRes = await fetch(`https://api.notion.com/v1/databases/${DATABASE_ID}/query`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${NOTION_TOKEN}`,
        'Content-Type': 'application/json',
        'Notion-Version': '2022-06-28',
      },
      body: JSON.stringify({
        filter: {
          property: '日期',
          title: { is_not_empty: true }
        },
        sorts: [{ property: '日期', direction: 'descending' }],
        page_size: 14,
      }),
    });
    const queryData = await queryRes.json();
    weekData = (queryData.results || []).map(page => {
      const p = page.properties;
      const getNum = (key) => p[key]?.number || 0;
      const getSlot = (key) => p[key]?.select?.name || '未填';
      return {
        date:    p['日期']?.title?.[0]?.text?.content || '',
        m:       getNum('早診人數'),
        a:       getNum('午診人數'),
        e:       getNum('晚診人數'),
        f:       getNum('美顏針人次'),
        nk:      getNum('針刀人次'),
        h1:      getNum('轉骨水藥張數'),
        h2:      getNum('客製水藥張數'),
        fu:      getNum('今日跟進人數'),
        cv:      getNum('成功轉預約'),
        np:      getNum('初診諮詢總數'),
        slot_tm_facial: getSlot('明天美顏針空檔'),
        slot_tm_nk:     getSlot('明天針刀空檔'),
        slot_dt_facial: getSlot('後天美顏針空檔'),
        slot_dt_nk:     getSlot('後天針刀空檔'),
      };
    });
  } catch(e) {
    console.error('Notion fetch error:', e.message);
  }

  // 計算本週指標
  const totalFU  = weekData.reduce((s, r) => s + r.fu, 0);
  const totalCV  = weekData.reduce((s, r) => s + r.cv, 0);
  const totalPts = weekData.reduce((s, r) => s + r.m + r.a + r.e, 0);
  const totalF   = weekData.reduce((s, r) => s + r.f, 0);
  const totalNK  = weekData.reduce((s, r) => s + r.nk, 0);
  const totalNP  = weekData.reduce((s, r) => s + r.np, 0);
  const convRate = totalFU > 0 ? Math.round(totalCV / totalFU * 100) : null;

  // 最新空檔狀態（最近一筆填報）
  const latestSlots = weekData.length > 0 ? {
    '明天美顏針空檔': weekData[0].slot_tm_facial,
    '明天針刀空檔':   weekData[0].slot_tm_nk,
    '後天美顏針空檔': weekData[0].slot_dt_facial,
    '後天針刀空檔':   weekData[0].slot_dt_nk,
  } : {};

  const slotVals = Object.values(latestSlots).filter(v => v !== '未填');
  const fullSlots = slotVals.filter(v => v === '額滿').length;
  const slotRate = slotVals.length > 0 ? Math.round(fullSlots / slotVals.length * 100) : null;

  const { role } = req.body;

  // 回傳指標數字
  const metrics = {
    convRate,
    totalFU,
    totalCV,
    slotRate,
    fullSlots,
    totalSlots: slotVals.length,
    totalPts,
    totalF,
    totalNK,
    totalNP,
    latestSlots,
    daysRecorded: weekData.length,
  };

  // AI 分析（如果有 API Key）
  let aiText = null;
  if (ANTHROPIC_KEY) {
    try {
      const slotsStr = Object.entries(latestSlots).map(([k,v]) => `${k}：${v}`).join('、');
      const systemPrompt = role === 'manager'
        ? '你是中醫診所的營運助理，協助店長做每日追蹤決策。語氣簡潔、具體、可執行。用繁體中文。每條建議加emoji，條列式，共3條。'
        : '你是中醫診所的策略顧問，協助老闆做營運決策。語氣專業有深度。用繁體中文。每條建議加emoji，條列式，共2條，聚焦自費業績和患者維持。';

      const convStr = convRate !== null ? `${convRate}%（${totalCV}/${totalFU}人）` : '本週尚無跟進資料';
      const slotStr = slotRate !== null ? `${slotRate}%（${fullSlots}/${slotVals.length}格額滿）` : '尚未填報空檔';
      const userPrompt = `本週數據：就診${totalPts}人，美顏針${totalF}次，針刀${totalNK}次，初診諮詢${totalNP}人，跟進轉單率${convStr}，空檔填滿率${slotStr}，最新空檔：${slotsStr}。請給${role === 'manager' ? '店長' : '老闆'}具體建議。`;

      const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': ANTHROPIC_KEY,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 400,
          system: systemPrompt,
          messages: [{ role: 'user', content: userPrompt }]
        })
      });
      const aiData = await aiRes.json();
      aiText = aiData.content?.[0]?.text || null;
    } catch(e) {
      console.error('AI error:', e.message);
    }
  }

  res.status(200).json({ success: true, metrics, text: aiText });
}
