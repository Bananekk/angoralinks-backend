const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const adminRoutes = require('./routes/adminRoutes');
const profileRoutes = require('./routes/profileRoutes');
const payoutRoutes = require('./routes/payoutRoutes'); // DODANE
const contactRoutes = require('./routes/contactRoutes');
require('dotenv').config();

const app = express();

// ======================
// MIDDLEWARE BEZPIECZEŃSTWA
// ======================

// Helmet - nagłówki bezpieczeństwa
app.use(helmet());

// CORS - pozwól na requesty z frontendu
app.use(cors({
    origin: [
        'http://localhost:5173',
        'https://angoralinks-frontend.vercel.app'
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

// Health check
app.get('/health', (req, res) => {
    const { debugDB } = require('./utils/memoryDB');
    res.status(200).json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        database: 'memory (temporary)',
        stats: debugDB()
    });
});

// Główna strona API
app.get('/api', (req, res) => {
    res.json({
        message: 'Linkvertise Clone API',
        version: '1.0.0',
        endpoints: {
            health: '/health',
            auth: '/api/auth/*',
            links: '/api/links/*',
            stats: '/api/stats/*',
            payouts: '/api/payouts/*' // DODANE
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

// Payout routes - DODANE
app.use('/api/payouts', payoutRoutes);

// Contact routes (publiczny)
app.use('/api/contact', contactRoutes);

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

app.listen(PORT, () => {
    console.log(`
    ====================================
    🚀 Serwer uruchomiony!
    📍 http://localhost:${PORT}
    📍 Health: http://localhost:${PORT}/health
    📍 API: http://localhost:${PORT}/api
    ====================================
    `);
});

module.exports = app;