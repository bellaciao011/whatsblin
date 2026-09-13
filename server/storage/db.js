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
  }
};
