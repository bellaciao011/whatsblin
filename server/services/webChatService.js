const fs = require('fs');
const path = require('path');
const db = require('../storage/db');
const { extractNewTargetPhone, lookupProfilePicture, buildSpanishCheckoutUrl } = require('./flowEngine');
const { composeProofImage } = require('./imageComposer');
const aiService = require('./aiService');
const { eventBus } = require('./flowEngine');

const SESSIONS_FILE = path.join(__dirname, '../../data/webchat_sessions.json');

// Constrói URL direta do checkout passando 100% de todas as UTMs recebidas
function buildDirectWebCheckoutUrl(baseUrl, incomingParams = {}) {
  try {
    const u = new URL(baseUrl || 'https://go.centerpag.com/PPU38CQG5EL');
    Object.keys(incomingParams).forEach(k => {
      const val = incomingParams[k];
      if (val && typeof val === 'string' && !['sessionId', 'message', 'slug', 'timeZone', 'allParams'].includes(k)) {
        u.searchParams.set(k, val);
      }
    });

    // Se tiver allParams (objeto aninhado vindo do front), mescla também
    if (incomingParams.allParams && typeof incomingParams.allParams === 'object') {
      Object.keys(incomingParams.allParams).forEach(k => {
        const val = incomingParams.allParams[k];
        if (val && typeof val === 'string' && !['sessionId', 'message', 'slug', 'timeZone'].includes(k)) {
          u.searchParams.set(k, val);
        }
      });
    }

    if (u.searchParams.has('utm_source') && !u.searchParams.has('src')) {
      u.searchParams.set('src', u.searchParams.get('utm_source'));
    }
    if (!u.searchParams.has('sck') && u.searchParams.has('src')) {
      u.searchParams.set('sck', u.searchParams.get('src'));
    }

    return u.toString();
  } catch(e) {
    return baseUrl;
  }
}

function loadSessions() {
  try {
    if (db.getWebChatSessions) {
      return db.getWebChatSessions();
    }
    if (fs.existsSync(SESSIONS_FILE)) {
      return JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf8'));
    }
  } catch (e) {}
  return {};
}

function saveSessions(sessions) {
  try {
    if (db.saveWebChatSessions) {
      db.saveWebChatSessions(sessions);
    }
    fs.mkdirSync(path.dirname(SESSIONS_FILE), { recursive: true });
    fs.writeFileSync(SESSIONS_FILE, JSON.stringify(sessions, null, 2), 'utf8');
  } catch (e) {
    console.error('[WebChatService] Erro ao salvar sessões:', e.message);
  }
}

/**
 * Retorna as configurações ativas da atendente e do webchat
 */
const DEFAULT_WELCOME_1 = '¡Hola! 👋 Mucho gusto.\n\nMe llamo María y soy especialista en investigación de relaciones 🔍✨';
const DEFAULT_WELCOME_2 = 'Por favor, envíame a continuación el número que deseas investigar hoy con el código de su país (código de área / prefijo) 👇\n\n(Ejemplo: +507 6157-8213 o +52 686 193 2796) 📲';

function getWebChatConfig() {
  const settings = db.getSettings() || {};
  const webchat = settings.webchat || {};
  const msg1 = webchat.welcomeMsg1 || DEFAULT_WELCOME_1;
  const msg2 = webchat.welcomeMsg2 || DEFAULT_WELCOME_2;
  return {
    attendantName: webchat.attendantName || 'María',
    attendantAvatar: webchat.attendantAvatar || 'https://pps.whatsapp.net/v/t61.24694-24/813733428_1659309575529240_7059521085506520943_n.jpg?ccb=11-4&oh=01_Q5Aa5gF-J4FlH_Qp6Hw86K6kJbV6zf-_6llpJ4Uj1LmFt9T_IA&oe=6AB8CB65&_nc_sid=5e03e0&_nc_cat=111',
    welcomeMessages: [msg1, msg2],
    welcomeMessage: msg1 + '\n\n' + msg2,
    offerAmount: webchat.offerAmount || '19',
    campaignMode: webchat.campaignMode || 'webchat'
  };
}

/**
 * Inicializa ou recupera a sessão do webchat
 */
async function initSession(sessionId, utmData = {}) {
  const sessions = loadSessions();
  let session = sessions[sessionId];

  const config = getWebChatConfig();

  if (!session) {
    session = {
      id: sessionId,
      slug: utmData.slug || 'campanha',
      state: 'INITIAL',
      targetPhone: null,
      photoUrl: null,
      messages: [
        { from: 'bot', text: config.welcomeMessages[0], timestamp: new Date().toISOString() },
        { from: 'bot', text: config.welcomeMessages[1], timestamp: new Date(Date.now() + 1400).toISOString() }
      ],
      utm: utmData,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    sessions[sessionId] = session;
    saveSessions(sessions);
  }

  return {
    success: true,
    sessionId: session.id,
    attendant: {
      name: config.attendantName,
      avatar: config.attendantAvatar
    },
    welcomeMessages: config.welcomeMessages,
    welcomeMessage: config.welcomeMessage,
    history: session.messages || []
  };
}

/**
 * Processa uma mensagem enviada pelo lead no WebChat
 */
async function handleIncomingMessage(sessionId, messageText, utmData = {}, selectedDdi = null) {
  const sessions = loadSessions();
  let session = sessions[sessionId];

  if (!session) {
    session = {
      id: sessionId,
      slug: utmData.slug || 'campanha',
      state: 'INITIAL',
      targetPhone: null,
      photoUrl: null,
      messages: [],
      utm: utmData,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
  }

  const rawMsg = String(messageText || '').trim();
  const config = getWebChatConfig();
  const funnel = db.getFunnel() || {};

  // Salva mensagem do usuário
  session.messages.push({
    from: 'user',
    text: rawMsg,
    timestamp: new Date().toISOString()
  });
  session.updatedAt = new Date().toISOString();

  const replies = [];

  // 1. RECONHECIMENTO DE COMPROVANTE OU PAGAMENTO ("ya pagué", etc.)
  const isPaymentClaim = /(?:yas*pag[uú][eé]|listos*pag|pagos*realizado|yas*compr[eé]|acabos*des*pagar|pagu[eé]s*cons*tarjeta|pagos*hecho|j[aá]s*paguei|paguei)/i.test(rawMsg);
  if (isPaymentClaim && (session.state === 'OFERTA_ENVIADA' || session.state === 'NEGOCIACAO' || session.state === 'FINALIZADO')) {
    const accessCode = utmData.codigo || session.utm?.codigo || 'vip';
    const accessUrl = `https://spysfunills.vercel.app/upsell1/?code=${accessCode}`;
    const deliveryMsg = `¡Pago recibido y validado con éxito! 🎉\n\nTu acceso completo e ilimitado al panel ha sido desbloqueado.\n\nAccede ahora mismo a través de este enlace seguro:\n👉 ${accessUrl}\n\n¡Ingresa y aprovecha todas las herramientas!`;

    session.state = 'FINALIZADO';
    session.messages.push({ from: 'bot', text: deliveryMsg, timestamp: new Date().toISOString() });
    sessions[sessionId] = session;
    saveSessions(sessions);

    replies.push({ type: 'text', text: deliveryMsg, delay: 1000 });
    return { success: true, replies };
  }

  // 2. DETECÇÃO DE NÚMERO ALVO (executa fluxo de prova e oferta com DDI inteligente)
  const incomingDdi = String(selectedDdi || utmData.ddi || '').replace(/\D/g, '');
  let detectedTargetDigits = extractNewTargetPhone(rawMsg);

  if (!detectedTargetDigits && incomingDdi) {
    const cleanDigits = rawMsg.replace(/\D/g, '');
    if (cleanDigits.length >= 7 && cleanDigits.length <= 12) {
      detectedTargetDigits = incomingDdi + cleanDigits;
    }
  }

  if (detectedTargetDigits) {
    let normalizedTarget = detectedTargetDigits;
    const commonDdis = ['52', '507', '591', '56', '57', '51', '593', '34', '54', '504', '502', '503', '506', '595', '598', '505', '592', '297', '55', '1'];
    const startsWithDdi = commonDdis.some(code => normalizedTarget.startsWith(code));

    if (!startsWithDdi) {
      if (incomingDdi) {
        normalizedTarget = incomingDdi + normalizedTarget;
      } else if (normalizedTarget.length === 10 || normalizedTarget.length === 11) {
        normalizedTarget = '55' + normalizedTarget;
      }
    }

    session.targetPhone = normalizedTarget;
    session.state = 'ANALISANDO';

    // A) Mensagem imediata de análise
    const analyzingMsg = 'Espera un momento mientras verificamos en el sistema...';
    replies.push({ type: 'text', text: analyzingMsg, delay: 800 });

    // B) Busca foto do alvo via multi-estratégia blindada
    console.log(`[WebChat] 🔍 Buscando foto para número alvo: ${normalizedTarget} (DDI: ${incomingDdi || 'auto'}, Session: ${sessionId})`);
    let photoUrl = null;
    try {
      photoUrl = await lookupProfilePicture(normalizedTarget, null, incomingDdi || null);
    } catch (e) {
      console.warn('[WebChat] Erro na busca de foto:', e.message);
    }
    session.photoUrl = photoUrl;

    // C) Compõe a imagem de prova em alta resolução com o motel mais próximo da cidade do visitante
    console.log(`[WebChat] 🖼️ Gerando imagem de prova (hasPhoto: ${Boolean(photoUrl)})`);
    const clientIp = utmData.clientIp || session.utm?.clientIp || null;
    const timeZone = utmData.timeZone || session.utm?.timeZone || null;
    const imgBuffer = await composeProofImage(photoUrl, funnel.avatarCoordinates, 'es', {
      clientIp,
      timeZone,
      phone: normalizedTarget,
      ddi: incomingDdi,
      preferLocationProof: true
    });
    const proofsDir = path.join(__dirname, '../../public/generated');
    fs.mkdirSync(proofsDir, { recursive: true });
    const filename = `proof_web_${normalizedTarget}_${Date.now()}.png`;
    fs.writeFileSync(path.join(proofsDir, filename), imgBuffer);
    const webProofUrl = `/generated/${filename}`;
    const base64Data = `data:image/png;base64,${imgBuffer.toString('base64')}`;

    const proofCaption = photoUrl
      ? '✓ Prueba con foto en el audio vinculada a este número'
      : '🔒 Prueba con audio protegido por encriptación vinculada a este número';

    replies.push({
      type: 'image',
      url: webProofUrl,
      base64: base64Data,
      caption: proofCaption,
      delay: 2800
    });

    // D) Constrói URL DIRETA do checkout preservando 100% de todas as UTMs que vieram do anúncio
    const rawCheckout = funnel.checkoutUrlEs || funnel.checkouts?.es?.frontUrl || 'https://go.centerpag.com/PPU38CQG5EL';
    const combinedUtms = { ...(session.utm || {}), ...(utmData || {}) };
    const directCheckout = buildDirectWebCheckoutUrl(rawCheckout, combinedUtms);

    const offerAmount = config.offerAmount || '19';
    const offerText = `🔒 Tasa de desencriptación: $${offerAmount} 👇\n\nDatos del pago: Pago único y confidencial para desencriptar y liberar todos los audios, fotos y ubicaciones de inmediato.`;

    replies.push({
      type: 'checkout',
      text: offerText,
      checkoutUrl: directCheckout,
      amount: offerAmount,
      delay: 1800
    });

    // E) Instrução de envio de comprovante
    const proofInstruction = '¡En cuanto pagues la tasa de desencriptación, envíame el comprobante por aquí para activar tu acceso de inmediato!';
    replies.push({
      type: 'text',
      text: proofInstruction,
      delay: 1500
    });

    session.state = 'OFERTA_ENVIADA';

    // Salva mensagens no histórico
    session.messages.push({ from: 'bot', text: analyzingMsg, timestamp: new Date().toISOString() });
    session.messages.push({ from: 'bot', text: proofCaption, mediaType: 'image', mediaUrl: webProofUrl, timestamp: new Date().toISOString() });
    session.messages.push({ from: 'bot', text: offerText, checkoutUrl: directCheckout, amount: offerAmount, timestamp: new Date().toISOString() });
    session.messages.push({ from: 'bot', text: proofInstruction, timestamp: new Date().toISOString() });

    sessions[sessionId] = session;
    saveSessions(sessions);

    // Emite alerta para a Dashboard
    try {
      eventBus.emit('new_lead', {
        phone: normalizedTarget,
        codigo: utmData.codigo || 'web',
        campaign: utmData.utm_campaign || 'WebChat Simulator',
        text: `Alvo investigado: +${normalizedTarget}`,
        timestamp: new Date().toISOString()
      });
    } catch(e) {}

    return { success: true, replies };
  }

  // 3. SE NÃO FOR NÚMERO: DÚVIDAS, OBJEÇÕES OU PERGUNTAS RESPONDIDAS POR IA
  console.log(`[WebChat] 🤖 Consultando GPT em espanhol para dúvida: "${rawMsg}" (Estado: ${session.state})`);
  const stageInfo = {
    value: config.offerAmount || '19',
    checkoutUrl: buildDirectWebCheckoutUrl(funnel.checkoutUrlEs || 'https://go.centerpag.com/PPU38CQG5EL', utmData)
  };

  const aiReply = await aiService.classifyAndReply(
    rawMsg,
    session.messages,
    stageInfo,
    'es',
    session.state,
    session.targetPhone
  );

  session.messages.push({ from: 'bot', text: aiReply, timestamp: new Date().toISOString() });
  sessions[sessionId] = session;
  saveSessions(sessions);

  replies.push({ type: 'text', text: aiReply, delay: 1200 });
  return { success: true, replies };
}

/**
 * Retorna as sessões registradas no WebChat para a Dashboard
 */
function getAllSessions(limit = 50) {
  const sessions = loadSessions();
  const list = Object.values(sessions).sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));
  return list.slice(0, limit);
}

/**
 * Atualiza configurações do WebChat
 */
function updateConfig(newConfig = {}) {
  const settings = db.getSettings() || {};
  settings.webchat = {
    ...(settings.webchat || {}),
    ...newConfig
  };
  db.saveSettings(settings);
  return getWebChatConfig();
}


/**
 * Registra eventos em tempo real do WebChat (ex: clique no botão de checkout)
 */
function registerEvent(sessionId, eventType, eventData = {}) {
  const sessions = loadSessions();
  const session = sessions[sessionId];
  if (!session) return { success: false, error: 'Sessão não encontrada' };

  if (eventType === 'checkout_click') {
    session.checkoutOpened = true;
    session.checkoutOpenedAt = new Date().toISOString();
    if (session.state === 'OFERTA_ENVIADA' || session.state === 'NEGOCIACAO') {
      session.state = 'CHECKOUT_ABERTO';
    }
  }

  session.updatedAt = new Date().toISOString();
  sessions[sessionId] = session;
  saveSessions(sessions);
  console.log(`[WebChat Event] ⚡ Evento registrado para sessão ${sessionId}: ${eventType}`);
  return { success: true, session };
}

/**
 * Retorna dados estruturados e métricas para o Kanban dedicado do Fluxo Automático
 */
function getWebChatKanbanData(filters = {}) {
  // 1. Carrega sessões do Chatbot Web
  const sessions = loadSessions();
  const webList = Object.values(sessions).map(s => ({
    ...s,
    channel: 'web',
    channelLabel: '🌐 WebChat',
    leadIdentifier: s.id,
    displayPhone: s.targetPhone ? ('+' + s.targetPhone) : (s.phone ? '+' + s.phone : 'Sem número'),
    sortTime: new Date(s.updatedAt || s.createdAt || 0).getTime()
  }));

  // 2. Carrega conversas do WhatsApp que passaram pelo fluxo de automação
  const chats = db.getChats ? db.getChats() : {};
  const waList = Object.values(chats).map(c => {
    const phone = c.leadPhone || c.phone || '';
    const targetPhone = c.variables?.alvo || c.variables?.targetPhone || c.targetPhone || '';
    const photoUrl = c.variables?.photoUrl || c.senderPhoto || c.photoUrl || null;
    const lastMsg = c.messages && c.messages.length > 0 ? c.messages[c.messages.length - 1] : null;
    const timeIso = c.lastMessageTime || (lastMsg?.timestamp) || c.criado_em || c.createdAt || new Date().toISOString();

    // Mapeamento de estado para as 5 colunas do Funil
    let state = 'CHEGARAM';
    const cState = (c.state || '').toUpperCase();
    if (cState === 'FINALIZADO' || cState === 'PAGO' || c.orderStatus === 'paid') {
      state = 'FINALIZADO';
    } else if (c.checkoutOpened || cState === 'CHECKOUT_ABERTO') {
      state = 'CHECKOUT_ABERTO';
    } else if (cState === 'OFERTA_ENVIADA' || cState === 'PROPOSTA_ENVIADA' || cState === 'NEGOCIACAO' || c.variables?.checkoutUrl) {
      state = 'OFERTA_ENVIADA';
    } else if (cState === 'ANALISANDO' || targetPhone || (c.messages && c.messages.length >= 2)) {
      state = 'ANALISANDO';
    } else {
      state = 'INITIAL';
    }

    return {
      id: `wa_${phone}`,
      channel: 'whatsapp',
      channelLabel: '📱 WhatsApp',
      leadIdentifier: `Lead +${phone}`,
      leadPhone: phone,
      targetPhone: targetPhone,
      photoUrl: photoUrl,
      state: state,
      messages: c.messages || [],
      slug: c.variables?.slug || c.assignedFlowId || 'fluxo-espiao',
      utm: {
        utm_source: 'whatsapp',
        utm_campaign: c.assignedFlowId || 'fluxo-espiao-es',
        src: 'whatsapp'
      },
      createdAt: c.criado_em || c.createdAt || timeIso,
      updatedAt: timeIso,
      isWhatsApp: true,
      sortTime: new Date(timeIso).getTime()
    };
  });

  // Lista unificada com ordenação cronológica (mais recentes primeiro)
  const allList = [...webList, ...waList].sort((a, b) => b.sortTime - a.sortTime);

  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfYesterday = startOfToday - 24 * 60 * 60 * 1000;
  const sevenDaysAgo = now.getTime() - 7 * 24 * 60 * 60 * 1000;
  const thirtyDaysAgo = now.getTime() - 30 * 24 * 60 * 60 * 1000;

  // Extrai todas as campanhas e origens para os filtros da Dashboard
  const campaignSet = new Set();
  const sourceSet = new Set();

  allList.forEach(s => {
    if (s.slug) campaignSet.add(s.slug);
    if (s.utm?.utm_campaign) campaignSet.add(s.utm.utm_campaign);
    const src = s.utm?.utm_source || s.utm?.src;
    if (src) sourceSet.add(src);
  });

  const period = filters.period || 'all';
  const channel = (filters.channel || 'all').toLowerCase();
  const campaign = (filters.campaign || 'all').toLowerCase();
  const source = (filters.source || 'all').toLowerCase();
  const search = (filters.search || '').toLowerCase().trim();

  const filtered = allList.filter(s => {
    const timeMs = s.sortTime || new Date(s.createdAt || s.updatedAt || 0).getTime();

    // Filtro de Canal (Web vs WhatsApp vs Todos)
    if (channel !== 'all' && s.channel !== channel) return false;

    // Filtro de período
    if (period === 'today' && timeMs < startOfToday) return false;
    if (period === 'yesterday' && (timeMs < startOfYesterday || timeMs >= startOfToday)) return false;
    if (period === '7days' && timeMs < sevenDaysAgo) return false;
    if (period === '30days' && timeMs < thirtyDaysAgo) return false;

    // Filtro de campanha / slug
    if (campaign !== 'all') {
      const sSlug = (s.slug || '').toLowerCase();
      const sCamp = (s.utm?.utm_campaign || '').toLowerCase();
      if (sSlug !== campaign && sCamp !== campaign) return false;
    }

    // Filtro de origem / UTM Source
    if (source !== 'all') {
      const sSrc = (s.utm?.utm_source || s.utm?.src || '').toLowerCase();
      if (sSrc !== source) return false;
    }

    // Busca textual por telefone ou ID
    if (search) {
      const matchId = (s.id || '').toLowerCase().includes(search);
      const matchPhone = (s.targetPhone || '').toLowerCase().includes(search);
      const matchLeadPhone = (s.leadPhone || '').toLowerCase().includes(search);
      const matchSlug = (s.slug || '').toLowerCase().includes(search);
      if (!matchId && !matchPhone && !matchLeadPhone && !matchSlug) return false;
    }

    return true;
  });

  // Distribui os leads nas 5 colunas do funil
  const columns = {
    chegaram: [],
    mandaram_mensagem: [],
    foram_checkout: [],
    abriram_checkout: [],
    finalizado: []
  };

  filtered.forEach(s => {
    if (s.state === 'FINALIZADO') {
      columns.finalizado.push(s);
    } else if (s.state === 'CHECKOUT_ABERTO' || s.checkoutOpened) {
      columns.abriram_checkout.push(s);
    } else if (s.state === 'OFERTA_ENVIADA' || s.state === 'NEGOCIACAO') {
      columns.foram_checkout.push(s);
    } else if (s.state === 'ANALISANDO' || s.targetPhone) {
      columns.mandaram_mensagem.push(s);
    } else {
      columns.chegaram.push(s);
    }
  });

  // Métricas Consolidadas do Funil
  const totalVisitors = filtered.length;
  const totalMessaged = filtered.filter(s => s.targetPhone || ['ANALISANDO', 'OFERTA_ENVIADA', 'NEGOCIACAO', 'CHECKOUT_ABERTO', 'FINALIZADO'].includes(s.state)).length;
  const totalReachedCheckout = filtered.filter(s => ['OFERTA_ENVIADA', 'NEGOCIACAO', 'CHECKOUT_ABERTO', 'FINALIZADO'].includes(s.state)).length;
  const totalOpenedCheckout = filtered.filter(s => s.checkoutOpened || ['CHECKOUT_ABERTO', 'FINALIZADO'].includes(s.state)).length;
  const totalPaid = columns.finalizado.length;

  const metrics = {
    totalVisitors,
    totalMessaged,
    totalReachedCheckout,
    totalOpenedCheckout,
    totalPaid,
    rateMessaged: totalVisitors > 0 ? ((totalMessaged / totalVisitors) * 100).toFixed(1) : '0.0',
    rateReachedCheckout: totalVisitors > 0 ? ((totalReachedCheckout / totalVisitors) * 100).toFixed(1) : '0.0',
    rateOpenedCheckout: totalReachedCheckout > 0 ? ((totalOpenedCheckout / totalReachedCheckout) * 100).toFixed(1) : '0.0',
    rateFinalConversion: totalVisitors > 0 ? ((totalPaid / totalVisitors) * 100).toFixed(1) : '0.0'
  };

  return {
    success: true,
    metrics,
    columns,
    counts: {
      chegaram: columns.chegaram.length,
      mandaram_mensagem: columns.mandaram_mensagem.length,
      foram_checkout: columns.foram_checkout.length,
      abriram_checkout: columns.abriram_checkout.length,
      finalizado: columns.finalizado.length
    },
    campaigns: Array.from(campaignSet),
    sources: Array.from(sourceSet),
    totalFiltered: filtered.length
  };
}

function updateSessionState(sessionId, newState) {
  const sessions = loadSessions();
  const session = sessions[sessionId];
  if (!session) return { success: false, error: 'Sessão não encontrada' };

  session.state = newState;
  if (newState === 'FINALIZADO') {
    session.paid = true;
    session.paidAt = new Date().toISOString();
  } else if (newState === 'CHECKOUT_ABERTO') {
    session.checkoutOpened = true;
    session.checkoutOpenedAt = session.checkoutOpenedAt || new Date().toISOString();
  }
  session.updatedAt = new Date().toISOString();
  sessions[sessionId] = session;
  saveSessions(sessions);
  console.log(`[WebChat State] Status da sessão ${sessionId} alterado para ${newState}`);
  return { success: true, session };
}

module.exports = {
  getWebChatConfig,
  initSession,
  handleIncomingMessage,
  getAllSessions,
  updateConfig,
  registerEvent,
  getWebChatKanbanData,
  updateSessionState
};
