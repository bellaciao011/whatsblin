const express = require('express');
const cors = require('cors');
const path = require('path');
const db = require('./storage/db');

const webhookRoutes = require('./routes/webhook');
const apiRoutes = require('./routes/api');

const app = express();

// Middlewares
app.use(cors());
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));

// Servir frontend e mídias estáticas
app.use(express.static(path.join(__dirname, '../public')));
app.use('/assets', express.static(path.join(__dirname, '../assets')));

// Rotas
app.use('/webhook', webhookRoutes);
app.use('/api', apiRoutes);

// Fallback SPA
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Inicialização
const settings = db.getSettings();
const PORT = process.env.PORT || settings.serverPort || 3000;

app.listen(PORT, () => {
  console.log('====================================================');
  console.log(`🚀 WHATSAPP AUTOMATION HUB RODANDO COM SUCESSO!`);
  console.log(`🌐 Dashboard: http://localhost:${PORT}`);
  console.log(`📡 Webhook Meta: http://localhost:${PORT}/webhook`);
  console.log('====================================================');
});
