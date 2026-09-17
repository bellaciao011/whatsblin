const sharp = require('sharp');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

// Templates em Português
const TEMPLATE_WITH_PHOTO_PT = path.join(__dirname, '../../assets/templates/template_com_foto.png');
const TEMPLATE_NO_PHOTO_LOCK_PT = path.join(__dirname, '../../assets/templates/template_sem_foto_cadeado.png');

// Templates oficiais em Espanhol (enviados pelo usuário)
const TEMPLATE_WITH_PHOTO_ES = path.join(__dirname, '../../assets/templates/template_com_foto_es.png');
const TEMPLATE_NO_PHOTO_LOCK_ES = path.join(__dirname, '../../assets/templates/template_sem_foto_cadeado_es.png');

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
 * Compõe o print de prova personalizado com suporte a múltiplos idiomas:
 * - Espanhol (es): Usa os prints em espanhol enviados com coordenadas perfeitamente alinhadas
 * - Português (pt): Usa os prints em português
 * 
 * Lógica condicional:
 * - Se avatarUrl for null/sem foto: Retorna o template do cadeado criptografado (Template 2)
 * - Se avatarUrl for válida: Estampa a foto redonda no áudio (Template 1)
 * 
 * @param {string|null} avatarUrl - URL da foto pública do alvo ou null
 * @param {Object} coords - Coordenadas X, Y e raio (opcional)
 * @param {string} language - 'es' ou 'pt'
 * @returns {Promise<Buffer>}
 */
async function composeProofImage(avatarUrl, coords = null, language = 'es') {
  const isEs = (language || 'es').toLowerCase() === 'es';

  // Seleciona os templates corretos por idioma
  const tplWithPhoto = isEs
    ? (fs.existsSync(TEMPLATE_WITH_PHOTO_ES) ? TEMPLATE_WITH_PHOTO_ES : TEMPLATE_WITH_PHOTO_PT)
    : (fs.existsSync(TEMPLATE_WITH_PHOTO_PT) ? TEMPLATE_WITH_PHOTO_PT : TEMPLATE_WITH_PHOTO_ES);

  const tplNoPhotoLock = isEs
    ? (fs.existsSync(TEMPLATE_NO_PHOTO_LOCK_ES) ? TEMPLATE_NO_PHOTO_LOCK_ES : TEMPLATE_NO_PHOTO_LOCK_PT)
    : (fs.existsSync(TEMPLATE_NO_PHOTO_LOCK_PT) ? TEMPLATE_NO_PHOTO_LOCK_PT : TEMPLATE_NO_PHOTO_LOCK_ES);

  // Coordenadas calibradas perfeitamente para cada template
  const defaultCoords = isEs
    ? { x: 136, y: 659, radius: 22 }
    : { x: 135, y: 657, radius: 18 };

  const effectiveCoords = {
    x: coords?.x || defaultCoords.x,
    y: coords?.y || defaultCoords.y,
    radius: coords?.radius || defaultCoords.radius
  };

  // CASO 1: Perfil sem foto pública (privacidade apenas para contatos ou sem foto)
  // Retorna o template oficial com cadeados amarelos de criptografia
  if (!avatarUrl) {
    console.log(`[ImageComposer] Perfil sem foto pública -> Selecionando Template 2 Cadeado Criptografado (Idioma: ${isEs ? 'ES' : 'PT'})`);
    if (fs.existsSync(tplNoPhotoLock)) {
      return fs.readFileSync(tplNoPhotoLock);
    }
  }

  // CASO 2: Perfil com foto disponível -> Estampa a foto redonda dentro do círculo do áudio
  const rawAvatarBuffer = await getAvatarBuffer(avatarUrl);

  if (!rawAvatarBuffer) {
    console.log(`[ImageComposer] Falha no download da foto -> Fallback para Template 2 Cadeado (Idioma: ${isEs ? 'ES' : 'PT'})`);
    if (fs.existsSync(tplNoPhotoLock)) {
      return fs.readFileSync(tplNoPhotoLock);
    }
  }

  const tplPath = fs.existsSync(tplWithPhoto) ? tplWithPhoto : FALLBACK_CROP;
  const tplMetadata = await sharp(tplPath).metadata();

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

  const finalImage = await sharp(tplPath)
    .composite([
      {
        input: circularAvatar,
        left: Math.round(left),
        top: Math.round(top)
      }
    ])
    .png()
    .toBuffer();

  console.log(`[ImageComposer] Template 1 gerado com sucesso com a foto do alvo estampada! (Idioma: ${isEs ? 'ES' : 'PT'})`);
  return finalImage;
}

module.exports = {
  composeProofImage,
  TEMPLATE_WITH_PHOTO_PT,
  TEMPLATE_NO_PHOTO_LOCK_PT,
  TEMPLATE_WITH_PHOTO_ES,
  TEMPLATE_NO_PHOTO_LOCK_ES,
  TEMPLATE_WITH_PHOTO: TEMPLATE_WITH_PHOTO_ES,
  TEMPLATE_NO_PHOTO_LOCK: TEMPLATE_NO_PHOTO_LOCK_ES
};
