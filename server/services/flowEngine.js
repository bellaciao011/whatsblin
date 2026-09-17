const db = require('../storage/db');
const { composeProofImage } = require('./imageComposer');
const metaService = require('./metaService');
const tiktokService = require('./tiktokService');
const aiService = require('./aiService');
const uazapiService = require('./uazapiService');
const cryptoService = require('./cryptoService');
const EventEmitter = require('events');
const axios = require('axios');
const path = require('path');
const fs = require('fs');

const eventBus = new EventEmitter();

// Trava física de gateway para impedir múltiplos disparos na rede uazapi/WhatsApp dentro de 8 segundos
const lastPhysicalSendTimes = new Map();


// Trava global de concorrência por lead para impedir execuções simultâneas paralelas
const activeLeadLocks = new Map();
// Histórico de timestamps do último envio do bot por lead para debounce rigoroso
const lastBotReplyTimestamps = new Map();
// Cache compartilhado em memória de IDs de mensagens já processadas
const seenMessageIds = new Set();

function isLeadLocked(cleanPhone) {
  const lockTime = activeLeadLocks.get(cleanPhone);
  if (!lockTime) return false;
  if (Date.now() - lockTime > 25000) {
    activeLeadLocks.delete(cleanPhone);
    return false;
  }
  return true;
}

function acquireLeadLock(cleanPhone) {
  if (isLeadLocked(cleanPhone)) return false;
  activeLeadLocks.set(cleanPhone, Date.now());
  return true;
}

function releaseLeadLock(cleanPhone) {
  activeLeadLocks.delete(cleanPhone);
}

function hasRecentBotReply(cleanPhone, cooldownMs = 12000) {
  const lastTime = lastBotReplyTimestamps.get(cleanPhone);
  if (!lastTime) return false;
  return (Date.now() - lastTime) < cooldownMs;
}

function recordBotReply(cleanPhone) {
  lastBotReplyTimestamps.set(cleanPhone, Date.now());
}

function isMessageAlreadyHandled(msgId, cleanPhone, text, timestampMs) {
  // Se o lead ainda não recebeu NENHUMA resposta do bot, NUNCA bloquear!
  if (cleanPhone) {
    try {
      const chat = db.getChat(cleanPhone);
      const hasBotReplied = chat?.messages && chat.messages.some(m => m.from === 'bot' || m.from === 'agent');
      if (!hasBotReplied) return false;
    } catch (e) {}
  }

  // Início de campanha/anúncio pelo lead nunca é bloqueado como duplicata
  const isStart = Boolean(
    (text && /(?:quiero\s*espiar|quero\s*espiar|espiar\s*un\s*n[uú]mero|iniciar\s*investigaci[oó]n|iniciar\s*rastreo|come[çc]ar\s*investiga|m[aá]s\s*informaci[oó]n|mais\s*informa[çc][oõ]es|informaci[oó]n\s*sobre\s*esto|hola|ol[aá]|buenas)/i.test(text)) ||
    (text && /\([A-Za-z0-9]{4,8}\)/.test(text)) ||
    (text && /c[oó]digo\s*:?\s*[A-Za-z0-9]{4,8}/i.test(text))
  );
  if (isStart) return false;

  // Envio de número de telefone nunca é bloqueado como duplicata
  const isPhone = Boolean(extractNewTargetPhone(text));
  if (isPhone) return false;

  // Mensagem com o mesmo ID exato que já foi completamente tratada
  if (msgId && seenMessageIds.has(msgId)) return true;

  return false;
}

function markMessageHandled(msgId) {
  if (msgId) seenMessageIds.add(msgId);
  if (seenMessageIds.size > 10000) {
    const it = seenMessageIds.values();
    for (let i = 0; i < 2000; i++) seenMessageIds.delete(it.next().value);
  }
}


/**
 * Simula status de presença 'composing' (digitando) nativo no WhatsApp e no Live Chat
 */
async function simulateTyping(inst, cleanPhone, durationMs = 2000, presenceType = 'composing') {
  if (!cleanPhone) return;

  // Notifica o Live Chat do painel que o bot está digitando
  eventBus.emit('chat_typing', { phone: cleanPhone, isTyping: true, who: 'bot' });

  // Envia presença nativa na uazapi para o WhatsApp do contato
  if (inst && inst.tipo === 'uazapi' && inst.instance_token) {
    try {
      const decToken = cryptoService.decrypt(inst.instance_token);
      await uazapiService.sendPresence(inst.url_servidor, decToken, cleanPhone, presenceType, (durationMs || 2000) + 1000);
    } catch (err) {
      // Falha silenciosa de presença (não interrompe o fluxo)
    }
  }

  // Delay natural humano
  if (durationMs > 0) {
    await new Promise(r => setTimeout(r, durationMs));
  }

  // Finaliza status de digitando no Live Chat
  eventBus.emit('chat_typing', { phone: cleanPhone, isTyping: false, who: 'bot' });
}

/**
 * Abstração unificada de envio de mensagem de texto (suporta uazapi e Meta Cloud API com delay humano)
 */
async function sendOutgoingTextMessage(inst, cleanPhone, text, typingDelay = 2000) {
  if (!inst || !cleanPhone || !text) return;

  // SANITIZADOR DE IDIOMA RIGOROSO: NUNCA envia mensagens em português do funil antigo
  if (text.includes('R$ 49,90') || text.startsWith('Oi!') || text.includes('áudios descriptografados') || text.includes('você') || text.includes('preciso que me envie o número da pessoa')) {
    console.warn(`[FlowEngine] 🛑 BLOQUEIO DE IDIOMA: Tentativa de envio em português barrada para +${cleanPhone}!`);
    return;
  }

  const now = Date.now();
  lastPhysicalSendTimes.set(cleanPhone, now);
  recordBotReply(cleanPhone);

  if (typingDelay && typingDelay > 0) {
    await simulateTyping(inst, cleanPhone, typingDelay, 'composing');
  }

  if (inst.tipo === 'uazapi' && inst.instance_token) {
    try {
      const decToken = cryptoService.decrypt(inst.instance_token);
      await uazapiService.sendTextMessage(inst.url_servidor, decToken, cleanPhone, text);
    } catch (err) {
      console.error(`[FlowEngine] Erro ao enviar texto via uazapi para ${cleanPhone}:`, err.message);
    }
  } else if (inst.phoneNumberId && inst.accessToken) {
    try {
      await metaService.sendTextMessage(inst.phoneNumberId, inst.accessToken, cleanPhone, text);
    } catch (err) {
      console.error(`[FlowEngine] Erro ao enviar texto via Meta para ${cleanPhone}:`, err.message);
    }
  }
}

/**
 * Abstração unificada de envio de imagem (suporta uazapi e Meta Cloud API com delay humano)
 */
async function sendOutgoingImageMessage(inst, cleanPhone, imgBuffer, filename, mimeType, caption, typingDelay = 2500) {
  if (!inst || !cleanPhone) return;
  const now = Date.now();
  lastPhysicalSendTimes.set(cleanPhone, now);
  recordBotReply(cleanPhone);

  if (typingDelay && typingDelay > 0) {
    await simulateTyping(inst, cleanPhone, typingDelay, 'composing');
  }

  if (inst.tipo === 'uazapi' && inst.instance_token) {
    try {
      const decToken = cryptoService.decrypt(inst.instance_token);
      const dataUri = `data:${mimeType || 'image/png'};base64,${imgBuffer.toString('base64')}`;
      await uazapiService.sendMediaMessage(
        inst.url_servidor,
        decToken,
        cleanPhone,
        dataUri,
        caption || '',
        filename || 'foto.png',
        'image'
      );
    } catch (err) {
      console.error(`[FlowEngine] Erro ao enviar imagem via uazapi para ${cleanPhone}:`, err.message);
    }
  } else if (inst.phoneNumberId && inst.accessToken) {
    try {
      const mediaId = await metaService.uploadMedia(
        inst.phoneNumberId,
        inst.accessToken,
        imgBuffer,
        filename,
        mimeType || 'image/png'
      );
      await metaService.sendImageMessage(
        inst.phoneNumberId,
        inst.accessToken,
        cleanPhone,
        mediaId
      );
    } catch (err) {
      console.error(`[FlowEngine] Erro ao enviar imagem via Meta para ${cleanPhone}:`, err.message);
    }
  }
}

/**
 * Consulta a foto do perfil do número alvo via API oficial do stalkea.app
 */
async function lookupProfilePicture(targetPhone, instance = null, ddi = null) {
  if (!targetPhone) return null;
  let raw = String(targetPhone).replace(/\D/g, '');
  if (!raw) return null;

  let digits = raw;
  if (ddi) {
    const cleanDdi = String(ddi).replace(/\D/g, '');
    if (!raw.startsWith(cleanDdi)) {
      digits = cleanDdi + raw;
    }
  } else {
    const commonDdis = ['52', '507', '591', '56', '57', '51', '593', '34', '54', '504', '502', '503', '506', '595', '598', '505', '592', '297', '55', '1'];
    const startsWithDdi = commonDdis.some(code => digits.startsWith(code));
    if (!startsWithDdi && (digits.length === 10 || digits.length === 11)) {
      digits = '55' + digits;
    }
  }

  // Candidatos para consulta multi-formato internacional
  const candidates = [digits];

  // Brasil: 12 dígitos (55 + DDD + 8 dígitos) <-> 13 dígitos (55 + DDD + 9 + 8 dígitos)
  if (digits.startsWith('55')) {
    const after55 = digits.substring(2);
    if (after55.length === 11 && after55[2] === '9') {
      candidates.push('55' + after55.substring(0, 2) + after55.substring(3)); // 8 dígitos sem o 9
    } else if (after55.length === 10) {
      candidates.push('55' + after55.substring(0, 2) + '9' + after55.substring(2)); // 9 dígitos com o 9
    }
    candidates.push(after55); // sem o 55
  }

  // México: 52 1 ... <-> 52 ...
  if (digits.startsWith('521')) {
    candidates.push('52' + digits.substring(3));
  } else if (digits.startsWith('52') && !digits.startsWith('521')) {
    candidates.push('521' + digits.substring(2));
  }

  // Argentina: 54 9 ... <-> 54 ...
  if (digits.startsWith('549')) {
    candidates.push('54' + digits.substring(3));
  } else if (digits.startsWith('54') && !digits.startsWith('549')) {
    candidates.push('549' + digits.substring(2));
  }

  const instances = db.getInstances();
  const inst = instance || instances.find(i => i.status === 'connected' && i.tipo === 'uazapi') || instances.find(i => i.tipo === 'uazapi') || instances[0];
  const decToken = inst && inst.instance_token ? cryptoService.decrypt(inst.instance_token) : null;
  const baseUrl = inst ? (inst.url_servidor || 'https://whatsblin.uazapi.com') : 'https://whatsblin.uazapi.com';

  // 1. PRIORIDADE MÁXIMA: Verifica se o número consultado pertence a uma das instâncias do sistema (ex: próprio chip / atendente)
  for (const i of instances) {
    const iOwner = String(i.owner || i.phone || '').replace(/\D/g, '');
    if (iOwner && candidates.some(c => c === iOwner || c.endsWith(iOwner) || iOwner.endsWith(c))) {
      const pUrl = i.profilePicUrl || i.photo || i.image;
      if (pUrl && typeof pUrl === 'string' && pUrl.startsWith('http')) {
        console.log(`[Lookup API] ✓ Foto encontrada no cadastro da instância (${i.name}): ${pUrl.slice(0, 75)}...`);
        return pUrl;
      }
    }
  }

  // 1.1 Consulta ao vivo /instance/status caso o Uazapi guarde a foto do chip conectado
  if (decToken) {
    try {
      const statusRes = await axios.get(`${baseUrl}/instance/status`, {
        headers: { token: decToken },
        timeout: 4000
      });
      const instData = statusRes.data?.instance;
      if (instData) {
        // Atualiza campos da instância local em memória/cache se faltavam
        if (inst && instData.owner && !inst.owner) inst.owner = instData.owner;
        if (inst && instData.profilePicUrl && !inst.profilePicUrl) inst.profilePicUrl = instData.profilePicUrl;

        const ownerDigits = String(instData.owner || '').replace(/\D/g, '');
        if (ownerDigits && candidates.some(c => c === ownerDigits || c.endsWith(ownerDigits) || ownerDigits.endsWith(c))) {
          if (instData.profilePicUrl && typeof instData.profilePicUrl === 'string' && instData.profilePicUrl.startsWith('http')) {
            console.log(`[Lookup API] ✓ Foto encontrada via /instance/status para ${targetPhone}: ${instData.profilePicUrl.slice(0, 75)}...`);
            return instData.profilePicUrl;
          }
        }
      }
    } catch (e) {
      // continua
    }
  }

  // 2. Consulta no cache de conversas do WhatsApp na UAZAPI (/chat/find por wa_chatid)
  if (decToken) {
    for (const num of candidates) {
      try {
        const res = await axios.post(`${baseUrl}/chat/find`, {
          wa_chatid: `${num}@s.whatsapp.net`
        }, {
          headers: { token: decToken, 'Content-Type': 'application/json' },
          timeout: 4000
        });
        const chat = res.data?.chats?.[0];
        const photo = chat?.image || chat?.imagePreview || chat?.photo || chat?.profilePicUrl || chat?.wa_profilePicUrl;
        if (photo && typeof photo === 'string' && photo.startsWith('http')) {
          console.log(`[Lookup API] ✓ Foto pública encontrada via wa_chatid em /chat/find para ${num}: ${photo.slice(0, 75)}...`);
          return photo;
        }
      } catch (e) {
        // ignora e passa para próxima estratégia
      }
    }

    // 2.1 Busca na lista recente de /chat/find comparando dígitos
    try {
      const res = await axios.post(`${baseUrl}/chat/find`, { limit: 100 }, {
        headers: { token: decToken, 'Content-Type': 'application/json' },
        timeout: 5000
      });
      const chats = res.data?.chats || [];
      for (const c of chats) {
        const cPhoneDigits = String(c.phone || '').replace(/\D/g, '');
        const cChatIdDigits = String(c.wa_chatid || '').replace(/\D/g, '');
        const cFastIdDigits = String(c.wa_fastid || '').replace(/\D/g, '');
        const match = candidates.some(num =>
          (cPhoneDigits && (cPhoneDigits === num || cPhoneDigits.endsWith(num) || num.endsWith(cPhoneDigits))) ||
          (cChatIdDigits && (cChatIdDigits === num || cChatIdDigits.endsWith(num) || num.endsWith(cChatIdDigits))) ||
          (cFastIdDigits && (cFastIdDigits.endsWith(num) || num.endsWith(cFastIdDigits)))
        );
        if (match) {
          const photo = c.image || c.imagePreview || c.photo || c.profilePicUrl || c.wa_profilePicUrl;
          if (photo && typeof photo === 'string' && photo.startsWith('http')) {
            console.log(`[Lookup API] ✓ Foto encontrada na lista /chat/find para ${targetPhone}: ${photo.slice(0, 75)}...`);
            return photo;
          }
        }
      }
    } catch (e) {
      // ignora e continua
    }
  }

  // 3. Busca no banco de dados local db.getChats()
  try {
    const localChats = db.getChats ? db.getChats() : {};
    const chatList = Array.isArray(localChats) ? localChats : Object.values(localChats);
    for (const c of chatList) {
      const cDigits = String(c.phone || c.chatId || '').replace(/\D/g, '');
      const match = candidates.some(num => cDigits && (cDigits === num || cDigits.endsWith(num) || num.endsWith(cDigits)));
      if (match) {
        const photo = c.leadPhoto || c.photo || c.image || c.imagePreview || c.profilePicUrl || c.variables?.photoUrl;
        if (photo && typeof photo === 'string' && photo.startsWith('http')) {
          console.log(`[Lookup API] ✓ Foto encontrada no banco local db para ${targetPhone}: ${photo.slice(0, 75)}...`);
          return photo;
        }
      }
    }
  } catch (e) {
    // ignora
  }

  // 4. Se houver token na Uazapi, tenta consulta direta /chat/details (resolução original e preview)
  if (decToken) {
    for (const num of candidates) {
      try {
        const res = await axios.post(`${baseUrl}/chat/details`, { number: num, preview: false }, {
          headers: { token: decToken, 'Content-Type': 'application/json' },
          timeout: 4000
        });
        const d = res.data;
        const photo = d?.image || d?.imagePreview || d?.profilePicUrl || d?.photo || d?.picture || d?.data?.image || d?.data?.imagePreview || d?.data?.profilePicUrl;
        if (photo && typeof photo === 'string' && photo.startsWith('http')) {
          console.log(`[Lookup API] ✓ Foto pública encontrada ao vivo via /chat/details (full): ${photo.slice(0, 75)}...`);
          return photo;
        }
        // Fallback preview
        if (!photo) {
          const resPrev = await axios.post(`${baseUrl}/chat/details`, { number: num, preview: true }, {
            headers: { token: decToken, 'Content-Type': 'application/json' },
            timeout: 3000
          });
          const pPrev = resPrev.data?.imagePreview || resPrev.data?.image;
          if (pPrev && typeof pPrev === 'string' && pPrev.startsWith('http')) {
            console.log(`[Lookup API] ✓ Foto pública encontrada ao vivo via /chat/details (preview): ${pPrev.slice(0, 75)}...`);
            return pPrev;
          }
        }
      } catch (uazErr) {
        // ignora erro e continua tentativas
      }
    }
  }

  // 5. Fallback Stalkea.app
  for (const num of candidates) {
    try {
      const url = `https://stalkea.app/spp/api/profile-picture.php?phone=${encodeURIComponent(num)}`;
      const res = await axios.get(url, {
        timeout: 3500,
        headers: { 'User-Agent': 'Mozilla/5.0' }
      });
      if (res.data && res.data.urlImage && typeof res.data.urlImage === 'string' && res.data.urlImage.startsWith('http')) {
        console.log(`[Lookup API] ✓ Foto encontrada via stalkea.app: ${res.data.urlImage.slice(0, 75)}...`);
        return res.data.urlImage;
      }
    } catch (stalkErr) {
      // ignore
    }
  }

  console.log(`[Lookup API] 🔒 Perfil sem foto pública ou indisponível para ${targetPhone} (retornou null)`);
  return null;
}

function interpolateVariables(text, variables) {
  if (!text) return '';
  return text
    .replace(/\{primeiro_nome\}/gi, variables.firstName || 'Amigo(a)')
    .replace(/\{nome\}/gi, variables.name || variables.firstName || 'Amigo(a)')
    .replace(/\{telefone\}/gi, variables.phone || '')
    .replace(/\{phone_number\}/gi, variables.phone || '')
    .replace(/\{alvo\}/gi, variables.alvo || '')
    .replace(/\{email\}/gi, variables.email || 'contato@cliente.com')
    .replace(/\{comprovante\.valor\}/gi, variables.valor_atual || variables.valor_pago || '49.90')
    .replace(/\{page_id\}/gi, variables.pageId || '')
    .replace(/\{checkoutUrl\}/gi, variables.checkoutUrl || 'https://pay.kirvano.com/checkout-49')
    .replace(/\{checkoutUrl100\}/gi, variables.checkoutUrl100 || 'https://pay.kirvano.com/checkout-100')
    .replace(/\{checkoutUrl200\}/gi, variables.checkoutUrl200 || 'https://pay.kirvano.com/checkout-200')
    .replace(/\{checkoutUrl400\}/gi, variables.checkoutUrl400 || 'https://pay.kirvano.com/checkout-400')
    .replace(/\{link_pagamento\}/gi, variables.checkoutUrl || 'https://pay.kirvano.com/checkout-49')
    .replace(/\{valor_atual\}/gi, variables.valor_atual || '49,90')
    .replace(/\{proximo_valor\}/gi, variables.proximo_valor || '100')
    .replace(/\{valor_pago\}/gi, variables.valor_pago || '0');
}

/**
 * Executa nó do tipo Pixel CAPI disparando evento para a Meta
 */
async function executePixelNode(pixelNode, chatData) {
  const data = pixelNode.data || {};
  const pixels = db.getPixels();
  let pixel = pixels.find(p => p.id === data.pixelId || p.pixelId === data.pixelId);
  if (!pixel && pixels.length > 0) pixel = pixels[0];

  const eventName = data.eventType || data.eventName || 'Purchase';
  const rawVal = interpolateVariables(data.itemValue || data.value || '{valor_atual}', chatData.variables);
  const numVal = parseFloat(String(rawVal).replace(',', '.')) || 49.90;
  const pageId = interpolateVariables(data.pageId || pixel?.pageId || '', chatData.variables);
  const currency = data.currency || (chatData.flowLanguage === 'pt' ? 'BRL' : 'USD');

  console.log(`[FlowEngine] 🎯 Disparando nó de Pixel: ${eventName} (Valor: ${numVal} ${currency})`);

  if (pixel) {
    return await metaService.sendPixelConversion(
      pixel.pixelId,
      pixel.accessToken,
      eventName,
      chatData.leadPhone,
      {
        value: numVal,
        currency,
        pageId,
        pixelName: pixel.name,
        testEventCode: pixel.testEventCode
      }
    );
  } else {
    console.warn('[FlowEngine] Nenhum pixel cadastrado para disparar nó.');
    return { success: false, error: 'Nenhum pixel cadastrado' };
  }
}

/**
 * Executa nó do tipo Integração (Webhook / HTTP Request)
 */
async function executeIntegrationNode(integrationNode, chatData) {
  const data = integrationNode.data || {};
  const method = (data.method || 'GET').toUpperCase();
  const rawUrl = interpolateVariables(data.url || data.endpoint || '', chatData.variables);
  if (!rawUrl || !rawUrl.startsWith('http')) return { success: false, error: 'URL inválida' };

  let headers = { 'User-Agent': 'WhatsHub-Bot/1.0' };
  if (data.headers) {
    try {
      const parsed = typeof data.headers === 'string' ? JSON.parse(interpolateVariables(data.headers, chatData.variables)) : data.headers;
      headers = { ...headers, ...parsed };
    } catch (e) {}
  }

  let body = null;
  if (method !== 'GET' && data.body) {
    try {
      body = typeof data.body === 'string' ? JSON.parse(interpolateVariables(data.body, chatData.variables)) : data.body;
    } catch (e) {
      body = interpolateVariables(data.body, chatData.variables);
    }
  }

  console.log(`[FlowEngine] 🌐 Executando nó de Integração: ${method} ${rawUrl}`);

  try {
    const res = await axios({
      method,
      url: rawUrl,
      headers,
      data: body,
      timeout: 8000
    });
    return { success: true, status: res.status, data: res.data };
  } catch (err) {
    console.warn('[FlowEngine] Falha na integração externa:', err.message);
    return { success: false, status: err.response?.status || 500, error: err.message };
  }
}

/**
 * Executa nó do tipo Pixel TikTok disparando evento server-side via TikTok Events API v1.3
 */
async function executeTikTokPixelNode(tiktokNode, chatData) {
  const data = tiktokNode.data || {};
  const ttPixels = db.getTikTokPixels();
  let pixel = ttPixels.find(p => p.id === data.pixel_configurado_id || p.pixel_code === data.pixel_configurado_id);
  if (!pixel && ttPixels.length > 0) pixel = ttPixels[0];

  const eventName = data.tipo_evento || data.eventType || 'CompletePayment';
  const rawVal = interpolateVariables(data.valor || data.itemValue || '{valor_atual}', chatData.variables);
  const numVal = parseFloat(String(rawVal).replace(',', '.')) || 49.90;
  const currency = data.moeda || data.currency || (chatData.flowLanguage === 'pt' ? 'BRL' : 'USD');
  const allowWithoutAttribution = data.disparar_sem_atribuicao !== false;

  // Busca atribuição vinculada a este telefone
  const attribution = db.getTrafficAttributionByPhone(chatData.leadPhone);

  if (!attribution && !allowWithoutAttribution) {
    console.log(`[FlowEngine] ⏩ Pulando disparo TikTok para ${chatData.leadPhone}: lead sem atribuição de campanha e nó configurado para não disparar.`);
    return { success: true, skipped: true };
  }

  if (pixel) {
    return await tiktokService.sendTikTokEvent({
      pixelCode: pixel.pixel_code,
      accessToken: pixel.access_token,
      eventName,
      phone: chatData.leadPhone,
      attribution,
      value: numVal,
      currency,
      eventId: `tt_${chatData.leadPhone}_${Date.now()}`
    });
  } else {
    console.warn('[FlowEngine] Nenhum pixel do TikTok cadastrado para disparar nó.');
    return { success: false, error: 'Nenhum pixel TikTok cadastrado' };
  }
}

/**
 * Obtém os dados da etapa atual de pagamento/upsell com formatação de moeda correta
 */

/**
 * Gera a URL de checkout da CenterPag com a UTM/Token de camuflagem
 * para desbloquear a página real de Upsell 1 (https://spysfunills.vercel.app/upsell1/)
 */
function getCustomTrackingDomain() {
  try {
    const campaigns = db.getTrafficCampaigns();
    const camp = campaigns.find(c => c.custom_domain && c.custom_domain.trim());
    if (camp && camp.custom_domain) return camp.custom_domain.trim();

    const domains = db.getCustomDomains();
    const active = domains.find(d => (d.status === 'ativo' || d.ativo) && d.dominio);
    if (active && active.dominio) return active.dominio.trim();
  } catch (e) {}
  return 'wtb.expresstrackin-g.com';
}

function buildSpanishCheckoutUrl(baseUrl, leadCode = 'lead') {
  const cleanCode = (leadCode || 'lead').toUpperCase().replace(/[^A-Z0-9]/g, '') || 'LEAD';
  const domain = getCustomTrackingDomain();
  return `https://${domain}/checkout?codigo=${cleanCode}`;
}

function getCurrentStageInfo(stageKey, funnel, language = 'pt', leadCode = 'lead') {
  const lang = (language || 'pt').toLowerCase();

  // No funil em espanhol: oferta única front-end de $19 USD com camuflagem de Upsell (CenterPag)
  if (lang === 'es') {
    const rawUrl = funnel.checkoutUrlEs || funnel.checkouts?.es?.frontUrl || 'https://go.centerpag.com/PPU38CQG5EL';
    const cloakedCheckout = buildSpanishCheckoutUrl(rawUrl, leadCode);
    return {
      stage: stageKey || 'stage_49',
      value: '19',
      checkoutUrl: cloakedCheckout,
      nextStage: null,
      nextValue: null,
      paidValue: stageKey === 'stage_finalizado' ? '19' : '0'
    };
  }

  const isPt = lang === 'pt';
  const default49 = isPt ? '49,90' : '49.90';
  const stages = funnel.upsellStages || {};
  const current = stages[stageKey] || stages.stage_49 || {
    value: default49,
    checkoutUrl: 'https://pay.kirvano.com/checkout-49',
    nextStage: 'stage_100'
  };

  // Se houver código de lead, anexa UTMs e code no checkout brasileiro também
  if (leadCode && leadCode !== 'lead' && leadCode !== 'LEAD' && current.checkoutUrl) {
    try {
      const u = new URL(current.checkoutUrl);
      const codeUpper = String(leadCode).toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (codeUpper) {
        u.searchParams.set('code', codeUpper);
        u.searchParams.set('codigo', codeUpper);
        u.searchParams.set('utm_source', codeUpper);
        u.searchParams.set('src', codeUpper);
        u.searchParams.set('sck', codeUpper);
        current.checkoutUrl = u.toString();
      }
    } catch(e) {}
  }

  const next = stages[current.nextStage] || { value: '100' };

  let paidValue = '0';
  if (stageKey === 'stage_49') paidValue = '0';
  else if (stageKey === 'stage_100') paidValue = default49;
  else if (stageKey === 'stage_200') paidValue = '100';
  else if (stageKey === 'stage_400') paidValue = '200';

  return {
    stage: stageKey,
    value: current.value || default49,
    checkoutUrl: current.checkoutUrl,
    nextStage: current.nextStage,
    nextValue: next.value || '100',
    paidValue: paidValue
  };
}

/**
 * Detecta se a mensagem contém um número de telefone com DDD válido para investigação
 * Suporta formatos: 96981266512, (96) 98126-6512, 11999998888, +55 11 98888-7777, etc.
 */
function extractNewTargetPhone(text) {
  if (!text || typeof text !== 'string') return null;
  const clean = text.trim();

  // Ignora se for comprovante ou comando entre colchetes
  if (clean.startsWith('[') && clean.endsWith(']')) return null;

  // 1. Procura ocorrências de telefones formatados (+507 6157-8213, +55 11 99999-8888, etc.)
  const phonePattern = /(?:\+?\d{1,4}[\s-]?)?(?:\(?\d{2,4}\)?[\s-]?)?\d{3,5}[\s-]?\d{4}/g;
  const matches = clean.match(phonePattern);
  if (matches) {
    for (const m of matches) {
      const digits = m.replace(/\D/g, '');
      if (digits.length >= 8 && digits.length <= 15) {
        return digits;
      }
    }
  }

  // 2. Sequência contínua de dígitos em palavras
  const words = clean.split(/[\s,;:!?]+/);
  for (const w of words) {
    const d = w.replace(/\D/g, '');
    if (d.length >= 8 && d.length <= 15) {
      return d;
    }
  }

  // 3. Fallback: dígitos totais
  const rawDigits = clean.replace(/\D/g, '');
  if (rawDigits.length >= 8 && rawDigits.length <= 15) {
    return rawDigits;
  }

  return null;
}

function getStageTag(state, upsellStage) {
  const st = (state || 'NOVO').toUpperCase();
  const up = (upsellStage || 'stage_49').toLowerCase();

  if (st === 'FINALIZADO' || st === 'PAGO' || st === 'APROVADO') {
    return { id: 'pago', label: 'Venda Aprovada', icon: '✅', color: '#10b981', bg: 'rgba(16,185,129,0.15)', border: 'rgba(16,185,129,0.35)' };
  }
  if (up === 'stage_400') {
    return { id: 'upsell_400', label: 'Upsell R$400', icon: '💎', color: '#ec4899', bg: 'rgba(236,72,153,0.15)', border: 'rgba(236,72,153,0.35)' };
  }
  if (up === 'stage_200') {
    return { id: 'upsell_200', label: 'Upsell R$200', icon: '💎', color: '#a855f7', bg: 'rgba(168,85,247,0.15)', border: 'rgba(168,85,247,0.35)' };
  }
  if (up === 'stage_100') {
    return { id: 'upsell_100', label: 'Upsell R$100', icon: '💎', color: '#8b5cf6', bg: 'rgba(139,92,246,0.15)', border: 'rgba(139,92,246,0.35)' };
  }
  if (st === 'DUVIDAS' || st === 'NEGOCIACAO') {
    return { id: 'duvidas', label: 'Tirando Dúvidas (IA)', icon: '🤖', color: '#06b6d4', bg: 'rgba(6,182,212,0.15)', border: 'rgba(6,182,212,0.35)' };
  }
  if (st === 'OFERTA_ENVIADA') {
    return { id: 'oferta', label: 'Oferta Enviada', icon: '💬', color: '#3b82f6', bg: 'rgba(59,130,246,0.15)', border: 'rgba(59,130,246,0.35)' };
  }
  if (st === 'PROVA_ENVIADA') {
    return { id: 'prova', label: 'Prova Enviada', icon: '📸', color: '#8b5cf6', bg: 'rgba(139,92,246,0.15)', border: 'rgba(139,92,246,0.35)' };
  }
  if (st === 'ANALISANDO') {
    return { id: 'analisando', label: 'Pesquisando Alvo', icon: '🔍', color: '#f59e0b', bg: 'rgba(245,158,11,0.15)', border: 'rgba(245,158,11,0.35)' };
  }
  if (st === 'AGUARDANDO_NUMERO') {
    return { id: 'aguardando', label: 'Aguardando Número', icon: '🟡', color: '#eab308', bg: 'rgba(234,179,8,0.15)', border: 'rgba(234,179,8,0.35)' };
  }
  return { id: 'novo', label: 'Novo Lead', icon: '🟢', color: '#10b981', bg: 'rgba(16,185,129,0.15)', border: 'rgba(16,185,129,0.35)' };
}

/**
 * MOTOR DE EXECUÇÃO DO GRAFO VISUAL - MULTILÍNGUE COM VINCULAÇÃO ESTRITA DE CHIP
 */
async function executeFlowGraph(instance, cleanPhone, messageText, mediaAttachment = null) {
  const instances = db.getInstances();
  const inst = instances.find(i => i.id === instance?.id || i.instance_id === instance?.id || (instance?.instance_id && i.instance_id === instance.instance_id) || (instance?.phoneNumberId && i.phoneNumberId === instance.phoneNumberId)) || instance || instances[0] || { id: 'inst_1' };
  const funnel = db.getFunnel();
  let chatData = db.getChat(cleanPhone);

  // 1. Vinculação Estrita: fluxo em Espanhol
  const targetFlowId = inst.assignedFlowId || chatData?.assignedFlowId || 'fluxo-espiao-es';
  const flows = db.getFlows();
  const activeFlow = flows.find(f => f.id === targetFlowId) || flows.find(f => f.status === 'ativo') || flows[0];
  const flowLanguage = 'es'; // RIGOROSAMENTE 100% ESPANHOL

  console.log(`[FlowEngine] 🚀 Executando fluxo: "${activeFlow?.name}" (${activeFlow?.id}, lang: ${flowLanguage}) para Chip: "${inst.name || inst.id}"`);
  
  if (!chatData) {
    chatData = {
      leadPhone: cleanPhone,
      leadName: `Lead ${cleanPhone}`,
      instanceId: inst.id || 'inst_1',
      assignedFlowId: activeFlow.id,
      flowLanguage: flowLanguage,
      state: 'NOVO',
      currentNodeId: null,
      upsellStage: 'stage_49',
      variables: {},
      lastMessageTime: new Date().toISOString(),
      messages: []
    };
  }

  // Atualiza sempre a vinculação
  chatData.instanceId = inst.id || chatData.instanceId || 'inst_1';
  chatData.assignedFlowId = activeFlow.id;
  chatData.flowLanguage = flowLanguage;

  if (!chatData.variables) chatData.variables = {};
  if (!chatData.upsellStage) chatData.upsellStage = 'stage_49';

  chatData.variables.phone = cleanPhone;
  chatData.variables.firstName = (chatData.leadName || '').split(' ')[0] || 'Amigo(a)';
  chatData.variables.checkoutUrl100 = funnel.upsellStages?.stage_100?.checkoutUrl || 'https://pay.kirvano.com/checkout-100';
  chatData.variables.checkoutUrl200 = funnel.upsellStages?.stage_200?.checkoutUrl || 'https://pay.kirvano.com/checkout-200';
  chatData.variables.checkoutUrl400 = funnel.upsellStages?.stage_400?.checkoutUrl || 'https://pay.kirvano.com/checkout-400';

  const storedAttr = db.getTrafficAttributionByPhone(cleanPhone);
  if (!chatData.codigo && storedAttr?.codigo) {
    chatData.codigo = storedAttr.codigo;
    chatData.attribution = storedAttr;
  }
  const stageInfo = getCurrentStageInfo(chatData.upsellStage, funnel, flowLanguage, chatData.codigo || 'lead');
  
  chatData.variables.checkoutUrl = stageInfo.checkoutUrl || funnel.checkoutUrl || 'https://pay.kirvano.com/checkout-49';
  chatData.variables.valor_atual = stageInfo.value;
  chatData.variables.valor_pago = stageInfo.paidValue;
  chatData.variables.proximo_valor = stageInfo.nextValue;

  const rawMsg = (messageText || '').trim();

  // 0.2 RECONHECIMENTO DE ENTRADA DE ANÚNCIO / CAMPANHA
  const isCampaignStart = Boolean(
    (rawMsg && /(?:quiero\s*espiar|quero\s*espiar|espiar\s*un\s*n[uú]mero|iniciar\s*investigaci[oó]n|iniciar\s*rastreo|come[çc]ar\s*investiga)/i.test(rawMsg)) ||
    (rawMsg && /\([A-Za-z0-9]{4,8}\)/.test(rawMsg)) ||
    (rawMsg && /c[oó]digo\s*:?\s*[A-Za-z0-9]{4,8}/i.test(rawMsg))
  );

  if (isCampaignStart) {
    console.log(`[FlowEngine] 🚀 Lead +${cleanPhone} iniciou/reiniciou funil via anúncio/código! Resetando estado para NOVO.`);
    chatData.state = 'NOVO';
    chatData.upsellStage = 'stage_49';
    chatData.currentNodeId = null;
    chatData.orderStatus = null;
    chatData.variables = { phone: cleanPhone, checkoutUrl: chatData.variables.checkoutUrl, valor_atual: '19' };
    lastBotReplyTimestamps.delete(cleanPhone);
    lastPhysicalSendTimes.delete(cleanPhone);

    // Emite evento de novo lead para notificação sonora e push no celular
    eventBus.emit('new_lead', {
      phone: cleanPhone,
      codigo: chatData.codigo || storedAttr?.codigo || '',
      campaign: storedAttr?.campanha_nome || storedAttr?.utm_campaign || 'TikTok Ads',
      text: rawMsg || 'Hola, quiero espiar un número',
      timestamp: new Date().toISOString()
    });
  }

  // Helper para obter o texto configurado no nó visual do fluxo ativo
  const getNodeText = (nodeId, fallback) => {
    const node = activeFlow?.nodes?.find(n => n.id === nodeId);
    return node?.data?.text || node?.data?.content || fallback;
  };

  // =========================================================================
  // 1. RECONHECIMENTO DE COMPROVANTE OU AVISO DE PAGAMENTO ("ya pagué", etc.)
  // =========================================================================
  const isPaymentClaim = Boolean(
    (rawMsg && /(?:ya\s*pag[uú][eé]|listo\s*pag|pago\s*realizado|ya\s*compr[eé]|acabo\s*de\s*pagar|pagu[eé]\s*con\s*tarjeta|pago\s*hecho|j[aá]\s*paguei|paguei)/i.test(rawMsg)) ||
    mediaAttachment ||
    (rawMsg && rawMsg.toLowerCase().includes('[comprovante_valido]'))
  );

  if (isPaymentClaim && (chatData.state === 'OFERTA_ENVIADA' || chatData.state === 'NEGOCIACAO' || chatData.state === 'FINALIZADO')) {
    console.log(`[FlowEngine] 💰 Aviso/Comprovante de pagamento identificado para +${cleanPhone}`);
    const accessCode = chatData.codigo || storedAttr?.codigo || 'vip';
    const accessUrl = `https://spysfunills.vercel.app/upsell1/?code=${accessCode}`;
    const autoDeliverMsg = `¡Pago recibido y validado con éxito! 🎉\n\nTu acceso completo e ilimitado al panel ha sido desbloqueado.\n\nAccede ahora mismo a través de este enlace seguro:\n👉 ${accessUrl}\n\n¡Ingresa y aprovecha todas las herramientas!`;

    db.addChatMessage(cleanPhone, { from: 'bot', text: autoDeliverMsg, instanceId: inst.id }, 'FINALIZADO');
    await sendOutgoingTextMessage(inst, cleanPhone, autoDeliverMsg, 1000);
    chatData.state = 'FINALIZADO';
    chatData.upsellStage = 'stage_finalizado';
    chatData.orderStatus = 'PAGO';
    db.saveChat(cleanPhone, { state: 'FINALIZADO', orderStatus: 'PAGO', upsellStage: 'stage_finalizado' });
    db.confirmAttributionSale(cleanPhone, 19);
    eventBus.emit('new_sale', {
      amount: 19,
      currency: 'USD',
      phone: cleanPhone,
      code: accessCode,
      timestamp: new Date().toISOString()
    });
    eventBus.emit('chat_updated', { phone: cleanPhone });
    return;
  }

  // =========================================================================
  // 2. DETECÇÃO INCONDICIONAL DE NÚMERO ALVO PARA INVESTIGAÇÃO (PRIORIDADE ALTA)
  // Se a mensagem contiver um número de telefone com 8 a 15 dígitos,
  // executa IMEDIATAMENTE o fluxo visual completo:
  // node-analyzing-msg -> Delay 3s -> Consulta Foto (Uazapi) -> Envia Prova -> Oferta $19 -> Instrução
  // =========================================================================
  const detectedTargetDigits = extractNewTargetPhone(rawMsg);

  if (detectedTargetDigits && !isCampaignStart) {
    let normalizedTarget = detectedTargetDigits;
    // Se for número brasileiro com 10 ou 11 dígitos sem DDI, adiciona 55
    if (normalizedTarget.length === 10 || normalizedTarget.length === 11) {
      normalizedTarget = '55' + normalizedTarget;
    }

    console.log(`[FlowEngine] 🎯 Número alvo detectado: ${normalizedTarget} para Lead: +${cleanPhone} (Estado anterior: ${chatData.state})`);

    chatData.variables = chatData.variables || {};
    chatData.variables.alvo = normalizedTarget;
    chatData.state = 'ANALISANDO';
    db.saveChat(cleanPhone, {
      state: 'ANALISANDO',
      variables: { ...chatData.variables, alvo: normalizedTarget },
      assignedFlowId: activeFlow.id,
      flowLanguage: 'es'
    });
    eventBus.emit('chat_updated', { phone: cleanPhone });

    // PASSO A: Mensagem de Análise do Sistema (node-analyzing-msg)
    // "Espera un momento mientras verificamos en el sistema..."
    const fallbackAnalyzing = "Espera un momento mientras verificamos en el sistema...";
    const analyzingMsg = getNodeText('node-analyzing-msg', fallbackAnalyzing);
    
    console.log(`[FlowEngine] 📤 Enviando mensagem de análise imediata: "${analyzingMsg}"`);
    db.addChatMessage(cleanPhone, { from: 'bot', text: analyzingMsg, instanceId: inst.id }, 'ANALISANDO');
    await sendOutgoingTextMessage(inst, cleanPhone, analyzingMsg, 1000);
    eventBus.emit('chat_updated', { phone: cleanPhone });

    // PASSO B: Intervalo Inteligente de 3 segundos com digitação
    const delayNode = activeFlow?.nodes?.find(n => n.id === 'node-delay');
    const delaySeconds = delayNode?.data?.seconds || 3;
    console.log(`[FlowEngine] ⏱️ Aguardando delay de ${delaySeconds}s (digitando)...`);
    await simulateTyping(inst, cleanPhone, delaySeconds * 1000, 'composing');

    // PASSO C: Consulta Foto do Alvo via WhatsApp Oficial (Uazapi /chat/details)
    console.log(`[FlowEngine] 🔍 Consultando foto do alvo: ${normalizedTarget}`);
    const photoUrl = await lookupProfilePicture(normalizedTarget, inst);
    chatData.variables.photoUrl = photoUrl;
    chatData.targetPhotoUrl = photoUrl;

    // PASSO D: Monta e Envia Imagem de Prova
    // Template 1 com foto estampada no reprodutor de áudio OU Template 2 Cadeado
    console.log(`[FlowEngine] 🖼️ Gerando imagem de prova (Foto: ${photoUrl ? 'SIM' : 'NÃO'})...`);
    const imgBuffer = await composeProofImage(photoUrl, funnel.avatarCoordinates, 'es');
    const proofsDir = path.join(__dirname, '../../public/generated');
    fs.mkdirSync(proofsDir, { recursive: true });
    const filename = `proof_${cleanPhone}_${Date.now()}.png`;
    fs.writeFileSync(path.join(proofsDir, filename), imgBuffer);
    const webProofUrl = `/generated/${filename}`;

    const proofCaption = photoUrl
      ? '✓ Prueba con foto en el audio'
      : '🔒 Prueba con audio protegido por encriptación';

    db.addChatMessage(cleanPhone, {
      from: 'bot',
      mediaType: 'image',
      mediaUrl: webProofUrl,
      text: proofCaption,
      instanceId: inst.id
    }, 'PROVA_ENVIADA');

    console.log(`[FlowEngine] 📤 Enviando imagem de prova no WhatsApp...`);
    await sendOutgoingImageMessage(inst, cleanPhone, imgBuffer, filename, 'image/png', proofCaption, 2000);
    eventBus.emit('chat_updated', { phone: cleanPhone });

    // PASSO E: Envia Oferta Inicial de $39 (node-offer-pix-49)
    const fallbackOffer = "Enlace para el pago de $19 👇\n{checkoutUrl}\n\nDatos del pago: 🔒 Pago 100% seguro y encriptado.";
    const offerText = getNodeText('node-offer-pix-49', fallbackOffer);
    const finalOffer = interpolateVariables(offerText, chatData.variables);

    console.log(`[FlowEngine] 📤 Enviando link de oferta $19...`);
    db.addChatMessage(cleanPhone, { from: 'bot', text: finalOffer, instanceId: inst.id });
    await sendOutgoingTextMessage(inst, cleanPhone, finalOffer, 1500);
    eventBus.emit('chat_updated', { phone: cleanPhone });

    // PASSO F: Envia Instrução de Envio do Comprovante (node-msg-comprovante)
    const fallbackProofInstruction = "¡En cuanto pagues, envíame el comprobante por aquí para desbloquear tu acceso de inmediato!";
    const proofInstruction = getNodeText('node-msg-comprovante', fallbackProofInstruction);

    console.log(`[FlowEngine] 📤 Enviando instrução de comprovante...`);
    db.addChatMessage(cleanPhone, { from: 'bot', text: proofInstruction, instanceId: inst.id }, 'OFERTA_ENVIADA');
    await sendOutgoingTextMessage(inst, cleanPhone, proofInstruction, 1500);

    chatData.state = 'OFERTA_ENVIADA';
    db.saveChat(cleanPhone, {
      state: 'OFERTA_ENVIADA',
      variables: chatData.variables,
      assignedFlowId: activeFlow.id,
      flowLanguage: 'es'
    });
    eventBus.emit('chat_updated', { phone: cleanPhone });
    return;
  }

  // =========================================================================
  // 3. TRATAMENTO CONFORME ESTADO DO CHAT QUANDO NÃO É NÚMERO
  // =========================================================================

  // CASO A: LEAD JÁ FINALIZADO / PÓS-VENDA
  if (chatData.state === 'FINALIZADO' || chatData.state === 'PAGO' || chatData.state === 'APROVADO') {
    console.log(`[FlowEngine] Lead finalizado enviou mensagem (${cleanPhone}). Respondendo com IA (Lang: ${flowLanguage})...`);
    const aiReply = await aiService.classifyAndReply(rawMsg, chatData.messages, stageInfo, flowLanguage);
    db.addChatMessage(cleanPhone, { from: 'bot', text: aiReply, instanceId: inst.id }, 'FINALIZADO');
    await sendOutgoingTextMessage(inst, cleanPhone, aiReply, 1500);
    eventBus.emit('chat_updated', { phone: cleanPhone });
    return;
  }

  // CASO B: LEAD JÁ RECEBEU A OFERTA (OFERTA_ENVIADA / DUVIDAS / NEGOCIACAO)
  // O lead tem dúvidas sobre pagamento, segurança, preço, reembolso, denúncia, consultar outro número, etc.
  if (chatData.state === 'OFERTA_ENVIADA' || chatData.state === 'NEGOCIACAO' || chatData.state === 'DUVIDAS') {
    console.log(`[FlowEngine] 🤖 Quebra de objeção com GPT (Lang: ${flowLanguage}, Lead: +${cleanPhone}): "${rawMsg}"`);
    recordBotReply(cleanPhone);
    const aiReply = await aiService.classifyAndReply(rawMsg, chatData.messages, stageInfo, flowLanguage, 'OFERTA_ENVIADA', chatData.variables?.alvo);

    db.addChatMessage(cleanPhone, { from: 'bot', text: aiReply, instanceId: inst.id });
    await sendOutgoingTextMessage(inst, cleanPhone, aiReply, 1500);
    eventBus.emit('chat_updated', { phone: cleanPhone });
    return;
  }

  // CASO C: LEAD ESTÁ EM AGUARDANDO_NUMERO (Enviou dúvida, pergunta ou objeção antes de enviar o número)
  if (chatData.state === 'AGUARDANDO_NUMERO') {
    console.log(`[FlowEngine] 🤖 Lead em AGUARDANDO_NUMERO enviou pergunta/dúvida (Lead: +${cleanPhone}): "${rawMsg}". Consultando GPT em espanhol...`);
    recordBotReply(cleanPhone);
    const aiReply = await aiService.classifyAndReply(rawMsg, chatData.messages, stageInfo, flowLanguage, 'AGUARDANDO_NUMERO');

    db.addChatMessage(cleanPhone, { from: 'bot', text: aiReply, instanceId: inst.id }, 'AGUARDANDO_NUMERO');
    await sendOutgoingTextMessage(inst, cleanPhone, aiReply, 1500);
    eventBus.emit('chat_updated', { phone: cleanPhone });
    return;
  }

  // CASO D: NOVO LEAD OU INÍCIO DE CAMPANHA (BOAS-VINDAS)
  const fallbackWelcome = "Hola, Guarda mi contacto y envíame el número de la persona que ya te mando la prueba.";
  const welcomeText = getNodeText('node-welcome', fallbackWelcome);
  
  chatData.state = 'AGUARDANDO_NUMERO';
  db.saveChat(cleanPhone, {
    state: 'AGUARDANDO_NUMERO',
    assignedFlowId: activeFlow.id,
    flowLanguage: 'es'
  });

  // Notifica o celular do usuário sobre a chegada de novo lead
  eventBus.emit('new_lead', {
    phone: cleanPhone,
    codigo: chatData.codigo || storedAttr?.codigo || '',
    campaign: storedAttr?.campanha_nome || storedAttr?.utm_campaign || 'WhatsApp Funnel',
    text: rawMsg || 'Hola, quiero espiar un número',
    timestamp: new Date().toISOString()
  });

  db.addChatMessage(cleanPhone, { from: 'bot', text: welcomeText, instanceId: inst.id }, 'AGUARDANDO_NUMERO');
  await sendOutgoingTextMessage(inst, cleanPhone, welcomeText, 1000);
  eventBus.emit('chat_updated', { phone: cleanPhone });
}

async function processIncomingMessage(instanceId, leadPhone, messageText, mediaAttachment = null, messageId = null, messageTimestamp = null, senderName = null, senderPhoto = null) {
  const cleanPhone = (leadPhone || '').replace(/\D/g, '');
  if (!cleanPhone || cleanPhone.length < 8) return;

  const msgId = messageId || `msg_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
  const msgTs = messageTimestamp ? new Date(messageTimestamp).getTime() : Date.now();

  // 1. DEDUPLICAÇÃO ABSOLUTA
  if (isMessageAlreadyHandled(msgId, cleanPhone, messageText, msgTs)) {
    console.log(`[FlowEngine] 🛡️ Mensagem duplicada/já tratada ignorada para +${cleanPhone} (ID: ${msgId})`);
    return;
  }
  markMessageHandled(msgId);

  // 2. TRAVA DE CONCORRÊNCIA / MUTEX POR LEAD
  if (!acquireLeadLock(cleanPhone)) {
    console.log(`[FlowEngine] ⚠️ Já existe fluxo em processamento ativo para +${cleanPhone}. Ignorando chamada concorrente duplicada.`);
    return;
  }

  try {
    const instances = db.getInstances();
    const instance = instances.find(i => i.id === instanceId || i.instance_id === instanceId || i.name === instanceId) || instances[0] || { id: instanceId || 'inst_1' };

  // 0. Atualiza dados de contato do lead (Nome e Foto de Perfil)
  let existingChat = db.getChat(cleanPhone);
  if (!existingChat) {
    existingChat = {
      leadPhone: cleanPhone,
      leadName: (senderName && senderName.trim()) || `Lead ${cleanPhone}`,
      instanceId: instance?.id || 'inst_1',
      state: 'NOVO',
      messages: []
    };
  }
  if (!Array.isArray(existingChat.messages)) existingChat.messages = [];
  let chatNeedsSave = false;

  if (senderName && typeof senderName === 'string' && senderName.trim()) {
    const cleanSenderName = senderName.trim();
    if (!existingChat.leadName || existingChat.leadName.startsWith('Lead ') || existingChat.leadName === ('+' + cleanPhone)) {
      existingChat.leadName = cleanSenderName;
      chatNeedsSave = true;
    }
  }

  if (senderPhoto && !existingChat.leadPhotoUrl) {
    existingChat.leadPhotoUrl = senderPhoto;
    chatNeedsSave = true;
  } else if (!existingChat.leadPhotoUrl) {
    // Busca foto pública do perfil do próprio lead de forma assíncrona
    lookupProfilePicture(cleanPhone).then(photo => {
      if (photo) {
        const c = db.getChat(cleanPhone);
        if (c && !c.leadPhotoUrl) {
          c.leadPhotoUrl = photo;
          db.saveChat(cleanPhone, c);
          eventBus.emit('chat_updated', { phone: cleanPhone });
        }
      }
    }).catch(() => {});
  }

  if (chatNeedsSave) {
    db.saveChat(cleanPhone, existingChat);
  }

  // 0.1 Atribuição de Tráfego Pago (TikTok Ads):
  // Verifica se a mensagem contém o código gerado no link de campanha
  // Padrão: (CÓDIGO) ex: (AB79KP) ou código AB79KP
  if (messageText && typeof messageText === 'string') {
    const codeMatch = messageText.match(/\(([A-Z0-9]{6})\)/i) || messageText.match(/(?:c[oó]digo\s*:?\s*)([A-Z0-9]{6})/i);
    if (codeMatch && codeMatch[1]) {
      const code = codeMatch[1].toUpperCase();
      const linkedAttr = db.linkPhoneToAttribution(code, cleanPhone);
      if (linkedAttr) {
        console.log(`[FlowEngine] 🎯 TikTok Attribution vinculada com sucesso! Código: ${code} → Lead: ${cleanPhone} (Campanha: ${linkedAttr.campanha_nome || linkedAttr.utm_campaign || 'N/A'})`);
        existingChat.codigo = code;
        existingChat.attribution = linkedAttr;
        chatNeedsSave = true;
      } else {
        console.log(`[FlowEngine] ℹ️ Código de campanha ${code} recebido de ${cleanPhone}, mas não encontrado ou já expirado.`);
      }
    }
  }

  // 1. Registra mensagem de entrada do lead no banco com a instância correta
  const msgId = messageId || `msg_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
  const { newMessage } = db.addChatMessage(cleanPhone, {
    id: msgId,
    timestamp: messageTimestamp || new Date().toISOString(),
    from: 'lead',
    text: messageText,
    mediaUrl: mediaAttachment?.url || null,
    mediaType: mediaAttachment?.type || null,
    instanceId: instance.id || 'inst_1'
  });
  eventBus.emit('new_message', { phone: cleanPhone, message: newMessage });

  // 2. Executa o fluxo visual oficial configurado especificamente para este chip
    try {
      await executeFlowGraph(instance, cleanPhone, messageText, mediaAttachment);
    } catch (err) {
      console.error('[FlowEngine] Erro ao processar mensagem no fluxo:', err);
    }
  } finally {
    releaseLeadLock(cleanPhone);
  }
}

/**
 * Dispara manualmente um fluxo ou etapa de automação para um contato pelo Chat ao Vivo
 */
async function triggerManualFlow(cleanPhone, options = {}) {
  const phone = String(cleanPhone).replace(/\D/g, '');
  if (!phone || phone.length < 8) {
    throw new Error('Número de telefone inválido.');
  }

  const instances = db.getInstances();
  const inst = (options.instanceId ? instances.find(i => i.id === options.instanceId) : null) ||
               instances.find(i => i.tipo === 'uazapi' && i.status === 'connected') ||
               instances.find(i => i.status === 'connected') ||
               instances[0];

  if (!inst) {
    throw new Error('Nenhuma conexão ativa do WhatsApp disponível para envio.');
  }

  const flows = db.getFlows();
  const targetFlowId = options.flowId || inst.assignedFlowId || 'fluxo-espiao-es';
  const activeFlow = flows.find(f => f.id === targetFlowId) || flows[0];
  const flowLanguage = activeFlow?.language || (activeFlow?.id?.includes('-es') ? 'es' : (activeFlow?.id?.includes('-en') ? 'en' : 'pt'));
  const funnel = db.getFunnel();
  const chats = db.getChats();

  let chatData = chats[phone];
  if (!chatData) {
    chatData = {
      leadPhone: phone,
      leadName: `Lead +${phone}`,
      instanceId: inst.id,
      assignedFlowId: activeFlow.id,
      flowLanguage: flowLanguage,
      state: 'NOVO',
      currentNodeId: null,
      upsellStage: 'stage_49',
      variables: { phone },
      lastMessageTime: new Date().toISOString(),
      messages: []
    };
  }

  chatData.instanceId = inst.id;
  chatData.assignedFlowId = activeFlow.id;
  chatData.flowLanguage = flowLanguage;
  if (!chatData.variables) chatData.variables = {};
  chatData.variables.phone = phone;

  const step = options.step || 'start';
  console.log(`[FlowEngine] ⚡ Disparo manual (${step}) para ${phone} via ${inst.name}...`);

  const getNodeText = (nodeId, fallback) => {
    const node = activeFlow?.nodes?.find(n => n.id === nodeId);
    return node?.data?.text || fallback;
  };

  const interpolateVars = (str) => {
    if (!str || typeof str !== 'string') return '';
    return str.replace(/\{(\w+)\}/g, (match, key) => chatData.variables[key] || match);
  };

  if (step === 'proof' || step === 'send_proof') {
    // 1. DISPARO MANUAL DE PROVA
    const targetPhone = chatData.variables.alvo || phone;
    const photoUrl = await lookupProfilePicture(targetPhone);
    chatData.variables.photoUrl = photoUrl;

    const imgBuffer = await composeProofImage(photoUrl, funnel.avatarCoordinates, flowLanguage);
    const proofsDir = path.join(__dirname, '../../public/generated');
    fs.mkdirSync(proofsDir, { recursive: true });
    const filename = `proof_${phone}_${Date.now()}.png`;
    fs.writeFileSync(path.join(proofsDir, filename), imgBuffer);
    const webProofUrl = `/generated/${filename}`;

    const proofCaption = photoUrl
      ? (flowLanguage === 'es' ? '✓ Prueba con foto en el audio' : (flowLanguage === 'en' ? '✓ Proof with profile photo on audio' : '✓ Prova com foto no áudio'))
      : (flowLanguage === 'es' ? '🔒 Prueba con audio protegido por encriptación' : (flowLanguage === 'en' ? '🔒 Proof with encrypted audio' : '🔒 Prova com áudio protegido por criptografia'));

    db.addChatMessage(phone, {
      from: 'bot',
      mediaType: 'image',
      mediaUrl: webProofUrl,
      text: proofCaption,
      instanceId: inst.id
    });
    await sendOutgoingImageMessage(inst, phone, imgBuffer, filename, 'image/png', proofCaption);

    // Envia oferta com link de checkout
    const fallbackOffer = flowLanguage === 'es'
      ? "Encontré conversaciones recientes y un audio de WhatsApp vinculado a este número.\n\nPara desbloquear el acceso completo al panel y escuchar el audio ahora, accede al enlace oficial:\n{checkoutUrl}"
      : (flowLanguage === 'en'
        ? "I found recent conversations and a WhatsApp audio linked to this number.\n\nTo unlock full access to the dashboard and listen to the audio now, access the official link:\n{checkoutUrl}"
        : "Localizei conversas recentes e um áudio do WhatsApp vinculado a este número.\n\nPara liberar o acesso completo ao painel e ouvir o áudio agora, acesse o link oficial:\n{checkoutUrl}");

    const manualStageInfo = getCurrentStageInfo(chatData.upsellStage || 'stage_49', funnel, flowLanguage, chatData.codigo || 'lead');
    chatData.variables.checkoutUrl = manualStageInfo.checkoutUrl || funnel.checkoutUrl || 'https://pay.kirvano.com/checkout-49';
    chatData.variables.valor_atual = manualStageInfo.value;
    const offerTemplate = getNodeText('node-offer-checkout', fallbackOffer);
    const offerMsg = interpolateVars(offerTemplate);

    db.addChatMessage(phone, { from: 'bot', text: offerMsg, instanceId: inst.id }, 'OFERTA_ENVIADA');
    await sendOutgoingTextMessage(inst, phone, offerMsg);

    chatData.state = 'OFERTA_ENVIADA';
    chats[phone] = chatData;
    db.saveChats(chats);
    eventBus.emit('chat_updated', { phone });
    return { success: true, step: 'proof', state: 'OFERTA_ENVIADA' };
  } else if (step === 'checkout' || step === 'send_checkout') {
    // 2. DISPARO MANUAL DE LINK DE CHECKOUT
    const stageInfo = getCurrentStageInfo(chatData.upsellStage || 'stage_49', funnel, flowLanguage);
    const checkoutUrl = stageInfo.checkoutUrl || funnel.upsellStages?.stage_49?.checkoutUrl || funnel.checkoutUrl || 'https://pay.kirvano.com/checkout-49';
    chatData.variables.checkoutUrl = checkoutUrl;

    const checkoutMsg = flowLanguage === 'es'
      ? `Enlace seguro para desbloquear el informe completo (Valor: $ ${stageInfo.value}):\n👉 ${checkoutUrl}`
      : (flowLanguage === 'en'
        ? `Secure link to unlock the full report (Amount: $ ${stageInfo.value}):\n👉 ${checkoutUrl}`
        : `Link seguro para liberação do relatório completo (Valor: R$ ${stageInfo.value}):\n👉 ${checkoutUrl}`);

    db.addChatMessage(phone, { from: 'bot', text: checkoutMsg, instanceId: inst.id }, 'OFERTA_ENVIADA');
    await sendOutgoingTextMessage(inst, phone, checkoutMsg);

    chatData.state = 'OFERTA_ENVIADA';
    chats[phone] = chatData;
    db.saveChats(chats);
    eventBus.emit('chat_updated', { phone });
    return { success: true, step: 'checkout', state: 'OFERTA_ENVIADA' };
  } else {
    // 3. DISPARO INICIAL / BOAS-VINDAS DO FLUXO
    const fallbackWelcome = flowLanguage === 'es'
      ? "¡Hola! Guarda mi contacto y envíame el número de la persona que ya te mando la prueba."
      : (flowLanguage === 'en'
        ? "Hello! Save my contact and send the person's phone number and I'll send you the proof right away."
        : "Olá, Salve o meu contato e envie o número da pessoa que já vou mandar a prova");

    const welcomeTemplate = getNodeText('node-welcome', fallbackWelcome);
    const welcomeText = interpolateVars(welcomeTemplate);

    chatData.state = 'AGUARDANDO_NUMERO';
    chatData.upsellStage = 'stage_49';
    chats[phone] = chatData;
    db.saveChats(chats);

    db.addChatMessage(phone, { from: 'bot', text: welcomeText, instanceId: inst.id }, 'AGUARDANDO_NUMERO');
    await sendOutgoingTextMessage(inst, phone, welcomeText);
    eventBus.emit('chat_updated', { phone });
    return { success: true, step: 'start', message: welcomeText, state: 'AGUARDANDO_NUMERO' };
  }
}

module.exports = {
  processIncomingMessage,
  lookupProfilePicture,
  executeFlowGraph,
  executeTikTokPixelNode,
  triggerManualFlow,
  simulateTyping,
  getStageTag,
  extractNewTargetPhone,
  buildSpanishCheckoutUrl,
  isLeadLocked,
  acquireLeadLock,
  releaseLeadLock,
  hasRecentBotReply,
  recordBotReply,
  isMessageAlreadyHandled,
  markMessageHandled,
  lastPhysicalSendTimes,
  seenMessageIds,
  eventBus
};
