const axios = require('axios');
const crypto = require('crypto');
const db = require('../storage/db');

const TIKTOK_TRACK_URL = 'https://business-api.tiktok.com/open_api/v1.3/event/track/';

/**
 * Normaliza o telefone para formato E.164 (somente dígitos)
 */
function cleanPhoneNumber(phone) {
  if (!phone) return '';
  const digits = String(phone).replace(/\D/g, '');
  if (digits.length >= 10 && digits.length <= 11) {
    return '55' + digits; // Prefixo Brasil
  }
  return digits;
}

/**
 * Gera hash SHA-256 de uma string
 */
function sha256(val) {
  if (!val) return '';
  return crypto.createHash('sha256').update(String(val).trim()).digest('hex');
}

/**
 * Dispara evento de conversão server-side para o TikTok Events API v1.3
 */
async function sendTikTokEvent(options = {}) {
  const {
    pixelCode,
    accessToken,
    eventName = 'CompletePayment',
    phone,
    attribution = null,
    value = 49.90,
    currency = 'BRL',
    eventId = null
  } = options;

  if (!pixelCode || !accessToken) {
    console.warn('[TikTok Events API] Pixel Code ou Access Token ausente. Modo teste/simulação.');
    const log = db.addTikTokLog({
      pixel_code: pixelCode || 'TEST_CODE',
      event: eventName,
      phone: phone || '',
      ttclid: attribution?.ttclid || null,
      ttp: attribution?.ttp || null,
      value: parseFloat(value) || 0,
      currency: currency || 'BRL',
      status: 'erro',
      error: 'Pixel Code ou Access Token ausente',
      payload: null
    });
    return { success: false, error: 'Pixel Code ou Access Token ausente', logId: log.id };
  }

  const cleanPhone = cleanPhoneNumber(phone);
  const phoneHash = cleanPhone ? sha256(cleanPhone) : '';
  const finalEventId = eventId || `ev_${cleanPhone || 'lead'}_${Date.now()}`;
  const numValue = parseFloat(String(value).replace(',', '.')) || 49.90;

  // Montagem do Contexto TikTok (Advanced Matching & Ad Attribution)
  const context = {
    ad: {
      callback: attribution?.ttclid || undefined
    },
    user: {
      phone_number: phoneHash || undefined,
      external_id: phoneHash || undefined,
      ttp: attribution?.ttp || undefined
    },
    page: {
      url: attribution?.pressel_url || 'https://minhapressel.com'
    }
  };

  const properties = {
    value: numValue,
    currency: currency || 'BRL',
    content_type: 'product'
  };

  const payload = {
    pixel_code: pixelCode,
    event: eventName,
    event_id: finalEventId,
    timestamp: new Date().toISOString(),
    context,
    properties
  };

  // Simulação positiva para tokens de teste / sandbox
  if (accessToken.startsWith('tt_act_demo_') || pixelCode.startsWith('TT_PIXEL_TEST_')) {
    if (cleanPhone) {
      db.confirmAttributionSale(cleanPhone, numValue);
    }
    const log = db.addTikTokLog({
      pixel_code: pixelCode,
      event: eventName,
      phone: cleanPhone,
      phone_hash: phoneHash,
      ttclid: attribution?.ttclid || null,
      ttp: attribution?.ttp || null,
      value: numValue,
      currency,
      status: 'sucesso',
      payload,
      response: { code: 0, message: 'Evento aceito com sucesso (Modo Teste)' }
    });
    return { success: true, isDemo: true, logId: log.id, eventId: finalEventId };
  }

  console.log(`[TikTok Events API] 🎯 Disparando "${eventName}" para pixel ${pixelCode} | Valor: ${numValue} ${currency} | ttclid: ${attribution?.ttclid || 'nenhum'}`);

  try {
    const res = await axios.post(TIKTOK_TRACK_URL, payload, {
      headers: {
        'Access-Token': accessToken,
        'Content-Type': 'application/json'
      },
      timeout: 10000
    });

    const isSuccess = res.data && (res.data.code === 0 || res.status === 200);

    if (isSuccess && res.data.code === 0) {
      console.log(`[TikTok Events API] ✓ Evento "${eventName}" aceito pela TikTok! Mensagem: ${res.data.message || 'OK'}`);

      // Se houver lead/atribuição vinculada, confirma a venda
      if (cleanPhone) {
        db.confirmAttributionSale(cleanPhone, numValue);
      }

      const log = db.addTikTokLog({
        pixel_code: pixelCode,
        event: eventName,
        phone: cleanPhone,
        phone_hash: phoneHash,
        ttclid: attribution?.ttclid || null,
        ttp: attribution?.ttp || null,
        value: numValue,
        currency,
        status: 'sucesso',
        payload,
        response: res.data
      });

      return { success: true, data: res.data, logId: log.id };
    } else {
      const errMsg = res.data?.message || `Código TikTok: ${res.data?.code}`;
      console.warn(`[TikTok Events API] Resposta com aviso/erro da TikTok:`, errMsg);

      const log = db.addTikTokLog({
        pixel_code: pixelCode,
        event: eventName,
        phone: cleanPhone,
        phone_hash: phoneHash,
        ttclid: attribution?.ttclid || null,
        ttp: attribution?.ttp || null,
        value: numValue,
        currency,
        status: 'erro',
        error: errMsg,
        payload,
        response: res.data
      });

      return { success: false, error: errMsg, data: res.data, logId: log.id };
    }
  } catch (err) {
    const errorDetail = err.response?.data?.message || err.response?.data?.error || err.message;
    console.error(`[TikTok Events API Error] Falha ao disparar evento "${eventName}":`, errorDetail);

    const log = db.addTikTokLog({
      pixel_code: pixelCode,
      event: eventName,
      phone: cleanPhone,
      phone_hash: phoneHash,
      ttclid: attribution?.ttclid || null,
      ttp: attribution?.ttp || null,
      value: numValue,
      currency,
      status: 'erro',
      error: errorDetail,
      payload,
      response: err.response?.data || null
    });

    return {
      success: false,
      error: errorDetail,
      status: err.response?.status || 500,
      logId: log.id
    };
  }
}

module.exports = {
  sendTikTokEvent,
  cleanPhoneNumber,
  sha256
};
