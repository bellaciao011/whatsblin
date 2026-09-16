const fs = require('fs');
const path = require('path');

const flowsPath = path.join(__dirname, '../data/flows.json');
const flows = JSON.parse(fs.readFileSync(flowsPath, 'utf8'));

const ptFlow = flows[0];
ptFlow.id = 'fluxo-espiao-foto';
ptFlow.name = 'Funil Oficial - Mavrol Empresarial (🇧🇷 Português)';
ptFlow.language = 'pt';
ptFlow.currency = 'BRL';
ptFlow.currencySymbol = 'R$';
ptFlow.status = 'ativo';

// Deep clone for Spanish
const esFlow = JSON.parse(JSON.stringify(ptFlow));
esFlow.id = 'fluxo-espiao-es';
esFlow.name = 'Funil Oficial - Mavrol Empresarial (🇪🇸 Español)';
esFlow.description = 'Embudo oficial en español con verificación de foto en la API stalkea.app, oferta front-end de $39 USD y entrega inmediata de acceso (sin upsells en WhatsApp - upsell gestionado en la plataforma externa con 1-click redirect).';
esFlow.language = 'es';
esFlow.currency = 'USD';
esFlow.currencySymbol = '$';
esFlow.status = 'ativo';

// Deep clone for English
const enFlow = JSON.parse(JSON.stringify(ptFlow));
enFlow.id = 'fluxo-espiao-en';
enFlow.name = 'Funil Oficial - Mavrol Empresarial (🇺🇸 English)';
enFlow.description = 'Official funnel with photo lookup API, payments, AI objection handling and upsell ladder ($49.90 -> $100 -> $200 -> $400)';
enFlow.language = 'en';
enFlow.currency = 'USD';
enFlow.currencySymbol = '$';
enFlow.status = 'ativo';

// Map of translations for Spanish (Front $39, No WhatsApp Upsells)
const esTranslations = {
  'node-start': {
    label: 'Inicio (Gatillo WhatsApp)',
    text: 'El cliente envió el primer mensaje'
  },
  'node-welcome': {
    label: 'Bienvenida Oficial',
    text: 'Hola, Guarda mi contacto y envíame el número de la persona que ya te mando la prueba.'
  },
  'node-wait-reply': {
    label: 'Espera Número o Duda',
    timeout: 'Esperando envío del número o respuesta del lead...'
  },
  'node-condition-phone': {
    label: 'Clasificar Respuesta de Bienvenida',
    rule: 'Código de país + número (ej: +34... o +52...)'
  },
  'node-doubt-welcome': {
    label: '🟡 Si Duda: Confidencialidad y Funcionamiento',
    text: 'Nuestro sistema localiza mensajes, audios eliminados y registros en los servidores mediante el número de teléfono. Es 100% confidencial y la persona no se entera.\n\nPara que pueda generar la vista previa y enviarte la prueba, solo envíame su número aquí con el código de país.'
  },
  'node-reinf-phone': {
    label: '🔴 Si Negativa/Aleatoria: Reforzar Número',
    text: 'En cuanto envíes el número ya lo activo aquí 👍\n\nNecesito el WhatsApp de la persona:\nCódigo de país + número\n\nEnvíalo rápido.'
  },
  'node-analyzing-msg': {
    label: '🟢 Si Positiva: Análisis en el Sistema',
    text: 'Espera un momento mientras verificamos en el sistema...'
  },
  'node-delay': {
    label: 'Intervalo Inteligente (3s)'
  },
  'node-api-lookup': {
    label: 'Consulta Foto (stalkea.app)'
  },
  'node-photo-branch': {
    label: '¿Tiene Foto Pública?'
  },
  'node-proof-template-1': {
    label: 'Captura 1 (Con Foto en el Audio)'
  },
  'node-proof-template-2': {
    label: 'Captura 2 (Candado Encriptado)',
    notice: 'Audios protegidos por encriptación'
  },
  'node-offer-pix-49': {
    label: 'Oferta $39 (Checkout Seguro)',
    text: 'Enlace para el pago de $39 👇\n{checkoutUrl}\n\nDatos del pago: 🔒 Pago 100% seguro y encriptado.',
    amount: '39'
  },
  'node-msg-comprovante': {
    label: 'Instrucción Comprobante',
    text: '¡En cuanto pagues, envíame el comprobante por aquí para desbloquear tu acceso completo!'
  },
  'node-wait-reaction': {
    label: 'Espera Reacción / Comprobante',
    timeout: 'Esperando envío del comprobante u objeción...'
  },
  'node-ai-sentiment': {
    label: 'GPT: Objeciones Oferta $39',
    prompt: 'Clasificar objeciones: Por qué pagar $39, Rechazo, Denuncia/Estafa, Qué es la tarifa de $39, Acceso, Enviar enlace'
  },
  'node-access-released': {
    label: 'Acceso Completo Desbloqueado 🎉',
    text: 'Pago de $39 recibido con éxito ✅\n\n¡Tu acceso completo e ilimitado al panel ha sido desbloqueado! Accede a tu panel y aprovecha todas las herramientas.'
  }
};

// Map of translations for English
const enTranslations = {
  'node-start': {
    label: 'Start (WhatsApp Trigger)',
    text: 'Client sent first message'
  },
  'node-welcome': {
    label: 'Official Welcome',
    text: 'Hello, Save my contact and send the person\'s phone number and I\'ll send you the proof right away.'
  },
  'node-wait-reply': {
    label: 'Wait Number or Question',
    timeout: 'Waiting for phone number or lead response...'
  },
  'node-condition-phone': {
    label: 'Classify Welcome Reply',
    rule: 'Country code + phone number'
  },
  'node-doubt-welcome': {
    label: '🟡 If Doubt: Privacy & How It Works',
    text: 'Our system locates messages, deleted audios, and server records using the phone number. It is 100% confidential and the person will never know.\n\nTo generate the preview and send you the proof, just send me their number with country code here.'
  },
  'node-reinf-phone': {
    label: '🔴 If Random/Negative: Reinforce Phone',
    text: 'As soon as you send the number I\'ll activate it right here 👍\n\nI need the person\'s WhatsApp number:\nCountry code + number\n\nSend it quickly.'
  },
  'node-analyzing-msg': {
    label: '🟢 If Positive: System Analysis',
    text: 'Please wait a moment while we check the system...'
  },
  'node-delay': {
    label: 'Smart Delay (3s)'
  },
  'node-api-lookup': {
    label: 'Photo Lookup (stalkea.app)'
  },
  'node-photo-branch': {
    label: 'Has Public Photo?'
  },
  'node-proof-template-1': {
    label: 'Proof 1 (With Audio Profile Photo)'
  },
  'node-proof-template-2': {
    label: 'Proof 2 (Encrypted Lock)',
    notice: 'Audios protected by encryption'
  },
  'node-offer-pix-49': {
    label: 'Offer $49.90 (Secure Checkout)',
    text: 'Payment link for $49.90 👇\n{checkoutUrl}\n\nPayment info: 🔒 100% Secure & Encrypted Checkout',
    amount: '49.90'
  },
  'node-msg-comprovante': {
    label: 'Receipt Instruction',
    text: 'As soon as you pay, send me the receipt here to unlock full access!'
  },
  'node-wait-reaction': {
    label: 'Wait Reaction / Receipt',
    timeout: 'Waiting for receipt or objection...'
  },
  'node-ai-sentiment': {
    label: 'GPT: Objections Offer $49.90',
    prompt: 'Classify objections: Why pay, Refusal, Scam/Fraud, What is the fee, Access, Send link'
  },
  'node-upsell-100': {
    label: 'Upsell 1: $100.00',
    text: 'Payment of $49.90 received ✅\n\nNext payment to unlock everything: $100 👇\n\n{checkoutUrl100}\n\nPlease proceed and send me the receipt as soon as it\'s completed!',
    amount: '100'
  },
  'node-wait-upsell-100': {
    label: 'Wait Receipt $100',
    timeout: 'Waiting for receipt or questions about the $100 fee...'
  },
  'node-ai-objection-100': {
    label: 'GPT: Objections Fee $100',
    prompt: 'Classify objections Fee $100: Paid 49.90 and refuses 100, Why pay fee 100, Scam/Fraud, Fee 100, Access, Send link'
  },
  'node-upsell-200': {
    label: 'Upsell 2: $200.00',
    text: 'Payment of $100 received ✅\n\nNext payment to unlock everything: $200 👇\n\n{checkoutUrl200}\n\nPlease proceed and send me the receipt as soon as it\'s completed!',
    amount: '200'
  },
  'node-wait-upsell-200': {
    label: 'Wait Receipt $200',
    timeout: 'Waiting for receipt or questions about the $200 fee...'
  },
  'node-ai-objection-200': {
    label: 'GPT: Objections Fee $200',
    prompt: 'Classify objections Fee $200: Paid 100 and refuses 200, Why pay fee 200, Scam/Fraud, Fee 200, Access, Send link'
  },
  'node-upsell-400': {
    label: 'Upsell 3: $400.00',
    text: 'Payment of $200 received ✅\n\nNext payment to unlock everything: $400 👇\n\n{checkoutUrl400}\n\nPlease proceed and send me the receipt as soon as it\'s completed!',
    amount: '400'
  },
  'node-wait-upsell-400': {
    label: 'Wait Receipt $400',
    timeout: 'Waiting for receipt or questions about the $400 fee...'
  },
  'node-ai-objection-400': {
    label: 'GPT: Objections Fee $400',
    prompt: 'Classify objections Fee $400: Paid 200 and refuses 400, Why pay fee 400, Scam/Fraud, Fee 400, Access, Send link'
  },
  'node-access-released': {
    label: 'Master Access Unlocked 🎉',
    text: 'Payment of $400 successfully received ✅\n\nYour complete and unrestricted dashboard access has been unlocked! Log into your dashboard and enjoy all tools.'
  }
};

// Filter out upsell nodes for Spanish
const upsellNodeIds = [
  'node-upsell-100', 'node-wait-upsell-100', 'node-ai-objection-100',
  'node-upsell-200', 'node-wait-upsell-200', 'node-ai-objection-200',
  'node-upsell-400', 'node-wait-upsell-400', 'node-ai-objection-400'
];

esFlow.nodes = esFlow.nodes.filter(n => !upsellNodeIds.includes(n.id));

// Apply Spanish translations
for (const node of esFlow.nodes) {
  const trans = esTranslations[node.id];
  if (trans) {
    if (trans.label) node.label = trans.label;
    if (!node.data) node.data = {};
    if (trans.text) node.data.text = trans.text;
    if (trans.timeout) node.data.timeout = trans.timeout;
    if (trans.rule) node.data.rule = trans.rule;
    if (trans.notice) node.data.notice = trans.notice;
    if (trans.amount) node.data.amount = trans.amount;
    if (trans.prompt) node.data.prompt = trans.prompt;
  }
}

// Rewire edges for Spanish (connect node-ai-sentiment directly to node-access-released)
const edgesToRemove = ['e19', 'e20', 'e21', 'e21_loop', 'e22', 'e23', 'e24', 'e24_loop', 'e25', 'e26', 'e27', 'e27_loop', 'e28'];
esFlow.edges = esFlow.edges.filter(e => !edgesToRemove.includes(e.id));
esFlow.edges.push({
  id: 'e19',
  from: 'node-ai-sentiment',
  to: 'node-access-released',
  label: '✅ Comprobante $39 Aprobado / Entrega de Acceso'
});

// Apply English translations
for (const node of enFlow.nodes) {
  const trans = enTranslations[node.id];
  if (trans) {
    if (trans.label) node.label = trans.label;
    if (!node.data) node.data = {};
    if (trans.text) node.data.text = trans.text;
    if (trans.timeout) node.data.timeout = trans.timeout;
    if (trans.rule) node.data.rule = trans.rule;
    if (trans.notice) node.data.notice = trans.notice;
    if (trans.amount) node.data.amount = trans.amount;
    if (trans.prompt) node.data.prompt = trans.prompt;
  }
}

const allFlows = [ptFlow, esFlow, enFlow];
fs.writeFileSync(flowsPath, JSON.stringify(allFlows, null, 2), 'utf8');
console.log('Successfully generated 3 official funnels:');
allFlows.forEach((f, idx) => {
  console.log(`[${idx + 1}] ID: ${f.id} | Name: ${f.name} | Lang: ${f.language} | Nodes: ${f.nodes.length} | Edges: ${f.edges.length}`);
});
