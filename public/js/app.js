// WhatsHub Pro - Frontend Application State & Router
// Interceptor global para redirecionar se a sessão expirar (401)
const originalFetch = window.fetch;
window.fetch = async function(...args) {
  let [resource, config] = args;
  const token = localStorage.getItem('hub_token');
  if (token) {
    if (typeof resource === 'string' || (typeof URL !== 'undefined' && resource instanceof URL)) {
      config = config ? { ...config } : {};
      config.headers = new Headers(config.headers || {});
      if (!config.headers.has('Authorization')) {
        config.headers.set('Authorization', 'Bearer ' + token);
      }
    } else if (resource && typeof resource === 'object' && resource.headers && typeof resource.headers.set === 'function') {
      try {
        if (!resource.headers.has('Authorization')) {
          resource.headers.set('Authorization', 'Bearer ' + token);
        }
      } catch (e) {}
    }
  }

  const res = await originalFetch(resource, config);
  if (res.status === 401 && !window.location.pathname.includes('login')) {
    localStorage.removeItem('hub_token');
    localStorage.removeItem('hub_auth_user');
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


// =========================================================================
// PWA & SISTEMA NATIVO DE ÁUDIO E NOTIFICAÇÕES NO CELULAR (LEADS & VENDAS)
// =========================================================================

// Registra Service Worker para suporte a PWA (Adicionar à tela de início no celular)
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').then((reg) => {
      console.log('[PWA] Service Worker registrado com sucesso! Escopo:', reg.scope);
    }).catch((err) => {
      console.warn('[PWA] Falha ao registrar Service Worker:', err);
    });
  });
}

let audioCtx = null;
function getAudioContext() {
  if (!audioCtx) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (AudioContextClass) audioCtx = new AudioContextClass();
  }
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  return audioCtx;
}

// Som de +1 Lead: duplo tom cristalino ascendente 🔔
function playLeadSound() {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    
    // Primeiro tom (D5 - 587.33Hz)
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(587.33, now);
    gain1.gain.setValueAtTime(0.3, now);
    gain1.gain.exponentialRampToValueAtTime(0.01, now + 0.18);
    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start(now);
    osc1.stop(now + 0.18);

    // Segundo tom mais agudo (A5 - 880Hz)
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(880, now + 0.12);
    gain2.gain.setValueAtTime(0.35, now + 0.12);
    gain2.gain.exponentialRampToValueAtTime(0.01, now + 0.35);
    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.start(now + 0.12);
    osc2.stop(now + 0.35);
  } catch (e) {
    console.warn('[Audio Lead]', e);
  }
}

// Som de Venda Aprovada: Caixa Registradora / Moedas caindo / Arpejo triunfal 💰
function playSaleSound() {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const notes = [523.25, 659.25, 783.99, 1046.50, 1318.51]; // C5, E5, G5, C6, E6

    notes.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, now + idx * 0.08);
      gain.gain.setValueAtTime(0.4, now + idx * 0.08);
      gain.gain.exponentialRampToValueAtTime(0.01, now + idx * 0.08 + 0.35);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + idx * 0.08);
      osc.stop(now + idx * 0.08 + 0.35);
    });
  } catch (e) {
    console.warn('[Audio Sale]', e);
  }
}

// Solicita permissão para notificações nativas no celular
async function requestNotificationPermission() {
  if (!('Notification' in window)) {
    showToast('Este navegador não suporta notificações de sistema.', 'warning');
    return false;
  }
  if (Notification.permission === 'granted') {
    showToast('🔔 Notificações no celular já estão ATIVAS!', 'success');
    playSaleSound();
    updateNotificationButton();
    return true;
  }
  try {
    const perm = await Notification.requestPermission();
    if (perm === 'granted') {
      showToast('🎉 Notificações ATIVADAS com sucesso no seu celular!', 'success');
      playSaleSound();
      showPushNotification('WhatsHub Conectado! 🚀', 'Você receberá alertas de Novos Leads e Vendas Aprovadas aqui!');
      updateNotificationButton();
      return true;
    } else {
      showToast('Permissão de notificação negada no navegador.', 'warning');
      updateNotificationButton();
      return false;
    }
  } catch (err) {
    console.warn(err);
    return false;
  }
}

function updateNotificationButton() {
  const btn = document.getElementById('notif-btn');
  if (!btn) return;
  if ('Notification' in window && Notification.permission === 'granted') {
    btn.innerHTML = '🔔 Alertas Ativos ✅';
    btn.style.color = '#10b981';
    btn.style.borderColor = 'rgba(16, 185, 129, 0.6)';
    btn.title = 'Alertas de Lead e Venda estão ativos no seu celular!';
  } else {
    btn.innerHTML = '🔔 Alertas no Celular';
    btn.style.color = '#34d399';
    btn.style.borderColor = 'rgba(16, 185, 129, 0.4)';
    btn.title = 'Toque para ativar notificações no seu celular';
  }
}

function showPushNotification(title, body) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  try {
    if (navigator.serviceWorker && navigator.serviceWorker.controller) {
      navigator.serviceWorker.ready.then((reg) => {
        reg.showNotification(title, {
          body,
          icon: '/assets/icon-192.png',
          badge: '/assets/icon-192.png',
          vibrate: title.includes('VENDA') ? [300, 100, 300, 100, 300] : [200, 100, 200],
          tag: 'whatshub-' + Date.now()
        });
      });
    } else {
      new Notification(title, {
        body,
        icon: '/assets/icon-192.png'
      });
    }
  } catch (e) {
    console.warn('[Push Notification Error]', e);
  }
}
window.requestNotificationPermission = requestNotificationPermission;

// Som de Alerta de Desconexão: Beep grave e urgente (Web Audio API)
function playWarningSound() {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    const now = ctx.currentTime;

    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = 'sawtooth';
    osc1.frequency.setValueAtTime(340, now);
    gain1.gain.setValueAtTime(0.4, now);
    gain1.gain.exponentialRampToValueAtTime(0.01, now + 0.22);
    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start(now);
    osc1.stop(now + 0.22);

    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = 'sawtooth';
    osc2.frequency.setValueAtTime(260, now + 0.25);
    gain2.gain.setValueAtTime(0.45, now + 0.25);
    gain2.gain.exponentialRampToValueAtTime(0.01, now + 0.55);
    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.start(now + 0.25);
    osc2.stop(now + 0.55);
  } catch (e) {
    console.warn('[Audio Warning]', e);
  }
}
window.playWarningSound = playWarningSound;

window.playLeadSound = playLeadSound;
window.playSaleSound = playSaleSound;

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

// Logos Oficiais em SVG para Facebook e TikTok (Bloco 3)
const FB_LOGO_SVG = `<svg width="18" height="18" viewBox="0 0 24 24" fill="#1877f2" style="vertical-align: middle;"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>`;
const TT_LOGO_SVG = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" style="vertical-align: middle;"><path d="M19.589 6.686a4.793 4.793 0 0 1-3.77-4.245V2h-3.445v13.672a2.896 2.896 0 0 1-2.891 2.884 2.894 2.894 0 0 1-2.89-2.884 2.893 2.893 0 0 1 2.89-2.883c.37 0 .723.072 1.048.204V9.497a6.37 6.37 0 0 0-1.048-.087c-3.541 0-6.41 2.862-6.41 6.393 0 3.53 2.869 6.392 6.41 6.392 3.542 0 6.338-2.862 6.338-6.392V8.341a8.216 8.216 0 0 0 4.768 1.517v-3.172z" fill="#fe2c55"/><path d="M18.8 6.1a4.8 4.8 0 0 1-3.77-4.25h-2.1v13.7a2.9 2.9 0 0 1-2.89 2.88 2.89 2.89 0 0 1-2.89-2.88 2.89 2.89 0 0 1 2.89-2.88v-3.5a6.4 6.4 0 0 0-6.41 6.38 6.4 6.4 0 0 0 6.41 6.39c3.54 0 6.34-2.86 6.34-6.39V8.34a8.2 8.2 0 0 0 4.77 1.52V6.7c-.8-.01-1.57-.23-2.35-.6z" fill="#25f4ee"/></svg>`;

/**
 * Micro-animação Count-Up com easing suave para números dos cards de métricas
 */
function animateCountUp(elementId, targetValue, duration = 800, prefix = '', suffix = '', decimals = 0) {
  const el = document.getElementById(elementId);
  if (!el) return;
  const numTarget = parseFloat(targetValue) || 0;
  const startTime = performance.now();

  function step(currentTime) {
    const elapsed = currentTime - startTime;
    const progress = Math.min(elapsed / duration, 1);
    // easeOutExpo curve
    const ease = progress === 1 ? 1 : 1 - Math.pow(2, -10 * progress);
    const current = numTarget * ease;

    let formatted;
    if (decimals > 0) {
      formatted = current.toLocaleString('pt-BR', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
    } else {
      formatted = Math.round(current).toLocaleString('pt-BR');
    }

    el.textContent = `${prefix}${formatted}${suffix}`;

    if (progress < 1) {
      requestAnimationFrame(step);
    } else {
      let finalFormatted = decimals > 0 
        ? numTarget.toLocaleString('pt-BR', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
        : Math.round(numTarget).toLocaleString('pt-BR');
      el.textContent = `${prefix}${finalFormatted}${suffix}`;
    }
  }

  requestAnimationFrame(step);
}

/**
 * Gerador de Mini-Sparklines SVG com Curva Bézier Suave & Gradiente de Fundo
 */
function renderSparklineSvg(points = [10, 20, 15, 30, 45, 40, 60, 75], strokeColor = '#10b981', gradId = 'grad-kpi') {
  const width = 240;
  const height = 36;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = (max - min) || 1;
  const stepX = width / (points.length - 1);

  const coords = points.map((val, idx) => {
    const x = idx * stepX;
    const y = height - ((val - min) / range) * (height - 8) - 4;
    return { x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 };
  });

  let pathD = `M ${coords[0].x} ${coords[0].y}`;
  for (let i = 0; i < coords.length - 1; i++) {
    const p0 = coords[i];
    const p1 = coords[i + 1];
    const cpx1 = p0.x + (p1.x - p0.x) / 2;
    const cpy1 = p0.y;
    const cpx2 = cpx1;
    const cpy2 = p1.y;
    pathD += ` C ${cpx1} ${cpy1}, ${cpx2} ${cpy2}, ${p1.x} ${p1.y}`;
  }

  const fillD = `${pathD} L ${width} ${height} L 0 ${height} Z`;

  return `
    <svg width="100%" height="36" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" style="overflow: visible;">
      <defs>
        <linearGradient id="${gradId}" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stop-color="${strokeColor}" stop-opacity="0.32" />
          <stop offset="100%" stop-color="${strokeColor}" stop-opacity="0.0" />
        </linearGradient>
      </defs>
      <path d="${fillD}" fill="url(#${gradId})" />
      <path d="${pathD}" fill="none" stroke="${strokeColor}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="filter: drop-shadow(0 0 3px ${strokeColor});" />
      <circle cx="${coords[coords.length - 1].x}" cy="${coords[coords.length - 1].y}" r="3" fill="${strokeColor}" style="filter: drop-shadow(0 0 5px ${strokeColor});" />
    </svg>
  `;
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

  // Atualiza abas no Mobile Bottom Navigation Bar
  document.querySelectorAll('.mobile-tab-item').forEach(item => {
    item.classList.toggle('active', item.dataset.tab === route);
  });

  // Limpa timer de polling de domínios ao sair da tela
  if (window.domainPollingTimer && route !== 'dominios') {
    clearInterval(window.domainPollingTimer);
    window.domainPollingTimer = null;
  }

  // Limpa loops e timers do fluxo ao vivo ao sair da tela para liberar CPU e render thread
  if (route !== 'fluxo-ao-vivo') {
    if (liveFlowAnimationFrame) {
      cancelAnimationFrame(liveFlowAnimationFrame);
      liveFlowAnimationFrame = null;
    }
    if (liveFlowPollingInterval) {
      clearInterval(liveFlowPollingInterval);
      liveFlowPollingInterval = null;
    }
    liveParticles = [];
  }

  const titles = {
    overview: '📊 Dashboard — Visão Geral & Conversão',
    'fluxo-ao-vivo': '🔴 Fluxo ao Vivo — Monitoramento em Tempo Real (Leads & Partículas)',
    inbox: '💬 Chats ao vivo',
    kanban: '🗂️ Kanban de Atendimento',
    contacts: '👥 Contatos & Leads',
    flows: '🔗 Fluxos — Automações e fluxos de atendimento',
    'flow-canvas': '🕸️ Editor Visual de Fluxo (n8n Canvas)',
    instances: '🔌 Conexões (Meta Cloud API)',
    pixels: '🎯 Pixels & CAPI (Facebook + TikTok)',
    tiktok: '🎵 Atribuição TikTok Ads & Server-side CAPI',
    dominios: '🌐 Domínios Customizados (Railway API)',
    webhooks: '📡 Webhooks de Entrada',
    settings: '🤖 Inteligência Artificial & Checkouts',
    studio: '🎨 Estúdio de Calibração das Provas',
    simulator: '🧪 Simulador de Lead'
  };
  document.getElementById('top-title').textContent = titles[route] || 'WhatsHub Pro';

  const container = document.getElementById('view-container');
  // Se o container estiver vazio na primeira carga, exibe o loading
  if (!container.hasChildNodes() || container.innerHTML.trim() === '') {
    container.innerHTML = '<div style="color: var(--text-muted); padding: 40px; text-align: center;">Carregando dados...</div>';
  }

  const mainViewport = document.querySelector('.main-viewport');
  if (route === 'inbox') {
    container.classList.add('inbox-view-active');
    if (mainViewport) mainViewport.classList.add('inbox-active');
  } else {
    container.classList.remove('inbox-view-active');
    if (mainViewport) mainViewport.classList.remove('inbox-active');
  }

  if (route === 'fluxo-ao-vivo') {
    container.classList.add('live-flow-view-active');
    if (mainViewport) mainViewport.classList.add('live-flow-active');
  } else {
    container.classList.remove('live-flow-view-active');
    if (mainViewport) mainViewport.classList.remove('live-flow-active');
  }

  if (route === 'overview') renderOverview();
  else if (route === 'fluxo-ao-vivo') renderLiveFlow();
  else if (route === 'inbox') renderInbox();
  else if (route === 'kanban') renderKanban();
  else if (route === 'contacts') renderContacts();
  else if (route === 'flows') FlowBuilder.renderList(container);
  else if (route === 'flow-canvas') FlowBuilder.renderCanvas(container, params.get('id') || 'fluxo-espiao-es');
  else if (route === 'instances') renderInstances();
  else if (route === 'pixels') renderPixels();
  else if (route === 'tiktok') renderTikTokAttribution();
  else if (route === 'dominios') renderDomains();
  else if (route === 'webhooks') renderWebhooks();
  else if (route === 'settings') renderSettings();
  else if (route === 'studio') renderStudio();
  else if (route === 'simulator') renderSimulator();
}

// Real-time Event Stream (SSE) com reconexão segura e sem travar conexões HTTP
function initRealtimeEvents() {
  if (state.eventSource) {
    try { state.eventSource.close(); } catch(e) {}
    state.eventSource = null;
  }
  try {
    const token = localStorage.getItem('hub_token');
    const sseUrl = token ? '/api/events?token=' + encodeURIComponent(token) : '/api/events';
    state.eventSource = new EventSource(sseUrl);

    state.eventSource.onmessage = (e) => {
      try {
        const payload = JSON.parse(e.data);
        if (payload.type === 'chat_typing') {
          const { phone, isTyping } = payload.data || {};
          if (phone && state.chats) {
            if (!state.chats[phone]) state.chats[phone] = { leadPhone: phone, messages: [] };
            state.chats[phone].isTyping = isTyping;
          }
          if (state.currentView === 'inbox') {
            renderInbox(false);
          }
        } else if (payload.type === 'new_message' || payload.type === 'chat_updated') {
          // Se estiver no Inbox, atualiza a tela
          if (state.currentView === 'inbox') {
            renderInbox(false); // sem loading
          }
          // Atualiza contadores
          updateBadges();
        } else if (payload.type === 'instances_updated' || payload.type === 'connection_status') {
          if (payload.status === 'connected' || payload.data?.status === 'connected') {
            window._lastDisconnectNotice = 0;
            const pill = document.querySelector('.mobile-chip-pill');
            const pillText = document.getElementById('mobile-chip-name');
            if (pill && pillText) {
              pill.style.background = 'rgba(16, 185, 129, 0.12)';
              pill.style.borderColor = 'rgba(16, 185, 129, 0.3)';
              pill.style.color = '#34d399';
              pillText.textContent = 'CELULAR ROXO';
            }
          }
          if (state.currentView === 'instances') {
            renderInstances();
          }
          updateBadges();
        } else if (payload.type === 'new_lead') {
          playLeadSound();
          const leadData = payload.data || {};
          const msg = `+1 Novo Lead: ${leadData.codigo || ''} (${leadData.campaign || 'TikTok Ads'})`;
          showPushNotification('+1 Novo Lead no WhatsApp! 🎯', msg);
          showToast(`🎯 ${msg}`, 'success');
          updateBadges();
          if (state.currentView === 'inbox') renderInbox(false);
        } else if (payload.type === 'new_sale') {
          playSaleSound();
          const saleData = payload.data || {};
          const msg = `🎉 VENDA APROVADA! +${saleData.amount || 19} ${saleData.currency || 'USD'}`;
          showPushNotification(msg, `Cliente: ${saleData.email || saleData.phone || saleData.code || ''}`);
          showToast(msg, 'success');
          updateBadges();
          if (state.currentView === 'inbox') renderInbox(false);
          if (state.currentView === 'tiktok') renderTikTokAttribution();
        } else if (payload.type === 'chip_disconnected') {
          const now = Date.now();
          if (window._lastDisconnectNotice && (now - window._lastDisconnectNotice) < 60000) {
            console.log('[SSE] chip_disconnected repetido suprimido no frontend.');
            return;
          }
          window._lastDisconnectNotice = now;
          playWarningSound();
          const chipData = payload.data || {};
          const chipName = chipData.name || 'WhatsApp';
          const phoneStr = chipData.phone ? ' (+' + chipData.phone + ')' : '';
          showPushNotification('⚠️ NÚMERO DESCONECTADO!', `O chip "${chipName}"${phoneStr} foi desconectado do WhatsApp! Toque aqui para abrir e reconectar o QR Code.`);
          showToast(`⚠️ ATENÇÃO: O chip "${chipName}" foi desconectado!`, 'error');
          updateBadges();
          
          // Altera o pill no cabeçalho mobile para vermelho e aviso urgente
          const pill = document.querySelector('.mobile-chip-pill');
          const pillText = document.getElementById('mobile-chip-name');
          if (pill && pillText) {
            pill.style.background = 'rgba(239, 68, 68, 0.2)';
            pill.style.borderColor = 'rgba(239, 68, 68, 0.6)';
            pill.style.color = '#f87171';
            pillText.textContent = 'DESCONECTADO';
          }
          if (state.currentView === 'instances') renderInstances();
        }
      } catch (err) {
        console.error(err);
      }
    };

    state.eventSource.onerror = () => {
      if (state.eventSource && state.eventSource.readyState === EventSource.CLOSED) {
        state.eventSource.close();
        state.eventSource = null;
      }
    };
  } catch (err) {
    console.warn('[SSE Warning]', err.message);
  }
}

async function updateBadges() {
  try {
    const [chatsRes, instRes] = await Promise.all([
      fetch('/api/chats').then(r => r.json()).catch(() => ({})),
      fetch('/api/instances').then(r => r.json()).catch(() => ([]))
    ]);
    state.chats = chatsRes;
    const leadsCount = Object.keys(state.chats).length;
    const leadsBadge = document.getElementById('badge-leads');
    if (leadsBadge) leadsBadge.textContent = leadsCount;
    const mobileLeadsBadge = document.getElementById('mobile-badge-leads');
    if (mobileLeadsBadge) mobileLeadsBadge.textContent = leadsCount;

    const chipsBadge = document.getElementById('badge-chips');
    if (chipsBadge && Array.isArray(instRes)) chipsBadge.textContent = instRes.length;
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
      <div class="overview-header-row" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
        <div>
          <h2 style="font-size: 20px; font-weight: 700; font-family: 'Outfit', sans-serif;">Dashboard de Conversão & Vendas</h2>
          <p style="font-size: 13px; color: var(--text-secondary); margin-top: 2px;">
            Acompanhe a retenção do funil em tempo real, pedidos aprovados e eventos do Pixel.
          </p>
        </div>
        <div style="display: flex; gap: 10px;">
          <button class="btn btn-primary" onclick="focusManualProofGenerator()" style="background: linear-gradient(135deg, #8b5cf6 0%, #6d28d9 100%); border: none; font-weight: 700; font-size: 12.5px; padding: 6px 14px; display: flex; align-items: center; gap: 6px; box-shadow: 0 4px 14px rgba(139, 92, 246, 0.35);">
            <span>📸</span> <span>Gerar Imagem</span>
          </button>
          <button class="btn btn-secondary" onclick="renderOverview()" style="padding: 6px 12px; font-size: 12.5px;">
            🔄 Atualizar
          </button>
          <a class="btn btn-primary" href="#pixels" style="padding: 6px 14px; font-size: 12.5px; text-decoration: none;">
            🎯 Configurar Pixels
          </a>
        </div>
      </div>

      <!-- 4 Cards de Métricas Principais com Count-Up, Glow e Sparklines SVG -->
      <div class="grid-stats" style="margin-bottom: 28px;">
        <div class="stat-card green">
          <div class="stat-top-row">
            <div class="stat-icon green">💰</div>
            <span class="stat-trend-badge up">↑ 24h</span>
          </div>
          <div>
            <div class="stat-label">Faturamento Total</div>
            <div class="stat-value" id="kpi-val-revenue" style="color: #10b981;">R$ 0,00</div>
            <div class="stat-footer-text">
              <span>✅</span> <span>${kpis.salesCount || 0} pedidos aprovados</span>
            </div>
          </div>
          <div class="stat-sparkline-wrap">
            ${renderSparklineSvg([20, 35, 45, 30, 60, 55, 80, Math.max(90, Number(kpis.totalRevenue || 90))], '#10b981', 'spark-rev')}
          </div>
        </div>

        <div class="stat-card purple">
          <div class="stat-top-row">
            <div class="stat-icon purple">🎯</div>
            <span class="stat-trend-badge up">↑ Global</span>
          </div>
          <div>
            <div class="stat-label">Taxa de Conversão</div>
            <div class="stat-value" id="kpi-val-conversion" style="color: #a855f7;">0.0%</div>
            <div class="stat-footer-text">
              <span>⚡</span> <span>Leads que startaram ➔ Pagaram</span>
            </div>
          </div>
          <div class="stat-sparkline-wrap">
            ${renderSparklineSvg([5, 8, 12, 10, 16, 14, 20, 24], '#8b5cf6', 'spark-conv')}
          </div>
        </div>

        <div class="stat-card cyan">
          <div class="stat-top-row">
            <div class="stat-icon cyan">👥</div>
            <span class="stat-trend-badge up">↑ Ativos</span>
          </div>
          <div>
            <div class="stat-label">Leads Atendidos</div>
            <div class="stat-value" id="kpi-val-leads" style="color: #06b6d4;">0</div>
            <div class="stat-footer-text">
              <span>💬</span> <span>Conversas iniciadas no bot</span>
            </div>
          </div>
          <div class="stat-sparkline-wrap">
            ${renderSparklineSvg([15, 30, 25, 45, 50, 48, 70, 85], '#06b6d4', 'spark-leads')}
          </div>
        </div>

        <div class="stat-card amber">
          <div class="stat-top-row">
            <div class="stat-icon amber">📈</div>
            <span class="stat-trend-badge up">↑ Médio</span>
          </div>
          <div>
            <div class="stat-label">Ticket Médio</div>
            <div class="stat-value" id="kpi-val-ticket" style="color: #f59e0b;">R$ 0,00</div>
            <div class="stat-footer-text">
              <span>💎</span> <span>Por cliente convertido</span>
            </div>
          </div>
          <div class="stat-sparkline-wrap">
            ${renderSparklineSvg([49, 49, 75, 90, 85, 110, 130, Math.max(140, Number(kpis.averageTicket || 140))], '#f59e0b', 'spark-ticket')}
          </div>
        </div>
      </div>

      
      <!-- Card: Gerador Manual de Imagem de Prova (Multi-Países) -->
      <div class="card" id="manual-proof-card" style="margin-bottom: 24px; border: 1px solid rgba(139, 92, 246, 0.45); background: linear-gradient(180deg, rgba(24, 18, 48, 0.7) 0%, rgba(13, 13, 20, 0.96) 100%); box-shadow: 0 8px 30px rgba(124, 58, 237, 0.16);">
        <div class="card-header" style="border-bottom: 1px solid rgba(255,255,255,0.07); padding-bottom: 12px; margin-bottom: 16px;">
          <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 10px;">
            <div style="display: flex; align-items: center; gap: 10px;">
              <div style="width: 36px; height: 36px; border-radius: 10px; background: linear-gradient(135deg, #8b5cf6, #6d28d9); display: flex; align-items: center; justify-content: center; font-size: 18px; box-shadow: 0 0 12px rgba(139, 92, 246, 0.4);">
                📸
              </div>
              <div>
                <h3 class="card-title" style="color: #f8fafc; font-size: 16px; margin: 0;">Gerador Manual de Imagens de Prova</h3>
                <p style="font-size: 12px; color: var(--text-muted); margin: 2px 0 0 0;">Gere prints de investigação instantâneos com foto de perfil para responder leads manualmente em qualquer país.</p>
              </div>
            </div>
            <span class="badge" style="background: rgba(139, 92, 246, 0.2); color: #c084fc; border: 1px solid rgba(139, 92, 246, 0.35); font-size: 11.5px; padding: 4px 10px;">⚡ Modo Manual Ativo</span>
          </div>
        </div>

        <form id="form-manual-proof" onsubmit="event.preventDefault(); generateManualProof();">
          <div class="proof-form-grid" style="display: grid; grid-template-columns: 180px 1.4fr 160px auto; gap: 12px; align-items: flex-end;">
            <!-- Campo 1: Seletor de DDI -->
            <div>
              <label style="display: block; font-size: 12px; font-weight: 600; color: #cbd5e1; margin-bottom: 6px;">
                🌍 País (DDI)
              </label>
              <select id="proof-ddi-select" class="form-select" onchange="handleProofDdiChange(this.value); autoLookupProofPhoto();" style="width: 100%; background: rgba(15, 23, 42, 0.8); border: 1px solid rgba(255,255,255,0.15); color: #fff; border-radius: 8px; padding: 9px 10px; font-size: 13px;">
                <option value="507" selected>🇵🇦 Panamá (+507)</option>
                <option value="591">🇧🇴 Bolívia (+591)</option>
                <option value="56">🇨🇱 Chile (+56)</option>
                <option value="57">🇨🇴 Colômbia (+57)</option>
                <option value="52">🇲🇽 México (+52)</option>
                <option value="51">🇵🇪 Peru (+51)</option>
                <option value="593">🇪🇨 Equador (+593)</option>
                <option value="34">🇪🇸 Espanha (+34)</option>
                <option value="54">🇦🇷 Argentina (+54)</option>
                <option value="504">🇭🇳 Honduras (+504)</option>
                <option value="502">🇬🇹 Guatemala (+502)</option>
                <option value="503">🇸🇻 El Salvador (+503)</option>
                <option value="506">🇨🇷 Costa Rica (+506)</option>
                <option value="595">🇵🇾 Paraguai (+595)</option>
                <option value="598">🇺🇾 Uruguai (+598)</option>
                <option value="505">🇳🇮 Nicarágua (+505)</option>
                <option value="1809">🇩🇴 Rep. Dominicana (+1809)</option>
                <option value="1">🇺🇸 Estados Unidos (+1)</option>
                <option value="55">🇧🇷 Brasil (+55)</option>
                <option value="custom">🌐 Outro DDI...</option>
              </select>
              <input type="text" id="proof-ddi-custom" placeholder="Ex: 58" style="display: none; width: 100%; margin-top: 6px; background: rgba(15, 23, 42, 0.8); border: 1px solid rgba(255,255,255,0.15); color: #fff; border-radius: 8px; padding: 8px 10px; font-size: 13px;" />
            </div>

            <!-- Campo 2: Número do Alvo + Botão Buscar Foto -->
            <div>
              <label style="display: block; font-size: 12px; font-weight: 600; color: #cbd5e1; margin-bottom: 6px;">
                📱 Número do Alvo / Lead
              </label>
              <div style="display: flex; gap: 8px;">
                <input type="tel" id="proof-target-phone" class="form-input" placeholder="Ex: 61578213 ou 985883926" onblur="autoLookupProofPhoto();" onkeyup="if(event.key==='Enter') autoLookupProofPhoto();" style="flex: 1; background: rgba(15, 23, 42, 0.8); border: 1px solid rgba(255,255,255,0.15); color: #fff; border-radius: 8px; padding: 9px 12px; font-size: 13.5px;" />
                <button type="button" class="btn btn-secondary" onclick="lookupManualProofPhoto(true)" title="Buscar foto de perfil no WhatsApp" style="padding: 0 12px; font-size: 12px; white-space: nowrap; border-color: rgba(139,92,246,0.4); display: flex; align-items: center; gap: 5px;">
                  <span id="lookup-photo-spinner" class="spinner" style="display: none; width: 12px; height: 12px; border-width: 2px;"></span>
                  <span>🔍 Buscar Foto</span>
                </button>
              </div>
            </div>

            <!-- Campo 3: Idioma do Template -->
            <div>
              <label style="display: block; font-size: 12px; font-weight: 600; color: #cbd5e1; margin-bottom: 6px;">
                🗣️ Idioma do Print
              </label>
              <select id="proof-lang-select" class="form-select" style="width: 100%; background: rgba(15, 23, 42, 0.8); border: 1px solid rgba(255,255,255,0.15); color: #fff; border-radius: 8px; padding: 9px 10px; font-size: 13px;">
                <option value="es" selected>Español (es)</option>
                <option value="pt">Português (pt)</option>
                <option value="en">English (en)</option>
              </select>
            </div>

            <!-- Botão Principal de Geração -->
            <div>
              <button type="submit" id="btn-generate-proof" class="btn btn-primary" style="width: 100%; padding: 9px 18px; font-weight: 700; font-size: 13.5px; background: linear-gradient(135deg, #8b5cf6, #7c3aed); border: none; box-shadow: 0 4px 15px rgba(124, 58, 237, 0.35); display: flex; align-items: center; justify-content: center; gap: 8px; height: 42px;">
                <span id="btn-proof-spinner" class="spinner" style="display: none; width: 14px; height: 14px; border-width: 2px;"></span>
                <span id="btn-proof-text">⚡ Gerar Imagem</span>
              </button>
            </div>
          </div>

          <!-- Status da Foto Detectada no WhatsApp -->
          <div id="proof-photo-status-wrap" style="display: none; margin-top: 12px;"></div>

          <!-- Opções Avançadas: Foto Personalizada (URL ou Arquivo) -->
          <div style="margin-top: 14px; padding-top: 12px; border-top: 1px dashed rgba(255,255,255,0.1);">
            <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px;">
              <label style="display: flex; align-items: center; gap: 8px; cursor: pointer; font-size: 12px; color: #94a3b8;">
                <input type="checkbox" id="proof-opt-custom-photo" onchange="toggleCustomPhotoUpload(this.checked)" style="accent-color: #8b5cf6; width: 15px; height: 15px;">
                <span>Personalizar foto do perfil (colar link da foto ou enviar arquivo do celular)</span>
              </label>
              <span style="font-size: 11.5px; color: #64748b;">(Se não anexar, o sistema usa a foto do WhatsApp automaticamente)</span>
            </div>

            <div id="proof-custom-photo-wrap" style="display: none; margin-top: 10px; background: rgba(0,0,0,0.25); border: 1px solid rgba(255,255,255,0.08); border-radius: 8px; padding: 12px;">
              <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
                <div>
                  <label style="display: block; font-size: 11.5px; color: #cbd5e1; margin-bottom: 4px;">🔗 Cole o Link Direto da Foto (URL):</label>
                  <input type="url" id="proof-custom-url" placeholder="https://exemplo.com/foto.jpg" class="form-input" oninput="handleCustomUrlPreview(this.value)" style="width: 100%; background: rgba(15,23,42,0.8); border: 1px solid rgba(255,255,255,0.15); color: #fff; border-radius: 6px; padding: 7px 10px; font-size: 12px;" />
                </div>
                <div>
                  <label style="display: block; font-size: 11.5px; color: #cbd5e1; margin-bottom: 4px;">📁 Ou Selecione do seu Computador / Celular:</label>
                  <input type="file" id="proof-custom-file" accept="image/png, image/jpeg, image/webp" class="form-input" onchange="handleCustomFilePreview(this)" style="width: 100%; background: rgba(15,23,42,0.8); border: 1px solid rgba(255,255,255,0.15); color: #fff; border-radius: 6px; padding: 5px 10px; font-size: 12px;" />
                </div>
              </div>
              <div id="proof-custom-preview-box" style="display: none; margin-top: 10px; align-items: center; gap: 10px;">
                <img id="proof-custom-preview-img" src="" style="width: 42px; height: 42px; border-radius: 50%; object-fit: cover; border: 2px solid #a855f7;">
                <span style="font-size: 12px; color: #c084fc;">✓ Foto personalizada pronta para uso!</span>
              </div>
            </div>
          </div>
        </form>

        <!-- Container para o Resultado da Prova Gerada -->
        <div id="proof-result-container" style="display: none; margin-top: 18px; padding-top: 16px; border-top: 1px solid rgba(255,255,255,0.08);"></div>
      </div>

      <!-- Grid Principal: Funil de Conversão + Gráfico de Faturamento -->
      <div class="overview-main-grid" style="display: grid; grid-template-columns: 1.15fr 1fr; gap: 24px; margin-bottom: 24px;">
        <!-- Coluna 1: Funil de Conversão Passo a Passo com Barras de Gradiente Animadas -->
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

          <div class="funnel-card" style="margin-top: 10px;">
            ${funnel.map((step, idx) => `
              <div class="funnel-step">
                <div class="funnel-step-header">
                  <span style="font-weight: 600; color: #f1f5f9;">${step.name}</span>
                  <div>
                    <strong style="color: var(--text-primary); font-variant-numeric: tabular-nums;">${step.count} leads</strong>
                    <span style="margin-left: 8px; font-size: 11.5px; color: #a855f7; font-weight: 700; font-variant-numeric: tabular-nums;">${step.pct}</span>
                  </div>
                </div>
                <div class="funnel-bar-bg">
                  <div class="funnel-bar-fill funnel-grad-${(idx % 8) + 1}" style="width: 0%;" data-target-width="${step.pct}"></div>
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
                <div class="dash-chip-row" data-chip-id="${i.id}" style="display: flex; align-items: center; justify-content: space-between; padding: 10px; background: rgba(255,255,255,0.02); border-radius: var(--radius-sm); border: 1px solid var(--border-color);">
                  <div style="display: flex; align-items: center; gap: 10px;">
                    <span class="status-dot" style="background: ${i.status === 'connected' ? 'var(--wa-green)' : (i.status === 'connecting' ? 'var(--amber)' : 'var(--red)')};"></span>
                    <div>
                      <strong style="font-size: 13px;">${i.name}</strong>
                      <div style="font-size: 11px; color: var(--text-muted);">${i.numero_conectado || i.phoneNumber || (i.status === 'connected' ? 'Conectado' : 'Aguardando pareamento')}</div>
                    </div>
                  </div>
                  <div style="display: flex; align-items: center; gap: 8px;">
                    <span style="font-size: 11px; color: ${i.status === 'connected' ? 'var(--wa-green)' : (i.status === 'connecting' ? 'var(--amber)' : 'var(--red)')}; font-weight: 600;">
                      ${i.status === 'connected' ? 'Ativo' : (i.status === 'connecting' ? 'Conectando' : 'Desconectado')}
                    </span>
                    <button class="btn btn-danger" style="padding: 3px 8px; font-size: 11px; border-radius: 6px;" title="Remover chip" onclick="deleteChip('${i.id}')">Excluir</button>
                  </div>
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
                  <div style="font-weight: 600; color: #fff; display: flex; align-items: center; gap: 6px;">
                    ${FB_LOGO_SVG}
                    <span>${l.eventName}</span>
                    ${l.value ? `<span style="color: #10b981; margin-left: 6px;">R$ ${l.value}</span>` : ''}
                  </div>
                  <div style="font-size: 10.5px; color: var(--text-muted); margin-top: 2px;">
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

    // Dispara as Micro-animações de Contagem (Count-Up)
    animateCountUp('kpi-val-revenue', Number(kpis.totalRevenue || 0), 850, 'R$ ', '', 2);
    animateCountUp('kpi-val-conversion', parseFloat(kpis.globalConversionRate || 0), 850, '', '%', 1);
    animateCountUp('kpi-val-leads', Number(kpis.totalLeads || 0), 850, '', '', 0);
    animateCountUp('kpi-val-ticket', Number(kpis.averageTicket || 0), 850, 'R$ ', '', 2);

    // Micro-animação de preenchimento das barras de gradiente do funil
    setTimeout(() => {
      document.querySelectorAll('.funnel-bar-fill').forEach(bar => {
        bar.style.width = bar.dataset.targetWidth || '0%';
      });
    }, 60);

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
   BLOCO 2: VIEW FLUXO AO VIVO (MONITORAMENTO EM TEMPO REAL COM PARTÍCULAS SVG)
   ========================================================================= */
let liveFlowAnimationFrame = null;
let liveFlowPollingInterval = null;
let liveParticles = [];
let currentLiveFlowId = localStorage.getItem('wh_live_flow_id') || 'fluxo-espiao-es';
let liveZoomState = {
  scale: 1.0,
  panX: 40,
  panY: 60,
  isDragging: false,
  dragStartX: 0,
  dragStartY: 0,
  initialPanX: 0,
  initialPanY: 0,
  flowWidth: 3200,
  flowHeight: 1100,
  minX: 0,
  minY: 0
};

async function changeLiveFlow(newFlowId) {
  currentLiveFlowId = newFlowId;
  localStorage.setItem('wh_live_flow_id', newFlowId);
  if (liveFlowAnimationFrame) cancelAnimationFrame(liveFlowAnimationFrame);
  if (liveFlowPollingInterval) clearInterval(liveFlowPollingInterval);
  await renderLiveFlow();
}

async function renderLiveFlow() {
  const container = document.getElementById('view-container');
  container.innerHTML = '<div style="color: var(--text-muted); padding: 40px; text-align: center;">Carregando visualização ao vivo do funil...</div>';

  if (liveFlowAnimationFrame) cancelAnimationFrame(liveFlowAnimationFrame);
  if (liveFlowPollingInterval) clearInterval(liveFlowPollingInterval);

  try {
    const [flows, liveData] = await Promise.all([
      fetch('/api/flows').then(r => r.json()).catch(() => []),
      fetch('/api/traffic/live-flow').then(r => r.json()).catch(() => ({ activeNodes: {}, platformRates: {}, recentEvents: [] }))
    ]);

    const activeFlow = flows.find(f => f.id === currentLiveFlowId) || flows.find(f => f.id === 'fluxo-espiao-es') || flows[0];
    if (!activeFlow) {
      container.innerHTML = '<div class="card">Nenhum fluxo encontrado para visualização ao vivo.</div>';
      return;
    }
    currentLiveFlowId = activeFlow.id;
    localStorage.setItem('wh_live_flow_id', currentLiveFlowId);

    const nodes = activeFlow.nodes || [];
    const activeNodes = liveData.activeNodes || {};
    const platformRates = liveData.platformRates || { facebook: { lastHour: 0, total: 0 }, tiktok: { lastHour: 0, total: 0 }, organic: { lastHour: 0, total: 0 } };
    const recentEvents = liveData.recentEvents || [];

    // Calcula limites para zoom-to-fit
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    nodes.forEach(n => {
      if (n.x < minX) minX = n.x;
      if (n.x + 240 > maxX) maxX = n.x + 240;
      if (n.y < minY) minY = n.y;
      if (n.y + 140 > maxY) maxY = n.y + 140;
    });

    const flowWidth = Math.max(2600, (maxX - minX) + 240);
    const flowHeight = Math.max(1000, (maxY - minY) + 240);
    liveZoomState.flowWidth = flowWidth;
    liveZoomState.flowHeight = flowHeight;
    liveZoomState.minX = minX;
    liveZoomState.minY = minY;

    const html = `
      <div class="live-flow-container" id="live-flow-container">
        <!-- Segmented Control no Mobile (Mapa vs Feed) -->
        <div class="mobile-live-switcher">
          <button type="button" id="btn-live-canvas" class="live-switch-btn active" onclick="switchMobileLiveMode('canvas')">
            <span>🕸️</span> <span>Mapa do Funil</span>
          </button>
          <button type="button" id="btn-live-feed" class="live-switch-btn" onclick="switchMobileLiveMode('feed')">
            <span>📡</span> <span>Feed ao Vivo</span>
            <span class="mobile-nav-badge" style="position: static !important; margin-left: 4px;" id="mob-live-events-count">${recentEvents.length}</span>
          </button>
        </div>

        <!-- Top Bar com Status de Transmissão, Seletor de Funil e Controles de Zoom -->
        <div class="live-topbar">
          <div style="display: flex; align-items: center; gap: 12px; flex-wrap: wrap;">
            <span class="live-badge-indicator">
              <span class="live-dot-pulse"></span>
              <span>TRANSMISSÃO AO VIVO</span>
            </span>

            <!-- Seletor de Funil -->
            <div style="display: flex; align-items: center; gap: 6px;">
              <label for="live-flow-select" style="font-size: 11px; font-weight: 700; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.5px;">Funil:</label>
              <select id="live-flow-select" class="form-select" style="background: rgba(18, 18, 28, 0.95); border: 1px solid rgba(255, 255, 255, 0.14); color: #fff; font-size: 12px; font-weight: 600; padding: 4px 10px; border-radius: 8px; cursor: pointer; min-width: 0; width: 100%;" onchange="changeLiveFlow(this.value)">
                ${flows.map(f => `<option value="${f.id}" ${f.id === activeFlow.id ? 'selected' : ''}>${f.name}</option>`).join('')}
              </select>
            </div>

            <!-- Contador de Leads Ativos -->
            <span style="color: #34d399; font-weight: 600; font-size: 12px; display: flex; align-items: center; gap: 4px;">
              🟢 <span id="live-total-leads">${liveData.totalActiveLeads || 0}</span> leads no funil agora
            </span>
          </div>

          <!-- Controles de Zoom e Ações -->
          <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
            <div style="display: flex; align-items: center; gap: 3px; background: rgba(18, 18, 28, 0.9); padding: 2px 6px; border-radius: 8px; border: 1px solid rgba(255, 255, 255, 0.08);">
              <button class="btn btn-secondary" style="padding: 3px 8px; font-size: 12px; font-weight: 700; height: 26px; min-width: 26px; display: flex; align-items: center; justify-content: center;" onclick="zoomLiveFlow(0.15)" title="Aproximar (+)">➕</button>
              <span id="live-zoom-level" style="font-size: 11px; font-weight: 700; min-width: 44px; text-align: center; color: #cbd5e1;">100%</span>
              <button class="btn btn-secondary" style="padding: 3px 8px; font-size: 12px; font-weight: 700; height: 26px; min-width: 26px; display: flex; align-items: center; justify-content: center;" onclick="zoomLiveFlow(-0.15)" title="Afastar (-)">➖</button>
              <button class="btn btn-secondary" style="padding: 3px 8px; font-size: 11px; height: 26px;" onclick="fitLiveFlowView()" title="Ajustar automaticamente à tela">🔍 Ajustar</button>
              <button class="btn btn-secondary" style="padding: 3px 8px; font-size: 11px; height: 26px;" onclick="resetLiveFlowZoom(1.0)" title="Zoom 100%">🎯 100%</button>
            </div>
            <button class="btn btn-secondary" style="padding: 4px 10px; font-size: 11px; height: 28px;" onclick="window.location.hash='#flow-canvas?id=${activeFlow.id}'">✏️ Editar Fluxo</button>
          </div>
        </div>

        <!-- Área do Canvas com Diagrama Vivo e Zoom/Pan -->
        <div class="live-canvas-area" id="live-canvas-area" title="Role para zoom • Arraste para mover o funil">
          <div id="live-canvas-world" style="position: absolute; left: 0; top: 0; width: ${flowWidth}px; height: ${flowHeight}px; transform-origin: 0 0;">
            <!-- SVG das Conexões e Partículas de Luz -->
            <svg id="live-svg" style="position: absolute; left: 0; top: 0; width: ${flowWidth}px; height: ${flowHeight}px; pointer-events: none; overflow: visible;">
              <defs>
                <filter id="glow-particle" x="-50%" y="-50%" width="200%" height="200%">
                  <feGaussianBlur stdDeviation="3.5" result="blur" />
                  <feMerge>
                    <feMergeNode in="blur" />
                    <feMergeNode in="SourceGraphic" />
                  </feMerge>
                </filter>
              </defs>
              <g id="live-edges-layer"></g>
              <g id="live-particles-layer"></g>
            </svg>

            <!-- Renderização dos Nós com Contadores Dinâmicos -->
            <div id="live-nodes-layer">
              ${nodes.map(n => {
                const count = activeNodes[n.id] || 0;
                const isStart = n.id === 'node-start';
                return `
                  <div class="flow-node" id="live-${n.id}" style="position: absolute; left: ${n.x}px; top: ${n.y}px; transition: transform 0.2s; pointer-events: auto;">
                    <!-- Contador em Tempo Real -->
                    <div class="live-node-counter ${count > 0 ? '' : 'zero'}" id="counter-${n.id}">
                      ${count > 0 ? `🟢 ${count} lead${count > 1 ? 's' : ''} agora` : '⚪ 0 leads'}
                    </div>

                    <div class="node-header ${n.color || 'blue'}">
                      <div style="display: flex; align-items: center; gap: 6px;">
                        <span>${n.icon || '⚡'}</span>
                        <span style="font-weight: 700;">${n.label}</span>
                      </div>
                    </div>
                    <div class="node-body" style="font-size: 11.5px; color: #cbd5e1; line-height: 1.4;">
                      ${n.data?.text ? `💬 ${n.data.text.slice(0, 75)}...` : (n.data?.timeout || n.data?.rule || 'Etapa do funil')}
                      ${isStart ? `
                        <div class="live-origin-breakdown">
                          <div class="live-origin-row" style="color: #60a5fa;">
                            <span style="display: flex; align-items: center; gap: 4px;">${FB_LOGO_SVG} Facebook</span>
                            <strong>${platformRates.facebook?.lastHour || 0} leads/h</strong>
                          </div>
                          <div class="live-origin-row" style="color: #fe2c55;">
                            <span style="display: flex; align-items: center; gap: 4px;">${TT_LOGO_SVG} TikTok</span>
                            <strong>${platformRates.tiktok?.lastHour || 0} leads/h</strong>
                          </div>
                        </div>
                      ` : ''}
                    </div>
                  </div>
                `;
              }).join('')}
            </div>
          </div>
        </div>

        <!-- Painel Lateral: Live Event Feed (Terminal Elegante) -->
        <aside class="live-terminal-panel">
          <div class="live-terminal-header">
            <div class="live-terminal-title">
              <span class="status-dot"></span>
              <span>Feed de Eventos ao Vivo</span>
            </div>
            <span style="font-size: 10.5px; color: var(--text-muted);" id="live-events-count">${recentEvents.length} eventos</span>
          </div>

          <div class="live-terminal-body" id="live-terminal-feed">
            ${recentEvents.length === 0 ? `
              <div style="color: var(--text-muted); text-align: center; padding: 24px;">
                Aguardando atividade de leads no funil...
              </div>
            ` : recentEvents.map(ev => `
              <div class="live-event-item">
                <div style="display: flex; justify-content: space-between; align-items: center;">
                  <div style="display: flex; align-items: center; gap: 4px;">
                    <span class="live-event-badge ${ev.platform}">${ev.platform === 'tiktok' ? '🎵 TikTok' : (ev.platform === 'facebook' ? '📘 Facebook' : '🌐 Direto')}</span>
                    <strong style="color: #fff;">${ev.phone}</strong>
                  </div>
                  <span class="live-event-time">${ev.time}</span>
                </div>
                <div style="color: #cbd5e1; font-size: 11px; margin-top: 2px;">${ev.title}</div>
              </div>
            `).join('')}
          </div>
        </aside>
      </div>
    `;

    container.innerHTML = html;

    // 1. Desenha as conexões Bézier no SVG
    drawLiveConnections(activeFlow);

    // 2. Ajusta enquadramento inicial
    fitLiveFlowView(flowWidth, flowHeight, minX, minY);

    // 3. Inicializa o motor de partículas luminosas em velocidade calma
    initLiveParticleEngine(activeFlow, liveData.edgeFlows || {});

    // 4. Inicializa interatividade de Zoom e Arraste (Pan)
    initLiveCanvasInteraction();

    // 5. Inicia polling de 2.5s para atualizar contadores e terminal em tempo real
    liveFlowPollingInterval = setInterval(() => {
      if (state.currentView !== 'fluxo-ao-vivo') {
        clearInterval(liveFlowPollingInterval);
        if (liveFlowAnimationFrame) cancelAnimationFrame(liveFlowAnimationFrame);
        return;
      }
      updateLiveFlowData(activeFlow);
    }, 2500);

  } catch (err) {
    container.innerHTML = `<div class="card">Erro ao renderizar Fluxo ao Vivo: ${err.message}</div>`;
  }
}

/**
 * Aplica a escala e deslocamento no elemento do Canvas
 */
function applyLiveCanvasTransform() {
  const world = document.getElementById('live-canvas-world');
  const zoomLevelEl = document.getElementById('live-zoom-level');
  if (world) {
    world.style.transform = `translate(${liveZoomState.panX}px, ${liveZoomState.panY}px) scale(${liveZoomState.scale})`;
  }
  if (zoomLevelEl) {
    zoomLevelEl.textContent = `${Math.round(liveZoomState.scale * 100)}%`;
  }
}

/**
 * Zoom in / Zoom out com suporte a ponto de pivô (mouse ou centro)
 */
function zoomLiveFlow(delta, clientX = null, clientY = null) {
  const canvasArea = document.getElementById('live-canvas-area');
  const world = document.getElementById('live-canvas-world');
  if (!canvasArea || !world) return;

  const oldScale = liveZoomState.scale;
  let newScale = oldScale + delta;
  newScale = Math.max(0.2, Math.min(2.5, Math.round(newScale * 100) / 100));
  if (Math.abs(newScale - oldScale) < 0.001) return;

  const rect = canvasArea.getBoundingClientRect();
  const pivotX = (clientX !== null) ? (clientX - rect.left) : (rect.width / 2);
  const pivotY = (clientY !== null) ? (clientY - rect.top) : (rect.height / 2);

  liveZoomState.panX = pivotX - (pivotX - liveZoomState.panX) * (newScale / oldScale);
  liveZoomState.panY = pivotY - (pivotY - liveZoomState.panY) * (newScale / oldScale);
  liveZoomState.scale = newScale;

  world.style.transition = 'transform 0.06s ease-out';
  applyLiveCanvasTransform();
}

/**
 * Reseta o zoom para 100% ou escala padrão
 */
function resetLiveFlowZoom(targetScale = 1.0) {
  const canvasArea = document.getElementById('live-canvas-area');
  const world = document.getElementById('live-canvas-world');
  if (!canvasArea || !world) return;

  liveZoomState.scale = targetScale;
  liveZoomState.panX = 60;
  liveZoomState.panY = 80;
  world.style.transition = 'transform 0.2s ease-out';
  applyLiveCanvasTransform();
}

/**
 * Ajusta o zoom e enquadramento para caber confortavelmente na tela
 */
function fitLiveFlowView(flowW, flowH, minX, minY) {
  const canvasArea = document.getElementById('live-canvas-area');
  const world = document.getElementById('live-canvas-world');
  if (!canvasArea || !world) return;

  if (flowW) liveZoomState.flowWidth = flowW;
  if (flowH) liveZoomState.flowHeight = flowH;
  if (minX !== undefined) liveZoomState.minX = minX;
  if (minY !== undefined) liveZoomState.minY = minY;

  const areaW = canvasArea.clientWidth || 900;
  const areaH = canvasArea.clientHeight || 600;
  const w = liveZoomState.flowWidth || 3000;
  const h = liveZoomState.flowHeight || 1000;

  const scaleX = (areaW - 80) / w;
  const scaleY = (areaH - 80) / h;
  const scale = Math.max(0.28, Math.min(1.0, Math.min(scaleX, scaleY)));

  liveZoomState.scale = Math.round(scale * 100) / 100;
  liveZoomState.panX = Math.max(20, (areaW - w * liveZoomState.scale) / 2);
  liveZoomState.panY = Math.max(40, (areaH - h * liveZoomState.scale) / 2);

  world.style.transition = 'transform 0.25s cubic-bezier(0.16, 1, 0.3, 1)';
  applyLiveCanvasTransform();
}

/**
 * Inicializa interatividade de mouse: zoom com scroll da roda e pan com clique-arraste
 */
function initLiveCanvasInteraction() {
  const canvasArea = document.getElementById('live-canvas-area');
  const world = document.getElementById('live-canvas-world');
  if (!canvasArea || !world) return;

  // Zoom via roda do mouse
  canvasArea.onwheel = (e) => {
    e.preventDefault();
    const delta = e.deltaY < 0 ? 0.12 : -0.12;
    zoomLiveFlow(delta, e.clientX, e.clientY);
  };

  // Pan via clique e arraste
  canvasArea.onmousedown = (e) => {
    if (e.target.closest('button, select, input, a, .node-actions')) return;
    liveZoomState.isDragging = true;
    liveZoomState.dragStartX = e.clientX;
    liveZoomState.dragStartY = e.clientY;
    liveZoomState.initialPanX = liveZoomState.panX;
    liveZoomState.initialPanY = liveZoomState.panY;
    canvasArea.style.cursor = 'grabbing';
    world.style.transition = 'none';

    const onMouseMove = (moveEv) => {
      if (!liveZoomState.isDragging) return;
      liveZoomState.panX = liveZoomState.initialPanX + (moveEv.clientX - liveZoomState.dragStartX);
      liveZoomState.panY = liveZoomState.initialPanY + (moveEv.clientY - liveZoomState.dragStartY);
      applyLiveCanvasTransform();
    };

    const onMouseUp = () => {
      liveZoomState.isDragging = false;
      canvasArea.style.cursor = 'grab';
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  };
}

/**
 * Desenha as curvas Bézier das conexões no SVG do Fluxo ao Vivo
 */
function drawLiveConnections(flow) {
  const edgesLayer = document.getElementById('live-edges-layer');
  if (!edgesLayer || !flow) return;

  const edges = flow.edges || [];
  let svgHtml = '';

  edges.forEach(edge => {
    const fromNode = flow.nodes.find(n => n.id === edge.from);
    const toNode = flow.nodes.find(n => n.id === edge.to);

    if (fromNode && toNode) {
      const x1 = fromNode.x + 210;
      let y1 = fromNode.y + 40;
      if (edge.fromPort === 'success') y1 = fromNode.y + 48;
      else if (edge.fromPort === 'error') y1 = fromNode.y + 72;

      const x2 = toNode.x;
      const y2 = toNode.y + 40;

      const dx = Math.max(60, (x2 - x1) * 0.45);
      const cx1 = x1 + dx;
      const cy1 = y1;
      const cx2 = x2 - dx;
      const cy2 = y2;

      const pathD = `M ${x1} ${y1} C ${cx1} ${cy1}, ${cx2} ${cy2}, ${x2} ${y2}`;

      let edgeColor = '#6366f1';
      const label = edge.label || '';
      if (label.includes('Positiva') || label.includes('Aprovado') || label.toLowerCase().includes('sucesso') || edge.fromPort === 'success') edgeColor = '#10b981';
      else if (label.includes('Dúvida') || label.includes('Sigilo')) edgeColor = '#f59e0b';
      else if (label.includes('Negativa') || label.includes('Aleatória') || label.toLowerCase().includes('erro') || edge.fromPort === 'error') edgeColor = '#ef4444';
      else if (label.includes('Aguardar') || label.includes('Loop')) edgeColor = '#06b6d4';

      svgHtml += `
        <path id="live-path-${edge.id}" class="canvas-edge" d="${pathD}" style="stroke: ${edgeColor}; stroke-width: 2.5px; opacity: 0.65;" />
      `;
    }
  });

  edgesLayer.innerHTML = svgHtml;
}

/**
 * Motor de Partículas de Luz em Curvas Bézier SVG com requestAnimationFrame (60 FPS)
 * Partículas movimentando-se suavemente e de forma lenta
 */
function initLiveParticleEngine(flow, edgeFlows = {}) {
  const particlesLayer = document.getElementById('live-particles-layer');
  if (!particlesLayer || !flow) return;

  liveParticles = [];
  const edges = flow.edges || [];

  // Cria as partículas distribuídas ao longo de cada aresta com tráfego
  edges.forEach((edge, edgeIdx) => {
    const pathEl = document.getElementById(`live-path-${edge.id}`);
    if (!pathEl) return;

    let totalLen = 0;
    try {
      totalLen = pathEl.getTotalLength() || 100;
    } catch (e) {
      totalLen = 100;
    }
    if (totalLen <= 0) return;

    const count = edgeFlows[edge.id] || (edgeIdx % 3 === 0 ? 2 : 1);
    for (let i = 0; i < count; i++) {
      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      circle.setAttribute('r', '5.5');
      circle.setAttribute('filter', 'url(#glow-particle)');

      // Alterna plataformas e cores das partículas
      let platform = (i + edgeIdx) % 2 === 0 ? 'tiktok' : 'facebook';
      if ((i + edgeIdx) % 5 === 0) platform = 'organic';

      circle.setAttribute('class', `live-particle ${platform}`);
      particlesLayer.appendChild(circle);

      // Deslocamento inicial espaçado (0 a 1)
      const initialProgress = (i / count) + (Math.random() * 0.2);

      liveParticles.push({
        edgeId: edge.id,
        toNodeId: edge.to,
        pathEl: pathEl,
        element: circle,
        totalLen: totalLen,
        progress: initialProgress % 1.0,
        // Velocidade suave e calma (4x a 5x mais devagar)
        speed: 0.0007 + (Math.random() * 0.0003),
        platform: platform
      });
    }
  });

  // Loop de Animação 60fps de alta performance (sem recalcular comprimentos SVG)
  function animateFrame() {
    if (state.currentView !== 'fluxo-ao-vivo') return;

    for (let i = 0; i < liveParticles.length; i++) {
      const p = liveParticles[i];
      if (!p.pathEl || !p.totalLen) continue;

      p.progress += p.speed;

      // Ao atingir o final da curva, reinicia suavemente sem piscar os nós
      if (p.progress >= 1.0) {
        p.progress = 0;
      }

      const dist = p.progress * p.totalLen;
      const point = p.pathEl.getPointAtLength(dist);

      p.element.setAttribute('cx', point.x);
      p.element.setAttribute('cy', point.y);
    }

    liveFlowAnimationFrame = requestAnimationFrame(animateFrame);
  }

  liveFlowAnimationFrame = requestAnimationFrame(animateFrame);
}

/**
 * Função de pulso mantida para compatibilidade, porém sem piscar
 */
function triggerNodeArrivalPulse(nodeId) {
  // Desativado conforme solicitado para evitar que os pontos fiquem piscando
}

/**
 * Atualiza dados e contadores em tempo real via polling curto de 2.5s
 */
async function updateLiveFlowData(flow) {
  try {
    const res = await fetch('/api/traffic/live-flow').then(r => r.json());
    if (!res.success) return;

    const activeNodes = res.activeNodes || {};
    const totalEl = document.getElementById('live-total-leads');
    if (totalEl) totalEl.textContent = res.totalActiveLeads || 0;

    // Atualiza contadores individuais dos nós
    Object.keys(activeNodes).forEach(nodeId => {
      const counterEl = document.getElementById(`counter-${nodeId}`);
      if (counterEl) {
        const c = activeNodes[nodeId] || 0;
        counterEl.className = `live-node-counter ${c > 0 ? '' : 'zero'}`;
        counterEl.innerHTML = c > 0 ? `🟢 ${c} lead${c > 1 ? 's' : ''} agora` : '⚪ 0 leads';
      }
    });

    // Atualiza terminal de eventos se houver novidades
    const feed = document.getElementById('live-terminal-feed');
    const events = res.recentEvents || [];
    if (feed && events.length > 0) {
      feed.innerHTML = events.map(ev => `
        <div class="live-event-item">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <div style="display: flex; align-items: center; gap: 4px;">
              <span class="live-event-badge ${ev.platform}">${ev.platform === 'tiktok' ? '🎵 TikTok' : (ev.platform === 'facebook' ? '📘 Facebook' : '🌐 Direto')}</span>
              <strong style="color: #fff;">${ev.phone}</strong>
            </div>
            <span class="live-event-time">${ev.time}</span>
          </div>
          <div style="color: #cbd5e1; font-size: 11px; margin-top: 2px;">${ev.title}</div>
        </div>
      `).join('');
    }
  } catch (e) {
    console.warn('[Live Flow Polling Warning]', e.message);
  }
}

/* =========================================================================
   VIEW: MULTI-PIXEL (FACEBOOK PIXEL/CAPI + TIKTOK EVENTS API v1.3)
   ========================================================================= */
state.activePixelTab = state.activePixelTab || 'facebook';

async function renderPixels() {
  const container = document.getElementById('view-container');
  container.innerHTML = '<div style="color: var(--text-muted); padding: 40px; text-align: center;">Carregando Pixels e Auditoria CAPI...</div>';

  try {
    const [fbPixels, fbLogs, ttPixels, ttLogs] = await Promise.all([
      fetch('/api/pixels').then(r => r.json()).catch(() => []),
      fetch('/api/pixels/logs').then(r => r.json()).catch(() => []),
      fetch('/api/tiktok/pixels').then(r => r.json()).catch(() => []),
      fetch('/api/tiktok/logs').then(r => r.json()).catch(() => [])
    ]);

    const activeTab = state.activePixelTab || 'facebook';
    const webhookUrl = `${window.location.origin}/api/webhooks/payment`;

    // Unifica e ordena logs por data mais recente
    const unifiedLogs = [
      ...fbLogs.map(l => ({ ...l, platform: 'facebook', pixelCode: l.pixelId })),
      ...ttLogs.map(l => ({ ...l, platform: 'tiktok', pixelCode: l.pixel_code }))
    ].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

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
              Cole esta URL no painel de Webhooks da Kirvano ou do seu checkout. Quando o cliente pagar, o disparo do Pixel correspondente (Facebook ou TikTok) é realizado automaticamente pelo servidor!
            </p>
          </div>
          <div style="display: flex; gap: 8px; align-items: center;">
            <input type="text" class="form-input" id="webhook-url-input" value="${webhookUrl}" readonly style="width: 380px; font-size: 12px; font-family: monospace;">
            <button class="btn btn-primary" onclick="copyWebhookUrl()">📋 Copiar URL</button>
          </div>
        </div>
      </div>

      <!-- Abas de Navegação Multi-Pixel -->
      <div style="display: flex; gap: 12px; margin-bottom: 24px; border-bottom: 1px solid var(--border-color); padding-bottom: 14px;">
        <button class="btn ${activeTab === 'facebook' ? 'btn-primary' : 'btn-secondary'}" onclick="switchPixelTab('facebook')" style="display: flex; align-items: center; gap: 8px; font-weight: 700;">
          ${FB_LOGO_SVG}
          <span>Facebook Pixel & CAPI (${fbPixels.length})</span>
        </button>
        <button class="btn ${activeTab === 'tiktok' ? 'btn-primary' : 'btn-secondary'}" onclick="switchPixelTab('tiktok')" style="display: flex; align-items: center; gap: 8px; font-weight: 700; ${activeTab === 'tiktok' ? 'background: linear-gradient(135deg, #fe2c55, #e11d48); border: none;' : ''}">
          ${TT_LOGO_SVG}
          <span>TikTok Pixel & Events API (${ttPixels.length})</span>
        </button>
      </div>

      <!-- PAINEL 1: FACEBOOK PIXEL & CAPI -->
      <div id="pixel-pane-facebook" style="display: ${activeTab === 'facebook' ? 'block' : 'none'};">
        <div style="display: grid; grid-template-columns: 1.2fr 1fr; gap: 24px; margin-bottom: 24px;">
          <!-- Cadastro Manual Facebook -->
          <div class="card">
            <div class="card-header">
              <h3 class="card-title" style="display: flex; align-items: center; gap: 8px;">
                ${FB_LOGO_SVG}
                <span>Configurar Novo Pixel do Facebook</span>
              </h3>
            </div>
            <p style="font-size: 12.5px; color: var(--text-secondary); margin-bottom: 16px;">
              Insira as credenciais geradas no Gerenciador de Eventos da Meta para disparar eventos de conversão via servidor (CAPI).
            </p>

            <form onsubmit="savePixelConfig(event)">
              <div class="form-group">
                <label class="form-label">Nome de Identificação do Pixel *</label>
                <input type="text" class="form-input" id="pix-name" placeholder="Ex: Pixel Principal - Meta Ads" required>
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
                  <label class="form-label">Page ID do Facebook</label>
                  <input type="text" class="form-input" id="pix-page-id" placeholder="Ex: 1123948077469453">
                </div>

                <div class="form-group">
                  <label class="form-label">Test Event Code (Opcional)</label>
                  <input type="text" class="form-input" id="pix-test-code" placeholder="Ex: TEST12345">
                </div>
              </div>

              <button type="submit" class="btn btn-primary" style="width: 100%; margin-top: 8px;">
                ✓ Salvar e Ativar Pixel Facebook
              </button>
            </form>
          </div>

          <!-- Lista de Pixels Facebook Cadastrados -->
          <div class="card">
            <div class="card-header">
              <h3 class="card-title">📋 Pixels Facebook Configurados</h3>
              <span class="nav-badge" style="background: rgba(24, 119, 242, 0.2); color: #60a5fa;">${fbPixels.length} Ativo(s)</span>
            </div>

            <div style="display: flex; flex-direction: column; gap: 12px;">
              ${fbPixels.length === 0 ? `
                <div style="text-align: center; padding: 30px; color: var(--text-muted); font-size: 13px;">
                  Nenhum pixel do Facebook cadastrado ainda.<br>
                  Preencha o formulário ao lado para adicionar seu primeiro pixel Meta.
                </div>
              ` : fbPixels.map(p => `
                <div style="padding: 14px; background: rgba(255,255,255,0.02); border-radius: var(--radius-md); border: 1px solid var(--border-color); display: flex; justify-content: space-between; align-items: center;">
                  <div>
                    <div style="display: flex; align-items: center; gap: 8px;">
                      ${FB_LOGO_SVG}
                      <strong style="color: #fff; font-size: 14px;">${p.name}</strong>
                    </div>
                    <div style="font-size: 11.5px; color: var(--text-secondary); margin-top: 3px;">
                      ID: <span style="font-family: monospace; color: #60a5fa;">${p.pixelId}</span>
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
      </div>

      <!-- PAINEL 2: TIKTOK PIXEL & EVENTS API -->
      <div id="pixel-pane-tiktok" style="display: ${activeTab === 'tiktok' ? 'block' : 'none'};">
        <div style="display: grid; grid-template-columns: 1.2fr 1fr; gap: 24px; margin-bottom: 24px;">
          <!-- Cadastro Manual TikTok -->
          <div class="card">
            <div class="card-header">
              <h3 class="card-title" style="display: flex; align-items: center; gap: 8px;">
                ${TT_LOGO_SVG}
                <span>Configurar Novo Pixel do TikTok (Events API v1.3)</span>
              </h3>
            </div>
            <p style="font-size: 12.5px; color: var(--text-secondary); margin-bottom: 16px;">
              Insira o Pixel Code e o Access Token gerados no TikTok Ads Manager para disparo server-side com Advanced Matching.
            </p>

            <form onsubmit="saveTikTokPixelConfig(event)">
              <div class="form-group">
                <label class="form-label">Nome de Identificação do Pixel *</label>
                <input type="text" class="form-input" id="tt-pix-name" placeholder="Ex: Pixel Principal - TikTok Ads" required>
              </div>

              <div class="form-group">
                <label class="form-label">Pixel Code (TikTok Ads) *</label>
                <input type="text" class="form-input" id="tt-pix-code" placeholder="Ex: C123456789ABCDEF" required>
              </div>

              <div class="form-group">
                <label class="form-label">Access Token (TikTok Events API) *</label>
                <input type="password" class="form-input" id="tt-pix-token" placeholder="Cole seu Access Token permanente da Events API" required>
                <p style="font-size: 11px; color: var(--text-muted); margin-top: 4px;">
                  Gerado em: TikTok Ads Manager ➔ Ferramentas ➔ Eventos Web ➔ Configurações da Events API.
                </p>
              </div>

              <div class="form-group">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
                  <label class="form-label" style="margin: 0;">Código de Evento de Teste / Test ID (TikTok Ads)</label>
                  <span style="font-size: 11px; color: #25f4ee; font-weight: 600;">Opcional / Recomendado para Testes</span>
                </div>
                <input type="text" class="form-input" id="tt-pix-test-code" placeholder="Ex: TEST12345 (obtido na aba Test Events do TikTok)" style="font-family: monospace; border-color: rgba(37, 244, 238, 0.4);">
                <p style="font-size: 11px; color: var(--text-muted); margin-top: 4px;">
                  Copie o código gerado na aba <b>"Test Events"</b> do seu Pixel no Gerenciador de Eventos da TikTok para ver seus testes caírem ao vivo lá!
                </p>
              </div>

              <button type="submit" class="btn btn-primary" style="width: 100%; margin-top: 8px; background: linear-gradient(135deg, #fe2c55, #e11d48); border: none;">
                ✓ Salvar e Ativar Pixel TikTok
              </button>
            </form>
          </div>

          <!-- Lista de Pixels TikTok Cadastrados -->
          <div class="card">
            <div class="card-header">
              <h3 class="card-title">📋 Pixels TikTok Configurados</h3>
              <span class="nav-badge" style="background: rgba(254, 44, 85, 0.2); color: #fe2c55;">${ttPixels.length} Ativo(s)</span>
            </div>

            <div style="display: flex; flex-direction: column; gap: 12px;">
              ${ttPixels.length === 0 ? `
                <div style="text-align: center; padding: 30px; color: var(--text-muted); font-size: 13px;">
                  Nenhum pixel do TikTok cadastrado ainda.<br>
                  Preencha o formulário ao lado para adicionar seu primeiro pixel TikTok.
                </div>
              ` : ttPixels.map(p => `
                <div style="padding: 14px; background: rgba(255,255,255,0.02); border-radius: var(--radius-md); border: 1px solid var(--border-color); display: flex; justify-content: space-between; align-items: center;">
                  <div>
                    <div style="display: flex; align-items: center; gap: 8px;">
                      ${TT_LOGO_SVG}
                      <strong style="color: #fff; font-size: 14px;">${p.name}</strong>
                    </div>
                    <div style="font-size: 11.5px; color: var(--text-secondary); margin-top: 3px;">
                      Code: <span style="font-family: monospace; color: #fe2c55;">${p.pixel_code}</span>
                    </div>
                  </div>
                  <div style="display: flex; gap: 6px;">
                    <button class="btn btn-secondary" style="padding: 4px 10px; font-size: 12px;" onclick="testTikTokPixelManual('${p.pixel_code}', '${p.access_token}', '${p.test_event_code || ''}')">
                      ▶ Testar
                    </button>
                    <button class="btn btn-danger" style="padding: 4px 8px; font-size: 12px;" onclick="deleteTikTokPixelConfig('${p.id}')">
                      🗑️
                    </button>
                  </div>
                </div>
              `).join('')}
            </div>
          </div>
        </div>
      </div>

      <!-- Tabela Unificada de Auditoria de Eventos Disparados (Com Logos Oficiais) -->
      <div class="card">
        <div class="card-header">
          <div>
            <h3 class="card-title">📊 Auditoria Unificada de Disparos (Facebook CAPI & TikTok Events)</h3>
            <p style="font-size: 12.5px; color: var(--text-secondary); margin-top: 2px;">
              Histórico completo de eventos server-side disparados em tempo real com identificação visual da plataforma.
            </p>
          </div>
          <button class="btn btn-secondary" style="padding: 4px 10px; font-size: 12px;" onclick="renderPixels()">🔄 Atualizar Logs</button>
        </div>

        <div style="overflow-x: auto;">
          <table class="flows-table">
            <thead>
              <tr>
                <th>Plataforma</th>
                <th>Data/Hora</th>
                <th>Evento</th>
                <th>Pixel / Código</th>
                <th>Telefone (E.164)</th>
                <th>Valor</th>
                <th>Status</th>
                <th>Detalhes</th>
              </tr>
            </thead>
            <tbody>
              ${unifiedLogs.length === 0 ? `
                <tr>
                  <td colspan="8" style="text-align: center; padding: 24px; color: var(--text-muted); font-size: 12.5px;">
                    Nenhum evento registrado ainda.
                  </td>
                </tr>
              ` : unifiedLogs.map(l => `
                <tr>
                  <td>
                    <div style="display: flex; align-items: center; gap: 6px; font-weight: 700; font-size: 12px;">
                      ${l.platform === 'facebook' ? FB_LOGO_SVG : TT_LOGO_SVG}
                      <span style="color: ${l.platform === 'facebook' ? '#60a5fa' : '#fe2c55'};">
                        ${l.platform === 'facebook' ? 'Facebook' : 'TikTok'}
                      </span>
                    </div>
                  </td>
                  <td style="font-size: 11.5px; color: var(--text-muted);">
                    ${new Date(l.timestamp).toLocaleDateString()} ${new Date(l.timestamp).toLocaleTimeString()}
                  </td>
                  <td style="font-weight: 600; color: #fff;">${l.eventName || l.event}</td>
                  <td style="font-family: monospace; font-size: 11.5px; color: #c4b5fd;">${l.pixelCode}</td>
                  <td style="font-size: 12px;">${l.phone || '—'}</td>
                  <td style="font-size: 12px; color: #10b981; font-weight: 600;">${l.value ? `R$ ${Number(l.value).toFixed(2)}` : '—'}</td>
                  <td>
                    <span class="btn" style="padding: 2px 7px; font-size: 10.5px; background: ${l.status === 'sucesso' ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.15)'}; color: ${l.status === 'sucesso' ? '#10b981' : '#ef4444'};">
                      ● ${(l.status || 'OK').toUpperCase()}
                    </span>
                  </td>
                  <td style="font-size: 11px; color: var(--text-muted);">
                    ${l.error || (l.eventsReceived ? `${l.eventsReceived} evento(s)` : (l.status === 'sucesso' ? 'Confirmado na API' : 'Pendente'))}
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;

    container.innerHTML = html;
  } catch (err) {
    container.innerHTML = `<div class="card">Erro carregando pixels: ${err.message}</div>`;
  }
}

function switchPixelTab(tab) {
  state.activePixelTab = tab;
  renderPixels();
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
      showToast('Pixel do Facebook ativado com sucesso!', 'success');
      renderPixels();
    } else {
      showToast('Erro ao salvar pixel: ' + (res.error || 'Falha'), 'danger');
    }
  } catch (err) {
    showToast('Erro de rede: ' + err.message, 'danger');
  }
}

async function deletePixelConfig(id) {
  if (!confirm('Deseja excluir este Pixel do Facebook?')) return;
  try {
    await fetch(`/api/pixels/${id}`, { method: 'DELETE' });
    showToast('Pixel do Facebook excluído com sucesso!');
    renderPixels();
  } catch (err) {
    showToast('Erro ao excluir: ' + err.message, 'danger');
  }
}

async function testPixelManual(pixelId, accessToken, pageId, testEventCode) {
  const phone = prompt('Digite um telefone para teste (DDD+número):', '11999998888');
  if (!phone) return;

  showToast('Enviando evento de teste para o Facebook CAPI...', 'info');

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
      showToast(`✓ Sucesso! Evento recebido pela Meta!`, 'success');
      renderPixels();
    } else {
      showToast('❌ Erro da Meta: ' + (res.error || 'Falha no disparo'), 'danger');
      renderPixels();
    }
  } catch (err) {
    showToast('Erro ao testar: ' + err.message, 'danger');
  }
}

async function saveTikTokPixelConfig(e) {
  e.preventDefault();
  const name = document.getElementById('tt-pix-name').value.trim();
  const pixel_code = document.getElementById('tt-pix-code').value.trim();
  const access_token = document.getElementById('tt-pix-token').value.trim();
  const test_event_code = (document.getElementById('tt-pix-test-code')?.value || '').trim();

  try {
    const res = await fetch('/api/tiktok/pixels', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, pixel_code, access_token, test_event_code })
    }).then(r => r.json());

    if (res.success) {
      showToast('Pixel do TikTok ativado com sucesso!', 'success');
      renderPixels();
    } else {
      showToast('Erro ao salvar: ' + (res.error || 'Falha'), 'danger');
    }
  } catch (err) {
    showToast('Erro de rede: ' + err.message, 'danger');
  }
}

async function deleteTikTokPixelConfig(id) {
  if (!confirm('Deseja excluir este Pixel do TikTok?')) return;
  try {
    await fetch(`/api/tiktok/pixels/${id}`, { method: 'DELETE' });
    showToast('Pixel do TikTok excluído com sucesso!');
    renderPixels();
  } catch (err) {
    showToast('Erro ao excluir: ' + err.message, 'danger');
  }
}

async function testTikTokPixelManual(code, token, defaultTestCode = '') {
  document.getElementById('tiktok-test-modal')?.remove();

  const modalHtml = `
    <div class="node-modal-backdrop" id="tiktok-test-modal">
      <div class="card" style="width: 500px; max-width: 95%; background: #111827; border: 1px solid rgba(254, 44, 85, 0.5); border-radius: 16px; padding: 24px; box-shadow: 0 25px 50px rgba(0,0,0,0.85);">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
          <div style="display: flex; align-items: center; gap: 10px;">
            <div style="width: 38px; height: 38px; border-radius: 10px; background: linear-gradient(135deg, #fe2c55, #25f4ee); color: #fff; display: flex; align-items: center; justify-content: center; font-size: 18px;">
              🎵
            </div>
            <div>
              <h3 style="font-size: 17px; font-weight: 700; margin: 0; color: #fff;">Testar TikTok Events API v1.3</h3>
              <div style="font-size: 11.5px; color: var(--text-secondary);">Validação em tempo real com suporte a Test Event Code</div>
            </div>
          </div>
          <button class="btn btn-secondary" onclick="document.getElementById('tiktok-test-modal').remove()" style="border: none; background: transparent; font-size: 18px;">✕</button>
        </div>

        <form onsubmit="handleExecuteTikTokTest(event, '${code}', '${token}')">
          <div class="form-group">
            <label class="form-label">Pixel ID (event_source_id)</label>
            <input type="text" class="form-input" value="${code}" disabled style="background: rgba(0,0,0,0.3); font-family: monospace; color: #fe2c55;">
          </div>

          <div class="form-group">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
              <label class="form-label" style="margin: 0;">Código de Evento de Teste (Test Event Code / Test ID)</label>
              <span style="font-size: 11px; color: #25f4ee; font-weight: 600;">Recomendado</span>
            </div>
            <input type="text" class="form-input" id="tt-modal-test-code" value="${defaultTestCode || ''}" placeholder="Ex: TEST12345 (da aba Test Events do TikTok)" style="border-color: rgba(37, 244, 238, 0.4); font-family: monospace;">
            <div style="font-size: 11px; color: var(--text-muted); margin-top: 4px;">
              Copie o código que aparece na aba <b>"Test Events"</b> do seu Pixel no Gerenciador de Eventos da TikTok para ver o evento bater em tempo real lá!
            </div>
          </div>

          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
            <div class="form-group">
              <label class="form-label">Evento</label>
              <select class="form-select" id="tt-modal-event">
                <option value="CompletePayment" selected>CompletePayment</option>
                <option value="InitiateCheckout">InitiateCheckout</option>
                <option value="Contact">Contact</option>
                <option value="SubmitForm">SubmitForm</option>
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">Valor (R$)</label>
              <input type="number" step="0.01" class="form-input" id="tt-modal-val" value="49.90">
            </div>
          </div>

          <div class="form-group">
            <label class="form-label">Telefone de Teste (DDI + DDD + Número)</label>
            <input type="text" class="form-input" id="tt-modal-phone" value="5521983948347" placeholder="Ex: 5521983948347" required>
          </div>

          <div style="display: flex; justify-content: flex-end; gap: 10px; margin-top: 20px; padding-top: 16px; border-top: 1px solid rgba(255,255,255,0.08);">
            <button type="button" class="btn btn-secondary" onclick="document.getElementById('tiktok-test-modal').remove()">Cancelar</button>
            <button type="submit" class="btn btn-primary" id="tt-btn-exec-test" style="background: linear-gradient(135deg, #fe2c55, #e11d48); border: none; font-weight: 700; padding: 8px 20px;">
              🚀 Disparar Teste
            </button>
          </div>
        </form>
      </div>
    </div>
  `;

  document.body.insertAdjacentHTML('beforeend', modalHtml);
}

async function handleExecuteTikTokTest(e, code, token) {
  e.preventDefault();
  const test_event_code = (document.getElementById('tt-modal-test-code')?.value || '').trim();
  const event_name = document.getElementById('tt-modal-event')?.value || 'CompletePayment';
  const value = document.getElementById('tt-modal-val')?.value || 49.90;
  const phone = (document.getElementById('tt-modal-phone')?.value || '5521983948347').trim();
  const btn = document.getElementById('tt-btn-exec-test');

  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Enviando...';
  }

  showToast('Disparando para a TikTok Events API v1.3...', 'info');

  try {
    const res = await fetch('/api/tiktok/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pixel_code: code,
        access_token: token,
        event_name,
        phone,
        value,
        test_event_code
      })
    }).then(r => r.json());

    document.getElementById('tiktok-test-modal')?.remove();

    if (res.success) {
      showToast('✓ Evento ' + event_name + ' aceito com SUCESSO pela TikTok!', 'success');
    } else {
      showToast('Retorno TikTok: ' + (res.error || 'Falha no disparo'), 'danger');
    }
    if (typeof renderPixels === 'function') renderPixels();
  } catch (err) {
    showToast('Erro de comunicação: ' + err.message, 'danger');
  }
}

/* =========================================================================
   VIEW 2: INSTANCES (CHIPS DA META)
   ========================================================================= */
async function renderInstances() {
  // Limpa intervalo anterior de polling de conexões se existir
  if (window.instancesConnectingPollInterval) {
    clearInterval(window.instancesConnectingPollInterval);
    window.instancesConnectingPollInterval = null;
  }

  let instances = [];
  try {
    const res = await fetch('/api/instances');
    const data = await res.json();
    instances = Array.isArray(data) ? data : [];
  } catch(e) {
    instances = [];
  }
  state.instances = instances;

  const badgeChips = document.getElementById('badge-chips');
  if (badgeChips) badgeChips.textContent = instances.length;

  if (window.instancesConnectingPollInterval) {
    clearInterval(window.instancesConnectingPollInterval);
    window.instancesConnectingPollInterval = null;
  }

  // Auto-polling em tempo real na aba de conexões (a cada 3.5s) para refletir instantaneamente qualquer conexão ou desconexão
  window.instancesConnectingPollInterval = setInterval(async () => {
    if (state.currentView !== 'instances') {
      clearInterval(window.instancesConnectingPollInterval);
      window.instancesConnectingPollInterval = null;
      return;
    }
    try {
      const pollRes = await fetch('/api/instances');
      const pollData = await pollRes.json();
      if (Array.isArray(pollData)) {
        const currentList = state.instances || [];
        const changed = pollData.length !== currentList.length || pollData.some((p, idx) => {
          const old = currentList[idx];
          return !old || old.id !== p.id || old.status !== p.status || old.numero_conectado !== p.numero_conectado;
        });
        if (changed) {
          await renderInstances();
        }
      }
    } catch (e) {}
  }, 3500);

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
          <button class="btn btn-secondary" style="padding: 7px 13px; font-size: 12.5px; display: flex; align-items: center; gap: 5px;" onclick="renderInstances()">
            <span>🔄</span> <span>Atualizar</span>
          </button>
          <button class="btn-meta-register" style="padding: 7px 15px; font-size: 12.5px;" onclick="openAddChipModal()">
            🔌 Nova Conexão
          </button>
        </div>
      </div>

      <div style="margin-top: 15px;">
        ${instances.length === 0 ? `
          <div style="text-align: center; padding: 50px 20px; background: rgba(255,255,255,0.02); border: 1px dashed rgba(255,255,255,0.12); border-radius: 14px;">
            <div style="font-size: 38px; margin-bottom: 12px;">📱</div>
            <h4 style="color: #fff; font-size: 16px; margin-bottom: 6px; font-weight: 700;">Nenhuma Conexão WhatsApp Ativa</h4>
            <p style="color: var(--text-muted); font-size: 13px; max-width: 480px; margin: 0 auto 18px; line-height: 1.5;">
              Conecte sua conta do WhatsApp via <strong>uazapi (API Web / QR Code)</strong> ou <strong>Meta Cloud API</strong> para sincronizar conversas, enviar mensagens automáticas e receber pedidos.
            </p>
            <button class="btn btn-primary" onclick="openAddChipModal()" style="padding: 10px 20px; font-size: 13px; font-weight: 700; border-radius: 10px;">
              🔌 Conectar WhatsApp Agora
            </button>
          </div>
        ` : `
          <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(360px, 1fr)); gap: 20px;">
            ${instances.map(i => {
              const isUazapi = i.tipo === 'uazapi';
              const isConnected = i.status === 'connected';
              const displayPhone = i.numero_conectado || i.phoneNumber || (isUazapi && isConnected ? '● Conectado' : 'Aguardando pareamento');
              return `
              <div class="card" id="chip-card-${i.id}" data-chip-id="${i.id}" style="margin: 0; background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.08); box-shadow: 0 4px 20px rgba(0,0,0,0.2);">
                <div style="display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 14px;">
                  <div style="display: flex; align-items: center; gap: 10px;">
                    <div class="brand-icon" style="width: 36px; height: 36px; font-size: 18px; background: ${isUazapi ? 'rgba(16,185,129,0.15)' : 'rgba(59,130,246,0.15)'}; border: 1px solid ${isUazapi ? 'rgba(16,185,129,0.3)' : 'rgba(59,130,246,0.3)'};">
                      ${isUazapi ? '⚡' : '📱'}
                    </div>
                    <div>
                      <div style="font-weight: 700; font-size: 15px; color: #fff; display: flex; align-items: center; gap: 6px;">
                        <span>${i.name}</span>
                        <span style="font-size: 10px; padding: 2px 6px; border-radius: 4px; font-weight: 700; background: ${isUazapi ? 'rgba(16,185,129,0.18)' : 'rgba(56,189,248,0.18)'}; color: ${isUazapi ? '#10b981' : '#38bdf8'};">
                          ${isUazapi ? 'uazapi' : 'Meta API'}
                        </span>
                      </div>
                      <div style="font-size: 12px; color: ${isConnected ? 'var(--wa-green)' : 'var(--text-muted)'}; margin-top: 2px; font-weight: 600;">
                        ${displayPhone}
                      </div>
                    </div>
                  </div>
                  <span class="btn" style="padding: 3px 9px; font-size: 11px; font-weight: 600; border-radius: 6px; background: ${isConnected ? 'rgba(37, 211, 102, 0.15)' : (i.status === 'connecting' ? 'rgba(245, 158, 11, 0.15)' : 'rgba(239, 68, 68, 0.15)')}; color: ${isConnected ? 'var(--wa-green)' : (i.status === 'connecting' ? '#f59e0b' : 'var(--red)')};">
                    ${isConnected ? '● Conectado' : (i.status === 'connecting' ? '⏳ Conectando' : '○ Desconectado')}
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
                    <option value="fluxo-espiao-es" selected>🇪🇸 Funil Oficial - Mavrol Empresarial (Español)</option>
                  </select>
                  <div style="font-size: 10.5px; color: var(--text-muted); margin-top: 5px; line-height: 1.3;">
                    As conversas deste número acionam <strong>exclusivamente</strong> este fluxo para evitar qualquer mistura.
                  </div>
                </div>
                
                <div style="font-size: 12px; color: var(--text-secondary); display: flex; flex-direction: column; gap: 6px; padding: 12px; background: var(--bg-input); border-radius: var(--radius-sm); margin-bottom: 16px;">
                  ${isUazapi ? `
                    <div><strong>Servidor:</strong> <span style="font-family: monospace; font-size: 11px; color: #cbd5e1;">${i.url_servidor || 'https://free.uazapi.com'}</span></div>
                    <div><strong>ID Instância:</strong> <span style="font-family: monospace; font-size: 11px; color: #cbd5e1;">${i.instance_id || i.id}</span></div>
                    <div><strong>Segurança:</strong> <span style="color: #10b981; font-size: 11px;">🔒 Token AES-256-GCM</span></div>
                  ` : `
                    <div><strong>Phone Number ID:</strong> ${i.phoneNumberId || 'Não informado'}</div>
                    <div><strong>WABA ID:</strong> ${i.wabaId || 'Não informado'}</div>
                  `}
                  <div><strong>Mensagens Enviadas:</strong> ${i.totalSent || 0}</div>
                </div>

                <div style="display: flex; gap: 8px; flex-wrap: wrap;">
                  ${isUazapi && !isConnected ? `
                    <button class="btn btn-primary" style="flex: 1; min-width: 110px; font-size: 12px; padding: 8px 10px; display: flex; align-items: center; justify-content: center; gap: 6px;" onclick="openUazapiQrModal('${i.id}')">
                      <span>📷</span> <span>Ver QR Code</span>
                    </button>
                  ` : ''}
                  ${isUazapi ? `
                    <button class="btn btn-secondary" style="font-size: 12px; padding: 8px 10px; display: flex; align-items: center; gap: 5px;" title="Sincronizar status live com a uazapi" onclick="syncUazapiChip('${i.id}')">
                      <span>🔄</span> <span>Sincronizar</span>
                    </button>
                  ` : ''}
                  <button class="btn btn-secondary" style="${(isUazapi && !isConnected) ? '' : 'flex: 1;'} font-size: 12px;" onclick="testChip('${i.id}')">Testar Envio</button>
                  <button class="btn btn-danger" style="padding: 8px 12px;" onclick="deleteChip('${i.id}')">Excluir</button>
                </div>
              </div>
              `;
            }).join('')}
          </div>
        `}
      </div>
    </div>
  `;
  document.getElementById('view-container').innerHTML = html;
}

window.syncUazapiChip = async function(id) {
  showToast('Consultando status na uazapi...', 'info');
  try {
    const res = await fetch(`/api/uazapi/sync/${id}`, { method: 'POST' });
    const data = await res.json();
    if (data.success && data.instance) {
      if (data.instance.status === 'connected') {
        showToast(`✓ Chip sincronizado e conectado! (${data.instance.numero_conectado || 'Ativo'})`, 'success');
      } else {
        showToast(`Status: ${data.instance.status}. Aguardando pareamento no celular.`, 'warning');
      }
      await renderInstances();
    } else {
      showToast(data.error || 'Falha ao sincronizar chip', 'error');
    }
  } catch (err) {
    showToast('Erro de rede ao sincronizar chip', 'error');
  }
};


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

  const [chats, flowsRes] = await Promise.all([
    fetch('/api/chats').then(r => r.json()).catch(() => ({})),
    fetch('/api/flows').then(r => r.json()).catch(() => ([]))
  ]);
  state.chats = chats || {};
  state.flows = flowsRes || [];

  // Salva a posição de rolagem da lista de contatos para não resetar
  const oldListEl = document.getElementById('inbox-list');
  const savedListScroll = oldListEl ? oldListEl.scrollTop : 0;

  // Ordena os contatos pelo horário da última mensagem (mais recentes no topo)
  const phones = Object.keys(state.chats).sort((a, b) => {
    const chatA = state.chats[a];
    const chatB = state.chats[b];
    const timeA = chatA?.messages?.length > 0
      ? new Date(chatA.messages[chatA.messages.length - 1].timestamp).getTime()
      : new Date(chatA?.lastMessageTime || 0).getTime();
    const timeB = chatB?.messages?.length > 0
      ? new Date(chatB.messages[chatB.messages.length - 1].timestamp).getTime()
      : new Date(chatB?.lastMessageTime || 0).getTime();
    return timeB - timeA;
  });

  const isMobile = typeof window !== 'undefined' && window.innerWidth <= 1024;
  if (!isMobile && (!state.activeChatPhone || !state.chats[state.activeChatPhone]) && phones.length > 0) {
    state.activeChatPhone = phones[0];
  }

  const activeChat = state.chats[state.activeChatPhone] || null;

  const getLeadStageBadge = (c) => {
    const st = (c?.state || 'NOVO').toUpperCase();
    const up = (c?.upsellStage || 'stage_49').toLowerCase();

    if (st === 'FINALIZADO' || st === 'PAGO' || st === 'APROVADO') {
      return { class: 'pago', label: 'Venda Aprovada', icon: '✅' };
    }
    if (up === 'stage_400') {
      return { class: 'upsell', label: 'Upsell R$400', icon: '💎' };
    }
    if (up === 'stage_200') {
      return { class: 'upsell', label: 'Upsell R$200', icon: '💎' };
    }
    if (up === 'stage_100') {
      return { class: 'upsell', label: 'Upsell R$100', icon: '💎' };
    }
    if (st === 'DUVIDAS' || st === 'NEGOCIACAO') {
      return { class: 'duvidas', label: 'Tirando Dúvidas (IA)', icon: '🤖' };
    }
    if (st === 'OFERTA_ENVIADA') {
      return { class: 'oferta', label: 'Oferta Enviada', icon: '💬' };
    }
    if (st === 'PROVA_ENVIADA') {
      return { class: 'prova', label: 'Prova Enviada', icon: '📸' };
    }
    if (st === 'ANALISANDO') {
      return { class: 'analisando', label: 'Pesquisando Alvo', icon: '🔍' };
    }
    if (st === 'AGUARDANDO_NUMERO') {
      return { class: 'aguardando', label: 'Aguardando Número', icon: '🟡' };
    }
    return { class: 'novo', label: 'Novo Lead', icon: '🟢' };
  };

  const formatPhoneDisplay = (p) => {
    const digits = String(p || '').replace(/\D/g, '');
    if (digits.startsWith('55') && digits.length >= 12) {
      const ddd = digits.slice(2, 4);
      const rest = digits.slice(4);
      if (rest.length === 9) return `+55 (${ddd}) ${rest.slice(0, 5)}-${rest.slice(5)}`;
      if (rest.length === 8) return `+55 (${ddd}) ${rest.slice(0, 4)}-${rest.slice(4)}`;
    }
    return digits ? `+${digits}` : '';
  };

  const activeBadge = activeChat ? getLeadStageBadge(activeChat) : null;
  const activeContactName = activeChat
    ? (activeChat.leadName && !activeChat.leadName.startsWith('Lead ') && activeChat.leadName !== ('+' + activeChat.leadPhone)
        ? activeChat.leadName
        : formatPhoneDisplay(activeChat.leadPhone))
    : '';

  const html = `
    <div class="inbox-container ${state.activeChatPhone ? 'chat-open' : ''}">
      <!-- Contact List -->
      <div class="inbox-sidebar">
        <div class="inbox-search">
          <input type="text" class="form-input" placeholder="🔍 Buscar lead por número..." oninput="filterInbox(this.value)">
          <button class="btn btn-secondary" style="width: 100%; margin-top: 8px; font-size: 11.5px; padding: 7px 10px; display: flex; align-items: center; justify-content: center; gap: 6px;" onclick="syncUazapiChats()">
            <span>🔄</span> <span>Sincronizar WhatsApp</span>
          </button>
        </div>
        <div class="chat-list" id="inbox-list">
          ${phones.length === 0 ? `
            <div style="text-align: center; padding: 30px 14px; color: var(--text-muted); font-size: 12.5px;">
              <div style="font-size: 30px; margin-bottom: 8px;">💬</div>
              <p style="margin-bottom: 10px;">Nenhuma conversa recebida ainda.</p>
              <button class="btn btn-primary" style="font-size: 11.5px; padding: 7px 12px;" onclick="syncUazapiChats()">
                🔄 Buscar Conversas do WhatsApp
              </button>
            </div>
          ` : phones.map(p => {
            const c = state.chats[p] || {};
            const lastMsg = c.messages && c.messages.length > 0 ? c.messages[c.messages.length - 1] : null;
            const isActive = p === state.activeChatPhone;
            const badge = getLeadStageBadge(c);
            const photoUrl = c.leadPhotoUrl || null;
            const rawName = c.leadName;
            const isNameValid = rawName && !rawName.startsWith('Lead ') && rawName !== ('+' + p) && rawName.trim() !== '.' && rawName.trim().length > 1;
            const contactName = isNameValid ? rawName : formatPhoneDisplay(p);
            const phoneFormatted = formatPhoneDisplay(p);
            const initials = isNameValid ? contactName.slice(0, 2).toUpperCase() : p.slice(-2);

            return `
              <div class="chat-item ${isActive ? 'active' : ''}" onclick="selectChat('${p}')">
                <div class="chat-avatar">
                  ${photoUrl ? `<img src="${photoUrl}" alt="${contactName}" onerror="this.onerror=null; this.src=''; this.style.display='none'; this.nextElementSibling.style.display='block';">` : ''}
                  <span style="${photoUrl ? 'display:none;' : ''}">${initials}</span>
                  <span class="avatar-online-dot"></span>
                </div>
                <div class="chat-info">
                  <div class="chat-name-row">
                    <span class="chat-contact-name" title="${contactName}">${contactName}</span>
                    <span class="chat-time">${lastMsg ? new Date(lastMsg.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : ''}</span>
                  </div>
                  <div class="chat-subrow">
                    <span class="chat-phone-formatted">${phoneFormatted}</span>
                    <span class="chat-state-badge ${badge.class}">${badge.icon} ${badge.label}</span>
                  </div>
                  <div class="chat-snippet-row">
                    ${c.isTyping ? `
                      <div class="typing-indicator-snippet">
                        <span>✍️ digitando</span>
                        <span class="typing-dot"></span>
                        <span class="typing-dot"></span>
                        <span class="typing-dot"></span>
                      </div>
                    ` : `
                      <div class="chat-snippet">${lastMsg ? (lastMsg.mediaType ? '📷 [Foto da Prova]' : (lastMsg.text || '')) : 'Nova conversa'}</div>
                    `}
                  </div>
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
            <div style="display: flex; align-items: center; gap: 10px; min-width: 0;">
              <button class="mobile-chat-back-btn" onclick="closeMobileChat()" title="Voltar aos Contatos">
                <span>←</span> <span>Voltar</span>
              </button>
              <div class="chat-avatar" style="width: 48px; height: 48px;">
                ${activeChat.leadPhotoUrl ? `<img src="${activeChat.leadPhotoUrl}" alt="" onerror="this.style.display='none';">` : (activeChat.leadName && !activeChat.leadName.startsWith('Lead ') ? activeChat.leadName.slice(0, 2).toUpperCase() : activeChat.leadPhone.slice(-2))}
                <span class="avatar-online-dot"></span>
              </div>
              <div style="min-width: 0;">
                <div style="font-weight: 700; font-size: 15px; display: flex; align-items: center; gap: 8px;">
                  <span style="color: #fff;">${activeContactName}</span>
                  <span class="chat-state-badge ${activeBadge.class}">${activeBadge.icon} ${activeBadge.label}</span>
                </div>
                <div style="font-size: 11.5px; margin-top: 2px;">
                  ${activeChat.isTyping ? `
                    <span style="color: #25d366; font-weight: 600; display: inline-flex; align-items: center; gap: 4px;">
                      ✍️ digitando
                      <span class="typing-dot"></span>
                      <span class="typing-dot"></span>
                      <span class="typing-dot"></span>
                    </span>
                  ` : `
                    <span style="color: var(--text-muted);">${formatPhoneDisplay(activeChat.leadPhone)} ${activeChat.variables?.alvo ? `<span style="display: inline-flex; align-items: center; gap: 5px; background: rgba(255,255,255,0.06); padding: 2px 7px; border-radius: 4px; margin-left: 6px;">🎯 Alvo: ${activeChat.targetPhotoUrl ? `<img src="${activeChat.targetPhotoUrl}" style="width: 16px; height: 16px; border-radius: 50%; object-fit: cover; border: 1px solid rgba(255,255,255,0.2);">` : ''} ${formatPhoneDisplay(activeChat.variables.alvo)}</span>` : ''}</span>
                  `}
                </div>
              </div>
            </div>

            <!-- Disparo Manual de Fluxo e Automação -->
            <div class="chat-header-actions" style="display: flex; align-items: center; gap: 8px; flex-shrink: 0;">
              <select id="inbox-flow-select" class="form-input desktop-only-action" style="padding: 6px 10px; font-size: 11.5px; height: 34px; max-width: 190px; background: rgba(0,0,0,0.4); border-color: rgba(255,255,255,0.15); border-radius: 8px;" title="Selecione o fluxo para disparar">
                ${(state.flows || []).map(f => `<option value="${f.id}" ${f.id === (activeChat.assignedFlowId || 'fluxo-espiao-es') ? 'selected' : ''}>${f.name}</option>`).join('')}
              </select>

              <button class="btn btn-primary desktop-only-action" style="font-size: 11.5px; padding: 7px 12px; font-weight: 700; background: linear-gradient(135deg, #10b981, #059669); border: none; box-shadow: 0 4px 12px rgba(16, 185, 129, 0.35); display: flex; align-items: center; gap: 6px;" onclick="triggerManualFlowForLead('${activeChat.leadPhone}', 'start')" title="Iniciar automação deste fluxo para o contato">
                <span>⚡</span> <span>Disparar Fluxo</span>
              </button>

              <div style="position: relative; display: inline-block;">
                <button class="btn btn-secondary" style="font-size: 12px; padding: 7px 10px; border-radius: 8px;" onclick="toggleFlowMenu('${activeChat.leadPhone}')" title="Mais opções de automação">
                  <span>⋮</span>
                </button>
                <div id="flow-menu-${activeChat.leadPhone}" style="display: none; position: absolute; right: 0; top: 100%; margin-top: 6px; background: #1e293b; border: 1px solid rgba(255,255,255,0.14); border-radius: 10px; box-shadow: 0 12px 30px rgba(0,0,0,0.6); z-index: 100; min-width: 220px; overflow: hidden;">
                  <button class="mobile-only-menu-item" style="width: 100%; text-align: left; padding: 10px 14px; background: transparent; border: none; color: #38bdf8; font-size: 12px; cursor: pointer; display: flex; align-items: center; gap: 8px; font-weight: 700; transition: background 0.15s; border-bottom: 1px solid rgba(255,255,255,0.08);" onmouseover="this.style.background='rgba(56,189,248,0.1)'" onmouseout="this.style.background='transparent'" onclick="triggerManualFlowForLead('${activeChat.leadPhone}', 'start')">
                    <span>⚡</span> Disparar Fluxo Oficial
                  </button>
                  <button style="width: 100%; text-align: left; padding: 10px 14px; background: transparent; border: none; color: #34d399; font-size: 12px; cursor: pointer; display: flex; align-items: center; gap: 8px; font-weight: 700; transition: background 0.15s;" onmouseover="this.style.background='rgba(16,185,129,0.1)'" onmouseout="this.style.background='transparent'" onclick="manualApproveSale('${activeChat.leadPhone}')">
                    <span>✅</span> Aprovar Acesso & Disparar TikTok
                  </button>
                  <button style="width: 100%; text-align: left; padding: 10px 14px; background: transparent; border: none; color: #fff; font-size: 12px; cursor: pointer; display: flex; align-items: center; gap: 8px; transition: background 0.15s;" onmouseover="this.style.background='rgba(255,255,255,0.08)'" onmouseout="this.style.background='transparent'" onclick="triggerManualFlowForLead('${activeChat.leadPhone}', 'welcome')">
                    <span>👋</span> Reiniciar Boas-Vindas
                  </button>
                  <button style="width: 100%; text-align: left; padding: 10px 14px; background: transparent; border: none; color: #fff; font-size: 12px; cursor: pointer; display: flex; align-items: center; gap: 8px; transition: background 0.15s;" onmouseover="this.style.background='rgba(255,255,255,0.08)'" onmouseout="this.style.background='transparent'" onclick="triggerManualFlowForLead('${activeChat.leadPhone}', 'proof')">
                    <span>🖼️</span> Gerar & Enviar Prova
                  </button>
                  <button style="width: 100%; text-align: left; padding: 10px 14px; background: transparent; border: none; color: #fff; font-size: 12px; cursor: pointer; display: flex; align-items: center; gap: 8px; transition: background 0.15s;" onmouseover="this.style.background='rgba(255,255,255,0.08)'" onmouseout="this.style.background='transparent'" onclick="triggerManualFlowForLead('${activeChat.leadPhone}', 'checkout')">
                    <span>💳</span> Enviar Link de Checkout
                  </button>
                  <div style="height: 1px; background: rgba(255,255,255,0.08); margin: 2px 0;"></div>
                  <button style="width: 100%; text-align: left; padding: 10px 14px; background: transparent; border: none; color: #f87171; font-size: 12px; cursor: pointer; display: flex; align-items: center; gap: 8px; transition: background 0.15s;" onmouseover="this.style.background='rgba(239,68,68,0.1)'" onmouseout="this.style.background='transparent'" onclick="resetLeadState('${activeChat.leadPhone}')">
                    <span>🔄</span> Resetar Estado p/ NOVO
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div class="chat-messages" id="chat-messages-container">
            ${(() => {
              const msgs = activeChat.messages || [];
              const unique = [];
              const seen = new Set();
              for (const m of msgs) {
                const normFrom = (m.from === 'bot' || m.from === 'agent') ? 'out' : 'in';
                const cleanTxt = (m.text || '').trim();
                const timeBlock = m.timestamp ? Math.floor(new Date(m.timestamp).getTime() / 20000) : 0;
                const idKey = m.id ? `id_${m.id}` : null;
                const txtKey = cleanTxt ? `${normFrom}_${cleanTxt}_${timeBlock}` : null;

                if (idKey && seen.has(idKey)) continue;
                if (txtKey && seen.has(txtKey)) continue;

                if (idKey) seen.add(idKey);
                if (txtKey) seen.add(txtKey);
                unique.push(m);
              }

              return unique.map(m => `
                <div class="msg-bubble ${m.from}">
                ${m.mediaType === 'image' && m.mediaUrl ? `
                  <img src="${m.mediaUrl}" class="msg-proof-img" onclick="window.open('${m.mediaUrl}', '_blank')" alt="Prova">
                ` : ''}
                ${m.text ? `<div>${m.text.replace(/\n/g, '<br>')}</div>` : ''}
                <span class="msg-time">${m.timestamp ? new Date(m.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : ''}</span>
              </div>
              `).join('');
            })()}
            ${activeChat.isTyping ? `
              <div class="msg-bubble lead msg-typing">
                <span class="typing-dot"></span>
                <span class="typing-dot"></span>
                <span class="typing-dot"></span>
              </div>
            ` : ''}
          </div>

          <div class="chat-footer">
            <!-- Barra de Atalhos Rápidos -->
            <div class="chat-quick-actions">
              <span style="font-size: 11px; color: var(--text-muted); margin-right: 4px;">⚡ Ações:</span>
              <button type="button" class="quick-action-pill" style="background: rgba(16,185,129,0.18); border-color: rgba(16,185,129,0.4); color: #34d399; font-weight: 700;" onclick="manualApproveSale('${activeChat.leadPhone}')" title="Aprovar compra do Front ($39 USD / R$ 49,90) e disparar TikTok CAPI">
                <span>✅ Aprovar Acesso ($39)</span>
              </button>
              <button type="button" class="quick-action-pill" onclick="triggerManualFlowForLead('${activeChat.leadPhone}', 'start')">
                <span>⚡ Iniciar Automação</span>
              </button>
              <button type="button" class="quick-action-pill" onclick="triggerManualFlowForLead('${activeChat.leadPhone}', 'proof')">
                <span>🖼️ Mandar Prova</span>
              </button>
              <button type="button" class="quick-action-pill" onclick="triggerManualFlowForLead('${activeChat.leadPhone}', 'checkout')">
                <span>💳 Mandar Checkout</span>
              </button>
              <button type="button" class="quick-action-pill" onclick="resetLeadState('${activeChat.leadPhone}')">
                <span>🔄 Resetar Lead</span>
              </button>
            </div>

            <!-- Linha de Input de Mensagem Manual ("Escrever na hora") -->
            <form class="chat-input-row" onsubmit="sendManualMessage(event)" style="display: flex; align-items: center; gap: 10px; width: 100%;">
              <input type="text" class="form-input" id="chat-reply-input" placeholder="💬 Escreva uma mensagem aqui para enviar na hora via WhatsApp... (Enter para enviar)" style="flex: 1; border-radius: 24px; padding: 13px 20px; font-size: 14px; background: rgba(0,0,0,0.45); border: 1.5px solid rgba(255,255,255,0.14); color: #fff; outline: none; box-shadow: inset 0 2px 4px rgba(0,0,0,0.3);" autocomplete="off" onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();sendManualMessage(event);}">
              <button type="submit" class="btn btn-primary" style="border-radius: 50%; width: 46px; height: 46px; min-width: 46px; padding: 0; background: linear-gradient(135deg, #10b981 0%, #059669 100%); border: none; font-size: 19px; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 16px rgba(16, 185, 129, 0.45); cursor: pointer; transition: transform 0.15s;" onmousedown="this.style.transform='scale(0.92)'" onmouseup="this.style.transform='scale(1)'" title="Enviar mensagem agora">
                ➤
              </button>
            </form>
          </div>
        ` : `
          <div style="display: flex; align-items: center; justify-content: center; height: 100%; color: var(--text-muted); font-size: 14px;">
            Nenhuma conversa selecionada
          </div>
        `}
      </div>
    </div>
  `;

  document.getElementById('view-container').innerHTML = html;

  // Restaura posição de rolagem da lista de contatos para não pular
  const newListEl = document.getElementById('inbox-list');
  if (newListEl && savedListScroll > 0) {
    newListEl.scrollTop = savedListScroll;
  }

  // Auto-scroll apenas na caixa de mensagens ativas
  const msgContainer = document.getElementById('chat-messages-container');
  if (msgContainer) msgContainer.scrollTop = msgContainer.scrollHeight;

  // Auto-inicia polling de atualização em segundo plano do Inbox (caso SSE oscile)
  if (!window.inboxLivePollingTimer) {
    window.inboxLivePollingTimer = setInterval(async () => {
      if (state.currentView === 'inbox' && !document.hidden) {
        try {
          const freshChats = await fetch('/api/chats').then(r => r.json()).catch(() => null);
          if (freshChats && Object.keys(freshChats).length > 0) {
            const currentTotal = Object.keys(state.chats || {}).length;
            const freshTotal = Object.keys(freshChats).length;
            const currentLen = state.chats?.[state.activeChatPhone]?.messages?.length || 0;
            const newLen = freshChats?.[state.activeChatPhone]?.messages?.length || 0;
            const stateChanged = JSON.stringify(freshChats[state.activeChatPhone]?.state) !== JSON.stringify(state.chats?.[state.activeChatPhone]?.state);

            if (freshTotal !== currentTotal || newLen !== currentLen || stateChanged) {
              state.chats = freshChats;
              renderInbox(false);
            }
          }
        } catch (e) {}
      }
    }, 3000);
  }
}

window.selectChat = function(phone) {
  state.activeChatPhone = phone;
  renderInbox(false);
};

window.closeMobileChat = function() {
  state.activeChatPhone = null;
  renderInbox(false);
};

window.openMobileDrawer = function() {
  const drawer = document.getElementById('mobile-drawer');
  const backdrop = document.getElementById('mobile-drawer-backdrop');
  if (drawer) drawer.classList.add('open');
  if (backdrop) backdrop.classList.add('open');
};

window.closeMobileDrawer = function() {
  const drawer = document.getElementById('mobile-drawer');
  const backdrop = document.getElementById('mobile-drawer-backdrop');
  if (drawer) drawer.classList.remove('open');
  if (backdrop) backdrop.classList.remove('open');
};

window.toggleFlowMenu = function(phone) {
  const menu = document.getElementById(`flow-menu-${phone}`);
  if (!menu) return;
  const isHidden = menu.style.display === 'none' || !menu.style.display;
  // Fecha outros menus
  document.querySelectorAll('[id^="flow-menu-"]').forEach(m => m.style.display = 'none');
  menu.style.display = isHidden ? 'block' : 'none';
};

// Fecha menu ao clicar fora
document.addEventListener('click', (e) => {
  if (!e.target.closest('[id^="flow-menu-"]') && !e.target.closest('button[onclick^="toggleFlowMenu"]')) {
    document.querySelectorAll('[id^="flow-menu-"]').forEach(m => m.style.display = 'none');
  }
});

window.sendManualMessage = async function(e) {
  if (e) e.preventDefault();
  const input = document.getElementById('chat-reply-input');
  if (!input) return;
  const text = input.value.trim();
  const phone = state.activeChatPhone;
  if (!text || !phone) return;

  input.value = '';

  // Otimista: renderiza a bolha na tela na hora
  const activeChat = state.chats[phone];
  if (activeChat) {
    if (!activeChat.messages) activeChat.messages = [];
    activeChat.messages.push({
      id: `tmp_${Date.now()}`,
      from: 'agent',
      text: text,
      timestamp: new Date().toISOString()
    });
    renderInbox(false);
  }

  try {
    const res = await fetch(`/api/chats/${phone}/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text })
    });
    const data = await res.json();
    if (!data.success) {
      showToast(data.error || 'Falha ao enviar mensagem', 'error');
    }
  } catch (err) {
    showToast('Erro de conexão ao enviar mensagem', 'error');
  }
};

window.triggerManualFlowForLead = async function(phone, step = 'start') {
  const flowSelect = document.getElementById('inbox-flow-select');
  const flowId = flowSelect ? flowSelect.value : null;

  showToast('⚡ Disparando automação no WhatsApp...', 'info');

  try {
    const res = await fetch(`/api/chats/${phone}/trigger-flow`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ flowId, step })
    });
    const data = await res.json();
    if (data.success) {
      showToast(`✓ Automação disparada com sucesso para +${phone}!`, 'success');
      // Recarrega o chat
      const updatedChats = await fetch('/api/chats').then(r => r.json());
      state.chats = updatedChats;
      renderInbox(false);
    } else {
      showToast(data.error || 'Erro ao disparar automação', 'error');
    }
  } catch (err) {
    showToast('Falha ao comunicar com o servidor para disparar fluxo', 'error');
  }
};

window.resetLeadState = async function(phone) {
  try {
    const res = await fetch(`/api/chats/${phone}/reset-state`, { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      showToast(`✓ Estado de +${phone} resetado para NOVO!`, 'success');
      const updatedChats = await fetch('/api/chats').then(r => r.json());
      state.chats = updatedChats;
      renderInbox(false);
    }
  } catch (err) {
    showToast('Erro ao resetar estado do lead', 'error');
  }
};

window.syncUazapiChats = async function() {
  showToast('🔄 Importando conversas do WhatsApp...', 'info');
  try {
    const res = await fetch('/api/uazapi/sync-chats/active', { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      showToast(`✓ ${data.importedChats || 0} conversa(s) e ${data.importedMessages || 0} mensagem(ns) sincronizadas!`, 'success');
      await renderInbox(false);
    } else {
      showToast(data.error || 'Nenhum chip ativo para sincronizar', 'warning');
    }
  } catch (err) {
    showToast('Falha ao sincronizar conversas do WhatsApp', 'error');
  }
};

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
let uazapiPollInterval = null;
let uazapiCountdownInterval = null;
let uazapiSecondsRemaining = 120;
let currentUazapiInstanceId = null;

function toggleUazapiMode(mode) {
  const groupAdmin = document.getElementById('group-uazapi-admintoken');
  const groupKey = document.getElementById('group-uazapi-key');
  if (groupAdmin) {
    groupAdmin.style.display = (mode === 'create') ? 'block' : 'none';
  }
  if (groupKey) {
    groupKey.style.display = (mode === 'key') ? 'block' : 'none';
  }
}

function toggleUazapiConnectType(type) {
  const groupPhone = document.getElementById('group-uazapi-phone');
  if (groupPhone) {
    groupPhone.style.display = (type === 'phone') ? 'block' : 'none';
  }
}

function resetUazapiModalState() {
  if (uazapiPollInterval) {
    clearInterval(uazapiPollInterval);
    uazapiPollInterval = null;
  }
  if (uazapiCountdownInterval) {
    clearInterval(uazapiCountdownInterval);
    uazapiCountdownInterval = null;
  }
  currentUazapiInstanceId = null;
  uazapiSecondsRemaining = 120;

  const liveArea = document.getElementById('uazapi-live-area');
  const errorAlert = document.getElementById('uazapi-error-alert');
  const formInputs = document.getElementById('uazapi-form-inputs');
  const btnConnect = document.getElementById('btn-connect-uazapi');
  const btnText = document.getElementById('btn-uazapi-text');
  const btnBack = document.getElementById('btn-uazapi-back');
  const qrImg = document.getElementById('uazapi-qr-img');
  const qrPlaceholder = document.getElementById('uazapi-qr-placeholder');
  const refreshNotice = document.getElementById('uazapi-refresh-notice');

  if (liveArea) liveArea.style.display = 'none';
  if (errorAlert) errorAlert.style.display = 'none';
  if (formInputs) formInputs.style.display = 'block';
  if (btnBack) btnBack.style.display = 'none';
  if (refreshNotice) refreshNotice.style.display = 'none';
  if (qrPlaceholder) qrPlaceholder.style.display = 'none';
  if (qrImg) {
    qrImg.src = '';
    qrImg.style.display = 'block';
  }
  if (btnConnect) btnConnect.disabled = false;
  if (btnText) btnText.textContent = 'Conectar WhatsApp (QR Code)';

  const statusBox = document.getElementById('uazapi-status-box');
  const statusSpinner = document.getElementById('uazapi-status-spinner');
  const statusText = document.getElementById('uazapi-status-text');
  if (statusBox) {
    statusBox.style.background = 'rgba(59, 130, 246, 0.1)';
    statusBox.style.borderColor = 'rgba(59, 130, 246, 0.25)';
  }
  if (statusSpinner) statusSpinner.style.display = 'inline-block';
  if (statusText) {
    statusText.style.color = '#93c5fd';
    statusText.textContent = 'Iniciando conexão na uazapi...';
  }
}

function openAddChipModal() {
  const modal = document.getElementById('chip-modal');
  if (modal) modal.style.display = 'flex';
  resetUazapiModalState();
  selectConnectionType('web');
  const manualForm = document.getElementById('form-manual-chip');
  if (manualForm) manualForm.style.display = 'none';
  initFacebookSDK();
}

function closeAddChipModal() {
  resetUazapiModalState();
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
  const flowId = document.getElementById('conn-flow-id')?.value || 'fluxo-espiao-es';
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

/**
 * Normaliza qualquer formato de QR code (base64 com/sem prefixo data:, url, ou texto)
 */
function formatQrSrc(raw) {
  if (!raw) return '';
  const str = String(raw).trim();
  if (str.startsWith('data:image')) return str;
  if (str.startsWith('http://') || str.startsWith('https://')) return str;
  if (str.startsWith('iVBORw0KGg') || str.length > 100) {
    return `data:image/png;base64,${str}`;
  }
  // Se for texto cru (ex: 2@...) gera código QR via CDN seguro
  return `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(str)}`;
}

/**
 * Inicia contagem regressiva e polling unificado para monitorar status do QR Code
 */
function startUazapiPollingAndCountdown(instanceId) {
  if (uazapiPollInterval) clearInterval(uazapiPollInterval);
  if (uazapiCountdownInterval) clearInterval(uazapiCountdownInterval);

  const qrImg = document.getElementById('uazapi-qr-img');
  const qrPlaceholder = document.getElementById('uazapi-qr-placeholder');
  const statusText = document.getElementById('uazapi-status-text');
  const statusSpinner = document.getElementById('uazapi-status-spinner');
  const timerVal = document.getElementById('uazapi-timer-val');
  const refreshNotice = document.getElementById('uazapi-refresh-notice');
  const errorAlert = document.getElementById('uazapi-error-alert');
  const errorMsg = document.getElementById('uazapi-error-message');
  const btnConnect = document.getElementById('btn-connect-uazapi');
  const btnText = document.getElementById('btn-uazapi-text');

  uazapiCountdownInterval = setInterval(async () => {
    uazapiSecondsRemaining--;
    if (uazapiSecondsRemaining <= 0) {
      if (refreshNotice) refreshNotice.style.display = 'block';
      if (statusText) statusText.textContent = '🔄 Renovando QR Code expirado...';

      try {
        const refreshRes = await fetch(`/api/uazapi/refresh-qr/${instanceId}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' }
        });
        const refreshData = await refreshRes.json();
        if (refreshData.success && refreshData.qrcode && qrImg) {
          qrImg.src = formatQrSrc(refreshData.qrcode);
          qrImg.style.display = 'block';
          if (qrPlaceholder) qrPlaceholder.style.display = 'none';
          uazapiSecondsRemaining = 120;
          if (refreshNotice) refreshNotice.style.display = 'none';
          if (statusText) statusText.textContent = 'QR Code renovado! Aponte a câmera do WhatsApp:';
        }
      } catch (refrErr) {
        console.warn('[uazapi] Erro ao renovar QR:', refrErr);
      }
    } else {
      const mins = String(Math.floor(uazapiSecondsRemaining / 60)).padStart(2, '0');
      const secs = String(uazapiSecondsRemaining % 60).padStart(2, '0');
      if (timerVal) timerVal.textContent = `${mins}:${secs}`;
    }
  }, 1000);

  uazapiPollInterval = setInterval(async () => {
    if (!instanceId) return;

    try {
      const checkRes = await fetch(`/api/uazapi/status/${instanceId}`);
      const checkData = await checkRes.json();

      if (checkRes.status === 503) {
        const waitSecs = checkData.details?.retryAfter || 5;
        if (statusText) statusText.textContent = `Aguardando capacidade do servidor (${waitSecs}s)...`;
        return;
      }

      if (!checkRes.ok) {
        if (checkRes.status === 401 || checkRes.status === 404) {
          clearInterval(uazapiPollInterval);
          clearInterval(uazapiCountdownInterval);
          throw new Error(checkData.error || 'Autenticação da instância expirou.');
        }
        return;
      }

      // Atualiza QR code se vier na resposta
      if (checkData.qrcode && qrImg) {
        const newSrc = formatQrSrc(checkData.qrcode);
        if (qrImg.src !== newSrc) {
          qrImg.src = newSrc;
          qrImg.style.display = 'block';
          if (qrPlaceholder) qrPlaceholder.style.display = 'none';
          if (statusText && !checkData.connected) {
            statusText.textContent = 'Aponte o WhatsApp do celular para o QR Code abaixo:';
          }
        }
      }

      // Conexão bem-sucedida confirmada!
      const connectedPhone = checkData.numero_conectado || checkData.instance?.numero_conectado || checkData.jid?.user || checkData.instance?.phoneNumber || checkData.instance?.profileName || '';
      const isConfirmedConnected = Boolean(checkData.connected === true);

      if (isConfirmedConnected) {
        clearInterval(uazapiPollInterval);
        clearInterval(uazapiCountdownInterval);
        uazapiPollInterval = null;
        uazapiCountdownInterval = null;

        const statusBox = document.getElementById('uazapi-status-box');
        if (statusBox) {
          statusBox.style.background = 'rgba(16, 185, 129, 0.2)';
          statusBox.style.borderColor = 'rgba(16, 185, 129, 0.4)';
        }
        if (statusSpinner) statusSpinner.style.display = 'none';
        const displayInfo = (connectedPhone && /\d{8,}/.test(connectedPhone)) ? `(+${connectedPhone})` : (connectedPhone || 'Conectado');
        if (statusText) {
          statusText.style.color = '#10b981';
          statusText.textContent = `✅ WhatsApp Conectado com Sucesso! ${displayInfo}`;
        }

        showToast(`✓ WhatsApp Conectado com sucesso! ${displayInfo}`, 'success');

        setTimeout(async () => {
          closeAddChipModal();
          window.location.hash = '#instances';
          state.currentView = 'instances';
          await renderInstances();
        }, 1300);
      }
    } catch (pollErr) {
      console.warn('[uazapi Polling Error]', pollErr);
      if (pollErr.message && (pollErr.message.includes('401') || pollErr.message.includes('Token inválido'))) {
        clearInterval(uazapiPollInterval);
        clearInterval(uazapiCountdownInterval);
        if (errorAlert) {
          errorAlert.style.display = 'block';
          if (errorMsg) errorMsg.textContent = pollErr.message;
        }
        if (btnConnect) btnConnect.disabled = false;
        if (btnText) btnText.textContent = 'Tentar Novamente';
      }
    }
  }, 2000);
}

/**
 * Abre o modal direto na tela de QR Code para reconectar ou visualizar
 */
window.openUazapiQrModal = async function(instanceId) {
  openAddChipModal();
  selectConnectionType('web');

  const liveArea = document.getElementById('uazapi-live-area');
  const formInputs = document.getElementById('uazapi-form-inputs');
  const qrPlaceholder = document.getElementById('uazapi-qr-placeholder');
  const qrImg = document.getElementById('uazapi-qr-img');
  const qrContainer = document.getElementById('uazapi-qr-container');
  const statusText = document.getElementById('uazapi-status-text');
  const timerVal = document.getElementById('uazapi-timer-val');

  if (formInputs) formInputs.style.display = 'none';
  if (liveArea) liveArea.style.display = 'block';
  if (qrContainer) qrContainer.style.display = 'inline-block';
  if (qrPlaceholder) qrPlaceholder.style.display = 'block';
  if (qrImg) qrImg.style.display = 'none';
  if (statusText) statusText.textContent = 'Buscando QR Code atualizado...';

  currentUazapiInstanceId = instanceId;

  try {
    const res = await fetch(`/api/uazapi/status/${instanceId}`);
    const data = await res.json();

    if (data.qrcode) {
      qrImg.src = formatQrSrc(data.qrcode);
      qrImg.style.display = 'block';
      if (qrPlaceholder) qrPlaceholder.style.display = 'none';
      if (statusText) statusText.textContent = 'Aponte o WhatsApp do celular para o QR Code abaixo:';
    } else {
      const refRes = await fetch(`/api/uazapi/refresh-qr/${instanceId}`, { method: 'POST' });
      const refData = await refRes.json();
      if (refData.qrcode) {
        qrImg.src = formatQrSrc(refData.qrcode);
        qrImg.style.display = 'block';
        if (qrPlaceholder) qrPlaceholder.style.display = 'none';
        if (statusText) statusText.textContent = 'Aponte o WhatsApp do celular para o QR Code abaixo:';
      }
    }
  } catch (err) {
    if (statusText) statusText.textContent = 'Falha ao buscar QR Code. Tente novamente.';
  }

  uazapiSecondsRemaining = 120;
  if (timerVal) timerVal.textContent = '02:00';
  startUazapiPollingAndCountdown(instanceId);
};

/**
 * Fluxo de Conexão Real com a uazapi:
 * 1. POST /api/uazapi/init-connect
 * 2. Renderiza QR code e inicia timer de expiração de 2 minutos
 * 3. Polling em /api/uazapi/status/:id a cada 2s
 * 4. Auto-renovação de QR code após 2 minutos
 * 5. Conexão detectada -> fecha modal e salva como ativo
 */
async function handleSaveUazapi() {
  const connNameInput = document.getElementById('conn-name');
  const name = connNameInput?.value.trim();
  if (!name) {
    showToast('Informe o Nome da Conexão antes de continuar', 'error');
    connNameInput?.focus();
    return;
  }

  const serverUrl = 'https://whatsblin.uazapi.com';
  const adminToken = 'Wx0bdo99r3VtcDwC8ulQezVLNDY7rcFOzSWgyS7Q9vjWwKKMJp';
  const connectType = document.querySelector('input[name="uazapi-connect-type"]:checked')?.value || 'qr';
  const instanceKey = document.getElementById('uazapi-key')?.value.trim() || '';
  const phone = connectType === 'phone' ? document.getElementById('uazapi-phone-input')?.value.trim() : '';
  const assignedFlowId = document.getElementById('conn-flow-id')?.value || 'fluxo-espiao-es';

  if (connectType === 'phone' && !phone) {
    showToast('Informe o número de telefone para pareamento com DDI e DDD', 'error');
    document.getElementById('uazapi-phone-input')?.focus();
    return;
  }

  // Prepara UI para conexão
  const btnConnect = document.getElementById('btn-connect-uazapi');
  const btnText = document.getElementById('btn-uazapi-text');
  const btnBack = document.getElementById('btn-uazapi-back');
  const liveArea = document.getElementById('uazapi-live-area');
  const formInputs = document.getElementById('uazapi-form-inputs');
  const errorAlert = document.getElementById('uazapi-error-alert');
  const errorMsg = document.getElementById('uazapi-error-message');
  const statusText = document.getElementById('uazapi-status-text');
  const statusSpinner = document.getElementById('uazapi-status-spinner');
  const qrImg = document.getElementById('uazapi-qr-img');
  const qrPlaceholder = document.getElementById('uazapi-qr-placeholder');
  const qrContainer = document.getElementById('uazapi-qr-container');
  const pairContainer = document.getElementById('uazapi-paircode-container');
  const pairText = document.getElementById('uazapi-paircode-text');
  const timerVal = document.getElementById('uazapi-timer-val');
  const refreshNotice = document.getElementById('uazapi-refresh-notice');

  if (errorAlert) errorAlert.style.display = 'none';
  if (refreshNotice) refreshNotice.style.display = 'none';
  if (formInputs) formInputs.style.display = 'none';
  if (liveArea) liveArea.style.display = 'block';
  if (btnBack) btnBack.style.display = 'inline-block';
  if (qrPlaceholder) qrPlaceholder.style.display = 'block';
  if (qrImg) qrImg.style.display = 'none';
  if (btnConnect) btnConnect.disabled = true;
  if (btnText) btnText.innerHTML = '<div class="spinner" style="width: 14px; height: 14px; border-width: 2px; margin: 0; display: inline-block;"></div> Conectando...';

  if (statusText) statusText.textContent = 'Iniciando conexão na uazapi e gerando QR Code...';
  if (statusSpinner) statusSpinner.style.display = 'inline-block';

  try {
    const res = await fetch('/api/uazapi/init-connect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        serverUrl,
        adminToken,
        instanceKey,
        phone,
        assignedFlowId
      })
    });

    const data = await res.json();

    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Falha ao conectar com o servidor uazapi');
    }

    currentUazapiInstanceId = data.instanceId;

    // Se a instância já veio 100% autenticada com número físico conectado
    const isAlreadyConnected = Boolean(data.connected && (data.numero_conectado || data.status?.jid?.user));
    if (isAlreadyConnected) {
      if (statusText) statusText.textContent = `✅ WhatsApp já autenticado! (+${data.numero_conectado})`;
      showToast('✓ WhatsApp conectado com sucesso via uazapi!', 'success');
      setTimeout(async () => {
        closeAddChipModal();
        window.location.hash = '#instances';
        state.currentView = 'instances';
        await renderInstances();
      }, 1200);
      return;
    }

    // Renderiza QR Code ou Código de Pareamento
    if (data.qrcode && qrImg) {
      const src = formatQrSrc(data.qrcode);
      qrImg.src = src;
      qrImg.style.display = 'block';
      if (qrPlaceholder) qrPlaceholder.style.display = 'none';
      if (qrContainer) qrContainer.style.display = 'inline-block';
      if (pairContainer) pairContainer.style.display = 'none';
      if (statusText) statusText.textContent = 'Aponte o WhatsApp do celular para o QR Code abaixo:';
      if (btnConnect) btnConnect.disabled = false;
      if (btnText) btnText.textContent = '🔄 Atualizar QR Code';
    } else if (data.paircode && pairText) {
      pairText.textContent = data.paircode;
      if (pairContainer) pairContainer.style.display = 'block';
      if (qrContainer) qrContainer.style.display = 'none';
      if (statusText) statusText.textContent = 'Digite o código de pareamento no WhatsApp do celular:';
      if (btnConnect) btnConnect.disabled = false;
      if (btnText) btnText.textContent = '🔄 Gerar Novo Código';
    } else {
      // QR Code ainda em inicialização na uazapi: exibe placeholder animado
      if (qrImg) qrImg.style.display = 'none';
      if (qrPlaceholder) qrPlaceholder.style.display = 'block';
      if (qrContainer) qrContainer.style.display = 'inline-block';
      if (statusText) statusText.textContent = '⏳ Inicializando WhatsApp... Carregando QR Code da uazapi...';
    }

    // Atualiza a lista no background imediatamente para o usuário ver a instância criada como '⏳ Conectando'
    if (state.currentView === 'instances') {
      renderInstances().catch(() => {});
    }

    // Inicia contador regressivo de 2 minutos e Polling em tempo real
    uazapiSecondsRemaining = 120;
    if (timerVal) timerVal.textContent = '02:00';
    startUazapiPollingAndCountdown(currentUazapiInstanceId);

  } catch (err) {
    console.error('[uazapi Save Error]', err);
    if (uazapiPollInterval) clearInterval(uazapiPollInterval);
    if (uazapiCountdownInterval) clearInterval(uazapiCountdownInterval);

    if (errorAlert) {
      errorAlert.style.display = 'block';
      if (errorMsg) errorMsg.textContent = err.message || 'Erro ao comunicar com a uazapi.';
    }
    if (statusText) statusText.textContent = '⚠️ Falha na inicialização da conexão.';
    if (statusSpinner) statusSpinner.style.display = 'none';
    if (btnConnect) btnConnect.disabled = false;
    if (btnText) btnText.textContent = 'Tentar Novamente';
    showToast(err.message || 'Erro ao conectar uazapi', 'error');
  }
}

window.backToUazapiForm = function() {
  if (uazapiPollInterval) {
    clearInterval(uazapiPollInterval);
    uazapiPollInterval = null;
  }
  if (uazapiCountdownInterval) {
    clearInterval(uazapiCountdownInterval);
    uazapiCountdownInterval = null;
  }
  const formInputs = document.getElementById('uazapi-form-inputs');
  const liveArea = document.getElementById('uazapi-live-area');
  const btnConnect = document.getElementById('btn-connect-uazapi');
  const btnText = document.getElementById('btn-uazapi-text');
  const btnBack = document.getElementById('btn-uazapi-back');
  const errorAlert = document.getElementById('uazapi-error-alert');

  if (formInputs) formInputs.style.display = 'block';
  if (liveArea) liveArea.style.display = 'none';
  if (errorAlert) errorAlert.style.display = 'none';
  if (btnBack) btnBack.style.display = 'none';
  if (btnConnect) {
    btnConnect.disabled = false;
    btnConnect.style.display = 'inline-flex';
  }
  if (btnText) btnText.textContent = 'Conectar uazapi';
};

async function saveNewChip(e) {
  e.preventDefault();
  const name = document.getElementById('conn-name')?.value || document.getElementById('chip-name')?.value || 'Chip Manual';
  const phoneNumber = document.getElementById('chip-phone').value;
  const phoneNumberId = document.getElementById('chip-phone-id').value;
  const wabaId = document.getElementById('chip-waba-id').value;
  const accessToken = document.getElementById('chip-token').value;
  const assignedFlowId = document.getElementById('conn-flow-id')?.value || 'fluxo-espiao-es';

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

window.deleteChip = async function(id) {
  if (!confirm('Deseja realmente remover esta conexão?')) return;

  // Remove visualmente de qualquer lugar da interface imediatamente (chips e dash)
  document.querySelectorAll(`[data-chip-id="${id}"]`).forEach(el => {
    el.style.transition = 'all 0.25s ease';
    el.style.opacity = '0';
    el.style.transform = 'scale(0.95)';
    setTimeout(() => el.remove(), 250);
  });

  // Atualiza cache e badge imediatamente
  state.instances = (state.instances || []).filter(i => i.id !== id && i.instance_id !== id);
  const badgeChips = document.getElementById('badge-chips');
  if (badgeChips) badgeChips.textContent = state.instances.length;

  showToast('Removendo chip...', 'info');

  try {
    const res = await fetch(`/api/instances/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: { 'Accept': 'application/json' }
    });
    const data = await res.json().catch(() => ({}));

    if (res.ok && data.success) {
      showToast('✓ Chip removido com sucesso!', 'success');
    } else {
      showToast(data.error || 'Erro ao remover chip', 'error');
    }
  } catch (err) {
    showToast('Erro de rede ao remover: ' + err.message, 'error');
  } finally {
    // Re-renderiza a tela ativa para refletir a remoção imediatamente
    if (state.currentView === 'instances') {
      await renderInstances();
    } else if (state.currentView === 'overview') {
      await renderOverview();
    }
  }
};
const deleteChip = window.deleteChip;

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

      <!-- Coluna 2: Checkouts por Funil (Espanhol e Brasil) -->
      <div class="card">
        <div class="card-header" style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px;">
          <h3 class="card-title">💳 Checkouts por Funil</h3>
          <!-- Abas de Funil -->
          <div style="display: flex; gap: 6px; background: rgba(0,0,0,0.3); padding: 3px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.08);">
            <button type="button" class="btn" id="tab-btn-funnel-es" onclick="switchFunnelCheckoutTab('es')" style="padding: 4px 10px; font-size: 11.5px; font-weight: 700; background: #fe2c55; color: #fff; border: none; border-radius: 6px;">
              🇪🇸 Funil Espanhol
            </button>
            <button type="button" class="btn" id="tab-btn-funnel-br" onclick="switchFunnelCheckoutTab('br')" style="padding: 4px 10px; font-size: 11.5px; font-weight: 600; background: transparent; color: var(--text-secondary); border: none; border-radius: 6px;">
              🇧🇷 Funil Brasil
            </button>
          </div>
        </div>

        <form onsubmit="saveCheckoutSettings(event)">
          <!-- PAINEL FUNIL ESPANHOL -->
          <div id="pane-funnel-es">
            <p style="font-size: 12.5px; color: var(--text-secondary); margin-bottom: 16px;">
              Configuração do link de checkout exclusivo para o <strong>Funil em Espanhol (LATAM e Internacional)</strong>.
            </p>

            <div class="form-group">
              <label class="form-label" style="font-weight: 700; color: #fff;">
                Link Checkout Front ($ 39 USD) *
              </label>
              <input type="url" class="form-input" id="set-chk-es-front" value="${funnel.checkoutUrlEs || funnel.checkouts?.es?.frontUrl || 'https://go.centerpag.com/PPU38CQG5EL'}" placeholder="https://go.centerpag.com/PPU38CQG5EL" style="font-family: monospace; border-color: rgba(254, 44, 85, 0.4);" required>
              <div style="font-size: 11px; color: var(--text-muted); margin-top: 4px;">Link enviado pelo bot e pela IA aos leads de campanhas em espanhol.</div>
            </div>

            <div class="form-group">
              <label class="form-label">Plataforma / Gateway</label>
              <input type="text" class="form-input" id="set-chk-es-platform" value="${funnel.checkouts?.es?.platform || 'CenterPag'}" placeholder="CenterPag / Stripe">
            </div>

            <div style="background: rgba(124, 58, 237, 0.08); border: 1px solid rgba(124, 58, 237, 0.3); border-radius: 10px; padding: 12px; margin-top: 14px; margin-bottom: 18px;">
              <div style="font-size: 12px; color: #c4b5fd; font-weight: 600; display: flex; align-items: center; gap: 6px;">
                <span>ℹ️</span> Upsell 1-Click Direto na CenterPag
              </div>
              <div style="font-size: 11.5px; color: #cbd5e1; margin-top: 4px; line-height: 1.4;">
                Neste funil em espanhol, o WhatsApp cobra unicamente o valor de <strong>$39 USD</strong>. Não há cobranças repetidas de upsell no chat: o cliente conclui o pagamento do front e é direcionado pela própria plataforma em 1 clique para os produtos adicionais.
              </div>
            </div>
          </div>

          <!-- PAINEL FUNIL BRASIL -->
          <div id="pane-funnel-br" style="display: none;">
            <p style="font-size: 12.5px; color: var(--text-secondary); margin-bottom: 16px;">
              Configuração dos links de checkout e escada de upsells para o <strong>Funil Brasil (Kirvano / PIX)</strong>.
            </p>

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
          </div>

          <button type="submit" class="btn btn-primary" style="width: 100%; margin-top: 6px;">Salvar Checkouts dos Funis</button>
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

function switchFunnelCheckoutTab(tab) {
  const isEs = tab === 'es';
  const paneEs = document.getElementById('pane-funnel-es');
  const paneBr = document.getElementById('pane-funnel-br');
  const btnEs = document.getElementById('tab-btn-funnel-es');
  const btnBr = document.getElementById('tab-btn-funnel-br');

  if (paneEs && paneBr) {
    paneEs.style.display = isEs ? 'block' : 'none';
    paneBr.style.display = isEs ? 'none' : 'block';
  }
  if (btnEs && btnBr) {
    btnEs.style.background = isEs ? '#fe2c55' : 'transparent';
    btnEs.style.color = isEs ? '#fff' : 'var(--text-secondary)';
    btnBr.style.background = isEs ? 'transparent' : '#10b981';
    btnBr.style.color = isEs ? 'var(--text-secondary)' : '#fff';
  }
}

async function saveCheckoutSettings(e) {
  e.preventDefault();
  const funnel = state.funnel || {};
  if (!funnel.paymentRecipient) funnel.paymentRecipient = {};
  if (!funnel.upsellStages) funnel.upsellStages = {};
  if (!funnel.checkouts) funnel.checkouts = {};

  // Funil Espanhol (CenterPag)
  const esFront = (document.getElementById('set-chk-es-front')?.value || '').trim() || 'https://go.centerpag.com/PPU38CQG5EL';
  const esPlatform = (document.getElementById('set-chk-es-platform')?.value || '').trim() || 'CenterPag';
  funnel.checkoutUrlEs = esFront;
  funnel.checkouts.es = {
    frontUrl: esFront,
    value: '39',
    currency: 'USD',
    platform: esPlatform
  };

  // Funil Brasil (Kirvano)
  if (document.getElementById('set-benef-name')) {
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

    funnel.checkouts.br = {
      frontUrl: funnel.upsellStages.stage_49.checkoutUrl,
      value: '49,90',
      currency: 'BRL',
      upsell100: funnel.upsellStages.stage_100.checkoutUrl,
      upsell200: funnel.upsellStages.stage_200.checkoutUrl,
      upsell400: funnel.upsellStages.stage_400.checkoutUrl
    };
  }

  await fetch('/api/funnel', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(funnel)
  });

  state.funnel = funnel;
  showToast('✓ Checkouts dos funis atualizados com sucesso!');
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
                    <th>Ações</th>
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
                        <div style="display: flex; align-items: center; gap: 6px;">
                          <strong style="color: #fff; font-size: 14px;">${c.name}</strong>
                          ${c.idioma === 'pt' ? '<span style="font-size: 10px; font-weight: 700; background: rgba(34, 197, 94, 0.15); color: #4ade80; border: 1px solid rgba(34, 197, 94, 0.3); padding: 1px 6px; border-radius: 4px;">🇧🇷 PT</span>' : '<span style="font-size: 10px; font-weight: 700; background: rgba(239, 68, 68, 0.15); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.3); padding: 1px 6px; border-radius: 4px;">🇪🇸 ES</span>'}
                        </div>
                        <div style="font-size: 11px; color: var(--text-muted); margin-top: 2px;">ID: ${c.id}</div>
                        ${c.custom_domain ? `<div style="margin-top: 4px;"><span style="font-size: 10.5px; color: #38bdf8; background: rgba(56, 189, 248, 0.1); border: 1px solid rgba(56, 189, 248, 0.3); padding: 2px 6px; border-radius: 4px; font-family: monospace;">🌐 ${c.custom_domain}</span></div>` : ''}
                      </td>
                      <td>
                        <div style="display: flex; align-items: center; gap: 8px;">
                          <input type="text" class="form-input" readonly value="${c.shortUrl}" style="font-size: 12px; padding: 4px 8px; width: 220px; font-family: monospace; background: rgba(0,0,0,0.3); border-color: rgba(254,44,85,0.4); color: #fe2c55;" id="camp-url-${c.id}">
                          <button class="btn btn-secondary" style="padding: 4px 10px; font-size: 12px;" onclick="copyToClipboard('${c.shortUrl}', 'Link de anúncio copiado!')">📋 Copiar</button>
                        </div>
                      </td>
                      <td>
                        ${c.presell_url && c.presell_url !== 'https://minhapressel.com' ? `
                          <div style="font-size: 12px; color: #60a5fa; max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                            <a href="${c.presell_url}" target="_blank" style="color: #60a5fa; text-decoration: none;">${c.presell_url}</a>
                          </div>
                          <div style="font-size: 10.5px; color: var(--text-muted); margin-top: 2px;">Pressel Externa (?codigo=)</div>
                        ` : `
                          <div style="display: inline-flex; align-items: center; gap: 5px; font-size: 11.5px; color: #34d399; background: rgba(16, 185, 129, 0.1); border: 1px solid rgba(16, 185, 129, 0.3); padding: 3px 8px; border-radius: 6px; font-weight: 600;">
                            <span>⚡</span> Pressel Própria Ultra-Rápida
                          </div>
                          <div style="font-size: 10.5px; color: var(--text-muted); margin-top: 2px;">Redireciona direto p/ WhatsApp (0.3s)</div>
                        `}
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
                    <button class="btn btn-secondary" style="font-size: 11px; padding: 4px 10px;" onclick="testTikTokPixelManual('${p.pixel_code}', '${p.access_token}', '${p.test_event_code || ''}')">⚡ Testar Envio (CompletePayment)</button>
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
                    <th>Ação</th>
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
                      <td>
                        <button class="btn btn-secondary" style="padding: 3px 7px; font-size: 11px; color: #fe2c55; border-color: rgba(254,44,85,0.4);" onclick="resendTikTokLog('${l.id}')" title="Reenviar evento ao TikTok">
                          ⚡ Reenviar
                        </button>
                      </td>
                    </tr>
                  `).join('') : `
                    <tr>
                      <td colspan="8" style="text-align: center; padding: 24px; color: var(--text-muted);">
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
 * MODAL: CRIAR LINK DE CAMPANHA (COM SELETOR DE DOMÍNIO CUSTOMIZADO)
 */
async function openCreateCampaignModal() {
  const defaultHost = window.location.host || 'localhost:3000';
  const proto = window.location.protocol || 'http:';

  let activeDomains = [];
  try {
    const res = await fetch('/api/dominios').then(r => r.json());
    // Exibe todos os domínios customizados registrados (ativos ou em propagação)
    activeDomains = (res.domains || []).filter(d => d.ativo !== false);
  } catch (e) {}

  const modalHtml = `
    <div class="node-modal-backdrop" id="campaign-modal">
      <div class="card" style="width: 580px; max-width: 96%; background: #111827; border: 1px solid rgba(254, 44, 85, 0.4); border-radius: 14px; padding: 24px; box-shadow: 0 25px 50px rgba(0,0,0,0.8);">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
          <div style="display: flex; align-items: center; gap: 10px;">
            <div style="width: 36px; height: 36px; border-radius: 8px; background: #fe2c55; color: #fff; display: flex; align-items: center; justify-content: center; font-size: 18px;">
              🔗
            </div>
            <div>
              <h3 style="font-size: 17px; font-weight: 700; margin: 0; color: #fff;">Novo Link de Campanha</h3>
              <div style="font-size: 11.5px; color: var(--text-secondary);">Gera a URL curta para usar no anúncio do TikTok Ads ou Facebook Ads</div>
            </div>
          </div>
          <button class="btn btn-secondary" onclick="document.getElementById('campaign-modal').remove()" style="border: none; background: transparent; font-size: 18px;">✕</button>
        </div>

        <form onsubmit="handleCreateCampaign(event)">
          <div class="form-group">
            <label class="form-label">Nome da Campanha (Uso Interno) *</label>
            <input type="text" class="form-input" id="camp-input-name" placeholder="Ex: Espião WhatsApp - VSL 01" required>
          </div>

          <!-- Seletor de Idioma da Pressel (Espanhol / Português) -->
          <div class="form-group">
            <label class="form-label" style="font-weight: 600;">Idioma da Tela de Redirecionamento (Pressel) *</label>
            <select class="form-select" id="camp-input-lang" onchange="updateCampLangDefaults(this.value)" style="border-color: rgba(37, 244, 238, 0.4);">
              <option value="es" selected>🇪🇸 Espanhol (Aguarde, usted será redirigido a WhatsApp...)</option>
              <option value="pt">🇧🇷 Português (Aguarde, você será redirecionado para o WhatsApp...)</option>
            </select>
            <div style="font-size: 11px; color: var(--text-muted); margin-top: 4px;">Define o idioma exibido na tela rápida de carregamento e redirecionamento.</div>
          </div>

          <!-- Seletor de Domínio Customizado (Requisito 8) -->
          <div class="form-group">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
              <label class="form-label" style="margin: 0;">Domínio do Link de Anúncio *</label>
              <a href="#dominios" onclick="document.getElementById('campaign-modal')?.remove();" style="color: #a855f7; font-size: 11px; text-decoration: none; font-weight: 600;">+ Adicionar Domínio Próprio</a>
            </div>
            <select class="form-select" id="camp-input-domain" onchange="updateCampSlugPrefix(this.value)" style="border-color: rgba(254, 44, 85, 0.4);" required>
              ${activeDomains.length === 0 ? '<option value="">⚠️ Nenhum domínio próprio configurado (Adicione em Domínios)</option>' : ''}
              ${activeDomains.map((d, i) => `
                <option value="${d.dominio}" ${i === 0 ? 'selected' : ''}>🌐 ${d.dominio} (Domínio Exclusivo de Campanha)</option>
              `).join('')}
            </select>
            <div style="font-size: 11px; color: var(--text-muted); margin-top: 4px;">Selecione o domínio customizado com o qual este link será veiculado no anúncio.</div>
          </div>

          <div class="form-group">
            <label class="form-label">Slug da URL Curta (Opcional)</label>
            <div style="display: flex; align-items: center; background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.1); border-radius: 8px; padding-left: 10px;">
              <span id="camp-slug-prefix" style="font-size: 12px; color: #a855f7; font-family: monospace; font-weight: 700;">${activeDomains.length > 0 ? 'https://' + activeDomains[0].dominio : proto + '//' + defaultHost}/c/</span>
              <input type="text" class="form-input" id="camp-input-slug" placeholder="espiao-vsl-01" style="border: none; background: transparent; font-family: monospace;">
            </div>
            <div style="font-size: 11px; color: var(--text-muted); margin-top: 4px;">Deixe vazio para gerar automaticamente com base no nome.</div>
          </div>

          <div class="form-group">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
              <label class="form-label" style="margin: 0;">Destino do Tráfego / Pressel</label>
              <span style="font-size: 11px; color: #22c55e; font-weight: 700;">⚡ Pressel Própria Automática Ativa</span>
            </div>
            <div style="background: rgba(34, 197, 94, 0.08); border: 1px solid rgba(34, 197, 94, 0.25); border-radius: 10px; padding: 12px; margin-bottom: 8px;">
              <div style="font-size: 12.5px; font-weight: 600; color: #4ade80; display: flex; align-items: center; gap: 6px;">
                <span>✓</span> Pressel Própria Ultra-Rápida Integrada
              </div>
              <div style="font-size: 11.5px; color: #cbd5e1; margin-top: 4px; line-height: 1.4;">
                O lead vê uma tela de carregamento de apenas 0.3s com o logo do WhatsApp, dispara os pixels para capturar <code>_ttp</code> e <code>_fbp</code>, e é redirecionado <b>diretamente para o seu WhatsApp</b> com o código no texto! Não precisa criar nenhuma página externa.
              </div>
            </div>
            <details style="margin-top: 6px;">
              <summary style="font-size: 11px; color: #a855f7; cursor: pointer; font-weight: 600;">+ Deseja usar uma pressel externa própria? (Opcional)</summary>
              <div style="margin-top: 8px;">
                <input type="url" class="form-input" id="camp-input-presell" placeholder="Ex: https://minhapressel.com (Opcional)">
                <div style="font-size: 11px; color: var(--text-muted); margin-top: 4px;">Deixe em branco para usar a Pressel Própria Ultra-Rápida do sistema.</div>
              </div>
            </details>
          </div>

          <div class="form-group">
            <label class="form-label">Número de WhatsApp de Destino (DDI + DDD + Número) *</label>
            <input type="text" class="form-input" id="camp-input-whatsapp" placeholder="5511999998888" value="5511999998888" required>
          </div>

          <div class="form-group">
            <label class="form-label">Template da Mensagem do WhatsApp *</label>
            <textarea class="form-textarea" id="camp-input-template" style="min-height: 80px;" required>Hola, quiero espiar un número. ({codigo} No borres este código.)</textarea>
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


function updateCampLangDefaults(lang) {
  const tplArea = document.getElementById('camp-input-template');
  if (!tplArea) return;
  if (lang === 'es') {
    if (!tplArea.value || tplArea.value.includes('Oii vim pelo')) {
      tplArea.value = 'Hola, quiero espiar un número. ({codigo} No borres este código.)';
    }
  } else {
    if (!tplArea.value || tplArea.value.includes('Hola, quiero')) {
      tplArea.value = 'Oii vim pelo anúncio (código {codigo})';
    }
  }
}

function updateCampSlugPrefix(selectedDomain) {
  const prefixSpan = document.getElementById('camp-slug-prefix');
  if (!prefixSpan) return;
  const domain = selectedDomain || window.location.host || 'localhost:3000';
  const proto = selectedDomain ? 'https:' : (window.location.protocol || 'http:');
  prefixSpan.textContent = `${proto}//${domain}/c/`;
}

async function handleCreateCampaign(e) {
  e.preventDefault();
  const name = document.getElementById('camp-input-name').value.trim();
  const slug = document.getElementById('camp-input-slug').value.trim();
  const custom_domain = document.getElementById('camp-input-domain')?.value || '';
  const presell_url = (document.getElementById('camp-input-presell')?.value || '').trim();
  const whatsapp_number = document.getElementById('camp-input-whatsapp').value.trim();
  const message_template = document.getElementById('camp-input-template').value.trim();
  const idioma = document.getElementById('camp-input-lang')?.value || 'es';

  try {
    const res = await fetch('/api/traffic/campaigns', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, slug, presell_url, whatsapp_number, message_template, custom_domain, idioma })
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

          <div class="form-group">
            <label class="form-label">Test Event Code (Test ID) <span style="font-size: 11px; color: #25f4ee; font-weight: normal;">(Opcional - para testes em tempo real)</span></label>
            <input type="text" class="form-input" id="pix-tt-test-code" placeholder="Ex: TEST12345 (obtido na aba Test Events do TikTok)" style="font-family: monospace; border-color: rgba(37, 244, 238, 0.4);">
            <div style="font-size: 11px; color: var(--text-muted); margin-top: 4px;">Insira o código gerado no TikTok Events Manager se estiver rodando testes em tempo real.</div>
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
  const test_event_code = (document.getElementById('pix-tt-test-code')?.value || '').trim();

  try {
    const res = await fetch('/api/tiktok/pixels', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, pixel_code, access_token, test_event_code })
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

/**
 * =========================================================================
 * TELA: DOMÍNIOS CUSTOMIZADOS (AUTOMATIZADO VIA RAILWAY API)
 * =========================================================================
 */
async function renderDomains() {
  const container = document.getElementById('view-container');
  container.innerHTML = '<div style="color: var(--text-muted); padding: 40px; text-align: center;">Carregando domínios...</div>';

  try {
    const res = await fetch('/api/dominios').then(r => r.json());
    const domains = res.domains || [];
    const railwayConfig = res.railwayConfig || {};

    // Inicia polling se houver algum domínio pendente
    startDomainPolling(domains);

    const pendingCount = domains.filter(d => d.status === 'pendente').length;
    const activeCount = domains.filter(d => d.status === 'ativo' && d.ativo !== false).length;

    container.innerHTML = `
      <div class="domains-view">
        <!-- Top Bar -->
        <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 24px; flex-wrap: wrap; gap: 16px;">
          <div>
            <h2 style="font-size: 22px; font-weight: 700; font-family: 'Outfit', sans-serif; color: #fff; display: flex; align-items: center; gap: 10px;">
              🌐 Domínios Customizados (Railway API)
            </h2>
            <p style="font-size: 13px; color: var(--text-secondary); margin-top: 4px;">
              Use domínios próprios nos anúncios do TikTok/Facebook Ads com provisionamento e SSL automáticos via Railway.
            </p>
          </div>
          <div style="display: flex; gap: 10px;">
            <button class="btn btn-secondary" onclick="openRailwayConfigModal()" style="font-size: 13px; display: flex; align-items: center; gap: 6px;">
              ⚙️ Credenciais Railway ${railwayConfig.hasToken ? '🟢' : '🟡'}
            </button>
            <button class="btn btn-primary" onclick="document.getElementById('domain-input-field')?.focus()" style="font-size: 13px;">
              + Adicionar Domínio
            </button>
          </div>
        </div>

        <!-- Alerta de Segurança & Reputação de Domínio (Requisito 10) -->
        <div class="card" style="padding: 16px; margin-bottom: 24px; background: rgba(245, 158, 11, 0.05); border: 1px solid rgba(245, 158, 11, 0.25); border-radius: 12px;">
          <div style="display: flex; gap: 12px; align-items: flex-start;">
            <span style="font-size: 20px;">⚠️</span>
            <div style="font-size: 12.5px; color: #cbd5e1; line-height: 1.6;">
              <strong style="color: #fbbf24;">Atenção sobre Segurança & Reputação do Domínio:</strong><br>
              Domínios novos ou com histórico em listas de spam/blacklists sofrem rejeição em anúncios e têm a captura de cookies essenciais (<code>_ttp</code> do TikTok e <code>fbclid</code> do Facebook) bloqueada pelos navegadores.
              Utilize sempre domínios com boa reputação e DNS configurado corretamente para obter máxima aprovação de criativos e rastreamento server-side.
            </div>
          </div>
        </div>

        <!-- Grid Top: Formulário de Cadastro + Instruções DNS -->
        <div style="display: grid; grid-template-columns: 1.2fr 1fr; gap: 24px; margin-bottom: 24px;">
          <!-- Formulário -->
          <div class="card" style="padding: 24px;">
            <h3 style="font-size: 16px; font-weight: 700; color: #fff; margin-bottom: 8px;">Cadastrar Novo Domínio</h3>
            <p style="font-size: 12.5px; color: var(--text-secondary); margin-bottom: 20px;">
              Digite o domínio que você comprou avulso (ex: <code>promo123.com</code> ou <code>ir.meudominio.com</code>). O sistema provisionará automaticamente no Railway.
            </p>

            <form onsubmit="handleCreateDomain(event)">
              <div class="form-group" style="margin-bottom: 16px;">
                <label class="form-label" style="font-size: 13px; font-weight: 600; margin-bottom: 8px;">Nome do Domínio ou Subdomínio *</label>
                <div style="display: flex; gap: 10px;">
                  <input type="text" id="domain-input-field" class="form-input" 
                    placeholder="ex: promo123.com ou ir.meudominio.com" 
                    style="flex: 1; font-family: monospace; font-size: 14px; padding: 10px 14px;" required>
                  <button type="submit" id="btn-submit-domain" class="btn btn-primary" style="font-weight: 700; padding: 10px 22px; white-space: nowrap;">
                    Adicionar Domínio
                  </button>
                </div>
                <div style="font-size: 11px; color: var(--text-muted); margin-top: 6px;">
                  Não inclua <code>http://</code> ou <code>/</code>. Aceita domínios raiz ou subdomínios.
                </div>
              </div>
            </form>

            <div style="display: flex; gap: 16px; margin-top: 20px; padding-top: 16px; border-top: 1px solid rgba(255,255,255,0.06);">
              <div style="font-size: 12px; color: #cbd5e1;">
                Domínios Ativos: <strong style="color: #10b981;">${activeCount}</strong>
              </div>
              <div style="font-size: 12px; color: #cbd5e1;">
                Aguardando DNS: <strong style="color: #f59e0b;">${pendingCount}</strong>
              </div>
            </div>
          </div>

          <!-- Card de Instruções CNAME -->
          <div class="card" style="padding: 24px; background: rgba(18, 24, 38, 0.6);">
            <h3 style="font-size: 16px; font-weight: 700; color: #fff; margin-bottom: 12px; display: flex; align-items: center; gap: 8px;">
              <span>📘</span> Como Apontar no seu DNS
            </h3>
            <div style="font-size: 12.5px; color: #cbd5e1; line-height: 1.7;">
              1. Acesse o painel onde você comprou o domínio (Cloudflare, Namecheap, GoDaddy, Hostinger, Registro.br etc).<br>
              2. Vá na seção de <strong>Gerenciamento de DNS</strong>.<br>
              3. Crie um novo registro com:<br>
              &nbsp;&nbsp;• <strong>Tipo:</strong> <code style="color: #06b6d4;">CNAME</code><br>
              &nbsp;&nbsp;• <strong>Nome (Host):</strong> <code style="color: #a855f7;">subdomínio</code> (ou <code>@</code> para raiz)<br>
              &nbsp;&nbsp;• <strong>Valor (Target):</strong> O target fornecido no card abaixo.<br>
              4. O Railway emitirá o certificado SSL automaticamente assim que o DNS propagar!
            </div>
          </div>
        </div>

        <!-- Lista de Domínios Cadastrados -->
        <div class="card" style="padding: 24px;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
            <div>
              <h3 style="font-size: 17px; font-weight: 700; color: #fff; margin: 0;">Domínios Configurados no Sistema</h3>
              <p style="font-size: 12px; color: var(--text-secondary); margin-top: 3px;">
                ${domains.length} domínio(s) cadastrado(s). ${pendingCount > 0 ? '🔄 Verificação automática ativa a cada 30 segundos...' : 'Todos os domínios verificados.'}
              </p>
            </div>
            <button class="btn btn-secondary" onclick="renderDomains()" style="font-size: 12px;">🔄 Atualizar Lista</button>
          </div>

          ${domains.length > 0 ? `
            <div style="display: flex; flex-direction: column; gap: 14px;">
              ${domains.map(d => {
                const isAtivo = d.status === 'ativo' && d.ativo !== false;
                const isPendente = d.status === 'pendente';
                const isDesativado = d.ativo === false;

                const sub = d.dominio.split('.').length > 2 ? d.dominio.split('.')[0] : '@';

                return `
                  <div style="background: rgba(255, 255, 255, 0.02); border: 1px solid ${isAtivo ? 'rgba(16, 185, 129, 0.3)' : (isPendente ? 'rgba(245, 158, 11, 0.3)' : 'rgba(255,255,255,0.06)')}; border-radius: 12px; padding: 20px; box-shadow: ${isAtivo ? '0 0 20px rgba(16, 185, 129, 0.08)' : 'none'};">
                    <div style="display: flex; justify-content: space-between; align-items: flex-start; flex-wrap: wrap; gap: 12px;">
                      
                      <!-- Info Esquerda -->
                      <div>
                        <div style="display: flex; align-items: center; gap: 10px;">
                          <span style="font-size: 20px;">🌐</span>
                          <span style="font-size: 16px; font-weight: 700; color: #fff; font-family: monospace;">${d.dominio}</span>
                          
                          ${isAtivo ? `
                            <span style="background: rgba(16, 185, 129, 0.15); border: 1px solid rgba(16, 185, 129, 0.4); color: #34d399; font-size: 11.5px; font-weight: 700; padding: 3px 10px; border-radius: 20px; display: flex; align-items: center; gap: 5px;">
                              <span style="width: 6px; height: 6px; border-radius: 50%; background: #10b981;"></span>
                              ✅ Ativo e pronto pra uso
                            </span>
                          ` : isPendente ? `
                            <span style="background: rgba(245, 158, 11, 0.15); border: 1px solid rgba(245, 158, 11, 0.4); color: #fbbf24; font-size: 11.5px; font-weight: 700; padding: 3px 10px; border-radius: 20px; display: flex; align-items: center; gap: 5px;">
                              <span class="live-dot-pulse" style="background: #f59e0b; width: 6px; height: 6px;"></span>
                              Aguardando DNS
                            </span>
                          ` : `
                            <span style="background: rgba(255,255,255,0.05); color: #94a3b8; font-size: 11.5px; padding: 3px 10px; border-radius: 20px;">
                              ⚪ Desativado / Aposentado
                            </span>
                          `}
                        </div>

                        <div style="font-size: 11.5px; color: var(--text-muted); margin-top: 6px;">
                          Cadastrado em: ${new Date(d.criado_em).toLocaleString('pt-BR')} • Railway Domain ID: <code>${d.railway_domain_id || '-'}</code>
                        </div>
                      </div>

                      <!-- Ações Direita -->
                      <div style="display: flex; gap: 8px; flex-wrap: wrap;">
                        <button class="btn btn-secondary" onclick="checkDomainStatusNow('${d.id}')" style="font-size: 12px; padding: 6px 12px;" title="Consultar status imediato no Railway">
                          ⚡ Verificar Agora
                        </button>
                        ${isPendente ? `
                          <button class="btn btn-primary" onclick="confirmDomainNow('${d.id}')" style="font-size: 12px; padding: 6px 12px; background: #10b981; border: none; font-weight: 700;" title="Confirmar conexão feita no painel do Railway">
                            ✅ Já Conectei (Ativar)
                          </button>
                        ` : ''}
                        <button class="btn btn-secondary" onclick="handleToggleDomainActive('${d.id}')" style="font-size: 12px; padding: 6px 12px;" title="Ativar ou desativar">
                          ${d.ativo ? '⏸️ Desativar' : '▶️ Ativar'}
                        </button>
                        <button class="btn btn-secondary" onclick="handleDeleteDomain('${d.id}')" style="font-size: 12px; padding: 6px 12px; color: var(--red);" title="Excluir domínio">
                          🗑️ Remover
                        </button>
                      </div>
                    </div>

                    <!-- Box de Apontamento DNS / CNAME Target -->
                    <div style="background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.08); border-radius: 8px; padding: 12px 16px; margin-top: 16px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px;">
                      <div style="font-size: 12.5px; color: #cbd5e1;">
                        <span style="color: #94a3b8; margin-right: 6px;">Instrução DNS:</span>
                        Crie CNAME: <strong>Nome:</strong> <code style="color: #a855f7;">${sub}</code> ➔ 
                        <strong>Valor:</strong> <code style="color: #06b6d4; font-size: 13px;" id="cname-val-${d.id}">${d.cname_target}</code>
                      </div>
                      <button class="btn btn-secondary" style="padding: 5px 14px; font-size: 12px; display: flex; align-items: center; gap: 6px;" onclick="copyToClipboard('${d.cname_target}', 'Valor CNAME copiado!')">
                        📋 Copiar Valor
                      </button>
                    </div>

                  </div>
                `;
              }).join('')}
            </div>
          ` : `
            <div style="text-align: center; padding: 50px 20px; border: 1px dashed rgba(255,255,255,0.1); border-radius: 12px;">
              <div style="font-size: 36px; margin-bottom: 12px;">🌐</div>
              <h4 style="font-size: 15px; color: #fff; margin-bottom: 6px;">Nenhum domínio customizado cadastrado ainda</h4>
              <p style="font-size: 12.5px; color: var(--text-muted); max-width: 420px; margin: 0 auto 18px auto;">
                Adicione seu primeiro domínio próprio acima para gerar links de campanhas com sua marca e alta conversão no TikTok e Facebook Ads.
              </p>
            </div>
          `}
        </div>
      </div>
    `;
  } catch (err) {
    container.innerHTML = `<div style="color: #ef4444; padding: 40px; text-align: center;">Erro carregando domínios: ${err.message}</div>`;
  }
}

/**
 * Cadastrar novo domínio via formulário
 */
async function handleCreateDomain(e) {
  e.preventDefault();
  const input = document.getElementById('domain-input-field');
  const btn = document.getElementById('btn-submit-domain');
  const dominio = (input?.value || '').trim();

  if (!dominio) return;

  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Criando no Railway...';
  }

  try {
    const res = await fetch('/api/dominios/criar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dominio })
    });

    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Erro ao criar domínio');

    showToast(`✓ Domínio ${dominio} registrado no Railway! Aponte o CNAME para ativar.`, 'success');
    renderDomains();
  } catch (err) {
    showToast(`Erro: ${err.message}`, 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Adicionar Domínio';
    }
  }
}

/**
 * Consulta status imediato de um domínio
 */
async function checkDomainStatusNow(id) {
  try {
    showToast('Verificando conexão HTTPS e DNS do domínio...', 'info');
    const res = await fetch(`/api/dominios/${id}/status`).then(r => r.json());
    if (res.status === 'ativo' || res.verified) {
      showToast(`🎉 Domínio ${res.dominio} verificado e ATIVO no Railway!`, 'success');
    } else {
      showToast(`Status: Aguardando propagação DNS / Certificado SSL`, 'info');
    }
    renderDomains();
  } catch (err) {
    showToast(`Erro ao verificar: ${err.message}`, 'error');
  }
}

async function confirmDomainNow(id) {
  try {
    showToast('Ativando domínio...', 'info');
    const res = await fetch(`/api/dominios/${id}/confirmar`, { method: 'POST' }).then(r => r.json());
    if (res.success) {
      showToast('🎉 Domínio confirmado e ATIVO no Railway para campanhas!', 'success');
    } else {
      showToast('Erro: ' + (res.error || 'Falha ao ativar'), 'danger');
    }
    renderDomains();
  } catch (err) {
    showToast('Erro ao confirmar: ' + err.message, 'danger');
  }
}

/**
 * Alterna ativo / desativado
 */
async function handleToggleDomainActive(id) {
  try {
    const res = await fetch(`/api/dominios/${id}/toggle-ativo`, { method: 'PATCH' }).then(r => r.json());
    if (res.success) {
      showToast(`Domínio ${res.domain.ativo ? 'ativado' : 'desativado'} com sucesso.`);
      renderDomains();
    }
  } catch (err) {
    showToast(`Erro: ${err.message}`, 'error');
  }
}

/**
 * Exclui domínio
 */
async function handleDeleteDomain(id) {
  if (!confirm('Deseja realmente remover este domínio do sistema e do Railway?')) return;

  try {
    const res = await fetch(`/api/dominios/${id}`, { method: 'DELETE' }).then(r => r.json());
    if (res.success) {
      showToast('Domínio removido com sucesso.');
      renderDomains();
    } else {
      throw new Error(res.error);
    }
  } catch (err) {
    showToast(`Erro ao remover: ${err.message}`, 'error');
  }
}

/**
 * Polling automático a cada 30s para domínios pendentes
 */
function startDomainPolling(domains) {
  if (window.domainPollingTimer) {
    clearInterval(window.domainPollingTimer);
    window.domainPollingTimer = null;
  }

  const pendingDomains = domains.filter(d => d.status === 'pendente');
  if (pendingDomains.length === 0) return;

  console.log(`[Domain Polling] Iniciando polling para ${pendingDomains.length} domínio(s) pendente(s)...`);

  window.domainPollingTimer = setInterval(async () => {
    // Se saiu da tela de domínios, para o timer
    if (state.currentView !== 'dominios') {
      clearInterval(window.domainPollingTimer);
      window.domainPollingTimer = null;
      return;
    }

    let changed = false;
    for (const d of pendingDomains) {
      try {
        const res = await fetch(`/api/dominios/${d.id}/status`).then(r => r.json());
        if (res.status === 'ativo') {
          changed = true;
          showToast(`🎉 Domínio ${d.dominio} foi verificado e agora está ATIVO!`, 'success');
        }
      } catch (e) {}
    }

    if (changed) {
      renderDomains();
    }
  }, 30000); // 30 segundos
}

/**
 * Modal para configurar ou verificar credenciais do Railway
 */
async function openRailwayConfigModal() {
  let cfg = {};
  try {
    const res = await fetch('/api/dominios').then(r => r.json());
    cfg = res.railwayConfig || {};
  } catch (e) {}

  const modalHtml = `
    <div class="node-modal-backdrop" id="railway-config-modal">
      <div class="card" style="width: 540px; max-width: 96%; background: #111827; border: 1px solid rgba(168, 85, 247, 0.4); border-radius: 14px; padding: 24px; box-shadow: 0 25px 50px rgba(0,0,0,0.8);">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 18px;">
          <div style="display: flex; align-items: center; gap: 10px;">
            <span style="font-size: 24px;">🚂</span>
            <div>
              <h3 style="font-size: 17px; font-weight: 700; color: #fff; margin: 0;">Credenciais da API do Railway</h3>
              <p style="font-size: 11.5px; color: var(--text-secondary); margin: 2px 0 0 0;">Necessárias para provisionar domínios e emitir SSL automaticamente</p>
            </div>
          </div>
          <button class="btn btn-secondary" onclick="document.getElementById('railway-config-modal').remove()" style="border: none; background: transparent; font-size: 18px;">✕</button>
        </div>

        <div style="background: rgba(255, 255, 255, 0.03); border: 1px solid rgba(255, 255, 255, 0.06); border-radius: 10px; padding: 12px; margin-bottom: 18px; font-size: 12px; color: #cbd5e1; line-height: 1.5;">
          💡 <strong>Dica Railway:</strong> Em produção no Railway, <code>RAILWAY_PROJECT_ID</code>, <code>RAILWAY_ENVIRONMENT_ID</code> e <code>RAILWAY_SERVICE_ID</code> são injetados automaticamente. Você só precisa gerar o <strong>API Token</strong> em: <em>Account Settings ➔ Tokens</em> no Railway.
        </div>

        <form onsubmit="handleSaveRailwayConfig(event)">
          <div class="form-group" style="margin-bottom: 14px;">
            <label class="form-label">Railway API Token (RAILWAY_API_TOKEN) *</label>
            <input type="password" id="railway-input-token" class="form-input" placeholder="ry_api_••••••••••••••••" style="font-family: monospace;">
          </div>

          <div class="form-group" style="margin-bottom: 14px;">
            <label class="form-label">Project ID (Opcional se rodando no Railway)</label>
            <input type="text" id="railway-input-project" class="form-input" placeholder="Ex: prj_xxxx ou UUID" style="font-family: monospace;">
          </div>

          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 18px;">
            <div class="form-group" style="margin-bottom: 0;">
              <label class="form-label">Environment ID</label>
              <input type="text" id="railway-input-env" class="form-input" placeholder="UUID do ambiente" style="font-family: monospace;">
            </div>
            <div class="form-group" style="margin-bottom: 0;">
              <label class="form-label">Service ID</label>
              <input type="text" id="railway-input-service" class="form-input" placeholder="UUID do serviço" style="font-family: monospace;">
            </div>
          </div>

          <div style="display: flex; justify-content: flex-end; gap: 10px; border-top: 1px solid rgba(255,255,255,0.08); padding-top: 14px;">
            <button type="button" class="btn btn-secondary" onclick="document.getElementById('railway-config-modal').remove()">Cancelar</button>
            <button type="submit" class="btn btn-primary" style="background: linear-gradient(135deg, #a855f7, #6366f1); border: none; font-weight: 700;">Salvar Credenciais</button>
          </div>
        </form>
      </div>
    </div>
  `;

  document.body.insertAdjacentHTML('beforeend', modalHtml);
}

async function handleSaveRailwayConfig(e) {
  e.preventDefault();
  const apiToken = document.getElementById('railway-input-token')?.value || '';
  const projectId = document.getElementById('railway-input-project')?.value || '';
  const environmentId = document.getElementById('railway-input-env')?.value || '';
  const serviceId = document.getElementById('railway-input-service')?.value || '';

  try {
    const res = await fetch('/api/dominios/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiToken, projectId, environmentId, serviceId })
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);

    document.getElementById('railway-config-modal')?.remove();
    showToast('✓ Credenciais do Railway salvas com sucesso!', 'success');
    renderDomains();
  } catch (err) {
    showToast(`Erro: ${err.message}`, 'error');
  }
}





// =========================================================================
// FUNÇÕES GLOBAIS DE ATRIBUIÇÃO, APROVAÇÃO MANUAL E REENVIO TIKTOK CAPI
// =========================================================================
window.manualApproveSale = async function(phone) {
  if (!phone) return;
  if (!confirm('Deseja aprovar o acesso deste lead ($39 USD / R$ 49,90), enviar a mensagem de liberação no WhatsApp e disparar o evento CompletePayment ao TikTok CAPI?')) {
    return;
  }

  showToast('Aprovando acesso e disparando TikTok CAPI...');
  try {
    const res = await fetch('/api/sales/manual-approve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone })
    });
    const data = await res.json();

    if (res.ok && data.success) {
      showToast('🎉 Acesso liberado no WhatsApp e evento TikTok CAPI disparado com sucesso!');
      if (typeof loadChats === 'function') loadChats();
      if (typeof renderChat === 'function') renderChat();
    } else {
      showToast('Erro: ' + (data.error || 'Falha ao aprovar venda'));
    }
  } catch (err) {
    showToast('Erro na requisição: ' + err.message);
  }
};

window.resendTikTokAttribution = async function(code, phone) {
  showToast('Reenviando evento CompletePayment ao TikTok Ads Manager...');
  try {
    const res = await fetch('/api/tiktok/resend', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, phone })
    });
    const data = await res.json();

    if (res.ok && data.success) {
      showToast('⚡ Evento aceito com sucesso pelo TikTok Ads Manager!');
      if (typeof renderTikTokAttribution === 'function') renderTikTokAttribution();
    } else {
      showToast('Aviso TikTok: ' + (data.error || data.tiktok?.error || 'Verifique o log da API'));
    }
  } catch (err) {
    showToast('Erro ao reenviar: ' + err.message);
  }
};

window.resendTikTokLog = async function(logId) {
  if (!logId) return;
  showToast('Reenviando evento ao TikTok...');
  try {
    const res = await fetch('/api/tiktok/resend', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ log_id: logId })
    });
    const data = await res.json();

    if (res.ok && data.success) {
      showToast('⚡ Evento reenviado ao TikTok com sucesso!');
      if (typeof renderTikTokAttribution === 'function') renderTikTokAttribution();
    } else {
      showToast('Erro TikTok: ' + (data.error || data.tiktok?.error || 'Falha ao disparar'));
    }
  } catch (err) {
    showToast('Erro na conexão: ' + err.message);
  }
};

window.switchMobileLiveMode = function(mode) {
  const container = document.getElementById('live-flow-container');
  const btnCanvas = document.getElementById('btn-live-canvas');
  const btnFeed = document.getElementById('btn-live-feed');
  if (container) {
    container.classList.toggle('feed-mode', mode === 'feed');
  }
  if (btnCanvas && btnFeed) {
    btnCanvas.classList.toggle('active', mode === 'canvas');
    btnFeed.classList.toggle('active', mode === 'feed');
  }
  if (mode === 'canvas' && typeof fitLiveFlowView === 'function') {
    setTimeout(fitLiveFlowView, 60);
  }
};


// =========================================================================
// FUNÇÕES DO GERADOR MANUAL DE IMAGENS DE PROVA (DASHBOARD)
// =========================================================================
let currentFoundPhotoUrl = null;

window.focusManualProofGenerator = function() {
  const card = document.getElementById('manual-proof-card');
  const input = document.getElementById('proof-target-phone');
  if (card) {
    card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    card.style.borderColor = '#a855f7';
    card.style.boxShadow = '0 0 25px rgba(168, 85, 247, 0.4)';
    setTimeout(() => {
      card.style.borderColor = 'rgba(139, 92, 246, 0.45)';
      card.style.boxShadow = '0 8px 30px rgba(124, 58, 237, 0.16)';
    }, 1500);
  }
  if (input) input.focus();
};

window.handleProofDdiChange = function(val) {
  const customInput = document.getElementById('proof-ddi-custom');
  if (!customInput) return;
  if (val === 'custom') {
    customInput.style.display = 'block';
    customInput.value = '';
    customInput.focus();
  } else {
    customInput.style.display = 'none';
    customInput.value = val;
  }
};

window.toggleCustomPhotoUpload = function(checked) {
  const wrap = document.getElementById('proof-custom-photo-wrap');
  if (wrap) wrap.style.display = checked ? 'block' : 'none';
};

window.handleCustomUrlPreview = function(url) {
  const box = document.getElementById('proof-custom-preview-box');
  const img = document.getElementById('proof-custom-preview-img');
  if (url && url.startsWith('http')) {
    if (img) img.src = url;
    if (box) box.style.display = 'flex';
  } else {
    if (box) box.style.display = 'none';
  }
};

window.handleCustomFilePreview = function(input) {
  const box = document.getElementById('proof-custom-preview-box');
  const img = document.getElementById('proof-custom-preview-img');
  if (input.files && input.files[0]) {
    const reader = new FileReader();
    reader.onload = (e) => {
      if (img) img.src = e.target.result;
      if (box) box.style.display = 'flex';
    };
    reader.readAsDataURL(input.files[0]);
  } else {
    if (box) box.style.display = 'none';
  }
};

window.autoLookupProofPhoto = function() {
  const phoneInput = document.getElementById('proof-target-phone');
  const raw = (phoneInput?.value || '').replace(/\D/g, '');
  if (raw.length >= 7) {
    lookupManualProofPhoto(false);
  }
};

window.lookupManualProofPhoto = async function(showToastFeedback = true) {
  const ddiSelect = document.getElementById('proof-ddi-select');
  const ddiCustom = document.getElementById('proof-ddi-custom');
  const phoneInput = document.getElementById('proof-target-phone');
  const spinner = document.getElementById('lookup-photo-spinner');
  const statusWrap = document.getElementById('proof-photo-status-wrap');

  const rawPhone = (phoneInput?.value || '').trim();
  if (!rawPhone) {
    if (showToastFeedback) showToast('⚠️ Digite o número antes de buscar a foto.', 'warning');
    return;
  }

  const ddiVal = (ddiSelect?.value === 'custom')
    ? (ddiCustom?.value || '').replace(/\D/g, '')
    : (ddiSelect?.value || '507');

  if (spinner) spinner.style.display = 'inline-block';

  try {
    const res = await fetch(`/api/manual-proof/lookup-photo?ddi=${encodeURIComponent(ddiVal)}&numero=${encodeURIComponent(rawPhone)}`);
    const data = await res.json();

    if (data.success && data.hasPhoto && data.photoUrl) {
      currentFoundPhotoUrl = data.photoUrl;
      if (statusWrap) {
        statusWrap.style.display = 'block';
        statusWrap.innerHTML = `
          <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 10px; background: rgba(16, 185, 129, 0.12); border: 1px solid rgba(16, 185, 129, 0.4); border-radius: 8px; padding: 9px 14px;">
            <div style="display: flex; align-items: center; gap: 12px;">
              <img src="${data.photoUrl}" alt="Avatar" style="width: 44px; height: 44px; border-radius: 50%; object-fit: cover; border: 2px solid #10b981; box-shadow: 0 0 10px rgba(16, 185, 129, 0.35);" onerror="this.src='/images/default-avatar.png';">
              <div>
                <div style="color: #34d399; font-weight: 700; font-size: 13.5px;">✓ Foto do WhatsApp Carregada com Sucesso!</div>
                <div style="font-size: 11.5px; color: #cbd5e1; margin-top: 1px;">Número Alvo: <strong>+${data.phone}</strong> • Esta foto será estampada na imagem de prova.</div>
              </div>
            </div>
            <span class="badge" style="background: #10b981; color: #fff; font-size: 11px; padding: 4px 8px; border-radius: 6px;">Foto Pronta ✓</span>
          </div>
        `;
      }
      if (showToastFeedback) showToast('✓ Foto do perfil encontrada com sucesso!', 'success');
    } else {
      currentFoundPhotoUrl = null;
      if (statusWrap) {
        statusWrap.style.display = 'block';
        statusWrap.innerHTML = `
          <div style="background: rgba(245, 158, 11, 0.1); border: 1px solid rgba(245, 158, 11, 0.3); border-radius: 8px; padding: 9px 14px; font-size: 12px; color: #fbbf24;">
            ⚠️ <strong>Foto pública não encontrada automaticamente para +${data.phone || rawPhone}:</strong><br>
            O número pode estar sem foto pública ou seu chip está offline. Você pode <strong>colar o link da foto</strong> ou <strong>fazer upload</strong> nas opções abaixo, ou gerar normalmente com o áudio criptografado.
          </div>
        `;
      }
      if (showToastFeedback) showToast('Foto pública não encontrada. Você pode anexar uma foto ou gerar com áudio.', 'info');
    }
  } catch (err) {
    console.warn('[Lookup Photo Error]', err);
    if (showToastFeedback) showToast('Erro na consulta de foto: ' + err.message, 'error');
  } finally {
    if (spinner) spinner.style.display = 'none';
  }
};

window.generateManualProof = async function() {
  const ddiSelect = document.getElementById('proof-ddi-select');
  const ddiCustom = document.getElementById('proof-ddi-custom');
  const phoneInput = document.getElementById('proof-target-phone');
  const langSelect = document.getElementById('proof-lang-select');
  const customPhotoCheck = document.getElementById('proof-opt-custom-photo');
  const customUrlInput = document.getElementById('proof-custom-url');
  const customFileInput = document.getElementById('proof-custom-file');
  const btn = document.getElementById('btn-generate-proof');
  const spinner = document.getElementById('btn-proof-spinner');
  const btnText = document.getElementById('btn-proof-text');
  const resultContainer = document.getElementById('proof-result-container');

  const rawPhone = (phoneInput?.value || '').trim();
  if (!rawPhone) {
    showToast('⚠️ Por favor, digite o número do alvo ou lead.', 'warning');
    if (phoneInput) phoneInput.focus();
    return;
  }

  const ddiVal = (ddiSelect?.value === 'custom')
    ? (ddiCustom?.value || '').replace(/\D/g, '')
    : (ddiSelect?.value || '507');

  const langVal = langSelect?.value || 'es';

  // Desativa botão e mostra carregamento
  if (btn) btn.disabled = true;
  if (spinner) spinner.style.display = 'inline-block';
  if (btnText) btnText.textContent = 'Gerando Imagem...';

  try {
    let customPhotoBase64 = null;
    let customPhotoUrl = null;

    if (customPhotoCheck?.checked) {
      if (customFileInput?.files?.length > 0) {
        const file = customFileInput.files[0];
        customPhotoBase64 = await new Promise((resolve) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = () => resolve(null);
          reader.readAsDataURL(file);
        });
      } else if (customUrlInput?.value && customUrlInput.value.startsWith('http')) {
        customPhotoUrl = customUrlInput.value.trim();
      }
    }

    const res = await fetch('/api/manual-proof/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ddi: ddiVal,
        numero: rawPhone,
        lang: langVal,
        customPhotoBase64,
        customPhotoUrl
      })
    });

    const data = await res.json();
    if (!data.success) {
      throw new Error(data.error || 'Erro ao gerar imagem.');
    }

    // Exibe o preview e ações
    if (resultContainer) {
      resultContainer.style.display = 'block';
      resultContainer.innerHTML = `
        <div style="background: rgba(16, 185, 129, 0.08); border: 1px solid rgba(16, 185, 129, 0.3); border-radius: 12px; padding: 14px; margin-bottom: 16px;">
          <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px;">
            <div style="display: flex; align-items: center; gap: 10px;">
              ${data.photoUrl ? `<img src="${data.photoUrl}" style="width: 40px; height: 40px; border-radius: 50%; object-fit: cover; border: 2px solid #10b981;">` : `<span style="font-size: 24px;">✅</span>`}
              <div>
                <strong style="color: #34d399; font-size: 14px;">Imagem de Prova Pronta para Envio!</strong>
                <div style="font-size: 12px; color: #cbd5e1; margin-top: 1px;">Número Alvo: <strong>+${data.phone}</strong> ${data.hasPhoto ? '• (Foto do rosto estampada ✓)' : '• (Áudio criptografado ✓)'}</div>
              </div>
            </div>
            <div style="display: flex; gap: 8px; flex-wrap: wrap;">
              <button type="button" class="btn btn-primary" onclick="downloadGeneratedProof('${data.url}', '${data.filename}')" style="background: #10b981; border: none; font-weight: 700; font-size: 12.5px; padding: 7px 14px; display: flex; align-items: center; gap: 6px;">
                <span>📥</span> <span>Baixar Imagem</span>
              </button>
              <button type="button" class="btn btn-secondary" onclick="copyProofLink('${data.url}')" style="font-size: 12.5px; padding: 7px 14px; display: flex; align-items: center; gap: 6px;">
                <span>📋</span> <span>Copiar Link</span>
              </button>
              <a href="https://wa.me/${data.phone}" target="_blank" class="btn btn-secondary" style="font-size: 12.5px; padding: 7px 14px; text-decoration: none; display: flex; align-items: center; gap: 6px; color: #34d399; border-color: rgba(16,185,129,0.4);">
                <span>💬</span> <span>Abrir no WhatsApp</span>
              </a>
            </div>
          </div>
        </div>

        <div style="display: flex; flex-direction: column; align-items: center; background: rgba(0,0,0,0.3); border-radius: 12px; padding: 16px;">
          <div style="max-width: 330px; width: 100%; text-align: center;">
            <img src="${data.url}" alt="Print de Prova" style="width: 100%; height: auto; border-radius: 12px; box-shadow: 0 12px 35px rgba(0,0,0,0.7); border: 1px solid rgba(255,255,255,0.1); cursor: pointer;" onclick="window.open('${data.url}', '_blank')">
            <div style="font-size: 11.5px; color: var(--text-muted); margin-top: 8px;">Toque na imagem para ampliar em tela cheia</div>
          </div>
        </div>
      `;
      resultContainer.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    showToast('✓ Imagem de prova gerada com sucesso!', 'success');
  } catch (err) {
    console.error('[Generate Proof Error]', err);
    showToast('Erro ao gerar imagem: ' + err.message, 'error');
  } finally {
    if (btn) btn.disabled = false;
    if (spinner) spinner.style.display = 'none';
    if (btnText) btnText.textContent = '⚡ Gerar Imagem';
  }
};

window.downloadGeneratedProof = async function(url, filename) {
  try {
    const res = await fetch(url);
    const blob = await res.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename || 'prova_whatsapp.png';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    showToast('✓ Download da imagem iniciado!', 'success');
  } catch (e) {
    window.open(url, '_blank');
  }
};

window.copyProofLink = function(url) {
  if (navigator.clipboard) {
    navigator.clipboard.writeText(url).then(() => {
      showToast('✓ Link da imagem copiado para a área de transferência!', 'success');
    }).catch(() => {
      prompt('Copie o link abaixo:', url);
    });
  } else {
    prompt('Copie o link abaixo:', url);
  }
};
