const assert = require('assert');
const axios = require('axios');
const authService = require('../server/services/authService');
const db = require('../server/storage/db');
const cryptoService = require('../server/services/cryptoService');
const uazapiService = require('../server/services/uazapiService');
const { processIncomingMessage } = require('../server/services/flowEngine');

async function testFullFlow() {
  console.log('==================================================');
  console.log('🚀 TESTANDO FLUXO COMPLETO DA INTEGRAÇÃO UAZAPI');
  console.log('==================================================');

  const token = authService.generateToken('admin');
  const client = axios.create({
    baseURL: 'http://localhost:3000',
    headers: { Authorization: `Bearer ${token}` }
  });

  // 1. Teste de erro amigável quando falta admintoken
  console.log('\n[Etapa 1] Testando validação de ausência de admintoken...');
  try {
    await client.post('/api/uazapi/init-connect', {
      name: 'Chip Teste 1',
      serverUrl: 'https://free.uazapi.com'
    });
    assert.fail('Deveria ter retornado 400 por falta de admintoken');
  } catch (err) {
    assert.strictEqual(err.response?.status, 400);
    assert(err.response?.data?.error.includes('admintoken'), 'Erro deve mencionar admintoken');
    console.log('✓ Erro tratado perfeitamente com mensagem amigável:', err.response?.data?.error);
  }

  // 2. Teste de validação quando chave existente é informada mas é inválida (401 da uazapi)
  console.log('\n[Etapa 2] Testando validação de chave inválida na uazapi (401)...');
  try {
    await client.post('/api/uazapi/init-connect', {
      name: 'Chip Teste Chave Falsa',
      serverUrl: 'https://free.uazapi.com',
      instanceKey: 'chave_inexistente_9999'
    });
    assert.fail('Deveria ter retornado 401 por chave inválida');
  } catch (err) {
    assert.strictEqual(err.response?.status, 401);
    assert(err.response?.data?.error.includes('Token inválido ou expirado'), 'Deve conter mensagem 401 legível');
    console.log('✓ Erro 401 traduzido para mensagem amigável no modal:', err.response?.data?.error);
  }

  // 3. Simulação de Instância e Validação de Status Real com uazapi
  console.log('\n[Etapa 3] Validando chamada de status real para uazapi...');
  const testInstanceId = 'uaz_inst_mock_flow_123';
  const instanceSecret = 'secret_token_12345678';

  const mockInstance = {
    id: testInstanceId,
    name: 'Atendimento uazapi Vendas',
    tipo: 'uazapi',
    url_servidor: 'https://free.uazapi.com',
    instance_id: 'mock_uazapi_id_777',
    instance_token: cryptoService.encrypt(instanceSecret),
    phoneNumber: '5511999881122',
    numero_conectado: '5511999881122',
    status: 'connected',
    assignedFlowId: 'fluxo-espiao-foto',
    createdAt: new Date().toISOString()
  };

  db.saveInstance(mockInstance);

  // Consulta status via API protegida do SaaS (espera-se 401 pois o token é fictício no servidor real)
  try {
    await client.get(`/api/uazapi/status/${testInstanceId}`);
  } catch (err) {
    assert.strictEqual(err.response?.status, 401);
    assert(err.response?.data?.error.includes('Token inválido ou expirado'), 'Deve capturar erro da uazapi');
    console.log('✓ Endpoint /api/uazapi/status/:id comunicou com o servidor uazapi real e retornou erro 401 tratado!');
  }

  // 4. Teste de Recebimento de Webhook de Lead e Disparo do Funil
  console.log('\n[Etapa 4] Enviando Webhook de Lead para /api/webhooks/uazapi...');
  const leadPhone = '5511988889999';
  const webhookRes = await axios.post('http://localhost:3000/api/webhooks/uazapi', {
    event: 'messages',
    instance: 'mock_uazapi_id_777',
    data: {
      chatid: `${leadPhone}@s.whatsapp.net`,
      text: 'Olá, gostaria de saber como funciona',
      fromMe: false,
      isGroup: false,
      wasSentByApi: false
    }
  });

  assert.strictEqual(webhookRes.status, 200);
  assert.strictEqual(webhookRes.data.received, true);
  console.log('✓ Webhook uazapi respondeu 200 { received: true }');

  // Aguarda processamento assíncrono do funil
  await new Promise(r => setTimeout(r, 600));

  // Verifica se o lead foi cadastrado no banco de chats com o instanceId da uazapi
  const chats = db.getChats();
  const leadChat = chats[leadPhone];
  assert(leadChat !== undefined, 'Lead deve estar cadastrado no banco de chats');
  assert.strictEqual(leadChat.instanceId, testInstanceId, 'Mensagem deve estar vinculada à instância uazapi');
  assert(leadChat.messages.length > 0, 'Deve conter histórico de mensagens');
  console.log('✓ Lead registrado no banco e processado pelo fluxo!');
  console.log('Mensagens do chat:', leadChat.messages.map(m => `[${m.from}]: ${m.text.slice(0, 40)}...`));

  // 5. Teste de Envio via Chat Live para Instância uazapi
  console.log('\n[Etapa 5] Testando endpoint /api/chats/:phone/send para instância uazapi...');
  const sendRes = await client.post(`/api/chats/${leadPhone}/send`, {
    text: 'Resposta manual do atendente para o lead uazapi'
  });
  assert(sendRes.data.success, 'Envio manual deve ter sucesso');
  console.log('✓ Mensagem manual enviada com sucesso para conexão uazapi!');

  // 6. Teste de Listagem Segura de Instâncias (Tokens Mascarados)
  console.log('\n[Etapa 6] Testando /api/instances (Mascaração de Segredos)...');
  const instancesRes = await client.get('/api/instances');
  const foundInst = instancesRes.data.find(i => i.id === testInstanceId);
  assert(foundInst !== undefined);
  assert.strictEqual(foundInst.instance_token, '••••••••', 'Token deve estar mascarado para segurança no frontend');
  console.log('✓ Tokens de instância mascarados com sucesso no GET /api/instances!');

  // 7. Teste de Exclusão da Instância
  console.log('\n[Etapa 7] Testando exclusão /api/instances/:id...');
  const deleteRes = await client.delete(`/api/instances/${testInstanceId}`);
  assert(deleteRes.data.success);
  assert(db.getInstance(testInstanceId) === null, 'Instância deve ser removida do banco');
  console.log('✓ Instância excluída e limpa com sucesso!');

  console.log('\n==================================================');
  console.log('🎉 TODOS OS TESTES END-TO-END FORAM CONCLUÍDOS!');
  console.log('==================================================');
}

testFullFlow().catch(err => {
  console.error('❌ Falha nos testes e2e:', err);
  process.exit(1);
});
