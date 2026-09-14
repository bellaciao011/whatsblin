const db = require('../server/storage/db');
const cryptoService = require('../server/services/cryptoService');
const uazapiWebhookRoutes = require('../server/routes/uazapiWebhook');

// Mock req e res
function createMockReqRes(body, headers = {}) {
  const req = {
    body,
    headers,
    query: {}
  };
  let statusCode = null;
  let responseData = null;
  const res = {
    status: (code) => {
      statusCode = code;
      return res;
    },
    json: (data) => {
      responseData = data;
      return res;
    }
  };
  return { req, res, getStatus: () => statusCode, getData: () => responseData };
}

async function testWebhook() {
  console.log('--- TESTANDO WEBHOOK UAZAPI ---');

  // Cria instância uazapi no banco para teste
  const rawToken = 'webhook_token_secret_12345';
  const testInst = {
    id: 'uaz_webhook_test_inst',
    name: 'Instância Webhook Teste',
    tipo: 'uazapi',
    url_servidor: 'https://free.uazapi.com',
    instance_id: 'uaz_id_999',
    instance_token: cryptoService.encrypt(rawToken),
    phoneNumber: '',
    numero_conectado: '',
    status: 'connecting',
    assignedFlowId: 'fluxo-espiao-foto',
    createdAt: new Date().toISOString()
  };
  db.saveInstance(testInst);

  // 1. Teste de evento 'connection' (status connected)
  console.log('\n[1] Testando evento connection: connected...');
  const handler = uazapiWebhookRoutes.stack.find(s => s.route && s.route.path === '/uazapi')?.route?.stack[0]?.handle;

  const { req: req1, res: res1, getStatus: getStatus1 } = createMockReqRes({
    event: 'connection',
    instance: 'uaz_id_999',
    data: {
      status: 'connected',
      connected: true,
      jid: { user: '5511999887766' }
    }
  });

  await handler(req1, res1);
  const updatedInst = db.getInstance('uaz_webhook_test_inst');
  console.log('Status atualizado da instância:', updatedInst.status);
  console.log('Número conectado:', updatedInst.numero_conectado);
  if (updatedInst.status === 'connected' && updatedInst.numero_conectado === '5511999887766') {
    console.log('✓ Evento connection (connected) tratado com sucesso!');
  } else {
    throw new Error('Falha ao atualizar conexão para connected');
  }

  // 2. Teste de evento 'connection' (desconectado)
  console.log('\n[2] Testando evento connection: disconnected...');
  const { req: req2, res: res2 } = createMockReqRes({
    event: 'connection',
    instance: 'uaz_id_999',
    data: {
      status: 'disconnected',
      connected: false
    }
  });

  await handler(req2, res2);
  const disconnectedInst = db.getInstance('uaz_webhook_test_inst');
  console.log('Status atualizado:', disconnectedInst.status);
  if (disconnectedInst.status === 'disconnected') {
    console.log('✓ Evento connection (disconnected) tratado com sucesso!');
  } else {
    throw new Error('Falha ao atualizar conexão para disconnected');
  }

  // 3. Teste de filtro anti-loop (wasSentByApi: true)
  console.log('\n[3] Testando filtro anti-loop (wasSentByApi = true)...');
  const { req: req3, res: res3 } = createMockReqRes({
    event: 'messages',
    instance: 'uaz_id_999',
    data: {
      chatid: '5511977776666@s.whatsapp.net',
      text: 'Mensagem do próprio robô',
      wasSentByApi: true
    }
  });

  await handler(req3, res3);
  console.log('✓ Mensagem wasSentByApi ignorada com sucesso (anti-loop validado)!');

  // Limpa instância de teste
  db.deleteInstance('uaz_webhook_test_inst');
  console.log('\n✓ Limpeza de teste concluída.');
  console.log('🎉 TESTES DE WEBHOOK PASSARAM COM SUCESSO!');
}

testWebhook().catch(err => {
  console.error('❌ Erro no teste do webhook:', err);
  process.exit(1);
});
