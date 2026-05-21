export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const NOTION_TOKEN = process.env.NOTION_TOKEN;
  const SETTINGS_DB  = '0536335a-be7f-4489-b446-d6a9567eb17d';

  const { action, clinic, settings } = req.body;

  // 讀取設定
  if (action === 'get') {
    try {
      const r = await fetch(`https://api.notion.com/v1/databases/${SETTINGS_DB}/query`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${NOTION_TOKEN}`,
          'Content-Type': 'application/json',
          'Notion-Version': '2022-06-28',
        },
        body: JSON.stringify({
          filter: { property: '診所', rich_text: { equals: clinic || 'yungjiu' } },
          page_size: 20,
        }),
      });
      const data = await r.json();
      const result = {};
      (data.results || []).forEach(page => {
        const key = page.properties['設定鍵']?.title?.[0]?.text?.content || '';
        const val = page.properties['數值']?.number ?? 0;
        if (key) result[key] = val;
      });
      res.status(200).json({ success: true, settings: result });
    } catch(e) {
      res.status(500).json({ error: e.message });
    }
    return;
  }

  // 儲存設定
  if (action === 'save') {
    try {
      // 先查現有的 pages
      const qr = await fetch(`https://api.notion.com/v1/databases/${SETTINGS_DB}/query`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${NOTION_TOKEN}`,
          'Content-Type': 'application/json',
          'Notion-Version': '2022-06-28',
        },
        body: JSON.stringify({
          filter: { property: '診所', rich_text: { equals: clinic } },
          page_size: 50,
        }),
      });
      const qd = await qr.json();
      const existingMap = {};
      (qd.results || []).forEach(page => {
        const key = page.properties['設定鍵']?.title?.[0]?.text?.content || '';
        if (key) existingMap[key] = page.id;
      });

      // 更新或新增每個設定
      const promises = Object.entries(settings).map(([key, val]) => {
        const props = {
          '設定鍵': { title: [{ text: { content: key } }] },
          '數值':   { number: Number(val) || 0 },
          '診所':   { rich_text: [{ text: { content: clinic } }] },
        };
        if (existingMap[key]) {
          // 更新
          return fetch(`https://api.notion.com/v1/pages/${existingMap[key]}`, {
            method: 'PATCH',
            headers: {
              'Authorization': `Bearer ${NOTION_TOKEN}`,
              'Content-Type': 'application/json',
              'Notion-Version': '2022-06-28',
            },
            body: JSON.stringify({ properties: props }),
          });
        } else {
          // 新增
          return fetch('https://api.notion.com/v1/pages', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${NOTION_TOKEN}`,
              'Content-Type': 'application/json',
              'Notion-Version': '2022-06-28',
            },
            body: JSON.stringify({
              parent: { database_id: SETTINGS_DB },
              properties: props,
            }),
          });
        }
      });

      await Promise.all(promises);
      res.status(200).json({ success: true });
    } catch(e) {
      res.status(500).json({ error: e.message });
    }
    return;
  }

  res.status(400).json({ error: 'Invalid action' });
}
