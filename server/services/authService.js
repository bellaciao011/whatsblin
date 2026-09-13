const crypto = require('crypto');
const db = require('../storage/db');

// Segredo para assinatura de sessão (pode ser definido via ENV no Railway)
const AUTH_SECRET = process.env.AUTH_SECRET || process.env.RAILWAY_SERVICE_ID || 'hub_whatsblin_auth_secret_token_2026';

/**
 * Obtém as credenciais válidas configuradas (prioriza variáveis de ambiente, fallback para settings.json)
 */
function getValidCredentials() {
  const settings = db.getSettings();
  const username = process.env.ADMIN_USERNAME || settings.auth?.username || 'admin';
  const password = process.env.ADMIN_PASSWORD || settings.auth?.password || 'admin123';
  return { username, password };
}

/**
 * Gera um token assinado (HMAC-SHA256) válido por 7 dias
 */
function generateToken(username) {
  const expires = Date.now() + 7 * 24 * 60 * 60 * 1000;
  const payload = `${username}:${expires}`;
  const hmac = crypto.createHmac('sha256', AUTH_SECRET).update(payload).digest('hex');
  return Buffer.from(`${payload}:${hmac}`).toString('base64');
}

/**
 * Valida a integridade e expiração do token
 */
function verifyToken(token) {
  if (!token) return null;
  try {
    const raw = Buffer.from(token, 'base64').toString('utf8');
    const parts = raw.split(':');
    if (parts.length !== 3) return null;

    const [username, expiresStr, hmac] = parts;
    const expires = parseInt(expiresStr, 10);
    if (isNaN(expires) || Date.now() > expires) return null;

    const expectedHmac = crypto.createHmac('sha256', AUTH_SECRET).update(`${username}:${expires}`).digest('hex');
    if (hmac === expectedHmac) {
      return { username, expires };
    }
  } catch (err) {
    return null;
  }
  return null;
}

/**
 * Valida o usuário e senha
 */
function validateCredentials(username, password) {
  const creds = getValidCredentials();
  return (
    username &&
    password &&
    username.trim().toLowerCase() === creds.username.trim().toLowerCase() &&
    password === creds.password
  );
}

/**
 * Atualiza usuário e senha no settings.json
 */
function updateCredentials(newUsername, newPassword) {
  const settings = db.getSettings();
  settings.auth = {
    username: newUsername || settings.auth?.username || 'admin',
    password: newPassword || settings.auth?.password || 'admin123',
    updatedAt: new Date().toISOString()
  };
  db.saveSettings(settings);
  return settings.auth;
}

/**
 * Extrai cookies da requisição HTTP
 */
function parseCookies(req) {
  const list = {};
  const rc = req.headers?.cookie;
  if (!rc) return list;
  rc.split(';').forEach(cookie => {
    const parts = cookie.split('=');
    const key = parts[0]?.trim();
    if (key) list[key] = decodeURIComponent(parts.slice(1).join('=').trim());
  });
  return list;
}

module.exports = {
  generateToken,
  verifyToken,
  validateCredentials,
  updateCredentials,
  parseCookies,
  getValidCredentials
};
