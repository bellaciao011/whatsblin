const sharp = require('sharp');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const TEMPLATE_WITH_PHOTO = path.join(__dirname, '../../assets/templates/template_com_foto.png');
const TEMPLATE_NO_PHOTO_LOCK = path.join(__dirname, '../../assets/templates/template_sem_foto_cadeado.png');
const FALLBACK_CROP = path.join(__dirname, '../../assets/templates/print_screenshot_crop.png');

async function getAvatarBuffer(avatarUrl) {
  if (!avatarUrl) return null;
  try {
    const res = await axios.get(avatarUrl, {
      responseType: 'arraybuffer',
      timeout: 6000,
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
 * Compõe o print com lógica condicional:
 * - Se avatarUrl for null/não tiver foto: Retorna o template do cadeado amarelo (Print 2).
 * - Se avatarUrl for válida: Retorna o template com a foto redonda no áudio (Print 1).
 * 
 * @param {string|null} avatarUrl - URL da foto do alvo ou null
 * @param {Object} coords - Coordenadas X, Y e raio
 * @returns {Promise<Buffer>}
 */
async function composeProofImage(avatarUrl, coords = { x: 135, y: 657, radius: 18 }) {
  // CASO 1: Não tem foto de perfil pública (Privacidade só para contatos ou sem foto)
  // Usa o segundo print que já tem os cadeados amarelos nativos nas mensagens de áudio
  if (!avatarUrl) {
    console.log('[ImageComposer] Perfil sem foto pública -> Selecionando Template 2 (Cadeado Criptografado)');
    if (fs.existsSync(TEMPLATE_NO_PHOTO_LOCK)) {
      return fs.readFileSync(TEMPLATE_NO_PHOTO_LOCK);
    }
  }

  // CASO 2: Perfil com foto disponível -> Estampa no Template 1 (Bolinha branca do áudio)
  const tplPath = fs.existsSync(TEMPLATE_WITH_PHOTO) ? TEMPLATE_WITH_PHOTO : FALLBACK_CROP;
  const tplMetadata = await sharp(tplPath).metadata();

  const radius = Math.max(8, parseInt(coords.radius, 10) || 18);
  const diam = radius * 2;
  const centerX = parseInt(coords.x, 10) || 135;
  const centerY = parseInt(coords.y, 10) || 657;

  const left = Math.max(0, Math.min(tplMetadata.width - diam, centerX - radius));
  const top = Math.max(0, Math.min(tplMetadata.height - diam, centerY - radius));

  const rawAvatarBuffer = await getAvatarBuffer(avatarUrl);

  if (!rawAvatarBuffer) {
    // Se falhou o download mesmo tendo URL, envia o print com cadeado para ficar perfeito
    console.log('[ImageComposer] Falha no download do avatar -> Fallback para Template 2 (Cadeado)');
    if (fs.existsSync(TEMPLATE_NO_PHOTO_LOCK)) {
      return fs.readFileSync(TEMPLATE_NO_PHOTO_LOCK);
    }
  }

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

  console.log('[ImageComposer] Template 1 gerado com sucesso com a foto do alvo estampada!');
  return finalImage;
}

module.exports = {
  composeProofImage,
  TEMPLATE_WITH_PHOTO,
  TEMPLATE_NO_PHOTO_LOCK
};
