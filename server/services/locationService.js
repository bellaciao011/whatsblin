const axios = require('axios');
const sharp = require('sharp');
const opentype = require('opentype.js');
const fs = require('fs');
const path = require('path');

// Carrega a fonte TrueType uma única vez para renderizar os textos como VETORES PUROS (SVG <path>)
// Isso elimina 100% o problema de caixas '□□□□□' no Linux/Docker/Railway
const FONT_PATH = path.join(__dirname, '../../assets/fonts/Roboto-Medium.ttf');
let loadedFont = null;
try {
  if (fs.existsSync(FONT_PATH)) {
    const fontBuffer = fs.readFileSync(FONT_PATH);
    loadedFont = opentype.parse(fontBuffer.buffer);
    console.log('[LocationService] ✓ Fonte TrueType carregada para renderização vetorial pura!');
  }
} catch (e) {
  console.warn('[LocationService] Aviso ao carregar fonte para opentype:', e.message);
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

// 3. Lista Curada de Motéis de Alta Credibilidade
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
        name: name.slice(0, 32),
        address: address.slice(0, 44),
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
 * Busca tile do mapa com ruas e nomes visíveis, sem NENHUMA marca d'água:
 * Utiliza OpenStreetMap com zoom 16 tratado no tom Dark Mode do WhatsApp
 */
async function getMapTile(lat, lon, zoom = 16) {
  const { x, y } = latLonToTile(lat, lon, zoom);
  const tileKey = zoom + '_' + x + '_' + y;

  if (tileCache.has(tileKey)) {
    return tileCache.get(tileKey);
  }

  // TENTATIVA 1: OpenStreetMap zoom 16 com nomes de ruas e avenidas
  const osmUrl = 'https://tile.openstreetmap.org/' + zoom + '/' + x + '/' + y + '.png';
  try {
    const osmRes = await axios.get(osmUrl, {
      timeout: 3500,
      responseType: 'arraybuffer',
      headers: { 'User-Agent': 'WhatsAppSimulationEngine/2.0 (contact: admin@whatsblin.com)' }
    });
    if (osmRes.data && osmRes.data.length > 500) {
      // Converte para o tema noturno do WhatsApp com ruas nítidas
      const darkOsm = await sharp(osmRes.data)
        .negate({ alpha: false })
        .modulate({ brightness: 0.85, saturation: 0.3 })
        .tint({ r: 24, g: 34, b: 45 })
        .png()
        .toBuffer();

      tileCache.set(tileKey, darkOsm);
      return darkOsm;
    }
  } catch (e) {
    console.warn('[LocationService] OSM Dark fallback:', e.message);
  }

  // TENTATIVA 2: Esri ArcGIS World Dark Gray Base
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
 * Renderiza o Card de Localização completo:
 * 1. Mapa Dark nítido com nomes de ruas reais (zoom 16)
 * 2. Pin Vermelho do WhatsApp
 * 3. Balão / Badge com o Nome do Motel destacado DIRETO NO MAPA
 * 4. Rodapé escuro com Nome, Endereço, maps.google.com e horário convertidos em VETOR PURO (SVG <path>)
 */
async function renderLocationCard(motel, width = 380, height = 325) {
  const mapHeight = 215;
  const footerHeight = height - mapHeight; // 110px

  const motelName = (motel.name || 'Motel').slice(0, 32);
  const motelAddress = (motel.address || 'Calle Principal').slice(0, 44);

  // 1. Busca tile do mapa zoom 16 com ruas
  const rawTileBuffer = await getMapTile(motel.lat, motel.lon, 16);

  // Redimensiona mapa para width x mapHeight
  const resizedMap = await sharp(rawTileBuffer)
    .resize(width, mapHeight, { fit: 'cover' })
    .png()
    .toBuffer();

  // 2. Monta o Badge com o Nome do Motel no Mapa + Pin Vermelho
  let badgeSvgContent = '';
  let badgeWidth = 160;
  const badgeHeight = 30;

  if (loadedFont) {
    const badgeText = motelName.length > 22 ? motelName.slice(0, 20) + '...' : motelName;
    const badgePath = loadedFont.getPath(badgeText, 22, 20, 11.5);
    badgePath.fill = '#ffffff';

    badgeWidth = Math.min(230, Math.max(120, badgeText.length * 7.5 + 36));
    const badgeLeft = Math.round(width / 2 - badgeWidth / 2);
    const badgeTop = Math.round(mapHeight / 2 - 72);

    badgeSvgContent =
      '<g filter="url(#shadow)">' +
      '<rect x="' + badgeLeft + '" y="' + badgeTop + '" width="' + badgeWidth + '" height="' + badgeHeight + '" rx="8" ry="8" fill="#1f2c34" stroke="#00a884" stroke-width="1.5"/>' +
      '<polygon points="' + (width / 2 - 6) + ',' + (badgeTop + 29) + ' ' + (width / 2 + 6) + ',' + (badgeTop + 29) + ' ' + (width / 2) + ',' + (badgeTop + 35) + '" fill="#1f2c34" stroke="#00a884" stroke-width="1.5"/>' +
      '<line x1="' + (width / 2 - 5) + '" y1="' + (badgeTop + 29) + '" x2="' + (width / 2 + 5) + '" y2="' + (badgeTop + 29) + '" stroke="#1f2c34" stroke-width="2"/>' +
      '<circle cx="' + (badgeLeft + 14) + '" cy="' + (badgeTop + 15) + '" r="' + 6.5 + '" fill="#00a884"/>' +
      '<g transform="translate(' + (badgeLeft + 10) + ', ' + badgeTop + ')">' +
      badgePath.toSVG() +
      '</g>' +
      '</g>';
  }

  const pinX = Math.round(width / 2 - 20);
  const pinY = Math.round(mapHeight / 2 - 34);

  const mapOverlaySvg =
    '<svg width="' + width + '" height="' + mapHeight + '" xmlns="http://www.w3.org/2000/svg">' +
    '<defs>' +
    '<filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">' +
    '<feDropShadow dx="0" dy="2" stdDeviation="3" flood-color="black" flood-opacity="0.7"/>' +
    '</filter>' +
    '</defs>' +
    badgeSvgContent +
    '<g transform="translate(' + pinX + ', ' + pinY + ')" filter="url(#shadow)">' +
    '<ellipse cx="20" cy="38" rx="7" ry="2.5" fill="rgba(0,0,0,0.5)"/>' +
    '<path d="M20 2 C12.27 2 6 8.27 6 16 C6 26.5 20 38 20 38 C20 38 34 26.5 34 16 C34 8.27 27.73 2 20 2 Z" fill="#ea4335"/>' +
    '<circle cx="20" cy="16" r="5.5" fill="#ffffff"/>' +
    '<circle cx="20" cy="16" r="2.5" fill="#b31412"/>' +
    '</g>' +
    '</svg>';

  const mapWithPinAndBadge = await sharp(resizedMap)
    .composite([{ input: Buffer.from(mapOverlaySvg), left: 0, top: 0 }])
    .png()
    .toBuffer();

  // 3. Rodapé com PURE VECTOR PATHS (Zero caixas □□□□□)
  let footerSvg;

  if (loadedFont) {
    const titlePath = loadedFont.getPath(motelName, 16, 32, 15.5);
    titlePath.fill = '#e9edef';

    const addrPath = loadedFont.getPath(motelAddress, 16, 56, 12);
    addrPath.fill = '#8696a0';

    const linkPath = loadedFont.getPath('maps.google.com', 16, 82, 11.5);
    linkPath.fill = '#53bdeb';

    const timePath = loadedFont.getPath('16:09', width - 48, 82, 11);
    timePath.fill = '#8696a0';

    footerSvg =
      '<svg width="' + width + '" height="' + footerHeight + '" xmlns="http://www.w3.org/2000/svg">' +
      '<rect width="100%" height="100%" fill="#1f2c34"/>' +
      titlePath.toSVG() +
      addrPath.toSVG() +
      linkPath.toSVG() +
      timePath.toSVG() +
      '</svg>';
  } else {
    // Fallback caso a fonte não tenha carregado
    const escName = motelName.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const escAddr = motelAddress.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    footerSvg =
      '<svg width="' + width + '" height="' + footerHeight + '" xmlns="http://www.w3.org/2000/svg">' +
      '<rect width="100%" height="100%" fill="#1f2c34"/>' +
      '<text x="16" y="32" font-family="sans-serif" font-size="15.5" font-weight="bold" fill="#e9edef">' + escName + '</text>' +
      '<text x="16" y="56" font-family="sans-serif" font-size="12" fill="#8696a0">' + escAddr + '</text>' +
      '<text x="16" y="82" font-family="sans-serif" font-size="11.5" font-weight="bold" fill="#53bdeb">maps.google.com</text>' +
      '<text x="' + (width - 48) + '" y="82" font-family="sans-serif" font-size="11" fill="#8696a0">16:09</text>' +
      '</svg>';
  }

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
    { input: mapWithPinAndBadge, left: 0, top: 0 },
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
