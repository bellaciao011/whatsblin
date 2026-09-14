const crypto = require('crypto');
const db = require('../storage/db');

// Algoritmo simétrico seguro com autenticação de integridade (GCM)
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96 bits recomendado para GCM
const TAG_LENGTH = 16; // 128 bits para auth tag

/**
 * Obtém ou deriva a chave mestra de criptografia (32 bytes)
 */
function getEncryptionKey() {
  const settings = db.getSettings();
  const secret = process.env.ENCRYPTION_SECRET || settings.encryptionSecret || 'whatshub-uazapi-vault-encryption-key-2026';
  return crypto.createHash('sha256').update(String(secret)).digest();
}

/**
 * Criptografa uma string sensível (ex: instance_token da uazapi)
 * Retorna no formato seguro: ivHex:authTagHex:encryptedHex
 */
function encrypt(text) {
  if (!text || typeof text !== 'string') return text;
  
  // Se já estiver no formato criptografado, não cifra novamente
  if (/^[0-9a-f]{24}:[0-9a-f]{32}:[0-9a-f]+$/i.test(text)) {
    return text;
  }

  try {
    const iv = crypto.randomBytes(IV_LENGTH);
    const key = getEncryptionKey();
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    const authTag = cipher.getAuthTag();

    return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
  } catch (err) {
    console.error('[CryptoService] Erro ao criptografar token:', err.message);
    return text;
  }
}

/**
 * Descriptografa uma string cifrada no formato ivHex:authTagHex:encryptedHex
 */
function decrypt(cipherText) {
  if (!cipherText || typeof cipherText !== 'string') return cipherText;

  // Se não estiver no formato esperado, assume que é texto plano
  const parts = cipherText.split(':');
  if (parts.length !== 3) {
    return cipherText;
  }

  try {
    const [ivHex, authTagHex, encryptedHex] = parts;
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    const key = getEncryptionKey();

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  } catch (err) {
    console.warn('[CryptoService] Falha ao descriptografar token (possível texto plano ou chave inválida):', err.message);
    return cipherText;
  }
}

module.exports = {
  encrypt,
  decrypt
};
