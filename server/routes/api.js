const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const db = require('../storage/db');
const { composeProofImage } = require('../services/imageComposer');
const { processIncomingMessage, lookupProfilePicture, eventBus } = require('../services/flowEngine');
const metaService = require('../services/metaService');
const authService = require('../services/authService');

/**
 * =========================================================================
 * AUTENTICAÇÃO DO PAINEL
 * =========================================================================
 */
router.post('/auth/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ success: false, error: 'Usuário e senha são obrigatórios' });
  }

  const isValid = authService.validateCredentials(username, password);
  if (!isValid) {
    return res.status(401).json({ success: false, error: 'Usuário ou senha incorretos' });
  }

  const token = authService.generateToken(username);
  
  // Define o cookie auth_token HttpOnly seguro por 7 dias
  res.setHeader('Set-Cookie', `auth_token=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${7 * 24 * 3600}`);

  res.json({
    success: true,
    token,
    user: { username }
  });
});

router.get('/auth/check', (req, res) => {
  const cookies = authService.parseCookies(req);
  const token = cookies.auth_token || (req.headers.authorization ? req.headers.authorization.replace('Bearer ', '') : null);
  const session = authService.verifyToken(token);

  if (session) {
    return res.json({ authenticated: true, username: session.username });
  }
  res.json({ authenticated: false });
});

router.post('/auth/logout', (req, res) => {
  res.setHeader('Set-Cookie', 'auth_token=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
  res.json({ success: true });
});

router.post('/auth/change-credentials', (req, res) => {
  const { newUsername, newPassword } = req.body;
  if (!newPassword || newPassword.length < 4) {
    return res.status(400).json({ error: 'A nova senha deve ter no mínimo 4 caracteres' });
  }
  const updated = authService.updateCredentials(newUsername, newPassword);
  res.json({ success: true, message: 'Credenciais atualizadas com sucesso', username: updated.username });
});

/**
 * Estatísticas Gerais (Visão Geral)
 */
router.get('/stats', (req, res) => {
  const instances = db.getInstances();
  const chats = db.getChats();
  const chatList = Object.values(chats);

  const totalLeads = chatList.length;
  const totalProofsSent = chatList.filter(c => c.state === 'PROPOSTA_ENVIADA' || c.state === 'NEGOCIACAO').length;
  const totalActiveChips = instances.filter(i => i.status === 'connected').length;

  res.json({
    totalLeads,
    totalProofsSent,
    totalActiveChips,
    conversionRate: totalLeads > 0 ? Math.round((totalProofsSent / totalLeads) * 100) : 0
  });
});

/**
 * Instâncias / Chips (CRUD)
 */
router.get('/instances', (req, res) => {
  res.json(db.getInstances());
});

router.post('/instances', (req, res) => {
  const instances = db.getInstances();
  const { name, phoneNumber, phoneNumberId, wabaId, accessToken } = req.body;

  const newInst = {
    id: req.body.id || `inst_${Date.now()}`,
    name: name || 'Novo Chip',
    phoneNumber: phoneNumber || '',
    phoneNumberId: phoneNumberId || '',
    wabaId: wabaId || '',
    accessToken: accessToken || '',
    status: accessToken && phoneNumberId ? 'connected' : 'disconnected',
    totalSent: 0,
    totalReceived: 0,
    createdAt: new Date().toISOString()
  };

  const existingIdx = instances.findIndex(i => i.id === newInst.id);
  if (existingIdx >= 0) {
    instances[existingIdx] = { ...instances[existingIdx], ...newInst };
  } else {
    instances.push(newInst);
  }

  db.saveInstances(instances);
  res.json({ success: true, instance: newInst });
});

router.delete('/instances/:id', (req, res) => {
  let instances = db.getInstances();
  instances = instances.filter(i => i.id !== req.params.id);
  db.saveInstances(instances);
  res.json({ success: true });
});

/**
 * Live Chat (Inbox)
 */
router.get('/chats', (req, res) => {
  res.json(db.getChats());
});

router.get('/chats/:phone', (req, res) => {
  const chats = db.getChats();
  const chat = chats[req.params.phone];
  if (!chat) return res.status(404).json({ error: 'Chat não encontrado' });
  res.json(chat);
});

router.post('/chats/:phone/send', async (req, res) => {
  const { text } = req.body;
  const phone = req.params.phone;
  const chats = db.getChats();
  const chat = chats[phone];

  if (!text) return res.status(400).json({ error: 'Texto obrigatório' });

  const instances = db.getInstances();
  const instance = instances.find(i => i.id === chat?.instanceId) || instances[0] || {};

  const { newMessage } = db.addChatMessage(phone, {
    from: 'agent',
    text,
    instanceId: instance.id
  });

  // Envia via Meta se o chip estiver conectado
  if (instance.accessToken && instance.phoneNumberId) {
    await metaService.sendTextMessage(instance.phoneNumberId, instance.accessToken, phone, text);
  }

  eventBus.emit('new_message', { phone, message: newMessage });
  res.json({ success: true, message: newMessage });
});

/**
 * Configurações do Funil
 */
router.get('/funnel', (req, res) => {
  res.json(db.getFunnel());
});

router.post('/funnel', (req, res) => {
  const funnel = { ...db.getFunnel(), ...req.body };
  db.saveFunnel(funnel);
  res.json({ success: true, funnel });
});

/**
 * Configurações Gerais e Chaves
 */
router.get('/settings', (req, res) => {
  res.json(db.getSettings());
});

router.post('/settings', (req, res) => {
  const settings = { ...db.getSettings(), ...req.body };
  db.saveSettings(settings);
  res.json({ success: true, settings });
});

/**
 * Gestão de Fluxos (Canvas e Lista)
 */
router.get('/flows', (req, res) => {
  res.json(db.getFlows());
});

router.get('/flows/:id', (req, res) => {
  const flow = db.getFlow(req.params.id);
  if (!flow) return res.status(404).json({ error: 'Fluxo não encontrado' });
  res.json(flow);
});

router.post('/flows', (req, res) => {
  const { name, description } = req.body;
  const newFlow = {
    id: 'fluxo-' + Date.now(),
    name: name || 'Novo Fluxo Sem Título',
    description: description || 'Fluxo de atendimento automatizado',
    status: 'ativo',
    blocksCount: 1,
    updatedAt: new Date().toISOString(),
    nodes: [
      {
        id: 'node-start',
        type: 'trigger',
        label: 'Início (Gatilho)',
        icon: '⚡',
        color: 'green',
        x: 100,
        y: 200,
        data: { text: 'Cliente enviou primeira mensagem' }
      }
    ],
    edges: []
  };
  db.saveFlow(newFlow.id, newFlow);
  res.json({ success: true, flow: newFlow });
});

router.put('/flows/:id', (req, res) => {
  const flow = db.saveFlow(req.params.id, req.body);
  res.json({ success: true, flow });
});

router.delete('/flows/:id', (req, res) => {
  let flows = db.getFlows();
  flows = flows.filter(f => f.id !== req.params.id);
  db.saveFlows(flows);
  res.json({ success: true });
});

router.post('/flows/:id/duplicate', (req, res) => {
  const flow = db.getFlow(req.params.id);
  if (!flow) return res.status(404).json({ error: 'Fluxo não encontrado' });

  const duplicated = {
    ...flow,
    id: 'fluxo-copy-' + Date.now(),
    name: `${flow.name} (Cópia)`,
    updatedAt: new Date().toISOString()
  };
  db.saveFlow(duplicated.id, duplicated);
  res.json({ success: true, flow: duplicated });
});

/**
 * Kanban CRM
 */
router.get('/kanban', (req, res) => {
  const chats = db.getChats();
  const list = Object.values(chats);

  const columns = {
    novos: { title: 'Novo Lead', leads: [] },
    aguardando: { title: 'Aguardando Número', leads: [] },
    analise: { title: 'Em Análise / Foto', leads: [] },
    proposta: { title: 'Proposta Enviada', leads: [] },
    pago: { title: 'Venda Aprovada', leads: [] }
  };

  list.forEach(c => {
    const lastMsg = c.messages[c.messages.length - 1];
    const item = {
      phone: c.leadPhone,
      name: c.leadName || `Lead +${c.leadPhone}`,
      lastMessage: lastMsg?.text || (lastMsg?.mediaType ? '[Foto da Prova]' : 'Nova conversa'),
      time: lastMsg ? new Date(lastMsg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '',
      state: c.state
    };

    if (c.state === 'NOVO') columns.novos.leads.push(item);
    else if (c.state === 'AGUARDANDO_NUMERO') columns.aguardando.leads.push(item);
    else if (c.state === 'ANALISANDO') columns.analise.leads.push(item);
    else if (c.state === 'PROPOSTA_ENVIADA' || c.state === 'NEGOCIACAO') columns.proposta.leads.push(item);
    else columns.pago.leads.push(item);
  });

  res.json(columns);
});

/**
 * Contatos
 */
router.get('/contacts', (req, res) => {
  const chats = db.getChats();
  const contacts = Object.values(chats).map(c => ({
    phone: c.leadPhone,
    name: c.leadName || `Lead +${c.leadPhone}`,
    state: c.state,
    totalMessages: c.messages.length,
    lastInteraction: c.lastMessageTime
  }));
  res.json(contacts);
});

/**
 * Estúdio: Gerador de Preview da Imagem Dinâmica
 */
router.post('/studio/preview', async (req, res) => {
  try {
    const { avatarUrl, coords } = req.body;
    const imgBuffer = await composeProofImage(avatarUrl, coords);
    res.set('Content-Type', 'image/png');
    res.send(imgBuffer);
  } catch (err) {
    console.error('[Studio Preview Error]', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * Integração Externa Síncrona (Leona / Webhook HTTP Request):
 * Recebe o número alvo, busca a foto, gera a imagem e retorna { url: "https://..." }
 */
router.all('/generate-proof', async (req, res) => {
  try {
    const phone = req.body?.phone || req.query?.phone || req.body?.alvo || req.query?.alvo;
    if (!phone) {
      return res.status(400).json({ error: 'Parâmetro phone ou alvo obrigatório' });
    }

    const rawDigits = String(phone).replace(/\D/g, '');
    const targetPhone = rawDigits.length <= 11 ? '55' + rawDigits : rawDigits;

    // 1. Busca foto de perfil do número alvo
    const photoUrl = await lookupProfilePicture(targetPhone);

    // 2. Compõe a imagem com as coordenadas configuradas
    const funnel = db.getFunnel();
    const imgBuffer = await composeProofImage(photoUrl, funnel?.avatarCoordinates);

    // 3. Salva no diretório público
    const proofsDir = path.join(__dirname, '../../public/generated');
    fs.mkdirSync(proofsDir, { recursive: true });
    const filename = `proof_${targetPhone}_${Date.now()}.png`;
    fs.writeFileSync(path.join(proofsDir, filename), imgBuffer);

    // 4. Monta a URL pública absoluta automaticamente
    const protocol = req.headers['x-forwarded-proto'] || req.protocol;
    const host = req.get('host');
    const fullUrl = `${protocol}://${host}/generated/${filename}`;

    res.json({
      success: true,
      phone: targetPhone,
      hasPhoto: !!photoUrl,
      url: fullUrl
    });
  } catch (err) {
    console.error('[Generate Proof API Error]', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * Simulador de Lead (Teste completo dentro do Dashboard)
 */
router.post('/simulator/send', async (req, res) => {
  const { instanceId, phone, message } = req.body;
  if (!phone || !message) return res.status(400).json({ error: 'Telefone e mensagem são obrigatórios' });

  // Dispara a mesma lógica do webhook
  processIncomingMessage(instanceId || 'inst_1', phone, message);
  res.json({ success: true, message: 'Mensagem processada no funil' });
});

/**
 * Server-Sent Events (SSE) para atualização em tempo real do Live Chat
 */
router.get('/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const onNewMessage = (data) => {
    res.write(`data: ${JSON.stringify({ type: 'new_message', data })}\n\n`);
  };

  const onChatUpdated = (data) => {
    res.write(`data: ${JSON.stringify({ type: 'chat_updated', data })}\n\n`);
  };

  eventBus.on('new_message', onNewMessage);
  eventBus.on('chat_updated', onChatUpdated);

  req.on('close', () => {
    eventBus.removeListener('new_message', onNewMessage);
    eventBus.removeListener('chat_updated', onChatUpdated);
  });
});

/**
 * =========================================================================
 * INTEGRAÇÃO OFICIAL FACEBOOK / META ADS & WHATSAPP
 * =========================================================================
 */
router.get('/facebook/status', (req, res) => {
  const settings = db.getSettings();
  const fb = settings.facebook || {
    connected: false,
    appId: '',
    userName: '',
    adAccounts: [],
    pixels: [],
    whatsappNumbers: []
  };
  res.json(fb);
});

router.post('/facebook/connect', async (req, res) => {
  try {
    const { accessToken, appId, appSecret } = req.body;
    if (!accessToken) {
      return res.status(400).json({ error: 'Token de acesso da Meta é obrigatório' });
    }

    console.log('[Meta API] Validando e buscando contas da Meta...');
    const metaData = await metaService.validateAndFetchMetaDetails(accessToken);

    const settings = db.getSettings();
    if (!settings.facebook) settings.facebook = {};

    settings.facebook = {
      connected: true,
      appId: appId || settings.facebook.appId || '',
      appSecret: appSecret || settings.facebook.appSecret || '',
      accessToken: accessToken,
      userId: metaData.user.id,
      userName: metaData.user.name,
      userEmail: metaData.user.email,
      adAccounts: metaData.adAccounts,
      pixels: metaData.pixels,
      whatsappNumbers: metaData.whatsappNumbers,
      connectedAt: new Date().toISOString()
    };

    // Se encontrou contas de anúncio, seleciona a primeira por padrão
    if (metaData.adAccounts.length > 0 && !settings.facebook.adAccountId) {
      settings.facebook.adAccountId = metaData.adAccounts[0].id;
      settings.facebook.adAccountName = metaData.adAccounts[0].name;
    }

    // Se encontrou pixels, seleciona o primeiro por padrão
    if (metaData.pixels.length > 0 && !settings.facebook.pixelId) {
      settings.facebook.pixelId = metaData.pixels[0].id;
      settings.facebook.pixelName = metaData.pixels[0].name;
    }

    // Se encontrou números de WhatsApp da Meta, cadastra automaticamente nas instâncias
    if (metaData.whatsappNumbers.length > 0) {
      const instances = db.getInstances();
      metaData.whatsappNumbers.forEach((num, idx) => {
        const existing = instances.find(i => i.phoneNumberId === num.phoneNumberId);
        if (!existing) {
          instances.push({
            id: `inst_meta_${Date.now()}_${idx}`,
            name: num.verifiedName || `WhatsApp Meta ${num.displayPhoneNumber}`,
            phoneNumber: num.displayPhoneNumber,
            phoneNumberId: num.phoneNumberId,
            wabaId: num.wabaId,
            accessToken: accessToken,
            status: 'connected',
            totalSent: 0,
            totalReceived: 0,
            createdAt: new Date().toISOString()
          });
        }
      });
      db.saveInstances(instances);
    }

    db.saveSettings(settings);
    res.json({ success: true, facebook: settings.facebook });
  } catch (err) {
    console.error('[Meta Connect Error]', err);
    res.status(500).json({ error: err.response?.data?.error?.message || err.message });
  }
});

router.post('/facebook/select-pixel', (req, res) => {
  const { pixelId, adAccountId } = req.body;
  const settings = db.getSettings();
  if (!settings.facebook) settings.facebook = {};

  if (pixelId) {
    settings.facebook.pixelId = pixelId;
    const found = (settings.facebook.pixels || []).find(p => p.id === pixelId);
    if (found) settings.facebook.pixelName = found.name;
  }

  if (adAccountId) {
    settings.facebook.adAccountId = adAccountId;
    const found = (settings.facebook.adAccounts || []).find(a => a.id === adAccountId);
    if (found) settings.facebook.adAccountName = found.name;
  }

  db.saveSettings(settings);
  res.json({ success: true, facebook: settings.facebook });
});

router.post('/facebook/disconnect', (req, res) => {
  const settings = db.getSettings();
  settings.facebook = {
    connected: false,
    appId: settings.facebook?.appId || '',
    appSecret: '',
    accessToken: '',
    userName: '',
    adAccounts: [],
    pixels: [],
    whatsappNumbers: []
  };
  db.saveSettings(settings);
  res.json({ success: true });
});

router.post('/facebook/test-event', async (req, res) => {
  try {
    const { eventName, phone, value } = req.body;
    const settings = db.getSettings();
    const fb = settings.facebook;

    if (!fb || !fb.pixelId || !fb.accessToken) {
      return res.status(400).json({ error: 'Nenhum Pixel ou Token configurado' });
    }

    const result = await metaService.sendPixelConversion(
      fb.pixelId,
      fb.accessToken,
      eventName || 'Lead',
      phone || '5511999999999',
      { value: value || 49.90, currency: 'BRL' }
    );

    res.json({ success: true, result });
  } catch (err) {
    res.status(500).json({ error: err.response?.data?.error?.message || err.message });
  }
});

module.exports = router;
