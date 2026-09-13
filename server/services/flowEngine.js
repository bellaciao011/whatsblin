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
 * Substitui variáveis dinâmicas no texto da mensagem
 */
function interpolateVariables(text, variables) {
  if (!text) return '';
  return text
    .replace(/\{primeiro_nome\}/gi, variables.firstName || 'Amigo(a)')
    .replace(/\{nome\}/gi, variables.name || 'Amigo(a)')
    .replace(/\{telefone\}/gi, variables.phone || '')
    .replace(/\{alvo\}/gi, variables.alvo || '')
    .replace(/\{checkoutUrl\}/gi, variables.checkoutUrl || 'https://pay.kirvano.com/checkout-49')
    .replace(/\{checkoutUrl100\}/gi, variables.checkoutUrl100 || 'https://pay.kirvano.com/checkout-100')
    .replace(/\{checkoutUrl200\}/gi, variables.checkoutUrl200 || 'https://pay.kirvano.com/checkout-200')
    .replace(/\{checkoutUrl400\}/gi, variables.checkoutUrl400 || 'https://pay.kirvano.com/checkout-400')
    .replace(/\{link_pagamento\}/gi, variables.checkoutUrl || 'https://pay.kirvano.com/checkout-49')
    .replace(/\{valor_atual\}/gi, variables.valor_atual || '49,90')
    .replace(/\{proximo_valor\}/gi, variables.proximo_valor || '100');
}

/**
 * Obtém os dados da etapa atual de pagamento/upsell
 */
function getCurrentStageInfo(stageKey, funnel) {
  const stages = funnel.upsellStages || {};
  const current = stages[stageKey] || stages.stage_49 || {
    value: '49,90',
    checkoutUrl: 'https://pay.kirvano.com/checkout-49',
    nextStage: 'stage_100'
  };

  const next = stages[current.nextStage] || { value: '100' };

  return {
    stage: stageKey,
    value: current.value,
    checkoutUrl: current.checkoutUrl,
    nextStage: current.nextStage,
    nextValue: next.value
  };
}

/**
 * MOTOR DE EXECUÇÃO DO GRAFO VISUAL - FUNIL OFICIAL MAVROL EMPRESARIAL
 */
async function executeFlowGraph(instance, cleanPhone, messageText, mediaAttachment = null) {
  const flows = db.getFlows();
  const activeFlow = flows.find(f => f.status === 'ativo') || flows[0];
  const funnel = db.getFunnel();
  const chats = db.getChats();

  let chatData = chats[cleanPhone];
  if (!chatData) {
    chatData = {
      leadPhone: cleanPhone,
      leadName: `Lead ${cleanPhone}`,
      instanceId: instance.id || 'inst_1',
      state: 'NOVO',
      currentNodeId: null,
      upsellStage: 'stage_49',
      variables: {},
      lastMessageTime: new Date().toISOString(),
      messages: []
    };
  }

  if (!chatData.variables) chatData.variables = {};
  if (!chatData.upsellStage) chatData.upsellStage = 'stage_49';

  chatData.variables.phone = cleanPhone;
  chatData.variables.firstName = (chatData.leadName || '').split(' ')[0] || 'Amigo(a)';
  chatData.variables.checkoutUrl100 = funnel.upsellStages?.stage_100?.checkoutUrl || 'https://pay.kirvano.com/checkout-100';
  chatData.variables.checkoutUrl200 = funnel.upsellStages?.stage_200?.checkoutUrl || 'https://pay.kirvano.com/checkout-200';
  chatData.variables.checkoutUrl400 = funnel.upsellStages?.stage_400?.checkoutUrl || 'https://pay.kirvano.com/checkout-400';

  const rawDigits = messageText.replace(/\D/g, '');
  const hasPhoneInMessage = rawDigits.length >= 10 && rawDigits.length <= 13;
  const stageInfo = getCurrentStageInfo(chatData.upsellStage, funnel);
  
  chatData.variables.checkoutUrl = stageInfo.checkoutUrl || funnel.checkoutUrl || 'https://pay.kirvano.com/checkout-49';
  chatData.variables.valor_atual = stageInfo.value;
  chatData.variables.proximo_valor = stageInfo.nextValue;

  // =========================================================================
  // CASO 1: LEAD JÁ ESTÁ NA ETAPA DE OFERTA / UPSELL (REPOSTAS, OBJEÇÕES, COMPROVANTES)
  // =========================================================================
  if (chatData.state === 'OFERTA_ENVIADA' || chatData.state === 'NEGOCIACAO') {
    // 1.1 Se o lead enviou imagem ou comprovante válido
    const isComprovanteValido = mediaAttachment || messageText.toLowerCase().includes('[comprovante_valido]') || messageText.toLowerCase().includes('comprovante aprovado');
    const isImagemInvalida = messageText.toLowerCase().includes('[print_invalido]') || messageText.toLowerCase().includes('[imagem_aleatoria]');

    if (isImagemInvalida) {
      const reply = (funnel.receiptVerification?.no_receipt_image || "Não recebi nenhum comprovante na imagem que você enviou. Pode mandar uma foto ou print nítido do comprovante de pagamento do valor de R$ {currentValue}? Assim consigo verificar certinho para liberar o próximo passo.").replace(/\{currentValue\}/g, stageInfo.value);
      
      db.addChatMessage(cleanPhone, { from: 'bot', text: reply, instanceId: instance.id });
      await metaService.sendTextMessage(instance.phoneNumberId, instance.accessToken, cleanPhone, reply);
      eventBus.emit('chat_updated', { phone: cleanPhone });
      return;
    }

    if (isComprovanteValido) {
      console.log(`[FlowEngine] ✓ Comprovante recebido para etapa: ${chatData.upsellStage}`);

      // Avança para a próxima etapa de Upsell
      if (chatData.upsellStage === 'stage_49') {
        chatData.upsellStage = 'stage_100';
        chatData.variables.checkoutUrl = funnel.upsellStages?.stage_100?.checkoutUrl || 'https://pay.kirvano.com/checkout-100';
        chatData.variables.valor_atual = '100';
        chatData.variables.proximo_valor = '200';

        const upsellText = funnel.upsellStages?.stage_100?.confirmText || "Pagamento de R$ 49,90 recebido ✅\n\nPróximo pagamento para liberar tudo: R$ 100 👇\n\n{checkoutUrl100}\n\nPode seguir e me enviar o comprovante assim que finalizar!";
        const finalText = interpolateVariables(upsellText, chatData.variables);

        db.addChatMessage(cleanPhone, { from: 'bot', text: finalText, instanceId: instance.id });
        await metaService.sendTextMessage(instance.phoneNumberId, instance.accessToken, cleanPhone, finalText);
      } else if (chatData.upsellStage === 'stage_100') {
        chatData.upsellStage = 'stage_200';
        chatData.variables.checkoutUrl = funnel.upsellStages?.stage_200?.checkoutUrl || 'https://pay.kirvano.com/checkout-200';
        chatData.variables.valor_atual = '200';
        chatData.variables.proximo_valor = '400';

        const upsellText = funnel.upsellStages?.stage_200?.confirmText || "Pagamento de R$ 100 recebido ✅\n\nPróximo pagamento para liberar tudo: R$ 200 👇\n\n{checkoutUrl200}\n\nPode seguir e me enviar o comprovante assim que finalizar!";
        const finalText = interpolateVariables(upsellText, chatData.variables);

        db.addChatMessage(cleanPhone, { from: 'bot', text: finalText, instanceId: instance.id });
        await metaService.sendTextMessage(instance.phoneNumberId, instance.accessToken, cleanPhone, finalText);
      } else if (chatData.upsellStage === 'stage_200') {
        chatData.upsellStage = 'stage_400';
        chatData.variables.checkoutUrl = funnel.upsellStages?.stage_400?.checkoutUrl || 'https://pay.kirvano.com/checkout-400';
        chatData.variables.valor_atual = '400';
        chatData.variables.proximo_valor = 'Finalizado';

        const upsellText = funnel.upsellStages?.stage_400?.confirmText || "Pagamento de R$ 200 recebido ✅\n\nPróximo pagamento para liberar tudo: R$ 400 👇\n\n{checkoutUrl400}\n\nPode seguir e me enviar o comprovante assim que finalizar!";
        const finalText = interpolateVariables(upsellText, chatData.variables);

        db.addChatMessage(cleanPhone, { from: 'bot', text: finalText, instanceId: instance.id });
        await metaService.sendTextMessage(instance.phoneNumberId, instance.accessToken, cleanPhone, finalText);
      }

      chats[cleanPhone] = chatData;
      db.saveChats(chats);
      eventBus.emit('chat_updated', { phone: cleanPhone });
      return;
    }

    // 1.2 Lead enviou mensagem de texto: aciona o cérebro GPT treinado com as 6 regras de objeção
    console.log(`[FlowEngine] Analisando objeção do lead com GPT...`);
    const aiReply = await aiService.classifyAndReply(messageText, chatData.messages, stageInfo);

    db.addChatMessage(cleanPhone, { from: 'bot', text: aiReply, instanceId: instance.id });
    await metaService.sendTextMessage(instance.phoneNumberId, instance.accessToken, cleanPhone, aiReply);
    eventBus.emit('chat_updated', { phone: cleanPhone });
    return;
  }

  // =========================================================================
  // CASO 2: LEAD ESTÁ AGUARDANDO O NÚMERO
  // =========================================================================
  if (chatData.state === 'AGUARDANDO_NUMERO') {
    const welcomeDecision = await aiService.classifyWelcomeReply(messageText);

    if (welcomeDecision.type !== 'PHONE') {
      console.log(`[FlowEngine] Resposta pós-boas-vindas classificada como: ${welcomeDecision.type}`);
      db.addChatMessage(cleanPhone, { from: 'bot', text: welcomeDecision.reply, instanceId: instance.id }, 'AGUARDANDO_NUMERO');
      await metaService.sendTextMessage(instance.phoneNumberId, instance.accessToken, cleanPhone, welcomeDecision.reply);
      eventBus.emit('chat_updated', { phone: cleanPhone });
      return;
    }

    // Lead enviou o número! Salva o alvo
    const targetPhone = rawDigits.length <= 11 ? '55' + rawDigits : rawDigits;
    chatData.variables.alvo = targetPhone;
    console.log(`[FlowEngine] ✓ Número alvo recebido: ${targetPhone}`);

    // Mensagem de análise imediata
    const analyzingMsg = funnel.analyzingMessage || "Aguarde um momento enquanto verificamos no sistema";
    db.addChatMessage(cleanPhone, { from: 'bot', text: analyzingMsg, instanceId: instance.id }, 'ANALISANDO');
    await metaService.sendTextMessage(instance.phoneNumberId, instance.accessToken, cleanPhone, analyzingMsg);
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

    // Envia a imagem de prova no WhatsApp
    db.addChatMessage(cleanPhone, {
      from: 'bot',
      mediaType: 'image',
      mediaUrl: webProofUrl,
      text: photoUrl ? '✓ Prova com foto no áudio' : '🔒 Prova com áudio protegido por criptografia',
      instanceId: instance.id
    });

    const mediaId = await metaService.uploadMedia(
      instance.phoneNumberId,
      instance.accessToken,
      imgBuffer,
      filename,
      'image/png'
    );
    await metaService.sendImageMessage(
      instance.phoneNumberId,
      instance.accessToken,
      cleanPhone,
      mediaId
    );
    eventBus.emit('chat_updated', { phone: cleanPhone });

    // Envia o link de pagamento PIX R$ 49,90 (Kirvano / PicPay)
    const offerText = funnel.upsellStages?.stage_49?.offerText || "Link para pagamento via PIX R$49,90 👇\n{checkoutUrl}\n\nDados do pagamento: 🔒 Nome: KIRVANO PAGAMENTOS LTDA 🏦 Instituição: PICPAY";
    const finalOffer = interpolateVariables(offerText, chatData.variables);

    db.addChatMessage(cleanPhone, { from: 'bot', text: finalOffer, instanceId: instance.id });
    await metaService.sendTextMessage(instance.phoneNumberId, instance.accessToken, cleanPhone, finalOffer);
    eventBus.emit('chat_updated', { phone: cleanPhone });

    // Envia a instrução de comprovante
    const proofInstruction = funnel.upsellStages?.stage_49?.proofInstruction || "Assim que pagar, me envia o comprovante por aqui para liberar o acesso completo.";
    db.addChatMessage(cleanPhone, { from: 'bot', text: proofInstruction, instanceId: instance.id }, 'OFERTA_ENVIADA');
    await metaService.sendTextMessage(instance.phoneNumberId, instance.accessToken, cleanPhone, proofInstruction);

    chatData.state = 'OFERTA_ENVIADA';
    chats[cleanPhone] = chatData;
    db.saveChats(chats);
    eventBus.emit('chat_updated', { phone: cleanPhone });
    return;
  }

  // =========================================================================
  // CASO 3: PRIMEIRO CONTATO DO LEAD (BOAS-VINDAS)
  // =========================================================================
  const welcomeText = funnel.welcomeMessage || "Olá, Salve o meu contato e envie o número da pessoa que já vou mandar a prova";
  chatData.state = 'AGUARDANDO_NUMERO';
  chats[cleanPhone] = chatData;
  db.saveChats(chats);

  db.addChatMessage(cleanPhone, { from: 'bot', text: welcomeText, instanceId: instance.id }, 'AGUARDANDO_NUMERO');
  await metaService.sendTextMessage(instance.phoneNumberId, instance.accessToken, cleanPhone, welcomeText);
  eventBus.emit('chat_updated', { phone: cleanPhone });
}

/**
 * Ponto de entrada chamado quando uma nova mensagem chega do WhatsApp (Webhook ou Simulador)
 */
async function processIncomingMessage(instanceId, leadPhone, messageText, mediaAttachment = null) {
  const instances = db.getInstances();
  const instance = instances.find(i => i.id === instanceId) || instances[0] || {};
  const cleanPhone = leadPhone.replace(/\D/g, '');

  // 1. Registra mensagem de entrada do lead no banco
  const { newMessage } = db.addChatMessage(cleanPhone, {
    from: 'lead',
    text: messageText,
    mediaUrl: mediaAttachment?.url || null,
    mediaType: mediaAttachment?.type || null,
    instanceId: instance.id || 'inst_1'
  });
  eventBus.emit('new_message', { phone: cleanPhone, message: newMessage });

  // 2. Executa o fluxo visual oficial configurado
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
