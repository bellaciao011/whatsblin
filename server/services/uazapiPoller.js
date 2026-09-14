const db = require('../storage/db');
const cryptoService = require('./cryptoService');
const uazapiService = require('./uazapiService');
const { processIncomingMessage, eventBus } = require('./flowEngine');

let isPolling = false;
let pollTimer = null;

// Cache global em memória de IDs já processados para deduplicação absoluta
const seenMessageIds = new Set();
// Trava de concorrência por lead para evitar disparos paralelos
const activeLeadProcessing = new Set();

/**
 * Inicializa o cache de IDs a partir dos chats já salvos
 */
function initSeenCache() {
  try {
    const chats = db.getChats() || {};
    for (const phone of Object.keys(chats)) {
      const chat = chats[phone];
      if (Array.isArray(chat?.messages)) {
        for (const m of chat.messages) {
          if (m?.id) seenMessageIds.add(m.id);
        }
      }
    }
  } catch (e) {}
}

initSeenCache();

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
 * Converte timestamp para milissegundos
 */
function getTimestampMs(ts) {
  if (!ts) return Date.now();
  if (typeof ts === 'number') {
    return ts > 1000000000000 ? ts : ts * 1000;
  }
  const parsed = new Date(ts).getTime();
  return isNaN(parsed) ? Date.now() : parsed;
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
      const chats = await uazapiService.findChats(serverUrl, decToken, 25);
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
        let chat = db.getChat(cleanPhone);

        const remoteTimestampMs = getTimestampMs(c.wa_lastMsgTimestamp);

        if (!chat) {
          chat = {
            leadPhone: cleanPhone,
            leadName,
            instanceId: inst.id,
            state: 'NOVO',
            lastMessageTime: parseTimestamp(c.wa_lastMsgTimestamp),
            lastProcessedTimestamp: remoteTimestampMs || Date.now(),
            messages: []
          };
          const allChats = db.getChats();
          allChats[cleanPhone] = chat;
          db.saveChats(allChats);
          anyUpdate = true;
        }

        // Inicializa watermark se ainda não existir
        if (!chat.lastProcessedTimestamp) {
          let maxExistingTs = 0;
          if (Array.isArray(chat.messages) && chat.messages.length > 0) {
            for (const m of chat.messages) {
              const t = new Date(m.timestamp).getTime();
              if (t > maxExistingTs) maxExistingTs = t;
            }
          }
          chat.lastProcessedTimestamp = maxExistingTs > 0 ? maxExistingTs : (remoteTimestampMs || Date.now());
          const allChats = db.getChats();
          allChats[cleanPhone] = chat;
          db.saveChats(allChats);
        }

        // Verifica se precisamos buscar mensagens desta conversa
        const existingCount = chat.messages ? chat.messages.length : 0;
        const needsFetch = existingCount === 0 ||
          (c.wa_unreadCount && c.wa_unreadCount > 0) ||
          (remoteTimestampMs > (chat.lastProcessedTimestamp + 1000));

        if (!needsFetch) continue;

        // 2. Busca mensagens recentes para este contato
        const remoteTargetJid = c.wa_chatid || `${cleanPhone}@s.whatsapp.net`;
        const msgs = await uazapiService.findMessages(serverUrl, decToken, remoteTargetJid, 15);
        if (!Array.isArray(msgs) || msgs.length === 0) continue;

        // Ordena cronologicamente (mensagens mais antigas primeiro)
        msgs.sort((a, b) => {
          const ta = getTimestampMs(a.messageTimestamp);
          const tb = getTimestampMs(b.messageTimestamp);
          return ta - tb;
        });

        for (const m of msgs) {
          if (!m || typeof m !== 'object') continue;
          if (m.isGroup) continue;

          const msgId = m.id || m.messageid || m.key?.id || `${cleanPhone}_${m.messageTimestamp}`;
          const text = (m.text || m.body || m.content?.text || (typeof m.content === 'string' ? m.content : '') || m.message?.conversation || '').trim();
          const mediaUrl = m.fileURL || m.mediaUrl || null;
          const isFromMe = m.fromMe === true || m.key?.fromMe === true;
          const msgTimestampMs = getTimestampMs(m.messageTimestamp);

          // 1. Deduplicação por Cache em Memória
          if (seenMessageIds.has(msgId)) continue;

          // 2. Deduplicação por Verificação no Banco Local
          const isAlreadyInHistory = chat.messages && chat.messages.some(existing =>
            existing.id === msgId ||
            (existing.from === (isFromMe ? 'agent' : 'lead') && existing.text === text && Math.abs(new Date(existing.timestamp).getTime() - msgTimestampMs) < 60000)
          );
          if (isAlreadyInHistory) {
            seenMessageIds.add(msgId);
            continue;
          }

          if (isFromMe) {
            // Mensagem de saída (enviada pelo operador humano ou bot)
            seenMessageIds.add(msgId);
            db.addChatMessage(cleanPhone, {
              id: msgId,
              timestamp: parseTimestamp(m.messageTimestamp),
              from: 'agent',
              text: text || (mediaUrl ? '[Mídia]' : ''),
              mediaUrl: mediaUrl,
              mediaType: m.messageType || null,
              instanceId: inst.id
            });
            chat.lastProcessedTimestamp = Math.max(chat.lastProcessedTimestamp || 0, msgTimestampMs);
            const currentChats = db.getChats();
            if (currentChats[cleanPhone]) {
              currentChats[cleanPhone].lastProcessedTimestamp = chat.lastProcessedTimestamp;
              db.saveChats(currentChats);
            }
            anyUpdate = true;
          } else {
            // Mensagem de entrada do LEAD:
            // 3. Watermark: Se o timestamp for anterior ou igual ao watermark, é mensagem antiga do histórico!
            if (msgTimestampMs <= (chat.lastProcessedTimestamp || 0)) {
              seenMessageIds.add(msgId);
              continue;
            }

            // 4. Trava de concorrência por lead
            if (activeLeadProcessing.has(cleanPhone)) {
              console.log(`[uazapi Poller] Lead +${cleanPhone} em processamento ativo, aguardando próximo ciclo.`);
              continue;
            }

            // Marca imediatamente para não ser re-capturado em loops
            seenMessageIds.add(msgId);
            activeLeadProcessing.add(cleanPhone);

            try {
              console.log(`[uazapi Poller] 📩 Nova mensagem real identificada de lead +${cleanPhone}: "${text || '[Mídia]'}" (ID: ${msgId})`);

              // Executa o processIncomingMessage passando msgId e timestamp originais
              await processIncomingMessage(
                inst.id,
                cleanPhone,
                text,
                mediaUrl ? { url: mediaUrl, type: m.messageType || 'image' } : null,
                msgId,
                parseTimestamp(m.messageTimestamp)
              );

              anyUpdate = true;

              // Atualiza o watermark da conversa
              const reloaded = db.getChat(cleanPhone);
              if (reloaded) {
                reloaded.lastProcessedTimestamp = Math.max(reloaded.lastProcessedTimestamp || 0, msgTimestampMs);
                const currentChats = db.getChats();
                currentChats[cleanPhone] = reloaded;
                db.saveChats(currentChats);
                chat = reloaded;
              }
            } catch (procErr) {
              console.error(`[uazapi Poller Error] Falha ao processar mensagem de +${cleanPhone}:`, procErr);
            } finally {
              activeLeadProcessing.delete(cleanPhone);
            }
          }
        }
      }
    }

    if (anyUpdate) {
      eventBus.emit('chat_updated', { total: Object.keys(db.getChats()).length });
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
