const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '../../data');

function readJson(filename, defaultValue) {
  try {
    const fullPath = path.join(DATA_DIR, filename);
    if (!fs.existsSync(fullPath)) {
      fs.writeFileSync(fullPath, JSON.stringify(defaultValue, null, 2), 'utf8');
      return defaultValue;
    }
    const data = fs.readFileSync(fullPath, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    console.error(`Erro lendo ${filename}:`, err.message);
    return defaultValue;
  }
}

function writeJson(filename, data) {
  try {
    const fullPath = path.join(DATA_DIR, filename);
    fs.writeFileSync(fullPath, JSON.stringify(data, null, 2), 'utf8');
    return true;
  } catch (err) {
    console.error(`Erro salvando ${filename}:`, err.message);
    return false;
  }
}

module.exports = {
  getInstances: () => readJson('instances.json', []),
  saveInstances: (data) => writeJson('instances.json', data),
  
  getFunnel: () => readJson('funnel.json', {}),
  saveFunnel: (data) => writeJson('funnel.json', data),
  
  getChats: () => readJson('chats.json', {}),
  saveChats: (data) => writeJson('chats.json', data),
  
  getSettings: () => readJson('settings.json', {}),
  saveSettings: (data) => writeJson('settings.json', data),

  getFlows: () => readJson('flows.json', []),
  saveFlows: (data) => writeJson('flows.json', data),

  getFlow: (id) => {
    const flows = readJson('flows.json', []);
    return flows.find(f => f.id === id) || null;
  },

  saveFlow: (id, flowData) => {
    const flows = readJson('flows.json', []);
    const idx = flows.findIndex(f => f.id === id);
    if (idx >= 0) {
      flows[idx] = { ...flows[idx], ...flowData, updatedAt: new Date().toISOString() };
    } else {
      flows.push({ id, ...flowData, updatedAt: new Date().toISOString() });
    }
    writeJson('flows.json', flows);
    return flows.find(f => f.id === id);
  },

  addChatMessage: (phone, messageData, nextState = null) => {
    const chats = readJson('chats.json', {});
    if (!chats[phone]) {
      chats[phone] = {
        leadPhone: phone,
        leadName: `Lead ${phone}`,
        instanceId: messageData.instanceId || 'inst_1',
        state: nextState || 'NOVO',
        lastMessageTime: new Date().toISOString(),
        messages: []
      };
    }
    if (nextState) chats[phone].state = nextState;
    chats[phone].lastMessageTime = new Date().toISOString();
    
    const msg = {
      id: 'msg_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
      timestamp: new Date().toISOString(),
      ...messageData
    };
    chats[phone].messages.push(msg);

    writeJson('chats.json', chats);
    return { chat: chats[phone], newMessage: msg };
  },

  getPixels: () => readJson('pixels.json', []),
  savePixels: (data) => writeJson('pixels.json', data),
  addPixel: (pixelData) => {
    const pixels = readJson('pixels.json', []);
    const newPixel = {
      id: pixelData.id || 'pix_' + Date.now(),
      createdAt: new Date().toISOString(),
      ...pixelData
    };
    const idx = pixels.findIndex(p => p.id === newPixel.id || p.pixelId === newPixel.pixelId);
    if (idx >= 0) {
      pixels[idx] = { ...pixels[idx], ...newPixel };
    } else {
      pixels.push(newPixel);
    }
    writeJson('pixels.json', pixels);
    return newPixel;
  },
  deletePixel: (id) => {
    const pixels = readJson('pixels.json', []);
    const filtered = pixels.filter(p => p.id !== id && p.pixelId !== id);
    writeJson('pixels.json', filtered);
    return true;
  },

  getPixelLogs: () => readJson('pixel_logs.json', []),
  addPixelLog: (logData) => {
    const logs = readJson('pixel_logs.json', []);
    const log = {
      id: 'log_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
      timestamp: new Date().toISOString(),
      ...logData
    };
    logs.unshift(log);
    if (logs.length > 200) logs.length = 200; // Limite de 200 registros recentes
    writeJson('pixel_logs.json', logs);
    return log;
  },

  getSales: () => readJson('sales.json', []),
  saveSales: (data) => writeJson('sales.json', data),
  addSale: (saleData) => {
    const sales = readJson('sales.json', []);
    const sale = {
      id: saleData.id || 'sale_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
      timestamp: new Date().toISOString(),
      ...saleData
    };
    sales.unshift(sale);
    writeJson('sales.json', sales);
    return sale;
  },

  // =========================================================================
  // ATRIBUIÇÃO DE TRÁFEGO PAGO & LINKS DE CAMPANHA (TIKTOK ADS)
  // =========================================================================
  getTrafficCampaigns: () => readJson('traffic_campaigns.json', []),
  saveTrafficCampaigns: (data) => writeJson('traffic_campaigns.json', data),
  addTrafficCampaign: (data) => {
    const campaigns = readJson('traffic_campaigns.json', []);
    const cleanSlug = (data.slug || data.nome || 'campanha')
      .toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9_-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');

    const newCamp = {
      id: data.id || 'camp_' + Date.now(),
      nome: data.nome || data.name || 'Nova Campanha TikTok',
      name: data.name || data.nome || 'Nova Campanha TikTok',
      slug: cleanSlug || 'campanha-' + Date.now(),
      url_destino: data.url_destino || data.presell_url || 'https://minhapressel.com',
      presell_url: data.presell_url || data.url_destino || 'https://minhapressel.com',
      whatsapp_destino: data.whatsapp_destino || data.whatsapp_number || '',
      whatsapp_number: data.whatsapp_number || data.whatsapp_destino || '',
      mensagem_template: data.mensagem_template || data.message_template || 'Oii vim pelo TikTok (código {codigo})',
      message_template: data.message_template || data.mensagem_template || 'Oii vim pelo TikTok (código {codigo})',
      total_cliques: data.total_cliques || 0,
      criado_em: new Date().toISOString()
    };

    const idx = campaigns.findIndex(c => c.id === newCamp.id || c.slug === newCamp.slug);
    if (idx >= 0) {
      campaigns[idx] = { ...campaigns[idx], ...newCamp, id: campaigns[idx].id };
    } else {
      campaigns.push(newCamp);
    }
    writeJson('traffic_campaigns.json', campaigns);
    return campaigns.find(c => c.slug === newCamp.slug) || newCamp;
  },
  deleteTrafficCampaign: (id) => {
    const campaigns = readJson('traffic_campaigns.json', []);
    const filtered = campaigns.filter(c => c.id !== id && c.slug !== id);
    writeJson('traffic_campaigns.json', filtered);
    return true;
  },

  getTrafficAttributions: () => readJson('traffic_attributions.json', []),
  saveTrafficAttributions: (data) => writeJson('traffic_attributions.json', data),
  generateUniqueAttributionCode: () => {
    const attributions = readJson('traffic_attributions.json', []);
    const existingCodes = new Set(attributions.map(a => a.codigo));
    const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
    let code = '';
    let attempts = 0;
    do {
      code = '';
      for (let i = 0; i < 6; i++) {
        code += chars[Math.floor(Math.random() * chars.length)];
      }
      attempts++;
    } while (existingCodes.has(code) && attempts < 100);
    return code;
  },
  addTrafficAttribution: (attrData) => {
    const attributions = readJson('traffic_attributions.json', []);
    const now = new Date();
    const expires = new Date(now.getTime() + 48 * 60 * 60 * 1000); // 48 horas

    const newAttr = {
      id: 'attr_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
      codigo: attrData.codigo,
      ttclid: attrData.ttclid || null,
      ttp: attrData.ttp || null,
      utm_source: attrData.utm_source || null,
      utm_medium: attrData.utm_medium || null,
      utm_campaign: attrData.utm_campaign || null,
      utm_content: attrData.utm_content || null,
      utm_term: attrData.utm_term || null,
      campanha_id: attrData.campanha_id || null,
      campanha_nome: attrData.campanha_nome || attrData.campanha_name || null,
      pressel_url: attrData.pressel_url || attrData.url_destino || null,
      criado_em: now.toISOString(),
      expira_em: expires.toISOString(),
      telefone_vinculado: attrData.telefone_vinculado || null,
      vinculado_em: null,
      venda_confirmada: false,
      venda_valor: 0,
      confirmado_em: null
    };

    attributions.unshift(newAttr);
    // Mantém limite saudável de 20.000 registros
    if (attributions.length > 20000) attributions.length = 20000;
    writeJson('traffic_attributions.json', attributions);
    return newAttr;
  },
  getTrafficAttributionByCode: (code) => {
    if (!code) return null;
    const cleanCode = String(code).trim().toUpperCase();
    const attributions = readJson('traffic_attributions.json', []);
    return attributions.find(a => a.codigo === cleanCode) || null;
  },
  getTrafficAttributionByPhone: (phone) => {
    if (!phone) return null;
    const cleanPhone = String(phone).replace(/\D/g, '');
    const attributions = readJson('traffic_attributions.json', []);
    return attributions.find(a => a.telefone_vinculado && a.telefone_vinculado.replace(/\D/g, '') === cleanPhone) || null;
  },
  linkPhoneToAttribution: (code, phone) => {
    if (!code || !phone) return null;
    const cleanCode = String(code).trim().toUpperCase();
    const cleanPhone = String(phone).replace(/\D/g, '');
    const attributions = readJson('traffic_attributions.json', []);
    const attr = attributions.find(a => a.codigo === cleanCode);

    if (attr) {
      const now = new Date();
      if (new Date(attr.expira_em) > now && (!attr.telefone_vinculado || attr.telefone_vinculado === cleanPhone)) {
        attr.telefone_vinculado = cleanPhone;
        attr.vinculado_em = now.toISOString();
        writeJson('traffic_attributions.json', attributions);
        return attr;
      }
    }
    return null;
  },
  confirmAttributionSale: (phone, amount = 49.90) => {
    if (!phone) return null;
    const cleanPhone = String(phone).replace(/\D/g, '');
    const attributions = readJson('traffic_attributions.json', []);
    const attr = attributions.find(a => a.telefone_vinculado && a.telefone_vinculado.replace(/\D/g, '') === cleanPhone);

    if (attr) {
      attr.venda_confirmada = true;
      attr.venda_valor = parseFloat(amount) || attr.venda_valor || 49.90;
      attr.confirmado_em = new Date().toISOString();
      writeJson('traffic_attributions.json', attributions);
      return attr;
    }
    return null;
  },

  // =========================================================================
  // PIXELS TIKTOK & LOGS DE DISPARO (EVENTS API v1.3)
  // =========================================================================
  getTikTokPixels: () => readJson('tiktok_pixels.json', []),
  saveTikTokPixels: (data) => writeJson('tiktok_pixels.json', data),
  addTikTokPixel: (pixelData) => {
    const pixels = readJson('tiktok_pixels.json', []);
    const newPixel = {
      id: pixelData.id || 'tt_pix_' + Date.now(),
      name: pixelData.name || 'Pixel TikTok',
      pixel_code: String(pixelData.pixel_code || pixelData.pixelCode || '').trim(),
      access_token: String(pixelData.access_token || pixelData.accessToken || '').trim(),
      createdAt: new Date().toISOString()
    };
    const idx = pixels.findIndex(p => p.id === newPixel.id || p.pixel_code === newPixel.pixel_code);
    if (idx >= 0) {
      pixels[idx] = { ...pixels[idx], ...newPixel };
    } else {
      pixels.push(newPixel);
    }
    writeJson('tiktok_pixels.json', pixels);
    return newPixel;
  },
  deleteTikTokPixel: (id) => {
    const pixels = readJson('tiktok_pixels.json', []);
    const filtered = pixels.filter(p => p.id !== id && p.pixel_code !== id);
    writeJson('tiktok_pixels.json', filtered);
    return true;
  },

  getTikTokLogs: () => readJson('tiktok_logs.json', []),
  addTikTokLog: (logData) => {
    const logs = readJson('tiktok_logs.json', []);
    const log = {
      id: 'tt_log_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
      timestamp: new Date().toISOString(),
      ...logData
    };
    logs.unshift(log);
    if (logs.length > 300) logs.length = 300;
    writeJson('tiktok_logs.json', logs);
    return log;
  }
};
