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

  // Se não for verificação da Meta (hub.mode), é o navegador finalizando o OAuth com #access_token
  res.send(`<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <title>Conectando Meta...</title>
  <style>
    body {
      background: #090d16;
      color: #f3f4f6;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100vh;
      margin: 0;
      text-align: center;
    }
    .box {
      background: rgba(17, 24, 39, 0.9);
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 16px;
      padding: 32px 28px;
      max-width: 400px;
      box-shadow: 0 20px 40px rgba(0,0,0,0.6);
    }
    .spinner {
      width: 36px;
      height: 36px;
      border: 3px solid rgba(16, 185, 129, 0.2);
      border-top-color: #10b981;
      border-radius: 50%;
      animation: spin 0.7s linear infinite;
      margin: 0 auto 16px;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
  </style>
</head>
<body>
  <div class="box">
    <div class="spinner" id="spinner"></div>
    <h3 id="title" style="font-size: 18px; margin-bottom: 8px;">Conectando com o Facebook...</h3>
    <p id="msg" style="font-size: 13px; color: #9ca3af;">Capturando token de acesso e sincronizando...</p>
  </div>

  <script>
    (async function processOAuth() {
      const hash = window.location.hash.substring(1);
      const params = new URLSearchParams(hash);
      const accessToken = params.get('access_token') || new URLSearchParams(window.location.search).get('access_token');

      if (!accessToken) {
        document.getElementById('spinner').style.display = 'none';
        document.getElementById('title').textContent = '⚠️ Nenhum token recebido';
        document.getElementById('msg').textContent = 'A autenticação foi cancelada ou expirou.';
        return;
      }

      document.getElementById('msg').textContent = 'Sincronizando contas e WhatsApp...';

      try {
        const res = await fetch('/api/facebook/connect', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ accessToken })
        });

        const data = await res.json();

        if (res.ok && data.success) {
          document.getElementById('spinner').style.display = 'none';
          document.getElementById('title').textContent = '✅ Conectado com Sucesso!';
          document.getElementById('msg').textContent = 'Usuário: ' + (data.facebook?.userName || 'Meta Business') + '. Atualizando o painel...';
          
          if (window.opener && !window.opener.closed) {
            window.opener.location.reload();
          }
          setTimeout(() => window.close(), 1200);
        } else {
          document.getElementById('spinner').style.display = 'none';
          document.getElementById('title').textContent = 'Erro na conexão';
          document.getElementById('msg').textContent = data.error || 'Falha ao validar token na Meta.';
        }
      } catch (err) {
        document.getElementById('spinner').style.display = 'none';
        document.getElementById('title').textContent = 'Erro de comunicação';
        document.getElementById('msg').textContent = err.message;
      }
    })();
  </script>
</body>
</html>`);
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
