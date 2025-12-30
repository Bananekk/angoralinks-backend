const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { PrismaClient } = require('@prisma/client');
const { sendVerificationEmail, sendWelcomeEmail } = require('../utils/email');
const { verifyToken } = require('../middleware/auth');

const router = express.Router();
const prisma = new PrismaClient();

// Pomocnicze funkcje (jeśli encryption nie istnieje)
let encrypt, getClientIp, getUserAgent;
try {
    encrypt = require('../utils/encryption').encrypt;
} catch (e) {
    encrypt = (text) => text; // fallback
}
try {
    const ipHelper = require('../utils/ipHelper');
    getClientIp = ipHelper.getClientIp;
    getUserAgent = ipHelper.getUserAgent;
} catch (e) {
    getClientIp = (req) => req.ip || 'unknown';
    getUserAgent = (req) => req.headers['user-agent'] || 'unknown';
}

// =====================================
// Funkcja generująca 6-cyfrowy kod
// =====================================
function generateVerificationCode() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

// =====================================
// POST /api/auth/register - Rejestracja
// =====================================
router.post('/register', async (req, res) => {
    try {
        const { email, password } = req.body;
        
        if (!email || !password) {
            return res.status(400).json({ 
                error: 'Email i hasło są wymagane' 
            });
        }
        
        if (password.length < 8) {
            return res.status(400).json({ 
                error: 'Hasło musi mieć minimum 8 znaków' 
            });
        }
        
        const existingUser = await prisma.user.findUnique({
            where: { email: email.toLowerCase() }
        });
        
        if (existingUser) {
            return res.status(400).json({ 
                error: 'Użytkownik z tym emailem już istnieje' 
            });
        }
        
        const hashedPassword = await bcrypt.hash(password, 12);
        const verificationCode = generateVerificationCode();
        const clientIp = getClientIp(req);
        const userAgent = getUserAgent(req);
        const encryptedIp = encrypt(clientIp);
        
        const user = await prisma.user.create({
            data: {
                email: email.toLowerCase(),
                password_hash: hashedPassword,
                verification_code: verificationCode,
                verification_expires: new Date(Date.now() + 24 * 60 * 60 * 1000),
                registrationIp: encryptedIp,
                lastLoginIp: encryptedIp,
                lastLoginAt: new Date()
            }
        });
        
        // Zapisz log IP
        try {
            await prisma.ipLog.create({
                data: {
                    userId: user.id,
                    encryptedIp: encryptedIp || 'unknown',
                    action: 'REGISTER',
                    userAgent: userAgent?.substring(0, 500)
                }
            });
        } catch (e) {
            console.warn('Nie udało się zapisać IP log:', e.message);
        }
        
        // Wyślij email weryfikacyjny
        try {
            await sendVerificationEmail(email, verificationCode);
        } catch (emailError) {
            console.error('Błąd wysyłania emaila:', emailError.message);
        }
        
        res.status(201).json({
            success: true,
            message: 'Konto zostało utworzone. Sprawdź email aby je zweryfikować.'
        });
        
    } catch (error) {
        console.error('Błąd rejestracji:', error);
        res.status(500).json({ 
            error: 'Błąd serwera podczas rejestracji' 
        });
    }
});

// =====================================
// POST /api/auth/login - Logowanie
// =====================================
router.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        
        if (!email || !password) {
            return res.status(400).json({ 
                error: 'Email i hasło są wymagane' 
            });
        }
        
        const user = await prisma.user.findUnique({
            where: { email: email.toLowerCase() }
        });
        
        if (!user) {
            return res.status(401).json({ 
                error: 'Nieprawidłowy email lub hasło' 
            });
        }
        
        if (!user.isActive) {
            return res.status(403).json({ 
                error: 'Twoje konto zostało zablokowane' 
            });
        }
        
        const isPasswordValid = await bcrypt.compare(password, user.password_hash);
        
        if (!isPasswordValid) {
            return res.status(401).json({ 
                error: 'Nieprawidłowy email lub hasło' 
            });
        }
        
        if (!user.isVerified) {
            return res.status(403).json({ 
                error: 'Zweryfikuj swój email przed zalogowaniem',
                needsVerification: true
            });
        }
        
        const clientIp = getClientIp(req);
        const userAgent = getUserAgent(req);
        const encryptedIp = encrypt(clientIp);
        
        // Aktualizuj ostatnie logowanie
        await prisma.user.update({
            where: { id: user.id },
            data: {
                lastLoginIp: encryptedIp,
                lastLoginAt: new Date()
            }
        });
        
        // Zapisz log IP
        try {
            await prisma.ipLog.create({
                data: {
                    userId: user.id,
                    encryptedIp: encryptedIp || 'unknown',
                    action: 'LOGIN',
                    userAgent: userAgent?.substring(0, 500)
                }
            });
        } catch (e) {
            console.warn('Nie udało się zapisać IP log:', e.message);
        }
        
        const token = jwt.sign(
            { 
                userId: user.id, 
                email: user.email,
                isAdmin: user.isAdmin 
            },
            process.env.JWT_SECRET,
            { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
        );
        
        res.json({
            success: true,
            message: 'Zalogowano pomyślnie',
            token,
            user: {
                id: user.id,
                email: user.email,
                isAdmin: user.isAdmin,
                balance: parseFloat(user.balance) || 0,
                totalEarned: parseFloat(user.totalEarned) || 0
            }
        });
        
    } catch (error) {
        console.error('Błąd logowania:', error);
        res.status(500).json({ 
            error: 'Błąd serwera podczas logowania' 
        });
    }
});

// =====================================
// POST /api/auth/verify - Weryfikacja kodem 6-cyfrowym
// =====================================
router.post('/verify', async (req, res) => {
    try {
        const { email, code } = req.body;
        
        if (!email || !code) {
            return res.status(400).json({ 
                error: 'Email i kod są wymagane' 
            });
        }
        
        const user = await prisma.user.findFirst({
            where: { 
                email: email.toLowerCase(),
                verification_code: code,
                verification_expires: { gte: new Date() }
            }
        });
        
        if (!user) {
            return res.status(400).json({ 
                error: 'Nieprawidłowy lub wygasły kod weryfikacyjny' 
            });
        }
        
        // Zweryfikuj użytkownika
        await prisma.user.update({
            where: { id: user.id },
            data: {
                isVerified: true,
                verification_code: null,
                verification_expires: null
            }
        });

        // Wyślij welcome email
        console.log('🔔 Wysyłam welcome email do:', user.email);
        sendWelcomeEmail(user.email)
            .then(() => console.log('✅ Welcome email wysłany!'))
            .catch(err => console.error('❌ Welcome email error:', err));

        // Wygeneruj token JWT (automatyczne logowanie)
        const token = jwt.sign(
            { 
                userId: user.id, 
                email: user.email,
                isAdmin: user.isAdmin 
            },
            process.env.JWT_SECRET,
            { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
        );
        
        res.json({
            success: true,
            message: 'Email został zweryfikowany!',
            token,
            user: {
                id: user.id,
                email: user.email,
                isAdmin: user.isAdmin,
                balance: parseFloat(user.balance) || 0,
                totalEarned: parseFloat(user.totalEarned) || 0
            }
        });
        
    } catch (error) {
        console.error('Błąd weryfikacji:', error);
        res.status(500).json({ 
            error: 'Błąd serwera podczas weryfikacji' 
        });
    }
});

// =====================================
// GET /api/auth/verify/:token - Weryfikacja przez link (zachowane dla kompatybilności)
// =====================================
router.get('/verify/:token', async (req, res) => {
    try {
        const { token } = req.params;
        
        const user = await prisma.user.findFirst({
            where: { 
                verification_code: token,
                verification_expires: { gte: new Date() }
            }
        });
        
        if (!user) {
            return res.status(400).json({ 
                error: 'Nieprawidłowy lub wygasły token weryfikacyjny' 
            });
        }
        
        await prisma.user.update({
            where: { id: user.id },
            data: {
                isVerified: true,
                verification_code: null,
                verification_expires: null
            }
        });
        
        res.json({
            success: true,
            message: 'Email został zweryfikowany. Możesz się teraz zalogować.'
        });
        
    } catch (error) {
        console.error('Błąd weryfikacji:', error);
        res.status(500).json({ 
            error: 'Błąd serwera podczas weryfikacji' 
        });
    }
});

// =====================================
// POST /api/auth/resend-code - Wyślij ponownie kod
// =====================================
router.post('/resend-code', async (req, res) => {
    try {
        const { email } = req.body;
        
        if (!email) {
            return res.status(400).json({ error: 'Email jest wymagany' });
        }
        
        const user = await prisma.user.findUnique({
            where: { email: email.toLowerCase() }
        });
        
        if (!user) {
            return res.json({ 
                success: true, 
                message: 'Jeśli konto istnieje, kod został wysłany' 
            });
        }
        
        if (user.isVerified) {
            return res.status(400).json({ 
                error: 'Konto jest już zweryfikowane' 
            });
        }
        
        const verificationCode = generateVerificationCode();
        
        await prisma.user.update({
            where: { id: user.id },
            data: {
                verification_code: verificationCode,
                verification_expires: new Date(Date.now() + 24 * 60 * 60 * 1000)
            }
        });
        
        try {
            await sendVerificationEmail(email, verificationCode);
        } catch (emailError) {
            console.error('Błąd wysyłania emaila:', emailError.message);
        }
        
        res.json({
            success: true,
            message: 'Nowy kod weryfikacyjny został wysłany'
        });
        
    } catch (error) {
        console.error('Błąd resend-code:', error);
        res.status(500).json({ error: 'Błąd serwera' });
    }
});

// =====================================
// POST /api/auth/resend-verification - Alias (zachowane dla kompatybilności)
// =====================================
router.post('/resend-verification', async (req, res) => {
    try {
        const { email } = req.body;
        
        if (!email) {
            return res.status(400).json({ error: 'Email jest wymagany' });
        }
        
        const user = await prisma.user.findUnique({
            where: { email: email.toLowerCase() }
        });
        
        if (!user) {
            return res.json({ 
                success: true, 
                message: 'Jeśli konto istnieje, email został wysłany' 
            });
        }
        
        if (user.isVerified) {
            return res.status(400).json({ 
                error: 'Konto jest już zweryfikowane' 
            });
        }
        
        const verificationCode = generateVerificationCode();
        
        await prisma.user.update({
            where: { id: user.id },
            data: {
                verification_code: verificationCode,
                verification_expires: new Date(Date.now() + 24 * 60 * 60 * 1000)
            }
        });
        
        try {
            await sendVerificationEmail(email, verificationCode);
        } catch (emailError) {
            console.error('Błąd wysyłania emaila:', emailError.message);
        }
        
        res.json({
            success: true,
            message: 'Email weryfikacyjny został wysłany'
        });
        
    } catch (error) {
        console.error('Błąd resend-verification:', error);
        res.status(500).json({ error: 'Błąd serwera' });
    }
});

// =====================================
// GET /api/auth/me - Pobierz aktualnego użytkownika
// =====================================
router.get('/me', verifyToken, async (req, res) => {
    try {
        const user = await prisma.user.findUnique({
            where: { id: req.userId },
            select: {
                id: true,
                email: true,
                isAdmin: true,
                isActive: true,
                isVerified: true,
                balance: true,
                totalEarned: true,
                createdAt: true
            }
        });
        
        if (!user) {
            return res.status(404).json({ 
                error: 'Użytkownik nie znaleziony' 
            });
        }
        
        res.json({
            success: true,
            user: {
                ...user,
                balance: parseFloat(user.balance) || 0,
                totalEarned: parseFloat(user.totalEarned) || 0
            }
        });
        
    } catch (error) {
        console.error('Błąd pobierania użytkownika:', error);
        res.status(500).json({ 
            error: 'Błąd serwera' 
        });
    }
});

// =====================================
// POST /api/auth/logout - Wylogowanie
// =====================================
router.post('/logout', (req, res) => {
    res.json({
        success: true,
        message: 'Wylogowano pomyślnie'
    });
});

module.exports = router;