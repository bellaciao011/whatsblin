/* =========================================================================
   WhatsApp Web/Mobile Simulator Logic (Authentic WhatsApp Experience)
   ========================================================================= */

(function() {
  'use strict';

  // Configuração e Estado
  let sessionId = localStorage.getItem('wa_chat_session_id');
  if (!sessionId) {
    sessionId = 'wa_lead_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8);
    localStorage.setItem('wa_chat_session_id', sessionId);
  }

  // Captura UTMs da URL
  const urlParams = new URLSearchParams(window.location.search);
  const utmData = {
    slug: window.location.pathname.replace(/^\/chat\//, '').replace(/^\/c\//, '') || 'campanha',
    utm_source: urlParams.get('utm_source') || '',
    utm_medium: urlParams.get('utm_medium') || '',
    utm_campaign: urlParams.get('utm_campaign') || '',
    utm_content: urlParams.get('utm_content') || '',
    utm_term: urlParams.get('utm_term') || '',
    src: urlParams.get('src') || '',
    codigo: urlParams.get('codigo') || 'vip',
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || ''
  };

  // Elementos do DOM
  const chatArea = document.getElementById('wa-chat-area');
  const inputField = document.getElementById('wa-input-field');
  const sendBtn = document.getElementById('wa-send-btn');
  const userStatus = document.getElementById('wa-user-status');
  const attendantNameEl = document.getElementById('wa-user-name');
  const attendantAvatarEl = document.getElementById('wa-user-avatar');
  const modalBackdrop = document.getElementById('wa-modal-backdrop');
  const modalImg = document.getElementById('wa-modal-img');

  // Áudio nativo de notificação WhatsApp (Web Audio API)
  let audioCtx = null;
  function playBeep(type = 'incoming') {
    try {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === 'suspended') audioCtx.resume();

      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.connect(gain);
      gain.connect(audioCtx.destination);

      const now = audioCtx.currentTime;
      if (type === 'incoming') {
        osc.frequency.setValueAtTime(800, now);
        osc.frequency.exponentialRampToValueAtTime(1050, now + 0.08);
        gain.gain.setValueAtTime(0.12, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.16);
        osc.start(now);
        osc.stop(now + 0.16);
      } else {
        osc.frequency.setValueAtTime(650, now);
        gain.gain.setValueAtTime(0.08, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.08);
        osc.start(now);
        osc.stop(now + 0.08);
      }
    } catch(e) {}
  }

  function getFormattedTime() {
    const d = new Date();
    return d.getHours().toString().padStart(2, '0') + ':' + d.getMinutes().toString().padStart(2, '0');
  }

  function scrollToBottom(smooth = true) {
    if (!chatArea) return;
    chatArea.scrollTo({
      top: chatArea.scrollHeight,
      behavior: smooth ? 'smooth' : 'auto'
    });
  }

  function setTyping(isTyping) {
    if (!userStatus) return;
    if (isTyping) {
      userStatus.textContent = 'escribiendo...';
      userStatus.classList.add('typing');
      showTypingIndicator();
    } else {
      userStatus.textContent = 'en línea';
      userStatus.classList.remove('typing');
      removeTypingIndicator();
    }
  }

  function showTypingIndicator() {
    if (document.getElementById('wa-active-typing')) return;
    const row = document.createElement('div');
    row.className = 'wa-message-row incoming';
    row.id = 'wa-active-typing';
    row.innerHTML = `
      <div class="wa-typing-bubble">
        <div class="wa-typing-dot"></div>
        <div class="wa-typing-dot"></div>
        <div class="wa-typing-dot"></div>
      </div>
    `;
    chatArea.appendChild(row);
    scrollToBottom(true);
  }

  function removeTypingIndicator() {
    const el = document.getElementById('wa-active-typing');
    if (el) el.remove();
  }

  function appendTextMessage(from, text, timeStr = null) {
    const time = timeStr || getFormattedTime();
    const row = document.createElement('div');
    row.className = 'wa-message-row ' + from;

    const formattedText = escapeHtml(text)
      .replace(/\n/g, '<br>')
      .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" style="color: #027eb5; text-decoration: underline; word-break: break-all;">$1</a>');

    const metaTicks = from === 'outgoing' ? '<span class="wa-blue-ticks">✓✓</span>' : '';

    row.innerHTML = `
      <div class="wa-bubble ${from}">
        <div class="wa-msg-text">${formattedText}</div>
        <div class="wa-msg-meta">
          <span>${time}</span>
          ${metaTicks}
        </div>
      </div>
    `;

    chatArea.appendChild(row);
    scrollToBottom(true);
  }

  function appendImageMessage(url, caption = '') {
    const time = getFormattedTime();
    const row = document.createElement('div');
    row.className = 'wa-message-row incoming';

    row.innerHTML = `
      <div class="wa-bubble incoming wa-image-bubble">
        <div class="wa-proof-img-wrap" onclick="openWaModal('${url}')">
          <img src="${url}" alt="Prueba de audio" class="wa-proof-img" loading="lazy" />
        </div>
        ${caption ? `<div class="wa-image-caption">${escapeHtml(caption)}</div>` : ''}
        <div class="wa-msg-meta" style="padding-right: 4px;">
          <span>${time}</span>
        </div>
      </div>
    `;

    chatArea.appendChild(row);
    scrollToBottom(true);
  }

  function appendCheckoutCard(text, checkoutUrl, amount = '19') {
    const time = getFormattedTime();
    const row = document.createElement('div');
    row.className = 'wa-message-row incoming';

    const formattedText = escapeHtml(text).replace(/\n/g, '<br>');

    row.innerHTML = `
      <div class="wa-bubble incoming" style="border: 1px solid rgba(0, 168, 132, 0.35);">
        <div class="wa-msg-text">${formattedText}</div>
        <div class="wa-checkout-card">
          <a href="${checkoutUrl}" target="_blank" class="wa-btn-checkout" onclick="trackCheckoutClick()">
            <span>🔒 PAGAR $${amount} Y DESBLOQUEAR</span>
          </a>
          <div style="font-size: 11px; text-align: center; color: #667781; margin-top: 5px;">
            Acceso instantáneo después del pago
          </div>
        </div>
        <div class="wa-msg-meta">
          <span>${time}</span>
        </div>
      </div>
    `;

    chatArea.appendChild(row);
    scrollToBottom(true);
  }

  function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  window.openWaModal = function(url) {
    if (modalImg && modalBackdrop) {
      modalImg.src = url;
      modalBackdrop.classList.add('active');
    }
  };

  window.closeWaModal = function() {
    if (modalBackdrop) {
      modalBackdrop.classList.remove('active');
    }
  };

  window.trackCheckoutClick = function() {
    try {
      if (window.fbq) fbq('track', 'InitiateCheckout');
      if (window.ttq) ttq.track('InitiateCheckout');
    } catch(e) {}
  };

  async function sendMessage() {
    const text = (inputField.value || '').trim();
    if (!text) return;

    // Adiciona bolha do usuário imediatamente como no WhatsApp
    appendTextMessage('outgoing', text);
    inputField.value = '';
    inputField.focus();
    playBeep('outgoing');

    try {
      if (window.fbq) fbq('track', 'Contact');
      if (window.ttq) ttq.track('Contact');
    } catch(e) {}

    // Exibe digitação
    setTyping(true);

    try {
      const res = await fetch('/api/webchat/message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: sessionId,
          message: text,
          ...utmData
        })
      });

      const data = await res.json();
      setTyping(false);

      if (!data.success) {
        appendTextMessage('incoming', 'Lo siento, hubo un problema al procesar el mensaje. Por favor intenta de nuevo.');
        return;
      }

      // Processa as mensagens retornadas com delay humano
      const replies = data.replies || [];
      for (let i = 0; i < replies.length; i++) {
        const item = replies[i];
        if (i > 0) {
          setTyping(true);
          await new Promise(r => setTimeout(r, item.delay || 1500));
          setTyping(false);
        }

        if (item.type === 'text') {
          appendTextMessage('incoming', item.text);
          playBeep('incoming');
        } else if (item.type === 'image') {
          appendImageMessage(item.url, item.caption);
          playBeep('incoming');
        } else if (item.type === 'checkout') {
          appendCheckoutCard(item.text, item.checkoutUrl, item.amount);
          playBeep('incoming');
        }
      }
    } catch (err) {
      setTyping(false);
      console.error('[WebChat] Erro no envio de mensagem:', err);
      appendTextMessage('incoming', 'Error de conexión. Verifica tu conexión a internet.');
    }
  }

  function setupEvents() {
    if (sendBtn) {
      sendBtn.addEventListener('click', sendMessage);
    }
    if (inputField) {
      inputField.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          sendMessage();
        }
      });
    }
  }

  async function initChat() {
    try {
      const res = await fetch('/api/webchat/init', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: sessionId,
          utm: utmData
        })
      });

      const data = await res.json();
      if (!data.success) return;

      // Atualiza atendente
      if (data.attendant) {
        if (data.attendant.name && attendantNameEl) attendantNameEl.textContent = data.attendant.name;
        if (data.attendant.avatar && attendantAvatarEl) attendantAvatarEl.src = data.attendant.avatar;
      }

      // Renderiza histórico ou as 2 mensagens iniciais com delay humano
      const msgs = data.history || [];
      if (msgs.length > 2) {
        // Sessão antiga com conversa em andamento
        for (const m of msgs) {
          if (m.mediaType === 'image') {
            appendImageMessage(m.mediaUrl, m.text);
          } else {
            appendTextMessage(m.from === 'user' ? 'outgoing' : 'incoming', m.text);
          }
        }
      } else if (data.welcomeMessages && data.welcomeMessages.length >= 2) {
        // Primeira sessão: Mensagem 1 imediatamente -> delay 1.3s digitando -> Mensagem 2
        appendTextMessage('incoming', data.welcomeMessages[0]);
        playBeep('incoming');
        setTyping(true);
        setTimeout(() => {
          setTyping(false);
          appendTextMessage('incoming', data.welcomeMessages[1]);
          playBeep('incoming');
        }, 1300);
      } else if (data.welcomeMessage) {
        appendTextMessage('incoming', data.welcomeMessage);
        playBeep('incoming');
      }

      setupEvents();
    } catch (err) {
      console.error('[WebChat] Erro ao inicializar sessão:', err);
    }
  }

  // Inicializa quando DOM estiver pronto
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initChat);
  } else {
    initChat();
  }
})();
