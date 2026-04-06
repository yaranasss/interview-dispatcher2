export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const TOKEN = process.env.SLACK_BOT_TOKEN;
  if (!TOKEN) return res.status(500).json({ success: false, error: 'SLACK_BOT_TOKEN não configurado' });

  const { name, message } = req.body;
  if (!name || !message) return res.status(400).json({ success: false, error: 'Nome e mensagem obrigatórios' });

  try {
    // 1. Buscar todos os usuários
    const searchRes = await fetch('https://slack.com/api/users.list?limit=500', {
      headers: { Authorization: `Bearer ${TOKEN}` }
    });
    const searchData = await searchRes.json();
    if (!searchData.ok) throw new Error(searchData.error || 'Erro ao listar usuários');

    // 2. Encontrar por nome
    const nameLower = name.toLowerCase().trim();
    const nameParts = nameLower.split(' ').filter(Boolean);
    const user = searchData.members?.find(m => {
      if (m.deleted || m.is_bot || m.id === 'USLACKBOT') return false;
      const full = (m.real_name || '').toLowerCase();
      const display = (m.profile?.display_name || '').toLowerCase();
      return nameParts.every(part => full.includes(part) || display.includes(part));
    });

    if (!user) return res.status(404).json({ success: false, error: `"${name}" não encontrado no Slack` });

    // 3. Abrir DM
    const dmRes = await fetch('https://slack.com/api/conversations.open', {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ users: user.id })
    });
    const dmData = await dmRes.json();
    if (!dmData.ok) throw new Error(dmData.error || 'Erro ao abrir conversa');

    // 4. Enviar mensagem
    const msgRes = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel: dmData.channel.id, text: message })
    });
    const msgData = await msgRes.json();
    if (!msgData.ok) throw new Error(msgData.error || 'Erro ao enviar mensagem');

    return res.status(200).json({
      success: true,
      user: user.real_name,
      channel_link: `https://slack.com/app_redirect?channel=${dmData.channel.id}`
    });

  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}
