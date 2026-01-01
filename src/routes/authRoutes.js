const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { PrismaClient } = require('@prisma/client');
const { sendVerificationEmail, sendWelcomeEmail, sendBackupCodeUsedAlert } = require('../utils/email');
const { verifyToken } = require('../middleware/auth');
const ReferralService = require('../services/referralService');
const authService = require('../services/authService');

const router = express.Router();
const prisma = new PrismaClient();

// 🆕 Import serwisu 2FA
let twoFactorService;
try {
    twoFactorService = require('../services/twoFactorService');
    console.log('✅ twoFactorService loaded');
} catch (e) {
    console.warn('⚠️ twoFactorService nie znaleziony - 2FA wyłączone');
    twoFactorService = null;
}

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
// POST /api/auth/register - Rejestracja
// =====================================
router.post('/register', async (req, res) => {
    try {
        const { 
            email, 
            password, 
            confirmPassword, 
            referralCode,
            deviceData 
        } = req.body;
        
        console.log('========================================');
        console.log('📝 REGISTRATION STARTED');
        console.log('📝 Email:', email);
        console.log('📝 Received referralCode:', referralCode || 'NONE');
        console.log('========================================');
        
        if (!email || !password) {
            return res.status(400).json({ error: 'Email i hasło są wymagane' });
        }
        
        if (password.length < 8) {
            return res.status(400).json({ error: 'Hasło musi mieć minimum 8 znaków' });
        }

        if (confirmPassword && password !== confirmPassword) {
            return res.status(400).json({ error: 'Hasła nie są identyczne' });
        }
        
        const existingUser = await prisma.user.findUnique({
            where: { email: email.toLowerCase() }
        });
        
        if (existingUser) {
            return res.status(400).json({ error: 'Użytkownik z tym emailem już istnieje' });
        }
        
        const hashedPassword = await bcrypt.hash(password, 12);
        const verificationCode = generateVerificationCode();
        const clientIp = getClientIp(req);
        const userAgent = getUserAgent(req);
        
        // Przygotowanie danych fingerprint
        let ipHash = null;
        let userAgentHash = null;
        let deviceFingerprint = null;

        try {
            if (clientIp && clientIp !== 'unknown') {
                ipHash = ReferralService.hashIP(clientIp);
            }
        } catch (hashError) {
            console.error('Error hashing IP:', hashError.message);
        }

        try {
            if (userAgent && userAgent !== 'unknown') {
                userAgentHash = ReferralService.hashUserAgent(userAgent);
            }
        } catch (hashError) {
            console.error('Error hashing User-Agent:', hashError.message);
        }

        try {
            if (deviceData) {
                deviceFingerprint = ReferralService.generateDeviceFingerprint(deviceData);
            }
        } catch (fpError) {
            console.error('Error generating fingerprint:', fpError.message);
        }

        // Obsługa kodu polecającego
        let referrerId = null;
        let referrerData = null;
        let bonusExpires = null;
        let fraudData = { isSuspicious: false, riskScore: 0, reasons: [], details: {} };

        if (referralCode && referralCode.trim() !== '') {
            const cleanCode = referralCode.trim().toUpperCase();
            
            try {
                referrerData = await ReferralService.validateReferralCode(cleanCode);
                
                if (referrerData) {
                    referrerId = referrerData.id;

                    try {
                        const settings = await ReferralService.getSettings();
                        if (settings && settings.referralBonusDuration) {
                            bonusExpires = new Date();
                            bonusExpires.setDate(bonusExpires.getDate() + settings.referralBonusDuration);
                        }
                    } catch (settingsError) {
                        console.error('Error getting settings:', settingsError.message);
                    }

                    try {
                        fraudData = await ReferralService.checkFraudulentReferral(referrerId, {
                            ipHash,
                            userAgentHash,
                            deviceFingerprint,
                            browserLanguage: deviceData?.language,
                            screenResolution: deviceData?.screenResolution,
                            timezone: deviceData?.timezone
                        });
                    } catch (fraudError) {
                        console.error('Error checking fraud:', fraudError.message);
                    }
                }
            } catch (refError) {
                console.error('Error validating referral code:', refError.message);
            }
        }

        // Generowanie kodu polecającego dla nowego użytkownika
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
            userReferralCode = null;
        }

        const encryptedIp = encrypt(clientIp);
        
        const user = await prisma.user.create({
            data: {
                email: email.toLowerCase(),
                password_hash: hashedPassword,
                verification_code: verificationCode,
                verification_expires: new Date(Date.now() + 24 * 60 * 60 * 1000),
                registrationIp: encryptedIp,
                lastLoginIp: encryptedIp,
                lastLoginAt: new Date(),
                referralCode: userReferralCode,
                referredById: referrerId,
                referralBonusExpires: bonusExpires,
                referralIpHash: ipHash,
                deviceFingerprint: deviceFingerprint,
                userAgentHash: userAgentHash,
                browserLanguage: deviceData?.language || null,
                screenResolution: deviceData?.screenResolution || null,
                timezone: deviceData?.timezone || null,
                referralFraudFlag: fraudData.isSuspicious,
                referralFraudReason: fraudData.reasons?.length > 0 ? fraudData.reasons.join(', ') : null,
                referralFraudCheckedAt: referrerId ? new Date() : null
            }
        });

        console.log('✅ User created:', user.id);

        if (fraudData.isSuspicious && referrerId) {
            try {
                await ReferralService.createFraudAlert(referrerId, user.id, fraudData);
            } catch (alertError) {
                console.error('Error creating fraud alert:', alertError.message);
            }
        }
        
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
        
        try {
            await sendVerificationEmail(email, verificationCode);
        } catch (emailError) {
            console.error('Błąd wysyłania emaila:', emailError.message);
        }
        
        res.status(201).json({
            success: true,
            message: 'Konto zostało utworzone. Sprawdź email aby je zweryfikować.',
            referredBy: !!referrerId
        });
        
    } catch (error) {
        console.error('REGISTRATION ERROR:', error.message);
        res.status(500).json({ error: 'Błąd serwera podczas rejestracji' });
    }
});

// =====================================
// 🆕 POST /api/auth/login - Logowanie Z OBSŁUGĄ 2FA
// =====================================
router.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        
        if (!email || !password) {
            return res.status(400).json({ error: 'Email i hasło są wymagane' });
        }
        
        // 🆕 Rozszerzone pobieranie danych z polami 2FA
        const user = await prisma.user.findUnique({
            where: { email: email.toLowerCase() },
            select: {
                id: true,
                email: true,
                password_hash: true,
                isActive: true,
                isVerified: true,
                isAdmin: true,
                balance: true,
                totalEarned: true,
                referralCode: true,
                // 🆕 Pola 2FA
                twoFactorEnabled: true,
                twoFactorMethod: true,
                twoFactorRequired: true
            }
        });
        
        if (!user) {
            return res.status(401).json({ error: 'Nieprawidłowy email lub hasło' });
        }
        
        if (!user.isActive) {
            return res.status(403).json({ error: 'Twoje konto zostało zablokowane' });
        }
        
        const isPasswordValid = await bcrypt.compare(password, user.password_hash);
        
        if (!isPasswordValid) {
            return res.status(401).json({ error: 'Nieprawidłowy email lub hasło' });
        }
        
        if (!user.isVerified) {
            return res.status(403).json({ 
                error: 'Zweryfikuj swój email przed zalogowaniem',
                needsVerification: true,
                email: user.email
            });
        }
        
        const clientIp = getClientIp(req);
        const userAgent = getUserAgent(req);

        // ========================================
        // 🆕 SPRAWDZENIE 2FA
        // ========================================

        // Przypadek 1: 2FA wymagane przez admina, ale nie skonfigurowane
        if (user.twoFactorRequired && !user.twoFactorEnabled) {
            console.log('🔐 2FA required but not enabled for:', user.email);
            
            const setupToken = authService.generateTemporaryToken(user.id, '2fa-setup', '15m');
            
            return res.json({
                success: true,
                requiresTwoFactorSetup: true,
                message: 'Administrator wymaga włączenia 2FA. Skonfiguruj teraz aby kontynuować.',
                setupToken,
                userId: user.id,
                email: user.email
            });
        }

        // Przypadek 2: 2FA włączone - wymagaj weryfikacji
        if (user.twoFactorEnabled && user.twoFactorMethod && user.twoFactorMethod.length > 0) {
            console.log('🔐 2FA enabled for:', user.email, 'Methods:', user.twoFactorMethod);
            
            const challengeToken = authService.generateTemporaryToken(user.id, '2fa-verify', '5m');
            
            return res.json({
                success: true,
                requiresTwoFactor: true,
                twoFactorMethods: user.twoFactorMethod,
                challengeToken,
                userId: user.id,
                message: 'Wymagana weryfikacja 2FA'
            });
        }

        // ========================================
        // LOGOWANIE BEZ 2FA
        // ========================================
        console.log('✅ Login without 2FA for:', user.email);

        const encryptedIp = encrypt(clientIp);
        let ipHash = null;
        let userAgentHash = null;
        
        try {
            ipHash = ReferralService.hashIP(clientIp);
            userAgentHash = ReferralService.hashUserAgent(userAgent);
        } catch (e) {
            console.error('Error hashing login data:', e.message);
        }
        
        await prisma.user.update({
            where: { id: user.id },
            data: {
                lastLoginIp: encryptedIp,
                lastLoginAt: new Date(),
                referralIpHash: ipHash,
                userAgentHash: userAgentHash || undefined
            }
        });
        
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
        
        const token = authService.generateToken(user.id);
        
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
                referralCode: user.referralCode,
                twoFactorEnabled: user.twoFactorEnabled
            }
        });
        
    } catch (error) {
        console.error('Błąd logowania:', error);
        res.status(500).json({ error: 'Błąd serwera podczas logowania' });
    }
});

// =====================================
// 🆕 POST /api/auth/2fa/verify - Weryfikacja 2FA przy logowaniu
// =====================================
router.post('/2fa/verify', async (req, res) => {
    try {
        const { challengeToken, code, method, response } = req.body;

        if (!challengeToken) {
            return res.status(400).json({ error: 'Token weryfikacyjny jest wymagany' });
        }

        // Zweryfikuj challengeToken
        let decoded;
        try {
            decoded = authService.verifyToken(challengeToken);
        } catch (tokenError) {
            return res.status(401).json({ error: 'Token wygasł. Zaloguj się ponownie.' });
        }

        // Sprawdź czy token jest do weryfikacji 2FA
        if (decoded.purpose && decoded.purpose !== '2fa-verify') {
            return res.status(401).json({ error: 'Nieprawidłowy token' });
        }

        const userId = decoded.userId || decoded.id;

        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: {
                id: true,
                email: true,
                isActive: true,
                isAdmin: true,
                balance: true,
                totalEarned: true,
                referralCode: true,
                twoFactorEnabled: true,
                twoFactorMethod: true
            }
        });

        if (!user) {
            return res.status(404).json({ error: 'Użytkownik nie znaleziony' });
        }

        if (!user.isActive) {
            return res.status(403).json({ error: 'Konto zablokowane' });
        }

        if (!user.twoFactorEnabled) {
            return res.status(400).json({ error: '2FA nie jest włączone dla tego konta' });
        }

        const clientIp = getClientIp(req);
        const userAgent = getUserAgent(req);
        let verified = false;

        // ========================================
        // Weryfikacja w zależności od metody
        // ========================================
        
        if (method === 'TOTP' || (!method && code && code.length === 6)) {
            // Weryfikacja kodem TOTP
            if (!code) {
                return res.status(400).json({ error: 'Kod weryfikacyjny jest wymagany' });
            }

            if (!twoFactorService) {
                return res.status(500).json({ error: 'Serwis 2FA niedostępny' });
            }

            try {
                verified = await twoFactorService.verifyTwoFactorCode(userId, code, clientIp, userAgent);
            } catch (verifyError) {
                console.error('TOTP verification error:', verifyError);
                return res.status(400).json({ error: 'Błąd weryfikacji kodu' });
            }

        } else if (method === 'WEBAUTHN') {
            // Weryfikacja WebAuthn
            if (!response) {
                return res.status(400).json({ error: 'Odpowiedź WebAuthn jest wymagana' });
            }

            if (!twoFactorService) {
                return res.status(500).json({ error: 'Serwis 2FA niedostępny' });
            }

            try {
                const result = await twoFactorService.verifyWebAuthnAuthentication(userId, response);
                verified = result.verified;
            } catch (webauthnError) {
                console.error('WebAuthn verification error:', webauthnError);
                return res.status(400).json({ error: 'Weryfikacja klucza nie powiodła się' });
            }

        } else if (method === 'BACKUP_CODE' || (code && code.length === 8)) {
            // Weryfikacja kodem zapasowym
            if (!code) {
                return res.status(400).json({ error: 'Kod zapasowy jest wymagany' });
            }

            if (!twoFactorService) {
                return res.status(500).json({ error: 'Serwis 2FA niedostępny' });
            }

            try {
                verified = await twoFactorService.verifyBackupCode(userId, code);

                // Jeśli użyto kod zapasowy, wyślij alert
                if (verified) {
                    const remainingCodes = await twoFactorService.getRemainingBackupCodesCount(userId);
                    sendBackupCodeUsedAlert(user.email, remainingCodes)
                        .catch(err => console.error('Error sending backup code alert:', err));
                }
            } catch (backupError) {
                console.error('Backup code verification error:', backupError);
                return res.status(400).json({ error: 'Błąd weryfikacji kodu zapasowego' });
            }
        } else {
            return res.status(400).json({ error: 'Nieobsługiwana metoda weryfikacji' });
        }

        if (!verified) {
            // Zapisz nieudaną próbę
            if (twoFactorService) {
                try {
                    await twoFactorService.logTwoFactorAction(userId, 'FAILED', method || 'TOTP', false, clientIp, userAgent, 'Nieprawidłowy kod');
                } catch (logError) {
                    console.error('Error logging failed 2FA attempt:', logError);
                }
            }
            return res.status(401).json({ error: 'Nieprawidłowy kod weryfikacyjny' });
        }

        // ========================================
        // 2FA zweryfikowane - wydaj pełny token
        // ========================================
        console.log('✅ 2FA verified for:', user.email);

        const encryptedIp = encrypt(clientIp);
        let ipHash = null;
        
        try {
            ipHash = ReferralService.hashIP(clientIp);
        } catch (e) {}

        await prisma.user.update({
            where: { id: user.id },
            data: { 
                lastLoginAt: new Date(),
                lastLoginIp: encryptedIp,
                twoFactorLastUsedAt: new Date()
            }
        });

        // Zapisz log
        try {
            await prisma.ipLog.create({
                data: {
                    userId: user.id,
                    encryptedIp: encryptedIp || 'unknown',
                    action: 'LOGIN_2FA',
                    userAgent: userAgent?.substring(0, 500)
                }
            });
        } catch (e) {}

        const token = authService.generateToken(user.id);

        res.json({
            success: true,
            message: 'Weryfikacja 2FA udana',
            token,
            user: {
                id: user.id,
                email: user.email,
                isAdmin: user.isAdmin,
                balance: parseFloat(user.balance) || 0,
                totalEarned: parseFloat(user.totalEarned) || 0,
                referralCode: user.referralCode,
                twoFactorEnabled: user.twoFactorEnabled
            }
        });

    } catch (error) {
        console.error('Błąd weryfikacji 2FA:', error);
        res.status(500).json({ error: 'Błąd serwera podczas weryfikacji 2FA' });
    }
});

// =====================================
// 🆕 POST /api/auth/2fa/webauthn/options - Opcje WebAuthn dla logowania
// =====================================
router.post('/2fa/webauthn/options', async (req, res) => {
    try {
        const { challengeToken } = req.body;

        if (!challengeToken) {
            return res.status(400).json({ error: 'Token jest wymagany' });
        }

        let decoded;
        try {
            decoded = authService.verifyToken(challengeToken);
        } catch (tokenError) {
            return res.status(401).json({ error: 'Token wygasł' });
        }

        const userId = decoded.userId || decoded.id;

        if (!twoFactorService) {
            return res.status(500).json({ error: 'Serwis 2FA niedostępny' });
        }

        const options = await twoFactorService.generateWebAuthnAuthenticationOptions(userId);

        res.json({
            success: true,
            options
        });

    } catch (error) {
        console.error('Błąd pobierania opcji WebAuthn:', error);
        res.status(500).json({ error: error.message || 'Błąd serwera' });
    }
});

// =====================================
// POST /api/auth/verify - Weryfikacja kodem 6-cyfrowym
// =====================================
router.post('/verify', async (req, res) => {
    try {
        const { email, code } = req.body;
        
        if (!email || !code) {
            return res.status(400).json({ error: 'Email i kod są wymagane' });
        }
        
        const user = await prisma.user.findFirst({
            where: { 
                email: email.toLowerCase(),
                verification_code: code,
                verification_expires: { gte: new Date() }
            }
        });
        
        if (!user) {
            return res.status(400).json({ error: 'Nieprawidłowy lub wygasły kod weryfikacyjny' });
        }
        
        await prisma.user.update({
            where: { id: user.id },
            data: {
                isVerified: true,
                verification_code: null,
                verification_expires: null
            }
        });

        sendWelcomeEmail(user.email)
            .then(() => console.log('✅ Welcome email wysłany!'))
            .catch(err => console.error('❌ Welcome email error:', err));

        const token = authService.generateToken(user.id);
        
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
        res.status(500).json({ error: 'Błąd serwera podczas weryfikacji' });
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
            return res.status(400).json({ error: 'Nieprawidłowy lub wygasły token weryfikacyjny' });
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
        res.status(500).json({ error: 'Błąd serwera podczas weryfikacji' });
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
            return res.json({ success: true, message: 'Jeśli konto istnieje, kod został wysłany' });
        }
        
        if (user.isVerified) {
            return res.status(400).json({ error: 'Konto jest już zweryfikowane' });
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
        
        res.json({ success: true, message: 'Nowy kod weryfikacyjny został wysłany' });
        
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
            return res.json({ success: true, message: 'Jeśli konto istnieje, email został wysłany' });
        }
        
        if (user.isVerified) {
            return res.status(400).json({ error: 'Konto jest już zweryfikowane' });
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
        
        res.json({ success: true, message: 'Email weryfikacyjny został wysłany' });
        
    } catch (error) {
        console.error('Błąd resend-verification:', error);
        res.status(500).json({ error: 'Błąd serwera' });
    }
});

// =====================================
// 🆕 GET /api/auth/me - Pobierz aktualnego użytkownika (z danymi 2FA)
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
                referralCode: true,
                referralEarnings: true,
                // 🆕 Pola 2FA
                twoFactorEnabled: true,
                twoFactorMethod: true,
                twoFactorRequired: true,
                twoFactorEnabledAt: true
            }
        });
        
        if (!user) {
            return res.status(404).json({ error: 'Użytkownik nie znaleziony' });
        }
        
        res.json({
            success: true,
            user: {
                id: user.id,
                email: user.email,
                isAdmin: user.isAdmin,
                isActive: user.isActive,
                isVerified: user.isVerified,
                balance: parseFloat(user.balance) || 0,
                totalEarned: parseFloat(user.totalEarned) || 0,
                createdAt: user.createdAt,
                referralCode: user.referralCode,
                referralEarnings: parseFloat(user.referralEarnings) || 0,
                // 🆕 Dane 2FA
                twoFactorEnabled: user.twoFactorEnabled,
                twoFactorMethods: user.twoFactorMethod || [],
                twoFactorRequired: user.twoFactorRequired,
                twoFactorEnabledAt: user.twoFactorEnabledAt
            }
        });
        
    } catch (error) {
        console.error('Błąd pobierania użytkownika:', error);
        res.status(500).json({ error: 'Błąd serwera' });
    }
});

// =====================================
// POST /api/auth/logout - Wylogowanie
// =====================================
router.post('/logout', (req, res) => {
    res.json({ success: true, message: 'Wylogowano pomyślnie' });
});

module.exports = router;