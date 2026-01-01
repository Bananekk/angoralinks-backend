// app.js
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

app.use(helmet());

app.use(cors({
    origin: [
        'http://localhost:5173',
        'http://localhost:3000',
        'https://angoralinks.pl'
    ],
    credentials: true
}));

const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
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

const authRoutes = require('./routes/authRoutes');
const linkRoutes = require('./routes/linkRoutes');
const redirectRoutes = require('./routes/redirectRoutes');
const statsRoutes = require('./routes/statsRoutes');
const adminRoutes = require('./routes/adminRoutes');
const profileRoutes = require('./routes/profileRoutes');
const payoutRoutes = require('./routes/payoutRoutes');
const contactRoutes = require('./routes/contactRoutes');
const cpmRoutes = require('./routes/cpmRoutes');
const securityRoutes = require('./routes/securityRoutes');
const referralRoutes = require('./routes/referralRoutes');
const twoFactorRoutes = require('./routes/twoFactorRoutes'); // 🆕 2FA

// Health check
app.get('/health', (req, res) => {
    res.status(200).json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        database: 'PostgreSQL (Supabase)',
        version: '1.4.0'  // 🆕 Bump wersji
    });
});

// Główna strona API
app.get('/api', (req, res) => {
    res.json({
        message: 'AngoraLinks API',
        version: '1.4.0',
        endpoints: {
            health: '/health',
            auth: '/api/auth/*',
            links: '/api/links/*',
            stats: '/api/stats/*',
            payouts: '/api/payouts/*',
            cpm: '/api/cpm/*',
            referrals: '/api/referrals/*',
            twoFactor: '/api/2fa/*',  // 🆕 NOWE
            security: '/api/admin/security/*'
        }
    });
});

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/links', linkRoutes);
app.use('/l', redirectRoutes);
app.use('/api/stats', statsRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/profile', profileRoutes);
app.use('/api/payouts', payoutRoutes);
app.use('/api/contact', contactRoutes);
app.use('/api/cpm', cpmRoutes);
app.use('/api/admin/security', securityRoutes);
app.use('/api/referrals', referralRoutes);
app.use('/api/2fa', twoFactorRoutes); // 🆕 2FA

// ======================
// OBSŁUGA BŁĘDÓW
// ======================

app.use((req, res, next) => {
    res.status(404).json({
        error: 'Nie znaleziono',
        path: req.originalUrl
    });
});

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
    console.log(`📍 Wersja: 1.4.0`);
    console.log(`🔐 2FA: ${process.env.TWO_FACTOR_ENCRYPTION_KEY ? 'Skonfigurowane' : 'BRAK KLUCZA!'}`);
    console.log('====================================');
});

server.on('error', (err) => {
    console.error('❌ Błąd serwera:', err);
});

module.exports = app;