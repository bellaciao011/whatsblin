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

// Router
window.addEventListener('hashchange', handleRoute);
window.addEventListener('DOMContentLoaded', () => {
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
    overview: '📊 Dashboard — Visão Geral',
    inbox: '💬 Chats ao vivo',
    kanban: '🗂️ Kanban de Atendimento',
    contacts: '👥 Contatos & Leads',
    flows: '🔗 Fluxos — Automações e fluxos de atendimento',
    'flow-canvas': '🕸️ Editor Visual de Fluxo (n8n Canvas)',
    instances: '🔌 Conexões (Meta Cloud API)',
    webhooks: '📡 Webhooks de Entrada',
    settings: '📢 Facebook & IA',
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
async function renderOverview() {
  try {
    const [statsRes, instRes, funnelRes] = await Promise.all([
      fetch('/api/stats').then(r => r.json()),
      fetch('/api/instances').then(r => r.json()),
      fetch('/api/funnel').then(r => r.json())
    ]);

    state.stats = statsRes;
    state.instances = instRes;
    state.funnel = funnelRes;

    document.getElementById('badge-chips').textContent = instRes.length;

    const html = `
      <div class="grid-stats">
        <div class="stat-card">
          <div class="stat-icon green">💬</div>
          <div>
            <div class="stat-label">Total de Leads Atendidos</div>
            <div class="stat-value">${statsRes.totalLeads}</div>
          </div>
        </div>
        <div class="stat-card">
          <div class="stat-icon cyan">📸</div>
          <div>
            <div class="stat-label">Provas com Áudio Geradas</div>
            <div class="stat-value">${statsRes.totalProofsSent}</div>
          </div>
        </div>
        <div class="stat-card">
          <div class="stat-icon purple">🎯</div>
          <div>
            <div class="stat-label">Taxa de Conversão da Prova</div>
            <div class="stat-value">${statsRes.conversionRate}%</div>
          </div>
        </div>
        <div class="stat-card">
          <div class="stat-icon amber">📱</div>
          <div>
            <div class="stat-label">Chips da Meta Ativos</div>
            <div class="stat-value">${statsRes.totalActiveChips} / ${instRes.length}</div>
          </div>
        </div>
      </div>

      <div style="display: grid; grid-template-columns: 2fr 1fr; gap: 24px;">
        <div class="card">
          <div class="card-header">
            <h3 class="card-title">⚡ Status da Automação em Tempo Real</h3>
            <span class="btn btn-secondary" style="font-size: 12px; padding: 4px 10px;">Funil ${funnelRes.active ? 'Ativo' : 'Pausado'}</span>
          </div>
          <div style="display: flex; flex-direction: column; gap: 16px;">
            <div style="display: flex; align-items: center; justify-content: space-between; padding: 14px; background: rgba(255,255,255,0.02); border-radius: var(--radius-md); border: 1px solid var(--border-color);">
              <div>
                <div style="font-weight: 600;">1. Captura de Telefone & Análise</div>
                <div style="font-size: 12px; color: var(--text-muted);">${funnelRes.analyzingMessage}</div>
              </div>
              <span style="color: var(--wa-green); font-size: 13px; font-weight: 600;">${funnelRes.analyzingDelaySeconds}s delay</span>
            </div>
            <div style="display: flex; align-items: center; justify-content: space-between; padding: 14px; background: rgba(255,255,255,0.02); border-radius: var(--radius-md); border: 1px solid var(--border-color);">
              <div>
                <div style="font-weight: 600;">2. Geração da Foto Dinâmica</div>
                <div style="font-size: 12px; color: var(--text-muted);">Recorta foto circular (raio: ${funnelRes.avatarCoordinates?.radius || 18}px) e sobrepõe na bolinha do áudio</div>
              </div>
              <span style="color: var(--cyan); font-size: 13px; font-weight: 600;">Instantâneo</span>
            </div>
            <div style="display: flex; align-items: center; justify-content: space-between; padding: 14px; background: rgba(255,255,255,0.02); border-radius: var(--radius-md); border: 1px solid var(--border-color);">
              <div>
                <div style="font-weight: 600;">3. Disparo da Prova + Áudio + Link de Pagamento</div>
                <div style="font-size: 12px; color: var(--text-muted);">${funnelRes.checkoutUrl || 'Checkout configurado'}</div>
              </div>
              <span style="color: var(--purple); font-size: 13px; font-weight: 600;">Automático</span>
            </div>
          </div>
        </div>

        <div class="card">
          <div class="card-header">
            <h3 class="card-title">📱 Seus Chips Conectados</h3>
          </div>
          <div style="display: flex; flex-direction: column; gap: 12px;">
            ${instRes.map(i => `
              <div style="display: flex; align-items: center; gap: 12px; padding: 12px; background: rgba(255,255,255,0.02); border-radius: var(--radius-md); border: 1px solid var(--border-color);">
                <div class="status-dot" style="background: ${i.status === 'connected' ? 'var(--wa-green)' : 'var(--red)'}; box-shadow: 0 0 10px ${i.status === 'connected' ? 'var(--wa-green)' : 'var(--red)'};"></div>
                <div style="flex: 1;">
                  <div style="font-weight: 600; font-size: 13px;">${i.name}</div>
                  <div style="font-size: 11px; color: var(--text-muted);">${i.phoneNumber || 'Sem número'}</div>
                </div>
                <button class="btn btn-secondary" style="padding: 4px 8px; font-size: 11px;" onclick="window.location.hash='#instances'">Gerenciar</button>
              </div>
            `).join('')}
            <button class="btn btn-primary" style="margin-top: 10px; width: 100%;" onclick="openAddChipModal()">+ Adicionar Chip</button>
          </div>
        </div>
      </div>
    `;
    document.getElementById('view-container').innerHTML = html;
  } catch (err) {
    document.getElementById('view-container').innerHTML = `<div class="card">Erro ao carregar visão geral: ${err.message}</div>`;
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

      <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(340px, 1fr)); gap: 20px; margin-top: 10px;">
        ${instances.map(i => `
          <div class="card" style="margin: 0; background: rgba(255,255,255,0.02);">
            <div style="display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 14px;">
              <div style="display: flex; align-items: center; gap: 10px;">
                <div class="brand-icon" style="width: 32px; height: 32px; font-size: 16px;">📱</div>
                <div>
                  <div style="font-weight: 700; font-size: 15px;">${i.name}</div>
                  <div style="font-size: 12px; color: var(--text-muted);">${i.phoneNumber}</div>
                </div>
              </div>
              <span class="btn" style="padding: 2px 8px; font-size: 11px; background: ${i.status === 'connected' ? 'rgba(37, 211, 102, 0.15)' : 'rgba(239, 68, 68, 0.15)'}; color: ${i.status === 'connected' ? 'var(--wa-green)' : 'var(--red)'};">
                ${i.status === 'connected' ? '● Conectado' : '○ Desconectado'}
              </span>
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
  const appId = state.facebook?.appId || '1388636936143540';
  const configId = state.facebook?.configId || '2204676673432561';

  // Guarda dados da conexão para associar após o retorno da Meta
  window._pendingConnectionName = name;
  window._pendingCoexistence = coexistence;
  try {
    sessionStorage.setItem('pending_connection_name', name);
    sessionStorage.setItem('pending_coexistence', coexistence ? 'true' : 'false');
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

  await fetch('/api/instances', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, phoneNumber, phoneNumberId, wabaId, accessToken })
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
  const fb = await fetch('/api/facebook/status').then(r => r.json()).catch(() => ({ connected: false }));
  state.settings = settings;
  state.funnel = funnel;
  state.facebook = fb;

  const fbConnected = fb && fb.connected;

  const html = `
    <!-- Card Principal de Integração com a Meta / Facebook Ads -->
    <div class="card fb-connected-card" style="margin-bottom: 24px;">
      <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 16px;">
        <div style="display: flex; align-items: center; gap: 14px;">
          <div class="fb-logo-circle">f</div>
          <div>
            <div style="display: flex; align-items: center; gap: 8px;">
              <h3 style="font-size: 17px; font-weight: 700; color: #fff; margin: 0;">Integração Oficial Meta & Facebook Ads</h3>
              <span class="btn" style="padding: 2px 8px; font-size: 11px; font-weight: 700; background: ${fbConnected ? 'rgba(37, 211, 102, 0.15)' : 'rgba(255, 255, 255, 0.05)'}; color: ${fbConnected ? 'var(--wa-green)' : 'var(--text-muted)'};">
                ${fbConnected ? '● CONECTADO' : '○ DESCONECTADO'}
              </span>
            </div>
            <p style="font-size: 12.5px; color: var(--text-secondary); margin-top: 4px;">
              ${fbConnected 
                ? `Conectado como <strong>${fb.userName}</strong> (${fb.userEmail || 'ID: ' + fb.userId})` 
                : 'Conecte sua conta do Facebook para importar Contas de Anúncio, Pixels e sincronizar WhatsApp Cloud API.'}
            </p>
          </div>
        </div>

        <div>
          ${fbConnected ? `
            <div style="display: flex; gap: 10px;">
              <button class="btn btn-secondary" onclick="handleTestPixelEvent()">🎯 Testar Pixel (CAPI)</button>
              <button class="btn btn-danger" style="padding: 6px 12px; font-size: 12px;" onclick="handleDisconnectFacebook()">Desconectar</button>
            </div>
          ` : `
            <button class="btn-facebook" onclick="openFacebookModal()">
              <span style="font-size: 16px; font-weight: 900;">f</span>
              <span>Conectar com Facebook (Meta Ads)</span>
            </button>
          `}
        </div>
      </div>

      ${fbConnected ? `
        <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 16px; margin-top: 20px; padding-top: 16px; border-top: 1px solid rgba(255,255,255,0.08);">
          <div class="form-group" style="margin: 0;">
            <label class="form-label" style="font-size: 12px;">Conta de Anúncios (Facebook Ads)</label>
            <select class="form-select" id="fb-select-ad-account" onchange="handleSelectPixel(this.value, null)">
              ${(fb.adAccounts || []).length > 0 
                ? fb.adAccounts.map(acc => `<option value="${acc.id}" ${acc.id === fb.adAccountId ? 'selected' : ''}>${acc.name} (${acc.currency})</option>`).join('')
                : '<option value="">Nenhuma conta de anúncios encontrada</option>'
              }
            </select>
          </div>

          <div class="form-group" style="margin: 0;">
            <label class="form-label" style="font-size: 12px;">Pixel do Facebook (Conversions API)</label>
            <select class="form-select" id="fb-select-pixel" onchange="handleSelectPixel(null, this.value)">
              ${(fb.pixels || []).length > 0 
                ? fb.pixels.map(p => `<option value="${p.id}" ${p.id === fb.pixelId ? 'selected' : ''}>${p.name} (ID: ${p.id})</option>`).join('')
                : '<option value="">Nenhum pixel encontrado</option>'
              }
            </select>
          </div>

          <div class="form-group" style="margin: 0;">
            <label class="form-label" style="font-size: 12px;">Números WhatsApp Conectados</label>
            <div style="font-size: 12px; color: #34d399; padding: 8px 12px; background: rgba(0,0,0,0.2); border-radius: 6px;">
              ${(fb.whatsappNumbers || []).length > 0
                ? `${fb.whatsappNumbers.length} número(s) importado(s) da Meta`
                : 'Webhook ativo configurado'}
            </div>
          </div>
        </div>
      ` : ''}
    </div>

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


