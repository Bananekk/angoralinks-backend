const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { PrismaClient } = require('@prisma/client');
const { sendVerificationEmail, sendWelcomeEmail } = require('../utils/email');
const { verifyToken } = require('../middleware/auth');
const ReferralService = require('../services/referralService');

const router = express.Router();
const prisma = new PrismaClient();

// Pomocnicze funkcje
let encrypt, getClientIp, getUserAgent;
try {
    encrypt = require('../utils/encryption').encrypt;
} catch (e) {
    encrypt = (text) => text;
}
try {
    const ipHelper = require('../utils/ipHelper');
    getClientIp = ipHelper.getClientIp;
    getUserAgent = ipHelper.getUserAgent;
} catch (e) {
    getClientIp = (req) => {
        return req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
               req.headers['x-real-ip'] ||
               req.connection?.remoteAddress ||
               req.ip || 
               'unknown';
    };
    getUserAgent = (req) => req.headers['user-agent'] || 'unknown';
}

// =====================================
// Funkcja generująca 6-cyfrowy kod
// =====================================
function generateVerificationCode() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

// =====================================
// POST /api/auth/register - Rejestracja Z ROZSZERZONYM FRAUD DETECTION
// =====================================
router.post('/register', async (req, res) => {
    try {
        const { 
            email, 
            password, 
            confirmPassword, 
            referralCode,
            // 🆕 Dane fingerprint z frontendu
            deviceData 
        } = req.body;
        
        console.log('========================================');
        console.log('📝 REGISTRATION STARTED');
        console.log('📝 Email:', email);
        console.log('📝 Received referralCode:', referralCode || 'NONE');
        console.log('📝 DeviceData received:', deviceData ? 'YES' : 'NO');
        console.log('========================================');
        
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

        // Sprawdź confirmPassword jeśli podane
        if (confirmPassword && password !== confirmPassword) {
            return res.status(400).json({ 
                error: 'Hasła nie są identyczne' 
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
        
        // ========================================
        // 🆕 ROZSZERZONE PRZYGOTOWANIE DANYCH FINGERPRINT
        // ========================================
        let ipHash = null;
        let userAgentHash = null;
        let deviceFingerprint = null;

        // Hash IP
        try {
            if (clientIp && clientIp !== 'unknown') {
                ipHash = ReferralService.hashIP(clientIp);
                console.log('✅ IP hashed successfully');
            }
        } catch (hashError) {
            console.error('❌ Error hashing IP:', hashError.message);
        }

        // 🆕 Hash User-Agent
        try {
            if (userAgent && userAgent !== 'unknown') {
                userAgentHash = ReferralService.hashUserAgent(userAgent);
                console.log('✅ User-Agent hashed successfully');
            }
        } catch (hashError) {
            console.error('❌ Error hashing User-Agent:', hashError.message);
        }

        // 🆕 Generuj Device Fingerprint
        try {
            if (deviceData) {
                deviceFingerprint = ReferralService.generateDeviceFingerprint(deviceData);
                console.log('✅ Device fingerprint generated:', deviceFingerprint ? 'YES' : 'NO');
            }
        } catch (fpError) {
            console.error('❌ Error generating fingerprint:', fpError.message);
        }

        // ========================================
        // OBSŁUGA KODU POLECAJĄCEGO Z ROZSZERZONYM FRAUD DETECTION
        // ========================================
        let referrerId = null;
        let referrerData = null;
        let bonusExpires = null;
        let fraudData = { isSuspicious: false, riskScore: 0, reasons: [], details: {} };

        // Waliduj kod polecający
        if (referralCode && referralCode.trim() !== '') {
            const cleanCode = referralCode.trim().toUpperCase();
            console.log('🔍 Validating referral code:', cleanCode);
            
            try {
                referrerData = await ReferralService.validateReferralCode(cleanCode);
                
                if (referrerData) {
                    referrerId = referrerData.id;
                    console.log('✅ Referrer FOUND:', {
                        id: referrerData.id,
                        email: referrerData.email,
                        referralDisabled: referrerData.referralDisabled
                    });

                    // Pobierz ustawienia bonusu
                    try {
                        const settings = await ReferralService.getSettings();
                        if (settings && settings.referralBonusDuration) {
                            bonusExpires = new Date();
                            bonusExpires.setDate(bonusExpires.getDate() + settings.referralBonusDuration);
                            console.log('📝 Bonus expires:', bonusExpires);
                        }
                    } catch (settingsError) {
                        console.error('❌ Error getting settings:', settingsError.message);
                    }

                    // 🆕 ROZSZERZONE sprawdzenie fraudu
                    try {
                        fraudData = await ReferralService.checkFraudulentReferral(referrerId, {
                            ipHash,
                            userAgentHash,
                            deviceFingerprint,
                            browserLanguage: deviceData?.language,
                            screenResolution: deviceData?.screenResolution,
                            timezone: deviceData?.timezone
                        });
                        console.log('📝 Fraud check result:', {
                            isSuspicious: fraudData.isSuspicious,
                            riskScore: fraudData.riskScore,
                            reasons: fraudData.reasons
                        });
                    } catch (fraudError) {
                        console.error('❌ Error checking fraud:', fraudError.message);
                    }
                } else {
                    console.log('⚠️ Referral code NOT FOUND or DISABLED:', cleanCode);
                }
            } catch (refError) {
                console.error('❌ Error validating referral code:', refError.message);
            }
        }

        // ========================================
        // GENEROWANIE KODU POLECAJĄCEGO DLA NOWEGO UŻYTKOWNIKA
        // ========================================
        let userReferralCode = null;
        let isUnique = false;
        let attempts = 0;

        while (!isUnique && attempts < 10) {
            userReferralCode = crypto.randomBytes(4).toString('hex').toUpperCase();
            const existing = await prisma.user.findFirst({
                where: { referralCode: userReferralCode }
            });
            if (!existing) isUnique = true;
            attempts++;
        }

        if (!isUnique) {
            console.error('❌ Failed to generate unique referral code');
            userReferralCode = null;
        } else {
            console.log('✅ Generated referral code:', userReferralCode);
        }

        // ========================================
        // TWORZENIE UŻYTKOWNIKA Z ROZSZERZONYMI DANYMI
        // ========================================
        const encryptedIp = encrypt(clientIp);

        console.log('📝 Creating user with:');
        console.log('   - referralCode:', userReferralCode);
        console.log('   - referredById:', referrerId);
        console.log('   - referralFraudFlag:', fraudData.isSuspicious);
        console.log('   - riskScore:', fraudData.riskScore);
        
        const user = await prisma.user.create({
            data: {
                email: email.toLowerCase(),
                password_hash: hashedPassword,
                verification_code: verificationCode,
                verification_expires: new Date(Date.now() + 24 * 60 * 60 * 1000),
                registrationIp: encryptedIp,
                lastLoginIp: encryptedIp,
                lastLoginAt: new Date(),
                // POLA REFERRALI
                referralCode: userReferralCode,
                referredById: referrerId,
                referralBonusExpires: bonusExpires,
                // 🆕 ROZSZERZONE POLA FINGERPRINT
                referralIpHash: ipHash,
                deviceFingerprint: deviceFingerprint,
                userAgentHash: userAgentHash,
                browserLanguage: deviceData?.language || null,
                screenResolution: deviceData?.screenResolution || null,
                timezone: deviceData?.timezone || null,
                // FLAGI FRAUDU
                referralFraudFlag: fraudData.isSuspicious,
                referralFraudReason: fraudData.reasons?.length > 0 ? fraudData.reasons.join(', ') : null,
                referralFraudCheckedAt: referrerId ? new Date() : null
            }
        });

        console.log('✅ User created:', user.id);
        console.log('   - referralCode:', user.referralCode);
        console.log('   - referredById:', user.referredById);
        console.log('   - referralFraudFlag:', user.referralFraudFlag);

        // 🆕 Utwórz alert fraudu jeśli wykryto podejrzenie
        if (fraudData.isSuspicious && referrerId) {
            try {
                await ReferralService.createFraudAlert(referrerId, user.id, fraudData);
                console.log('🚨 Fraud alert created for user:', user.id);
            } catch (alertError) {
                console.error('❌ Error creating fraud alert:', alertError.message);
            }
        }
        
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
            console.log('✅ Verification email sent');
        } catch (emailError) {
            console.error('❌ Błąd wysyłania emaila:', emailError.message);
        }

        console.log('========================================');
        console.log('✅ REGISTRATION COMPLETED');
        console.log('========================================');
        
        res.status(201).json({
            success: true,
            message: 'Konto zostało utworzone. Sprawdź email aby je zweryfikować.',
            referredBy: !!referrerId
        });
        
    } catch (error) {
        console.error('========================================');
        console.error('❌ REGISTRATION ERROR:', error.message);
        console.error('❌ Stack:', error.stack);
        console.error('========================================');
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

        // 🆕 Hash IP i User-Agent dla referrali
        let ipHash = null;
        let userAgentHash = null;
        try {
            ipHash = ReferralService.hashIP(clientIp);
            userAgentHash = ReferralService.hashUserAgent(userAgent);
        } catch (e) {
            console.error('Error hashing login data:', e.message);
        }
        
        // Aktualizuj ostatnie logowanie
        await prisma.user.update({
            where: { id: user.id },
            data: {
                lastLoginIp: encryptedIp,
                lastLoginAt: new Date(),
                referralIpHash: ipHash,
                userAgentHash: userAgentHash || undefined
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
                totalEarned: parseFloat(user.totalEarned) || 0,
                referralCode: user.referralCode
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

        // Wygeneruj token JWT
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
                totalEarned: parseFloat(user.totalEarned) || 0,
                referralCode: user.referralCode
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
// GET /api/auth/verify/:token - Weryfikacja przez link
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
// POST /api/auth/resend-verification - Alias
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
                createdAt: true,
                referralCode: true
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