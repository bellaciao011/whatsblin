const express = require('express');
const router = express.Router();
const db = require('../storage/db');

/**
 * Endpoint de entrada de anúncios TikTok Ads: /c/:slug
 * Captura ttclid, utms, cookie _ttp, gera código único de 6 dígitos e redireciona (302) para a pressel
 */
router.get('/:slug', (req, res) => {
  try {
    const slug = req.params.slug;
    const campaigns = db.getTrafficCampaigns();
    let campaign = campaigns.find(c => c.slug === slug || c.id === slug);

    // Se a campanha não existir explicitamente, cria uma sob demanda para nunca perder tráfego
    if (!campaign) {
      campaign = db.addTrafficCampaign({
        nome: `Campanha TikTok (${slug})`,
        slug: slug,
        url_destino: 'https://minhapressel.com',
        mensagem_template: 'Oii vim pelo TikTok (código {codigo})'
      });
    }

    // Incrementa cliques da campanha
    campaign.total_cliques = (campaign.total_cliques || 0) + 1;
    db.saveTrafficCampaigns(campaigns);

    // Captura parâmetros de rastreamento do TikTok Ads
    const ttclid = req.query.ttclid || req.query.tt_clid || null;
    const utm_source = req.query.utm_source || 'tiktok';
    const utm_medium = req.query.utm_medium || req.query.tt_medium || null;
    const utm_campaign = req.query.utm_campaign || campaign.nome || null;
    const utm_content = req.query.utm_content || null;
    const utm_term = req.query.utm_term || null;

    // Captura cookie _ttp do TikTok se presente no request
    let ttp = req.query.ttp || req.query._ttp || null;
    if (!ttp && req.headers.cookie) {
      const match = req.headers.cookie.match(/_ttp=([^;]+)/);
      if (match) ttp = decodeURIComponent(match[1]);
    }

    // Gera código único curto de 6 caracteres alfanuméricos sem ambiguidade
    const codigo = db.generateUniqueAttributionCode();

    // Salva registro na tabela de atribuições com validade de 48h
    db.addTrafficAttribution({
      codigo,
      ttclid,
      ttp,
      utm_source,
      utm_medium,
      utm_campaign,
      utm_content,
      utm_term,
      campanha_id: campaign.id,
      campanha_nome: campaign.nome || campaign.name,
      pressel_url: campaign.url_destino || campaign.presell_url
    });

    console.log(`[TikTok Attribution] 🚀 Clique registrado na campanha "${campaign.nome || campaign.name}" (${slug}) | Código gerado: ${codigo} | ttclid: ${ttclid || 'nenhum'}`);

    // Monta a URL de destino da pressel preservando e adicionando o código
    const targetUrl = campaign.url_destino || campaign.presell_url || 'https://minhapressel.com';
    let destUrl;
    try {
      destUrl = new URL(targetUrl);
    } catch (e) {
      destUrl = new URL('https://minhapressel.com');
    }

    // Adiciona o código gerado como parâmetro principal da pressel
    destUrl.searchParams.set('codigo', codigo);
    if (ttclid) destUrl.searchParams.set('ttclid', ttclid);
    if (ttp) destUrl.searchParams.set('ttp', ttp);
    if (utm_source) destUrl.searchParams.set('utm_source', utm_source);
    if (utm_medium) destUrl.searchParams.set('utm_medium', utm_medium);
    if (utm_campaign) destUrl.searchParams.set('utm_campaign', utm_campaign);
    if (utm_content) destUrl.searchParams.set('utm_content', utm_content);
    if (utm_term) destUrl.searchParams.set('utm_term', utm_term);

    // Se houver número de WhatsApp ou template configurado, passa para a pressel poder montar o link
    if (campaign.whatsapp_destino) {
      destUrl.searchParams.set('wa', campaign.whatsapp_destino.replace(/\D/g, ''));
    }
    if (campaign.mensagem_template) {
      const renderedMsg = campaign.mensagem_template.replace(/\{codigo\}/gi, codigo);
      destUrl.searchParams.set('text', renderedMsg);
    }

    // Redireciona (302) para a pressel
    return res.redirect(302, destUrl.toString());
  } catch (err) {
    console.error('[TikTok Attribution Error] Falha no redirect:', err);
    return res.redirect(302, 'https://minhapressel.com');
  }
});

module.exports = router;
