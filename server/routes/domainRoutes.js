const express = require('express');
const router = express.Router();
const db = require('../storage/db');
const railwayService = require('../services/railwayService');

/**
 * GET /api/dominios
 * Lista todos os domínios customizados cadastrados
 */
router.get('/', (req, res) => {
  try {
    const domains = db.getCustomDomains();
    const creds = railwayService.getRailwayCredentials();

    res.json({
      success: true,
      domains,
      railwayConfig: {
        isConfigured: creds.isConfigured,
        hasToken: !!creds.apiToken,
        projectId: creds.projectId ? `${creds.projectId.substring(0, 8)}...` : '',
        environmentId: creds.environmentId ? `${creds.environmentId.substring(0, 8)}...` : '',
        serviceId: creds.serviceId ? `${creds.serviceId.substring(0, 8)}...` : ''
      }
    });
  } catch (err) {
    console.error('[Domain API Error]', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/dominios/criar
 * Cria e registra um novo domínio customizado via API do Railway
 */
router.post('/criar', async (req, res) => {
  try {
    const rawDomain = req.body.dominio || req.body.domain;
    if (!rawDomain) {
      return res.status(400).json({ success: false, error: 'O nome do domínio é obrigatório (ex: promo123.com ou ir.meudominio.com)' });
    }

    const cleanDomain = String(rawDomain)
      .toLowerCase()
      .trim()
      .replace(/^https?:\/\//, '')
      .replace(/\/.*$/, '')
      .replace(/:\d+$/, '');

    // Verifica se o domínio já está cadastrado
    const existing = db.getCustomDomainByHostname(cleanDomain);
    if (existing) {
      return res.status(400).json({
        success: false,
        error: `O domínio "${cleanDomain}" já está cadastrado no sistema (Status: ${existing.status}).`
      });
    }

    // Provisiona o domínio no Railway via GraphQL
    const railwayResult = await railwayService.createCustomDomain(cleanDomain);

    // Salva no banco de dados local
    const newDomainRecord = db.addCustomDomain({
      dominio: cleanDomain,
      cname_target: railwayResult.cname_target,
      railway_domain_id: railwayResult.railwayDomainId,
      status: 'pendente',
      ativo: true,
      account_id: req.user?.id || 'acc_admin_default'
    });

    res.json({
      success: true,
      domain: newDomainRecord,
      cname_target: railwayResult.cname_target,
      subdomain: railwayResult.subdomain,
      instruction: railwayResult.instruction,
      isMock: railwayResult.isMock
    });
  } catch (err) {
    console.error('[Create Domain Error]', err);
    res.status(400).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/dominios/:id/status
 * Consulta status atual do domínio no Railway e atualiza no banco
 */
router.get('/:id/status', async (req, res) => {
  try {
    const domainId = req.params.id;
    const domain = db.getCustomDomainById(domainId);

    if (!domain) {
      return res.status(404).json({ success: false, error: 'Domínio não encontrado' });
    }

    // Consulta API do Railway
    const statusResult = await railwayService.checkCustomDomainStatus(domain.railway_domain_id, domain.dominio);

    // Se o Railway confirmou que está ISSUED ou verified, atualiza status para 'ativo'
    let updatedStatus = domain.status;
    if (statusResult.status === 'ativo' || statusResult.certificateStatus === 'ISSUED' || statusResult.verified === true) {
      updatedStatus = 'ativo';
      db.updateCustomDomain(domain.id, { status: 'ativo' });
      console.log(`[Domain API] ✓ Domínio ${domain.dominio} agora está ATIVO e verificado no Railway!`);
    }

    res.json({
      success: true,
      id: domain.id,
      dominio: domain.dominio,
      status: updatedStatus,
      ativo: domain.ativo,
      cname_target: domain.cname_target,
      certificateStatus: statusResult.certificateStatus || 'PENDING',
      verified: statusResult.verified || false,
      isMock: statusResult.isMock || false
    });
  } catch (err) {
    console.error('[Domain Status Error]', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * DELETE /api/dominios/:id
 * Remove o domínio do Railway e exclui do sistema
 */
router.delete('/:id', async (req, res) => {
  try {
    const domainId = req.params.id;
    const domain = db.getCustomDomainById(domainId);

    if (!domain) {
      return res.status(404).json({ success: false, error: 'Domínio não encontrado' });
    }

    // Remove no Railway via API
    await railwayService.deleteCustomDomain(domain.railway_domain_id);

    // Deleta localmente
    db.deleteCustomDomain(domain.id);

    console.log(`[Domain API] 🗑️ Domínio ${domain.dominio} removido com sucesso.`);
    res.json({ success: true, message: `Domínio ${domain.dominio} removido com sucesso.` });
  } catch (err) {
    console.error('[Delete Domain Error]', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * PATCH /api/dominios/:id/toggle-ativo
 * Alterna entre ativo/inativo (para aposentar domínios queimados mantendo histórico de leads)
 */
router.patch('/:id/toggle-ativo', (req, res) => {
  try {
    const domainId = req.params.id;
    const domain = db.getCustomDomainById(domainId);

    if (!domain) {
      return res.status(404).json({ success: false, error: 'Domínio não encontrado' });
    }

    const newAtivo = !domain.ativo;
    const updated = db.updateCustomDomain(domain.id, { ativo: newAtivo });

    console.log(`[Domain API] Domínio ${domain.dominio} alterado para: ${newAtivo ? 'ATIVO' : 'DESATIVADO / APOSENTADO'}`);
    res.json({ success: true, domain: updated });
  } catch (err) {
    console.error('[Toggle Domain Active Error]', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/dominios/config
 * Permite salvar as credenciais do Railway diretamente no painel
 */
router.post('/config', (req, res) => {
  try {
    const { apiToken, projectId, environmentId, serviceId } = req.body;
    const settings = db.getSettings() || {};

    if (!settings.railway) settings.railway = {};
    if (apiToken !== undefined) settings.railway.apiToken = String(apiToken).trim();
    if (projectId !== undefined) settings.railway.projectId = String(projectId).trim();
    if (environmentId !== undefined) settings.railway.environmentId = String(environmentId).trim();
    if (serviceId !== undefined) settings.railway.serviceId = String(serviceId).trim();

    db.saveSettings(settings);

    res.json({
      success: true,
      message: 'Credenciais do Railway atualizadas com sucesso!',
      railwayConfig: {
        isConfigured: !!(settings.railway.apiToken && settings.railway.environmentId && settings.railway.serviceId),
        hasToken: !!settings.railway.apiToken
      }
    });
  } catch (err) {
    console.error('[Railway Config Error]', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
