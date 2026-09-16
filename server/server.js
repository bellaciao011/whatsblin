const express = require('express');
const cors = require('cors');
const path = require('path');
const db = require('./storage/db');
const authService = require('./services/authService');

const webhookRoutes = require('./routes/webhook');
const uazapiWebhookRoutes = require('./routes/uazapiWebhook');
const apiRoutes = require('./routes/api');
const campaignRoutes = require('./routes/campaignRoutes');
const domainRoutes = require('./routes/domainRoutes');
const { startUazapiMessageSyncWorker } = require('./services/uazapiPoller');

const app = express();

// Habilita trust proxy para Railway e proxies reversos
app.set('trust proxy', true);

// Middlewares globais
app.use(cors());
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));

// Prevenir cache agressivo do navegador para scripts, páginas e estilos
app.use((req, res, next) => {
  if (req.path.endsWith('.html') || req.path.endsWith('.js') || req.path.endsWith('.css') || req.path === '/' || req.path === '/login') {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
  next();
});

// =========================================================================
// ISOLAMENTO TOTAL DE DOMÍNIOS DE CAMPANHA (TRACKING ONLY)
// Garante que domínios customizados (ex: expresstrackin-g.com, wtb.expresstrackin-g.com)
// NUNCA exibam a tela de login, o painel administrativo ou o SaaS do WhatsHub Pro!
// =========================================================================
app.use((req, res, next) => {
  const rawHost = (req.headers.host || '').split(':')[0].toLowerCase().trim();
  const isSystemHost = rawHost === 'localhost' || 
                       rawHost === '127.0.0.1' || 
                       rawHost.endsWith('.railway.app') || 
                       rawHost.endsWith('.up.railway.app');

  // Se o tráfego vier pelo domínio oficial do Railway ou localhost, libera acesso ao dashboard e APIs
  if (isSystemHost) {
    return next();
  }

  // Se o tráfego vier por um domínio customizado de anúncio:
  // 1. Se for rota de tracking de campanha (/c/*), permite o fluxo normal:
  if (req.path.startsWith('/c/')) {
    return next();
  }

  // 2. Se for arquivo estático essencial (favicon, imagens geradas):
  if (req.path === '/favicon.ico' || req.path.startsWith('/assets/')) {
    return next();
  }

  // 3. Para QUALQUER outra rota acessada no domínio de campanha (ex: "/", "/login", "/admin"):
  // NUNCA exibe o painel! Redireciona imediatamente para a campanha ou WhatsApp:
  const campaigns = db.getTrafficCampaigns();
  const matchedCamp = campaigns.find(c => c.custom_domain === rawHost) || campaigns[0];

  if (matchedCamp) {
    return res.redirect(302, `/c/${matchedCamp.slug}`);
  }

  // Se não houver campanha, faz redirect limpo para WhatsApp
  return res.redirect(302, 'https://wa.me/');
});

// Arquivos estáticos e Webhooks públicos
app.use('/generated', express.static(path.join(__dirname, '../public/generated')));
app.use('/assets', express.static(path.join(__dirname, '../assets')));
app.use('/css', express.static(path.join(__dirname, '../public/css')));
app.use('/webhook', webhookRoutes);
app.use('/api/webhooks', uazapiWebhookRoutes);
app.use('/c', campaignRoutes);

// Rota da Tela de Login (se já estiver autenticado, vai direto para o dashboard)
app.get(['/login', '/login.html'], (req, res) => {
  const cookies = authService.parseCookies(req);
  const token = cookies.auth_token;
  if (authService.verifyToken(token)) {
    return res.redirect('/');
  }
  res.sendFile(path.join(__dirname, '../public/login.html'));
});

// 2. MIDDLEWARE DE PROTEÇÃO POR SENHA (BARREIRA DE SEGURANÇA)
app.use((req, res, next) => {
  // Rotas que dispensam autenticação:
  if (
    req.path.startsWith('/c/') ||
    req.path.startsWith('/api/auth/') ||
    req.path.startsWith('/api/webhooks/') ||
    req.path.startsWith('/api/generate-proof') ||
    req.path.startsWith('/api/gerar-foto') ||
    req.path.startsWith('/api/webhooks') ||
    req.path.startsWith('/generate-proof') ||
    req.path.startsWith('/gerar-foto') ||
    req.path === '/api/facebook/connect' ||
    req.path === '/favicon.ico'
  ) {
    return next();
  }

  // Extrai token do cookie auth_token ou do header Authorization Bearer
  const cookies = authService.parseCookies(req);
  const token = cookies.auth_token || (req.headers.authorization ? req.headers.authorization.replace('Bearer ', '') : null);
  const session = authService.verifyToken(token);

  if (session) {
    req.user = session;
    return next();
  }

  // Caso NÃO esteja autenticado:
  // 1) Se for chamada de API: retorna 401 JSON
  if (req.path.startsWith('/api/')) {
    return res.status(401).json({ error: 'Acesso restrito. Faça login para continuar.' });
  }

  // 2) Se for acesso via navegador (HTML/página): redireciona para a tela de login
  return res.redirect('/login');
});

// 3. ROTAS PROTEGIDAS (DISPONÍVEIS APENAS APÓS LOGIN)
app.use('/api', apiRoutes);
app.use('/api/dominios', domainRoutes);

// Prevenir cache agressivo do navegador para scripts, páginas e estilos
app.use((req, res, next) => {
  if (req.path.endsWith('.html') || req.path.endsWith('.js') || req.path.endsWith('.css') || req.path === '/' || req.path === '') {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
  next();
});

// Servir frontend do dashboard e scripts protegidos
app.use(express.static(path.join(__dirname, '../public')));

// Fallback SPA protegido
app.get('*', (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Inicialização do servidor
const settings = db.getSettings();
const PORT = process.env.PORT || settings.serverPort || 3000;

app.listen(PORT, () => {
  console.log('====================================================');
  console.log(`🚀 WHATSAPP AUTOMATION HUB RODANDO COM SUCESSO!`);
  console.log(`🌐 Dashboard (Protegido): http://localhost:${PORT}`);
  console.log(`🔐 Login: http://localhost:${PORT}/login`);
  console.log(`📡 Webhook Meta (Público): http://localhost:${PORT}/webhook`);
  console.log(`⚡ API Leona (Público): http://localhost:${PORT}/api/generate-proof`);
  console.log('====================================================');

  // Auto-restaura conexão do WhatsApp com a uazapi no boot
  if (typeof apiRoutes.autoRestoreUazapiInstances === 'function') {
    apiRoutes.autoRestoreUazapiInstances().then(instances => {
      const connected = (instances || []).find(i => i.status === 'connected');
      if (connected) {
        console.log(`[Boot] ✓ Conexão WhatsApp preservada e ativa: ${connected.name} (${connected.numero_conectado || connected.id})`);
      }
      startUazapiMessageSyncWorker(3500);
    }).catch(e => {
      console.warn('[Boot] Aviso ao restaurar conexão:', e.message);
      startUazapiMessageSyncWorker(3500);
    });
  } else {
    startUazapiMessageSyncWorker(3500);
  }
});
