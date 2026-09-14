const axios = require('axios');

/**
 * Normaliza URL do servidor uazapi removendo barras finais
 */
function normalizeServerUrl(url) {
  if (!url || typeof url !== 'string') return 'https://whatsblin.uazapi.com';
  let clean = url.trim().replace(/\/+$/, '');
  if (!clean.startsWith('http://') && !clean.startsWith('https://')) {
    clean = 'https://' + clean;
  }
  return clean;
}

/**
 * Trata erros de API da uazapi conforme especificação OpenAPI oficial
 * - 401: Token inválido/expirado
 * - 404: Instância não encontrada
 * - 429: Limite de conexões simultâneas atingido ou limite de instâncias da conta
 * - 503: Capacidade temporariamente indisponível (com leitura de Retry-After)
 */
function parseApiError(err) {
  if (!err.response) {
    return {
      status: 0,
      code: 'NETWORK_ERROR',
      message: `Falha de conexão com o servidor uazapi: ${err.message || 'Servidor inacessível ou timeout'}`
    };
  }

  const status = err.response.status;
  const data = err.response.data || {};
  const headers = err.response.headers || {};
  const rawMsg = data.error || data.message || data.msg || data.info || '';
  const fullPayloadStr = JSON.stringify(data).toLowerCase();

  if (status === 401) {
    return {
      status: 401,
      code: 'UNAUTHORIZED',
      message: 'Autenticação recusada (401): Token inválido ou expirado. Verifique as credenciais da instância ou o Token Mestre (admintoken).'
    };
  }

  if (status === 404) {
    return {
      status: 404,
      code: 'NOT_FOUND',
      message: 'Instância não encontrada (404) no servidor uazapi especificado.'
    };
  }

  if (status === 429) {
    const isMaxInstances = fullPayloadStr.includes('maximum number of instances') ||
                           fullPayloadStr.includes('cannot create more than') ||
                           fullPayloadStr.includes('limit:');
    return {
      status: 429,
      code: isMaxInstances ? 'MAX_INSTANCES_REACHED' : 'RATE_LIMIT_EXCEEDED',
      isMaxInstances,
      data,
      message: isMaxInstances
        ? 'Limite de instâncias do plano atingido no servidor uazapi (429).'
        : 'Limite de conexões simultâneas ou requisições atingido (429). Aguarde alguns instantes antes de tentar novamente.'
    };
  }

  if (status === 503) {
    const retryAfterHeader = headers['retry-after'] || headers['Retry-After'];
    const retryAfter = retryAfterHeader ? parseInt(retryAfterHeader, 10) : 5;
    return {
      status: 503,
      code: 'SERVICE_UNAVAILABLE',
      retryAfter: isNaN(retryAfter) ? 5 : retryAfter,
      message: `Capacidade de conexão temporariamente indisponível (503). O servidor solicitou aguardar ${retryAfter} segundo(s) para tentar novamente.`
    };
  }

  return {
    status,
    code: 'API_ERROR',
    message: rawMsg || `Erro ${status} retornado pela uazapi.`
  };
}

/**
 * 1. Cria uma nova instância no servidor uazapi
 * Requer admintoken no header
 * POST /instance/create
 * Body: { name: string }
 */
async function createInstance(serverUrl, adminToken, name) {
  const baseUrl = normalizeServerUrl(serverUrl);
  if (!adminToken) {
    throw new Error('O Token Mestre (admintoken) não foi configurado.');
  }

  let attempts = 0;
  while (attempts < 2) {
    attempts++;
    try {
      console.log(`[uazapiService] Criando instância "${name}" em ${baseUrl}/instance/create (tentativa ${attempts})...`);
      const res = await axios.post(
        `${baseUrl}/instance/create`,
        { name: name.trim() },
        {
          headers: {
            'Content-Type': 'application/json',
            'admintoken': adminToken.trim()
          },
          timeout: 15000
        }
      );

      return res.data;
    } catch (err) {
      const parsed = parseApiError(err);
      if (parsed.status === 429 && !parsed.isMaxInstances && attempts < 2) {
        console.warn(`[uazapiService] Rate limit temporário (429) em createInstance. Aguardando 2.5s para re-tentar...`);
        await new Promise(r => setTimeout(r, 2500));
        continue;
      }
      console.error(`[uazapiService] Erro ao criar instância:`, parsed);
      const error = new Error(parsed.message);
      error.details = parsed;
      throw error;
    }
  }
}

/**
 * Deleta uma instância na uazapi pelo token da instância
 * DELETE /instance
 */
async function deleteInstance(serverUrl, instanceToken) {
  const baseUrl = normalizeServerUrl(serverUrl);
  if (!instanceToken) return false;
  try {
    console.log(`[uazapiService] Deletando instância em ${baseUrl}/instance...`);
    const res = await axios.delete(`${baseUrl}/instance`, {
      headers: { 'token': instanceToken.trim() },
      timeout: 10000
    });
    return res.data;
  } catch (err) {
    const parsed = parseApiError(err);
    console.warn(`[uazapiService] Aviso ao deletar instância uazapi:`, parsed.message);
    return false;
  }
}

/**
 * Atualiza o nome de uma instância existente na uazapi
 * POST /instance/updateInstanceName
 */
async function updateInstanceName(serverUrl, instanceToken, newName) {
  const baseUrl = normalizeServerUrl(serverUrl);
  if (!instanceToken || !newName) return false;
  try {
    console.log(`[uazapiService] Atualizando nome da instância para "${newName}" em ${baseUrl}/instance/updateInstanceName...`);
    const res = await axios.post(
      `${baseUrl}/instance/updateInstanceName`,
      { name: newName.trim() },
      {
        headers: {
          'Content-Type': 'application/json',
          'token': instanceToken.trim()
        },
        timeout: 10000
      }
    );
    return res.data;
  } catch (err) {
    const parsed = parseApiError(err);
    console.warn(`[uazapiService] Aviso ao atualizar nome da instância:`, parsed.message);
    return false;
  }
}

/**
 * 2. Inicia o fluxo de conexão da instância
 * Requer token de instância no header
 * POST /instance/connect
 * Body: {} (gera QR code) OU { phone: "5511999999999" } (gera código de pareamento)
 */
async function connectInstance(serverUrl, instanceToken, options = {}) {
  const baseUrl = normalizeServerUrl(serverUrl);
  if (!instanceToken) {
    throw new Error('Token da instância não informado.');
  }

  const body = {};
  if (options.phone && String(options.phone).trim()) {
    body.phone = String(options.phone).replace(/\D/g, '');
  }

  let attempts = 0;
  while (attempts < 2) {
    attempts++;
    try {
      console.log(`[uazapiService] Solicitando conexão para a instância em ${baseUrl}/instance/connect (tentativa ${attempts})...`);
      const res = await axios.post(
        `${baseUrl}/instance/connect`,
        body,
        {
          headers: {
            'Content-Type': 'application/json',
            'token': instanceToken.trim()
          },
          timeout: 15000
        }
      );

      return res.data;
    } catch (err) {
      const status = err.response?.status;
      if ((status === 429 || status === 503) && attempts < 2) {
        console.warn(`[uazapiService] Resposta ${status} ao conectar. Aguardando 2.5s para re-tentar...`);
        await new Promise(r => setTimeout(r, 2500));
        continue;
      }
      const parsed = parseApiError(err);
      console.error(`[uazapiService] Erro ao conectar instância:`, parsed);
      const error = new Error(parsed.message);
      error.details = parsed;
      throw error;
    }
  }
}

/**
 * 3. Consulta status atual da instância e QR code atualizado
 * Requer token de instância no header
 * GET /instance/status
 */
async function getInstanceStatus(serverUrl, instanceToken) {
  const baseUrl = normalizeServerUrl(serverUrl);
  if (!instanceToken) {
    throw new Error('Token da instância não informado.');
  }

  let attempts = 0;
  while (attempts < 2) {
    attempts++;
    try {
      const res = await axios.get(
        `${baseUrl}/instance/status`,
        {
          headers: {
            'token': instanceToken.trim()
          },
          timeout: 10000
        }
      );

      return res.data;
    } catch (err) {
      const status = err.response?.status;
      if (status === 429 && attempts < 2) {
        await new Promise(r => setTimeout(r, 2000));
        continue;
      }
      const parsed = parseApiError(err);
      console.error(`[uazapiService] Erro ao obter status da instância:`, parsed);
      const error = new Error(parsed.message);
      error.details = parsed;
      throw error;
    }
  }
}

/**
 * 4. Configura webhook da instância em Modo Simples (sem id/action)
 * POST /webhook
 * Body: {
 *   url: "https://SEUDOMINIO/api/webhooks/uazapi",
 *   events: ["messages", "connection"],
 *   excludeMessages: ["wasSentByApi"]
 * }
 */
async function configureWebhook(serverUrl, instanceToken, webhookUrl) {
  const baseUrl = normalizeServerUrl(serverUrl);
  if (!instanceToken) {
    throw new Error('Token da instância não informado.');
  }
  if (!webhookUrl) {
    throw new Error('URL de webhook não informada.');
  }

  const payload = {
    enabled: true,
    url: webhookUrl,
    events: ['messages', 'messages_update', 'connection', 'chats'],
    excludeMessages: ['wasSentByApi']
  };

  try {
    console.log(`[uazapiService] Configurando webhook da instância em ${baseUrl}/webhook -> ${webhookUrl}...`);
    const res = await axios.post(
      `${baseUrl}/webhook`,
      payload,
      {
        headers: {
          'Content-Type': 'application/json',
          'token': instanceToken.trim()
        },
        timeout: 12000
      }
    );

    return res.data;
  } catch (err) {
    const parsed = parseApiError(err);
    console.error(`[uazapiService] Erro ao configurar webhook:`, parsed);
    const error = new Error(parsed.message);
    error.details = parsed;
    throw error;
  }
}

let lastSendTimestamp = 0;

async function throttleSend(minGapMs = 1500) {
  const now = Date.now();
  const elapsed = now - lastSendTimestamp;
  if (elapsed < minGapMs) {
    await new Promise(r => setTimeout(r, minGapMs - elapsed));
  }
  lastSendTimestamp = Date.now();
}

/**
 * 5. Envio de mensagem de texto simples
 * POST /send/text
 * Body: { number: "5511999999999", text: "..." }
 */
async function sendTextMessage(serverUrl, instanceToken, number, text) {
  const baseUrl = normalizeServerUrl(serverUrl);
  if (!instanceToken) throw new Error('Token da instância não informado.');
  if (!number) throw new Error('Número de destino não informado.');
  if (!text) throw new Error('Conteúdo da mensagem não informado.');

  const cleanNumber = String(number).replace(/\D/g, '');
  await throttleSend(1500);

  let attempts = 0;
  while (attempts < 2) {
    attempts++;
    try {
      const res = await axios.post(
        `${baseUrl}/send/text`,
        {
          number: cleanNumber,
          text: String(text)
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'token': instanceToken.trim()
          },
          timeout: 15000
        }
      );

      return res.data;
    } catch (err) {
      const status = err.response?.status;
      const errMsg = err.response?.data?.message || err.message || '';
      const isCapacityError = status === 503 || status === 429 || errMsg.includes('Capacidade') || errMsg.includes('aguarde');
      if (isCapacityError && attempts < 2) {
        console.warn(`[uazapiService] Capacidade ocupada (503/429) no envio para ${cleanNumber}. Aguardando 4s para re-tentar...`);
        await new Promise(r => setTimeout(r, 4000));
        continue;
      }
      const parsed = parseApiError(err);
      console.error(`[uazapiService] Erro ao enviar texto para ${cleanNumber}:`, parsed);
      const error = new Error(parsed.message);
      error.details = parsed;
      throw error;
    }
  }
}

/**
 * 6. Envio de mensagem com mídia (imagem, áudio, etc.)
 * POST /send/media
 * Body: { number, type: 'image', file: 'data:image/png;base64,...', caption }
 */
async function sendMediaMessage(serverUrl, instanceToken, number, mediaSource, caption = '', docName = '', mediaType = 'image') {
  const baseUrl = normalizeServerUrl(serverUrl);
  if (!instanceToken) throw new Error('Token da instância não informado.');
  if (!number) throw new Error('Número de destino não informado.');
  if (!mediaSource) throw new Error('Arquivo de mídia não informado.');

  const cleanNumber = String(number).replace(/\D/g, '');
  await throttleSend(1500);

  const payload = {
    number: cleanNumber,
    type: mediaType || 'image',
    file: mediaSource
  };

  if (caption) payload.caption = caption;
  if (docName) payload.docName = docName;

  let attempts = 0;
  while (attempts < 2) {
    attempts++;
    try {
      const res = await axios.post(
        `${baseUrl}/send/media`,
        payload,
        {
          headers: {
            'Content-Type': 'application/json',
            'token': instanceToken.trim()
          },
          timeout: 25000
        }
      );

      return res.data;
    } catch (err) {
      const status = err.response?.status;
      const errMsg = err.response?.data?.message || err.message || '';
      const isCapacityError = status === 503 || status === 429 || errMsg.includes('Capacidade') || errMsg.includes('aguarde');
      if (isCapacityError && attempts < 2) {
        console.warn(`[uazapiService] Capacidade ocupada (503/429) no envio de mídia para ${cleanNumber}. Aguardando 4s para re-tentar...`);
        await new Promise(r => setTimeout(r, 4000));
        continue;
      }
      const parsed = parseApiError(err);
      console.error(`[uazapiService] Erro ao enviar mídia para ${cleanNumber}:`, parsed);
      const error = new Error(parsed.message);
      error.details = parsed;
      throw error;
    }
  }
}

/**
 * 7. Desconectar instância
 * POST /instance/disconnect
 */
async function disconnectInstance(serverUrl, instanceToken) {
  const baseUrl = normalizeServerUrl(serverUrl);
  if (!instanceToken) return;

  try {
    const res = await axios.post(
      `${baseUrl}/instance/disconnect`,
      {},
      {
        headers: {
          'token': instanceToken.trim()
        },
        timeout: 10000
      }
    );
    return res.data;
  } catch (err) {
    const parsed = parseApiError(err);
    console.warn(`[uazapiService] Aviso ao desconectar instância:`, parsed.message);
    return null;
  }
}

const lidToPhoneCache = new Map();

/**
 * Registra o mapeamento de LID (@lid) para número de telefone real (@s.whatsapp.net)
 */
function registerLidMapping(lid, phoneOrJid) {
  if (!lid || !phoneOrJid) return;
  const cleanLid = String(lid).replace(/@.*$/, '').replace(/\D/g, '');
  const cleanPhone = String(phoneOrJid).replace(/@.*$/, '').replace(/\D/g, '');
  if (cleanLid && cleanPhone && cleanPhone.length >= 8 && cleanPhone !== cleanLid) {
    lidToPhoneCache.set(cleanLid, cleanPhone);
  }
}

/**
 * Resolve um identificador (@lid ou telefone) para o número de telefone real
 */
function resolvePhoneFromLid(target) {
  if (!target) return '';
  const str = String(target).trim();
  const digits = str.replace(/@.*$/, '').replace(/\D/g, '');
  if (str.includes('@lid') || digits.length >= 14) {
    if (lidToPhoneCache.has(digits)) {
      return lidToPhoneCache.get(digits);
    }
  }
  return digits;
}

/**
 * 8. Busca conversas recentes da instância
 * POST /chat/find
 */
async function findChats(serverUrl, instanceToken, limit = 50) {
  const baseUrl = normalizeServerUrl(serverUrl);
  if (!instanceToken) throw new Error('Token da instância não informado.');

  try {
    const res = await axios.post(
      `${baseUrl}/chat/find`,
      {
        operator: 'AND',
        sort: '-wa_lastMsgTimestamp',
        limit: Math.min(limit, 100),
        offset: 0
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'token': instanceToken.trim()
        },
        timeout: 15000
      }
    );
    const chats = res.data?.chats || [];
    for (const c of chats) {
      if (c.wa_chatlid && c.wa_chatid) {
        registerLidMapping(c.wa_chatlid, c.wa_chatid);
      }
      if (c.wa_chatlid && c.phone) {
        registerLidMapping(c.wa_chatlid, c.phone);
      }
    }
    return chats;
  } catch (err) {
    const parsed = parseApiError(err);
    console.warn(`[uazapiService] Aviso ao buscar chats:`, parsed.message);
    if (parsed.status === 401) {
      const authErr = new Error(parsed.message);
      authErr.status = 401;
      authErr.details = parsed;
      throw authErr;
    }
    return [];
  }
}

/**
 * 9. Busca mensagens de um chat
 * POST /message/find
 */
async function findMessages(serverUrl, instanceToken, chatId, limit = 20) {
  const baseUrl = normalizeServerUrl(serverUrl);
  if (!instanceToken) throw new Error('Token da instância não informado.');
  if (!chatId) return [];

  try {
    const res = await axios.post(
      `${baseUrl}/message/find`,
      {
        chatid: chatId,
        limit: Math.min(limit, 50)
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'token': instanceToken.trim()
        },
        timeout: 15000
      }
    );
    return res.data?.messages || res.data || [];
  } catch (err) {
    const parsed = parseApiError(err);
    console.warn(`[uazapiService] Aviso ao buscar mensagens para ${chatId}:`, parsed.message);
    return [];
  }
}

/**
 * 10. Consulta todas as instâncias existentes no servidor uazapi via Token Mestre (admintoken)
 * GET /instance/all
 */
async function fetchAllInstances(serverUrl, adminToken) {
  const baseUrl = normalizeServerUrl(serverUrl);
  if (!adminToken) return [];
  try {
    const res = await axios.get(`${baseUrl}/instance/all`, {
      headers: {
        'admintoken': adminToken.trim()
      },
      timeout: 12000
    });
    return Array.isArray(res.data) ? res.data : [];
  } catch (err) {
    const parsed = parseApiError(err);
    console.warn(`[uazapiService] Aviso ao consultar instâncias via admintoken:`, parsed.message);
    return [];
  }
}

/**
 * 11. Envia atualização de presença (composing = digitando, recording = gravando áudio, paused = pausado)
 * POST /message/presence
 * Body: { number: "5511999999999", presence: "composing", delay: 3000 }
 */
async function sendPresence(serverUrl, instanceToken, number, presence = 'composing', delayMs = 3000) {
  const baseUrl = normalizeServerUrl(serverUrl);
  if (!instanceToken || !number) return null;
  const cleanNumber = String(number).replace(/\D/g, '');
  if (!cleanNumber || cleanNumber.length < 8) return null;

  try {
    const res = await axios.post(
      `${baseUrl}/message/presence`,
      {
        number: cleanNumber,
        presence: presence || 'composing',
        delay: Math.min(delayMs || 3000, 300000)
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'token': instanceToken.trim()
        },
        timeout: 6000
      }
    );
    return res.data;
  } catch (err) {
    // Presença é um aprimoramento estético não-bloqueante
    return null;
  }
}

module.exports = {
  normalizeServerUrl,
  parseApiError,
  createInstance,
  connectInstance,
  getInstanceStatus,
  configureWebhook,
  sendTextMessage,
  sendMediaMessage,
  sendPresence,
  disconnectInstance,
  deleteInstance,
  updateInstanceName,
  findChats,
  findMessages,
  fetchAllInstances,
  registerLidMapping,
  resolvePhoneFromLid,
  lidToPhoneCache
};


