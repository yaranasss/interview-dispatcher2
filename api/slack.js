export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
 
  const TOKEN = process.env.SLACK_BOT_TOKEN;
  if (!TOKEN) return res.status(500).json({ success: false, error: 'SLACK_BOT_TOKEN não configurado' });
 
  const contentType = req.headers['content-type'] || '';
  const isSlashCommand = contentType.includes('application/x-www-form-urlencoded');
 
  let names = [];
  let message = null;
  let responseUrl = null;
 
  if (isSlashCommand) {
    const text = req.body?.text || '';
    responseUrl = req.body?.response_url;
    const parts = text.split('|').map(p => p.trim());
    const rawNames = parts[0] || '';
    const tipo = parts[1]?.trim() || 'Entrevista';
    const hora = parts[2]?.trim() || '';
    names = rawNames.split(',').map(n => n.trim()).filter(Boolean);
 
    if (!names.length) {
      return res.status(200).json({
        response_type: 'ephemeral',
        text: '❌ Formato incorreto. Use:\n`/dispatch Nome 1, Nome 2 | Tipo | 13h`\n\nExemplo:\n`/dispatch Edmar Rezende, Edgar Valente | Entrevista MLE | 14h`'
      });
    }
 
    res.status(200).json({ response_type: 'ephemeral', text: `⏳ Enviando mensagens para ${names.length} pessoa(s)...` });
    processAndRespond({ names, tipo, hora, TOKEN, responseUrl });
    return;
 
  } else {
    const body = req.body;
    names = Array.isArray(body.names) ? body.names : [body.name];
    message = body.message;
    names = names.filter(Boolean);
    if (!names.length || !message) return res.status(400).json({ success: false, error: 'Nome e mensagem obrigatórios' });
    const results = await sendMessages({ names, message, TOKEN });
    return res.status(200).json({ results });
  }
}
 
async function sendToUser({ name, message, TOKEN }) {
  const searchRes = await fetch('https://slack.com/api/users.list?limit=500', {
    headers: { Authorization: `Bearer ${TOKEN}` }
  });
  const searchData = await searchRes.json();
  if (!searchData.ok) throw new Error(searchData.error);
 
  const nameLower = name.toLowerCase().trim();
  const nameParts = nameLower.split(' ').filter(Boolean);
  const user = searchData.members?.find(m => {
    if (m.deleted || m.is_bot || m.id === 'USLACKBOT') return false;
    const full = (m.real_name || '').toLowerCase();
    const display = (m.profile?.display_name || '').toLowerCase();
    return nameParts.every(part => full.includes(part) || display.includes(part));
  });
 
  if (!user) throw new Error(`"${name}" não encontrado no Slack`);
 
  const dmRes = await fetch('https://slack.com/api/conversations.open', {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ users: user.id })
  });
  const dmData = await dmRes.json();
  if (!dmData.ok) throw new Error(dmData.error);
 
  const msgRes = await fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ channel: dmData.channel.id, text: message })
  });
  const msgData = await msgRes.json();
  if (!msgData.ok) throw new Error(msgData.error);
 
  return { success: true, user: user.real_name, channel_link: `https://slack.com/app_redirect?channel=${dmData.channel.id}` };
}
 
async function sendMessages({ names, message, TOKEN }) {
  const results = [];
  for (const name of names) {
    try {
      const result = await sendToUser({ name, message, TOKEN });
      results.push({ name, ...result });
    } catch (err) {
      results.push({ name, success: false, error: err.message });
    }
  }
  return results;
}
 
async function processAndRespond({ names, tipo, hora, TOKEN, responseUrl }) {
  const results = [];
  for (const name of names) {
    const firstName = name.split(' ')[0];
    const message = `Oi, ${firstName}! Tudo bem? Você consegue participar de um(a) ${tipo} hoje às ${hora}?`;
    try {
      const result = await sendToUser({ name, message, TOKEN });
      results.push({ name, ...result });
    } catch (err) {
      results.push({ name, success: false, error: err.message });
    }
  }
 
  if (responseUrl) {
    const ok = results.filter(r => r.success);
    const err = results.filter(r => !r.success);
    let text = ok.length ? `✅ Enviado para: ${ok.map(r => r.user || r.name).join(', ')}` : '';
    if (err.length) text += `\n❌ Não encontrados: ${err.map(r => `${r.name} (${r.error})`).join(', ')}`;
    await fetch(responseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ response_type: 'ephemeral', text: text.trim() })
    });
  }
}
