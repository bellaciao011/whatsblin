const axios = require('axios');
const FormData = require('form-data');

const GRAPH_API_BASE = 'https://graph.facebook.com/v20.0';

/**
 * Envia mensagem de texto simples
 */
async function sendTextMessage(phoneNumberId, accessToken, to, text) {
  if (!accessToken || !phoneNumberId) {
    console.warn('[Meta API] Token ou Phone Number ID ausentes. Modo simulação.');
    return { simulated: true, to, text };
  }

  const url = `${GRAPH_API_BASE}/${phoneNumberId}/messages`;
  const res = await axios.post(
    url,
    {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: to.replace(/\D/g, ''),
      type: 'text',
      text: { body: text }
    },
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      }
    }
  );
  return res.data;
}

/**
 * Faz upload de imagem gerada para a CDN da Meta e retorna o media_id
 */
async function uploadMedia(phoneNumberId, accessToken, buffer, filename = 'prova.png', mimeType = 'image/png') {
  if (!accessToken || !phoneNumberId) {
    console.warn('[Meta API] Upload simulado.');
    return 'simulated_media_id_' + Date.now();
  }

  const url = `${GRAPH_API_BASE}/${phoneNumberId}/media`;
  const form = new FormData();
  form.append('file', buffer, { filename, contentType: mimeType });
  form.append('type', mimeType);
  form.append('messaging_product', 'whatsapp');

  const res = await axios.post(url, form, {
    headers: {
      ...form.getHeaders(),
      Authorization: `Bearer ${accessToken}`
    }
  });

  return res.data.id;
}

/**
 * Envia imagem usando media_id ou link direto
 */
async function sendImageMessage(phoneNumberId, accessToken, to, mediaIdOrUrl, caption = '') {
  if (!accessToken || !phoneNumberId) {
    console.warn('[Meta API] Envio de imagem simulado.');
    return { simulated: true, to, media: mediaIdOrUrl };
  }

  const isUrl = String(mediaIdOrUrl).startsWith('http');
  const imagePayload = isUrl ? { link: mediaIdOrUrl } : { id: mediaIdOrUrl };
  if (caption) imagePayload.caption = caption;

  const url = `${GRAPH_API_BASE}/${phoneNumberId}/messages`;
  const res = await axios.post(
    url,
    {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: to.replace(/\D/g, ''),
      type: 'image',
      image: imagePayload
    },
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      }
    }
  );
  return res.data;
}

/**
 * Envia áudio de voz simulado
 */
async function sendAudioMessage(phoneNumberId, accessToken, to, audioMediaIdOrUrl) {
  if (!accessToken || !phoneNumberId || !audioMediaIdOrUrl) {
    console.warn('[Meta API] Envio de áudio ignorado ou simulado.');
    return { simulated: true, to };
  }

  const isUrl = String(audioMediaIdOrUrl).startsWith('http');
  const audioPayload = isUrl ? { link: audioMediaIdOrUrl } : { id: audioMediaIdOrUrl };

  const url = `${GRAPH_API_BASE}/${phoneNumberId}/messages`;
  const res = await axios.post(
    url,
    {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: to.replace(/\D/g, ''),
      type: 'audio',
      audio: audioPayload
    },
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      }
    }
  );
  return res.data;
}

const crypto = require('crypto');

function hashSha256(val) {
  if (!val) return '';
  return crypto.createHash('sha256').update(String(val).trim().toLowerCase()).digest('hex');
}

/**
 * Valida o token e busca perfil, contas de anúncio do Facebook Ads, Pixels e WABAs
 */
async function validateAndFetchMetaDetails(accessToken) {
  if (!accessToken) throw new Error('Token de acesso da Meta obrigatório');

  // 1. Busca perfil do usuário
  const userRes = await axios.get(`${GRAPH_API_BASE}/me`, {
    params: { fields: 'id,name,email', access_token: accessToken }
  });

  const userData = userRes.data;

  // 2. Busca Contas de Anúncios (Facebook Ads) e seus Pixels
  let adAccounts = [];
  let pixels = [];
  try {
    const adRes = await axios.get(`${GRAPH_API_BASE}/me/adaccounts`, {
      params: {
        fields: 'id,name,account_id,currency,pixels{id,name}',
        access_token: accessToken
      }
    });

    if (adRes.data && adRes.data.data) {
      adAccounts = adRes.data.data.map(acc => ({
        id: acc.id,
        name: acc.name,
        accountId: acc.account_id,
        currency: acc.currency
      }));

      adRes.data.data.forEach(acc => {
        if (acc.pixels && acc.pixels.data) {
          acc.pixels.data.forEach(pix => {
            if (!pixels.find(p => p.id === pix.id)) {
              pixels.push({ id: pix.id, name: pix.name, adAccountId: acc.id });
            }
          });
        }
      });
    }
  } catch (err) {
    console.warn('[Meta API] Aviso buscando contas de anúncio:', err.message);
  }

  // 3. Busca Gerenciadores de Negócios e Contas de WhatsApp
  let whatsappNumbers = [];
  try {
    const bizRes = await axios.get(`${GRAPH_API_BASE}/me/businesses`, {
      params: { fields: 'id,name', access_token: accessToken }
    });

    if (bizRes.data && bizRes.data.data) {
      for (const biz of bizRes.data.data) {
        try {
          const wabaRes = await axios.get(`${GRAPH_API_BASE}/${biz.id}/owned_whatsapp_business_accounts`, {
            params: {
              fields: 'id,name,phone_numbers{id,display_phone_number,verified_name}',
              access_token: accessToken
            }
          });

          if (wabaRes.data && wabaRes.data.data) {
            for (const waba of wabaRes.data.data) {
              if (waba.phone_numbers && waba.phone_numbers.data) {
                for (const phone of waba.phone_numbers.data) {
                  whatsappNumbers.push({
                    wabaId: waba.id,
                    wabaName: waba.name,
                    phoneNumberId: phone.id,
                    displayPhoneNumber: phone.display_phone_number,
                    verifiedName: phone.verified_name
                  });
                }
              }
            }
          }
        } catch (e) {}
      }
    }
  } catch (err) {
    console.warn('[Meta API] Aviso buscando contas WhatsApp do Business:', err.message);
  }

  return {
    user: userData,
    adAccounts,
    pixels,
    whatsappNumbers
  };
}

/**
 * Normaliza telefone para formato internacional E.164 (somente dígitos, sem +)
 */
function normalizePhoneE164(phone) {
  if (!phone) return '';
  let digits = String(phone).replace(/\D/g, '');
  if (digits.length === 10 || digits.length === 11) {
    digits = '55' + digits;
  }
  return digits;
}

/**
 * Dispara evento oficial para a API de Conversões do Facebook (CAPI / Pixel) via WhatsApp Business Messaging
 */
async function sendPixelConversion(pixelId, accessToken, eventName, leadPhone, options = {}) {
  const db = require('../storage/db');
  
  if (!pixelId || !accessToken) {
    const simMsg = '[Meta CAPI] Pixel ID ou Access Token ausentes. Evento registrado em modo simulação.';
    console.warn(simMsg, eventName);
    const simLog = db.addPixelLog({
      pixelId: pixelId || 'simulado',
      eventName,
      phone: leadPhone,
      status: 'simulado',
      message: 'Token ou Pixel ID não configurados',
      value: options.value || 0
    });
    return { success: true, simulated: true, eventName, leadPhone, logId: simLog.id };
  }

  const cleanPhone = normalizePhoneE164(leadPhone);
  const hashedPhone = cleanPhone ? hashSha256(cleanPhone) : undefined;
  const eventId = options.eventId || `evt_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

  const userData = {
    ph: hashedPhone ? [hashedPhone] : []
  };

  if (options.email) {
    const cleanEmail = String(options.email).trim().toLowerCase();
    if (cleanEmail) {
      userData.em = [hashSha256(cleanEmail)];
    }
  }

  // Se tiver ctwa_clid explícito (API Oficial Cloud da Meta), usa business_messaging.
  // Para conexões WhatsApp Web / UAZAPI / Checkout direto, usa 'website' com URL para garantir 100% de entrega e atribuição por Advanced Matching (Telefone + E-mail).
  const hasCtwaClid = !!(options.ctwaClid && String(options.ctwaClid).trim());
  const actionSource = options.actionSource || (hasCtwaClid ? 'business_messaging' : 'website');

  if (actionSource === 'business_messaging') {
    if (options.pageId) {
      userData.page_id = String(options.pageId).trim();
    }
    if (hasCtwaClid) {
      userData.ctwa_clid = String(options.ctwaClid).trim();
    }
  }

  const customData = {
    currency: options.currency || 'BRL',
    value: Number(options.value) || 0,
    content_name: options.contentName || 'Funil WhatsApp Oficial'
  };

  const eventPayload = {
    event_name: eventName || 'Purchase',
    event_time: Math.floor(Date.now() / 1000),
    action_source: actionSource,
    user_data: userData,
    custom_data: customData,
    event_id: eventId
  };

  if (actionSource === 'business_messaging') {
    eventPayload.messaging_channel = 'whatsapp';
  } else if (actionSource === 'website') {
    eventPayload.event_source_url = options.eventSourceUrl || 'https://whatsblin-production.up.railway.app/';
  }

  const requestBody = {
    data: [eventPayload]
  };

  if (options.testEventCode) {
    requestBody.test_event_code = String(options.testEventCode).trim();
  }

  const url = `https://graph.facebook.com/v21.0/${pixelId}/events`;

  try {
    const res = await axios.post(url, requestBody, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      timeout: 10000
    });

    console.log(`[Meta CAPI] ✓ Evento "${eventName}" enviado para o Pixel ${pixelId}. Eventos recebidos: ${res.data.events_received}`);

    const log = db.addPixelLog({
      pixelId,
      pixelName: options.pixelName || 'Pixel',
      eventName,
      phone: cleanPhone,
      pageId: options.pageId || null,
      value: customData.value,
      currency: customData.currency,
      status: 'sucesso',
      eventsReceived: res.data.events_received,
      fbTraceId: res.data.fbtrace_id,
      testEventCode: options.testEventCode || null
    });

    return {
      success: true,
      eventsReceived: res.data.events_received,
      fbTraceId: res.data.fbtrace_id,
      logId: log.id,
      data: res.data
    };
  } catch (err) {
    const errorDetail = err.response?.data?.error?.message || err.message;
    console.error(`[Meta CAPI Error] Falha ao disparar evento "${eventName}":`, errorDetail);

    const log = db.addPixelLog({
      pixelId,
      pixelName: options.pixelName || 'Pixel',
      eventName,
      phone: cleanPhone,
      pageId: options.pageId || null,
      value: customData.value,
      currency: customData.currency,
      status: 'erro',
      error: errorDetail,
      responseCode: err.response?.status || 500
    });

    return {
      success: false,
      error: errorDetail,
      status: err.response?.status || 500,
      logId: log.id
    };
  }
}

/**
 * Troca o código temporário retornado pelo popup da Meta pelo token de acesso
 */
async function exchangeCodeForToken(code, redirectUri = '') {
  const db = require('../storage/db');
  const settings = db.getSettings();
  const appId = settings.facebook?.appId || '1388636936143540';
  const appSecret = settings.facebook?.appSecret || '685e2fbf3c2abc844e99ba24b039c511';

  const params = {
    client_id: appId,
    client_secret: appSecret,
    code: code
  };
  if (redirectUri) {
    params.redirect_uri = redirectUri;
  }

  const res = await axios.get(`${GRAPH_API_BASE}/oauth/access_token`, { params });
  return res.data;
}

/**
 * Busca detalhes completos de um número de telefone na Cloud API
 */
async function getPhoneNumberDetails(phoneNumberId, accessToken) {
  const res = await axios.get(`${GRAPH_API_BASE}/${phoneNumberId}`, {
    params: {
      fields: 'id,display_phone_number,verified_name,code_verification_status,quality_rating',
      access_token: accessToken
    }
  });
  return res.data;
}

/**
 * Inscreve o aplicativo no WABA (WhatsApp Business Account) para receber webhooks de mensagens
 */
async function subscribeAppToWaba(wabaId, accessToken) {
  try {
    const res = await axios.post(`${GRAPH_API_BASE}/${wabaId}/subscribed_apps`, {}, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    return res.data;
  } catch (err) {
    console.warn('[Meta API] Aviso ao inscrever app no WABA:', err.response?.data?.error?.message || err.message);
    return null;
  }
}

/**
 * Registra o número de telefone no WhatsApp Cloud API
 */
async function registerPhoneNumberOnCloudApi(phoneNumberId, accessToken, pin = '123456') {
  try {
    const res = await axios.post(`${GRAPH_API_BASE}/${phoneNumberId}/register`, {
      messaging_product: 'whatsapp',
      pin: pin
    }, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    return res.data;
  } catch (err) {
    console.warn('[Meta API] Aviso no registro Cloud API do número:', err.response?.data?.error?.message || err.message);
    return null;
  }
}

module.exports = {
  sendTextMessage,
  uploadMedia,
  sendImageMessage,
  sendAudioMessage,
  validateAndFetchMetaDetails,
  sendPixelConversion,
  normalizePhoneE164,
  hashSha256,
  exchangeCodeForToken,
  getPhoneNumberDetails,
  subscribeAppToWaba,
  registerPhoneNumberOnCloudApi
};

