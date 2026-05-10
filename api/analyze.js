export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
  if (!ANTHROPIC_KEY) { res.status(500).json({ error: 'API Key 未設定' }); return; }

  const { role, urgent, track, slots } = req.body;
  const slotSummary = slots ? Object.entries(slots).map(([k,v])=>`${k}：${v}`).join('、') : '未填';

  const systemPrompt = role === 'manager'
    ? `你是中醫診所的營運助理，協助店長做每日追蹤決策。語氣簡潔、具體、可執行。用繁體中文。`
    : `你是中醫診所的策略顧問，協助老闆做營運決策和策略規劃。語氣專業、有深度。用繁體中文。`;

  const userPrompt = role === 'manager'
    ? `今日狀況：需立即追蹤的A/B級患者 ${urgent||0} 人，需追蹤失聯患者 ${track||0} 人，空檔狀態：${slotSummary}。
請給店長3條今日具體行動建議，每條一句話，加上emoji，用<br>分隔。`
    : `空檔狀態：${slotSummary}。請給老闆2條策略層面的思考建議，聚焦在自費業績和患者維持，每條2-3句話，加上emoji，用<br><br>分隔。`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 400, system: systemPrompt, messages: [{ role: 'user', content: userPrompt }] })
    });
    const result = await response.json();
    const text = result.content?.[0]?.text || '建議無法載入';
    res.status(200).json({ success: true, text });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
