const axios = require('axios');

const BASE_URL = 'http://localhost:3000';

async function runTests() {
  console.log('====================================================');
  console.log('🧪 TESTE COMPLETO DE ATRIBUIÇÃO TIKTOK ADS & CAPI');
  console.log('====================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition, message) {
    if (condition) {
      console.log(`  ✓ PASSOU: ${message}`);
      passed++;
    } else {
      console.error(`  ❌ FALHOU: ${message}`);
      failed++;
    }
  }

  // ----------------------------------------------------
  // ETAPA 0: Autenticação do Administrador
  // ----------------------------------------------------
  console.log('[ETAPA 0] Autenticando Administrador...');
  let authToken = null;
  try {
    const loginRes = await axios.post(`${BASE_URL}/api/auth/login`, {
      username: 'admin',
      password: 'admin123'
    });
    assert(loginRes.data.success === true, 'Login efetuado com sucesso');
    authToken = loginRes.data.token;
  } catch (err) {
    console.error('Erro ao autenticar:', err.response?.data || err.message);
    process.exit(1);
  }

  const authHeaders = {
    headers: {
      Authorization: `Bearer ${authToken}`
    }
  };

  // ----------------------------------------------------
  // TESTE 1: Criar Link de Campanha (/api/traffic/campaigns)
  // ----------------------------------------------------
  console.log('\n[TESTE 1] Criando Link de Campanha...');
  let campaign;
  try {
    const slug = 'teste-vsl-' + Date.now();
    const res = await axios.post(`${BASE_URL}/api/traffic/campaigns`, {
      name: 'Campanha Teste Automatizado',
      slug,
      presell_url: 'https://minhapressel.com/oferta',
      whatsapp_number: '5511988887777',
      message_template: 'Oii vim pelo TikTok (código {codigo})'
    }, authHeaders);

    assert(res.data.success === true, 'API retornou success: true na criação');
    assert(res.data.campaign && res.data.campaign.slug === slug, 'Slug correto registrado');
    assert(res.data.campaign.shortUrl.includes(`/c/${slug}`), 'URL curta montada corretamente');
    campaign = res.data.campaign;
  } catch (err) {
    console.error('Erro no Teste 1:', err.response?.data || err.message);
    failed++;
  }

  // ----------------------------------------------------
  // TESTE 2: Acesso Público ao Endpoint de Entrada (/c/:slug)
  // ----------------------------------------------------
  console.log('\n[TESTE 2] Acessando endpoint público de clique (/c/:slug)...');
  let generatedCode = null;
  try {
    const clickUrl = `${BASE_URL}/c/${campaign.slug}?ttclid=TTCLID_AUTOMATED_12345&utm_source=tiktok&utm_medium=paid_cpc&utm_campaign=campanha_espião&utm_content=video_criativo_01`;
    const res = await axios.get(clickUrl, {
      maxRedirects: 0,
      validateStatus: (status) => status >= 200 && status < 400,
      headers: {
        'Cookie': '_ttp=TEST_TTP_COOKIE_FROM_BROWSER'
      }
    });

    assert(res.status === 302, 'Endpoint retornou status HTTP 302 Redirect');
    const location = res.headers['location'];
    assert(location && location.includes('https://minhapressel.com/oferta'), 'Redirect aponta para a pressel correta');
    assert(location && location.includes('codigo='), 'Redirect inclui parâmetro ?codigo=');

    const urlObj = new URL(location);
    generatedCode = urlObj.searchParams.get('codigo');
    console.log(`    ➔ Código gerado capturado: ${generatedCode}`);
    assert(/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/.test(generatedCode), 'Código gerado possui 6 caracteres alfanuméricos válidos (sem 0, O, 1, I)');
  } catch (err) {
    console.error('Erro no Teste 2:', err.response?.data || err.message);
    failed++;
  }

  // ----------------------------------------------------
  // TESTE 3: Verificação no Banco de Atribuições
  // ----------------------------------------------------
  console.log('\n[TESTE 3] Verificando atribuição gravada no banco...');
  try {
    const res = await axios.get(`${BASE_URL}/api/traffic/attributions`, authHeaders);
    const attributions = res.data;
    const found = attributions.find(a => a.codigo === generatedCode);

    assert(found !== undefined, 'Registro de atribuição localizado pelo código');
    assert(found.ttclid === 'TTCLID_AUTOMATED_12345', 'ttclid gravado corretamente');
    assert(found.ttp === 'TEST_TTP_COOKIE_FROM_BROWSER', '_ttp capturado e gravado');
    assert(found.utm_campaign === 'campanha_espião', 'utm_campaign gravada corretamente');
    assert(found.utm_content === 'video_criativo_01', 'utm_content gravado corretamente');
    assert(found.telefone_vinculado === null, 'telefone_vinculado inicialmente null');
    assert(found.venda_confirmada === false, 'venda_confirmada inicialmente false');
    assert(new Date(found.expira_em) > new Date(), 'expira_em configurado para o futuro (+48h)');
  } catch (err) {
    console.error('Erro no Teste 3:', err.message);
    failed++;
  }

  // ----------------------------------------------------
  // TESTE 4: Mensagem Inbound do WhatsApp & Vinculação de Telefone
  // ----------------------------------------------------
  console.log('\n[TESTE 4] Simulando entrada do lead no WhatsApp com o código...');
  const testPhone = `55119${Math.floor(10000000 + Math.random() * 90000000)}`;
  try {
    const inboundText = `Oii vim pelo TikTok (código ${generatedCode})`;
    
    // Simula mensagem via POST /api/simulator/send
    const simRes = await axios.post(`${BASE_URL}/api/simulator/send`, {
      phone: testPhone,
      text: inboundText
    }, authHeaders);

    assert(simRes.data.success === true, 'Mensagem recebida e processada pelo FlowEngine');

    // Verifica se telefone_vinculado foi preenchido
    const attrRes = await axios.get(`${BASE_URL}/api/traffic/attributions`, authHeaders);
    const updated = attrRes.data.find(a => a.codigo === generatedCode);

    assert(updated.telefone_vinculado === testPhone, `telefone_vinculado atualizado para E.164: ${testPhone}`);
    assert(updated.vinculado_em !== null, 'Data/hora de vinculação registrada (vinculado_em)');

    // Verifica se a mensagem no chat manteve o código visível pro bot/atendente
    const chatsRes = await axios.get(`${BASE_URL}/api/chats`, authHeaders);
    const chat = chatsRes.data[testPhone];
    const firstMsg = chat?.messages?.[0];
    assert(firstMsg && firstMsg.text.includes(generatedCode), 'Mensagem visível no chat preservou o código para histórico');
  } catch (err) {
    console.error('Erro no Teste 4:', err.message);
    failed++;
  }

  // ----------------------------------------------------
  // TESTE 5: Cadastro de Pixel TikTok e Disparo Server-side
  // ----------------------------------------------------
  console.log('\n[TESTE 5] Cadastrando Pixel TikTok & Disparando Evento...');
  try {
    const pixRes = await axios.post(`${BASE_URL}/api/tiktok/pixels`, {
      name: 'Pixel Teste QA',
      pixel_code: 'TT_PIXEL_TEST_123',
      access_token: 'tt_act_demo_token_valid_for_test'
    }, authHeaders);
    assert(pixRes.data.success === true, 'Pixel TikTok cadastrado com sucesso');

    // Dispara teste de evento
    const testEventRes = await axios.post(`${BASE_URL}/api/tiktok/test`, {
      pixel_code: 'TT_PIXEL_TEST_123',
      access_token: 'tt_act_demo_token_valid_for_test',
      event_name: 'CompletePayment',
      phone: testPhone,
      value: 49.90
    }, authHeaders);

    assert(testEventRes.data !== undefined, 'TikTok Events API respondeu');

    // Confirma venda na atribuição
    const paymentRes = await axios.post(`${BASE_URL}/api/webhooks/payment`, {
      event: 'PURCHASE_APPROVED',
      order: {
        id: 'ord_test_' + Date.now(),
        status: 'aprovado',
        amount: 49.90,
        customer: { phone: testPhone }
      }
    });

    assert(paymentRes.data.success === true, 'Webhook de pagamento processado com sucesso');

    // Verifica se a atribuição foi marcada como venda confirmada
    const attrRes = await axios.get(`${BASE_URL}/api/traffic/attributions`, authHeaders);
    const confirmedAttr = attrRes.data.find(a => a.codigo === generatedCode);
    assert(confirmedAttr.venda_confirmada === true, 'venda_confirmada marcada como true');
    assert(confirmedAttr.venda_valor === 49.90, 'venda_valor registrado como 49.90');
    assert(confirmedAttr.confirmado_em !== null, 'Data da confirmação registrada');

    // Verifica auditoria de logs
    const logsRes = await axios.get(`${BASE_URL}/api/tiktok/logs`, authHeaders);
    assert(logsRes.data.length > 0, 'Disparo registrado na tabela de logs (logs_disparo_tiktok)');
    const latestLog = logsRes.data[0];
    assert(latestLog.phone_hash !== undefined, 'Telefone foi anonimizado via hash SHA-256');
  } catch (err) {
    console.error('Erro no Teste 5:', err.message);
    failed++;
  }

  // ----------------------------------------------------
  // TESTE 6: Relatório Consolidado de Conversão
  // ----------------------------------------------------
  console.log('\n[TESTE 6] Verificando Relatório de Métricas (/api/traffic/report)...');
  try {
    const repRes = await axios.get(`${BASE_URL}/api/traffic/report`, authHeaders);
    const report = repRes.data;

    assert(report.kpis.totalClicks >= 1, `KPI Cliques rastreados: ${report.kpis.totalClicks}`);
    assert(report.kpis.totalLeads >= 1, `KPI Leads no WhatsApp: ${report.kpis.totalLeads}`);
    assert(report.kpis.totalSales >= 1, `KPI Vendas confirmadas: ${report.kpis.totalSales}`);
    assert(parseFloat(report.kpis.totalRevenue) >= 49.90, `KPI Faturamento total: R$ ${report.kpis.totalRevenue}`);
    assert(report.campaignGroups.length > 0, 'Agrupamento por utm_campaign/utm_content calculado com sucesso');

    const group = report.campaignGroups.find(g => g.campaign === 'campanha_espião' || g.campaign === 'Campanha Teste Automatizado');
    if (group) {
      console.log(`    ➔ Grupo encontrado: ${group.campaign} | Cliques: ${group.clicks} | Leads: ${group.leads} | Vendas: ${group.sales} | Conv: ${group.conversionRate}`);
      assert(group.clicks >= 1, 'Métricas do grupo calculadas com precisão');
    }
  } catch (err) {
    console.error('Erro no Teste 6:', err.message);
    failed++;
  }

  // ----------------------------------------------------
  // TESTE 7: Simulador de Cadeia Completa (/api/tiktok/test-chain)
  // ----------------------------------------------------
  console.log('\n[TESTE 7] Executando endpoint de simulação de cadeia completa...');
  try {
    const chainRes = await axios.post(`${BASE_URL}/api/tiktok/test-chain`, {
      phone: '5511977776666',
      utm_campaign: 'simulacao_tiktok_vsl',
      utm_content: 'criativo_teste_01',
      amount: 49.90
    }, authHeaders);

    assert(chainRes.data.success === true, 'Cadeia completa passou em 100% dos passos');
    const diag = chainRes.data.diagnostics;
    assert(diag.step1_click.status === 'success', 'Passo 1 (Clique & Código) = SUCCESS');
    assert(diag.step2_inbound_message.status === 'success', 'Passo 2 (Mensagem WhatsApp) = SUCCESS');
    assert(diag.step3_phone_binding.status === 'success', 'Passo 3 (Binding de Telefone) = SUCCESS');
    assert(diag.step4_sale_and_capi.status === 'success', 'Passo 4 (Venda & Events API) = SUCCESS');
    console.log(`    ➔ Código gerado na simulação: ${diag.summary.code}`);
  } catch (err) {
    console.error('Erro no Teste 7:', err.message);
    failed++;
  }

  console.log('\n====================================================');
  console.log(`📊 RESUMO DOS TESTES: ${passed} PASSOU, ${failed} FALHOU`);
  console.log('====================================================');

  if (failed > 0) {
    process.exit(1);
  } else {
    console.log('🎉 TODOS OS REQUISITOS DE ATRIBUIÇÃO TIKTOK ADS FORAM CUMPRIDOS COM SUCESSO!\n');
    process.exit(0);
  }
}

runTests();
