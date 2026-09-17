const { eventBus } = require('./flowEngine');

// Map em memória para armazenar o timestamp do último alerta disparado por chip
const lastDisconnectAlertTime = new Map();

/**
 * Notifica desconexão do WhatsApp com proteção estrita contra falso-positivo e spam.
 * @param {object} instance - Objeto da instância
 * @param {string} reason - Motivo ou origem da detecção
 * @returns {boolean} - true se o alerta foi emitido, false se foi suprimido por cooldown
 */
function notifyChipDisconnected(instance, reason = '') {
  if (!instance) return false;
  const id = instance.id || instance.instance_id || 'unknown';
  const now = Date.now();
  const lastAlert = lastDisconnectAlertTime.get(id) || 0;

  // Cooldown de 2 minutos (120s) por instância para impedir múltiplos alertas repetidos
  if (now - lastAlert < 120000) {
    console.log(`[Alert Cooldown] ℹ️ Alerta de desconexão para "${instance.name}" (${id}) suprimido por cooldown (último disparo há ${Math.round((now - lastAlert) / 1000)}s)`);
    return false;
  }

  lastDisconnectAlertTime.set(id, now);
  console.warn(`[Alert] 🚨 Emitindo alerta oficial de chip desconectado para: "${instance.name}" (${id})${reason ? ' | Motivo: ' + reason : ''}`);

  eventBus.emit('chip_disconnected', {
    id: id,
    instanceId: id,
    name: instance.name || 'WhatsApp',
    phone: instance.numero_conectado || instance.phoneNumber || '',
    reason: reason,
    timestamp: new Date().toISOString()
  });

  return true;
}

/**
 * Limpa o cooldown quando o chip volta a ficar conectado.
 * Assim, se o chip desconectar no futuro, o alerta disparará de imediato.
 * @param {string} instanceId
 */
function clearChipDisconnectedCooldown(instanceId) {
  if (instanceId) {
    lastDisconnectAlertTime.delete(instanceId);
  }
}

module.exports = {
  notifyChipDisconnected,
  clearChipDisconnectedCooldown
};
