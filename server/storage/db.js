const fs = require('fs');
const path = require('path');

const DEFAULT_DATA_DIR = path.join(__dirname, '../../data');

// Suporte automático a volumes persistentes no Railway (/app/data, /data ou variável de ambiente)
function resolveDataDir() {
  if (process.env.DATA_DIR && fs.existsSync(process.env.DATA_DIR)) return process.env.DATA_DIR;
  if (process.env.RAILWAY_VOLUME_MOUNT_PATH && fs.existsSync(process.env.RAILWAY_VOLUME_MOUNT_PATH)) return process.env.RAILWAY_VOLUME_MOUNT_PATH;
  if (fs.existsSync('/app/data')) return '/app/data';
  if (fs.existsSync('/data') && fs.statSync('/data').isDirectory()) return '/data';
  return DEFAULT_DATA_DIR;
}

const DATA_DIR = resolveDataDir();
try { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); } catch (e) {}
console.log('[Storage DB] Diretório de dados ativo:', DATA_DIR);

function readJson(filename, defaultValue) {
  try {
    const fullPath = path.join(DATA_DIR, filename);
    const fallbackPath = path.join(DEFAULT_DATA_DIR, filename);

    // Se o arquivo não existir no DATA_DIR persistente, tenta copiar do DEFAULT_DATA_DIR ou criar
    if (!fs.existsSync(fullPath)) {
      if (DATA_DIR !== DEFAULT_DATA_DIR && fs.existsSync(fallbackPath)) {
        try {
          fs.copyFileSync(fallbackPath, fullPath);
          const copied = fs.readFileSync(fullPath, 'utf8');
          return JSON.parse(copied);
        } catch (copyErr) {}
      }
      fs.writeFileSync(fullPath, JSON.stringify(defaultValue, null, 2), 'utf8');
      return defaultValue;
    }

    const data = fs.readFileSync(fullPath, 'utf8');
    const parsed = JSON.parse(data);

    // Se for array vazio e tivermos dados semeados no DEFAULT_DATA_DIR (ex: dominios_customizados), mescla os dados
    if (Array.isArray(parsed) && parsed.length === 0 && DATA_DIR !== DEFAULT_DATA_DIR && fs.existsSync(fallbackPath)) {
      try {
        const seeded = JSON.parse(fs.readFileSync(fallbackPath, 'utf8'));
        if (Array.isArray(seeded) && seeded.length > 0) {
          fs.writeFileSync(fullPath, JSON.stringify(seeded, null, 2), 'utf8');
          return seeded;
        }
      } catch (e) {}
    }

    return parsed;
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
  getInstance: (id) => {
    const instances = readJson('instances.json', []);
    return instances.find(i => i.id === id || i.instance_id === id || i.phoneNumberId === id) || null;
  },
  saveInstance: (instanceData) => {
    const instances = readJson('instances.json', []);
    const idx = instances.findIndex(i => i.id === instanceData.id || (instanceData.instance_id && i.instance_id === instanceData.instance_id));
    if (idx >= 0) {
      instances[idx] = { ...instances[idx], ...instanceData };
    } else {
      instances.push(instanceData);
    }
    writeJson('instances.json', instances);
    return idx >= 0 ? instances[idx] : instanceData;
  },
  deleteInstance: (id) => {
    const instances = readJson('instances.json', []);
    const filtered = instances.filter(i => i.id !== id && i.instance_id !== id);
    writeJson('instances.json', filtered);
    return true;
  },
  getWhatsAppConnections: () => readJson('instances.json', []),
  saveWhatsAppConnection: (connectionData) => {
    const instances = readJson('instances.json', []);
    const idx = instances.findIndex(i => i.id === connectionData.id || (connectionData.instance_id && i.instance_id === connectionData.instance_id));
    if (idx >= 0) {
      instances[idx] = { ...instances[idx], ...connectionData };
    } else {
      instances.push(connectionData);
    }
    writeJson('instances.json', instances);
    return idx >= 0 ? instances[idx] : connectionData;
  },
  
  getFunnel: () => readJson('funnel.json', {}),
  saveFunnel: (data) => writeJson('funnel.json', data),
  
  getChats: () => readJson('chats.json', {}),
  getChat: (phone) => {
    const chats = readJson('chats.json', {});
    return chats[phone] || null;
  },
  saveChat: (phone, chatData) => {
    const chats = readJson('chats.json', {});
    chats[phone] = { ...(chats[phone] || {}), ...chatData };
    writeJson('chats.json', chats);
    return chats[phone];
  },
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
        lastMessageTime: messageData.timestamp || new Date().toISOString(),
        messages: []
      };
    }
    if (nextState) chats[phone].state = nextState;
    chats[phone].lastMessageTime = messageData.timestamp || new Date().toISOString();
    
    const msgId = messageData.id || ('msg_' + Date.now() + '_' + Math.floor(Math.random() * 1000));
    
    // Evita duplicatas por ID se já foi registrada
    const existingMsg = chats[phone].messages.find(m => m.id === msgId);
    if (existingMsg) {
      return { chat: chats[phone], newMessage: existingMsg };
    }

    const msg = {
      ...messageData,
      id: msgId,
      timestamp: messageData.timestamp || new Date().toISOString()
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

    let customDomain = data.custom_domain ? String(data.custom_domain).trim().toLowerCase() : null;
    if (!customDomain) {
      try {
        const doms = readJson('dominios_customizados.json', []);
        const activeDom = doms.find(d => d.ativo !== false && d.status === 'ativo');
        if (activeDom) customDomain = activeDom.dominio;
      } catch (e) {}
    }

    const cleanPresell = (data.presell_url && data.presell_url !== 'https://minhapressel.com') ? String(data.presell_url).trim() : '';

    const newCamp = {
      id: data.id || 'camp_' + Date.now(),
      nome: data.nome || data.name || 'Nova Campanha TikTok',
      name: data.name || data.nome || 'Nova Campanha TikTok',
      slug: cleanSlug || 'campanha-' + Date.now(),
      custom_domain: customDomain,
      url_destino: cleanPresell,
      presell_url: cleanPresell,
      whatsapp_destino: data.whatsapp_destino || data.whatsapp_number || '',
      whatsapp_number: data.whatsapp_number || data.whatsapp_destino || '',
      mensagem_template: data.mensagem_template || data.message_template || 'Oii vim pelo TikTok (código {codigo})',
      message_template: data.message_template || data.mensagem_template || 'Oii vim pelo TikTok (código {codigo})',
      total_cliques: data.total_cliques || 0,
      criado_em: data.criado_em || new Date().toISOString()
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
      test_event_code: String(pixelData.test_event_code || pixelData.testEventCode || '').trim(),
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
  },

  // =========================================================================
  // DOMÍNIOS CUSTOMIZADOS (RAILWAY API)
  // =========================================================================
  getCustomDomains: () => readJson('dominios_customizados.json', []),
  saveCustomDomains: (data) => writeJson('dominios_customizados.json', data),

  getCustomDomainById: (id) => {
    const domains = readJson('dominios_customizados.json', []);
    return domains.find(d => d.id === id || d.railway_domain_id === id) || null;
  },

  getCustomDomainByHostname: (hostname) => {
    if (!hostname) return null;
    const cleanHost = String(hostname).toLowerCase().trim().split(':')[0];
    const domains = readJson('dominios_customizados.json', []);
    return domains.find(d => d.dominio.toLowerCase().trim() === cleanHost) || null;
  },

  addCustomDomain: (data) => {
    const domains = readJson('dominios_customizados.json', []);
    const cleanDomain = String(data.dominio || data.domain || '')
      .toLowerCase()
      .trim()
      .replace(/^https?:\/\//, '')
      .replace(/\/.*$/, '');

    const newRecord = {
      id: data.id || `dom_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
      dominio: cleanDomain,
      cname_target: data.cname_target || data.cnameTarget || '',
      railway_domain_id: data.railway_domain_id || data.railwayDomainId || '',
      status: data.status || 'pendente',
      ativo: data.ativo !== undefined ? data.ativo : true,
      account_id: data.account_id || 'acc_admin_default',
      criado_em: data.criado_em || new Date().toISOString(),
      atualizado_em: new Date().toISOString()
    };

    const existingIdx = domains.findIndex(d => d.dominio === cleanDomain);
    if (existingIdx >= 0) {
      domains[existingIdx] = { ...domains[existingIdx], ...newRecord, atualizado_em: new Date().toISOString() };
      writeJson('dominios_customizados.json', domains);
      return domains[existingIdx];
    } else {
      domains.push(newRecord);
      writeJson('dominios_customizados.json', domains);
      return newRecord;
    }
  },

  updateCustomDomain: (id, updates) => {
    const domains = readJson('dominios_customizados.json', []);
    const idx = domains.findIndex(d => d.id === id || d.railway_domain_id === id);
    if (idx >= 0) {
      domains[idx] = {
        ...domains[idx],
        ...updates,
        atualizado_em: new Date().toISOString()
      };
      writeJson('dominios_customizados.json', domains);
      return domains[idx];
    }
    return null;
  },

  deleteCustomDomain: (id) => {
    const domains = readJson('dominios_customizados.json', []);
    const filtered = domains.filter(d => d.id !== id && d.railway_domain_id !== id);
    writeJson('dominios_customizados.json', filtered);
    return true;
  }
};
