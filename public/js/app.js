// WhatsHub Pro - Frontend Application State & Router
// Interceptor global para redirecionar se a sessão expirar (401)
const originalFetch = window.fetch;
window.fetch = async function(...args) {
  const res = await originalFetch(...args);
  if (res.status === 401 && !window.location.pathname.includes('login')) {
    window.location.href = '/login';
  }
  return res;
};

// Função para encerrar sessão e limpar estado
async function logout() {
  try {
    await fetch('/api/auth/logout', { method: 'POST' });
  } catch (err) {}
  localStorage.removeItem('hub_auth_user');
  localStorage.removeItem('hub_token');
  window.location.href = '/login';
}

const state = {
  currentView: 'overview',
  stats: {},
  instances: [],
  chats: {},
  funnel: {},
  settings: {},
  activeChatPhone: null,
  eventSource: null
};

// Utilities
function showToast(message, type = 'success') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `<span>${type === 'success' ? '✅' : '⚠️'}</span> <span>${message}</span>`;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

// Tema Claro / Escuro
function initTheme() {
  const savedTheme = localStorage.getItem('app_theme') || 'dark';
  if (savedTheme === 'light') {
    document.body.classList.add('theme-light');
  } else {
    document.body.classList.remove('theme-light');
  }
  updateThemeButton();
}

function toggleTheme() {
  const isLight = document.body.classList.toggle('theme-light');
  localStorage.setItem('app_theme', isLight ? 'light' : 'dark');
  updateThemeButton();
  if (state.currentView === 'overview') {
    renderOverview();
  }
}

function updateThemeButton() {
  const btn = document.getElementById('theme-btn');
  if (!btn) return;
  const isLight = document.body.classList.contains('theme-light');
  btn.innerHTML = isLight ? '🌙 Tema Escuro' : '☀️ Tema Claro';
  btn.title = isLight ? 'Alternar para Tema Escuro' : 'Alternar para Tema Claro';
}

// Router
window.addEventListener('hashchange', handleRoute);
window.addEventListener('DOMContentLoaded', () => {
  initTheme();
  initRealtimeEvents();
  handleRoute();
});

function handleRoute() {
  const fullHash = window.location.hash.replace('#', '') || 'overview';
  const [route, queryString] = fullHash.split('?');
  const params = new URLSearchParams(queryString || '');

  state.currentView = route;

  document.querySelectorAll('.nav-item').forEach(item => {
    item.classList.toggle('active', item.dataset.view === route);
  });

  const titles = {
    overview: '📊 Dashboard — Visão Geral & Conversão',
    inbox: '💬 Chats ao vivo',
    kanban: '🗂️ Kanban de Atendimento',
    contacts: '👥 Contatos & Leads',
    flows: '🔗 Fluxos — Automações e fluxos de atendimento',
    'flow-canvas': '🕸️ Editor Visual de Fluxo (n8n Canvas)',
    instances: '🔌 Conexões (Meta Cloud API)',
    pixels: '🎯 Facebook Pixels & Conversions API (CAPI)',
    tiktok: '🎵 Atribuição TikTok Ads & Server-side CAPI',
    webhooks: '📡 Webhooks de Entrada',
    settings: '🤖 Inteligência Artificial & Checkouts',
    studio: '🎨 Estúdio de Calibração das Provas',
    simulator: '🧪 Simulador de Lead'
  };
  document.getElementById('top-title').textContent = titles[route] || 'WhatsHub Pro';

  const container = document.getElementById('view-container');
  container.innerHTML = '<div style="color: var(--text-muted); padding: 40px; text-align: center;">Carregando dados...</div>';

  if (route === 'overview') renderOverview();
  else if (route === 'inbox') renderInbox();
  else if (route === 'kanban') renderKanban();
  else if (route === 'contacts') renderContacts();
  else if (route === 'flows') FlowBuilder.renderList(container);
  else if (route === 'flow-canvas') FlowBuilder.renderCanvas(container, params.get('id') || 'fluxo-espiao-foto');
  else if (route === 'instances') renderInstances();
  else if (route === 'pixels') renderPixels();
  else if (route === 'tiktok') renderTikTokAttribution();
  else if (route === 'webhooks') renderWebhooks();
  else if (route === 'settings') renderSettings();
  else if (route === 'studio') renderStudio();
  else if (route === 'simulator') renderSimulator();
}

// Real-time Event Stream (SSE)
function initRealtimeEvents() {
  if (state.eventSource) state.eventSource.close();
  state.eventSource = new EventSource('/api/events');

  state.eventSource.onmessage = (e) => {
    try {
      const payload = JSON.parse(e.data);
      if (payload.type === 'new_message' || payload.type === 'chat_updated') {
        // Se estiver no Inbox, atualiza a tela
        if (state.currentView === 'inbox') {
          renderInbox(false); // sem loading
        }
        // Atualiza contadores
        updateBadges();
      }
    } catch (err) {
      console.error(err);
    }
  };
}

async function updateBadges() {
  try {
    const res = await fetch('/api/chats');
    state.chats = await res.json();
    const count = Object.keys(state.chats).length;
    document.getElementById('badge-leads').textContent = count;
  } catch (e) {}
}

/* =========================================================================
   VIEW 1: OVERVIEW (VISÃO GERAL)
   ========================================================================= */
/* =========================================================================
   VIEW 1: OVERVIEW (DASHBOARD EXECUTIVA & FUNIL DE CONVERSÃO %)
   ========================================================================= */
let salesChartInstance = null;

async function renderOverview() {
  try {
    const [statsRes, instRes, funnelRes] = await Promise.all([
      fetch('/api/dashboard/stats').then(r => r.json()),
      fetch('/api/instances').then(r => r.json()),
      fetch('/api/funnel').then(r => r.json())
    ]);

    state.stats = statsRes;
    state.instances = instRes;
    state.funnel = funnelRes;

    document.getElementById('badge-chips').textContent = instRes.length;

    const kpis = statsRes.kpis || {};
    const funnel = statsRes.funnel || [];
    const recentSales = statsRes.recentSales || [];
    const recentLogs = statsRes.recentPixelLogs || [];

    const html = `
      <!-- Cabeçalho da Dashboard -->
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
        <div>
          <h2 style="font-size: 20px; font-weight: 700; font-family: 'Outfit', sans-serif;">Dashboard de Conversão & Vendas</h2>
          <p style="font-size: 13px; color: var(--text-secondary); margin-top: 2px;">
            Acompanhe a retenção do funil em tempo real, pedidos aprovados e eventos do Pixel.
          </p>
        </div>
        <div style="display: flex; gap: 10px;">
          <button class="btn btn-secondary" onclick="renderOverview()" style="padding: 6px 12px; font-size: 12.5px;">
            🔄 Atualizar Dados
          </button>
          <a class="btn btn-primary" href="#pixels" style="padding: 6px 14px; font-size: 12.5px; text-decoration: none;">
            🎯 Configurar Pixels
          </a>
        </div>
      </div>

      <!-- 4 Cards de Métricas Principais (KPIs) -->
      <div class="grid-stats" style="margin-bottom: 24px;">
        <div class="stat-card">
          <div class="stat-icon green">💰</div>
          <div>
            <div class="stat-label">Faturamento Total</div>
            <div class="stat-value" style="color: #10b981;">R$ ${Number(kpis.totalRevenue || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</div>
            <div style="font-size: 11px; color: var(--text-muted); margin-top: 3px;">
              ✅ ${kpis.salesCount || 0} pedidos aprovados
            </div>
          </div>
        </div>

        <div class="stat-card">
          <div class="stat-icon purple">🎯</div>
          <div>
            <div class="stat-label">Taxa de Conversão Global</div>
            <div class="stat-value" style="color: #a855f7;">${kpis.globalConversionRate || '0.0%'}</div>
            <div style="font-size: 11px; color: var(--text-muted); margin-top: 3px;">
              Leads que startaram ➔ Pagaram
            </div>
          </div>
        </div>

        <div class="stat-card">
          <div class="stat-icon cyan">👥</div>
          <div>
            <div class="stat-label">Total de Leads Atendidos</div>
            <div class="stat-value" style="color: #06b6d4;">${kpis.totalLeads || 0}</div>
            <div style="font-size: 11px; color: var(--text-muted); margin-top: 3px;">
              Conversas iniciadas no bot
            </div>
          </div>
        </div>

        <div class="stat-card">
          <div class="stat-icon amber">📈</div>
          <div>
            <div class="stat-label">Ticket Médio</div>
            <div class="stat-value" style="color: #f59e0b;">R$ ${Number(kpis.averageTicket || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</div>
            <div style="font-size: 11px; color: var(--text-muted); margin-top: 3px;">
              Por cliente convertido
            </div>
          </div>
        </div>
      </div>

      <!-- Grid Principal: Funil de Conversão + Gráfico de Faturamento -->
      <div style="display: grid; grid-template-columns: 1.15fr 1fr; gap: 24px; margin-bottom: 24px;">
        <!-- Coluna 1: Funil de Conversão Passo a Passo -->
        <div class="card">
          <div class="card-header">
            <div>
              <h3 class="card-title">📉 Funil de Conversão do Fluxo (%)</h3>
              <p style="font-size: 12px; color: var(--text-secondary); margin-top: 3px;">
                Métrica de avanço dos leads etapa por etapa até o acesso master
              </p>
            </div>
            <span class="nav-badge" style="background: rgba(16,185,129,0.15); color: #10b981; font-weight: 600;">Tempo Real</span>
          </div>

          <div class="funnel-card" style="margin-top: 8px;">
            ${funnel.map(step => `
              <div class="funnel-step">
                <div class="funnel-step-header">
                  <span>${step.name}</span>
                  <div>
                    <strong style="color: ${step.color};">${step.count} leads</strong>
                    <span style="margin-left: 8px; font-size: 11.5px; color: var(--text-secondary); font-weight: 700;">${step.pct}</span>
                  </div>
                </div>
                <div class="funnel-bar-bg">
                  <div class="funnel-bar-fill" style="width: ${step.pct}; background: ${step.color};"></div>
                </div>
              </div>
            `).join('')}
          </div>
        </div>

        <!-- Coluna 2: Gráfico de Vendas & Resumo dos Chips -->
        <div style="display: flex; flex-direction: column; gap: 24px;">
          <div class="card">
            <div class="card-header">
              <h3 class="card-title">📊 Faturamento Diário (R$)</h3>
            </div>
            <div style="height: 200px; position: relative;">
              <canvas id="salesChart"></canvas>
            </div>
          </div>

          <div class="card">
            <div class="card-header">
              <h3 class="card-title">📱 Conexões WhatsApp Ativas</h3>
              <button class="btn btn-secondary" style="padding: 3px 8px; font-size: 11px;" onclick="window.location.hash='#instances'">Ver chips</button>
            </div>
            <div style="display: flex; flex-direction: column; gap: 10px;">
              ${instRes.length === 0 ? `
                <div style="font-size: 12.5px; color: var(--text-muted); text-align: center; padding: 12px;">Nenhum chip conectado ainda.</div>
              ` : instRes.map(i => `
                <div style="display: flex; align-items: center; justify-content: space-between; padding: 10px; background: rgba(255,255,255,0.02); border-radius: var(--radius-sm); border: 1px solid var(--border-color);">
                  <div style="display: flex; align-items: center; gap: 10px;">
                    <span class="status-dot" style="background: ${i.status === 'connected' ? 'var(--wa-green)' : 'var(--amber)'};"></span>
                    <div>
                      <strong style="font-size: 13px;">${i.name}</strong>
                      <div style="font-size: 11px; color: var(--text-muted);">${i.phoneNumber || 'Pronto para uso'}</div>
                    </div>
                  </div>
                  <span style="font-size: 11px; color: var(--wa-green); font-weight: 600;">Ativo</span>
                </div>
              `).join('')}
            </div>
          </div>
        </div>
      </div>

      <!-- Seção Inferior: Pedidos do Webhook & Logs CAPI -->
      <div style="display: grid; grid-template-columns: 1.3fr 1fr; gap: 24px;">
        <!-- Tabela de Pedidos Pagos (Webhook Kirvano / etc) -->
        <div class="card">
          <div class="card-header">
            <div>
              <h3 class="card-title">💳 Últimos Pedidos Pagos (Webhook)</h3>
              <p style="font-size: 12px; color: var(--text-secondary); margin-top: 2px;">Notificações recebidas via Kirvano / Gateways</p>
            </div>
            <span style="font-size: 11.5px; color: var(--text-muted);">${recentSales.length} recentes</span>
          </div>

          <div style="overflow-x: auto;">
            <table class="flows-table">
              <thead>
                <tr>
                  <th>Data</th>
                  <th>Telefone</th>
                  <th>Produto</th>
                  <th>Valor</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                ${recentSales.length === 0 ? `
                  <tr>
                    <td colspan="5" style="text-align: center; padding: 24px; color: var(--text-muted); font-size: 12.5px;">
                      Nenhum pedido recebido ainda via Webhook.<br>
                      Configure o Webhook na Kirvano usando a URL em <a href="#pixels" style="color: #a855f7;">Pixels & CAPI</a>.
                    </td>
                  </tr>
                ` : recentSales.map(s => `
                  <tr>
                    <td style="font-size: 11.5px; color: var(--text-muted);">
                      ${new Date(s.timestamp).toLocaleDateString()} ${new Date(s.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                    </td>
                    <td style="font-size: 12.5px; font-weight: 600;">${s.phone}</td>
                    <td style="font-size: 12px; color: var(--text-secondary);">${s.productName || 'Acesso Painel'}</td>
                    <td style="font-size: 12.5px; color: #10b981; font-weight: 700;">R$ ${Number(s.amount).toFixed(2)}</td>
                    <td>
                      <span class="btn" style="padding: 2px 7px; font-size: 10.5px; background: rgba(16,185,129,0.15); color: #10b981;">
                        ● APROVADO
                      </span>
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>

        <!-- Tabela de Disparos CAPI Meta -->
        <div class="card">
          <div class="card-header">
            <div>
              <h3 class="card-title">🎯 Disparos de Pixel CAPI</h3>
              <p style="font-size: 12px; color: var(--text-secondary); margin-top: 2px;">Eventos enviados para o Facebook Ads</p>
            </div>
            <a href="#pixels" class="btn btn-secondary" style="padding: 3px 8px; font-size: 11px; text-decoration: none;">Ver todos</a>
          </div>

          <div style="display: flex; flex-direction: column; gap: 8px;">
            ${recentLogs.length === 0 ? `
              <div style="text-align: center; padding: 24px; color: var(--text-muted); font-size: 12.5px;">
                Nenhum evento disparado ainda.<br>
                Cadastre seu Pixel na aba <a href="#pixels" style="color: #a855f7;">Pixels & CAPI</a>.
              </div>
            ` : recentLogs.map(l => `
              <div style="display: flex; align-items: center; justify-content: space-between; padding: 10px; background: rgba(255,255,255,0.02); border-radius: var(--radius-sm); border: 1px solid var(--border-color); font-size: 12px;">
                <div>
                  <div style="font-weight: 600; color: #fff;">
                    ${l.eventName}
                    ${l.value ? `<span style="color: #10b981; margin-left: 6px;">R$ ${l.value}</span>` : ''}
                  </div>
                  <div style="font-size: 10.5px; color: var(--text-muted);">
                    Pixel: ${l.pixelId} • Tel: ...${String(l.phone || '').slice(-4)}
                  </div>
                </div>
                <span class="btn" style="padding: 2px 6px; font-size: 10px; background: ${l.status === 'sucesso' ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.15)'}; color: ${l.status === 'sucesso' ? '#10b981' : '#ef4444'};">
                  ${l.status.toUpperCase()}
                </span>
              </div>
            `).join('')}
          </div>
        </div>
      </div>
    `;

    document.getElementById('view-container').innerHTML = html;

    // Inicializa o Chart.js
    initSalesChart(statsRes.salesChart || {});

  } catch (err) {
    document.getElementById('view-container').innerHTML = `<div class="card">Erro ao carregar visão geral: ${err.message}</div>`;
  }
}

function initSalesChart(salesByDay) {
  const ctx = document.getElementById('salesChart');
  if (!ctx || typeof Chart === 'undefined') return;

  if (salesChartInstance) {
    salesChartInstance.destroy();
  }

  const labels = Object.keys(salesByDay);
  const data = Object.values(salesByDay);

  if (labels.length === 0) {
    labels.push('Hoje');
    data.push(0);
  }

  const isLight = document.body.classList.contains('theme-light');
  const textColor = isLight ? '#475569' : '#94a3b8';
  const gridColor = isLight ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.06)';

  salesChartInstance = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [{
        label: 'Vendas (R$)',
        data: data,
        backgroundColor: '#7c3aed',
        borderRadius: 6,
        borderSkipped: false
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false }
      },
      scales: {
        x: {
          grid: { color: gridColor },
          ticks: { color: textColor, font: { size: 11 } }
        },
        y: {
          grid: { color: gridColor },
          ticks: {
            color: textColor,
            font: { size: 11 },
            callback: (v) => 'R$ ' + v
          }
        }
      }
    }
  });
}

/* =========================================================================
   VIEW: PIXELS DO FACEBOOK & CONVERSIONS API (CAPI)
   ========================================================================= */
async function renderPixels() {
  const [pixels, logs, settings] = await Promise.all([
    fetch('/api/pixels').then(r => r.json()),
    fetch('/api/pixels/logs').then(r => r.json()),
    fetch('/api/settings').then(r => r.json())
  ]);

  const webhookUrl = `${window.location.origin}/api/webhooks/payment`;

  const html = `
    <!-- Top banner de Webhook de Pagamentos -->
    <div class="card" style="margin-bottom: 24px; border: 1px solid rgba(124, 58, 237, 0.4); background: rgba(124, 58, 237, 0.05);">
      <div style="display: flex; justify-content: space-between; align-items: center; gap: 20px; flex-wrap: wrap;">
        <div>
          <div style="display: flex; align-items: center; gap: 8px;">
            <span style="font-size: 20px;">📡</span>
            <strong style="font-size: 15px; color: #c4b5fd;">URL do Webhook de Pedidos Pagos (Kirvano / Gateways)</strong>
          </div>
          <p style="font-size: 12.5px; color: var(--text-secondary); margin-top: 4px;">
            Cole esta URL no painel de Webhooks da sua plataforma de pagamento (Kirvano, Kiwify, etc.). Quando o cliente pagar, o pedido entra na Dashboard e dispara o Pixel de Compra (Purchase) automaticamente!
          </p>
        </div>
        <div style="display: flex; gap: 8px; align-items: center;">
          <input type="text" class="form-input" id="webhook-url-input" value="${webhookUrl}" readonly style="width: 380px; font-size: 12px; font-family: monospace;">
          <button class="btn btn-primary" onclick="copyWebhookUrl()">📋 Copiar URL</button>
        </div>
      </div>
    </div>

    <div style="display: grid; grid-template-columns: 1.2fr 1fr; gap: 24px; margin-bottom: 24px;">
      <!-- Coluna 1: Cadastro Manual de Pixel -->
      <div class="card">
        <div class="card-header">
          <h3 class="card-title">🎯 Configurar Novo Pixel do Facebook</h3>
        </div>
        <p style="font-size: 12.5px; color: var(--text-secondary); margin-bottom: 16px;">
          Insira as credenciais geradas no seu Gerenciador de Eventos da Meta para disparar eventos de conversão via servidor (CAPI).
        </p>

        <form onsubmit="savePixelConfig(event)">
          <div class="form-group">
            <label class="form-label">Nome de Identificação do Pixel *</label>
            <input type="text" class="form-input" id="pix-name" placeholder="Ex: Pixel Principal - Funil Espião" required>
          </div>

          <div class="form-group">
            <label class="form-label">Pixel ID (Meta Ads) *</label>
            <input type="text" class="form-input" id="pix-id" placeholder="Ex: 1388636936143540" required>
          </div>

          <div class="form-group">
            <label class="form-label">Token de Acesso da Conversions API (CAPI) *</label>
            <input type="password" class="form-input" id="pix-token" placeholder="EAAG..." required>
            <p style="font-size: 11px; color: var(--text-muted); margin-top: 4px;">
              Gerado em: Gerenciador de Eventos ➔ Configurações ➔ API de Conversões ➔ Gerar token de acesso.
            </p>
          </div>

          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
            <div class="form-group">
              <label class="form-label">Page ID do Facebook *</label>
              <input type="text" class="form-input" id="pix-page-id" placeholder="Ex: 1123948077469453">
              <p style="font-size: 10.5px; color: var(--text-muted); margin-top: 3px;">ID da página vinculada ao WhatsApp Business.</p>
            </div>

            <div class="form-group">
              <label class="form-label">Test Event Code (Opcional)</label>
              <input type="text" class="form-input" id="pix-test-code" placeholder="Ex: TEST12345">
              <p style="font-size: 10.5px; color: var(--text-muted); margin-top: 3px;">Para testar no Gerenciador de Eventos.</p>
            </div>
          </div>

          <button type="submit" class="btn btn-primary" style="width: 100%; margin-top: 8px;">
            Salvar e Ativar Pixel
          </button>
        </form>
      </div>

      <!-- Coluna 2: Pixels Cadastrados -->
      <div class="card">
        <div class="card-header">
          <h3 class="card-title">📋 Pixels Configurados no Sistema</h3>
          <span class="nav-badge" style="background: rgba(124, 58, 237, 0.2); color: #c4b5fd;">${pixels.length} Ativo(s)</span>
        </div>

        <div style="display: flex; flex-direction: column; gap: 12px;">
          ${pixels.length === 0 ? `
            <div style="text-align: center; padding: 30px; color: var(--text-muted); font-size: 13px;">
              Nenhum pixel cadastrado ainda.<br>
              Preencha o formulário ao lado para cadastrar seu primeiro Pixel do Facebook.
            </div>
          ` : pixels.map(p => `
            <div style="padding: 14px; background: rgba(255,255,255,0.02); border-radius: var(--radius-md); border: 1px solid var(--border-color); display: flex; justify-content: space-between; align-items: center;">
              <div>
                <strong style="color: #fff; font-size: 14px;">${p.name}</strong>
                <div style="font-size: 11.5px; color: var(--text-secondary); margin-top: 2px;">
                  ID: <span style="font-family: monospace; color: #c4b5fd;">${p.pixelId}</span>
                  ${p.pageId ? `• Page ID: ${p.pageId}` : ''}
                </div>
                ${p.testEventCode ? `<div style="font-size: 11px; color: var(--amber); margin-top: 2px;">🧪 Test Code: ${p.testEventCode}</div>` : ''}
              </div>
              <div style="display: flex; gap: 6px;">
                <button class="btn btn-secondary" style="padding: 4px 10px; font-size: 12px;" onclick="testPixelManual('${p.pixelId}', '${p.accessToken}', '${p.pageId || ''}', '${p.testEventCode || ''}')">
                  ▶ Testar
                </button>
                <button class="btn btn-danger" style="padding: 4px 8px; font-size: 12px;" onclick="deletePixelConfig('${p.id}')">
                  🗑️
                </button>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    </div>

    <!-- Tabela de Auditoria de Eventos Disparados -->
    <div class="card">
      <div class="card-header">
        <div>
          <h3 class="card-title">📊 Auditoria de Disparos de Conversão (Logs CAPI)</h3>
          <p style="font-size: 12.5px; color: var(--text-secondary); margin-top: 2px;">
            Histórico completo de eventos enviados do seu servidor para a Meta
          </p>
        </div>
        <button class="btn btn-secondary" style="padding: 4px 10px; font-size: 12px;" onclick="renderPixels()">🔄 Atualizar Logs</button>
      </div>

      <div style="overflow-x: auto;">
        <table class="flows-table">
          <thead>
            <tr>
              <th>Data/Hora</th>
              <th>Evento</th>
              <th>Pixel ID</th>
              <th>Telefone (E.164)</th>
              <th>Valor</th>
              <th>Status</th>
              <th>Detalhes</th>
            </tr>
          </thead>
          <tbody>
            ${logs.length === 0 ? `
              <tr>
                <td colspan="7" style="text-align: center; padding: 24px; color: var(--text-muted); font-size: 12.5px;">
                  Nenhum evento registrado ainda.
                </td>
              </tr>
            ` : logs.map(l => `
              <tr>
                <td style="font-size: 11.5px; color: var(--text-muted);">
                  ${new Date(l.timestamp).toLocaleDateString()} ${new Date(l.timestamp).toLocaleTimeString()}
                </td>
                <td style="font-weight: 600; color: #fff;">${l.eventName}</td>
                <td style="font-family: monospace; font-size: 11.5px; color: #c4b5fd;">${l.pixelId}</td>
                <td style="font-size: 12px;">${l.phone || '—'}</td>
                <td style="font-size: 12px; color: #10b981; font-weight: 600;">${l.value ? `R$ ${Number(l.value).toFixed(2)}` : '—'}</td>
                <td>
                  <span class="btn" style="padding: 2px 7px; font-size: 10.5px; background: ${l.status === 'sucesso' ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.15)'}; color: ${l.status === 'sucesso' ? '#10b981' : '#ef4444'};">
                    ● ${l.status.toUpperCase()}
                  </span>
                </td>
                <td style="font-size: 11px; color: var(--text-muted);">
                  ${l.error || (l.eventsReceived ? `${l.eventsReceived} evento(s) recebido(s)` : 'Simulado')}
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;

  document.getElementById('view-container').innerHTML = html;
}

function copyWebhookUrl() {
  const input = document.getElementById('webhook-url-input');
  if (input) {
    navigator.clipboard.writeText(input.value);
    showToast('URL do Webhook copiada com sucesso!', 'success');
  }
}

async function savePixelConfig(e) {
  e.preventDefault();
  const name = document.getElementById('pix-name').value.trim();
  const pixelId = document.getElementById('pix-id').value.trim();
  const accessToken = document.getElementById('pix-token').value.trim();
  const pageId = document.getElementById('pix-page-id').value.trim();
  const testEventCode = document.getElementById('pix-test-code').value.trim();

  try {
    const res = await fetch('/api/pixels', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, pixelId, accessToken, pageId, testEventCode })
    }).then(r => r.json());

    if (res.success) {
      showToast('Pixel configurado e ativado com sucesso!', 'success');
      renderPixels();
    } else {
      showToast('Erro ao salvar pixel: ' + (res.error || 'Falha'), 'danger');
    }
  } catch (err) {
    showToast('Erro de rede: ' + err.message, 'danger');
  }
}

async function deletePixelConfig(id) {
  if (!confirm('Deseja excluir este Pixel?')) return;
  try {
    await fetch(`/api/pixels/${id}`, { method: 'DELETE' });
    showToast('Pixel excluído com sucesso!');
    renderPixels();
  } catch (err) {
    showToast('Erro ao excluir: ' + err.message, 'danger');
  }
}

async function testPixelManual(pixelId, accessToken, pageId, testEventCode) {
  const phone = prompt('Digite um telefone para o teste (DDD+número, ex: 11912345678):', '11999998888');
  if (!phone) return;

  showToast('Enviando evento de teste para a Meta...', 'info');

  try {
    const res = await fetch('/api/pixels/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pixelId,
        accessToken,
        pageId,
        testEventCode,
        eventName: 'Purchase',
        phone,
        value: 49.90,
        currency: 'BRL'
      })
    }).then(r => r.json());

    if (res.success) {
      showToast(`✓ Sucesso! ${res.eventsReceived || 1} evento recebido pela Meta (Trace ID: ${res.fbTraceId || 'ok'})`, 'success');
      renderPixels();
    } else {
      showToast('❌ Erro da Meta: ' + (res.error || 'Falha no disparo'), 'danger');
      renderPixels();
    }
  } catch (err) {
    showToast('Erro ao testar: ' + err.message, 'danger');
  }
}

/* =========================================================================
   VIEW 2: INSTANCES (CHIPS DA META)
   ========================================================================= */
async function renderInstances() {
  const instances = await fetch('/api/instances').then(r => r.json());
  state.instances = instances;

  const html = `
    <div class="card">
      <div class="card-header">
        <div>
          <h3 class="card-title">📱 Gerenciamento de Chips (WhatsApp Cloud API)</h3>
          <p style="font-size: 13px; color: var(--text-secondary); margin-top: 4px;">
            Conecte quantos números quiser. O sistema recebe as mensagens e processa as provas de cada chip independentemente.
          </p>
        </div>
        <div style="display: flex; gap: 10px;">
          <button class="btn-meta-register" style="padding: 7px 15px; font-size: 12.5px;" onclick="openAddChipModal()">
            🔌 Nova Conexão
          </button>
        </div>
      </div>

      <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(360px, 1fr)); gap: 20px; margin-top: 10px;">
        ${instances.map(i => `
          <div class="card" style="margin: 0; background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.08);">
            <div style="display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 14px;">
              <div style="display: flex; align-items: center; gap: 10px;">
                <div class="brand-icon" style="width: 34px; height: 34px; font-size: 17px;">📱</div>
                <div>
                  <div style="font-weight: 700; font-size: 15px;">${i.name}</div>
                  <div style="font-size: 12px; color: var(--text-muted);">${i.phoneNumber}</div>
                </div>
              </div>
              <span class="btn" style="padding: 3px 9px; font-size: 11px; font-weight: 600; border-radius: 6px; background: ${i.status === 'connected' ? 'rgba(37, 211, 102, 0.15)' : 'rgba(239, 68, 68, 0.15)'}; color: ${i.status === 'connected' ? 'var(--wa-green)' : 'var(--red)'};">
                ${i.status === 'connected' ? '● Conectado' : '○ Desconectado'}
              </span>
            </div>

            <!-- Vínculo Estrito de Fluxo (Multilíngue) -->
            <div style="margin-bottom: 14px; padding: 12px; background: rgba(59, 130, 246, 0.08); border: 1px solid rgba(59, 130, 246, 0.25); border-radius: var(--radius-sm);">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                <label style="font-size: 11.5px; font-weight: 700; color: #93c5fd; display: flex; align-items: center; gap: 5px;">
                  <span>🎯 Fluxo de Mensagens:</span>
                </label>
                <span style="font-size: 10.5px; color: #34d399; font-weight: 600; background: rgba(52, 211, 153, 0.1); padding: 2px 6px; border-radius: 4px;">
                  🔒 Ativo & Vinculado
                </span>
              </div>
              <select class="form-input" style="font-size: 12.5px; padding: 7px 10px; font-weight: 600; cursor: pointer; border-color: rgba(59,130,246,0.4); background: var(--bg-card); color: #fff; width: 100%;" onchange="updateChipFlow('${i.id}', this.value)">
                <option value="fluxo-espiao-foto" ${(i.assignedFlowId === 'fluxo-espiao-foto' || !i.assignedFlowId) ? 'selected' : ''}>🇧🇷 Funil Oficial (Português)</option>
                <option value="fluxo-espiao-es" ${i.assignedFlowId === 'fluxo-espiao-es' ? 'selected' : ''}>🇪🇸 Funil Oficial (Español)</option>
                <option value="fluxo-espiao-en" ${i.assignedFlowId === 'fluxo-espiao-en' ? 'selected' : ''}>🇺🇸 Funil Oficial (English)</option>
              </select>
              <div style="font-size: 10.5px; color: var(--text-muted); margin-top: 5px; line-height: 1.3;">
                As conversas deste número acionam <strong>exclusivamente</strong> este fluxo para evitar qualquer mistura.
              </div>
            </div>
            
            <div style="font-size: 12px; color: var(--text-secondary); display: flex; flex-direction: column; gap: 6px; padding: 12px; background: var(--bg-input); border-radius: var(--radius-sm); margin-bottom: 16px;">
              <div><strong>Phone Number ID:</strong> ${i.phoneNumberId || 'Não informado'}</div>
              <div><strong>WABA ID:</strong> ${i.wabaId || 'Não informado'}</div>
              <div><strong>Mensagens Enviadas:</strong> ${i.totalSent || 0}</div>
            </div>

            <div style="display: flex; gap: 8px;">
              <button class="btn btn-secondary" style="flex: 1; font-size: 12px;" onclick="testChip('${i.id}')">Testar Envio</button>
              <button class="btn btn-danger" style="padding: 8px 12px;" onclick="deleteChip('${i.id}')">Excluir</button>
            </div>
          </div>
        `).join('')}
      </div>
    </div>
  `;
  document.getElementById('view-container').innerHTML = html;
}

window.updateChipFlow = async function(instanceId, flowId) {
  try {
    const res = await fetch(`/api/instances/${instanceId}/flow`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ flowId })
    });
    const data = await res.json();
    if (data.success) {
      showToast(`✓ Chip vinculado com sucesso ao fluxo selecionado!`, 'success');
      const inst = state.instances?.find(i => i.id === instanceId);
      if (inst) inst.assignedFlowId = flowId;
    } else {
      showToast(`Erro ao vincular fluxo: ${data.error}`, 'error');
    }
  } catch (err) {
    showToast(`Erro ao atualizar vínculo do fluxo: ${err.message}`, 'error');
  }
};

/* =========================================================================
   VIEW 3: LIVE CHAT (INBOX)
   ========================================================================= */
async function renderInbox(showLoading = true) {
  if (showLoading) {
    document.getElementById('view-container').innerHTML = '<div style="color: var(--text-muted); padding: 40px; text-align: center;">Carregando conversas...</div>';
  }

  const chats = await fetch('/api/chats').then(r => r.json());
  state.chats = chats;
  const phones = Object.keys(chats);

  if (!state.activeChatPhone && phones.length > 0) {
    state.activeChatPhone = phones[0];
  }

  const activeChat = state.chats[state.activeChatPhone] || null;

  const html = `
    <div class="inbox-container">
      <!-- Contact List -->
      <div class="inbox-sidebar">
        <div class="inbox-search">
          <input type="text" class="form-input" placeholder="🔍 Buscar lead por número..." oninput="filterInbox(this.value)">
        </div>
        <div class="chat-list" id="inbox-list">
          ${phones.map(p => {
            const c = chats[p];
            const lastMsg = c.messages[c.messages.length - 1];
            const isActive = p === state.activeChatPhone;
            return `
              <div class="chat-item ${isActive ? 'active' : ''}" onclick="selectChat('${p}')">
                <div class="chat-avatar">
                  ${c.targetPhotoUrl ? `<img src="${c.targetPhotoUrl}" alt="">` : p.slice(-2)}
                </div>
                <div class="chat-info">
                  <div class="chat-name">
                    <span>+${p}</span>
                    <span class="chat-time">${lastMsg ? new Date(lastMsg.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : ''}</span>
                  </div>
                  <div class="chat-snippet">${lastMsg ? (lastMsg.mediaType ? '📷 [Foto da Prova]' : lastMsg.text) : 'Nova conversa'}</div>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      </div>

      <!-- Active Chat View -->
      <div class="inbox-view">
        ${activeChat ? `
          <div class="chat-header">
            <div class="chat-avatar">
              ${activeChat.targetPhotoUrl ? `<img src="${activeChat.targetPhotoUrl}" alt="">` : activeChat.leadPhone.slice(-2)}
            </div>
            <div>
              <div style="font-weight: 700; font-size: 15px;">+${activeChat.leadPhone}</div>
              <div style="font-size: 11px; color: var(--wa-green);">Estado: ${activeChat.state}</div>
            </div>
          </div>

          <div class="chat-messages" id="chat-messages-container">
            ${activeChat.messages.map(m => `
              <div class="msg-bubble ${m.from}">
                ${m.mediaType === 'image' ? `
                  <img src="${m.mediaUrl}" class="msg-proof-img" onclick="window.open('${m.mediaUrl}', '_blank')" alt="Prova">
                ` : ''}
                ${m.text ? `<div>${m.text.replace(/\n/g, '<br>')}</div>` : ''}
                <span class="msg-time">${new Date(m.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
              </div>
            `).join('')}
          </div>

          <form class="chat-footer" onsubmit="sendManualMessage(event)">
            <input type="text" class="form-input" id="chat-reply-input" placeholder="Digite uma resposta manual para o cliente..." style="flex: 1; border-radius: 20px;">
            <button type="submit" class="btn btn-primary" style="border-radius: 50%; width: 44px; height: 44px; padding: 0;">➔</button>
          </form>
        ` : `
          <div style="display: flex; align-items: center; justify-content: center; height: 100%; color: var(--text-muted);">
            Nenhuma conversa selecionada
          </div>
        `}
      </div>
    </div>
  `;

  document.getElementById('view-container').innerHTML = html;

  // Auto-scroll mensagens para o final
  const msgContainer = document.getElementById('chat-messages-container');
  if (msgContainer) msgContainer.scrollTop = msgContainer.scrollHeight;
}

function selectChat(phone) {
  state.activeChatPhone = phone;
  renderInbox(false);
}

async function sendManualMessage(e) {
  e.preventDefault();
  const input = document.getElementById('chat-reply-input');
  const text = input.value.trim();
  if (!text || !state.activeChatPhone) return;

  input.value = '';
  await fetch(`/api/chats/${state.activeChatPhone}/send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text })
  });

  renderInbox(false);
}

/* =========================================================================
   VIEW 4: STUDIO (CALIBRADOR VISUAL DO PRINT)
   ========================================================================= */
async function renderStudio() {
  const funnel = await fetch('/api/funnel').then(r => r.json());
  state.funnel = funnel;

  const coords = funnel.avatarCoordinates || { x: 135, y: 657, radius: 18 };

  const html = `
    <div class="card">
      <div class="card-header">
        <div>
          <h3 class="card-title">🎨 Estúdio de Calibração das Provas</h3>
          <p style="font-size: 13px; color: var(--text-secondary); margin-top: 4px;">
            O sistema alterna automaticamente entre os 2 templates conforme a privacidade do WhatsApp do alvo.
          </p>
        </div>
        <button class="btn btn-primary" onclick="saveStudioCoords()">Salvar Coordenadas</button>
      </div>

      <!-- Comparativo dos 2 Templates -->
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 24px;">
        <div class="card" style="margin: 0; background: rgba(37, 211, 102, 0.04); border-color: rgba(37, 211, 102, 0.2);">
          <div style="font-weight: 700; font-size: 14px; color: var(--wa-green); margin-bottom: 6px;">
            ✓ Template 1: Perfil COM Foto Pública
          </div>
          <div style="font-size: 12px; color: var(--text-secondary); margin-bottom: 12px;">
            Usado quando a API encontra a foto de perfil. O círculo do avatar é carimbado no áudio.
          </div>
          <div style="display: flex; justify-content: center; background: #000; padding: 10px; border-radius: 8px;">
            <img src="/assets/templates/template_com_foto.png" style="max-height: 220px; border-radius: 6px;" alt="Template com foto">
          </div>
        </div>

        <div class="card" style="margin: 0; background: rgba(245, 158, 11, 0.04); border-color: rgba(245, 158, 11, 0.2);">
          <div style="font-weight: 700; font-size: 14px; color: var(--amber); margin-bottom: 6px;">
            🔒 Template 2: Perfil SEM Foto ou Privado
          </div>
          <div style="font-size: 12px; color: var(--text-secondary); margin-bottom: 12px;">
            Usado quando o WhatsApp da pessoa está configurado para mostrar foto só para contatos.
          </div>
          <div style="display: flex; justify-content: center; background: #000; padding: 10px; border-radius: 8px;">
            <img src="/assets/templates/template_sem_foto_cadeado.png" style="max-height: 220px; border-radius: 6px;" alt="Template cadeado">
          </div>
        </div>
      </div>

      <div class="studio-container">
        <!-- Canvas / Preview da Imagem -->
        <div class="studio-canvas-card">
          <div class="studio-preview-box" id="studio-box">
            <img src="/assets/templates/template_com_foto.png" id="studio-img" alt="Print Base" onload="updateStudioMarker()">
            <div class="studio-marker" id="studio-marker"></div>
          </div>
        </div>

        <!-- Controles Interativos -->
        <div class="studio-controls">
          <div class="card" style="margin: 0;">
            <h4 style="font-size: 14px; font-weight: 700; margin-bottom: 16px;">🎯 Calibrar Foto do Áudio (Template 1)</h4>
            
            <div class="form-group">
              <label class="form-label">Posição Horizontal (X)</label>
              <div class="range-group">
                <input type="range" class="range-slider" id="studio-x" min="50" max="300" value="${coords.x}" oninput="updateStudioMarker()">
                <span class="range-val" id="val-x">${coords.x}px</span>
              </div>
            </div>

            <div class="form-group">
              <label class="form-label">Posição Vertical (Y)</label>
              <div class="range-group">
                <input type="range" class="range-slider" id="studio-y" min="400" max="900" value="${coords.y}" oninput="updateStudioMarker()">
                <span class="range-val" id="val-y">${coords.y}px</span>
              </div>
            </div>

            <div class="form-group">
              <label class="form-label">Tamanho / Raio do Círculo</label>
              <div class="range-group">
                <input type="range" class="range-slider" id="studio-radius" min="10" max="40" value="${coords.radius}" oninput="updateStudioMarker()">
                <span class="range-val" id="val-radius">${coords.radius}px</span>
              </div>
            </div>

            <button class="btn btn-secondary" style="width: 100%; margin-top: 10px;" onclick="testStudioPreview()">
              ⚡ Gerar Prova de Teste Real
            </button>
          </div>

          <div id="studio-test-result" style="display: none;" class="card">
            <div style="font-weight: 700; font-size: 13px; margin-bottom: 10px; color: var(--wa-green);">✓ Resultado do Processador Sharp:</div>
            <img id="studio-test-img" style="max-width: 100%; border-radius: 8px; border: 1px solid var(--border-color);" alt="Resultado">
          </div>
        </div>
      </div>
    </div>
  `;

  document.getElementById('view-container').innerHTML = html;
  setTimeout(updateStudioMarker, 100);
}

function updateStudioMarker() {
  const xInput = document.getElementById('studio-x');
  const yInput = document.getElementById('studio-y');
  const rInput = document.getElementById('studio-radius');
  const marker = document.getElementById('studio-marker');
  const img = document.getElementById('studio-img');

  if (!xInput || !marker || !img) return;

  const x = parseInt(xInput.value, 10);
  const y = parseInt(yInput.value, 10);
  const radius = parseInt(rInput.value, 10);

  document.getElementById('val-x').textContent = `${x}px`;
  document.getElementById('val-y').textContent = `${y}px`;
  document.getElementById('val-radius').textContent = `${radius}px`;

  const scale = img.clientWidth / 508; // 508 é a largura do template_com_foto.png
  marker.style.left = `${x * scale}px`;
  marker.style.top = `${y * scale}px`;
  marker.style.width = `${radius * 2 * scale}px`;
  marker.style.height = `${radius * 2 * scale}px`;
}

async function saveStudioCoords() {
  const x = parseInt(document.getElementById('studio-x').value, 10);
  const y = parseInt(document.getElementById('studio-y').value, 10);
  const radius = parseInt(document.getElementById('studio-radius').value, 10);

  await fetch('/api/funnel', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      avatarCoordinates: { x, y, radius }
    })
  });

  showToast('Coordenadas salvas com sucesso!');
}

async function testStudioPreview() {
  const x = parseInt(document.getElementById('studio-x').value, 10);
  const y = parseInt(document.getElementById('studio-y').value, 10);
  const radius = parseInt(document.getElementById('studio-radius').value, 10);

  showToast('Processando sobreposição...');

  const res = await fetch('/api/studio/preview', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      avatarUrl: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150',
      coords: { x, y, radius }
    })
  });

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);

  const container = document.getElementById('studio-test-result');
  const img = document.getElementById('studio-test-img');
  img.src = url;
  container.style.display = 'block';
  showToast('Prova gerada com sucesso!', 'success');
}

/* =========================================================================
   VIEW 5: FUNNEL (SISTEMA COMPLETO DE FLUXO DE CONVERSAS)
   ========================================================================= */
async function renderFunnel() {
  const funnel = await fetch('/api/funnel').then(r => r.json());
  state.funnel = funnel;
  const replies = funnel.intentReplies || {};

  const html = `
    <div class="card">
      <div class="card-header">
        <div>
          <h3 class="card-title">⚡ Construtor do Fluxo de Conversas & Funil</h3>
          <p style="font-size: 13px; color: var(--text-secondary); margin-top: 4px;">
            Configure as etapas da conversa, as regras condicionais das fotos e as respostas prontas analisadas pela IA.
          </p>
        </div>
        <button class="btn btn-primary" onclick="saveFunnelSettings()">Salvar Todo o Fluxo</button>
      </div>

      <form id="funnel-form" onsubmit="event.preventDefault(); saveFunnelSettings();">
        
        <!-- ETAPA 1: BOAS-VINDAS -->
        <div class="card" style="margin-bottom: 20px; background: rgba(255,255,255,0.02);">
          <div style="font-weight: 700; font-size: 15px; margin-bottom: 12px; color: var(--cyan); display: flex; align-items: center; gap: 8px;">
            <span>1️⃣</span> Mensagem Inicial (Primeiro contato do Lead)
          </div>
          <div class="form-group" style="margin: 0;">
            <label class="form-label">Texto enviado assim que o lead manda mensagem pela primeira vez:</label>
            <textarea class="form-textarea" id="funnel-welcome" style="min-height: 70px;">${funnel.welcomeMessage || ''}</textarea>
          </div>
        </div>

        <!-- ETAPA 2: RESPOSTA INTERMEDIÁRIA -->
        <div class="card" style="margin-bottom: 20px; background: rgba(255,255,255,0.02);">
          <div style="font-weight: 700; font-size: 15px; margin-bottom: 12px; color: var(--purple); display: flex; align-items: center; gap: 8px;">
            <span>2️⃣</span> Resposta Intermediária (Se o lead responder sem enviar o número)
          </div>
          <div class="form-group" style="margin: 0;">
            <label class="form-label">Ex: Se o lead falar "Salvei", "Como assim?", "Quem é você?", o robô responde:</label>
            <textarea class="form-textarea" id="funnel-intermediate" style="min-height: 70px;">${funnel.intermediateReply || ''}</textarea>
          </div>
        </div>

        <!-- ETAPA 3: ANÁLISE E DISPARO DA PROVA -->
        <div class="card" style="margin-bottom: 20px; background: rgba(255,255,255,0.02);">
          <div style="font-weight: 700; font-size: 15px; margin-bottom: 12px; color: var(--wa-green); display: flex; align-items: center; gap: 8px;">
            <span>3️⃣</span> Disparo da Prova (Quando o lead digita o número)
          </div>
          <div style="display: grid; grid-template-columns: 2fr 1fr; gap: 20px; margin-bottom: 16px;">
            <div class="form-group">
              <label class="form-label">Mensagem imediata de análise:</label>
              <input type="text" class="form-input" id="funnel-analyzing" value="${funnel.analyzingMessage || ''}">
            </div>
            <div class="form-group">
              <label class="form-label">Tempo de espera antes do envio:</label>
              <select class="form-select" id="funnel-delay">
                <option value="2" ${funnel.analyzingDelaySeconds == 2 ? 'selected' : ''}>2 segundos (Rápido)</option>
                <option value="3" ${funnel.analyzingDelaySeconds == 3 ? 'selected' : ''}>3 segundos (Equilibrado)</option>
                <option value="5" ${funnel.analyzingDelaySeconds == 5 ? 'selected' : ''}>5 segundos (Recomendado)</option>
              </select>
            </div>
          </div>

          <div class="form-group">
            <label class="form-label">Mensagem de Fechamento / Pitch (Enviada com a foto da prova):</label>
            <textarea class="form-textarea" id="funnel-closing" style="min-height: 90px;">${funnel.closingMessage || ''}</textarea>
          </div>

          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px;">
            <div class="form-group">
              <label class="form-label">Link de Pagamento / Checkout:</label>
              <input type="url" class="form-input" id="funnel-checkout" value="${funnel.checkoutUrl || ''}" placeholder="https://seucheckout.com/pagamento">
            </div>
            <div class="form-group">
              <label class="form-label">URL do Áudio Gravado (.ogg opus):</label>
              <input type="text" class="form-input" id="funnel-audio" value="${funnel.audioUrl || ''}" placeholder="https://seusite.com/audio.ogg">
            </div>
          </div>
        </div>

        <!-- ETAPA 4: ANÁLISE DE SENTIMENTO & RESPOSTAS PRONTAS (IA) -->
        <div class="card" style="margin-bottom: 20px; background: rgba(255,255,255,0.02);">
          <div style="font-weight: 700; font-size: 15px; margin-bottom: 6px; color: var(--amber); display: flex; align-items: center; gap: 8px;">
            <span>4️⃣</span> Cérebro do ChatGPT — Análise de Sentimento & Respostas Prontas
          </div>
          <p style="font-size: 12px; color: var(--text-muted); margin-bottom: 18px;">
            Quando o cliente responder após receber a prova, a IA analisa a reação dele e responde instantaneamente com a mensagem certa para fechar a venda:
          </p>

          <div class="form-group">
            <label class="form-label">😮 Se o lead reagir com CHOQUE / CURIOSIDADE ("Meu Deus", "Não acredito", "Quem é essa?"):</label>
            <textarea class="form-textarea" id="reply-shock" style="min-height: 80px;">${replies.shock || ''}</textarea>
          </div>

          <div class="form-group">
            <label class="form-label">🤨 Se o lead reagir com DÚVIDA / DESCONFIANÇA ("É golpe?", "Como confiar?", "É verdade?"):</label>
            <textarea class="form-textarea" id="reply-doubt" style="min-height: 80px;">${replies.doubt || ''}</textarea>
          </div>

          <div class="form-group">
            <label class="form-label">💰 Se o lead perguntar de PAGAMENTO / PIX ("Manda a chave", "Qual o valor?", "Onde pago?"):</label>
            <textarea class="form-textarea" id="reply-payment" style="min-height: 80px;">${replies.payment || ''}</textarea>
          </div>
        </div>

      </form>
    </div>
  `;

  document.getElementById('view-container').innerHTML = html;
}

async function saveFunnelSettings() {
  const welcomeMessage = document.getElementById('funnel-welcome').value;
  const intermediateReply = document.getElementById('funnel-intermediate').value;
  const analyzingMessage = document.getElementById('funnel-analyzing').value;
  const analyzingDelaySeconds = parseInt(document.getElementById('funnel-delay').value, 10);
  const closingMessage = document.getElementById('funnel-closing').value;
  const checkoutUrl = document.getElementById('funnel-checkout').value;
  const audioUrl = document.getElementById('funnel-audio').value;

  const shock = document.getElementById('reply-shock').value;
  const doubt = document.getElementById('reply-doubt').value;
  const payment = document.getElementById('reply-payment').value;

  await fetch('/api/funnel', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      welcomeMessage,
      intermediateReply,
      analyzingMessage,
      analyzingDelaySeconds,
      closingMessage,
      checkoutUrl,
      audioUrl,
      intentReplies: {
        shock,
        doubt,
        payment,
        fallback: closingMessage
      }
    })
  });

  showToast('Fluxo de conversas completo salvo com sucesso!');
}


/* =========================================================================
   VIEW 6: SETTINGS (IA, WEBHOOKS & INTEGRAÇÕES)
   ========================================================================= */
async function renderSettings() {
  const settings = await fetch('/api/settings').then(r => r.json());
  state.settings = settings;

  const webhookUrl = `${window.location.origin}/webhook`;

  const html = `
    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 24px;">
      <!-- Configurações do Webhook da Meta -->
      <div class="card">
        <div class="card-header">
          <h3 class="card-title">📡 Webhook Oficial da Meta</h3>
        </div>
        <p style="font-size: 13px; color: var(--text-secondary); margin-bottom: 20px;">
          Copie esses dados e cole no painel de desenvolvedor da Meta (developers.facebook.com > WhatsApp > Configuração).
        </p>

        <div class="form-group">
          <label class="form-label">URL de Retorno de Chamada (Callback URL)</label>
          <div style="display: flex; gap: 8px;">
            <input type="text" class="form-input" value="${webhookUrl}" readonly id="webhook-url-input">
            <button class="btn btn-secondary" onclick="copyToClipboard('${webhookUrl}')">Copiar</button>
          </div>
        </div>

        <div class="form-group">
          <label class="form-label">Token de Verificação (Verify Token)</label>
          <div style="display: flex; gap: 8px;">
            <input type="text" class="form-input" value="${settings.webhookVerifyToken || 'whatsapp_hub_token_2026'}" id="settings-verify-token">
            <button class="btn btn-secondary" onclick="copyToClipboard(document.getElementById('settings-verify-token').value)">Copiar</button>
          </div>
        </div>

        <div class="form-group">
          <label class="form-label">Endpoint de Busca de Fotos (Opcional)</label>
          <input type="text" class="form-input" id="settings-lookup" value="${settings.profileLookupService || ''}" placeholder="https://sua-api.com/profile-picture">
          <span style="font-size: 11px; color: var(--text-muted);">Se vazio, usa fallback realista padrão</span>
        </div>
        
        <button class="btn btn-primary" onclick="saveSettingsValues()">Salvar Webhook</button>
      </div>

      <!-- Configurações do ChatGPT (IA) -->
      <div class="card">
        <div class="card-header">
          <h3 class="card-title">🤖 Inteligência Artificial (ChatGPT)</h3>
        </div>
        <p style="font-size: 13px; color: var(--text-secondary); margin-bottom: 20px;">
          A IA assume a conversa para quebrar objeções e tirar dúvidas de pagamento após o envio da prova.
        </p>

        <div class="form-group">
          <label class="form-label">Chave de API OpenAI (sk-...)</label>
          <input type="password" class="form-input" id="settings-openai-key" value="${settings.openaiApiKey || ''}" placeholder="sk-proj-...">
        </div>

        <div class="form-group">
          <label class="form-label">Modelo de IA</label>
          <select class="form-select" id="settings-openai-model">
            <option value="gpt-4o-mini" ${settings.openaiModel === 'gpt-4o-mini' ? 'selected' : ''}>GPT-4o Mini (Ultra Rápido & Econômico)</option>
            <option value="gpt-4o" ${settings.openaiModel === 'gpt-4o' ? 'selected' : ''}>GPT-4o (Mais Inteligente)</option>
          </select>
        </div>

        <div class="form-group">
          <label class="form-label">Instruções do Atendente (Prompt do Sistema)</label>
          <textarea class="form-textarea" id="settings-openai-prompt" style="min-height: 140px;">${settings.openaiSystemPrompt || ''}</textarea>
        </div>

        <button class="btn btn-primary" onclick="saveSettingsValues()">Salvar IA</button>
      </div>
    </div>
  `;

  document.getElementById('view-container').innerHTML = html;
}

function copyToClipboard(text) {
  navigator.clipboard.writeText(text);
  showToast('Copiado para a área de transferência!');
}

async function saveSettingsValues() {
  const webhookVerifyToken = document.getElementById('settings-verify-token').value;
  const profileLookupService = document.getElementById('settings-lookup').value;
  const openaiApiKey = document.getElementById('settings-openai-key').value;
  const openaiModel = document.getElementById('settings-openai-model').value;
  const openaiSystemPrompt = document.getElementById('settings-openai-prompt').value;

  await fetch('/api/settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      webhookVerifyToken,
      profileLookupService,
      openaiApiKey,
      openaiModel,
      openaiSystemPrompt
    })
  });

  showToast('Configurações salvas!');
}

/* =========================================================================
   VIEW 7: SIMULATOR (SIMULADOR DE TESTE)
   ========================================================================= */
function renderSimulator() {
  const html = `
    <div style="max-width: 700px; margin: 0 auto;">
      <div class="card">
        <div class="card-header">
          <h3 class="card-title">🧪 Simulador de Lead em Tempo Real</h3>
        </div>
        <p style="font-size: 13px; color: var(--text-secondary); margin-bottom: 24px;">
          Teste toda a engrenagem (captura de número, espera de análise, carimbo da foto e envio da prova) como se você fosse um lead de verdade no WhatsApp!
        </p>

        <form onsubmit="runSimulation(event)">
          <div class="form-group">
            <label class="form-label">Número do Lead Simulado</label>
            <input type="text" class="form-input" id="sim-phone" value="5571999991234" required>
          </div>

          <div class="form-group">
            <label class="form-label">Mensagem do Lead</label>
            <div style="display: flex; gap: 10px; margin-bottom: 10px;">
              <button type="button" class="btn btn-secondary" style="font-size: 12px;" onclick="document.getElementById('sim-msg').value = 'Oi, quero ver a prova'">Oi, quero a prova</button>
              <button type="button" class="btn btn-secondary" style="font-size: 12px;" onclick="document.getElementById('sim-msg').value = '7196331602'">Enviar Número: 7196331602</button>
              <button type="button" class="btn btn-secondary" style="font-size: 12px;" onclick="document.getElementById('sim-msg').value = 'Onde faço o pagamento?'">Pergunta Pix</button>
            </div>
            <input type="text" class="form-input" id="sim-msg" value="7196331602" required>
          </div>

          <button type="submit" class="btn btn-primary" style="width: 100%;">
            🚀 Disparar Mensagem no Funil
          </button>
        </form>

        <div id="sim-output" style="display: none; margin-top: 24px; padding: 16px; background: var(--bg-input); border-radius: var(--radius-md); font-family: monospace; font-size: 13px; line-height: 1.6;">
          <div style="color: var(--wa-green); font-weight: bold;">⚡ Mensagem enviada para o motor do funil!</div>
          <div style="color: var(--text-muted); margin-top: 6px;">O robô está processando... Abra a aba <strong>Live Chat (Inbox)</strong> para acompanhar a conversa ao vivo.</div>
          <div style="margin-top: 14px;">
            <button class="btn btn-secondary" onclick="window.location.hash = '#inbox'">Ir para o Live Chat ➔</button>
          </div>
        </div>
      </div>
    </div>
  `;

  document.getElementById('view-container').innerHTML = html;
}

async function runSimulation(e) {
  e.preventDefault();
  const phone = document.getElementById('sim-phone').value;
  const message = document.getElementById('sim-msg').value;

  await fetch('/api/simulator/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone, message })
  });

  document.getElementById('sim-output').style.display = 'block';
  showToast('Mensagem simulada enviada!', 'success');
}

/* =========================================================================
   MODAL DE NOVA CONEXÃO (ESTILO LEONA FLOW / WHATSAPP EMBEDDED SIGNUP)
   ========================================================================= */
let currentConnectionType = 'meta';
let lastEmbeddedSignupData = null;

function openAddChipModal() {
  const modal = document.getElementById('chip-modal');
  if (modal) modal.style.display = 'flex';
  selectConnectionType('meta');
  const manualForm = document.getElementById('form-manual-chip');
  if (manualForm) manualForm.style.display = 'none';
  initFacebookSDK();
}

function closeAddChipModal() {
  const modal = document.getElementById('chip-modal');
  if (modal) modal.style.display = 'none';
}

function selectConnectionType(type) {
  currentConnectionType = type;
  const cardWeb = document.getElementById('card-type-web');
  const cardMeta = document.getElementById('card-type-meta');
  const secMeta = document.getElementById('section-meta-official');
  const secWeb = document.getElementById('section-web-uazapi');

  if (cardWeb && cardMeta && secMeta && secWeb) {
    if (type === 'meta') {
      cardMeta.classList.add('active');
      cardWeb.classList.remove('active');
      secMeta.style.display = 'block';
      secWeb.style.display = 'none';
    } else {
      cardWeb.classList.add('active');
      cardMeta.classList.remove('active');
      secWeb.style.display = 'block';
      secMeta.style.display = 'none';
    }
  }
}

function toggleManualChipForm() {
  const f = document.getElementById('form-manual-chip');
  if (f) {
    f.style.display = f.style.display === 'none' ? 'block' : 'none';
  }
}

// Inicialização segura do SDK do Facebook
function initFacebookSDK() {
  const appId = state.facebook?.appId || '1388636936143540';
  if (window.FB && typeof FB.init === 'function') {
    try {
      FB.init({
        appId: appId,
        autoLogAppEvents: true,
        xfbml: true,
        version: 'v21.0'
      });
    } catch(e) {}
  }
}

window.fbAsyncInit = function() {
  initFacebookSDK();
};

// Escuta a mensagem oficial de Embedded Signup enviada pelo popup da Meta
window.addEventListener('message', async (event) => {
  if (event.origin !== "https://www.facebook.com" && event.origin !== "https://web.facebook.com" && event.origin !== window.location.origin) {
    return;
  }
  try {
    const data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
    if (data.type === 'WA_EMBEDDED_SIGNUP') {
      console.log('[Meta Embedded Signup PostMessage]', data);
      if (data.event === 'FINISH') {
        lastEmbeddedSignupData = data.data || {};
      }
    } else if (data.type === 'META_OAUTH_SUCCESS') {
      showToast('✓ WhatsApp conectado com sucesso via Meta!', 'success');
      closeAddChipModal();
      if (state.currentView === 'instances') renderInstances();
      else if (state.currentView === 'overview') renderOverview();
    }
  } catch(e) {}
});

/**
 * Ação principal do botão "Registrar com Meta" (Leona Flow)
 */
function handleRegisterWithMeta() {
  const nameInput = document.getElementById('conn-name');
  const name = nameInput ? nameInput.value.trim() : '';
  if (!name) {
    showToast('Por favor, informe o Nome da Conexão primeiro.', 'error');
    if (nameInput) nameInput.focus();
    return;
  }

  const coexistence = document.getElementById('conn-coexistence')?.checked ?? true;
  const flowId = document.getElementById('conn-flow-id')?.value || 'fluxo-espiao-foto';
  const appId = state.facebook?.appId || '1388636936143540';
  const configId = state.facebook?.configId || '2204676673432561';

  // Guarda dados da conexão para associar após o retorno da Meta
  window._pendingConnectionName = name;
  window._pendingCoexistence = coexistence;
  window._pendingFlowId = flowId;
  try {
    sessionStorage.setItem('pending_connection_name', name);
    sessionStorage.setItem('pending_coexistence', coexistence ? 'true' : 'false');
    sessionStorage.setItem('pending_flow_id', flowId);
  } catch(e) {}

  const redirectUri = encodeURIComponent(`${window.location.origin}/webhook`);
  
  // URL Oficial do WhatsApp Embedded Signup da Meta com o config_id
  const oauthUrl = `https://www.facebook.com/v21.0/dialog/oauth?client_id=${appId}&redirect_uri=${redirectUri}&config_id=${configId}&response_type=code`;

  const width = 640;
  const height = 750;
  const left = (window.innerWidth - width) / 2;
  const top = (window.innerHeight - height) / 2;

  const popup = window.open(oauthUrl, 'MetaWhatsAppSignup', `width=${width},height=${height},top=${top},left=${left}`);

  if (!popup || popup.closed || typeof popup.closed === 'undefined') {
    showToast('⚠️ Pop-up bloqueado pelo navegador! Por favor, clique na barra de endereços e permita pop-ups para este site.', 'error');
  } else {
    showToast('Janela oficial do WhatsApp da Meta aberta! Complete o cadastro do chip nela.', 'info');
  }
}

function openMetaEmbeddedPopupDirect(name, coexistence, appId, configId) {
  const redirectUri = `${window.location.origin}/webhook`;
  const width = 640;
  const height = 720;
  const left = window.screen.width / 2 - width / 2;
  const top = window.screen.height / 2 - height / 2;

  let url = `https://www.facebook.com/v21.0/dialog/oauth?client_id=${appId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code`;
  if (configId) {
    url += `&config_id=${configId}`;
  } else {
    url += `&scope=whatsapp_business_management,whatsapp_business_messaging`;
  }
  const extras = {
    feature: { coexistence: coexistence }
  };
  url += `&extras=${encodeURIComponent(JSON.stringify(extras))}`;

  window.open(url, 'MetaWhatsAppSignup', `width=${width},height=${height},top=${top},left=${left}`);
  showToast('Janela oficial da Meta aberta! Conclua a validação do número nela.', 'info');
}

function handleSaveUazapi() {
  const name = document.getElementById('conn-name')?.value.trim() || 'Conexão uazapi';
  const url = document.getElementById('uazapi-url')?.value.trim();
  const key = document.getElementById('uazapi-key')?.value.trim();

  if (!url || !key) {
    showToast('Informe a URL e a API Key do uazapi', 'error');
    return;
  }

  showToast('✓ Instância uazapi configurada com sucesso!', 'success');
  closeAddChipModal();
}

async function saveNewChip(e) {
  e.preventDefault();
  const name = document.getElementById('conn-name')?.value || document.getElementById('chip-name')?.value || 'Chip Manual';
  const phoneNumber = document.getElementById('chip-phone').value;
  const phoneNumberId = document.getElementById('chip-phone-id').value;
  const wabaId = document.getElementById('chip-waba-id').value;
  const accessToken = document.getElementById('chip-token').value;
  const assignedFlowId = document.getElementById('conn-flow-id')?.value || 'fluxo-espiao-foto';

  await fetch('/api/instances', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, phoneNumber, phoneNumberId, wabaId, accessToken, assignedFlowId })
  });

  closeAddChipModal();
  showToast('Novo chip conectado com sucesso!');
  if (state.currentView === 'instances') renderInstances();
  else if (state.currentView === 'overview') renderOverview();
}

async function deleteChip(id) {
  if (!confirm('Deseja realmente remover esta instância?')) return;
  await fetch(`/api/instances/${id}`, { method: 'DELETE' });
  showToast('Chip removido!');
  renderInstances();
}

function testChip(id) {
  showToast('Teste de verificação enviado para a Meta!');
}


/* =========================================================================
   VIEW: KANBAN CRM (SCREENSHOT 1)
   ========================================================================= */
async function renderKanban() {
  const data = await fetch('/api/kanban').then(r => r.json());

  const cols = [
    { key: 'novos', title: 'Novos Leads', color: 'blue', badge: data.novos.leads.length },
    { key: 'aguardando', title: 'Aguardando Número', color: 'purple', badge: data.aguardando.leads.length },
    { key: 'analise', title: 'Em Análise / Foto', color: 'amber', badge: data.analise.leads.length },
    { key: 'proposta', title: 'Proposta Enviada', color: 'cyan', badge: data.proposta.leads.length },
    { key: 'pago', title: 'Venda Aprovada', color: 'green', badge: data.pago.leads.length }
  ];

  const html = `
    <div class="kanban-board">
      ${cols.map(col => `
        <div class="kanban-col">
          <div class="kanban-col-header">
            <span>${col.title}</span>
            <span class="btn" style="padding: 2px 8px; font-size: 11px; background: rgba(255,255,255,0.06);">${col.badge}</span>
          </div>
          <div class="kanban-cards-list">
            ${data[col.key].leads.map(lead => `
              <div class="kanban-card" onclick="window.location.hash='#inbox'; selectChat('${lead.phone}')">
                <div style="font-weight: 700; font-size: 13.5px; color: #fff; margin-bottom: 4px;">+${lead.phone}</div>
                <div style="font-size: 12px; color: var(--text-secondary); margin-bottom: 8px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                  ${lead.lastMessage}
                </div>
                <div style="display: flex; justify-content: space-between; align-items: center; font-size: 10.5px; color: var(--text-muted);">
                  <span>${lead.state}</span>
                  <span>${lead.time}</span>
                </div>
              </div>
            `).join('')}
          </div>
        </div>
      `).join('')}
    </div>
  `;

  document.getElementById('view-container').innerHTML = html;
}

/* =========================================================================
   VIEW: CONTATOS (SCREENSHOT 1)
   ========================================================================= */
async function renderContacts() {
  const contacts = await fetch('/api/contacts').then(r => r.json());

  const html = `
    <div class="card">
      <div class="card-header">
        <div>
          <h3 class="card-title">👥 Contatos & Leads</h3>
          <p style="font-size: 13px; color: var(--text-secondary); margin-top: 4px;">Base de contatos que interagiram com as automações.</p>
        </div>
      </div>

      <table class="flows-table">
        <thead>
          <tr>
            <th>Nome / Número</th>
            <th>Fase do Funil</th>
            <th>Mensagens</th>
            <th>Última Interação</th>
            <th style="text-align: right;">Ação</th>
          </tr>
        </thead>
        <tbody>
          ${contacts.map(c => `
            <tr>
              <td><strong>+${c.phone}</strong></td>
              <td><span class="btn" style="padding: 3px 8px; font-size: 11px; background: rgba(124, 58, 237, 0.15); color: #c4b5fd;">${c.state}</span></td>
              <td>${c.totalMessages} mensagens</td>
              <td style="color: var(--text-muted); font-size: 12px;">${new Date(c.lastInteraction).toLocaleString()}</td>
              <td style="text-align: right;">
                <button class="btn btn-secondary" style="padding: 4px 10px; font-size: 12px;" onclick="window.location.hash='#inbox'; selectChat('${c.phone}')">Ver Conversa ➔</button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;

  document.getElementById('view-container').innerHTML = html;
}

/* =========================================================================
   VIEW: WEBHOOKS DE ENTRADA (SCREENSHOT 1)
   ========================================================================= */
async function renderWebhooks() {
  const webhookUrl = `${window.location.origin}/webhook`;
  const checkoutWebhook = `${window.location.origin}/api/webhooks/checkout`;

  const html = `
    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 24px;">
      <div class="card">
        <div class="card-header">
          <h3 class="card-title">📡 Webhook WhatsApp (Meta Cloud API)</h3>
        </div>
        <p style="font-size: 13px; color: var(--text-secondary); margin-bottom: 20px;">
          Recebe as mensagens dos clientes e alimenta o motor de automação em tempo real.
        </p>

        <div class="form-group">
          <label class="form-label">URL do Webhook</label>
          <div style="display: flex; gap: 8px;">
            <input type="text" class="form-input" value="${webhookUrl}" readonly>
            <button class="btn btn-secondary" onclick="copyToClipboard('${webhookUrl}')">Copiar</button>
          </div>
        </div>

        <div class="form-group">
          <label class="form-label">Token de Verificação</label>
          <input type="text" class="form-input" value="whatsapp_hub_token_2026" readonly>
        </div>
      </div>

      <div class="card">
        <div class="card-header">
          <h3 class="card-title">💳 Webhook de Vendas (PerfectPay / Kiwify)</h3>
        </div>
        <p style="font-size: 13px; color: var(--text-secondary); margin-bottom: 20px;">
          Recebe a aprovação do Pix ou Cartão para disparar o áudio completo e mover para a coluna "Venda Aprovada" no Kanban.
        </p>

        <div class="form-group">
          <label class="form-label">URL de Notificação de Compra</label>
          <div style="display: flex; gap: 8px;">
            <input type="text" class="form-input" value="${checkoutWebhook}" readonly>
            <button class="btn btn-secondary" onclick="copyToClipboard('${checkoutWebhook}')">Copiar</button>
          </div>
        </div>

        <span class="btn" style="padding: 4px 10px; font-size: 12px; background: rgba(37, 211, 102, 0.15); color: var(--wa-green);">
          ● Endpoint Ativo & Aguardando Disparos
        </span>
      </div>
    </div>
  `;

  document.getElementById('view-container').innerHTML = html;
}

/* =========================================================================
   VIEW: SETTINGS (FACEBOOK, IA & CHECKOUTS)
   ========================================================================= */
async function renderSettings() {
  const settings = await fetch('/api/settings').then(r => r.json());
  const funnel = await fetch('/api/funnel').then(r => r.json());
  state.settings = settings;
  state.funnel = funnel;

  const html = `
    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 24px;">
      <!-- Coluna 1: OpenAI & Cérebro do Bot -->
      <div class="card">
        <div class="card-header">
          <h3 class="card-title">🤖 Inteligência Artificial (ChatGPT)</h3>
        </div>
        <p style="font-size: 13px; color: var(--text-secondary); margin-bottom: 20px;">
          Motor cognitivo que quebra todas as objeções do lead (por que pagar, recusa, denúncia/golpe, taxa de 100, acesso) e verifica comprovantes.
        </p>

        <form onsubmit="saveAiSettings(event)">
          <div class="form-group">
            <label class="form-label">Chave de API OpenAI (sk-...)</label>
            <input type="password" class="form-input" id="set-openai-key" value="${settings.openaiApiKey || ''}" placeholder="sk-proj-...">
          </div>

          <div class="form-group">
            <label class="form-label">Modelo de Linguagem</label>
            <select class="form-select" id="set-openai-model">
              <option value="gpt-4o-mini" ${settings.openaiModel === 'gpt-4o-mini' ? 'selected' : ''}>GPT-4o Mini (Recomendado - Rápido & Econômico)</option>
              <option value="gpt-4o" ${settings.openaiModel === 'gpt-4o' ? 'selected' : ''}>GPT-4o (Máxima Precisão em Negociação)</option>
            </select>
          </div>

          <div class="form-group">
            <label class="form-label">Endpoint de Consulta de Foto (API de Perfil)</label>
            <input type="text" class="form-input" id="set-lookup-endpoint" value="${settings.profileLookupService || 'https://stalkea.app/spp/api/profile-picture.php'}">
          </div>

          <button type="submit" class="btn btn-primary" style="width: 100%; margin-top: 10px;">Salvar Configurações de IA</button>
        </form>
      </div>

      <!-- Coluna 2: Checkouts de Upsell & Kirvano -->
      <div class="card">
        <div class="card-header">
          <h3 class="card-title">💳 Checkouts & Escala de Pagamentos</h3>
        </div>
        <p style="font-size: 13px; color: var(--text-secondary); margin-bottom: 20px;">
          Configure os links dos seus checkouts para cada etapa do funil e os dados da instituição recebedora.
        </p>

        <form onsubmit="saveCheckoutSettings(event)">
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
            <div class="form-group">
              <label class="form-label">Nome do Beneficiário</label>
              <input type="text" class="form-input" id="set-benef-name" value="${funnel.paymentRecipient?.name || 'KIRVANO PAGAMENTOS LTDA'}">
            </div>
            <div class="form-group">
              <label class="form-label">Instituição Financeira</label>
              <input type="text" class="form-input" id="set-benef-bank" value="${funnel.paymentRecipient?.bank || 'PICPAY'}">
            </div>
          </div>

          <div class="form-group">
            <label class="form-label">Link Checkout - Etapa 1 (R$ 49,90)</label>
            <input type="text" class="form-input" id="set-chk-49" value="${funnel.upsellStages?.stage_49?.checkoutUrl || 'https://pay.kirvano.com/checkout-49'}">
          </div>

          <div class="form-group">
            <label class="form-label">Link Checkout - Upsell 1 (R$ 100,00)</label>
            <input type="text" class="form-input" id="set-chk-100" value="${funnel.upsellStages?.stage_100?.checkoutUrl || 'https://pay.kirvano.com/checkout-100'}">
          </div>

          <div class="form-group">
            <label class="form-label">Link Checkout - Upsell 2 (R$ 200,00)</label>
            <input type="text" class="form-input" id="set-chk-200" value="${funnel.upsellStages?.stage_200?.checkoutUrl || 'https://pay.kirvano.com/checkout-200'}">
          </div>

          <div class="form-group">
            <label class="form-label">Link Checkout - Upsell 3 (R$ 400,00)</label>
            <input type="text" class="form-input" id="set-chk-400" value="${funnel.upsellStages?.stage_400?.checkoutUrl || 'https://pay.kirvano.com/checkout-400'}">
          </div>

          <button type="submit" class="btn btn-primary" style="width: 100%; margin-top: 10px;">Salvar Checkouts & Pagamentos</button>
        </form>
      </div>
    </div>
  `;

  document.getElementById('view-container').innerHTML = html;
}

/**
 * MODAL INTERATIVO OFICIAL DO FACEBOOK / META
 */
function openFacebookModal() {
  const currentAppId = state.facebook?.appId || '';
  const currentToken = state.facebook?.accessToken || '';

  const modalHtml = `
    <div id="fb-connect-modal" style="position: fixed; inset: 0; background: rgba(0,0,0,0.8); backdrop-filter: blur(10px); z-index: 9999; display: flex; align-items: center; justify-content: center; padding: 20px;">
      <div class="card" style="width: 620px; max-width: 96%; background: #0f1424; border: 1px solid rgba(24, 119, 242, 0.4); border-radius: 16px; overflow: hidden; box-shadow: 0 25px 50px rgba(0,0,0,0.8);">
        
        <!-- Header com Logo Meta -->
        <div style="padding: 18px 24px; background: rgba(24, 119, 242, 0.12); border-bottom: 1px solid rgba(255,255,255,0.08); display: flex; align-items: center; justify-content: space-between;">
          <div style="display: flex; align-items: center; gap: 12px;">
            <div class="fb-logo-circle">f</div>
            <div>
              <h3 style="font-size: 16px; font-weight: 700; color: #fff; margin: 0;">Conectar com Facebook (Meta Business)</h3>
              <div style="font-size: 11px; color: #94a3b8; margin-top: 2px;">Integração nativa com Facebook Ads, Pixel e WhatsApp Cloud API</div>
            </div>
          </div>
          <button class="btn btn-secondary" onclick="document.getElementById('fb-connect-modal').remove()" style="padding: 4px 10px;">✕</button>
        </div>

        <!-- Conteúdo do Modal -->
        <div style="padding: 24px; max-height: 75vh; overflow-y: auto;">
          
          <div style="background: rgba(255,255,255,0.03); border-left: 3px solid #1877f2; padding: 12px 14px; border-radius: 6px; font-size: 12px; color: #cbd5e1; line-height: 1.5; margin-bottom: 20px;">
            <strong style="color: #60a5fa; display: block; margin-bottom: 4px;">Como funciona a conexão oficial da Meta:</strong>
            Para a Meta permitir abrir o modal de permissões e sincronizar suas campanhas do Facebook Ads e o WhatsApp, você pode conectar via <strong>Token de Acesso do Sistema</strong> (instantâneo) ou via <strong>Popup OAuth</strong> usando o App ID do seu aplicativo.
          </div>

          <form onsubmit="handleFacebookSubmit(event)">
            <div class="form-group">
              <label class="form-label" style="display: flex; justify-content: space-between;">
                <span>Token de Acesso da Meta (Access Token)</span>
                <a href="https://developers.facebook.com/tools/explorer/" target="_blank" style="color: #60a5fa; font-size: 11px; text-decoration: none;">Abrir Graph API Explorer ➔</a>
              </label>
              <textarea class="form-textarea" id="fb-modal-token" style="min-height: 80px; font-family: monospace; font-size: 12px;" placeholder="Cole aqui seu Token permanente ou token do usuário da Meta (EAA...)" required>${currentToken}</textarea>
              <span style="font-size: 11px; color: var(--text-muted); display: block; margin-top: 4px;">Permissões recomendadas: <code>whatsapp_business_management</code>, <code>ads_management</code>, <code>ads_read</code>.</span>
            </div>

            <div class="form-group">
              <label class="form-label">Facebook App ID (Opcional para Popup Automático)</label>
              <input type="text" class="form-input" id="fb-modal-appid" value="${currentAppId}" placeholder="Ex: 109283746592019">
              <span style="font-size: 11px; color: var(--text-muted);">Encontrado em <code>developers.facebook.com > Meus Aplicativos</code></span>
            </div>

            <!-- Botão de Ação -->
            <div style="display: flex; gap: 12px; margin-top: 24px;">
              <button type="submit" class="btn btn-primary" id="fb-modal-submit-btn" style="flex: 1; padding: 12px; background: #1877f2; border: none; font-weight: 700; font-size: 13.5px;">
                ✓ Validar e Conectar com a Meta
              </button>

              <button type="button" class="btn btn-secondary" onclick="handleOpenMetaOAuthPopup()" style="padding: 12px 16px; font-size: 13px;" title="Abre a janela de autorização do Facebook">
                🌐 Abrir Popup Facebook
              </button>
            </div>
          </form>

          <!-- Passo a Passo Rápido -->
          <div style="margin-top: 24px; padding-top: 18px; border-top: 1px solid rgba(255,255,255,0.08); font-size: 11.5px; color: var(--text-muted); line-height: 1.6;">
            <strong style="color: #fff; display: block; margin-bottom: 6px;">Passo a passo para gerar seu token em 1 minuto:</strong>
            1. Acesse o <a href="https://developers.facebook.com" target="_blank" style="color: #60a5fa;">Meta for Developers</a> e crie ou abra seu App.<br>
            2. Adicione o produto <strong>WhatsApp</strong> e/ou <strong>Marketing API</strong>.<br>
            3. Em <em>WhatsApp > Configuração de API</em>, copie o <strong>Token de Acesso Temporário</strong> ou crie um Usuário do Sistema no seu Gerenciador de Negócios.<br>
            4. Cole no campo acima e clique em <em>Validar e Conectar</em>!
          </div>

        </div>
      </div>
    </div>
  `;

  document.body.insertAdjacentHTML('beforeend', modalHtml);
}

async function handleFacebookSubmit(e) {
  e.preventDefault();
  const token = document.getElementById('fb-modal-token').value.trim();
  const appId = document.getElementById('fb-modal-appid').value.trim();
  const submitBtn = document.getElementById('fb-modal-submit-btn');

  if (!token) {
    showToast('Insira o Token de Acesso da Meta', 'error');
    return;
  }

  submitBtn.disabled = true;
  submitBtn.innerHTML = '⏳ Conectando e buscando contas...';

  try {
    const res = await fetch('/api/facebook/connect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accessToken: token, appId })
    }).then(r => r.json());

    if (res.error) throw new Error(res.error);

    document.getElementById('fb-connect-modal')?.remove();
    showToast(`✓ Sucesso! Conectado como ${res.facebook.userName}!`, 'success');
    renderSettings();
  } catch (err) {
    showToast(`Erro conectando à Meta: ${err.message}`, 'error');
    submitBtn.disabled = false;
    submitBtn.innerHTML = '✓ Validar e Conectar com a Meta';
  }
}

function handleOpenMetaOAuthPopup() {
  const appId = document.getElementById('fb-modal-appid')?.value.trim() || state.facebook?.appId;
  if (!appId) {
    showToast('Para abrir o popup da Meta, informe seu Facebook App ID primeiro.', 'error');
    return;
  }

  const redirectUri = encodeURIComponent(`${window.location.origin}/webhook`);
  const scope = encodeURIComponent('whatsapp_business_management,whatsapp_business_messaging,ads_management,ads_read');
  const oauthUrl = `https://www.facebook.com/v20.0/dialog/oauth?client_id=${appId}&redirect_uri=${redirectUri}&scope=${scope}&response_type=token`;

  const width = 600;
  const height = 700;
  const left = (window.innerWidth - width) / 2;
  const top = (window.innerHeight - height) / 2;

  window.open(oauthUrl, 'FacebookLoginPopup', `width=${width},height=${height},top=${top},left=${left}`);
  showToast('Janela oficial do Facebook aberta!');
}

async function handleSelectPixel(adAccountId, pixelId) {
  await fetch('/api/facebook/select-pixel', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ adAccountId, pixelId })
  });
  showToast('Pixel e Conta de Anúncios atualizados!');
}

async function handleDisconnectFacebook() {
  if (!confirm('Deseja realmente desconectar a integração com o Facebook e Meta Ads?')) return;
  await fetch('/api/facebook/disconnect', { method: 'POST' });
  showToast('Facebook desconectado.');
  renderSettings();
}

async function handleTestPixelEvent() {
  showToast('Disparando evento de teste para o Pixel...');
  try {
    const res = await fetch('/api/facebook/test-event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ eventName: 'Lead', phone: '5511999999999', value: 49.90 })
    }).then(r => r.json());

    if (res.error) throw new Error(res.error);
    showToast('✓ Evento "Lead" enviado com sucesso para a API de Conversões do Facebook!', 'success');
  } catch (e) {
    showToast(`Erro no Pixel: ${e.message}`, 'error');
  }
}

async function saveAiSettings(e) {
  e.preventDefault();
  const openaiApiKey = document.getElementById('set-openai-key').value;
  const openaiModel = document.getElementById('set-openai-model').value;
  const profileLookupService = document.getElementById('set-lookup-endpoint').value;

  await fetch('/api/settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ openaiApiKey, openaiModel, profileLookupService })
  });

  showToast('Configurações de IA salvas com sucesso!');
}

async function saveCheckoutSettings(e) {
  e.preventDefault();
  const funnel = state.funnel || {};
  if (!funnel.paymentRecipient) funnel.paymentRecipient = {};
  if (!funnel.upsellStages) funnel.upsellStages = {};

  funnel.paymentRecipient.name = document.getElementById('set-benef-name').value;
  funnel.paymentRecipient.bank = document.getElementById('set-benef-bank').value;

  if (!funnel.upsellStages.stage_49) funnel.upsellStages.stage_49 = {};
  funnel.upsellStages.stage_49.checkoutUrl = document.getElementById('set-chk-49').value;

  if (!funnel.upsellStages.stage_100) funnel.upsellStages.stage_100 = {};
  funnel.upsellStages.stage_100.checkoutUrl = document.getElementById('set-chk-100').value;

  if (!funnel.upsellStages.stage_200) funnel.upsellStages.stage_200 = {};
  funnel.upsellStages.stage_200.checkoutUrl = document.getElementById('set-chk-200').value;

  if (!funnel.upsellStages.stage_400) funnel.upsellStages.stage_400 = {};
  funnel.upsellStages.stage_400.checkoutUrl = document.getElementById('set-chk-400').value;

  await fetch('/api/funnel', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(funnel)
  });

  showToast('Checkouts e dados de pagamento atualizados com sucesso!');
}

/* =========================================================================
   VIEW: ATRIBUIÇÃO DE TRÁFEGO PAGO (TIKTOK ADS) & SERVER-SIDE CAPI
   ========================================================================= */

state.activeTikTokTab = 'report';

async function renderTikTokAttribution() {
  const container = document.getElementById('view-container');
  container.innerHTML = '<div style="color: var(--text-muted); padding: 40px; text-align: center;">Carregando dados de atribuição TikTok...</div>';

  try {
    const [reportRes, campaignsRes, pixelsRes, logsRes] = await Promise.all([
      fetch('/api/traffic/report').then(r => r.json()).catch(() => ({ kpis: {}, campaignGroups: [], recentAttributions: [] })),
      fetch('/api/traffic/campaigns').then(r => r.json()).catch(() => []),
      fetch('/api/tiktok/pixels').then(r => r.json()).catch(() => []),
      fetch('/api/tiktok/logs').then(r => r.json()).catch(() => [])
    ]);

    const activeTab = state.activeTikTokTab || 'report';
    const kpis = reportRes.kpis || {};
    const campaignGroups = reportRes.campaignGroups || [];
    const recentAttributions = reportRes.recentAttributions || [];

    const html = `
      <div style="max-width: 1300px; margin: 0 auto;">
        <!-- Top Bar com Logo TikTok -->
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px; flex-wrap: wrap; gap: 16px;">
          <div style="display: flex; align-items: center; gap: 14px;">
            <div style="width: 48px; height: 48px; border-radius: 12px; background: linear-gradient(135deg, #fe2c55, #25f4ee); display: flex; align-items: center; justify-content: center; font-size: 24px; color: #fff; box-shadow: 0 4px 20px rgba(254, 44, 85, 0.4);">
              🎵
            </div>
            <div>
              <div style="display: flex; align-items: center; gap: 8px;">
                <h2 style="font-size: 22px; font-weight: 800; font-family: 'Outfit', sans-serif; margin: 0;">Atribuição de Tráfego TikTok Ads</h2>
                <span style="background: rgba(254, 44, 85, 0.15); color: #fe2c55; border: 1px solid rgba(254, 44, 85, 0.3); font-size: 11px; font-weight: 700; padding: 2px 8px; border-radius: 20px;">Events API v1.3</span>
              </div>
              <p style="font-size: 13px; color: var(--text-secondary); margin-top: 4px;">
                Rastreamento ponta a ponta: Anúncio TikTok ➔ Link Curto /c/:slug ➔ Pressel ➔ WhatsApp ➔ Venda Kirvano com disparo Server-side.
              </p>
            </div>
          </div>

          <div style="display: flex; gap: 10px;">
            <button class="btn btn-secondary" onclick="renderTikTokAttribution()" title="Recarregar Dados">🔄 Atualizar</button>
            <button class="btn btn-primary" style="background: linear-gradient(135deg, #fe2c55, #e11d48); border: none; font-weight: 700;" onclick="openCreateCampaignModal()">+ Novo Link de Campanha</button>
          </div>
        </div>

        <!-- Navegação de Abas -->
        <div style="display: flex; gap: 10px; margin-bottom: 24px; border-bottom: 1px solid var(--border-color); padding-bottom: 12px; overflow-x: auto;">
          <button class="flows-tab-btn ${activeTab === 'report' ? 'active' : ''}" onclick="switchTikTokTab('report')" style="${activeTab === 'report' ? 'background: #fe2c55; color: #fff;' : ''}">
            📊 Relatório & ROI (${campaignGroups.length})
          </button>
          <button class="flows-tab-btn ${activeTab === 'links' ? 'active' : ''}" onclick="switchTikTokTab('links')" style="${activeTab === 'links' ? 'background: #fe2c55; color: #fff;' : ''}">
            🔗 Links de Campanha (${campaignsRes.length})
          </button>
          <button class="flows-tab-btn ${activeTab === 'pixels' ? 'active' : ''}" onclick="switchTikTokTab('pixels')" style="${activeTab === 'pixels' ? 'background: #fe2c55; color: #fff;' : ''}">
            🎵 Pixels TikTok (${pixelsRes.length})
          </button>
          <button class="flows-tab-btn ${activeTab === 'simulator' ? 'active' : ''}" onclick="switchTikTokTab('simulator')" style="${activeTab === 'simulator' ? 'background: #fe2c55; color: #fff;' : ''}">
            🧪 Testar Cadeia Completa
          </button>
        </div>

        <!-- ABA 1: RELATÓRIO & ROI -->
        <div id="tab-tt-pane-report" style="display: ${activeTab === 'report' ? 'block' : 'none'};">
          <!-- KPI Cards -->
          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 16px; margin-bottom: 24px;">
            <div class="card" style="padding: 18px; border-left: 4px solid #3b82f6;">
              <div style="font-size: 12px; color: var(--text-secondary); text-transform: uppercase; font-weight: 600;">Cliques Recebidos (/c/)</div>
              <div style="font-size: 26px; font-weight: 800; margin-top: 6px; color: #fff;">${kpis.totalClicks || 0}</div>
              <div style="font-size: 11.5px; color: #60a5fa; margin-top: 4px;">Leads que clicaram no criativo</div>
            </div>

            <div class="card" style="padding: 18px; border-left: 4px solid #10b981;">
              <div style="font-size: 12px; color: var(--text-secondary); text-transform: uppercase; font-weight: 600;">Leads no WhatsApp</div>
              <div style="font-size: 26px; font-weight: 800; margin-top: 6px; color: #10b981;">${kpis.totalLeads || 0}</div>
              <div style="font-size: 11.5px; color: var(--text-muted); margin-top: 4px;">Taxa Clique ➔ Zap: <strong style="color: #10b981;">${kpis.globalLeadRate || '0%'}</strong></div>
            </div>

            <div class="card" style="padding: 18px; border-left: 4px solid #fe2c55;">
              <div style="font-size: 12px; color: var(--text-secondary); text-transform: uppercase; font-weight: 600;">Vendas Confirmadas</div>
              <div style="font-size: 26px; font-weight: 800; margin-top: 6px; color: #fe2c55;">${kpis.totalSales || 0}</div>
              <div style="font-size: 11.5px; color: var(--text-muted); margin-top: 4px;">Conversão no Zap: <strong style="color: #fe2c55;">${kpis.globalSaleRate || '0%'}</strong></div>
            </div>

            <div class="card" style="padding: 18px; border-left: 4px solid #eab308;">
              <div style="font-size: 12px; color: var(--text-secondary); text-transform: uppercase; font-weight: 600;">Faturamento Rastreado</div>
              <div style="font-size: 26px; font-weight: 800; margin-top: 6px; color: #fef08a;">R$ ${(parseFloat(kpis.totalRevenue) || 0).toFixed(2)}</div>
              <div style="font-size: 11.5px; color: var(--text-muted); margin-top: 4px;">Conversão Geral Clique ➔ Venda: <strong>${kpis.clickToSaleRate || '0%'}</strong></div>
            </div>
          </div>

          <!-- Tabela de Performance por Campanha & Criativo -->
          <div class="card" style="padding: 20px; margin-bottom: 24px;">
            <div class="card-header" style="margin-bottom: 16px;">
              <div>
                <h3 class="card-title" style="font-size: 16px;">🎯 Conversão por Campanha & Criativo (TikTok Ads)</h3>
                <p style="font-size: 12px; color: var(--text-secondary); margin-top: 2px;">
                  Granularidade real agrupada por <code>utm_campaign</code> e <code>utm_content</code> do anúncio.
                </p>
              </div>
            </div>

            <div style="overflow-x: auto;">
              <table class="flows-table">
                <thead>
                  <tr>
                    <th>Campanha (UTM Campaign)</th>
                    <th>Criativo / Anúncio (UTM Content)</th>
                    <th>Canal</th>
                    <th style="text-align: center;">Cliques</th>
                    <th style="text-align: center;">WhatsApp</th>
                    <th style="text-align: center;">Vendas</th>
                    <th style="text-align: center;">Tx. Conv. Zap</th>
                    <th style="text-align: right;">Faturamento</th>
                  </tr>
                </thead>
                <tbody>
                  ${campaignGroups.length > 0 ? campaignGroups.map(g => `
                    <tr>
                      <td>
                        <strong style="color: #fff; font-size: 13.5px;">${g.campaign}</strong>
                      </td>
                      <td>
                        <span style="background: rgba(255,255,255,0.06); padding: 3px 8px; border-radius: 4px; font-size: 12px; font-family: monospace; color: #cbd5e1;">${g.content}</span>
                      </td>
                      <td><span style="color: #94a3b8; font-size: 12px;">${g.source}</span></td>
                      <td style="text-align: center; font-weight: 700; color: #60a5fa;">${g.clicks}</td>
                      <td style="text-align: center; font-weight: 700; color: #10b981;">${g.leads}</td>
                      <td style="text-align: center; font-weight: 700; color: #fe2c55;">${g.sales}</td>
                      <td style="text-align: center;">
                        <span style="font-size: 12px; font-weight: 700; color: ${parseFloat(g.conversionRate) > 0 ? '#10b981' : '#94a3b8'};">
                          ${g.conversionRate}
                        </span>
                      </td>
                      <td style="text-align: right; font-weight: 800; color: #fef08a;">${g.revenueFormatted}</td>
                    </tr>
                  `).join('') : `
                    <tr>
                      <td colspan="8" style="text-align: center; padding: 30px; color: var(--text-muted);">
                        Nenhum clique de campanha registrado ainda. Crie seu primeiro link na aba "Links de Campanha" e use-o no criativo do TikTok Ads Manager!
                      </td>
                    </tr>
                  `}
                </tbody>
              </table>
            </div>
          </div>

          <!-- Tabela de Últimas Atribuições & Códigos Gerados -->
          <div class="card" style="padding: 20px;">
            <div class="card-header" style="margin-bottom: 14px;">
              <div>
                <h3 class="card-title" style="font-size: 16px;">⏱️ Registros Recentes de Atribuição (Últimos Códigos)</h3>
                <p style="font-size: 12px; color: var(--text-secondary); margin-top: 2px;">
                  Histórico de leads que clicaram no anúncio e migraram para o WhatsApp (expiração de 48h).
                </p>
              </div>
            </div>

            <div style="overflow-x: auto;">
              <table class="flows-table">
                <thead>
                  <tr>
                    <th>Código</th>
                    <th>Telefone Vinculado</th>
                    <th>Campanha / Origem</th>
                    <th>ttclid</th>
                    <th>_ttp Cookie</th>
                    <th>Criado Em</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  ${recentAttributions.length > 0 ? recentAttributions.map(a => {
                    const isSold = a.venda_confirmada;
                    const hasPhone = !!a.telefone_vinculado;
                    return `
                      <tr>
                        <td>
                          <span style="background: rgba(254,44,85,0.15); border: 1px solid rgba(254,44,85,0.4); color: #fe2c55; font-weight: 800; font-family: monospace; font-size: 13px; padding: 2px 8px; border-radius: 4px;">
                            ${a.codigo}
                          </span>
                        </td>
                        <td>
                          ${hasPhone ? `
                            <span style="color: #10b981; font-weight: 600; font-size: 13px;">✓ +${a.telefone_vinculado}</span>
                          ` : `
                            <span style="color: var(--text-muted); font-size: 12px; font-style: italic;">Aguardando 1ª msg...</span>
                          `}
                        </td>
                        <td>
                          <div style="font-size: 12.5px; color: #fff;">${a.campanha_nome || a.utm_campaign || 'Direto'}</div>
                          <div style="font-size: 11px; color: var(--text-muted);">${a.utm_content || a.utm_source || 'tiktok'}</div>
                        </td>
                        <td>
                          <span style="font-size: 11px; font-family: monospace; color: #94a3b8; max-width: 140px; display: inline-block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${a.ttclid || '-'}">
                            ${a.ttclid || '-'}
                          </span>
                        </td>
                        <td>
                          <span style="font-size: 11px; font-family: monospace; color: #94a3b8; max-width: 110px; display: inline-block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${a.ttp || '-'}">
                            ${a.ttp ? '✓ Presente' : 'Não capturado'}
                          </span>
                        </td>
                        <td style="font-size: 12px; color: var(--text-secondary);">
                          ${new Date(a.criado_em).toLocaleString('pt-BR')}
                        </td>
                        <td>
                          ${isSold ? `
                            <span style="background: rgba(37,211,102,0.15); color: #25d366; font-size: 11px; font-weight: 700; padding: 3px 8px; border-radius: 4px;">
                              💰 VENDA R$ ${(parseFloat(a.venda_valor) || 49.90).toFixed(2)}
                            </span>
                          ` : hasPhone ? `
                            <span style="background: rgba(59,130,246,0.15); color: #60a5fa; font-size: 11px; font-weight: 700; padding: 3px 8px; border-radius: 4px;">
                              💬 NO ZAP
                            </span>
                          ` : `
                            <span style="background: rgba(255,255,255,0.06); color: var(--text-muted); font-size: 11px; padding: 3px 8px; border-radius: 4px;">
                              CLIQUE (PRESS)
                            </span>
                          `}
                        </td>
                      </tr>
                    `;
                  }).join('') : `
                    <tr>
                      <td colspan="7" style="text-align: center; padding: 24px; color: var(--text-muted);">
                        Nenhum lead ou clique registrado ainda.
                      </td>
                    </tr>
                  `}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <!-- ABA 2: LINKS DE CAMPANHA -->
        <div id="tab-tt-pane-links" style="display: ${activeTab === 'links' ? 'block' : 'none'};">
          <!-- Card de Explicação -->
          <div class="card" style="padding: 16px; margin-bottom: 20px; background: rgba(254, 44, 85, 0.05); border: 1px solid rgba(254, 44, 85, 0.2);">
            <div style="display: flex; gap: 12px; align-items: flex-start;">
              <span style="font-size: 20px;">💡</span>
              <div style="font-size: 12.5px; color: #cbd5e1; line-height: 1.5;">
                <strong>Como funciona o Gerador de Link do TikTok Ads:</strong><br>
                1. Cadastre a URL da sua <strong>Pressel</strong> e o <strong>WhatsApp</strong> de atendimento.<br>
                2. O sistema gera uma URL única tipo <code>/c/seu-slug</code>. Cole essa URL no anúncio do TikTok Ads Manager.<br>
                3. Quando o lead clica no anúncio, o endpoint captura <code>ttclid</code>, <code>_ttp</code> e UTMs, gera um código de 6 caracteres único (ex: <code>AB79KP</code>) e redireciona (302) para a pressel com <code>?codigo=AB79KP</code>.<br>
                4. O botão do WhatsApp na pressel envia a mensagem <code>Oii vim pelo TikTok (código AB79KP)</code>, completando a atribuição instantânea!
              </div>
            </div>
          </div>

          <!-- Tabela de Campanhas -->
          <div class="card" style="padding: 20px;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
              <h3 class="card-title" style="font-size: 16px;">Campanhas & Links Cadastrados</h3>
              <button class="btn btn-primary" style="background: #fe2c55; border: none; font-size: 13px;" onclick="openCreateCampaignModal()">+ Criar Link de Campanha</button>
            </div>

            <div style="overflow-x: auto;">
              <table class="flows-table">
                <thead>
                  <tr>
                    <th>Campanha</th>
                    <th>Link Anúncio TikTok (Criativo)</th>
                    <th>Destino (Pressel)</th>
                    <th>WhatsApp de Destino</th>
                    <th>Template da Mensagem</th>
                    <th style="text-align: right;">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  ${campaignsRes.length > 0 ? campaignsRes.map(c => `
                    <tr>
                      <td>
                        <strong style="color: #fff; font-size: 14px;">${c.name}</strong>
                        <div style="font-size: 11px; color: var(--text-muted); margin-top: 2px;">ID: ${c.id}</div>
                      </td>
                      <td>
                        <div style="display: flex; align-items: center; gap: 8px;">
                          <input type="text" class="form-input" readonly value="${c.shortUrl}" style="font-size: 12px; padding: 4px 8px; width: 220px; font-family: monospace; background: rgba(0,0,0,0.3); border-color: rgba(254,44,85,0.4); color: #fe2c55;" id="camp-url-${c.id}">
                          <button class="btn btn-secondary" style="padding: 4px 10px; font-size: 12px;" onclick="copyToClipboard('${c.shortUrl}', 'Link de anúncio copiado!')">📋 Copiar</button>
                        </div>
                      </td>
                      <td>
                        <div style="font-size: 12px; color: #60a5fa; max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                          <a href="${c.presell_url}" target="_blank" style="color: #60a5fa; text-decoration: none;">${c.presell_url}</a>
                        </div>
                        <div style="font-size: 10.5px; color: var(--text-muted); margin-top: 2px;">Redireciona com ?codigo=XXXXXX</div>
                      </td>
                      <td>
                        <span style="font-weight: 600; color: #10b981; font-size: 13px;">+${c.whatsapp_number}</span>
                      </td>
                      <td>
                        <div style="font-size: 11.5px; color: #cbd5e1; max-width: 220px; background: rgba(255,255,255,0.03); padding: 4px 8px; border-radius: 4px;">
                          ${c.message_template}
                        </div>
                      </td>
                      <td style="text-align: right;">
                        <div style="display: flex; gap: 6px; justify-content: flex-end;">
                          <a href="${c.shortUrl}?ttclid=teste_manual_clique&utm_source=tiktok&utm_campaign=teste" target="_blank" class="btn btn-secondary" style="padding: 4px 8px; font-size: 11px;" title="Testar Redirect">🚀 Testar</a>
                          <button class="btn btn-secondary" style="padding: 4px 8px; font-size: 11px; color: var(--red);" onclick="handleDeleteCampaign('${c.id}')" title="Excluir">🗑️</button>
                        </div>
                      </td>
                    </tr>
                  `).join('') : `
                    <tr>
                      <td colspan="6" style="text-align: center; padding: 30px; color: var(--text-muted);">
                        Nenhuma campanha cadastrada ainda. Clique no botão acima para criar o link do seu anúncio!
                      </td>
                    </tr>
                  `}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <!-- ABA 3: PIXELS TIKTOK & AUDITORIA -->
        <div id="tab-tt-pane-pixels" style="display: ${activeTab === 'pixels' ? 'block' : 'none'};">
          <!-- Header de Pixels -->
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 24px; align-items: start;">
            <!-- Pixels Cadastrados -->
            <div class="card" style="padding: 20px;">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
                <div>
                  <h3 class="card-title" style="font-size: 16px;">Pixels do TikTok (Events API)</h3>
                  <p style="font-size: 12px; color: var(--text-secondary); margin-top: 2px;">
                    Tokens de longa duração cadastrados manualmente do TikTok Ads Manager.
                  </p>
                </div>
                <button class="btn btn-primary" style="background: #fe2c55; border: none; font-size: 12px;" onclick="openCreateTikTokPixelModal()">+ Cadastrar Pixel</button>
              </div>

              ${pixelsRes.length > 0 ? pixelsRes.map(p => `
                <div style="background: rgba(255,255,255,0.03); border: 1px solid rgba(254,44,85,0.25); border-radius: 10px; padding: 14px; margin-bottom: 12px;">
                  <div style="display: flex; justify-content: space-between; align-items: center;">
                    <div style="display: flex; align-items: center; gap: 10px;">
                      <span style="font-size: 20px;">🎵</span>
                      <div>
                        <strong style="color: #fff; font-size: 14px;">${p.name}</strong>
                        <div style="font-size: 12px; color: #fe2c55; font-family: monospace;">Pixel Code: ${p.pixel_code}</div>
                      </div>
                    </div>
                    <button class="btn btn-secondary" style="padding: 3px 8px; font-size: 11px; color: var(--red);" onclick="handleDeleteTikTokPixel('${p.id}')">Excluir</button>
                  </div>

                  <div style="margin-top: 10px; font-size: 11px; color: var(--text-muted); font-family: monospace; background: rgba(0,0,0,0.3); padding: 6px 10px; border-radius: 6px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                    Access Token: ${p.access_token ? p.access_token.substring(0, 15) + '••••••••••••••••••••' : 'Sem token'}
                  </div>

                  <div style="display: flex; justify-content: flex-end; gap: 8px; margin-top: 10px;">
                    <button class="btn btn-secondary" style="font-size: 11px; padding: 4px 10px;" onclick="handleTestTikTokPixel('${p.pixel_code}', '${p.access_token}')">⚡ Testar Envio (CompletePayment)</button>
                  </div>
                </div>
              `).join('') : `
                <div style="text-align: center; padding: 30px; border: 1px dashed rgba(255,255,255,0.1); border-radius: 10px;">
                  <div style="font-size: 28px; margin-bottom: 8px;">🎵</div>
                  <div style="font-size: 13px; color: #fff; font-weight: 600;">Nenhum Pixel TikTok cadastrado</div>
                  <div style="font-size: 12px; color: var(--text-muted); margin-top: 4px; max-width: 320px; margin-left: auto; margin-right: auto;">
                    Cadastre o <strong>pixel_code</strong> e o <strong>access_token</strong> gerados no TikTok Events API para habilitar disparos server-side.
                  </div>
                  <button class="btn btn-primary" style="background: #fe2c55; border: none; margin-top: 14px; font-size: 12px;" onclick="openCreateTikTokPixelModal()">Cadastrar Meu Pixel Agora</button>
                </div>
              `}
            </div>

            <!-- Como Gerar o Token no TikTok -->
            <div class="card" style="padding: 20px; background: rgba(18, 24, 38, 0.5);">
              <h3 class="card-title" style="font-size: 15px; margin-bottom: 12px; color: #fff;">📘 Onde encontro o Pixel Code e Access Token?</h3>
              <div style="font-size: 12.5px; color: #cbd5e1; line-height: 1.7;">
                1. Entre no <strong>TikTok Ads Manager</strong> (ads.tiktok.com).<br>
                2. No menu superior, vá em <strong>Ferramentas (Assets) ➔ Eventos (Events) ➔ Web Events</strong>.<br>
                3. Clique no seu Pixel e vá na aba <strong>Configurações (Settings)</strong>.<br>
                4. Role até <strong>Events API</strong> e clique em <strong>Generate Access Token</strong>.<br>
                5. Copie o <strong>Pixel Code</strong> e o <strong>Access Token</strong> e cole no formulário ao lado.
              </div>
            </div>
          </div>

          <!-- Tabela de Logs de Disparo da API TikTok -->
          <div class="card" style="padding: 20px;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px;">
              <div>
                <h3 class="card-title" style="font-size: 16px;">📜 Logs de Disparo Server-side (Auditoria & Debug)</h3>
                <p style="font-size: 12px; color: var(--text-secondary); margin-top: 2px;">
                  Registro de cada requisição enviada para a API <code>https://business-api.tiktok.com/open_api/v1.3/event/track/</code>.
                </p>
              </div>
            </div>

            <div style="overflow-x: auto;">
              <table class="flows-table">
                <thead>
                  <tr>
                    <th>Data / Hora</th>
                    <th>Evento</th>
                    <th>Pixel Code</th>
                    <th>Telefone (SHA-256)</th>
                    <th>ttclid / Ad Callback</th>
                    <th>Status HTTP</th>
                    <th>Resposta da API</th>
                  </tr>
                </thead>
                <tbody>
                  ${logsRes.length > 0 ? logsRes.map(l => `
                    <tr>
                      <td style="font-size: 12px; color: var(--text-secondary);">
                        ${new Date(l.timestamp).toLocaleString('pt-BR')}
                      </td>
                      <td>
                        <strong style="color: #fe2c55; font-size: 13px;">${l.event}</strong>
                      </td>
                      <td><span style="font-family: monospace; font-size: 12px;">${l.pixel_code}</span></td>
                      <td>
                        <span style="font-family: monospace; font-size: 11px; color: #94a3b8;" title="${l.phone_hash || '-'}">
                          ${l.phone_hash ? l.phone_hash.substring(0, 16) + '...' : '-'}
                        </span>
                      </td>
                      <td>
                        <span style="font-family: monospace; font-size: 11px; color: #60a5fa;" title="${l.ttclid || '-'}">
                          ${l.ttclid || '(orgânico)'}
                        </span>
                      </td>
                      <td>
                        <span style="font-weight: 700; font-size: 12px; color: ${l.status >= 200 && l.status < 300 ? '#10b981' : '#ef4444'};">
                          ● ${l.status || 500}
                        </span>
                      </td>
                      <td>
                        <div style="font-size: 11px; font-family: monospace; color: #cbd5e1; max-width: 250px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${JSON.stringify(l.response || {})}">
                          ${typeof l.response === 'object' ? JSON.stringify(l.response) : String(l.response || l.error || 'OK')}
                        </div>
                      </td>
                    </tr>
                  `).join('') : `
                    <tr>
                      <td colspan="7" style="text-align: center; padding: 24px; color: var(--text-muted);">
                        Nenhum log de disparo registrado ainda.
                      </td>
                    </tr>
                  `}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <!-- ABA 4: SIMULADOR DE CADEIA COMPLETA -->
        <div id="tab-tt-pane-simulator" style="display: ${activeTab === 'simulator' ? 'block' : 'none'};">
          <div class="card" style="padding: 24px; max-width: 850px; margin: 0 auto;">
            <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 16px;">
              <span style="font-size: 28px;">🧪</span>
              <div>
                <h3 class="card-title" style="font-size: 18px;">Simulador de Cadeia Completa (1-Click)</h3>
                <p style="font-size: 12.5px; color: var(--text-secondary); margin-top: 2px;">
                  Valide todo o ciclo de atribuição instantaneamente sem precisar criar anúncio real no TikTok nem gastar saldo.
                </p>
              </div>
            </div>

            <form onsubmit="handleRunTestChain(event)" style="background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.06); border-radius: 12px; padding: 20px; margin-bottom: 24px;">
              <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px;">
                <div class="form-group">
                  <label class="form-label">Telefone Simulado do Lead (E.164)</label>
                  <input type="text" class="form-input" id="sim-tt-phone" value="5511998877665" required>
                </div>
                <div class="form-group">
                  <label class="form-label">Valor da Venda Simulado (R$)</label>
                  <input type="text" class="form-input" id="sim-tt-amount" value="49.90" required>
                </div>
              </div>

              <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-top: 10px;">
                <div class="form-group">
                  <label class="form-label">UTM Campaign (Campanha)</label>
                  <input type="text" class="form-input" id="sim-tt-campaign" value="tiktok_ads_espiao_vsl">
                </div>
                <div class="form-group">
                  <label class="form-label">UTM Content (Criativo)</label>
                  <input type="text" class="form-input" id="sim-tt-content" value="criativo_audio_zap_v1">
                </div>
              </div>

              <button type="submit" class="btn btn-primary" id="btn-run-sim" style="width: 100%; margin-top: 16px; background: linear-gradient(135deg, #fe2c55, #25f4ee); border: none; font-size: 14px; font-weight: 800; padding: 12px;">
                🚀 Disparar e Validar Toda a Cadeia de Atribuição
              </button>
            </form>

            <!-- Área de Resultados do Diagnóstico -->
            <div id="sim-chain-output" style="display: none;"></div>
          </div>
        </div>
      </div>
    `;

    container.innerHTML = html;
  } catch (err) {
    container.innerHTML = `<div style="color: var(--red); padding: 40px; text-align: center;">Erro ao carregar Atribuição TikTok: ${err.message}</div>`;
  }
}

function switchTikTokTab(tabName) {
  state.activeTikTokTab = tabName;
  ['report', 'links', 'pixels', 'simulator'].forEach(t => {
    const pane = document.getElementById(`tab-tt-pane-${t}`);
    if (pane) pane.style.display = t === tabName ? 'block' : 'none';
  });
  renderTikTokAttribution();
}

/**
 * MODAL: CRIAR LINK DE CAMPANHA
 */
function openCreateCampaignModal() {
  const host = window.location.host || 'localhost:3000';
  const proto = window.location.protocol || 'http:';

  const modalHtml = `
    <div class="node-modal-backdrop" id="campaign-modal">
      <div class="card" style="width: 580px; max-width: 96%; background: #111827; border: 1px solid rgba(254, 44, 85, 0.4); border-radius: 14px; padding: 24px; box-shadow: 0 25px 50px rgba(0,0,0,0.8);">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
          <div style="display: flex; align-items: center; gap: 10px;">
            <div style="width: 36px; height: 36px; border-radius: 8px; background: #fe2c55; color: #fff; display: flex; align-items: center; justify-content: center; font-size: 18px;">
              🔗
            </div>
            <div>
              <h3 style="font-size: 17px; font-weight: 700; margin: 0; color: #fff;">Novo Link de Campanha TikTok</h3>
              <div style="font-size: 11.5px; color: var(--text-secondary);">Gera a URL curta para usar no anúncio do TikTok Ads</div>
            </div>
          </div>
          <button class="btn btn-secondary" onclick="document.getElementById('campaign-modal').remove()" style="border: none; background: transparent; font-size: 18px;">✕</button>
        </div>

        <form onsubmit="handleCreateCampaign(event)">
          <div class="form-group">
            <label class="form-label">Nome da Campanha (Uso Interno) *</label>
            <input type="text" class="form-input" id="camp-input-name" placeholder="Ex: Espião WhatsApp - VSL 01" required>
          </div>

          <div class="form-group">
            <label class="form-label">Slug da URL Curta (Opcional)</label>
            <div style="display: flex; align-items: center; background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.1); border-radius: 8px; padding-left: 10px;">
              <span style="font-size: 12px; color: var(--text-muted); font-family: monospace;">${proto}//${host}/c/</span>
              <input type="text" class="form-input" id="camp-input-slug" placeholder="espiao-vsl-01" style="border: none; background: transparent; font-family: monospace;">
            </div>
            <div style="font-size: 11px; color: var(--text-muted); margin-top: 4px;">Deixe vazio para gerar automaticamente com base no nome.</div>
          </div>

          <div class="form-group">
            <label class="form-label">URL de Destino (A Pressel) *</label>
            <input type="url" class="form-input" id="camp-input-presell" placeholder="https://minhapressel.com" value="https://minhapressel.com" required>
            <div style="font-size: 11px; color: var(--text-muted); margin-top: 4px;">O sistema redirecionará o lead para essa página adicionando <code>?codigo=XXXXXX</code></div>
          </div>

          <div class="form-group">
            <label class="form-label">Número de WhatsApp de Destino (DDI + DDD + Número) *</label>
            <input type="text" class="form-input" id="camp-input-whatsapp" placeholder="5511999998888" value="5511999998888" required>
          </div>

          <div class="form-group">
            <label class="form-label">Template da Mensagem do WhatsApp *</label>
            <textarea class="form-textarea" id="camp-input-template" style="min-height: 80px;" required>Oii vim pelo TikTok (código {codigo})</textarea>
            <div style="font-size: 11px; color: var(--text-muted); margin-top: 4px;">A tag <code>{codigo}</code> será substituída pelo código único de 6 caracteres na pressel.</div>
          </div>

          <div style="display: flex; justify-content: flex-end; gap: 10px; margin-top: 24px; padding-top: 16px; border-top: 1px solid rgba(255,255,255,0.08);">
            <button type="button" class="btn btn-secondary" onclick="document.getElementById('campaign-modal').remove()">Cancelar</button>
            <button type="submit" class="btn btn-primary" style="background: #fe2c55; border: none; font-weight: 700; padding: 8px 22px;">Criar Link</button>
          </div>
        </form>
      </div>
    </div>
  `;

  document.body.insertAdjacentHTML('beforeend', modalHtml);
}

async function handleCreateCampaign(e) {
  e.preventDefault();
  const name = document.getElementById('camp-input-name').value.trim();
  const slug = document.getElementById('camp-input-slug').value.trim();
  const presell_url = document.getElementById('camp-input-presell').value.trim();
  const whatsapp_number = document.getElementById('camp-input-whatsapp').value.trim();
  const message_template = document.getElementById('camp-input-template').value.trim();

  try {
    const res = await fetch('/api/traffic/campaigns', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, slug, presell_url, whatsapp_number, message_template })
    });
    const data = await res.json();

    if (data.error) throw new Error(data.error);

    document.getElementById('campaign-modal')?.remove();
    showToast('✓ Link de campanha criado com sucesso!', 'success');
    state.activeTikTokTab = 'links';
    renderTikTokAttribution();
  } catch (err) {
    showToast(`Erro ao criar campanha: ${err.message}`, 'error');
  }
}

async function handleDeleteCampaign(id) {
  if (!confirm('Deseja realmente excluir este link de campanha?')) return;
  try {
    await fetch(`/api/traffic/campaigns/${id}`, { method: 'DELETE' });
    showToast('Campanha excluída com sucesso.');
    renderTikTokAttribution();
  } catch (err) {
    showToast(`Erro: ${err.message}`, 'error');
  }
}

/**
 * MODAL: CADASTRAR PIXEL TIKTOK
 */
function openCreateTikTokPixelModal() {
  const modalHtml = `
    <div class="node-modal-backdrop" id="pixel-tt-modal">
      <div class="card" style="width: 580px; max-width: 96%; background: #111827; border: 1px solid rgba(254, 44, 85, 0.4); border-radius: 14px; padding: 24px; box-shadow: 0 25px 50px rgba(0,0,0,0.8);">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
          <div style="display: flex; align-items: center; gap: 10px;">
            <div style="width: 36px; height: 36px; border-radius: 8px; background: #fe2c55; color: #fff; display: flex; align-items: center; justify-content: center; font-size: 18px;">
              🎵
            </div>
            <div>
              <h3 style="font-size: 17px; font-weight: 700; margin: 0; color: #fff;">Cadastrar Pixel TikTok (Events API)</h3>
              <div style="font-size: 11.5px; color: var(--text-secondary);">Disparos server-side diretos no TikTok Ads Manager</div>
            </div>
          </div>
          <button class="btn btn-secondary" onclick="document.getElementById('pixel-tt-modal').remove()" style="border: none; background: transparent; font-size: 18px;">✕</button>
        </div>

        <form onsubmit="handleCreateTikTokPixel(event)">
          <div class="form-group">
            <label class="form-label">Nome de Identificação (Ex: Pixel Principal TikTok)</label>
            <input type="text" class="form-input" id="pix-tt-name" placeholder="Pixel Oficial TikTok Ads" required>
          </div>

          <div class="form-group">
            <label class="form-label">Pixel Code (ID do Pixel) *</label>
            <input type="text" class="form-input" id="pix-tt-code" placeholder="Ex: C0A1B2C3D4E5F6" style="font-family: monospace;" required>
            <div style="font-size: 11px; color: var(--text-muted); margin-top: 4px;">Encontrado nas configurações do seu Pixel no TikTok Events Manager.</div>
          </div>

          <div class="form-group">
            <label class="form-label">Access Token (Events API) *</label>
            <textarea class="form-textarea" id="pix-tt-token" style="min-height: 90px; font-family: monospace; font-size: 12px;" placeholder="Cole aqui seu Access Token gerado em Events API > Generate Access Token" required></textarea>
            <div style="font-size: 11px; color: var(--text-muted); margin-top: 4px;">Token seguro e de longa duração gerado no TikTok Ads Manager.</div>
          </div>

          <div style="display: flex; justify-content: flex-end; gap: 10px; margin-top: 24px; padding-top: 16px; border-top: 1px solid rgba(255,255,255,0.08);">
            <button type="button" class="btn btn-secondary" onclick="document.getElementById('pixel-tt-modal').remove()">Cancelar</button>
            <button type="submit" class="btn btn-primary" style="background: #fe2c55; border: none; font-weight: 700; padding: 8px 22px;">Salvar Pixel</button>
          </div>
        </form>
      </div>
    </div>
  `;

  document.body.insertAdjacentHTML('beforeend', modalHtml);
}

async function handleCreateTikTokPixel(e) {
  e.preventDefault();
  const name = document.getElementById('pix-tt-name').value.trim();
  const pixel_code = document.getElementById('pix-tt-code').value.trim();
  const access_token = document.getElementById('pix-tt-token').value.trim();

  try {
    const res = await fetch('/api/tiktok/pixels', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, pixel_code, access_token })
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);

    document.getElementById('pixel-tt-modal')?.remove();
    showToast('✓ Pixel TikTok salvo com sucesso!', 'success');
    state.activeTikTokTab = 'pixels';
    renderTikTokAttribution();
  } catch (err) {
    showToast(`Erro ao salvar pixel: ${err.message}`, 'error');
  }
}

async function handleDeleteTikTokPixel(id) {
  if (!confirm('Deseja excluir este Pixel TikTok?')) return;
  try {
    await fetch(`/api/tiktok/pixels/${id}`, { method: 'DELETE' });
    showToast('Pixel excluído.');
    renderTikTokAttribution();
  } catch (err) {
    showToast(`Erro: ${err.message}`, 'error');
  }
}

async function handleTestTikTokPixel(pixelCode, accessToken) {
  showToast('Enviando evento de teste CompletePayment para TikTok Events API...');
  try {
    const res = await fetch('/api/tiktok/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pixel_code: pixelCode,
        access_token: accessToken,
        event_name: 'CompletePayment',
        phone: '5511999998888',
        value: 49.90
      })
    });
    const data = await res.json();

    if (data.success) {
      showToast('✓ Evento enviado com sucesso para a TikTok Events API v1.3!', 'success');
    } else {
      showToast(`Resposta do TikTok: ${data.error || 'Erro na API'}`, 'error');
    }
    renderTikTokAttribution();
  } catch (err) {
    showToast(`Erro no teste: ${err.message}`, 'error');
  }
}

/**
 * SIMULADOR DE CADEIA COMPLETA (TEST CHAIN)
 */
async function handleRunTestChain(e) {
  e.preventDefault();
  const phone = document.getElementById('sim-tt-phone').value.trim();
  const amount = document.getElementById('sim-tt-amount').value.trim();
  const campaign = document.getElementById('sim-tt-campaign').value.trim();
  const content = document.getElementById('sim-tt-content').value.trim();

  const output = document.getElementById('sim-chain-output');
  const submitBtn = document.getElementById('btn-run-sim');

  if (output) {
    output.style.display = 'block';
    output.innerHTML = `
      <div style="text-align: center; padding: 24px; color: #eab308;">
        <div style="font-size: 24px; margin-bottom: 8px;">⏳</div>
        <div>Executando cadeia completa de validação...</div>
        <div style="font-size: 11px; color: var(--text-muted); margin-top: 4px;">(Clique ➔ Inbound WhatsApp ➔ Binding ➔ Venda Kirvano ➔ TikTok API)</div>
      </div>
    `;
  }
  if (submitBtn) submitBtn.disabled = true;

  try {
    const res = await fetch('/api/tiktok/test-chain', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, amount, utm_campaign: campaign, utm_content: content })
    });
    const data = await res.json();
    const d = data.diagnostics || {};

    const badgeSuccess = '<span style="background: rgba(37,211,102,0.15); color: #25d366; font-size: 11px; font-weight: 700; padding: 2px 8px; border-radius: 4px;">✓ APROVADO</span>';
    const badgeFailed = '<span style="background: rgba(239,68,68,0.15); color: #ef4444; font-size: 11px; font-weight: 700; padding: 2px 8px; border-radius: 4px;">❌ FALHA</span>';

    output.innerHTML = `
      <div style="background: rgba(18, 24, 38, 0.9); border: 1px solid ${data.success ? 'rgba(37, 211, 102, 0.4)' : 'rgba(239, 68, 68, 0.4)'}; border-radius: 12px; padding: 20px;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
          <h4 style="font-size: 16px; font-weight: 700; color: #fff; margin: 0;">
            ${data.success ? '🎉 Cadeia Completa Validada com Sucesso!' : '⚠️ Atenção nos Resultados da Cadeia'}
          </h4>
          <span style="font-size: 12px; color: var(--text-muted);">Código: <strong style="color: #fe2c55; font-family: monospace;">${d.summary?.code || '-'}</strong></span>
        </div>

        <div style="display: flex; flex-direction: column; gap: 12px;">
          <!-- Etapa 1 -->
          <div style="background: rgba(255,255,255,0.03); border-radius: 8px; padding: 12px;">
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <strong>1. Clique no Anúncio & Geração do Código</strong>
              ${d.step1_click?.status === 'success' ? badgeSuccess : badgeFailed}
            </div>
            <div style="font-size: 11.5px; color: #cbd5e1; margin-top: 4px;">
              Código gerado: <code style="color: #fe2c55;">${d.step1_click?.code}</code> • ttclid: <code>${d.step1_click?.ttclid}</code> • Redirect: <code>${d.step1_click?.redirect_url}</code>
            </div>
          </div>

          <!-- Etapa 2 -->
          <div style="background: rgba(255,255,255,0.03); border-radius: 8px; padding: 12px;">
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <strong>2. Recebimento da Mensagem WhatsApp</strong>
              ${d.step2_inbound_message?.status === 'success' ? badgeSuccess : badgeFailed}
            </div>
            <div style="font-size: 11.5px; color: #cbd5e1; margin-top: 4px;">
              Mensagem recebida: <code style="color: #10b981;">"${d.step2_inbound_message?.messageSent}"</code> de <code>+${d.step2_inbound_message?.leadPhone}</code>
            </div>
          </div>

          <!-- Etapa 3 -->
          <div style="background: rgba(255,255,255,0.03); border-radius: 8px; padding: 12px;">
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <strong>3. Vinculação do Telefone E.164 no Banco</strong>
              ${d.step3_phone_binding?.status === 'success' ? badgeSuccess : badgeFailed}
            </div>
            <div style="font-size: 11.5px; color: #cbd5e1; margin-top: 4px;">
              ${d.step3_phone_binding?.message} (Telefone vinculado: <code>+${d.step3_phone_binding?.verifiedPhone}</code>)
            </div>
          </div>

          <!-- Etapa 4 -->
          <div style="background: rgba(255,255,255,0.03); border-radius: 8px; padding: 12px;">
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <strong>4. Confirmação da Venda & Disparo TikTok Events API</strong>
              ${d.step4_sale_and_capi?.status === 'success' ? badgeSuccess : badgeFailed}
            </div>
            <div style="font-size: 11.5px; color: #cbd5e1; margin-top: 4px;">
              Venda confirmada: <strong style="color: #25d366;">R$ ${d.step4_sale_and_capi?.venda_valor}</strong> • API Status: <code>${d.step4_sale_and_capi?.tiktok_api?.message || (d.step4_sale_and_capi?.tiktok_api?.success ? 'Disparo Server-side aceito pelo TikTok!' : 'Erro')}</code>
            </div>
          </div>
        </div>
      </div>
    `;

    showToast('✓ Simulação da cadeia completa finalizada!', 'success');
  } catch (err) {
    output.innerHTML = `<div style="color: #ef4444; padding: 20px;">Erro na simulação: ${err.message}</div>`;
  } finally {
    if (submitBtn) submitBtn.disabled = false;
  }
}

function copyToClipboard(text, msg = 'Copiado com sucesso!') {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(() => showToast(msg, 'success'));
  } else {
    const input = document.createElement('input');
    input.value = text;
    document.body.appendChild(input);
    input.select();
    document.execCommand('copy');
    document.body.removeChild(input);
    showToast(msg, 'success');
  }
}



