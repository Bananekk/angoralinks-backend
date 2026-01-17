// app.js
console.log('🔧 Starting app.js...');

process.on('uncaughtException', (err) => {
    console.error('❌ UNCAUGHT EXCEPTION:', err);
    process.exit(1);
});

process.on('unhandledRejection', (err) => {
    console.error('❌ UNHANDLED REJECTION:', err);
    process.exit(1);
});

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

console.log('✅ Core modules loaded');

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
        'https://angoralinks.pl',
        'https://www.angoralinks.pl',
        process.env.RENDER_EXTERNAL_URL
    ].filter(Boolean),
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

console.log('✅ Middleware configured');

// ======================
// ROUTES - BEZPIECZNE IMPORTY
// ======================

let authRoutes, linkRoutes, redirectRoutes, statsRoutes, adminRoutes;
let profileRoutes, payoutRoutes, contactRoutes, cpmRoutes, securityRoutes;
let referralRoutes, twoFactorRoutes;

try {
    authRoutes = require('./routes/authRoutes');
    console.log('✅ authRoutes loaded');
} catch (e) {
    console.error('❌ authRoutes error:', e.message);
}

try {
    linkRoutes = require('./routes/linkRoutes');
    console.log('✅ linkRoutes loaded');
} catch (e) {
    console.error('❌ linkRoutes error:', e.message);
}

try {
    redirectRoutes = require('./routes/redirectRoutes');
    console.log('✅ redirectRoutes loaded');
} catch (e) {
    console.error('❌ redirectRoutes error:', e.message);
}

try {
    statsRoutes = require('./routes/statsRoutes');
    console.log('✅ statsRoutes loaded');
} catch (e) {
    console.error('❌ statsRoutes error:', e.message);
}

try {
    adminRoutes = require('./routes/adminRoutes');
    console.log('✅ adminRoutes loaded');
} catch (e) {
    console.error('❌ adminRoutes error:', e.message);
}

try {
    profileRoutes = require('./routes/profileRoutes');
    console.log('✅ profileRoutes loaded');
} catch (e) {
    console.error('❌ profileRoutes error:', e.message);
}

try {
    payoutRoutes = require('./routes/payoutRoutes');
    console.log('✅ payoutRoutes loaded');
} catch (e) {
    console.error('❌ payoutRoutes error:', e.message);
}

try {
    contactRoutes = require('./routes/contactRoutes');
    console.log('✅ contactRoutes loaded');
} catch (e) {
    console.error('❌ contactRoutes error:', e.message);
}

try {
    cpmRoutes = require('./routes/cpmRoutes');
    console.log('✅ cpmRoutes loaded');
} catch (e) {
    console.error('❌ cpmRoutes error:', e.message);
}

try {
    securityRoutes = require('./routes/securityRoutes');
    console.log('✅ securityRoutes loaded');
} catch (e) {
    console.error('❌ securityRoutes error:', e.message);
}

try {
    referralRoutes = require('./routes/referralRoutes');
    console.log('✅ referralRoutes loaded');
} catch (e) {
    console.error('❌ referralRoutes error:', e.message);
}

try {
    twoFactorRoutes = require('./routes/twoFactorRoutes');
    console.log('✅ twoFactorRoutes loaded');
} catch (e) {
    console.error('❌ twoFactorRoutes error:', e.message);
}

// Health check
app.get('/health', (req, res) => {
    res.status(200).json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        database: 'PostgreSQL (Supabase)',
        version: '1.4.0'
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
            twoFactor: '/api/2fa/*',
            security: '/api/admin/security/*'
        }
    });
});

// Routes - bezpieczne montowanie
if (authRoutes) app.use('/api/auth', authRoutes);
if (linkRoutes) app.use('/api/links', linkRoutes);
if (redirectRoutes) app.use('/l', redirectRoutes);
if (statsRoutes) app.use('/api/stats', statsRoutes);
if (adminRoutes) app.use('/api/admin', adminRoutes);
if (profileRoutes) app.use('/api/profile', profileRoutes);
if (payoutRoutes) app.use('/api/payouts', payoutRoutes);
if (contactRoutes) app.use('/api/contact', contactRoutes);
if (cpmRoutes) app.use('/api/cpm', cpmRoutes);
if (securityRoutes) app.use('/api/admin/security', securityRoutes);
if (referralRoutes) app.use('/api/referrals', referralRoutes);
if (twoFactorRoutes) app.use('/api/2fa', twoFactorRoutes);

console.log('✅ Routes mounted');

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
console.log(`📍 PORT: ${PORT}`);
console.log(`🔐 2FA Key: ${process.env.TWO_FACTOR_ENCRYPTION_KEY ? 'SET' : 'MISSING!'}`);
console.log(`📧 Resend: ${process.env.RESEND_API_KEY ? 'SET' : 'MISSING!'}`);

const server = app.listen(PORT, '0.0.0.0', () => {
    console.log('====================================');
    console.log('🚀 AngoraLinks API uruchomiony!');
    console.log(`📍 Port: ${PORT}`);
    console.log(`📍 Wersja: 1.4.0`);
    console.log('====================================');
});

server.on('error', (err) => {
    console.error('❌ Błąd serwera:', err);
});

module.exports = app;