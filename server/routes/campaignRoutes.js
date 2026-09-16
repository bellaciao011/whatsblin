const express = require('express');
const router = express.Router();
const db = require('../storage/db');

/**
 * Endpoint de entrada de anúncios (TikTok Ads & Meta Ads): /c/:slug
 * Captura ttclid, fbclid, utms, cookie _ttp, gera código único de 6 dígitos
 * e redireciona de forma ultra-rápida (Pressel Interna Instantânea) para o WhatsApp!
 */
router.get('/:slug', (req, res) => {
  try {
    // 1. Verificação de Host Header (Multi-Domain Routing Seguro)
    const rawHost = req.headers.host || '';
    const cleanHost = rawHost.split(':')[0].toLowerCase().trim();

    // Permite domínios do sistema (localhost, IPs locais, domínios padrão do Railway)
    const isSystemHost = cleanHost === 'localhost' || 
                         cleanHost === '127.0.0.1' || 
                         cleanHost.endsWith('.railway.app') || 
                         cleanHost.endsWith('.up.railway.app');

    let customDomainRecord = null;
    if (!isSystemHost) {
      customDomainRecord = db.getCustomDomainByHostname(cleanHost);
      // Se o domínio estiver cadastrado no sistema (mesmo que estivesse como pendente ou aguardando_dns),
      // o fato do tráfego estar batendo no servidor prova que o DNS propagou!
      if (customDomainRecord) {
        if (customDomainRecord.status !== 'ativo') {
          db.updateCustomDomain(customDomainRecord.id, { status: 'ativo' });
          console.log(`[Domain Auto-Verify] ✓ Tráfego detectado em "${cleanHost}"! Domínio promovido para ATIVO.`);
        }
      }
    }

    const slug = req.params.slug;
    const campaigns = db.getTrafficCampaigns();
    let campaign = campaigns.find(c => c.slug === slug || c.id === slug);

    // Se a campanha não existir explicitamente, cria uma sob demanda para nunca perder tráfego
    if (!campaign) {
      campaign = db.addTrafficCampaign({
        nome: `Campanha (${slug})`,
        slug: slug,
        url_destino: '',
        mensagem_template: 'Oii vim pelo anúncio (código {codigo})'
      });
    }

    // Incrementa cliques da campanha
    campaign.total_cliques = (campaign.total_cliques || 0) + 1;
    db.saveTrafficCampaigns(campaigns);

    // Captura parâmetros de rastreamento de anúncios (TikTok Ads e Facebook Ads)
    const ttclid = req.query.ttclid || req.query.tt_clid || null;
    const fbclid = req.query.fbclid || req.query.fb_clid || null;
    
    // Auto-detecção inteligente de plataforma de origem
    let platform = 'organico';
    if (ttclid) {
      platform = 'tiktok';
    } else if (fbclid) {
      platform = 'facebook';
    } else {
      const rawSrc = (req.query.utm_source || '').toLowerCase();
      if (rawSrc.includes('tiktok') || rawSrc.includes('tt')) platform = 'tiktok';
      else if (rawSrc.includes('face') || rawSrc.includes('meta') || rawSrc.includes('insta')) platform = 'facebook';
    }

    const utm_source = req.query.utm_source || platform;
    const utm_medium = req.query.utm_medium || req.query.tt_medium || null;
    const utm_campaign = req.query.utm_campaign || campaign.nome || null;
    const utm_content = req.query.utm_content || null;
    const utm_term = req.query.utm_term || null;

    // Captura IP e User-Agent do lead para mǭxima precisǜo no TikTok CAPI
    const clientIp = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.headers['x-real-ip'] || req.socket?.remoteAddress || null;
    const userAgent = req.headers['user-agent'] || null;

    // Captura cookie _ttp do TikTok se presente no request
    let ttp = req.query.ttp || req.query._ttp || null;
    if (!ttp && req.headers.cookie) {
      const match = req.headers.cookie.match(/_ttp=([^;]+)/);
      if (match) ttp = decodeURIComponent(match[1]);
    }

    // Gera código único curto de 6 caracteres alfanuméricos sem ambiguidade
    const codigo = db.generateUniqueAttributionCode();

    // Salva registro na tabela de atribuições com validade de 48h e plataforma identificada
    db.addTrafficAttribution({
      codigo,
      platform,
      host: cleanHost,
      dominio_customizado_id: customDomainRecord?.id || null,
      dominio_customizado: customDomainRecord?.dominio || null,
      ttclid,
      fbclid,
      ttp,
      ip: clientIp,
      user_agent: userAgent,
      utm_source,
      utm_medium,
      utm_campaign,
      utm_content,
      utm_term,
      campanha_id: campaign.id,
      campanha_nome: campaign.nome || campaign.name,
      pressel_url: campaign.url_destino || campaign.presell_url || ''
    });

    console.log(`[Universal Campaign Attribution] 🚀 Clique registrado (${platform.toUpperCase()}) na campanha "${campaign.nome || campaign.name}" (${slug}) | Código: ${codigo} | ttclid: ${ttclid || '-'} | fbclid: ${fbclid || '-'}`);

    // Monta a mensagem e a URL do WhatsApp de destino
    const rawMsg = campaign.mensagem_template || campaign.message_template || 'Oii vim pelo anúncio (código {codigo})';
    const renderedMsg = rawMsg.replace(/\{codigo\}/gi, codigo);
    const rawNumber = String(campaign.whatsapp_destino || campaign.whatsapp_number || '5511999998888').replace(/\D/g, '');
    const cleanNumber = rawNumber.startsWith('55') ? rawNumber : (rawNumber ? '55' + rawNumber : '5511999998888');
    const whatsappUrl = `https://wa.me/${cleanNumber}?text=${encodeURIComponent(renderedMsg)}`;

    // Se o usuário configurou uma pressel externa personalizada explícita (e diferente do placeholder padrão)
    const customPresell = (campaign.url_destino || campaign.presell_url || '').trim();
    if (customPresell && customPresell !== 'https://minhapressel.com' && !customPresell.includes('minhapressel.com')) {
      let destUrl;
      try {
        destUrl = new URL(customPresell);
        destUrl.searchParams.set('codigo', codigo);
        destUrl.searchParams.set('platform', platform);
        if (ttclid) destUrl.searchParams.set('ttclid', ttclid);
        if (fbclid) destUrl.searchParams.set('fbclid', fbclid);
        if (ttp) destUrl.searchParams.set('ttp', ttp);
        if (utm_source) destUrl.searchParams.set('utm_source', utm_source);
        if (utm_medium) destUrl.searchParams.set('utm_medium', utm_medium);
        if (utm_campaign) destUrl.searchParams.set('utm_campaign', utm_campaign);
        if (utm_content) destUrl.searchParams.set('utm_content', utm_content);
        if (utm_term) destUrl.searchParams.set('utm_term', utm_term);
        destUrl.searchParams.set('wa', cleanNumber);
        destUrl.searchParams.set('text', renderedMsg);
        return res.redirect(302, destUrl.toString());
      } catch (e) {}
    }

    // =========================================================================
    // PRESSEL PRÓPRIA ULTRA-RÁPIDA (INTEGRADA AO SISTEMA)
    // Redireciona para o WhatsApp em ~300ms com disparo de Pixel nativo
    // =========================================================================

    // Busca pixels configurados para acionar PageView client-side e garantir os cookies _ttp e _fbp
    const tiktokPixels = (db.getTikTokPixels && db.getTikTokPixels()) || [];
    const metaPixels = (db.getPixels && db.getPixels()) || [];

    const ttPixelScripts = tiktokPixels.map(p => `
      try {
        !function (w, d, t) {
          w.TiktokAnalyticsObject=t;var ttq=w[t]=w[t]||[];ttq.methods=["page","track","identify","instances","debug","on","off","once","ready","alias","group","enableCookie","disableCookie"],ttq.setAndDefer=function(t,e){t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}};for(var i=0;i<ttq.methods.length;i++)ttq.setAndDefer(ttq,ttq.methods[i]);ttq.instance=function(t){for(var e=ttq._i[t]||[],n=0;n<ttq.methods.length;n++)ttq.setAndDefer(e,ttq.methods[n]);return e},ttq.load=function(e,n){var i="https://analytics.tiktok.com/i18n/pixel/events.js";ttq._i=ttq._i||{},ttq._i[e]=[],ttq._i[e]._u=i,ttq._t=ttq._t||{},ttq._t[e]=+new Date,ttq._o=ttq._o||{},ttq._o[e]=n||{};var o=document.createElement("script");o.type="text/javascript",o.async=!0,o.src=i+"?sdkid="+e+"&lib="+t;var a=document.getElementsByTagName("script")[0];a.parentNode.insertBefore(o,a)};
          ttq.load('${p.pixel_code || p.id}');
          ttq.page();
        }(window, document, 'ttq');
      } catch(e){}
    `).join('\n');

    const metaPixelScripts = metaPixels.map(p => `
      try {
        !function(f,b,e,v,n,t,s)
        {if(f.fbq)return;n=f.fbq=function(){n.callMethod?
        n.callMethod.apply(n,arguments):n.queue.push(arguments)};
        if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
        n.queue=[];t=b.createElement(e);t.async=!0;
        t.src=v;s=b.getElementsByTagName(e)[0];
        s.parentNode.insertBefore(t,s)}(window, document,'script',
        'https://connect.facebook.net/en_US/fbevents.js');
        fbq('init', '${p.pixel_id || p.id}');
        fbq('track', 'PageView');
      } catch(e){}
    `).join('\n');

        // Determina o idioma da pressel (ES ou PT)
    const rawLang = String(campaign.idioma || campaign.language || '').toLowerCase().trim();
    const isSpanish = rawLang === 'es' || (!rawLang && (
      (campaign.mensagem_template || '').toLowerCase().includes('hola') ||
      (campaign.mensagem_template || '').toLowerCase().includes('espiar') ||
      (campaign.mensagem_template || '').toLowerCase().includes('borres')
    ));

    const langCode = isSpanish ? 'es' : 'pt-BR';
    const titleText = isSpanish ? 'Redirigiendo a WhatsApp...' : 'Redirecionando para o WhatsApp...';
    const statusMsg = isSpanish 
      ? 'Aguarde, usted será redirigido a WhatsApp...' 
      : 'Aguarde, você será redirecionado para o WhatsApp...';
    const fallbackText = isSpanish 
      ? 'Haga clic aquí si no es redirigido automáticamente' 
      : 'Clique aqui caso não seja redirecionado automaticamente';

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.send(`<!DOCTYPE html>
<html lang="${langCode}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>${titleText}</title>
  <meta name="theme-color" content="#0a0a0f">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: #0a0a0f;
      color: #ffffff;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      margin: 0;
      padding: 20px;
      overflow: hidden;
      user-select: none;
    }
    .splash-container {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      text-align: center;
      max-width: 380px;
      width: 100%;
    }
    .logo-wrapper {
      position: relative;
      width: 76px;
      height: 76px;
      margin-bottom: 24px;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .pulse-ring {
      position: absolute;
      inset: -8px;
      border-radius: 50%;
      border: 2px solid rgba(37, 211, 102, 0.4);
      animation: ripple 1.4s infinite cubic-bezier(0.25, 1, 0.5, 1);
    }
    .wa-circle {
      width: 64px;
      height: 64px;
      background: linear-gradient(135deg, #25d366 0%, #128c7e 100%);
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 8px 24px rgba(37, 211, 102, 0.4);
    }
    .wa-circle svg {
      width: 34px;
      height: 34px;
      fill: #ffffff;
    }
    .status-msg {
      font-size: 15px;
      font-weight: 500;
      color: #f1f5f9;
      margin-bottom: 20px;
      letter-spacing: -0.2px;
    }
    .spinner-bar {
      width: 140px;
      height: 3px;
      background: rgba(255, 255, 255, 0.1);
      border-radius: 3px;
      overflow: hidden;
      position: relative;
      margin-bottom: 24px;
    }
    .spinner-bar::after {
      content: '';
      position: absolute;
      left: -50%;
      height: 100%;
      width: 50%;
      background: linear-gradient(90deg, #25d366, #25f4ee);
      border-radius: 3px;
      animation: indeterminate 0.8s infinite linear;
    }
    .fallback-link {
      font-size: 12px;
      color: #64748b;
      text-decoration: none;
      transition: color 0.2s;
    }
    .fallback-link:hover {
      color: #94a3b8;
      text-decoration: underline;
    }
    @keyframes ripple {
      0% { transform: scale(0.9); opacity: 0.8; }
      100% { transform: scale(1.3); opacity: 0; }
    }
    @keyframes indeterminate {
      0% { left: -50%; width: 50%; }
      50% { left: 25%; width: 60%; }
      100% { left: 100%; width: 50%; }
    }
  </style>
  <script>
    ${ttPixelScripts}
    ${metaPixelScripts}
  </script>
</head>
<body>
  <div class="splash-container">
    <div class="logo-wrapper">
      <div class="pulse-ring"></div>
      <div class="wa-circle">
        <svg viewBox="0 0 24 24">
          <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91C2.13 13.66 2.59 15.36 3.45 16.86L2.05 22L7.3 20.62C8.75 21.41 10.38 21.83 12.04 21.83C17.5 21.83 21.95 17.38 21.95 11.92C21.95 9.27 20.92 6.78 19.05 4.91C17.18 3.04 14.69 2 12.04 2M12.05 3.67C14.25 3.67 16.31 4.53 17.87 6.09C19.42 7.65 20.28 9.72 20.28 11.92C20.28 16.46 16.58 20.15 12.04 20.15C10.56 20.15 9.11 19.76 7.85 19L7.55 18.83L4.43 19.65L5.26 16.61L5.06 16.29C4.24 15 3.8 13.47 3.8 11.91C3.81 7.37 7.5 3.67 12.05 3.67Z"/>
        </svg>
      </div>
    </div>
    <div class="status-msg">${statusMsg}</div>
    <div class="spinner-bar"></div>
    <a id="btn-redirect" href="${whatsappUrl}" class="fallback-link">${fallbackText}</a>
  </div>

  <script>
    const target = "${whatsappUrl}";
    // Redirecionamento automático ultra-rápido (300ms para permitir execução do pixel)
    setTimeout(function() {
      try {
        window.location.replace(target);
      } catch (e) {
        window.location.href = target;
      }
    }, 300);
  </script>
</body>
</html>`);

  } catch (err) {
    console.error('[Campaign Attribution Error] Falha no redirect:', err);
    return res.redirect(302, 'https://wa.me/');
  }
});

module.exports = router;
