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
 * Dispara evento oficial para a API de Conversões do Facebook (CAPI / Pixel)
 */
async function sendPixelConversion(pixelId, accessToken, eventName, leadPhone, customData = {}) {
  if (!pixelId || !accessToken) {
    console.warn('[Meta CAPI] Pixel ID ou Access Token ausentes. Evento simulado:', eventName);
    return { simulated: true, eventName, leadPhone };
  }

  const cleanPhone = (leadPhone || '').replace(/\D/g, '');
  const hashedPhone = cleanPhone ? hashSha256(cleanPhone) : undefined;

  const payload = {
    data: [
      {
        event_name: eventName,
        event_time: Math.floor(Date.now() / 1000),
        action_source: 'chat',
        user_data: {
          ph: hashedPhone ? [hashedPhone] : undefined
        },
        custom_data: {
          currency: customData.currency || 'BRL',
          value: customData.value || 0,
          content_name: customData.content_name || 'Mavrol WhatsApp Flow',
          ...customData
        }
      }
    ]
  };

  const url = `${GRAPH_API_BASE}/${pixelId}/events`;
  const res = await axios.post(url, payload, {
    params: { access_token: accessToken }
  });

  return res.data;
}

module.exports = {
  sendTextMessage,
  uploadMedia,
  sendImageMessage,
  sendAudioMessage,
  validateAndFetchMetaDetails,
  sendPixelConversion
};
