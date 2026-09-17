const sharp = require('sharp');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const locationService = require('./locationService');

// Templates em Português
const TEMPLATE_WITH_PHOTO_PT = path.join(__dirname, '../../assets/templates/template_com_foto.png');
const TEMPLATE_NO_PHOTO_LOCK_PT = path.join(__dirname, '../../assets/templates/template_sem_foto_cadeado.png');

// Templates oficiais em Espanhol (enviados pelo usuário)
const TEMPLATE_WITH_PHOTO_ES = path.join(__dirname, '../../assets/templates/template_com_foto_es.png');
const TEMPLATE_NO_PHOTO_LOCK_ES = path.join(__dirname, '../../assets/templates/template_sem_foto_cadeado_es.png');

// Avatar de perfil protegido com cadeado (para quando o número não possuir foto pública)
const LOCKED_PROFILE_AVATAR = path.join(__dirname, '../../assets/templates/avatar_locked_profile.png');

const FALLBACK_CROP = path.join(__dirname, '../../assets/templates/print_screenshot_crop.png');

async function getAvatarBuffer(avatarUrl) {
  if (!avatarUrl) return null;
  if (Buffer.isBuffer(avatarUrl)) return avatarUrl;
  if (typeof avatarUrl === 'string' && (avatarUrl.startsWith('data:') || (avatarUrl.length > 300 && !avatarUrl.startsWith('http')))) {
    try {
      const base64Data = avatarUrl.includes(',') ? avatarUrl.split(',')[1] : avatarUrl;
      return Buffer.from(base64Data, 'base64');
    } catch (e) {
      console.warn('[ImageComposer] Erro ao decodificar avatar base64:', e.message);
      return null;
    }
  }
  try {
    const res = await axios.get(avatarUrl, {
      responseType: 'arraybuffer',
      timeout: 7000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
      }
    });
    return Buffer.from(res.data);
  } catch (err) {
    console.warn('[ImageComposer] Erro ao baixar foto de perfil:', err.message);
    return null;
  }
}

/**
 * Compõe o print de prova oficial da conversa com o motel mais próximo do visitante:
 * 
 * - Se o alvo possuir foto pública: estampa a foto redonda no áudio.
 * - Se o alvo NÃO possuir foto pública (ou falhar): estampa o ícone oficial de perfil bloqueado com cadeado.
 * - Em AMBOS os casos, envia a conversa oficial completa com o card dinâmico de localização do motel na cidade do visitante.
 * 
 * @param {string|null} avatarUrl - URL da foto pública do alvo ou null
 * @param {Object} coords - Coordenadas X, Y e raio (opcional)
 * @param {string} language - 'es' ou 'pt'
 * @param {Object} options - { clientIp, timeZone, phone, ddi, cityHint, forceLockScreen }
 * @returns {Promise<Buffer>}
 */
async function composeProofImage(avatarUrl, coords = null, language = 'es', options = {}) {
  const isEs = (language || 'es').toLowerCase() === 'es';

  // Seleciona os templates corretos por idioma
  const tplWithPhoto = isEs
    ? (fs.existsSync(TEMPLATE_WITH_PHOTO_ES) ? TEMPLATE_WITH_PHOTO_ES : TEMPLATE_WITH_PHOTO_PT)
    : (fs.existsSync(TEMPLATE_WITH_PHOTO_PT) ? TEMPLATE_WITH_PHOTO_PT : TEMPLATE_WITH_PHOTO_ES);

  const tplNoPhotoLock = isEs
    ? (fs.existsSync(TEMPLATE_NO_PHOTO_LOCK_ES) ? TEMPLATE_NO_PHOTO_LOCK_ES : TEMPLATE_NO_PHOTO_LOCK_PT)
    : (fs.existsSync(TEMPLATE_NO_PHOTO_LOCK_PT) ? TEMPLATE_NO_PHOTO_LOCK_PT : TEMPLATE_NO_PHOTO_LOCK_ES);

  // Se explicitamente solicitado a tela antiga com todos os cadeados
  if (options.forceLockScreen && !avatarUrl) {
    console.log(`[ImageComposer] forceLockScreen ativo -> Selecionando Template antigo Cadeado Criptografado (Idioma: ${isEs ? 'ES' : 'PT'})`);
    if (fs.existsSync(tplNoPhotoLock)) {
      return fs.readFileSync(tplNoPhotoLock);
    }
  }

  // Sempre utiliza o template principal da conversa com localização
  const tplPath = fs.existsSync(tplWithPhoto) ? tplWithPhoto : FALLBACK_CROP;
  const tplMetadata = await sharp(tplPath).metadata();

  const composites = [];

  // 1. GERAÇÃO E COMPOSIÇÃO DO CARD DE LOCALIZAÇÃO DO MOTEL MAIS PRÓXIMO DO VISITANTE
  if (options.useLocation !== false) {
    try {
      console.log('[ImageComposer] 📍 Buscando localização para visitante...');
      const geo = await locationService.detectVisitorGeo({
        clientIp: options.clientIp,
        timeZone: options.timeZone,
        phone: options.phone,
        ddi: options.ddi,
        cityHint: options.cityHint
      });
      console.log(`[ImageComposer] 📍 Cidade detectada: ${geo.city}, ${geo.country} (${geo.countryCode})`);

      const motel = await locationService.getNearestMotel(geo);
      console.log(`[ImageComposer] 🏨 Motel selecionado: "${motel.name}" em "${motel.address}"`);

      // Dimensões calibradas do card de localização no WhatsApp
      const locCardWidth = 380;
      const locCardHeight = 325;
      const locCardLeft = 23;
      const locCardTop = 110;

      const locationCardBuffer = await locationService.renderLocationCard(motel, locCardWidth, locCardHeight);

      composites.push({
        input: locationCardBuffer,
        left: locCardLeft,
        top: locCardTop
      });
    } catch (locErr) {
      console.warn('[ImageComposer] Erro ao gerar card de localização:', locErr.message);
    }
  }

  // 2. ESTAMPAGEM DO AVATAR NO ÁUDIO (FOTO DO ALVO OU AVATAR COM CADEADO)
  let rawAvatarBuffer = await getAvatarBuffer(avatarUrl);
  let isLockedAvatar = false;

  if (!rawAvatarBuffer) {
    console.log('[ImageComposer] 🔒 Foto do perfil não encontrada ou privada -> Utilizando avatar com cadeado no áudio!');
    if (fs.existsSync(LOCKED_PROFILE_AVATAR)) {
      rawAvatarBuffer = fs.readFileSync(LOCKED_PROFILE_AVATAR);
      isLockedAvatar = true;
    }
  }

  if (rawAvatarBuffer) {
    // Coordenadas calibradas perfeitamente para o template
    const defaultCoords = isEs
      ? { x: 136, y: 657, radius: 20 }
      : { x: 135, y: 657, radius: 18 };

    const effectiveCoords = {
      x: coords?.x || defaultCoords.x,
      y: coords?.y || defaultCoords.y,
      radius: coords?.radius || defaultCoords.radius
    };

    const radius = Math.max(8, parseInt(effectiveCoords.radius, 10) || defaultCoords.radius);
    const diam = radius * 2;
    const centerX = parseInt(effectiveCoords.x, 10) || defaultCoords.x;
    const centerY = parseInt(effectiveCoords.y, 10) || defaultCoords.y;

    const left = Math.max(0, Math.min(tplMetadata.width - diam, centerX - radius));
    const top = Math.max(0, Math.min(tplMetadata.height - diam, centerY - radius));

    const circularMask = Buffer.from(
      '<svg width="' + diam + '" height="' + diam + '"><circle cx="' + radius + '" cy="' + radius + '" r="' + radius + '" fill="white"/></svg>'
    );

    const circularAvatar = await sharp(rawAvatarBuffer)
      .resize(diam, diam, { fit: 'cover' })
      .composite([{ input: circularMask, blend: 'dest-in' }])
      .png()
      .toBuffer();

    composites.push({
      input: circularAvatar,
      left: Math.round(left),
      top: Math.round(top)
    });
    console.log(`[ImageComposer] ${isLockedAvatar ? '🔒 Avatar protegido com CADEADO' : '✓ Foto pública do alvo'} estampado no círculo do áudio com sucesso! (x: ${Math.round(left)}, y: ${Math.round(top)})`);
  }

  // Realiza a composição final
  const finalImage = await sharp(tplPath)
    .composite(composites)
    .png()
    .toBuffer();

  console.log(`[ImageComposer] Imagem de prova final gerada com sucesso! (Camadas: ${composites.length}, Idioma: ${isEs ? 'ES' : 'PT'})`);
  return finalImage;
}

module.exports = {
  composeProofImage,
  TEMPLATE_WITH_PHOTO_PT,
  TEMPLATE_NO_PHOTO_LOCK_PT,
  TEMPLATE_WITH_PHOTO_ES,
  TEMPLATE_NO_PHOTO_LOCK_ES,
  LOCKED_PROFILE_AVATAR,
  TEMPLATE_WITH_PHOTO: TEMPLATE_WITH_PHOTO_ES,
  TEMPLATE_NO_PHOTO_LOCK: TEMPLATE_NO_PHOTO_LOCK_ES
};
