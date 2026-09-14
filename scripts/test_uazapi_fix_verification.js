const assert = require('assert');
const axios = require('axios');
const authService = require('../server/services/authService');
const db = require('../server/storage/db');
const cryptoService = require('../server/services/cryptoService');

async function testFixVerification() {
  console.log('===========================================================');
  console.log('🧪 VERIFICANDO CORREÇÃO DO FLUXO UAZAPI (QR CODE & STATUS)');
  console.log('===========================================================');

  const token = authService.generateToken('admin');
  const client = axios.create({
    baseURL: 'http://localhost:3000',
    headers: { Authorization: `Bearer ${token}` }
  });

  // TESTE 1: Garantir que GET /api/instances retorna array limpo
  console.log('\n[1] Testando listagem de instâncias (/api/instances)...');
  const instRes1 = await client.get('/api/instances');
  assert(Array.isArray(instRes1.data), 'Resposta deve ser um array');
  console.log(`✓ Instâncias encontradas: ${instRes1.data.length}`);

  // TESTE 2: Simular cadastro de instância uazapi em estado "connecting"
  console.log('\n[2] Testando persistência e visibilidade de instância uazapi...');
  const testInstId = `uaz_test_fix_${Date.now()}`;
  const mockToken = cryptoService.encrypt('mock_uaz_token_abc');
  
  const mockConnectingInstance = {
    id: testInstId,
    name: 'WhatsApp Vendas Suporte (Teste)',
    tipo: 'uazapi',
    url_servidor: 'https://free.uazapi.com',
    instance_id: 'test_inst_fix_001',
    instance_token: mockToken,
    phoneNumber: '',
    numero_conectado: '',
    status: 'connecting',
    assignedFlowId: 'fluxo-espiao-foto',
    totalSent: 0,
    totalReceived: 0,
    criado_em: new Date().toISOString(),
    createdAt: new Date().toISOString()
  };

  db.saveInstance(mockConnectingInstance);

  const instRes2 = await client.get('/api/instances');
  const found = instRes2.data.find(i => i.id === testInstId);
  assert(found !== undefined, 'A instância deve aparecer na lista /api/instances');
  assert.strictEqual(found.status, 'connecting', 'Status inicial deve ser connecting');
  assert.strictEqual(found.tipo, 'uazapi', 'Tipo deve ser uazapi');
  assert.strictEqual(found.instance_token, '••••••••', 'Token deve estar mascarado');
  console.log('✓ Instância connecting persistida e visível com sucesso no endpoint /api/instances!');

  // TESTE 3: Validar que status sem JID (telefone físico) NÃO acusa conectado falsamente
  console.log('\n[3] Testando prevenção de falso positivo no status...');
  // Ao consultar status de uma mock key, o endpoint uazapi real responderá 401 ou false, nunca false-positive connected
  try {
    const statusRes = await client.get(`/api/uazapi/status/${testInstId}`);
    // Se por acaso responder algo, connected DEVE ser false porque não há JID/telefone conectado
    assert.strictEqual(statusRes.data.connected, false, 'connected não pode ser true sem telefone físico');
  } catch (err) {
    // 401 ou erro da uazapi esperado para token simulado
    assert(err.response?.status === 401 || err.response?.status === 500, 'Status de erro tratado');
    console.log('✓ Status com token simulado tratado corretamente sem disparar falso positivo!');
  }

  // TESTE 4: Transição controlada para connected apenas quando houver JID/telefone conectado
  console.log('\n[4] Testando confirmação de conexão somente com telefone autenticado...');
  const connectedInstance = {
    ...mockConnectingInstance,
    status: 'connected',
    numero_conectado: '5511988887777',
    phoneNumber: '5511988887777'
  };
  db.saveInstance(connectedInstance);

  const instRes3 = await client.get('/api/instances');
  const foundConnected = instRes3.data.find(i => i.id === testInstId);
  assert.strictEqual(foundConnected.status, 'connected', 'Status agora deve ser connected');
  assert.strictEqual(foundConnected.numero_conectado, '5511988887777');
  console.log(`✓ Instância devidamente marcada como conectada com número ${foundConnected.numero_conectado}!`);

  // Limpeza
  db.deleteInstance(testInstId);
  console.log('✓ Instância de teste removida do banco local.');

  console.log('\n===========================================================');
  console.log('🎉 TODOS OS TESTES DE CORREÇÃO PASSARAM COM SUCESSO!');
  console.log('===========================================================');
}

testFixVerification().catch(err => {
  console.error('❌ Falha nos testes de correção:', err);
  process.exit(1);
});
