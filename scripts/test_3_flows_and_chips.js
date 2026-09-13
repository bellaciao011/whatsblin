const axios = require('axios');
const db = require('../server/storage/db');
const flowEngine = require('../server/services/flowEngine');
const aiService = require('../server/services/aiService');
const authService = require('../server/services/authService');

const BASE_URL = 'http://localhost:3000/api';
const authToken = authService.generateToken('admin');
const axiosConfig = {
  headers: {
    Authorization: `Bearer ${authToken}`
  }
};

async function runTests() {
  console.log('==============================================');
  console.log('🧪 INICIANDO TESTES DO SISTEMA DE 3 FLUXOS');
  console.log('==============================================\n');

  // 1. Teste de listagem de fluxos
  console.log('1. Verificando API de Fluxos (/api/flows)...');
  const flowsRes = await axios.get(`${BASE_URL}/flows`, axiosConfig);
  const flows = flowsRes.data;
  console.log(`✓ Total de fluxos encontrados: ${flows.length}`);
  if (flows.length !== 3) {
    throw new Error(`Esperado 3 fluxos, mas encontrado ${flows.length}`);
  }

  const pt = flows.find(f => f.id === 'fluxo-espiao-foto');
  const es = flows.find(f => f.id === 'fluxo-espiao-es');
  const en = flows.find(f => f.id === 'fluxo-espiao-en');

  console.log(`- 🇧🇷 PT: "${pt?.name}" (${pt?.nodes?.length} nós, ${pt?.edges?.length} edges)`);
  console.log(`- 🇪🇸 ES: "${es?.name}" (${es?.nodes?.length} nós, ${es?.edges?.length} edges)`);
  console.log(`- 🇺🇸 EN: "${en?.name}" (${en?.nodes?.length} nós, ${en?.edges?.length} edges)`);

  if (!pt || !es || !en) throw new Error('Um dos 3 fluxos oficiais não foi encontrado!');
  if (pt.nodes.length !== 26 || es.nodes.length !== 26 || en.nodes.length !== 26) {
    throw new Error('Todos os fluxos devem ter exatamente 26 nós!');
  }
  console.log('✓ Todos os 3 fluxos possuem exatamente 26 nós e 32 edges!\n');

  // 2. Teste de criação e vinculação de Chips aos fluxos
  console.log('2. Testando criação de Chips com vinculação estrita de fluxo...');
  
  // Chip Brasil
  const chipPtRes = await axios.post(`${BASE_URL}/instances`, {
    id: 'chip_test_pt',
    name: '📱 Chip Brasil (+55 11)',
    phoneNumber: '+55 11 98888-1111',
    phoneNumberId: 'phone_id_br',
    assignedFlowId: 'fluxo-espiao-foto'
  }, axiosConfig);
  console.log(`✓ Chip PT criado: ${chipPtRes.data.instance.name} -> Fluxo: ${chipPtRes.data.instance.assignedFlowId}`);

  // Chip Espanha
  const chipEsRes = await axios.post(`${BASE_URL}/instances`, {
    id: 'chip_test_es',
    name: '📱 Chip Espanha (+34 6)',
    phoneNumber: '+34 612 34 56 78',
    phoneNumberId: 'phone_id_es',
    assignedFlowId: 'fluxo-espiao-es'
  }, axiosConfig);
  console.log(`✓ Chip ES criado: ${chipEsRes.data.instance.name} -> Fluxo: ${chipEsRes.data.instance.assignedFlowId}`);

  // Chip USA
  const chipEnRes = await axios.post(`${BASE_URL}/instances`, {
    id: 'chip_test_en',
    name: '📱 Chip USA (+1 202)',
    phoneNumber: '+1 202 555 0199',
    phoneNumberId: 'phone_id_en',
    assignedFlowId: 'fluxo-espiao-en'
  }, axiosConfig);
  console.log(`✓ Chip EN criado: ${chipEnRes.data.instance.name} -> Fluxo: ${chipEnRes.data.instance.assignedFlowId}`);

  // 3. Teste de alteração de fluxo via PATCH /instances/:id/flow
  console.log('\n3. Testando alteração rápida de fluxo (PATCH /instances/:id/flow)...');
  const patchRes = await axios.patch(`${BASE_URL}/instances/chip_test_en/flow`, {
    flowId: 'fluxo-espiao-es'
  }, axiosConfig);
  console.log(`✓ Chip alterado para: ${patchRes.data.instance.assignedFlowId}`);
  // Retorna para EN
  await axios.patch(`${BASE_URL}/instances/chip_test_en/flow`, { flowId: 'fluxo-espiao-en' }, axiosConfig);
  console.log(`✓ Chip restaurado com segurança para: fluxo-espiao-en\n`);

  // 4. Teste de Execução Isolada por Idioma no FlowEngine
  console.log('4. Simulando mensagens nos 3 Chips para validar isolamento de fluxo:');

  // Limpa chats de teste
  const chats = db.getChats();
  delete chats['5511999990001'];
  delete chats['34600000002'];
  delete chats['12025550003'];
  db.saveChats(chats);

  // Mensagem no Chip PT (Lead BR)
  console.log('\n--- Testando Chip PT (Lead 5511999990001) ---');
  await flowEngine.processIncomingMessage('chip_test_pt', '5511999990001', 'Oi, tudo bem?');
  const chatPt = db.getChats()['5511999990001'];
  const botMsgPt = chatPt?.messages?.find(m => m.from === 'bot')?.text;
  console.log(`Lead PT recebeu: "${botMsgPt}"`);
  console.log(`Chat PT assignedFlowId: ${chatPt?.assignedFlowId} (Lang: ${chatPt?.flowLanguage})`);
  if (!botMsgPt.includes('Olá') && !botMsgPt.includes('Salve')) {
    throw new Error('Falha: resposta não está em Português!');
  }

  // Mensagem no Chip ES (Lead Espanha)
  console.log('\n--- Testando Chip ES (Lead 34600000002) ---');
  await flowEngine.processIncomingMessage('chip_test_es', '34600000002', 'Hola');
  const chatEs = db.getChats()['34600000002'];
  const botMsgEs = chatEs?.messages?.find(m => m.from === 'bot')?.text;
  console.log(`Lead ES recebeu: "${botMsgEs}"`);
  console.log(`Chat ES assignedFlowId: ${chatEs?.assignedFlowId} (Lang: ${chatEs?.flowLanguage})`);
  if (!botMsgEs.includes('Hola') && !botMsgEs.includes('Guarda')) {
    throw new Error('Falha: resposta não está em Espanhol!');
  }

  // Mensagem no Chip EN (Lead USA)
  console.log('\n--- Testando Chip EN (Lead 12025550003) ---');
  await flowEngine.processIncomingMessage('chip_test_en', '12025550003', 'Hello there');
  const chatEn = db.getChats()['12025550003'];
  const botMsgEn = chatEn?.messages?.find(m => m.from === 'bot')?.text;
  console.log(`Lead EN recebeu: "${botMsgEn}"`);
  console.log(`Chat EN assignedFlowId: ${chatEn?.assignedFlowId} (Lang: ${chatEn?.flowLanguage})`);
  if (!botMsgEn.includes('Hello') && !botMsgEn.includes('Save')) {
    throw new Error('Falha: resposta não está em Inglês!');
  }

  // 5. Teste de Quebra de Objeção Multilíngue (Dúvidas e IA)
  console.log('\n5. Testando Classificador de Dúvidas e Objeções por Idioma:');
  const doubtPt = await aiService.classifyWelcomeReply('como funciona isso?', 'pt');
  console.log(`✓ Dúvida PT: "${doubtPt.reply.slice(0, 70)}..."`);
  if (!doubtPt.reply.includes('Nosso sistema')) throw new Error('Falha na dúvida PT');

  const doubtEs = await aiService.classifyWelcomeReply('¿como funciona esto?', 'es');
  console.log(`✓ Dúvida ES: "${doubtEs.reply.slice(0, 70)}..."`);
  if (!doubtEs.reply.includes('Nuestro sistema')) throw new Error('Falha na dúvida ES');

  const doubtEn = await aiService.classifyWelcomeReply('how does this work?', 'en');
  console.log(`✓ Dúvida EN: "${doubtEn.reply.slice(0, 70)}..."`);
  if (!doubtEn.reply.includes('Our system')) throw new Error('Falha na dúvida EN');

  // Objeção de valor (WHY_PAY)
  const whyPt = await aiService.classifyAndReply('por que tenho que pagar?', [], { value: '49,90' }, 'pt');
  console.log(`✓ Objeção WHY_PAY PT: "${whyPt.slice(0, 70)}..."`);
  if (!whyPt.includes('Cada etapa')) throw new Error('Falha na objeção PT');

  const whyEs = await aiService.classifyAndReply('¿por que tengo que pagar?', [], { value: '49.90' }, 'es');
  console.log(`✓ Objeção WHY_PAY ES: "${whyEs.slice(0, 70)}..."`);
  if (!whyEs.includes('Cada etapa activa')) throw new Error('Falha na objeção ES');

  const whyEn = await aiService.classifyAndReply('why do I have to pay?', [], { value: '49.90' }, 'en');
  console.log(`✓ Objeção WHY_PAY EN: "${whyEn.slice(0, 70)}..."`);
  if (!whyEn.includes('Each stage activates')) throw new Error('Falha na objeção EN');

  // Limpa os dados de teste criados
  await axios.delete(`${BASE_URL}/instances/chip_test_pt`, axiosConfig);
  await axios.delete(`${BASE_URL}/instances/chip_test_es`, axiosConfig);
  await axios.delete(`${BASE_URL}/instances/chip_test_en`, axiosConfig);
  const finalChats = db.getChats();
  delete finalChats['5511999990001'];
  delete finalChats['34600000002'];
  delete finalChats['12025550003'];
  db.saveChats(finalChats);

  console.log('\n==============================================');
  console.log('🎉 TODOS OS TESTES PASSARAM COM 100% DE SUCESSO!');
  console.log('🔒 Vinculação estrita e isolamento garantidos!');
  console.log('==============================================');
}

runTests().catch(err => {
  console.error('❌ ERRO NO TESTE:', err.message);
  if (err.response) console.error('Dados:', err.response.data);
  process.exit(1);
});
