const db = require('../storage/db');
const { composeProofImage } = require('./imageComposer');
const metaService = require('./metaService');
const aiService = require('./aiService');
const EventEmitter = require('events');
const axios = require('axios');
const path = require('path');
const fs = require('fs');

const eventBus = new EventEmitter();

/**
 * Consulta a foto do perfil do número alvo via API oficial do stalkea.app
 */
async function lookupProfilePicture(targetPhone) {
  const settings = db.getSettings();
  const endpoint = settings.profileLookupService || 'https://stalkea.app/spp/api/profile-picture.php';

  if (endpoint && endpoint.startsWith('http')) {
    try {
      const url = `${endpoint}?phone=${encodeURIComponent(targetPhone)}`;
      console.log(`[Lookup API] Consultando foto de perfil: ${url}`);
      const res = await axios.get(url, {
        timeout: 7000,
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
      });

      if (res.data && res.data.urlImage) {
        console.log(`[Lookup API] ✓ Foto pública encontrada: ${res.data.urlImage}`);
        return res.data.urlImage;
      }
      console.log('[Lookup API] 🔒 Perfil sem foto pública ou privada (retornou null)');
      return null;
    } catch (err) {
      console.warn('[Lookup API] Erro na requisição de foto:', err.message);
      return null;
    }
  }

  return null;
}

/**
 * Substitui variáveis dinâmicas no texto da mensagem ou em campos de configuração
 */
function interpolateVariables(text, variables) {
  if (!text) return '';
  return text
    .replace(/\{primeiro_nome\}/gi, variables.firstName || 'Amigo(a)')
    .replace(/\{nome\}/gi, variables.name || variables.firstName || 'Amigo(a)')
    .replace(/\{telefone\}/gi, variables.phone || '')
    .replace(/\{phone_number\}/gi, variables.phone || '')
    .replace(/\{alvo\}/gi, variables.alvo || '')
    .replace(/\{email\}/gi, variables.email || 'contato@cliente.com')
    .replace(/\{comprovante\.valor\}/gi, variables.valor_atual || variables.valor_pago || '49.90')
    .replace(/\{page_id\}/gi, variables.pageId || '')
    .replace(/\{checkoutUrl\}/gi, variables.checkoutUrl || 'https://pay.kirvano.com/checkout-49')
    .replace(/\{checkoutUrl100\}/gi, variables.checkoutUrl100 || 'https://pay.kirvano.com/checkout-100')
    .replace(/\{checkoutUrl200\}/gi, variables.checkoutUrl200 || 'https://pay.kirvano.com/checkout-200')
    .replace(/\{checkoutUrl400\}/gi, variables.checkoutUrl400 || 'https://pay.kirvano.com/checkout-400')
    .replace(/\{link_pagamento\}/gi, variables.checkoutUrl || 'https://pay.kirvano.com/checkout-49')
    .replace(/\{valor_atual\}/gi, variables.valor_atual || '49,90')
    .replace(/\{proximo_valor\}/gi, variables.proximo_valor || '100')
    .replace(/\{valor_pago\}/gi, variables.valor_pago || '0');
}

/**
 * Executa nó do tipo Pixel CAPI disparando evento para a Meta
 */
async function executePixelNode(pixelNode, chatData) {
  const data = pixelNode.data || {};
  const pixels = db.getPixels();
  let pixel = pixels.find(p => p.id === data.pixelId || p.pixelId === data.pixelId);
  if (!pixel && pixels.length > 0) pixel = pixels[0];

  const eventName = data.eventType || data.eventName || 'Purchase';
  const rawVal = interpolateVariables(data.itemValue || data.value || '{valor_atual}', chatData.variables);
  const numVal = parseFloat(String(rawVal).replace(',', '.')) || 49.90;
  const pageId = interpolateVariables(data.pageId || pixel?.pageId || '', chatData.variables);
  const currency = data.currency || (chatData.flowLanguage === 'pt' ? 'BRL' : 'USD');

  console.log(`[FlowEngine] 🎯 Disparando nó de Pixel: ${eventName} (Valor: ${numVal} ${currency})`);

  if (pixel) {
    return await metaService.sendPixelConversion(
      pixel.pixelId,
      pixel.accessToken,
      eventName,
      chatData.leadPhone,
      {
        value: numVal,
        currency,
        pageId,
        pixelName: pixel.name,
        testEventCode: pixel.testEventCode
      }
    );
  } else {
    console.warn('[FlowEngine] Nenhum pixel cadastrado para disparar nó.');
    return { success: false, error: 'Nenhum pixel cadastrado' };
  }
}

/**
 * Executa nó do tipo Integração (Webhook / HTTP Request)
 */
async function executeIntegrationNode(integrationNode, chatData) {
  const data = integrationNode.data || {};
  const method = (data.method || 'GET').toUpperCase();
  const rawUrl = interpolateVariables(data.url || data.endpoint || '', chatData.variables);
  if (!rawUrl || !rawUrl.startsWith('http')) return { success: false, error: 'URL inválida' };

  let headers = { 'User-Agent': 'WhatsHub-Bot/1.0' };
  if (data.headers) {
    try {
      const parsed = typeof data.headers === 'string' ? JSON.parse(interpolateVariables(data.headers, chatData.variables)) : data.headers;
      headers = { ...headers, ...parsed };
    } catch (e) {}
  }

  let body = null;
  if (method !== 'GET' && data.body) {
    try {
      body = typeof data.body === 'string' ? JSON.parse(interpolateVariables(data.body, chatData.variables)) : data.body;
    } catch (e) {
      body = interpolateVariables(data.body, chatData.variables);
    }
  }

  console.log(`[FlowEngine] 🌐 Executando nó de Integração: ${method} ${rawUrl}`);

  try {
    const res = await axios({
      method,
      url: rawUrl,
      headers,
      data: body,
      timeout: 8000
    });
    return { success: true, status: res.status, data: res.data };
  } catch (err) {
    console.warn('[FlowEngine] Falha na integração externa:', err.message);
    return { success: false, status: err.response?.status || 500, error: err.message };
  }
}

/**
 * Obtém os dados da etapa atual de pagamento/upsell com formatação de moeda correta
 */
function getCurrentStageInfo(stageKey, funnel, language = 'pt') {
  const isPt = (language || 'pt').toLowerCase() === 'pt';
  const default49 = isPt ? '49,90' : '49.90';
  const stages = funnel.upsellStages || {};
  const current = stages[stageKey] || stages.stage_49 || {
    value: default49,
    checkoutUrl: 'https://pay.kirvano.com/checkout-49',
    nextStage: 'stage_100'
  };

  const next = stages[current.nextStage] || { value: '100' };

  let paidValue = '0';
  if (stageKey === 'stage_49') paidValue = '0';
  else if (stageKey === 'stage_100') paidValue = default49;
  else if (stageKey === 'stage_200') paidValue = '100';
  else if (stageKey === 'stage_400') paidValue = '200';

  return {
    stage: stageKey,
    value: current.value || default49,
    checkoutUrl: current.checkoutUrl,
    nextStage: current.nextStage,
    nextValue: next.value || '100',
    paidValue: paidValue
  };
}

/**
 * MOTOR DE EXECUÇÃO DO GRAFO VISUAL - MULTILÍNGUE COM VINCULAÇÃO ESTRITA DE CHIP
 */
async function executeFlowGraph(instance, cleanPhone, messageText, mediaAttachment = null) {
  const instances = db.getInstances();
  const inst = instances.find(i => i.id === instance?.id || i.phoneNumberId === instance?.phoneNumberId) || instance || instances[0] || { id: 'inst_1' };
  
  // 1. Vinculação Estrita: localiza o fluxo configurado para ESTE chip específico
  const targetFlowId = inst.assignedFlowId || 'fluxo-espiao-foto';
  const flows = db.getFlows();
  const activeFlow = flows.find(f => f.id === targetFlowId) || flows.find(f => f.status === 'ativo') || flows[0];
  const flowLanguage = activeFlow?.language || (activeFlow?.id?.includes('-es') ? 'es' : (activeFlow?.id?.includes('-en') ? 'en' : 'pt'));

  console.log(`[FlowEngine] 🚀 Executando fluxo: "${activeFlow?.name}" (${activeFlow?.id}, lang: ${flowLanguage}) para Chip: "${inst.name || inst.id}"`);

  const funnel = db.getFunnel();
  const chats = db.getChats();

  let chatData = chats[cleanPhone];
  if (!chatData) {
    chatData = {
      leadPhone: cleanPhone,
      leadName: `Lead ${cleanPhone}`,
      instanceId: inst.id || 'inst_1',
      assignedFlowId: activeFlow.id,
      flowLanguage: flowLanguage,
      state: 'NOVO',
      currentNodeId: null,
      upsellStage: 'stage_49',
      variables: {},
      lastMessageTime: new Date().toISOString(),
      messages: []
    };
  }

  // Atualiza sempre a vinculação de instância e fluxo
  chatData.instanceId = inst.id || chatData.instanceId || 'inst_1';
  chatData.assignedFlowId = activeFlow.id;
  chatData.flowLanguage = flowLanguage;

  if (!chatData.variables) chatData.variables = {};
  if (!chatData.upsellStage) chatData.upsellStage = 'stage_49';

  chatData.variables.phone = cleanPhone;
  chatData.variables.firstName = (chatData.leadName || '').split(' ')[0] || 'Amigo(a)';
  chatData.variables.checkoutUrl100 = funnel.upsellStages?.stage_100?.checkoutUrl || 'https://pay.kirvano.com/checkout-100';
  chatData.variables.checkoutUrl200 = funnel.upsellStages?.stage_200?.checkoutUrl || 'https://pay.kirvano.com/checkout-200';
  chatData.variables.checkoutUrl400 = funnel.upsellStages?.stage_400?.checkoutUrl || 'https://pay.kirvano.com/checkout-400';

  const rawDigits = (messageText || '').replace(/\D/g, '');
  const stageInfo = getCurrentStageInfo(chatData.upsellStage, funnel, flowLanguage);
  
  chatData.variables.checkoutUrl = stageInfo.checkoutUrl || funnel.checkoutUrl || 'https://pay.kirvano.com/checkout-49';
  chatData.variables.valor_atual = stageInfo.value;
  chatData.variables.valor_pago = stageInfo.paidValue;
  chatData.variables.proximo_valor = stageInfo.nextValue;

  // Helper para obter o texto configurado no nó visual do fluxo ativo
  const getNodeText = (nodeId, fallback) => {
    const node = activeFlow?.nodes?.find(n => n.id === nodeId);
    return node?.data?.text || fallback;
  };

  // =========================================================================
  // CASO 1: LEAD JÁ ESTÁ NA ETAPA DE OFERTA / UPSELL (REPOSTAS, OBJEÇÕES, COMPROVANTES)
  // =========================================================================
  if (chatData.state === 'OFERTA_ENVIADA' || chatData.state === 'NEGOCIACAO') {
    // 1.1 Se o lead enviou imagem ou comprovante válido
    const isComprovanteValido = mediaAttachment || messageText.toLowerCase().includes('[comprovante_valido]') || messageText.toLowerCase().includes('comprovante aprovado') || messageText.toLowerCase().includes('comprobante aprobado') || messageText.toLowerCase().includes('receipt approved');
    const isImagemInvalida = messageText.toLowerCase().includes('[print_invalido]') || messageText.toLowerCase().includes('[imagem_aleatoria]');

    if (isImagemInvalida) {
      let defaultNoReceipt = "Não recebi nenhum comprovante na imagem que você enviou. Pode mandar uma foto ou print nítido do comprovante de pagamento do valor de R$ {currentValue}? Assim consigo verificar certinho para liberar o próximo passo.";
      if (flowLanguage === 'es') {
        defaultNoReceipt = "No recibí ningún comprobante en la imagen que enviaste. ¿Podrías mandar una foto o captura clara del comprobante de pago por $ {currentValue}? Así puedo verificarlo para habilitar el siguiente paso.";
      } else if (flowLanguage === 'en') {
        defaultNoReceipt = "I didn't receive any receipt in the image you sent. Could you send a clear photo or screenshot of the payment receipt for $ {currentValue}? That way I can verify it and unlock the next step.";
      }

      const reply = defaultNoReceipt.replace(/\{currentValue\}/g, stageInfo.value);
      
      db.addChatMessage(cleanPhone, { from: 'bot', text: reply, instanceId: inst.id });
      if (inst.phoneNumberId && inst.accessToken) {
        await metaService.sendTextMessage(inst.phoneNumberId, inst.accessToken, cleanPhone, reply);
      }
      eventBus.emit('chat_updated', { phone: cleanPhone });
      return;
    }

    if (isComprovanteValido) {
      console.log(`[FlowEngine] ✓ Comprovante recebido para etapa: ${chatData.upsellStage} (Lang: ${flowLanguage})`);

      // Avança para a próxima etapa de Upsell
      if (chatData.upsellStage === 'stage_49') {
        chatData.upsellStage = 'stage_100';
        chatData.variables.checkoutUrl = funnel.upsellStages?.stage_100?.checkoutUrl || 'https://pay.kirvano.com/checkout-100';
        chatData.variables.valor_atual = '100';
        chatData.variables.valor_pago = flowLanguage === 'pt' ? '49,90' : '49.90';
        chatData.variables.proximo_valor = '200';

        const fallback100 = flowLanguage === 'es'
          ? "Pago de $49.90 recibido ✅\n\nSiguiente pago para desbloquear todo: $100 👇\n\n{checkoutUrl100}\n\n¡Puedes continuar y enviarme el comprobante en cuanto termines!"
          : (flowLanguage === 'en'
            ? "Payment of $49.90 received ✅\n\nNext payment to unlock everything: $100 👇\n\n{checkoutUrl100}\n\nPlease proceed and send me the receipt as soon as it's completed!"
            : "Pagamento de R$ 49,90 recebido ✅\n\nPróximo pagamento para liberar tudo: R$ 100 👇\n\n{checkoutUrl100}\n\nPode seguir e me enviar o comprovante assim que finalizar!");

        const upsellText = getNodeText('node-upsell-100', fallback100);
        const finalText = interpolateVariables(upsellText, chatData.variables);

        db.addChatMessage(cleanPhone, { from: 'bot', text: finalText, instanceId: inst.id });
        if (inst.phoneNumberId && inst.accessToken) {
          await metaService.sendTextMessage(inst.phoneNumberId, inst.accessToken, cleanPhone, finalText);
        }
      } else if (chatData.upsellStage === 'stage_100') {
        chatData.upsellStage = 'stage_200';
        chatData.variables.checkoutUrl = funnel.upsellStages?.stage_200?.checkoutUrl || 'https://pay.kirvano.com/checkout-200';
        chatData.variables.valor_atual = '200';
        chatData.variables.valor_pago = '100';
        chatData.variables.proximo_valor = '400';

        const fallback200 = flowLanguage === 'es'
          ? "Pago de $100 recibido ✅\n\nSiguiente pago para desbloquear todo: $200 👇\n\n{checkoutUrl200}\n\n¡Puedes continuar y enviarme el comprobante en cuanto termines!"
          : (flowLanguage === 'en'
            ? "Payment of $100 received ✅\n\nNext payment to unlock everything: $200 👇\n\n{checkoutUrl200}\n\nPlease proceed and send me the receipt as soon as it's completed!"
            : "Pagamento de R$ 100 recebido ✅\n\nPróximo pagamento para liberar tudo: R$ 200 👇\n\n{checkoutUrl200}\n\nPode seguir e me enviar o comprovante assim que finalizar!");

        const upsellText = getNodeText('node-upsell-200', fallback200);
        const finalText = interpolateVariables(upsellText, chatData.variables);

        db.addChatMessage(cleanPhone, { from: 'bot', text: finalText, instanceId: inst.id });
        if (inst.phoneNumberId && inst.accessToken) {
          await metaService.sendTextMessage(inst.phoneNumberId, inst.accessToken, cleanPhone, finalText);
        }
      } else if (chatData.upsellStage === 'stage_200') {
        chatData.upsellStage = 'stage_400';
        chatData.variables.checkoutUrl = funnel.upsellStages?.stage_400?.checkoutUrl || 'https://pay.kirvano.com/checkout-400';
        chatData.variables.valor_atual = '400';
        chatData.variables.valor_pago = '200';
        chatData.variables.proximo_valor = 'Finalizado';

        const fallback400 = flowLanguage === 'es'
          ? "Pago de $200 recibido ✅\n\nSiguiente pago para desbloquear todo: $400 👇\n\n{checkoutUrl400}\n\n¡Puedes continuar y enviarme el comprobante en cuanto termines!"
          : (flowLanguage === 'en'
            ? "Payment of $200 received ✅\n\nNext payment to unlock everything: $400 👇\n\n{checkoutUrl400}\n\nPlease proceed and send me the receipt as soon as it's completed!"
            : "Pagamento de R$ 200 recebido ✅\n\nPróximo pagamento para liberar tudo: R$ 400 👇\n\n{checkoutUrl400}\n\nPode seguir e me enviar o comprovante assim que finalizar!");

        const upsellText = getNodeText('node-upsell-400', fallback400);
        const finalText = interpolateVariables(upsellText, chatData.variables);

        db.addChatMessage(cleanPhone, { from: 'bot', text: finalText, instanceId: inst.id });
        if (inst.phoneNumberId && inst.accessToken) {
          await metaService.sendTextMessage(inst.phoneNumberId, inst.accessToken, cleanPhone, finalText);
        }
      } else if (chatData.upsellStage === 'stage_400') {
        chatData.upsellStage = 'stage_finalizado';
        chatData.state = 'FINALIZADO';
        
        const fallbackMaster = flowLanguage === 'es'
          ? "Pago de $400 recibido con éxito ✅\n\n¡Tu acceso completo e ilimitado al panel ha sido desbloqueado! Accede a tu panel y aprovecha todas las herramientas."
          : (flowLanguage === 'en'
            ? "Payment of $400 successfully received ✅\n\nYour complete and unrestricted dashboard access has been unlocked! Log into your dashboard and enjoy all tools."
            : "Pagamento de R$ 400 recebido com sucesso ✅\n\nSeu acesso completo e irrestrito ao painel foi liberado! Acesse seu painel e aproveite todas as ferramentas.");

        const finalText = getNodeText('node-access-released', fallbackMaster);
        db.addChatMessage(cleanPhone, { from: 'bot', text: finalText, instanceId: inst.id });
        if (inst.phoneNumberId && inst.accessToken) {
          await metaService.sendTextMessage(inst.phoneNumberId, inst.accessToken, cleanPhone, finalText);
        }
      }

      const currentChats = db.getChats();
      currentChats[cleanPhone] = {
        ...currentChats[cleanPhone],
        upsellStage: chatData.upsellStage,
        state: chatData.state,
        variables: chatData.variables,
        instanceId: inst.id,
        assignedFlowId: activeFlow.id,
        flowLanguage: flowLanguage
      };
      db.saveChats(currentChats);
      eventBus.emit('chat_updated', { phone: cleanPhone });
      return;
    }

    // 1.2 Lead enviou mensagem de texto: aciona o classificador inteligente no idioma do fluxo
    console.log(`[FlowEngine] Analisando objeção do lead com IA (Lang: ${flowLanguage})...`);
    const aiReply = await aiService.classifyAndReply(messageText, chatData.messages, stageInfo, flowLanguage);

    db.addChatMessage(cleanPhone, { from: 'bot', text: aiReply, instanceId: inst.id });
    if (inst.phoneNumberId && inst.accessToken) {
      await metaService.sendTextMessage(inst.phoneNumberId, inst.accessToken, cleanPhone, aiReply);
    }
    eventBus.emit('chat_updated', { phone: cleanPhone });
    return;
  }

  // =========================================================================
  // CASO 2: LEAD ESTÁ AGUARDANDO O NÚMERO
  // =========================================================================
  if (chatData.state === 'AGUARDANDO_NUMERO') {
    const welcomeDecision = await aiService.classifyWelcomeReply(messageText, flowLanguage);

    if (welcomeDecision.type !== 'PHONE') {
      console.log(`[FlowEngine] Resposta pós-boas-vindas classificada como: ${welcomeDecision.type}`);
      db.addChatMessage(cleanPhone, { from: 'bot', text: welcomeDecision.reply, instanceId: inst.id }, 'AGUARDANDO_NUMERO');
      if (inst.phoneNumberId && inst.accessToken) {
        await metaService.sendTextMessage(inst.phoneNumberId, inst.accessToken, cleanPhone, welcomeDecision.reply);
      }
      eventBus.emit('chat_updated', { phone: cleanPhone });
      return;
    }

    // Lead enviou o número! Salva o alvo
    const targetPhone = rawDigits.length <= 11 && flowLanguage === 'pt' ? '55' + rawDigits : rawDigits;
    chatData.variables.alvo = targetPhone;
    console.log(`[FlowEngine] ✓ Número alvo recebido: ${targetPhone}`);

    // Mensagem de análise imediata
    const fallbackAnalyzing = flowLanguage === 'es'
      ? "Espera un momento mientras verificamos en el sistema..."
      : (flowLanguage === 'en'
        ? "Please wait a moment while we check the system..."
        : "Aguarde um momento enquanto verificamos no sistema");

    const analyzingMsg = getNodeText('node-analyzing-msg', fallbackAnalyzing);
    db.addChatMessage(cleanPhone, { from: 'bot', text: analyzingMsg, instanceId: inst.id }, 'ANALISANDO');
    if (inst.phoneNumberId && inst.accessToken) {
      await metaService.sendTextMessage(inst.phoneNumberId, inst.accessToken, cleanPhone, analyzingMsg);
    }
    eventBus.emit('chat_updated', { phone: cleanPhone });

    // Delay inteligente de 3 segundos
    const delaySec = funnel.analyzingDelaySeconds || 3;
    await new Promise(r => setTimeout(r, delaySec * 1000));

    // Consulta foto na API stalkea.app
    const photoUrl = await lookupProfilePicture(targetPhone);
    chatData.variables.photoUrl = photoUrl;

    // Monta a foto personalizada (Template 1 com foto ou Template 2 com cadeado)
    const imgBuffer = await composeProofImage(photoUrl, funnel.avatarCoordinates);
    const proofsDir = path.join(__dirname, '../../public/generated');
    fs.mkdirSync(proofsDir, { recursive: true });
    const filename = `proof_${cleanPhone}_${Date.now()}.png`;
    fs.writeFileSync(path.join(proofsDir, filename), imgBuffer);
    const webProofUrl = `/generated/${filename}`;

    const proofCaption = photoUrl
      ? (flowLanguage === 'es' ? '✓ Prueba con foto en el audio' : (flowLanguage === 'en' ? '✓ Proof with profile photo on audio' : '✓ Prova com foto no áudio'))
      : (flowLanguage === 'es' ? '🔒 Prueba con audio protegido por encriptación' : (flowLanguage === 'en' ? '🔒 Proof with encrypted audio' : '🔒 Prova com áudio protegido por criptografia'));

    // Envia a imagem de prova no WhatsApp
    db.addChatMessage(cleanPhone, {
      from: 'bot',
      mediaType: 'image',
      mediaUrl: webProofUrl,
      text: proofCaption,
      instanceId: inst.id
    });

    if (inst.phoneNumberId && inst.accessToken) {
      const mediaId = await metaService.uploadMedia(
        inst.phoneNumberId,
        inst.accessToken,
        imgBuffer,
        filename,
        'image/png'
      );
      await metaService.sendImageMessage(
        inst.phoneNumberId,
        inst.accessToken,
        cleanPhone,
        mediaId
      );
    }
    eventBus.emit('chat_updated', { phone: cleanPhone });

    // Envia o link de pagamento da oferta inicial (Kirvano / Checkout Seguro)
    const fallbackOffer = flowLanguage === 'es'
      ? "Enlace para el pago de $49.90 👇\n{checkoutUrl}\n\nDatos del pago: 🔒 Pago 100% seguro y encriptado."
      : (flowLanguage === 'en'
        ? "Payment link for $49.90 👇\n{checkoutUrl}\n\nPayment info: 🔒 100% Secure & Encrypted Checkout"
        : "Link para pagamento via PIX R$49,90 👇\n{checkoutUrl}\n\nDados do pagamento: 🔒 Nome: KIRVANO PAGAMENTOS LTDA 🏦 Instituição: PICPAY");

    const offerText = getNodeText('node-offer-pix-49', fallbackOffer);
    const finalOffer = interpolateVariables(offerText, chatData.variables);

    db.addChatMessage(cleanPhone, { from: 'bot', text: finalOffer, instanceId: inst.id });
    if (inst.phoneNumberId && inst.accessToken) {
      await metaService.sendTextMessage(inst.phoneNumberId, inst.accessToken, cleanPhone, finalOffer);
    }
    eventBus.emit('chat_updated', { phone: cleanPhone });

    // Envia a instrução de comprovante
    const fallbackProofInstruction = flowLanguage === 'es'
      ? "¡En cuanto pagues, envíame el comprobante por aquí para desbloquear el acceso completo!"
      : (flowLanguage === 'en'
        ? "As soon as you pay, send me the receipt here to unlock full access!"
        : "Assim que pagar, me envia o comprovante por aqui para liberar o acesso completo.");

    const proofInstruction = getNodeText('node-msg-comprovante', fallbackProofInstruction);
    db.addChatMessage(cleanPhone, { from: 'bot', text: proofInstruction, instanceId: inst.id }, 'OFERTA_ENVIADA');
    if (inst.phoneNumberId && inst.accessToken) {
      await metaService.sendTextMessage(inst.phoneNumberId, inst.accessToken, cleanPhone, proofInstruction);
    }

    chatData.state = 'OFERTA_ENVIADA';
    chats[cleanPhone] = chatData;
    db.saveChats(chats);
    eventBus.emit('chat_updated', { phone: cleanPhone });
    return;
  }

  // =========================================================================
  // CASO 3: PRIMEIRO CONTATO DO LEAD (BOAS-VINDAS)
  // =========================================================================
  const fallbackWelcome = flowLanguage === 'es'
    ? "¡Hola! Guarda mi contacto y envíame el número de la persona que ya te mando la prueba."
    : (flowLanguage === 'en'
      ? "Hello! Save my contact and send the person's phone number and I'll send you the proof right away."
      : "Olá, Salve o meu contato e envie o número da pessoa que já vou mandar a prova");

  const welcomeText = getNodeText('node-welcome', fallbackWelcome);
  chatData.state = 'AGUARDANDO_NUMERO';
  chats[cleanPhone] = chatData;
  db.saveChats(chats);

  db.addChatMessage(cleanPhone, { from: 'bot', text: welcomeText, instanceId: inst.id }, 'AGUARDANDO_NUMERO');
  if (inst.phoneNumberId && inst.accessToken) {
    await metaService.sendTextMessage(inst.phoneNumberId, inst.accessToken, cleanPhone, welcomeText);
  }
  eventBus.emit('chat_updated', { phone: cleanPhone });
}

/**
 * Ponto de entrada chamado quando uma nova mensagem chega do WhatsApp (Webhook ou Simulador)
 */
async function processIncomingMessage(instanceId, leadPhone, messageText, mediaAttachment = null) {
  const instances = db.getInstances();
  const instance = instances.find(i => i.id === instanceId) || instances[0] || { id: instanceId || 'inst_1' };
  const cleanPhone = leadPhone.replace(/\D/g, '');

  // 1. Registra mensagem de entrada do lead no banco com a instância correta
  const { newMessage } = db.addChatMessage(cleanPhone, {
    from: 'lead',
    text: messageText,
    mediaUrl: mediaAttachment?.url || null,
    mediaType: mediaAttachment?.type || null,
    instanceId: instance.id || 'inst_1'
  });
  eventBus.emit('new_message', { phone: cleanPhone, message: newMessage });

  // 2. Executa o fluxo visual oficial configurado especificamente para este chip
  try {
    await executeFlowGraph(instance, cleanPhone, messageText, mediaAttachment);
  } catch (err) {
    console.error('[FlowEngine] Erro ao processar mensagem no fluxo:', err);
  }
}

module.exports = {
  processIncomingMessage,
  lookupProfilePicture,
  executeFlowGraph,
  eventBus
};
