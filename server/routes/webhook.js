const express = require('express');
const router = express.Router();
const db = require('../storage/db');
const { processIncomingMessage } = require('../services/flowEngine');

/**
 * Verificação do Webhook da Meta (GET)
 */
router.get('/', (req, res) => {
  const settings = db.getSettings();
  const verifyToken = settings.webhookVerifyToken || 'whatsapp_hub_token_2026';

  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode && token) {
    if (mode === 'subscribe' && token === verifyToken) {
      console.log('[Webhook] Verificado com sucesso pela Meta!');
      return res.status(200).send(challenge);
    }
    return res.status(403).send('Token de verificação inválido.');
  }

  res.status(400).send('Parâmetros ausentes.');
});

/**
 * Recebimento de Mensagens e Status da Meta (POST)
 */
router.post('/', async (req, res) => {
  // A Meta exige resposta 200 rápida para não reenviar mensagens
  res.status(200).send('EVENT_RECEIVED');

  try {
    const body = req.body;
    if (body.object !== 'whatsapp_business_account') return;

    const entry = body.entry?.[0];
    const changes = entry?.changes?.[0];
    const value = changes?.value;

    if (!value || !value.messages || value.messages.length === 0) {
      return; // Notificações de status (entregue, lido, etc.)
    }

    const message = value.messages[0];
    const fromPhone = message.from; // Número do remetente
    const phoneNumberId = value.metadata?.phone_number_id;

    // Localizar a qual chip/instância pertence esse Phone Number ID
    const instances = db.getInstances();
    const instance = instances.find(i => i.phoneNumberId === phoneNumberId) || instances[0] || { id: 'inst_1' };

    let textBody = '';
    if (message.type === 'text') {
      textBody = message.text?.body || '';
    } else if (message.type === 'interactive') {
      textBody = message.interactive?.button_reply?.title || message.interactive?.list_reply?.title || '';
    }

    if (textBody) {
      console.log(`[Webhook] Mensagem de ${fromPhone} (Chip: ${instance.name || instance.id}): "${textBody}"`);
      await processIncomingMessage(instance.id, fromPhone, textBody);
    }
  } catch (err) {
    console.error('[Webhook Error]', err);
  }
});

module.exports = router;
