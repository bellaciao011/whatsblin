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
// SEPARAÇÃO ABSOLUTA: PAINEL SAAS vs DOMÍNIOS DE ANÚNCIO / CAMPANHA
// =========================================================================
app.use((req, res, next) => {
  const rawHost = (req.headers.host || '').split(':')[0].toLowerCase().trim();
  const isSystemHost = rawHost === 'localhost' || 
                       rawHost === '127.0.0.1' || 
                       rawHost.endsWith('.railway.app') || 
                       rawHost.endsWith('.up.railway.app');

  // CASO 1: DOMÍNIO DO RAILWAY (whatsblin-production.up.railway.app)
  // Esse domínio é EXCLUSIVAMENTE o painel administrativo do SaaS.
  // Bloqueia rotas de campanha (/c/*) nele para que campanhas NUNCA usem o domínio do Railway.
    // CASO 1: DOMÍNIO DO SISTEMA (ex: painel-leona.up.railway.app, localhost)
  // Permite tanto a dashboard quanto links de teste/campanha (/c/* e /chat)
  if (isSystemHost) {
    return next();
  }

  // CASO 2: DOMÍNIOS DE ANÚNCIO (ex: wtb.expresstrackin-g.com, expresstrackin-g.com)
  // Esses domínios são EXCLUSIVAMENTE de tracking, redirect de checkout e WhatsApp.
  // O painel do SaaS, tela de login e rotas de administração NÃO EXISTEM aqui!
  // Permite rotas do chatbot, scripts, estilos, imagens, provas geradas e checkout
  if (
    req.path.startsWith('/c/') ||
    req.path.startsWith('/chat') ||
    req.path.startsWith('/api/webchat/') ||
    req.path.startsWith('/generated/') ||
    req.path.startsWith('/images/') ||
    req.path.startsWith('/css/') ||
    req.path.startsWith('/js/') ||
    req.path.startsWith('/assets/') ||
    req.path.startsWith('/whatsapp-chat.html') ||
    req.path.startsWith('/checkout') ||
    req.path.startsWith('/chk') ||
    req.path === '/favicon.ico'
  ) {
    return next();
  }

  // Se qualquer pessoa acessar a raiz ("/") ou tentar entrar em "/login", "/api", etc.:
  // NUNCA exibe nada do SaaS. Redireciona imediatamente para a campanha ou WhatsApp direto:
  const campaigns = db.getTrafficCampaigns();
  const matchedCamp = campaigns.find(c => c.custom_domain === rawHost) || campaigns[0];

  if (matchedCamp) {
    return res.redirect(302, `/c/${matchedCamp.slug}`);
  }

  return res.redirect(302, 'https://wa.me/');
});

// Arquivos estáticos e Webhooks públicos
app.use('/generated', express.static(path.join(__dirname, '../public/generated')));
app.use('/images', express.static(path.join(__dirname, '../public/images')));
app.use('/css', express.static(path.join(__dirname, '../public/css')));
app.use('/js', express.static(path.join(__dirname, '../public/js')));
app.use('/assets', express.static(path.join(__dirname, '../assets')));
app.use('/webhook', webhookRoutes);
app.use('/api/webhooks', uazapiWebhookRoutes);

// =========================================================================
// ROTA DE REDIRECIONAMENTO LIMPO DE CHECKOUT
// Transforma links elegantes como https://wtb.expresstrackin-g.com/checkout?codigo=3W7K9P
// no checkout completo da CenterPag com todas as UTMs, SRC, SCK e cw_token preenchidos.
// =========================================================================
app.get(['/checkout', '/checkout/:codigo', '/chk/:codigo'], (req, res) => {
  try {
    let rawCode = req.params.codigo || req.query.codigo || req.query.code || req.query.c || '';

    // Se o parâmetro foi passado como chave pura (ex: ?3W7K9P ou ?codigo)
    if (!rawCode) {
      const keys = Object.keys(req.query);
      for (const k of keys) {
        if (/^[A-Za-z0-9]{4,12}$/.test(k)) {
          rawCode = k;
          break;
        }
      }
    }

    const cleanCode = (rawCode ? String(rawCode).trim().toUpperCase().replace(/[^A-Z0-9]/g, '') : '') || 'LEAD';
    const leadToken = `cw_sec_${cleanCode.toLowerCase()}_2026`;

    // 1. Busca URL base do checkout em espanhol configurado no funil
    const funnel = (db.getFunnel ? db.getFunnel() : {}) || {};
    const baseUrl = (funnel.checkoutUrlEs || funnel.checkouts?.es?.frontUrl || 'https://go.centerpag.com/PPU38CQG5EL').trim();

    // 2. Tenta resgatar a atribuição original do anúncio (salva quando o lead passou pela pressel)
    let attr = null;
    if (cleanCode !== 'LEAD') {
      try {
        const attributions = db.getTrafficAttributions();
        attr = attributions.find(a => (a.codigo || '').toUpperCase() === cleanCode);
      } catch (e) {}
    }

    // 3. Monta a URL de destino na CenterPag/PerfectPay com UTMs REAIS do anúncio + SCK do lead
    const u = new URL(baseUrl);

    // UTMs: prioridade total aos parâmetros que vieram do anúncio (req.query)
    const realSource = req.query.utm_source || attr?.utm_source || 'direct';
    const realCampaign = req.query.utm_campaign || attr?.utm_campaign || attr?.campanha_nome || cleanCode;
    const realContent = req.query.utm_content || attr?.utm_content || cleanCode;
    const realMedium = req.query.utm_medium || attr?.utm_medium || 'cpc';
    const ttclid = req.query.ttclid || req.query.tt_clid || attr?.ttclid || null;

    u.searchParams.set('utm_source', realSource);
    u.searchParams.set('utm_campaign', realCampaign);
    u.searchParams.set('utm_content', realContent);
    u.searchParams.set('utm_medium', realMedium);
    if (req.query.utm_term || attr?.utm_term) u.searchParams.set('utm_term', req.query.utm_term || attr.utm_term);
    if (ttclid) u.searchParams.set('ttclid', ttclid);

    // Identificador do Lead: respeita src e sck recebidos ou define cleanCode como fallback
    u.searchParams.set('src', req.query.src || cleanCode);
    u.searchParams.set('sck', req.query.sck || cleanCode);
    u.searchParams.set('code', cleanCode);
    u.searchParams.set('codigo', cleanCode);
    u.searchParams.set('cw_token', leadToken);
    u.searchParams.set('view', 'lead');

    // 4. Preserva 100% de quaisquer outros parâmetros adicionais da query string
    Object.keys(req.query).forEach(k => {
      if (req.query[k] !== undefined && req.query[k] !== null && req.query[k] !== '') {
        u.searchParams.set(k, req.query[k]);
      }
    });

    console.log(`[Checkout Redirect] ⚡ Redirecionando lead (${cleanCode}) ➔ CenterPag com UTMs completas`);
    return res.redirect(302, u.toString());
  } catch (err) {
    console.error('[Checkout Redirect Error]:', err);
    return res.redirect(302, 'https://go.centerpag.com/PPU38CQG5EL');
  }
});

app.use(['/c', '/chat'], campaignRoutes);

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
    req.path.startsWith('/chat') ||
    req.path.startsWith('/api/webchat/') ||
    req.path.startsWith('/css/whatsapp-chat.css') ||
    req.path.startsWith('/js/whatsapp-chat.js') ||
    req.path.startsWith('/whatsapp-chat.html') ||
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
  const token = cookies.auth_token || req.query?.token || (req.headers.authorization ? req.headers.authorization.replace('Bearer ', '') : null);
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
