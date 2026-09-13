const axios = require('axios');
const db = require('../storage/db');

const RAILWAY_GRAPHQL_ENDPOINT = 'https://backboard.railway.app/graphql/v2';

/**
 * Obtém as credenciais da API do Railway.
 * Prioriza variáveis de ambiente nativas (injetadas pelo Railway),
 * com fallback para as configurações salvas em settings.json.
 */
function getRailwayCredentials() {
  const settings = db.getSettings() || {};
  const railwayConfig = settings.railway || {};

  const apiToken = process.env.RAILWAY_API_TOKEN || railwayConfig.apiToken || '';
  const projectId = process.env.RAILWAY_PROJECT_ID || railwayConfig.projectId || '';
  const environmentId = process.env.RAILWAY_ENVIRONMENT_ID || railwayConfig.environmentId || '';
  const serviceId = process.env.RAILWAY_SERVICE_ID || railwayConfig.serviceId || '';

  return {
    apiToken: apiToken.trim(),
    projectId: projectId.trim(),
    environmentId: environmentId.trim(),
    serviceId: serviceId.trim(),
    isConfigured: !!(apiToken && environmentId && serviceId)
  };
}

/**
 * Executa uma query ou mutation GraphQL na API v2 do Railway
 */
async function executeRailwayQuery(query, variables = {}) {
  const creds = getRailwayCredentials();

  if (!creds.apiToken) {
    throw new Error('RAILWAY_API_TOKEN não configurado. Defina a variável de ambiente RAILWAY_API_TOKEN.');
  }

  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${creds.apiToken}`
  };

  const response = await axios.post(
    RAILWAY_GRAPHQL_ENDPOINT,
    { query, variables },
    { headers, timeout: 15000 }
  );

  if (response.data.errors && response.data.errors.length > 0) {
    const errorMsg = response.data.errors.map(e => e.message).join(' | ');
    throw new Error(`Erro API Railway: ${errorMsg}`);
  }

  return response.data.data;
}

/**
 * Extrai nome de host/subdomínio para apontamento DNS
 * Ex: 'ir.promo123.com' -> 'ir'
 * Ex: 'promo123.com' -> '@' ou nome do domínio
 */
function parseHostSubdomain(domain) {
  const parts = domain.split('.');
  if (parts.length > 2) {
    return parts.slice(0, parts.length - 2).join('.');
  }
  return '@';
}

/**
 * 1. Cria um domínio customizado no serviço do Railway
 */
async function createCustomDomain(rawDomain) {
  const cleanDomain = String(rawDomain || '')
    .toLowerCase()
    .trim()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '')
    .replace(/:\d+$/, '');

  // Validação preventiva de formato de domínio
  const domainRegex = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/;
  if (!cleanDomain || !domainRegex.test(cleanDomain)) {
    throw new Error(`Formato de domínio inválido: "${cleanDomain}". Exemplo: promo123.com ou ir.meudominio.com`);
  }

  const creds = getRailwayCredentials();

  // Caso as credenciais reais da API estejam configuradas, chama o Railway GraphQL v2
  if (creds.isConfigured) {
    console.log(`[Railway API] Criando domínio customizado "${cleanDomain}" no serviço ${creds.serviceId}...`);

    const mutation = `
      mutation CustomDomainCreate($input: CustomDomainCreateInput!) {
        customDomainCreate(input: $input) {
          id
          domain
          status {
            certificateStatus
            certificateStatusDetailed
            verified
            dnsRecords {
              hostlabel
              recordType
              requiredValue
              status
            }
          }
        }
      }
    `;

    const variables = {
      input: {
        domain: cleanDomain,
        environmentId: creds.environmentId,
        serviceId: creds.serviceId
      }
    };

    const data = await executeRailwayQuery(mutation, variables);
    const created = data?.customDomainCreate;

    if (!created) {
      throw new Error('A API do Railway não retornou os dados do domínio criado.');
    }

    // Busca o CNAME target retornado pela API
    const dnsRecords = created.status?.dnsRecords || [];
    const cnameRecord = dnsRecords.find(r => r.recordType === 'CNAME') || dnsRecords[0];
    const cnameTarget = cnameRecord?.requiredValue || `${creds.serviceId}.up.railway.app`;

    const sub = parseHostSubdomain(cleanDomain);
    const instruction = `Crie um registro CNAME com Nome: ${sub} e Valor: ${cnameTarget} no seu provedor de DNS (Cloudflare, Namecheap, GoDaddy etc).`;

    return {
      success: true,
      railwayDomainId: created.id,
      dominio: created.domain,
      cname_target: cnameTarget,
      certificateStatus: created.status?.certificateStatus || 'PENDING',
      verified: created.status?.verified || false,
      instruction,
      subdomain: sub,
      isMock: false
    };
  }

  // Fallback para ambiente local de desenvolvimento ou antes de inserir token:
  // Gera target padrão esperado pelo Railway para não travar testes de interface
  console.warn('[Railway API] Credenciais do Railway não configuradas. Operando em modo de simulação (Mock).');
  const mockTarget = `${creds.serviceId || 'app'}.up.railway.app`;
  const sub = parseHostSubdomain(cleanDomain);
  const instruction = `Crie um registro CNAME com Nome: ${sub} e Valor: ${mockTarget} no seu provedor de DNS.`;

  return {
    success: true,
    railwayDomainId: `r_mock_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    dominio: cleanDomain,
    cname_target: mockTarget,
    certificateStatus: 'PENDING',
    verified: false,
    instruction,
    subdomain: sub,
    isMock: true
  };
}

/**
 * 2. Consulta o status do domínio na API do Railway
 */
async function checkCustomDomainStatus(railwayDomainId, domainName) {
  const creds = getRailwayCredentials();

  if (creds.isConfigured && railwayDomainId && !railwayDomainId.startsWith('r_mock_')) {
    try {
      const query = `
        query GetCustomDomain($id: String!, $projectId: String!) {
          customDomain(id: $id, projectId: $projectId) {
            id
            domain
            status {
              certificateStatus
              certificateStatusDetailed
              verified
              dnsRecords {
                hostlabel
                recordType
                requiredValue
                status
              }
            }
          }
        }
      `;

      const variables = {
        id: railwayDomainId,
        projectId: creds.projectId
      };

      const data = await executeRailwayQuery(query, variables);
      const domainObj = data?.customDomain;

      if (domainObj && domainObj.status) {
        const certStatus = domainObj.status.certificateStatus;
        const isVerified = domainObj.status.verified;
        const isIssued = certStatus === 'ISSUED' || isVerified === true;

        return {
          success: true,
          status: isIssued ? 'ativo' : 'pendente',
          certificateStatus: certStatus,
          verified: isVerified,
          dnsRecords: domainObj.status.dnsRecords || []
        };
      }
    } catch (err) {
      console.warn(`[Railway API] Erro ao consultar status do domínio (${railwayDomainId}):`, err.message);
      return {
        success: false,
        error: err.message,
        status: 'pendente'
      };
    }
  }

  // Se for simulação ou sem token
  return {
    success: true,
    status: 'pendente',
    certificateStatus: 'PENDING',
    verified: false,
    isMock: true
  };
}

/**
 * 3. Deleta um domínio customizado no Railway
 */
async function deleteCustomDomain(railwayDomainId) {
  const creds = getRailwayCredentials();

  if (creds.isConfigured && railwayDomainId && !railwayDomainId.startsWith('r_mock_')) {
    try {
      console.log(`[Railway API] Deletando domínio ${railwayDomainId} no Railway...`);
      const mutation = `
        mutation CustomDomainDelete($id: String!) {
          customDomainDelete(id: $id)
        }
      `;
      const data = await executeRailwayQuery(mutation, { id: railwayDomainId });
      return { success: true, deleted: data?.customDomainDelete };
    } catch (err) {
      console.warn(`[Railway API] Erro ao deletar domínio no Railway (${railwayDomainId}):`, err.message);
      return { success: false, error: err.message };
    }
  }

  return { success: true, deleted: true, isMock: true };
}

module.exports = {
  getRailwayCredentials,
  createCustomDomain,
  checkCustomDomainStatus,
  deleteCustomDomain,
  parseHostSubdomain
};
