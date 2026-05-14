require('dotenv').config();
const express = require('express');
const cors = require('cors');

const authRoutes = require('./src/routes/auth');
const cigarsRoutes = require('./src/routes/cigars');
const searchRoutes = require('./src/routes/search');
const scannerRoutes = require('./src/routes/scanner');
const profileRoutes = require('./src/routes/profile');
const communityRoutes = require('./src/routes/community');
const adminRoutes = require('./src/routes/admin');
const homeRoutes = require('./src/routes/home');

const app = express();

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', version: '2.0.0', timestamp: new Date().toISOString() });
});

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/cigars', cigarsRoutes);
app.use('/api/search', searchRoutes);
app.use('/api/scanner', scannerRoutes);
app.use('/api/profile', profileRoutes);
app.use('/api/community', communityRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/home', homeRoutes);

// 404
app.use((req, res) => {
  res.status(404).json({ error: 'Route introuvable' });
});

// Error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Erreur interne du serveur' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚬 Cigarino v2.0 backend démarré sur le port ${PORT}`);
});
