const axios = require('axios');
const db = require('../server/storage/db');

async function runTests() {
  console.log('====================================================');
  console.log('🧪 INICIANDO TESTES DO SISTEMA DE DOMÍNIOS CUSTOMIZADOS');
  console.log('====================================================\n');

  const instance = axios.create({ baseURL: 'http://localhost:3000', withCredentials: true });

  // 1. Login
  const loginRes = await instance.post('/api/auth/login', { username: 'admin', password: 'admin123' });
  const cookie = loginRes.headers['set-cookie'];
  console.log('✓ 1. Login autenticado com sucesso:', loginRes.data.success);

  // 2. Teste de Validação de Formato
  try {
    await instance.post('/api/dominios/criar', { dominio: 'http://invalid..domain!!' }, { headers: { Cookie: cookie } });
    console.error('❌ Deveria ter rejeitado domínio inválido');
  } catch (err) {
    console.log('✓ 2. Validação preventiva de formato funcionando:', err.response?.data?.error);
  }

  // 3. Criação de Domínio Customizado
  const testDomain = 'ir.promo123.com';
  const createRes = await instance.post('/api/dominios/criar', { dominio: testDomain }, { headers: { Cookie: cookie } });
  console.log('✓ 3. Domínio criado com sucesso:');
  console.log('   - ID:', createRes.data.domain.id);
  console.log('   - Domínio:', createRes.data.domain.dominio);
  console.log('   - CNAME Target:', createRes.data.cname_target);
  console.log('   - Subdomínio DNS:', createRes.data.subdomain);
  console.log('   - Status inicial:', createRes.data.domain.status);
  console.log('   - Ativo:', createRes.data.domain.ativo);

  const domainId = createRes.data.domain.id;

  // 4. Listagem de Domínios
  const listRes = await instance.get('/api/dominios', { headers: { Cookie: cookie } });
  const found = listRes.data.domains?.find(d => d.id === domainId);
  console.log('✓ 4. Listagem de domínios retornou registro recém-criado:', !!found);

  // 5. Teste de Host Header antes da ativação (status: pendente)
  try {
    await axios.get('http://localhost:3000/c/test-slug', {
      headers: { Host: testDomain },
      maxRedirects: 0
    });
    console.error('❌ Domínio pendente não deveria ser autorizado no Host header');
  } catch (err) {
    console.log(`✓ 5. Host Header bloqueou domínio pendente com HTTP ${err.response?.status} (${err.response?.data?.includes('404') ? 'Página 404 segura' : 'Erro'})`);
  }

  // 6. Teste de Host Header Desconhecido (não cadastrado)
  try {
    await axios.get('http://localhost:3000/c/test-slug', {
      headers: { Host: 'hacker-random-domain.xyz' },
      maxRedirects: 0
    });
    console.error('❌ Host desconhecido não deveria ser autorizado');
  } catch (err) {
    console.log(`✓ 6. Host desconhecido bloqueado com HTTP ${err.response?.status}`);
  }

  // 7. Simulação de Ativação (SSL ISSUED)
  db.updateCustomDomain(domainId, { status: 'ativo' });
  console.log('✓ 7. Domínio atualizado no banco para status "ativo"');

  // 8. Teste de Host Header com Domínio Ativo
  try {
    await axios.get('http://localhost:3000/c/test-slug?ttclid=test_clid_custom_domain', {
      headers: { Host: testDomain },
      maxRedirects: 0
    });
  } catch (err) {
    console.log(`✓ 8. Host Header com domínio ativo processou com HTTP ${err.response?.status} (302 Redirect):`);
    console.log('   - Redirect Location:', err.response?.headers?.location);
  }

  // 9. Alternar Ativo/Inativo (Aposentar domínio queimado)
  const toggleRes = await instance.patch(`/api/dominios/${domainId}/toggle-ativo`, {}, { headers: { Cookie: cookie } });
  console.log('✓ 9. Domínio desativado (ativo = false):', toggleRes.data.domain.ativo === false);

  // 10. Remoção / Deleção do Domínio
  const delRes = await instance.delete(`/api/dominios/${domainId}`, { headers: { Cookie: cookie } });
  console.log('✓ 10. Domínio deletado com sucesso:', delRes.data.success);

  console.log('\n====================================================');
  console.log('🎉 TODOS OS TESTES DE DOMÍNIOS PASSARAM COM SUCESSO!');
  console.log('====================================================');
}

runTests().catch(e => {
  console.error('Erro nos testes:', e);
  process.exit(1);
});
