const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const app = express();
app.set('trust proxy', 1);

// ======================
// MIDDLEWARE BEZPIECZEŃSTWA
// ======================

// Helmet - nagłówki bezpieczeństwa
app.use(helmet());

// CORS - pozwól na requesty z frontendu
app.use(cors({
    origin: [
        'http://localhost:5173',
        'http://localhost:3000',
        'https://angoralinks.vercel.app'
    ],
    credentials: true
}));

// Rate limiting - ochrona przed DDoS
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minut
    max: 100, // max 100 requestów per IP
    message: {
        error: 'Zbyt wiele żądań. Spróbuj ponownie później.'
    }
});
app.use('/api/', limiter);

// ======================
// PARSERY
// ======================

app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// ======================
// ROUTES
// ======================

// Import routes
const authRoutes = require('./routes/authRoutes');
const linkRoutes = require('./routes/linkRoutes');
const redirectRoutes = require('./routes/redirectRoutes');
const statsRoutes = require('./routes/statsRoutes');
const adminRoutes = require('./routes/adminRoutes');
const profileRoutes = require('./routes/profileRoutes');
const payoutRoutes = require('./routes/payoutRoutes');
const contactRoutes = require('./routes/contactRoutes');
const cpmRoutes = require('./routes/cpmRoutes');
const securityRoutes = require('./routes/securityRoutes'); // 🔥 NOWE - Security/IP

// Health check
app.get('/health', (req, res) => {
    res.status(200).json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        database: 'PostgreSQL (Supabase)',
        version: '1.2.0'
    });
});

// Główna strona API
app.get('/api', (req, res) => {
    res.json({
        message: 'AngoraLinks API',
        version: '1.2.0',
        endpoints: {
            health: '/health',
            auth: '/api/auth/*',
            links: '/api/links/*',
            stats: '/api/stats/*',
            payouts: '/api/payouts/*',
            cpm: '/api/cpm/*',
            security: '/api/admin/security/*' // 🔥 NOWE
        }
    });
});

// Auth routes
app.use('/api/auth', authRoutes);

// Link routes
app.use('/api/links', linkRoutes);

// Redirect routes (strona z reklamą)
app.use('/l', redirectRoutes);

// Stats routes
app.use('/api/stats', statsRoutes);

// Admin routes
app.use('/api/admin', adminRoutes);

// Profile routes
app.use('/api/profile', profileRoutes);

// Payout routes
app.use('/api/payouts', payoutRoutes);

// Contact routes (publiczny)
app.use('/api/contact', contactRoutes);

// CPM routes
app.use('/api/cpm', cpmRoutes);

// 🔥 Security routes (NOWE - panel bezpieczeństwa IP)
app.use('/api/admin/security', securityRoutes);

// ======================
// OBSŁUGA BŁĘDÓW
// ======================

// 404 - nie znaleziono
app.use((req, res, next) => {
    res.status(404).json({
        error: 'Nie znaleziono',
        path: req.originalUrl
    });
});

// Globalny error handler
app.use((err, req, res, next) => {
    console.error('Błąd:', err.message);
    
    res.status(err.status || 500).json({
        error: process.env.NODE_ENV === 'development' 
            ? err.message 
            : 'Wystąpił błąd serwera'
    });
});

// ======================
// START SERWERA
// ======================

const PORT = process.env.PORT || 3000;

console.log('🔧 Przygotowanie do uruchomienia...');
console.log(`📍 PORT z env: ${process.env.PORT}`);
console.log(`📍 Używany PORT: ${PORT}`);

const server = app.listen(PORT, '0.0.0.0', () => {
    console.log('====================================');
    console.log('🚀 AngoraLinks API uruchomiony!');
    console.log(`📍 Port: ${PORT}`);
    console.log(`📍 Host: 0.0.0.0`);
    console.log(`📍 Wersja: 1.2.0`);
    console.log('====================================');
});

server.on('error', (err) => {
    console.error('❌ Błąd serwera:', err);
});

module.exports = app;