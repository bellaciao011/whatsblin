
function getCustomTrackingDomain() {
  try {
    const campaigns = db.getTrafficCampaigns();
    const camp = campaigns.find(c => c.custom_domain && c.custom_domain.trim());
    if (camp && camp.custom_domain) return camp.custom_domain.trim();

    const domains = db.getCustomDomains();
    const active = domains.find(d => (d.status === 'ativo' || d.ativo) && d.dominio);
    if (active && active.dominio) return active.dominio.trim();
  } catch (e) {}
  return 'wtb.expresstrackin-g.com';
}

function buildSpanishCheckoutUrl(baseUrl, leadCode = 'lead') {
  const cleanCode = (leadCode || 'lead').toUpperCase().replace(/[^A-Z0-9]/g, '') || 'LEAD';
  const domain = getCustomTrackingDomain();
  return `https://${domain}/checkout?codigo=${cleanCode}`;
}

const axios = require('axios');
const db = require('../storage/db');
const cryptoService = require('./cryptoService');

/**
 * Obtém e descriptografa a API Key da OpenAI de forma segura
 */
function getOpenAiApiKey() {
  const settings = db.getSettings() || {};
  const rawKey = process.env.OPENAI_API_KEY || settings.openaiApiKey || '';
  if (!rawKey) return '';
  return cryptoService.decrypt(rawKey);
}

/**
 * Classifica a resposta do lead logo após a mensagem de Boas-Vindas
 */
async function classifyWelcomeReply(userMessage, language = 'es') {
  language = 'es';
  const lang = 'es';
  const settings = db.getSettings();
  const apiKey = getOpenAiApiKey();
  const funnel = db.getFunnel();

  const welcomeTexts = {
    pt: {
      doubt: "Nuestro sistema localiza mensajes, audios eliminados y registros en los servidores mediante el número de teléfono. Es 100% confidencial y la persona no se entera.\n\nPara que pueda generar la vista previa y enviarte la prueba, solo envíame su número aquí con el código de país.",
      reinforce: "En cuanto envíes el número ya lo activo aquí 👍\n\nNecesito el WhatsApp de la persona:\nCódigo de país + número\n\nEnvíalo rápido."
    },
    es: {
      doubt: "Nuestro sistema localiza mensajes, audios eliminados y registros en los servidores mediante el número de teléfono. Es 100% confidencial y la persona no se entera.\n\nPara que pueda generar la vista previa y enviarte la prueba, solo envíame su número aquí con el código de país.",
      reinforce: "En cuanto envíes el número ya lo activo aquí 👍\n\nNecesito el WhatsApp de la persona:\nCódigo de país + número\n\nEnvíalo rápido."
    },
    en: {
      doubt: "Our system locates messages, deleted audios, and server records using the phone number. It is 100% confidential and the person will never know.\n\nTo generate the preview and send you the proof, just send me their number with country code here.",
      reinforce: "As soon as you send the number I'll activate it right here 👍\n\nI need the person's WhatsApp number:\nCountry code + number\n\nSend it quickly."
    }
  };

  const selectedTexts = welcomeTexts[lang] || welcomeTexts.pt;
  const doubtReply = selectedTexts.doubt;
  const reinforceReply = selectedTexts.reinforce;

  const rawDigits = (userMessage || '').replace(/\D/g, '');
  if (rawDigits.length >= 8 && rawDigits.length <= 15) {
    return { type: 'PHONE', targetPhone: rawDigits };
  }

  const lower = (userMessage || '').toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

  // Detecta se é dúvida sobre como funciona o serviço em PT, ES ou EN
  const isDoubt = (
    // Português
    lower.includes('como funciona') || lower.includes('o que e') || lower.includes('quem e') ||
    lower.includes('e seguro') || lower.includes('e confiavel') || lower.includes('como assim') ||
    lower.includes('que prova') || lower.includes('como voce') || lower.includes('quem e voce') ||
    lower.includes('como acha') || lower.includes('explica') || lower.includes('me explica') ||
    lower.includes('funciona mesmo') || lower.includes('da certo') ||
    // Espanhol
    lower.includes('que es') || lower.includes('quien es') || lower.includes('es seguro') ||
    lower.includes('es confiable') || lower.includes('como asi') || lower.includes('cual prueba') ||
    lower.includes('como haces') || lower.includes('quien eres') || lower.includes('funciona de verdad') ||
    // Inglês
    lower.includes('how does it work') || lower.includes('how does this work') || lower.includes('how it works') ||
    lower.includes('how this works') || lower.includes('what is this') || lower.includes('who are you') ||
    lower.includes('is it safe') || lower.includes('is this safe') || lower.includes('is it real') ||
    lower.includes('is this real') || lower.includes('what proof') || lower.includes('how do you') ||
    lower.includes('does it work') || lower.includes('is it legit') || lower.includes('tell me more') ||
    lower.includes('explain')
  );

  if (isDoubt) {
    return { type: 'DOUBT', reply: doubtReply };
  }

  // Se OpenAI estiver configurada, podemos ter ainda mais precisão semântica
  if (apiKey) {
    try {
      const res = await axios.post(
        'https://api.openai.com/v1/chat/completions',
        {
          model: settings.openaiModel || 'gpt-4o-mini',
          messages: [
            {
              role: 'system',
              content: `Classify lead reply after welcome message:
- DOUBT: Customer asks how it works, who is the company, or if it is safe.
- RANDOM: Short or unrelated greeting with no phone number.`
            },
            { role: 'user', content: userMessage }
          ],
          max_tokens: 10,
          temperature: 0.1
        },
        { headers: { Authorization: `Bearer ${apiKey}` }, timeout: 4000 }
      );
      const decision = res.data.choices[0].message.content.toUpperCase();
      if (decision.includes('DOUBT')) return { type: 'DOUBT', reply: doubtReply };
    } catch (e) {}
  }

  // Padrão: resposta aleatória / confirmação sem número
  return { type: 'RANDOM', reply: reinforceReply };
}

/**
 * Classifica a mensagem do lead em qualquer etapa do funil/upsell e retorna a resposta oficial exata
 */
async function classifyAndReply(userMessage, conversationHistory = [], currentStageInfo = {}, language = 'es') {
  language = 'es';
  const lang = 'es';
  const funnel = db.getFunnel();
  const settings = db.getSettings();
  const apiKey = getOpenAiApiKey();

  const currentValue = currentStageInfo.value || (lang === 'es' ? '39' : (lang === 'pt' ? '49,90' : '49.90'));
  let paidValue = currentStageInfo.paidValue;
  if (!paidValue) {
    if (currentValue === '49,90' || currentValue === '49.90') paidValue = '0';
    else if (currentValue === '100') paidValue = (lang === 'pt' ? '49,90' : '49.90');
    else if (currentValue === '200') paidValue = '100';
    else if (currentValue === '400') paidValue = '200';
    else paidValue = '0';
  }
  const nextValue = currentStageInfo.nextValue || '100';
  const checkoutUrl = currentStageInfo.checkoutUrl || (lang === 'es' ? buildSpanishCheckoutUrl(funnel.checkoutUrlEs || funnel.checkouts?.es?.frontUrl || 'https://go.centerpag.com/PPU38CQG5EL', currentStageInfo.code || 'lead') : (funnel.checkoutUrl || 'https://pay.kirvano.com/checkout-49'));

  const formatText = (template) => {
    if (!template) return '';
    return template
      .replace(/\{paidValue\}/gi, paidValue)
      .replace(/\{currentValue\}/gi, currentValue)
      .replace(/\{nextValue\}/gi, nextValue)
      .replace(/\{checkoutUrl\}/gi, checkoutUrl)
      .replace(/\{link_pagamento\}/gi, checkoutUrl);
  };

  const objectionDictionaries = {
    pt: {
      already_paid_refuses_new: currentValue === '49,90'
        ? "Para liberar a busca inicial e o painel das conversas no sistema, é necessário concluir a ativação de R$ 49,90.\n\nQuer que eu te reenvie o link para finalizar?"
        : "O pagamento anterior de R$ {paidValue} liberou a etapa, mas para garantir o acesso completo ao sistema precisamos avançar com a etapa de R$ {currentValue}. Assim que concluir o pagamento atual pelo link que te enviei, você terá tudo liberado para acompanhar.\n\nQuer que eu reenvie o link do pagamento de R$ {currentValue} para você?",
      why_pay: "Cada etapa ativa ferramentas essenciais para liberar o acesso completo no sistema. Sem concluir o pagamento da etapa atual de R$ {currentValue} pelo link que te enviei, o painel não fica 100% liberado. Consegue finalizar pelo link e me enviar o comprovante?",
      refuse_or_random: "Tranquilo, qualquer coisa é só chamar 🙂\n\nSe quiser, pode seguir com o pagamento pelo link que já te enviaram e me enviar o comprovante aqui. Estou pronta para ajudar a Descobrir tudo!",
      denounce_or_scam: "Entendo sua decisão. Se quiser, posso te ajudar a usar melhor o sistema para aproveitar tudo que ele oferece.\n\nEnquanto isso, se mudar de ideia, é só finalizar a etapa atual de R$ {currentValue} pelo link e me enviar o comprovante para liberar seu acesso completo. Estou aqui para ajudar no que precisar.",
      what_is_tax: "O valor de R$ {currentValue} é referente à etapa necessária para liberar esse recurso do sistema.\n\nQuando você concluir o pagamento pelo link que te enviei, libera tudo para acompanhar direitinho.\n\nQuer que eu te envie o link de R$ {currentValue} para seguir agora?",
      when_get_photo_or_access: "Você já tem acesso inicial liberado pela etapa que pagou, mas o sistema libera funcionalidades completas conforme avançam as etapas.\n\nAssim que fizer o pagamento da etapa de R$ {currentValue} e me enviar o comprovante, você terá o acesso completo para acompanhar tudo no painel.\n\nQuer que eu mande o link da etapa de R$ {currentValue} para você finalizar?",
      send_link: "Segue o link para você concluir o pagamento da etapa de R$ {currentValue}:\n{checkoutUrl}\n\nAssim que finalizar, só me mandar o comprovante por aqui!",
      said_paid_no_image: "Pode me enviar o comprovante do pagamento de R$ {currentValue} por favor? Assim já verifico e te libero o próximo passo.",
      no_receipt_image: "Não recebi nenhum comprovante na imagem que você enviou. Pode mandar uma foto ou print nítido do comprovante de pagamento do valor de R$ {currentValue}? Assim consigo verificar certinho para liberar o próximo passo.",
      unclear_or_cropped: "O pagamento não está totalmente visível para confirmar se foi concluído pelo sistema.\n\nPode enviar um print ou foto mais completa da tela de detalhes da transação, mostrando o status de pagamento aprovado? Assim consigo liberar o próximo passo para você.",
      try_another_number: "Sim, com certeza você pode testar outro número! 😊 É só me enviar o novo número com DDD aqui que o sistema já faz a busca inicial e te envio a prévia agora mesmo."
    },
    es: {
      already_paid_refuses_new: "Para desbloquear la búsqueda y el acceso completo al informe de conversaciones en el sistema, solo es necesario completar la activación de $ 39.\n\n¿Quieres que te reenvíe el enlace para finalizar?",
      why_pay: "La tarifa única de activación de $ 39 cubre los servidores de desencriptación en tiempo real y garantiza 100% de confidencialidad. Sin completar el pago en el enlace que te envié, el acceso no se puede desbloquear. ¿Puedes finalizar en el enlace y enviarme el comprobante?",
      refuse_or_random: "Tranquilo, cualquier duda aquí estoy 🙂\n\nSi deseas, puedes continuar con la activación de $ 39 por el enlace enviado y mandarme el comprobante aquí. ¡Estoy lista para ayudarte a descubrir todo!",
      denounce_or_scam: "Entiendo tu postura. El sistema es 100% seguro y confidencial. Si cambias de opinión, solo completa tu activación de $ 39 mediante el enlace oficial y envíame el comprobante para habilitar tu acceso total inmediatamente. Estoy aquí para lo que necesites.",
      what_is_tax: "El monto de $ 39 corresponde a la tarifa única de activación necesaria para desbloquear el acceso completo a las conversaciones y registros.\n\nEn cuanto concluyas el pago por el enlace que te envié, se libera todo inmediatamente.\n\n¿Quieres que te envíe el enlace de $ 39 para continuar ahora?",
      when_get_photo_or_access: "En quanto hagas el pago de $ 39 y me envíes el comprobante, tendrás el acceso completo e ilimitado para ver todas las conversaciones, audios y ubicación en el panel de inmediato.\n\n¿Quieres que te mande el enlace para finalizar?",
      send_link: "Aquí tienes el enlace seguro para completar la activación por $ 39:\n{checkoutUrl}\n\n¡En cuanto finalices, solo envíame el comprobante por aquí para habilitarte el acceso!",
      said_paid_no_image: "¿Podrías enviarme el comprobante del pago de $ 39 por favor? Así lo verifico de inmediato y te libero el acceso completo.",
      no_receipt_image: "No recibí ningún comprobante en la imagen que enviaste. ¿Podrías mandar una foto o captura clara del comprobante de pago por $ 39? Así puedo verificarlo para habilitar tu acceso completo.",
      unclear_or_cropped: "El pago no está completamente visible para confirmar si fue aprobado por el sistema.\n\n¿Podrías enviar una captura más completa donde se vea el comprobante de $ 39 con estado aprobado? Así podré habilitar el acceso completo para ti.",
      try_another_number: "¡Sí, puedes probar con otro número sin ningún problema! 😊 Solo envíame el nuevo número con código de país aquí y de inmediato inicio la búsqueda para enviarte la previa."
    },
    en: {
      already_paid_refuses_new: currentValue === '49.90'
        ? "To unlock the initial search and chat panel in the system, it is necessary to complete the $ 49.90 activation.\n\nWould you like me to resend the link to finalize?"
        : "The previous payment of $ {paidValue} unlocked the stage, but to ensure full access to the system we need to proceed with the $ {currentValue} stage. As soon as you complete the current payment using the link sent, you will have everything unlocked to track.\n\nWould you like me to resend the payment link for $ {currentValue}?",
      why_pay: "Each stage activates essential tools to release full access to the system. Without completing the payment for the current stage of $ {currentValue} via the link sent, the dashboard is not 100% active. Can you finalize through the link and send me the receipt?",
      refuse_or_random: "No problem, feel free to reach out anytime 🙂\n\nIf you want, you can proceed with the payment via the link provided and send the receipt here. I'm ready to help you uncover everything!",
      denounce_or_scam: "I understand your perspective. If you want, I can guide you through the system to help you take advantage of everything it provides.\n\nIn the meantime, if you change your mind, simply complete the current $ {currentValue} stage via the link and send me the receipt to unlock your full access. I'm here to help with whatever you need.",
      what_is_tax: "The amount of $ {currentValue} refers to the required stage to unlock this system feature.\n\nOnce you complete the payment via the link provided, everything unlocks for you to review properly.\n\nWould you like me to send you the link for $ {currentValue} to continue now?",
      when_get_photo_or_access: "You already have initial access unlocked from the stage you paid, but the system releases full features as each stage completes.\n\nAs soon as you make the payment for the $ {currentValue} stage and send me the receipt, you will have full access to see everything in the dashboard.\n\nWould you like me to send the link for the $ {currentValue} stage to finalize?",
      send_link: "Here is the link for you to complete the payment for the $ {currentValue} stage:\n{checkoutUrl}\n\nAs soon as you finish, just send me the receipt right here!",
      said_paid_no_image: "Could you please send me the receipt for the $ {currentValue} payment? That way I can verify it immediately and unlock the next step for you.",
      no_receipt_image: "I didn't receive any receipt in the image you sent. Could you send a clear photo or screenshot of the payment receipt for $ {currentValue}? That way I can verify it and unlock the next step.",
      unclear_or_cropped: "The payment details are not fully visible to confirm system approval.\n\nCould you send a complete screenshot showing the approved payment status? That way I can unlock the next step for you.",
      try_another_number: "Yes, you can definitely test another number! 😊 Just send me the new number with country code here and I'll immediately start the search and send you the preview."
    }
  };

  const langDict = objectionDictionaries[lang] || objectionDictionaries.pt;
  const objectionTexts = {};
  for (const key of Object.keys(langDict)) {
    objectionTexts[key] = formatText(langDict[key]);
  }

  // 1. Se houver API key da OpenAI configurada, gera resposta humana, conversacional e persuasiva
  if (apiKey) {
    try {
      let recentHistory = (conversationHistory || []).slice(-6).map(m => ({
        role: (m.from === 'agent' || m.from === 'bot') ? 'assistant' : 'user',
        content: m.text || (m.mediaUrl ? '[Imagem enviada]' : '')
      })).filter(m => m.content && m.content !== '[Imagem enviada]');

      // Se o funil atual for em espanhol, expurga mensagens antigas em português do contexto da IA
      if (lang === 'es') {
        recentHistory = recentHistory.filter(m => !/(?:voc[eê]|n[aã]o|ol[aá]|obrigad|ajudar|rastrear|libera[cç]|relat[oó]rio)/i.test(m.content));
      }

      let systemPrompt = '';
      if (lang === 'en') {
        systemPrompt = settings.openaiSystemPromptEn || `You are the official support consultant for the confidential conversation verification system.
Your goal is to be helpful, professional, answering the customer's questions and safely guiding them to complete the payment of $ ${currentValue} via the official link to unlock the full report.

Rules:
1. NEVER say you are an AI or robot. You are a real representative on WhatsApp.
2. Answer directly and naturally in English.
3. Payment link: ${checkoutUrl}
4. Current amount: $ ${currentValue}`;
      } else {
        // SEMPRE 100% ESPANHOL OBRIGATÓRIO (OFERTA $ 39)
        systemPrompt = settings.openaiSystemPromptEs || `Eres la asesora de soporte oficial y consultora del sistema de verificación confidencial de conversaciones.
Tu objetivo es ser extremadamente humana, cordial, atenta y profesional en español.
- Si el cliente aún NO ha pagado: Resuelve sus dudas y oriéntalo con seguridad a completar el pago único de $ 39 a través del enlace oficial seguro para desbloquear el informe completo.
- Si el cliente YA PAGÓ ($39 completado): NO le pidas más dinero ni menciones otros pagos. Responde amablemente a cualquier duda que tenga sobre el acceso, indícale que revise su correo o que su panel ya se encuentra activo para consultar las conversaciones.

Contexto del cliente:
- El cliente ya envió el número de la persona que desea investigar.
- El sistema ya realizó el rastreo inicial y envió la vista previa/prueba con la foto de perfil, mapa y audio grabado.
- Los archivos completos (audios desencriptados, fotos eliminadas, mensajes de WhatsApp y ubicación en tiempo real) ya están procesados y listos en el servidor, únicamente esperando la activación del acceso.
- Enlace de pago: ${checkoutUrl}
- Monto: $ 39 (tarifa única de activación)

Reglas:
1. NUNCA digas que eres una IA o robot. Eres una asesora real respondiendo por WhatsApp en español.
2. Responde directamente a lo que el cliente preguntó de manera natural, amable y segura.
3. Si pregunta '¿Por qué tengo que pagar?': Explica que la vista previa fue gratuita para comprobar la existencia de las conversaciones, y la tarifa de $ 39 cubre los servidores de desencriptación en tiempo real y confidencialidad total (la persona nunca se entera).
4. Si dice que va a pagar ("voy a pagar", "ok", "listo"): Agradece e instruye: "¡Perfecto! Quedo a la espera. En cuanto completes el pago en el enlace oficial, envíame el comprobante aquí en el chat para habilitar tu acceso completo de inmediato 🔒".
5. Si pide el enlace o datos: Reenvía el enlace oficial ${checkoutUrl}.
6. Si dice que ya pagó: Pídele que envíe el comprobante por aquí para verificar y desbloquear el acceso.
7. Si pregunta si puede probar otro número ("¿puedo probar con otro?", "¿puedo ver a otra persona?"): Dile con entusiasmo que sí, ¡por supuesto! Solo debe enviar el nuevo número con código de país aquí y el sistema iniciará la búsqueda enviando la vista previa de inmediato.
8. Mantén respuestas cortas y fluidas (1 a 3 párrafos cortos), tal como en WhatsApp real.
9. REGLA SUPREMA DE IDIOMA: Responde SIEMPRE 100% en español. NUNCA respondas en portugués bajo ninguna circunstancia, y mantén la oferta siempre en $ 39 (dólares).`;
      }

      systemPrompt = systemPrompt
        .replace(/\{checkoutUrl\}/gi, checkoutUrl)
        .replace(/\{currentValue\}/gi, currentValue);

      const messages = [
        { role: 'system', content: systemPrompt },
        ...recentHistory,
        { role: 'user', content: userMessage }
      ];

      const response = await axios.post(
        'https://api.openai.com/v1/chat/completions',
        {
          model: settings.openaiModel || 'gpt-4o-mini',
          messages,
          max_tokens: 220,
          temperature: 0.5
        },
        {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
          },
          timeout: 8000
        }
      );

            let reply = response.data.choices[0]?.message?.content?.trim();
      if (reply) {
        const lowerReply = reply.toLowerCase();
        if (
          reply.includes('R$') ||
          reply.startsWith('Oi!') ||
          lowerReply.includes('você') ||
          lowerReply.includes('voce') ||
          lowerReply.includes('áudios descriptografados') ||
          lowerReply.includes('relatório completo') ||
          lowerReply.includes('preciso que me envie') ||
          lowerReply.includes('preciso que você me envie') ||
          lowerReply.includes('estou aqui para')
        ) {
          console.warn('[AI Service] Resposta em português barrada da OpenAI! Substituindo por resposta oficial em espanhol.');
          reply = "¡Hola! Para ayudarte con la verificación, envíame el número de WhatsApp de la persona que deseas investigar con su código de país. Estoy aquí para asistirte 🔒";
        }
        console.log('[AI Generator (OpenAI)] ' + userMessage + ' -> ' + reply.slice(0, 80) + '...');
        return reply;
      }
    } catch (err) {
      console.warn('[AI Generator Error] Falha na geração OpenAI, usando classificador local:', err.response?.data || err.message);
    }
  }

  // 2. Fallback: Classificador local de regras predefinidas
  const classification = localClassifier(userMessage, currentStageInfo, lang);

  // Mapeamento direto para as respostas oficiais do script
  if (classification.includes('WHY_PAY')) return objectionTexts.why_pay;
  if (classification.includes('ALREADY_PAID_REFUSES_NEW')) return objectionTexts.already_paid_refuses_new;
  if (classification.includes('DENOUNCE_OR_SCAM')) return objectionTexts.denounce_or_scam;
  if (classification.includes('WHAT_IS_TAX')) return objectionTexts.what_is_tax;
  if (classification.includes('WHEN_GET_PHOTO_OR_ACCESS')) return objectionTexts.when_get_photo_or_access;
  if (classification.includes('SEND_LINK')) return objectionTexts.send_link;
  if (classification.includes('SAID_PAID')) return objectionTexts.said_paid_no_image;
  if (classification.includes('TRY_ANOTHER_NUMBER')) return objectionTexts.try_another_number;

  return objectionTexts.refuse_or_random;
}

/**
 * Classificador local semântico e fonético para fallback ultra-resiliente
 */
function localClassifier(text, currentStageInfo = {}, language = 'pt') {
  const lower = (text || '').toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

  // 1. Falou de denúncia, golpe, polícia, reembolso (PT / ES / EN)
  if (
    lower.includes('golpe') || lower.includes('denuncia') || lower.includes('policia') ||
    lower.includes('reembolso') || lower.includes('estorno') || lower.includes('procon') ||
    lower.includes('ladrao') || lower.includes('crime') || lower.includes('process') ||
    lower.includes('advogado') || lower.includes('delegacia') || lower.includes('picareta') ||
    lower.includes('fraude') || lower.includes('estelionato') ||
    lower.includes('estafa') || lower.includes('estafador') || lower.includes('denunciar') ||
    lower.includes('abogado') || lower.includes('scam') || lower.includes('fraud') ||
    lower.includes('police') || lower.includes('lawyer') || lower.includes('refund')
  ) {
    return 'DENOUNCE_OR_SCAM';
  }

  // 2. Reclamação de já ter pago o anterior e questionar/recusar o novo
  if (
    (lower.includes('ja paguei') || lower.includes('paguei o') || lower.includes('ja pague') || lower.includes('ja fiz o') || lower.includes('paguei') || lower.includes('ya pague') || lower.includes('ya abone') || lower.includes('already paid') || lower.includes('i paid') || lower.includes('paid already')) &&
    (lower.includes('novo') || lower.includes('100') || lower.includes('200') || lower.includes('400') || lower.includes('49') || lower.includes('outro') || lower.includes('esse') || lower.includes('denovo') || lower.includes('de novo') || lower.includes('mais') || lower.includes('novamente') || lower.includes('otra') || lower.includes('otro') || lower.includes('new') || lower.includes('again') || lower.includes('more'))
  ) {
    return 'ALREADY_PAID_REFUSES_NEW';
  }

  // 3. Pediu o link ou pagamento
  if (
    (lower.includes('link') || lower.includes('pix') || lower.includes('pagar') || lower.includes('enlace') || lower.includes('pay') || lower.includes('checkout')) &&
    (lower.includes('manda') || lower.includes('envia') || lower.includes('cade') || lower.includes('qual') || lower.includes('passa') || lower.includes('onde') || lower.includes('donde') || lower.includes('send') || lower.includes('where'))
  ) {
    return 'SEND_LINK';
  }

  // 4. Afirmou que pagou
  if (
    lower.includes('ja paguei') || lower.includes('ta pago') || lower.includes('paguei') ||
    lower.includes('mandei o pix') || lower.includes('fiz o pix') || lower.includes('transferi') ||
    lower.includes('acabei de pagar') || lower.includes('ja fiz') || lower.includes('pix feito') ||
    lower.includes('ya pague') || lower.includes('ya transferi') || lower.includes('listo el pago') ||
    lower.includes('i already paid') || lower.includes('paid it') || lower.includes('just paid')
  ) {
    return 'SAID_PAID';
  }

  // 5. Pergunta por que tem que pagar
  if (
    (lower.includes('por que') || lower.includes('pq') || lower.includes('porque') || lower.includes('motivo') || lower.includes('pra que') || lower.includes('por que') || lower.includes('why')) &&
    (lower.includes('pagar') || lower.includes('pago') || lower.includes('cobra') || lower.includes('gratis') || lower.includes('valor') || lower.includes('preco') || lower.includes('custo') || lower.includes('dinheiro') || lower.includes('cobran') || lower.includes('pay') || lower.includes('charge') || lower.includes('fee'))
  ) {
    return 'WHY_PAY';
  }

  // 6. Pergunta do que se trata a taxa atual
  if (
    lower.includes('taxa de 100') || lower.includes('taxa de cem') || lower.includes('taxa de 200') || lower.includes('taxa de 400') || lower.includes('taxa de 49') ||
    lower.includes('que taxa') || lower.includes('do que se trata essa taxa') || lower.includes('pra que essa taxa') || lower.includes('essa taxa') ||
    lower.includes('tarifa de 100') || lower.includes('tarifa de 200') || lower.includes('tarifa de 400') || lower.includes('que tarifa') ||
    lower.includes('what fee') || lower.includes('fee of 100') || lower.includes('fee of 200') || lower.includes('fee of 400')
  ) {
    return 'WHAT_IS_TAX';
  }

  // 7. Pergunta sobre acesso, quando vai ver tudo ou receber a foto
  if (
    (lower.includes('quando') || lower.includes('cade') || lower.includes('como faco') || lower.includes('cuando') || lower.includes('when') || lower.includes('where')) &&
    (lower.includes('recebo') || lower.includes('foto') || lower.includes('acesso') || lower.includes('ver tudo') || lower.includes('mensagens') || lower.includes('painel') || lower.includes('libera') || lower.includes('conversas') || lower.includes('recibo') || lower.includes('ver todo') || lower.includes('access') || lower.includes('messages'))
  ) {
    return 'WHEN_GET_PHOTO_OR_ACCESS';
  }

  // 8. Pergunta se pode testar outro número
  if (
    lower.includes('outro numero') || lower.includes('outro contato') || lower.includes('outra pessoa') ||
    lower.includes('trocar numero') || lower.includes('mudar numero') || lower.includes('testar outro') ||
    lower.includes('tentar outro') || lower.includes('ver outro') || lower.includes('outro zap') ||
    lower.includes('otro numero') || lower.includes('otra persona') || lower.includes('another number') ||
    lower.includes('other number')
  ) {
    return 'TRY_ANOTHER_NUMBER';
  }

  return 'REFUSE_OR_RANDOM';
}

module.exports = {
  classifyAndReply,
  classifyWelcomeReply,
  localClassifier
};
