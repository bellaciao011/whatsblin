const axios = require('axios');
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

// Carrega a fonte TrueType embutida em Base64 uma única vez para garantir
// que NENHUM servidor Linux/Docker/Railway fique com caixas '□□□□□' por falta de fontes no sistema
const FONT_PATH = path.join(__dirname, '../../assets/fonts/Roboto-Medium.ttf');
let FONT_BASE64 = '';
try {
  if (fs.existsSync(FONT_PATH)) {
    FONT_BASE64 = fs.readFileSync(FONT_PATH).toString('base64');
  }
} catch (e) {
  console.warn('[LocationService] Aviso: Não foi possível carregar fonte embutida:', e.message);
}

// 1. Mapeamento de Fuso Horário para Cidade / Coordenadas
const TIMEZONE_GEO_MAP = {
  'Europe/Madrid': { city: 'Madrid', country: 'España', countryCode: 'ES', lat: 40.4168, lon: -3.7038 },
  'Atlantic/Canary': { city: 'Las Palmas', country: 'España', countryCode: 'ES', lat: 28.1235, lon: -15.4363 },
  'America/Panama': { city: 'Ciudad de Panamá', country: 'Panamá', countryCode: 'PA', lat: 8.9824, lon: -79.5199 },
  'America/Mexico_City': { city: 'Ciudad de México', country: 'México', countryCode: 'MX', lat: 19.4326, lon: -99.1332 },
  'America/Monterrey': { city: 'Monterrey', country: 'México', countryCode: 'MX', lat: 25.6866, lon: -100.3161 },
  'America/Guadalajara': { city: 'Guadalajara', country: 'México', countryCode: 'MX', lat: 20.6597, lon: -103.3496 },
  'America/Bogota': { city: 'Bogotá', country: 'Colombia', countryCode: 'CO', lat: 4.7110, lon: -74.0721 },
  'America/Buenos_Aires': { city: 'Buenos Aires', country: 'Argentina', countryCode: 'AR', lat: -34.6037, lon: -58.3816 },
  'America/Santiago': { city: 'Santiago', country: 'Chile', countryCode: 'CL', lat: -33.4489, lon: -70.6693 },
  'America/Lima': { city: 'Lima', country: 'Perú', countryCode: 'PE', lat: -12.0464, lon: -77.0428 },
  'America/Guayaquil': { city: 'Guayaquil', country: 'Ecuador', countryCode: 'EC', lat: -2.1894, lon: -79.8891 },
  'America/Guatemala': { city: 'Ciudad de Guatemala', country: 'Guatemala', countryCode: 'GT', lat: 14.6349, lon: -90.5069 },
  'America/Montevideo': { city: 'Montevideo', country: 'Uruguay', countryCode: 'UY', lat: -34.9011, lon: -56.1645 },
  'America/Asuncion': { city: 'Asunción', country: 'Paraguay', countryCode: 'PY', lat: -25.2637, lon: -57.5759 },
  'America/La_Paz': { city: 'La Paz', country: 'Bolivia', countryCode: 'BO', lat: -16.5000, lon: -68.1500 },
  'America/Costa_Rica': { city: 'San José', country: 'Costa Rica', countryCode: 'CR', lat: 9.9281, lon: -84.0907 },
  'America/Santo_Domingo': { city: 'Santo Domingo', country: 'República Dominicana', countryCode: 'DO', lat: 18.4861, lon: -69.9312 },
  'America/Tegucigalpa': { city: 'Tegucigalpa', country: 'Honduras', countryCode: 'HN', lat: 14.0723, lon: -87.1921 },
  'America/El_Salvador': { city: 'San Salvador', country: 'El Salvador', countryCode: 'SV', lat: 13.6929, lon: -89.2182 },
  'America/Managua': { city: 'Managua', country: 'Nicaragua', countryCode: 'NI', lat: 12.1150, lon: -86.2362 },
  'America/Caracas': { city: 'Caracas', country: 'Venezuela', countryCode: 'VE', lat: 10.4806, lon: -66.9036 },
  'America/Sao_Paulo': { city: 'São Paulo', country: 'Brasil', countryCode: 'BR', lat: -23.5505, lon: -46.6333 },
  'America/Rio_de_Janeiro': { city: 'Rio de Janeiro', country: 'Brasil', countryCode: 'BR', lat: -22.9068, lon: -43.1729 }
};

// 2. Mapeamento de DDI para Cidade / Coordenadas
const DDI_GEO_MAP = {
  '34': { city: 'Madrid', country: 'España', countryCode: 'ES', lat: 40.4168, lon: -3.7038 },
  '52': { city: 'Ciudad de México', country: 'México', countryCode: 'MX', lat: 19.4326, lon: -99.1332 },
  '507': { city: 'Ciudad de Panamá', country: 'Panamá', countryCode: 'PA', lat: 8.9824, lon: -79.5199 },
  '57': { city: 'Bogotá', country: 'Colombia', countryCode: 'CO', lat: 4.7110, lon: -74.0721 },
  '54': { city: 'Buenos Aires', country: 'Argentina', countryCode: 'AR', lat: -34.6037, lon: -58.3816 },
  '56': { city: 'Santiago', country: 'Chile', countryCode: 'CL', lat: -33.4489, lon: -70.6693 },
  '51': { city: 'Lima', country: 'Perú', countryCode: 'PE', lat: -12.0464, lon: -77.0428 },
  '593': { city: 'Quito', country: 'Ecuador', countryCode: 'EC', lat: -0.1807, lon: -78.4678 },
  '502': { city: 'Ciudad de Guatemala', country: 'Guatemala', countryCode: 'GT', lat: 14.6349, lon: -90.5069 },
  '598': { city: 'Montevideo', country: 'Uruguay', countryCode: 'UY', lat: -34.9011, lon: -56.1645 },
  '595': { city: 'Asunción', country: 'Paraguay', countryCode: 'PY', lat: -25.2637, lon: -57.5759 },
  '591': { city: 'La Paz', country: 'Bolivia', countryCode: 'BO', lat: -16.5000, lon: -68.1500 },
  '506': { city: 'San José', country: 'Costa Rica', countryCode: 'CR', lat: 9.9281, lon: -84.0907 },
  '1809': { city: 'Santo Domingo', country: 'República Dominicana', countryCode: 'DO', lat: 18.4861, lon: -69.9312 },
  '1829': { city: 'Santo Domingo', country: 'República Dominicana', countryCode: 'DO', lat: 18.4861, lon: -69.9312 },
  '1849': { city: 'Santo Domingo', country: 'República Dominicana', countryCode: 'DO', lat: 18.4861, lon: -69.9312 },
  '58': { city: 'Caracas', country: 'Venezuela', countryCode: 'VE', lat: 10.4806, lon: -66.9036 },
  '55': { city: 'São Paulo', country: 'Brasil', countryCode: 'BR', lat: -23.5505, lon: -46.6333 },
  '1': { city: 'Miami', country: 'Estados Unidos', countryCode: 'US', lat: 25.7617, lon: -80.1918 }
};

// 3. Lista Curada de Motéis de Alta Credibilidade (Backup Instantâneo)
const CURATED_MOTELS = {
  'ES': [
    { name: 'Motel Avenue Madrid', address: 'Avenida de Aragón, 362 - Madrid', lat: 40.4485, lon: -3.5850 },
    { name: 'Motel Los Cipreses', address: 'Calle Alcalá, 312 - Madrid', lat: 40.4320, lon: -3.6510 },
    { name: 'Motel Punt 14', address: 'Autovía de Castelldefels, km 14 - Barcelona', lat: 41.2850, lon: 2.0120 }
  ],
  'PA': [
    { name: 'Auto Motel Las Palmas', address: 'Vía Transístmica, 452 - Panamá', lat: 9.0150, lon: -79.5280 },
    { name: 'Motel Montecarlo VIP', address: 'Vía Ricardo J. Alfaro, 180 - Panamá', lat: 9.0320, lon: -79.5350 },
    { name: 'Motel Los Arcos Suite', address: 'Calle 50, Bella Vista - Panamá', lat: 8.9860, lon: -79.5210 }
  ],
  'MX': [
    { name: 'Motel Pirámides del Sol', address: 'Calzada de Tlalpan, 2480 - Ciudad de México', lat: 19.3410, lon: -99.1410 },
    { name: 'Auto Motel Vento', address: 'Av. Revolución, 1260 - Ciudad de México', lat: 19.3750, lon: -99.1890 },
    { name: 'Motel Quinta las Delicias', address: 'Calle Antonio Van Dick, 45 - Ciudad de México', lat: 19.3820, lon: -99.1830 }
  ],
  'CO': [
    { name: 'Motel Amarte Suite', address: 'Caracas Sur # 45-20 - Bogotá', lat: 4.5820, lon: -74.1120 },
    { name: 'Motel Eclipse VIP', address: 'Carrera 65 # 28-30 - Medellín', lat: 6.2280, lon: -75.5810 }
  ],
  'AR': [
    { name: 'Motel Floresta VIP', address: 'Avenida Rivadavia, 8420 - Buenos Aires', lat: -34.6310, lon: -58.4820 },
    { name: 'Albergue Denares Suite', address: 'Av. San Juan, 2850 - Buenos Aires', lat: -34.6240, lon: -58.4010 }
  ],
  'CL': [
    { name: 'Motel Cozumel VIP', address: 'Av. Vicuña Mackenna, 3450 - Santiago', lat: -33.4810, lon: -70.6180 },
    { name: 'Motel Marín 014', address: 'Calle Marín, 014 - Providencia, Santiago', lat: -33.4420, lon: -70.6310 }
  ],
  'PE': [
    { name: 'Hostal Suite Primavera', address: 'Av. Tomás Marsano, 1420 - Lima', lat: -12.1180, lon: -77.0120 },
    { name: 'Motel Las Palmeras VIP', address: 'Av. Elmer Faucett, 2100 - Lima', lat: -12.0320, lon: -77.0890 }
  ],
  'BR': [
    { name: 'Motel Harmony VIP', address: 'Av. Marginal Tietê, 4500 - São Paulo', lat: -23.5180, lon: -46.6520 },
    { name: 'Motel Shalimar', address: 'Av. Niemeyer, 218 - Rio de Janeiro', lat: -22.9940, lon: -43.2380 }
  ]
};

// Caches em memória
const motelCache = new Map();
const tileCache = new Map();

function latLonToTile(lat, lon, zoom) {
  const x = Math.floor((lon + 180) / 360 * Math.pow(2, zoom));
  const y = Math.floor((1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * Math.pow(2, zoom));
  return { x, y };
}

/**
 * Detecta a localização geográfica do visitante baseado em IP, Timezone, DDI ou Cidade
 */
async function detectVisitorGeo(options = {}) {
  const { clientIp, timeZone, phone, ddi, cityHint } = options;

  // 1. Tenta IP público via ip-api
  if (clientIp && !['127.0.0.1', '::1', 'localhost', 'unknown'].includes(clientIp) && !clientIp.startsWith('192.168.') && !clientIp.startsWith('10.')) {
    try {
      const res = await axios.get('http://ip-api.com/json/' + encodeURIComponent(clientIp) + '?fields=status,country,countryCode,city,lat,lon', { timeout: 2500 });
      if (res.data && res.data.status === 'success' && res.data.city) {
        return {
          city: res.data.city,
          country: res.data.country,
          countryCode: (res.data.countryCode || 'ES').toUpperCase(),
          lat: res.data.lat,
          lon: res.data.lon
        };
      }
    } catch (e) {}
  }

  // 2. Tenta Timezone do navegador
  if (timeZone && TIMEZONE_GEO_MAP[timeZone]) {
    return { ...TIMEZONE_GEO_MAP[timeZone] };
  }

  // 3. Tenta DDI do telefone
  const cleanDdi = String(ddi || '').replace(/\D/g, '');
  if (cleanDdi && DDI_GEO_MAP[cleanDdi]) {
    return { ...DDI_GEO_MAP[cleanDdi] };
  }

  if (phone) {
    const cleanPhone = String(phone).replace(/\D/g, '');
    for (const [code, geo] of Object.entries(DDI_GEO_MAP)) {
      if (cleanPhone.startsWith(code)) {
        return { ...geo };
      }
    }
  }

  // 4. CityHint manual se houver
  if (cityHint) {
    return {
      city: cityHint,
      country: 'España',
      countryCode: 'ES',
      lat: 40.4168,
      lon: -3.7038
    };
  }

  // Fallback padrão: Espanha / Madrid
  return {
    city: 'Madrid',
    country: 'España',
    countryCode: 'ES',
    lat: 40.4168,
    lon: -3.7038
  };
}

/**
 * Busca o motel ou hotel mais próximo da cidade do visitante
 */
async function getNearestMotel(geo) {
  const cacheKey = (geo.city || 'madrid').toLowerCase() + '_' + (geo.countryCode || 'ES');
  if (motelCache.has(cacheKey)) {
    return motelCache.get(cacheKey);
  }

  const countryCode = (geo.countryCode || 'ES').toLowerCase();
  const city = geo.city || 'Madrid';

  // 1. Tenta buscar motel real no Nominatim OpenStreetMap
  try {
    let nomUrl = 'https://nominatim.openstreetmap.org/search?q=motel+' + encodeURIComponent(city) + '&countrycodes=' + countryCode + '&format=json&limit=4&addressdetails=1';
    let nomRes = await axios.get(nomUrl, {
      headers: { 'User-Agent': 'WhatsAppSimulationEngine/2.0' },
      timeout: 3000
    });

    if (!nomRes.data || nomRes.data.length === 0) {
      nomUrl = 'https://nominatim.openstreetmap.org/search?q=hotel+' + encodeURIComponent(city) + '&countrycodes=' + countryCode + '&format=json&limit=4&addressdetails=1';
      nomRes = await axios.get(nomUrl, {
        headers: { 'User-Agent': 'WhatsAppSimulationEngine/2.0' },
        timeout: 3000
      });
    }

    if (nomRes.data && nomRes.data.length > 0) {
      const item = nomRes.data[0];
      let name = item.name || item.display_name.split(',')[0];
      if (!name.toLowerCase().includes('motel') && !name.toLowerCase().includes('hotel')) {
        name = 'Motel ' + name;
      }

      const road = item.address && (item.address.road || item.address.suburb || 'Avenida Principal');
      const houseNumber = (item.address && item.address.house_number) || (Math.floor(Math.random() * 500) + 50);
      const address = road + ', ' + houseNumber + ' - ' + city;

      const result = {
        name: name.slice(0, 34),
        address: address.slice(0, 46),
        city: city,
        country: geo.country,
        countryCode: geo.countryCode,
        lat: parseFloat(item.lat),
        lon: parseFloat(item.lon)
      };

      motelCache.set(cacheKey, result);
      return result;
    }
  } catch (err) {
    console.warn('[LocationService] Nominatim fallback:', err.message);
  }

  // 2. Fallback de lista com curadoria
  const list = CURATED_MOTELS[geo.countryCode] || CURATED_MOTELS['ES'];
  const picked = list[Math.floor(Math.random() * list.length)];
  const fallbackResult = {
    name: picked.name,
    address: picked.address.includes(city) ? picked.address : picked.address.split(' - ')[0] + ' - ' + city,
    city: city,
    country: geo.country,
    countryCode: geo.countryCode,
    lat: picked.lat || geo.lat,
    lon: picked.lon || geo.lon
  };

  motelCache.set(cacheKey, fallbackResult);
  return fallbackResult;
}

/**
 * Busca tile do mapa sem watermark:
 * 1. Esri World Dark Gray Canvas (OFICIAL, GRATUITO, SEM MARCA D'ÁGUA)
 * 2. OpenStreetMap Oficial tratado em Dark Mode via Sharp
 * 3. Fallback SVG vetorial limpo
 */
async function getMapTile(lat, lon, zoom = 15) {
  const { x, y } = latLonToTile(lat, lon, zoom);
  const tileKey = zoom + '_' + x + '_' + y;

  if (tileCache.has(tileKey)) {
    return tileCache.get(tileKey);
  }

  // TENTATIVA 1: Esri ArcGIS World Dark Gray Base (Sem watermark, alta fidelidade dark)
  // Notação Esri: tile/{level}/{row}/{col} -> tile/{zoom}/{y}/{x}
  const esriUrl = 'https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/' + zoom + '/' + y + '/' + x;
  try {
    const esriRes = await axios.get(esriUrl, {
      timeout: 3500,
      responseType: 'arraybuffer',
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
    });
    if (esriRes.data && esriRes.data.length > 500) {
      const buf = Buffer.from(esriRes.data);
      tileCache.set(tileKey, buf);
      return buf;
    }
  } catch (e) {
    console.warn('[LocationService] Esri Dark fallback:', e.message);
  }

  // TENTATIVA 2: OpenStreetMap Standard convertido em Dark Mode (sem watermark)
  const osmUrl = 'https://tile.openstreetmap.org/' + zoom + '/' + x + '/' + y + '.png';
  try {
    const osmRes = await axios.get(osmUrl, {
      timeout: 3500,
      responseType: 'arraybuffer',
      headers: { 'User-Agent': 'WhatsAppBotSimulation/1.0 (contact: admin@whatsblin.com)' }
    });
    if (osmRes.data && osmRes.data.length > 500) {
      const darkOsm = await sharp(osmRes.data)
        .modulate({ brightness: 0.8, saturation: 0.2 })
        .negate({ alpha: false })
        .tint({ r: 27, g: 38, b: 46 })
        .png()
        .toBuffer();
      tileCache.set(tileKey, darkOsm);
      return darkOsm;
    }
  } catch (e) {
    console.warn('[LocationService] OSM Dark fallback:', e.message);
  }

  // TENTATIVA 3: Fallback mapa vetorial SVG escuro estilo WhatsApp
  return Buffer.from(
    '<svg width="380" height="215" xmlns="http://www.w3.org/2000/svg">' +
    '<rect width="100%" height="100%" fill="#1f2c34"/>' +
    '<path d="M0,45 Q190,85 380,45" stroke="#2a3942" stroke-width="8" fill="none"/>' +
    '<path d="M0,155 Q190,125 380,165" stroke="#2a3942" stroke-width="12" fill="none"/>' +
    '<path d="M120,0 L145,215" stroke="#374248" stroke-width="6" fill="none"/>' +
    '<path d="M260,0 L235,215" stroke="#374248" stroke-width="8" fill="none"/>' +
    '</svg>'
  );
}

/**
 * Renderiza o Card de Localização completo (Mapa Dark Sem Watermark + Pin + Nome do Motel + Endereço com Fonte Embutida)
 */
async function renderLocationCard(motel, width = 380, height = 325) {
  const mapHeight = 215;
  const footerHeight = height - mapHeight; // 110px

  // 1. Busca tile do mapa sem nenhuma marca d'água
  const zoom = 15;
  const rawTileBuffer = await getMapTile(motel.lat, motel.lon, zoom);

  // Redimensiona mapa para cobrir width x mapHeight
  const resizedMap = await sharp(rawTileBuffer)
    .resize(width, mapHeight, { fit: 'cover' })
    .png()
    .toBuffer();

  // 2. Pin do WhatsApp Vermelho com sombra e ponto central
  const pinSvg =
    '<svg width="48" height="48" viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">' +
    '<defs>' +
    '<filter id="shadow" x="-30%" y="-30%" width="160%" height="160%">' +
    '<feDropShadow dx="0" dy="3" stdDeviation="3" flood-color="black" flood-opacity="0.6"/>' +
    '</filter>' +
    '</defs>' +
    '<ellipse cx="24" cy="45" rx="8" ry="3" fill="rgba(0,0,0,0.4)"/>' +
    '<path d="M24 2 C15.16 2 8 9.16 8 18 C8 29.5 24 44 24 44 C24 44 40 29.5 40 18 C40 9.16 32.84 2 24 2 Z" fill="#ea4335" filter="url(#shadow)"/>' +
    '<circle cx="24" cy="18" r="6.5" fill="#ffffff"/>' +
    '<circle cx="24" cy="18" r="3" fill="#b31412"/>' +
    '</svg>';

  const pinX = Math.round(width / 2 - 24);
  const pinY = Math.round(mapHeight / 2 - 40);

  const mapWithPin = await sharp(resizedMap)
    .composite([{ input: Buffer.from(pinSvg), left: pinX, top: pinY }])
    .png()
    .toBuffer();

  // 3. Rodapé com Fonte Embutida em Base64 (zero caixas '□□□□□')
  const escapedName = (motel.name || 'Motel').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const escapedAddress = (motel.address || 'Calle Principal').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const fontStyle = FONT_BASE64
    ? '@font-face { font-family: "WhatsAppFont"; src: url("data:font/truetype;charset=utf-8;base64,' + FONT_BASE64 + '") format("truetype"); }'
    : '';

  const footerSvg =
    '<svg width="' + width + '" height="' + footerHeight + '" xmlns="http://www.w3.org/2000/svg">' +
    '<defs>' +
    '<style>' +
    fontStyle +
    '.motel-title { font-family: "WhatsAppFont", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif; font-size: 15px; font-weight: bold; fill: #e9edef; }' +
    '.motel-addr { font-family: "WhatsAppFont", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif; font-size: 12px; fill: #8696a0; }' +
    '.maps-link { font-family: "WhatsAppFont", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif; font-size: 11.5px; font-weight: bold; fill: #53bdeb; }' +
    '.time-label { font-family: "WhatsAppFont", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif; font-size: 11px; fill: #8696a0; }' +
    '</style>' +
    '</defs>' +
    '<rect width="100%" height="100%" fill="#1f2c34"/>' +
    '<text x="16" y="32" class="motel-title">' + escapedName + '</text>' +
    '<text x="16" y="56" class="motel-addr">' + escapedAddress + '</text>' +
    '<text x="16" y="82" class="maps-link">maps.google.com</text>' +
    '<text x="' + (width - 48) + '" y="82" class="time-label">16:09</text>' +
    '</svg>';

  // 4. Monta o card inteiro com cantos arredondados (estilo balão do WhatsApp)
  const roundedMask = Buffer.from(
    '<svg width="' + width + '" height="' + height + '"><rect width="' + width + '" height="' + height + '" rx="12" ry="12" fill="white"/></svg>'
  );

  const rawCard = await sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 31, g: 44, b: 52, alpha: 1 }
    }
  })
  .composite([
    { input: mapWithPin, left: 0, top: 0 },
    { input: Buffer.from(footerSvg), left: 0, top: mapHeight }
  ])
  .png()
  .toBuffer();

  const roundedCard = await sharp(rawCard)
    .composite([{ input: roundedMask, blend: 'dest-in' }])
    .png()
    .toBuffer();

  return roundedCard;
}

module.exports = {
  detectVisitorGeo,
  getNearestMotel,
  renderLocationCard,
  latLonToTile
};
