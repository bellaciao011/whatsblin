const express = require('express');
const router = express.Router();
const db = require('../storage/db');
const cryptoService = require('../services/cryptoService');
const { processIncomingMessage, eventBus } = require('../services/flowEngine');
const { resolvePhoneFromLid, registerLidMapping } = require('../services/uazapiService');

/**
 * Localiza a instância correspondente ao webhook recebido
 */
function findInstance(req) {
  const instances = db.getInstances();
  const uazapiInstances = instances.filter(i => i.tipo === 'uazapi' || i.instance_id);

  // 1. Tenta por ID de instância no body
  const bodyInstanceId = req.body?.instance || req.body?.instanceId || req.body?.instance_id;
  if (bodyInstanceId) {
    const found = uazapiInstances.find(i => i.instance_id === bodyInstanceId || i.id === bodyInstanceId || i.name === bodyInstanceId);
    if (found) return found;
  }

  // 2. Tenta por token no header ou body
  const tokenHeader = req.headers['token'] || req.headers['authorization']?.replace('Bearer ', '') || req.body?.token;
  if (tokenHeader) {
    for (const inst of uazapiInstances) {
      if (inst.instance_token) {
        const dec = cryptoService.decrypt(inst.instance_token);
        if (dec === tokenHeader || inst.instance_token === tokenHeader) {
          return inst;
        }
      }
    }
  }

  // 3. Tenta por query param (caso configurado com ?instanceId=...)
  if (req.query?.instanceId) {
    const found = uazapiInstances.find(i => i.id === req.query.instanceId || i.instance_id === req.query.instanceId);
    if (found) return found;
  }

  // Fallback: primeira instância uazapi ativa ou primeira cadastrada
  return uazapiInstances.find(i => i.status === 'connected') || uazapiInstances[0] || instances[0] || null;
}

/**
 * POST /api/webhooks/uazapi (Endpoint oficial para receber webhooks da uazapi)
 */
router.post('/uazapi', async (req, res) => {
  // Resposta rápida 200 para liberar o servidor uazapi
  res.status(200).json({ received: true });

  try {
    const body = req.body || {};
    const eventType = (body.event || body.EventType || body.type || '').toLowerCase();
    const instance = findInstance(req);
    const instLogName = instance ? `${instance.name} (${instance.id})` : 'Desconhecida';

    console.log(`[uazapi Webhook] Evento: "${eventType}" recebido para instância: ${instLogName}`);

    // =========================================================================
    // 1. TRATAMENTO DE EVENTOS DE CONEXÃO
    // =========================================================================
    if (eventType === 'connection' || body.connected !== undefined || body.data?.connected !== undefined) {
      const connData = body.data || body.payload || body;
      const connStatus = (connData.status || connData.state || (connData.connected ? 'connected' : 'disconnected') || '').toLowerCase();
      console.log(`[uazapi Webhook] Status de conexão da instância ${instLogName}: "${connStatus}"`);

      if (instance) {
        if (connStatus === 'connected' || connStatus === 'open' || connData.connected === true) {
          instance.status = 'connected';
          const userPhone = connData.jid?.user || connData.user || connData.owner || connData.instance?.owner || (typeof connData.jid === 'string' ? connData.jid.split('@')[0].replace(/\D/g, '') : null);
          if (userPhone && String(userPhone).replace(/\D/g, '').length >= 8) {
            const cleanDigits = String(userPhone).replace(/\D/g, '');
            instance.numero_conectado = cleanDigits;
            instance.phoneNumber = cleanDigits;
          }
          db.saveInstance(instance);
          console.log(`[uazapi Webhook] ✓ Instância ${instance.name} marcada como CONECTADA (${instance.numero_conectado || 'sem número'})`);
        } else if (connStatus === 'disconnected' || connStatus === 'close' || connStatus === 'closed' || connData.connected === false) {
          instance.status = 'disconnected';
          db.saveInstance(instance);
          console.warn(`[uazapi Webhook] ⚠️ Instância ${instance.name} marcada como DESCONECTADA`);
        }
        eventBus.emit('connection_status', { instanceId: instance.id, status: instance.status });
        eventBus.emit('instances_updated', { instanceId: instance.id, status: instance.status });
      }
      return;
    }

    // =========================================================================
    // 2. EXTRAÇÃO ROBUSTA DE MENSAGENS (SUPORTA TODOS OS FORMATOS DA UAZAPI)
    // =========================================================================
    let messagesList = [];
    if (Array.isArray(body)) {
      messagesList = body;
    } else if (Array.isArray(body.data)) {
      messagesList = body.data;
    } else if (Array.isArray(body.messages)) {
      messagesList = body.messages;
    } else if (body.data?.messages && Array.isArray(body.data.messages)) {
      messagesList = body.data.messages;
    } else if (body.data && typeof body.data === 'object' && (body.data.chatid || body.data.text || body.data.message || body.data.id)) {
      messagesList = [body.data];
    } else if (body.message && typeof body.message === 'object') {
      messagesList = [body.message];
    } else if (body.chatid || body.sender || body.text || body.messageid || body.id) {
      messagesList = [body];
    } else if (body.payload) {
      messagesList = Array.isArray(body.payload) ? body.payload : [body.payload];
    }

    if (messagesList.length === 0 && (eventType.includes('message') || eventType.includes('messages'))) {
      console.log(`[uazapi Webhook] ℹ️ Evento ${eventType} sem mensagens identificáveis no payload`);
      return;
    }

    for (const msg of messagesList) {
      if (!msg || typeof msg !== 'object') continue;

      // FILTRO CRÍTICO ANTI-LOOP: Ignorar mensagens geradas pela API
      if (msg.wasSentByApi === true) {
        continue;
      }

      // Ignorar mensagens de grupos (o funil é 1:1 privado)
      if (msg.isGroup === true || (msg.chatid && msg.chatid.endsWith('@g.us'))) {
        continue;
      }

      // Extrai o corpo do texto da mensagem
      let textBody = '';
      if (typeof msg.text === 'string') {
        textBody = msg.text;
      } else if (typeof msg.body === 'string') {
        textBody = msg.body;
      } else if (typeof msg.content === 'string') {
        textBody = msg.content;
      } else if (msg.content && typeof msg.content === 'object') {
        textBody = msg.content.text || msg.content.caption || msg.content.body || '';
      } else if (msg.message) {
        textBody = msg.message.conversation ||
                   msg.message.extendedTextMessage?.text ||
                   msg.message.imageMessage?.caption ||
                   '';
      }

      textBody = (textBody || '').trim();

      // Extrai anexo de mídia se houver
      let mediaAttachment = null;
      if (msg.fileURL || msg.mediaUrl || msg.messageType === 'image' || msg.message?.imageMessage) {
        mediaAttachment = {
          url: msg.fileURL || msg.mediaUrl || null,
          type: msg.messageType || 'image'
        };
      }

      const isFromMe = msg.fromMe === true || msg.key?.fromMe === true;

      // Resolução inteligente do número de telefone (mapeando @lid se necessário)
      let rawTarget = '';
      if (msg.chatid && !msg.chatid.endsWith('@lid')) {
        rawTarget = msg.chatid;
      } else if (isFromMe) {
        rawTarget = msg.to || msg.key?.remoteJid || msg.chatid || '';
      } else {
        rawTarget = msg.chatid || msg.sender || msg.from || msg.key?.remoteJid || '';
      }

      let cleanPhone = resolvePhoneFromLid(rawTarget);
      if (!cleanPhone || cleanPhone.length < 8) {
        cleanPhone = String(rawTarget).replace(/@.*$/, '').replace(/\D/g, '');
      }

      if (!cleanPhone || cleanPhone.length < 8) {
        console.warn(`[uazapi Webhook] Número de contato inválido: "${rawTarget}"`);
        continue;
      }

      const msgId = msg.id || msg.messageid || `msg_${Date.now()}_${Math.floor(Math.random() * 1000)}`;

      // Deduplicação: ignora se já existe no banco
      const existingChat = db.getChat(cleanPhone);
      if (existingChat?.messages?.some(m => m.id === msgId)) {
        continue;
      }

      // Mensagens enviadas pelo próprio operador (aparelho físico do chip)
      if (isFromMe) {
        console.log(`[uazapi Webhook] 📤 Mensagem enviada pelo operador para ${cleanPhone}: "${textBody || '[Mídia]'}"`);
        try {
          db.addChatMessage(cleanPhone, {
            id: msgId,
            timestamp: new Date().toISOString(),
            from: 'agent',
            text: textBody || '[Mídia]',
            mediaUrl: mediaAttachment?.url || null,
            mediaType: mediaAttachment?.type || null,
            instanceId: instance?.id || 'inst_1'
          });
          eventBus.emit('chat_updated', { phone: cleanPhone });
        } catch (e) {
          console.warn('[uazapi Webhook] Erro ao registrar mensagem de saída:', e.message);
        }
        continue;
      }

      console.log(`[uazapi Webhook] 📩 Mensagem de lead +${cleanPhone} (Chip: ${instLogName}): "${textBody || '[Mídia]'}"`);

      // Encaminha para o motor de fluxo existente do WhatsHub Pro
      if (instance) {
        await processIncomingMessage(instance.id, cleanPhone, textBody, mediaAttachment);
      } else {
        console.warn('[uazapi Webhook] Nenhuma instância ativa configurada para processar esta mensagem.');
      }
    }
  } catch (err) {
    console.error('[uazapi Webhook Error] Erro ao processar payload recebido:', err);
  }
});

module.exports = router;
