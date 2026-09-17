/**
 * WhatsApp Web/Mobile Simulator Client Logic
 */
(function() {
  const SESSION_KEY = 'wa_webchat_session_id';
  let sessionId = localStorage.getItem(SESSION_KEY) || ('sess_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9));
  localStorage.setItem(SESSION_KEY, sessionId);

  // Elementos do DOM
  const chatArea = document.getElementById('wa-chat-area');
  const inputField = document.getElementById('wa-input-field');
  const sendBtn = document.getElementById('wa-send-btn');
  const userStatus = document.getElementById('wa-user-status');
  const userName = document.getElementById('wa-user-name');
  const userAvatar = document.getElementById('wa-user-avatar');
  const modalBackdrop = document.getElementById('wa-modal-backdrop');
  const modalImg = document.getElementById('wa-modal-img');

  // Extrai UTMs e Slug da URL atual
  const urlParams = new URLSearchParams(window.location.search);
  const pathParts = window.location.pathname.split('/').filter(Boolean);
  const slug = pathParts[pathParts.length - 1] || 'default';

  const utmData = {
    slug: slug,
    utm_source: urlParams.get('utm_source') || '',
    utm_medium: urlParams.get('utm_medium') || '',
    utm_campaign: urlParams.get('utm_campaign') || '',
    utm_content: urlParams.get('utm_content') || '',
    utm_term: urlParams.get('utm_term') || '',
    codigo: urlParams.get('codigo') || urlParams.get('c') || ''
  };

  // Áudio Sintetizado Nativo do WhatsApp (Web Audio API)
  function playBeep(type) {
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return;
      const ctx = new AudioContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);

      if (type === 'incoming') {
        osc.frequency.setValueAtTime(880, ctx.currentTime); // A5
        osc.frequency.exponentialRampToValueAtTime(1320, ctx.currentTime + 0.08); // E6
        gain.gain.setValueAtTime(0.08, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
        osc.start();
        osc.stop(ctx.currentTime + 0.16);
      } else {
        osc.frequency.setValueAtTime(600, ctx.currentTime);
        gain.gain.setValueAtTime(0.04, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.08);
        osc.start();
        osc.stop(ctx.currentTime + 0.09);
      }
    } catch (e) {}
  }

  function getTimeString() {
    const now = new Date();
    return now.getHours().toString().padStart(2, '0') + ':' + now.getMinutes().toString().padStart(2, '0');
  }

  function scrollToBottom() {
    setTimeout(() => {
      chatArea.scrollTop = chatArea.scrollHeight;
    }, 50);
  }

  function setTyping(isTyping) {
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
    removeTypingIndicator();
    const row = document.createElement('div');
    row.className = 'wa-message-row incoming';
    row.id = 'wa-typing-row';
    row.innerHTML = `
      <div class="wa-bubble incoming wa-typing-bubble">
        <div class="wa-typing-dot"></div>
        <div class="wa-typing-dot"></div>
        <div class="wa-typing-dot"></div>
      </div>
    `;
    chatArea.appendChild(row);
    scrollToBottom();
  }

  function removeTypingIndicator() {
    const el = document.getElementById('wa-typing-row');
    if (el) el.remove();
  }

  // Renderiza bolha de texto
  function appendTextMessage(from, text) {
    const row = document.createElement('div');
    row.className = `wa-message-row ${from}`;
    const time = getTimeString();
    const ticks = from === 'outgoing' ? '<span class="wa-blue-ticks">✓✓</span>' : '';

    // Converte links em texto para links clicáveis
    const linkedText = text.replace(
      /(https?:\/\/[^\s]+)/g,
      '<a href="$1" target="_blank" style="color: #027eb5; text-decoration: underline; word-break: break-all;">$1</a>'
    );

    row.innerHTML = `
      <div class="wa-bubble ${from}">
        <span class="wa-msg-text">${linkedText}</span>
        <span class="wa-msg-meta">
          <span>${time}</span>
          ${ticks}
        </span>
      </div>
    `;

    chatArea.appendChild(row);
    scrollToBottom();
  }

  // Renderiza bolha com imagem de prova
  function appendImageMessage(imageUrl, caption) {
    const row = document.createElement('div');
    row.className = 'wa-message-row incoming';
    const time = getTimeString();

    row.innerHTML = `
      <div class="wa-bubble incoming wa-image-bubble">
        <div class="wa-proof-img-wrap" onclick="window.openWaImage('${imageUrl}')">
          <img src="${imageUrl}" alt="Prueba de investigación" class="wa-proof-img" loading="lazy" />
        </div>
        ${caption ? `<div class="wa-image-caption">${caption}</div>` : ''}
        <span class="wa-msg-meta" style="padding-right: 4px;">
          <span>${time}</span>
        </span>
      </div>
    `;

    chatArea.appendChild(row);
    scrollToBottom();
  }

  // Renderiza bolha com oferta e botão de checkout direto
  function appendCheckoutOfferMessage(offerText, checkoutUrl, amount) {
    const row = document.createElement('div');
    row.className = 'wa-message-row incoming';
    const time = getTimeString();

    row.innerHTML = `
      <div class="wa-bubble incoming" style="border: 1px solid rgba(0, 168, 132, 0.35);">
        <span class="wa-msg-text">${offerText}</span>
        <div class="wa-checkout-card">
          <a href="${checkoutUrl}" target="_blank" class="wa-btn-checkout" onclick="window.handleCheckoutClick('${checkoutUrl}')">
            <span>💳 Desbloquear Informe Completo ($${amount || '19'})</span>
          </a>
          <div style="font-size: 11px; text-align: center; color: #8696a0; margin-top: 5px;">
            🔒 Pago 100% Confidencial y Cifrado
          </div>
        </div>
        <span class="wa-msg-meta">
          <span>${time}</span>
        </span>
      </div>
    `;

    chatArea.appendChild(row);
    scrollToBottom();
  }

  // Lightbox da imagem
  window.openWaImage = function(url) {
    if (modalImg && modalBackdrop) {
      modalImg.src = url;
      modalBackdrop.classList.add('active');
    }
  };

  window.closeWaModal = function() {
    if (modalBackdrop) modalBackdrop.classList.remove('active');
  };

  window.handleCheckoutClick = function(url) {
    try {
      if (window.fbq) fbq('track', 'InitiateCheckout');
      if (window.ttq) ttq.track('InitiateCheckout');
    } catch(e) {}
  };

  // Envio de mensagem
  async function sendMessage() {
    const text = (inputField.value || '').trim();
    if (!text) return;

    // Adiciona bolha do usuário
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

    // Formata o número com o DDI selecionado se for apenas dígitos locais
    let messageToSend = text;
    const cleanDigits = text.replace(/\D/g, '');
    const isOnlyDigits = cleanDigits.length >= 7 && cleanDigits.length <= 13 && (text.length - cleanDigits.length) <= 4;
    
    if (isOnlyDigits && !text.startsWith('+') && !cleanDigits.startsWith(selectedCountry.code)) {
      messageToSend = '+' + selectedCountry.code + ' ' + text;
    }

    try {
      const res = await fetch('/api/webchat/message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: sessionId,
          message: messageToSend,
          ddi: selectedCountry.code,
          ...utmData
        })
      });

      const data = await res.json();
      setTyping(false);

      if (!data.success) {
        appendTextMessage('incoming', 'Lo siento, hubo un problema al procesar el mensaje. Por favor intenta de nuevo.');
        return;
      }

      // Processa a lista de mensagens retornadas
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
          appendCheckoutOfferMessage(item.text, item.checkoutUrl, item.amount);
          playBeep('incoming');
        }
      }

    } catch (err) {
      console.error('[WebChat Error]', err);
      setTyping(false);
      appendTextMessage('incoming', 'Error de conexión. Por favor verifica tu internet.');
    }
  }

  // Inicialização da sessão
  async function initSession() {
    try {
      const res = await fetch('/api/webchat/init', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: sessionId,
          ...utmData
        })
      });

      const data = await res.json();
      if (data.attendant) {
        if (userName) userName.textContent = data.attendant.name || 'Maria Carvalho';
        if (userAvatar && data.attendant.avatar) userAvatar.src = data.attendant.avatar;
      }

      // Se já houver histórico nessa sessão, restaura
      if (data.history && data.history.length > 0) {
        data.history.forEach(m => {
          if (m.mediaType === 'image') {
            appendImageMessage(m.mediaUrl, m.text);
          } else if (m.checkoutUrl) {
            appendCheckoutOfferMessage(m.text, m.checkoutUrl, m.amount);
          } else {
            appendTextMessage(m.from === 'user' ? 'outgoing' : 'incoming', m.text);
          }
        });
      } else if (data.welcomeMessage) {
        // Se for nova sessão, simula a primeira mensagem da atendente
        setTyping(true);
        setTimeout(() => {
          setTyping(false);
          appendTextMessage('incoming', data.welcomeMessage);
          playBeep('incoming');
        }, 1200);
      }
    } catch (err) {
      console.warn('[WebChat Init Error]', err);
      // Mensagem padrão de fallback
      appendTextMessage('incoming', '¡Hola! 👋 Mucho gusto. ¿Cómo te llamas y qué número te gustaría investigar hoy?');
    }
  }

  // Event Listeners
  if (sendBtn) sendBtn.addEventListener('click', sendMessage);
  if (inputField) {
    inputField.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        sendMessage();
      }
    });
  }

  // Inicia
  initSession();
})();
