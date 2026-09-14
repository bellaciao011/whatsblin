const express = require('express');
const router = express.Router();
const db = require('../storage/db');
const cryptoService = require('../services/cryptoService');
const { processIncomingMessage, eventBus } = require('../services/flowEngine');

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
    const eventType = (body.event || body.EventType || '').toLowerCase();
    const data = body.data || body.payload || {};

    const instance = findInstance(req);
    const instLogName = instance ? `${instance.name} (${instance.id})` : 'Desconhecida';

    console.log(`[uazapi Webhook] Evento: "${eventType}" recebido para instância: ${instLogName}`);

    // =========================================================================
    // 1. TRATAMENTO DE EVENTOS DE CONEXÃO
    // =========================================================================
    if (eventType === 'connection') {
      const connStatus = (data.status || data.state || (data.connected ? 'connected' : 'disconnected') || '').toLowerCase();
      console.log(`[uazapi Webhook] Status de conexão da instância ${instLogName}: "${connStatus}"`);

      if (instance) {
        if (connStatus === 'connected' || connStatus === 'open' || data.connected === true) {
          instance.status = 'connected';
          const userPhone = data.jid?.user || data.user || data.owner || data.instance?.owner || (typeof data.jid === 'string' ? data.jid.split('@')[0].replace(/\D/g, '') : null);
          if (userPhone && String(userPhone).replace(/\D/g, '').length >= 8) {
            const cleanDigits = String(userPhone).replace(/\D/g, '');
            instance.numero_conectado = cleanDigits;
            instance.phoneNumber = cleanDigits;
          }
          db.saveInstance(instance);
          console.log(`[uazapi Webhook] ✓ Instância ${instance.name} marcada como CONECTADA (${instance.numero_conectado || 'sem número'})`);
        } else if (connStatus === 'disconnected' || connStatus === 'close' || connStatus === 'closed' || data.connected === false) {
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
    // 2. TRATAMENTO DE EVENTOS DE MENSAGENS (LEADS)
    // =========================================================================
    if (eventType === 'messages' || eventType === 'message' || eventType === 'messages_update') {
      const messagesList = Array.isArray(data) ? data : (data.messages || [data]);

      for (const msg of messagesList) {
        if (!msg || typeof msg !== 'object') continue;

        // FILTRO CRÍTICO ANTI-LOOP: Ignorar mensagens geradas pela API
        if (msg.wasSentByApi === true) {
          console.log(`[uazapi Webhook] ⏩ Mensagem ignorada (wasSentByApi = true para evitar loop)`);
          continue;
        }

        // Ignorar mensagens enviadas pelo próprio usuário (aparelho do chip)
        if (msg.fromMe === true || msg.key?.fromMe === true) {
          continue;
        }

        // Ignorar mensagens de grupos (o funil é 1:1 privado)
        if (msg.isGroup === true || (msg.chatid && msg.chatid.endsWith('@g.us'))) {
          continue;
        }

        // Extrai o número do remetente
        const rawSender = msg.chatid || msg.sender || msg.from || msg.key?.remoteJid || '';
        const cleanPhone = rawSender.replace(/@.*$/, '').replace(/\D/g, '');

        if (!cleanPhone || cleanPhone.length < 8) {
          console.warn(`[uazapi Webhook] Número de remetente inválido: "${rawSender}"`);
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

        console.log(`[uazapi Webhook] 📩 Mensagem de ${cleanPhone} (Chip: ${instLogName}): "${textBody || '[Mídia]'}"`);

        // Encaminha para o motor de fluxo existente do WhatsHub Pro
        if (instance) {
          await processIncomingMessage(instance.id, cleanPhone, textBody, mediaAttachment);
        } else {
          console.warn('[uazapi Webhook] Nenhuma instância ativa configurada para processar esta mensagem.');
        }
      }
    }
  } catch (err) {
    console.error('[uazapi Webhook Error] Erro ao processar payload recebido:', err);
  }
});

module.exports = router;
