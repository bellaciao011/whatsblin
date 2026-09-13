const axios = require('axios');
const db = require('../storage/db');

/**
 * Classifica a resposta do lead logo após a mensagem de Boas-Vindas
 */
async function classifyWelcomeReply(userMessage) {
  const settings = db.getSettings();
  const apiKey = settings.openaiApiKey;
  const funnel = db.getFunnel();

  const doubtReply = "Nosso sistema localiza mensagens, áudios apagados e registros nos servidores pelo número de telefone. É 100% sigiloso e a pessoa não fica sabendo.\n\nPara eu gerar a prévia e te mandar a prova, só me envie o número dela com DDD aqui.";
  const reinforceReply = funnel.reinforceNumberMessage || "Assim que enviar o número já ativo aqui 👍\n\nPreciso do WhatsApp da pessoa:\nDDD+9+número (ex: 11912345678)\n\nManda rápido.";

  const rawDigits = (userMessage || '').replace(/\D/g, '');
  if (rawDigits.length >= 10 && rawDigits.length <= 13) {
    return { type: 'PHONE', targetPhone: rawDigits };
  }

  const lower = (userMessage || '').toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

  // Detecta se é dúvida sobre como funciona o serviço
  const isDoubt = (
    lower.includes('como funciona') || lower.includes('o que e') || lower.includes('quem e') ||
    lower.includes('e seguro') || lower.includes('e confiavel') || lower.includes('como assim') ||
    lower.includes('que prova') || lower.includes('como voce') || lower.includes('quem e voce') ||
    lower.includes('como acha') || lower.includes('explica') || lower.includes('me explica') ||
    lower.includes('funciona mesmo') || lower.includes('da certo')
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
              content: `Classifique a resposta do lead após o primeiro contato:
- DOUBT: O cliente tem dúvidas sobre como o serviço funciona, quem é a empresa ou se é confiável.
- RANDOM: Mensagem curta ou aleatória que não tem número (ex: "Salvei", "Ok", "Tá", "Beleza").`
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
async function classifyAndReply(userMessage, conversationHistory = [], currentStageInfo = {}) {
  const funnel = db.getFunnel();
  const settings = db.getSettings();
  const apiKey = settings.openaiApiKey;

  const currentValue = currentStageInfo.value || '49,90';
  const nextValue = currentStageInfo.nextValue || '100';

  // Regras e textos oficiais da Mavrol Empresarial
  const objectionTexts = {
    why_pay: funnel.objections?.why_pay || "Cada etapa ativa ferramentas essenciais para liberar o acesso completo no sistema. Sem concluir o pagamento da etapa atual pelo link que te enviei, o painel não fica 100% liberado. Consegue finalizar pelo link e me enviar o comprovante?",
    
    refuse_or_random: funnel.objections?.refuse_or_random || "Tranquilo, qualquer coisa é só chamar 🙂 \n\nSe quiser, pode seguir com o pagamento pelo link que já te enviaram e me enviar o comprovante aqui. Estou pronta para ajudar a Descobrir tudo!",
    
    already_paid_refuses_new: (funnel.objections?.already_paid_refuses_new || "O pagamento de R$ 49,90 libera a etapa inicial, mas para garantir o acesso completo ao sistema precisamos avançar com a próxima etapa. Assim que concluir o pagamento atual pelo link que te enviei, você terá tudo liberado para acompanhar.\n\nQuer que eu reenvie o link do pagamento de R$ {nextValue} para você?").replace(/\{nextValue\}/g, nextValue),
    
    denounce_or_scam: funnel.objections?.denounce_or_scam || "Entendo sua decisão. Se quiser, posso te ajudar a usar melhor o sistema para aproveitar tudo que ele oferece.\n\nEnquanto isso, se mudar de ideia, é só finalizar a etapa atual pelo link e me enviar o comprovante para liberar seu acesso completo. Estou aqui para ajudar no que precisar.",
    
    what_is_tax: (funnel.objections?.what_is_tax || "O valor atual é referente à etapa necessária para liberar esse recurso do sistema.\n\nQuando você concluir o pagamento pelo link que te enviei, libera tudo para acompanhar direitinho.\n\nQuer que eu te envie o link para seguir agora?"),
    
    when_get_photo_or_access: funnel.objections?.when_get_photo_or_access || "Você já tem acesso inicial liberado pela etapa que pagou, mas o sistema libera funcionalidades completas conforme avançam as etapas.\n\nAssim que fizer o pagamento da etapa atual e me enviar o comprovante, você terá o acesso completo para acompanhar tudo no painel.\n\nQuer que eu mande o link da etapa atual para você finalizar?",

    said_paid_no_image: (funnel.receiptVerification?.said_paid_no_image || "Pode me enviar o comprovante do pagamento de R$ {currentValue} por favor? Assim já verifico e te libero o próximo passo.").replace(/\{currentValue\}/g, currentValue),

    no_receipt_image: (funnel.receiptVerification?.no_receipt_image || "Não recebi nenhum comprovante na imagem que você enviou. Pode mandar uma foto ou print nítido do comprovante de pagamento do valor de R$ {currentValue}? Assim consigo verificar certinho para liberar o próximo passo.").replace(/\{currentValue\}/g, currentValue),

    unclear_or_cropped: funnel.receiptVerification?.unclear_or_cropped || "O pagamento não está totalmente visível para confirmar se foi concluído pelo sistema.\n\nPode enviar um print ou foto mais completa da tela de detalhes da transação, mostrando o status de pagamento aprovado? Assim consigo liberar o próximo passo para você."
  };

  let classification = null;

  // 1. Classificação semântica profunda via OpenAI ChatGPT
  if (apiKey) {
    try {
      const response = await axios.post(
        'https://api.openai.com/v1/chat/completions',
        {
          model: settings.openaiModel || 'gpt-4o-mini',
          messages: [
            {
              role: 'system',
              content: `Você é a inteligência oficial de suporte da Mavrol Empresarial Ltda no WhatsApp.
O lead está na etapa de pagamento de R$ ${currentValue} (próxima etapa: R$ ${nextValue}).
Analise a mensagem do cliente, independentemente de gírias, erros de digitação ou variações linguísticas, e classifique com precisão em UMA das opções:

- WHY_PAY: O cliente pergunta por que tem que pagar, por que é pago ou por que cobra (ex: "Pq tenho q pagar?", "Pq cobram?", "Nao era gratis?", "Tem que pagar?", "Qual o motivo da cobranca?").
- ALREADY_PAID_REFUSES_NEW: O cliente reclama que já pagou o valor anterior (R$ 49,90 ou etapa passada) e que não vai pagar o novo valor de R$ ${nextValue} (ex: "Ja paguei o de 49", "Ja paguei e tao cobrando de novo", "Nao vou pagar mais 100", "Ja paguei o anterior").
- DENOUNCE_OR_SCAM: O cliente ameaça denúncia, chama de golpe, fraude, fala em polícia, procon, advogado, estorno ou processo (ex: "Golpistas", "Vou denunciar", "Quero meu estorno", "Vou chamar a policia", "Isso e fraude", "Procon").
- WHAT_IS_TAX: O cliente pergunta do que se trata a taxa atual ou para que serve (ex: "Que taxa de ${nextValue} e essa?", "Do que se trata esse valor?", "Para que serve essa taxa?").
- WHEN_GET_PHOTO_OR_ACCESS: O cliente pergunta quando vai ver as mensagens, fotos, conversas ou ter o painel liberado (ex: "Quando recebo?", "Cade o acesso?", "Onde vejo?", "Quando libera tudo?").
- SAID_PAID: O cliente afirma por texto que já pagou ou transferiu, mas sem anexar imagem (ex: "Ja paguei", "Ta pago", "Fiz o pix", "Mandei o dinheiro", "Acabei de pagar").
- REFUSE_OR_RANDOM: O cliente se recusa a pagar, desiste, manda frase curta ou fala algo aleatório (ex: "Nao vou pagar", "Deixa quieto", "Nem a pau", "Valeu", "Falou", qualquer frase solta).`
            },
            { role: 'user', content: userMessage }
          ],
          max_tokens: 20,
          temperature: 0.1
        },
        {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
          },
          timeout: 6000
        }
      );

      classification = response.data.choices[0].message.content.trim().toUpperCase();
      console.log(`[AI Classifier (OpenAI)] Mensagem "${userMessage}" classificada como: ${classification}`);
    } catch (err) {
      console.warn('[AI Classifier Error] Usando classificador local de regras:', err.message);
      classification = localClassifier(userMessage);
    }
  } else {
    classification = localClassifier(userMessage);
  }

  // Mapeamento direto para as respostas oficiais do script
  if (classification.includes('WHY_PAY')) return objectionTexts.why_pay;
  if (classification.includes('ALREADY_PAID_REFUSES_NEW')) return objectionTexts.already_paid_refuses_new;
  if (classification.includes('DENOUNCE_OR_SCAM')) return objectionTexts.denounce_or_scam;
  if (classification.includes('WHAT_IS_TAX')) return objectionTexts.what_is_tax;
  if (classification.includes('WHEN_GET_PHOTO_OR_ACCESS')) return objectionTexts.when_get_photo_or_access;
  if (classification.includes('SAID_PAID')) return objectionTexts.said_paid_no_image;

  return objectionTexts.refuse_or_random;
}

/**
 * Classificador local semântico e fonético para fallback ultra-resiliente
 */
function localClassifier(text) {
  const lower = (text || '').toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

  // 1. Falou de denúncia, golpe, polícia, reembolso
  if (
    lower.includes('golpe') || lower.includes('denuncia') || lower.includes('policia') ||
    lower.includes('reembolso') || lower.includes('estorno') || lower.includes('procon') ||
    lower.includes('ladrao') || lower.includes('crime') || lower.includes('process') ||
    lower.includes('advogado') || lower.includes('delegacia')
  ) {
    return 'DENOUNCE_OR_SCAM';
  }

  // 2. Reclamação de já ter pago o anterior e recusar o novo
  if (
    (lower.includes('ja paguei') || lower.includes('paguei o')) &&
    (lower.includes('novo') || lower.includes('100') || lower.includes('200') || lower.includes('400') || lower.includes('outro') || lower.includes('esse') || lower.includes('denovo') || lower.includes('de novo'))
  ) {
    return 'ALREADY_PAID_REFUSES_NEW';
  }

  // 3. Afirmou que pagou
  if (
    lower.includes('ja paguei') || lower.includes('ta pago') || lower.includes('paguei') ||
    lower.includes('mandei o pix') || lower.includes('fiz o pix') || lower.includes('transferi') ||
    lower.includes('acabei de pagar') || lower.includes('ja fiz')
  ) {
    return 'SAID_PAID';
  }

  // 4. Pergunta por que tem que pagar
  if (
    (lower.includes('por que') || lower.includes('pq') || lower.includes('porque')) &&
    (lower.includes('pagar') || lower.includes('pago') || lower.includes('cobra') || lower.includes('gratis') || lower.includes('valor') || lower.includes('preco'))
  ) {
    return 'WHY_PAY';
  }

  // 5. Pergunta do que se trata a taxa de 100 ou taxa atual
  if (
    lower.includes('taxa de 100') || lower.includes('taxa de cem') || lower.includes('taxa de 200') || lower.includes('taxa de 400') ||
    lower.includes('que taxa') || lower.includes('do que se trata essa taxa') || lower.includes('pra que essa taxa') || lower.includes('essa taxa')
  ) {
    return 'WHAT_IS_TAX';
  }

  // 6. Pergunta sobre acesso, quando vai ver tudo ou receber a foto
  if (
    lower.includes('quando') && (lower.includes('recebo') || lower.includes('foto') || lower.includes('acesso') || lower.includes('ver tudo') || lower.includes('mensagens') || lower.includes('painel') || lower.includes('libera'))
  ) {
    return 'WHEN_GET_PHOTO_OR_ACCESS';
  }

  return 'REFUSE_OR_RANDOM';
}

module.exports = {
  classifyAndReply,
  classifyWelcomeReply,
  localClassifier
};
