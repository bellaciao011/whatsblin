const assert = require('assert');
const cryptoService = require('../server/services/cryptoService');
const uazapiService = require('../server/services/uazapiService');
const db = require('../server/storage/db');

async function runTests() {
  console.log('--- INICIANDO TESTES DA INTEGRAÇÃO UAZAPI ---');

  // TESTE 1: Criptografia AES-256-GCM do Token de Instância
  console.log('\n[1] Testando cryptoService (AES-256-GCM)...');
  const rawToken = 'uaz_inst_token_super_secret_99887766';
  const encrypted = cryptoService.encrypt(rawToken);
  console.log('Token Original:', rawToken);
  console.log('Token Criptografado:', encrypted);
  
  assert(encrypted !== rawToken, 'Token deve estar cifrado');
  assert(encrypted.split(':').length === 3, 'Formato deve ser iv:tag:ciphertext');
  
  const decrypted = cryptoService.decrypt(encrypted);
  console.log('Token Descriptografado:', decrypted);
  assert.strictEqual(decrypted, rawToken, 'Token descriptografado deve ser idêntico ao original');
  console.log('✓ Teste 1 passou: Criptografia íntegra!');

  // TESTE 2: Normalização de URLs da uazapi
  console.log('\n[2] Testando normalização de URL...');
  assert.strictEqual(uazapiService.normalizeServerUrl('https://api.uazapi.com/'), 'https://api.uazapi.com');
  assert.strictEqual(uazapiService.normalizeServerUrl('free.uazapi.com'), 'https://free.uazapi.com');
  assert.strictEqual(uazapiService.normalizeServerUrl(''), 'https://free.uazapi.com');
  console.log('✓ Teste 2 passou: URLs normalizadas corretamente!');

  // TESTE 3: Tratamento de Erros da OpenAPI (401, 404, 429, 503 com Retry-After)
  console.log('\n[3] Testando tratamento de erros documentados...');
  
  // 401
  const err401 = { response: { status: 401, data: { error: 'instance info not found' } } };
  const parsed401 = uazapiService.parseApiError(err401);
  assert.strictEqual(parsed401.status, 401);
  assert(parsed401.message.includes('401'), 'Mensagem 401 deve conter explicação amigável');

  // 404
  const err404 = { response: { status: 404, data: {} } };
  const parsed404 = uazapiService.parseApiError(err404);
  assert.strictEqual(parsed404.status, 404);
  assert(parsed404.message.includes('404'), 'Mensagem 404 deve conter explicação');

  // 429
  const err429 = { response: { status: 429, data: {} } };
  const parsed429 = uazapiService.parseApiError(err429);
  assert.strictEqual(parsed429.status, 429);
  assert(parsed429.message.includes('429'), 'Mensagem 429 deve indicar limite atingido');

  // 503 com Retry-After
  const err503 = {
    response: {
      status: 503,
      headers: { 'retry-after': '8' },
      data: {}
    }
  };
  const parsed503 = uazapiService.parseApiError(err503);
  assert.strictEqual(parsed503.status, 503);
  assert.strictEqual(parsed503.retryAfter, 8, 'Deve extrair valor do Retry-After');
  assert(parsed503.message.includes('8 segundo'), 'Mensagem 503 deve informar os segundos');

  console.log('✓ Teste 3 passou: Todos os códigos de erro da spec foram tratados!');

  // TESTE 4: Persistência de Conexão no Banco
  console.log('\n[4] Testando persistência segura de conexão uazapi...');
  const testInstance = {
    id: 'uaz_test_instance_001',
    name: 'WhatsApp Vendas Teste',
    tipo: 'uazapi',
    url_servidor: 'https://free.uazapi.com',
    instance_id: 'inst_abc123',
    instance_token: encrypted,
    phoneNumber: '5511988887777',
    numero_conectado: '5511988887777',
    status: 'connected',
    assignedFlowId: 'fluxo-espiao-foto',
    createdAt: new Date().toISOString()
  };

  db.saveInstance(testInstance);
  const fetched = db.getInstance('uaz_test_instance_001');
  assert(fetched !== null, 'Instância deve ser recuperada do banco');
  assert.strictEqual(fetched.tipo, 'uazapi');
  assert.strictEqual(fetched.numero_conectado, '5511988887777');
  
  const decryptedFetchedToken = cryptoService.decrypt(fetched.instance_token);
  assert.strictEqual(decryptedFetchedToken, rawToken, 'Token no banco deve ser descriptografado com sucesso');
  console.log('✓ Teste 4 passou: Persistência e busca de conexões funcionando!');

  // Limpa o teste
  db.deleteInstance('uaz_test_instance_001');
  console.log('✓ Instância de teste limpa com sucesso.');

  console.log('\n=========================================');
  console.log('🎉 TODOS OS TESTES PASSARAM COM SUCESSO!');
  console.log('=========================================');
}

runTests().catch(err => {
  console.error('❌ Falha nos testes:', err);
  process.exit(1);
});
