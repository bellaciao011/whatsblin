const db = require('../storage/db');
const cryptoService = require('./cryptoService');
const uazapiService = require('./uazapiService');
const { processIncomingMessage, eventBus } = require('./flowEngine');

let isPolling = false;
let pollTimer = null;

/**
 * Normaliza timestamp da uazapi para ISO string
 */
function parseTimestamp(ts) {
  if (!ts) return new Date().toISOString();
  if (typeof ts === 'number') {
    const ms = ts > 1000000000000 ? ts : ts * 1000;
    return new Date(ms).toISOString();
  }
  return new Date(ts).toISOString();
}

/**
 * Sincroniza conversas e novas mensagens de todas as instâncias uazapi conectadas
 */
async function syncUazapiInstancesNow() {
  if (isPolling) return;
  isPolling = true;

  try {
    const instances = db.getInstances();
    const uazapiConnected = instances.filter(i => (i.tipo === 'uazapi' || i.instance_id) && i.status === 'connected' && i.instance_token);

    if (uazapiConnected.length === 0) {
      isPolling = false;
      return;
    }

    const allChats = db.getChats();
    let anyUpdate = false;

    for (const inst of uazapiConnected) {
      let decToken = '';
      try {
        decToken = cryptoService.decrypt(inst.instance_token);
      } catch (e) {
        decToken = inst.instance_token;
      }
      if (!decToken) continue;

      const serverUrl = inst.url_servidor || 'https://whatsblin.uazapi.com';

      // 1. Busca conversas recentes
      const chats = await uazapiService.findChats(serverUrl, decToken, 30);
      if (!Array.isArray(chats) || chats.length === 0) continue;

      for (const c of chats) {
        if (c.wa_isGroup) continue;

        // Registra LID se presente
        if (c.wa_chatlid && c.wa_chatid) {
          uazapiService.registerLidMapping(c.wa_chatlid, c.wa_chatid);
        }
        if (c.wa_chatlid && c.phone) {
          uazapiService.registerLidMapping(c.wa_chatlid, c.phone);
        }

        // Obtém o número de telefone real limpo
        let cleanPhone = c.wa_chatid ? c.wa_chatid.split('@')[0].replace(/\D/g, '') : null;
        if (!cleanPhone || cleanPhone.length < 8) {
          cleanPhone = uazapiService.resolvePhoneFromLid(c.wa_chatlid || c.phone);
        }
        if (!cleanPhone || cleanPhone.length < 8) continue;

        const leadName = c.name || c.wa_name || c.wa_contactName || `Lead +${cleanPhone}`;
        let chat = allChats[cleanPhone];

        if (!chat) {
          chat = {
            leadPhone: cleanPhone,
            leadName,
            instanceId: inst.id,
            state: 'NOVO',
            lastMessageTime: parseTimestamp(c.wa_lastMsgTimestamp),
            messages: []
          };
          allChats[cleanPhone] = chat;
          anyUpdate = true;
        }

        // Verifica se precisamos buscar mensagens desta conversa
        const existingCount = chat.messages ? chat.messages.length : 0;
        const lastExistingMsg = existingCount > 0 ? chat.messages[existingCount - 1] : null;
        const remoteTimestampMs = typeof c.wa_lastMsgTimestamp === 'number'
          ? (c.wa_lastMsgTimestamp > 1000000000000 ? c.wa_lastMsgTimestamp : c.wa_lastMsgTimestamp * 1000)
          : (c.wa_lastMsgTimestamp ? new Date(c.wa_lastMsgTimestamp).getTime() : 0);

        const localTimestampMs = lastExistingMsg ? new Date(lastExistingMsg.timestamp).getTime() : 0;

        const needsFetch = existingCount === 0 ||
          (c.wa_unreadCount && c.wa_unreadCount > 0) ||
          (remoteTimestampMs > (localTimestampMs + 1000));

        if (!needsFetch) continue;

        // 2. Busca mensagens recentes para este contato
        const remoteTargetJid = c.wa_chatid || `${cleanPhone}@s.whatsapp.net`;
        const msgs = await uazapiService.findMessages(serverUrl, decToken, remoteTargetJid, 15);
        if (!Array.isArray(msgs) || msgs.length === 0) continue;

        // Ordena cronologicamente (mensagens mais antigas primeiro)
        msgs.sort((a, b) => {
          const ta = a.messageTimestamp || 0;
          const tb = b.messageTimestamp || 0;
          return ta - tb;
        });

        for (const m of msgs) {
          if (!m || typeof m !== 'object') continue;
          if (m.isGroup) continue;

          const msgId = m.id || m.messageid || `${cleanPhone}_${m.messageTimestamp}`;
          const isAlreadyInChat = chat.messages.some(existing => existing.id === msgId);
          if (isAlreadyInChat) continue;

          // Extrai o texto
          const text = (m.text || m.body || m.content?.text || (typeof m.content === 'string' ? m.content : '') || m.message?.conversation || '').trim();
          const mediaUrl = m.fileURL || m.mediaUrl || null;
          const isFromMe = m.fromMe === true || m.key?.fromMe === true;

          if (isFromMe) {
            // Mensagem de saída enviada pelo operador ou pelo bot
            chat.messages.push({
              id: msgId,
              timestamp: parseTimestamp(m.messageTimestamp),
              from: 'agent',
              text: text || (mediaUrl ? '[Mídia]' : ''),
              mediaUrl: mediaUrl,
              mediaType: m.messageType || null,
              instanceId: inst.id
            });
            chat.lastMessageTime = parseTimestamp(m.messageTimestamp);
            anyUpdate = true;
          } else {
            // 📩 MENSAGEM RECEBIDA DO LEAD!
            // Se o lead mandou mensagem e ela não foi registrada ainda:
            console.log(`[uazapi Poller] 📩 Nova mensagem identificada de lead +${cleanPhone}: "${text || '[Mídia]'}"`);

            // Executa processIncomingMessage para acionar o funil, verificação e respostas
            await processIncomingMessage(
              inst.id,
              cleanPhone,
              text,
              mediaUrl ? { url: mediaUrl, type: m.messageType || 'image' } : null
            );

            anyUpdate = true;
            // Recarrega o chat atualizado da memória/banco
            const reloaded = db.getChat(cleanPhone);
            if (reloaded) {
              allChats[cleanPhone] = reloaded;
              chat = reloaded;
            }
          }
        }
      }
    }

    if (anyUpdate) {
      db.saveChats(allChats);
      eventBus.emit('chat_updated', { total: Object.keys(allChats).length });
    }
  } catch (err) {
    console.warn(`[uazapi Poller Warning]`, err.message);
  } finally {
    isPolling = false;
  }
}

/**
 * Inicia o worker de sincronização contínua a cada 3.5 segundos
 */
function startUazapiMessageSyncWorker(intervalMs = 3500) {
  if (pollTimer) return;
  console.log(`[uazapi Poller] 🚀 Iniciando sincronizador de mensagens contínuo (${intervalMs}ms)...`);
  // Primeira execução rápida
  setTimeout(() => {
    syncUazapiInstancesNow().catch(() => {});
  }, 1000);

  pollTimer = setInterval(() => {
    syncUazapiInstancesNow().catch(() => {});
  }, intervalMs);
}

function stopUazapiMessageSyncWorker() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

module.exports = {
  syncUazapiInstancesNow,
  startUazapiMessageSyncWorker,
  stopUazapiMessageSyncWorker
};
