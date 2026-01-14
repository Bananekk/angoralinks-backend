// controllers/authController.js
const authService = require('../services/authService');
const emailUtils = require('../utils/email');
const ReferralService = require('../services/referralService');
const { PrismaClient } = require('@prisma/client');
const crypto = require('crypto');

const prisma = new PrismaClient();

// 🆕 Import serwisu 2FA
let twoFactorService;
try {
    twoFactorService = require('../services/twoFactorService');
} catch (e) {
    console.warn('⚠️ twoFactorService nie znaleziony - 2FA wyłączone');
    twoFactorService = null;
}

// Helper do pobierania IP
const getClientIp = (req) => {
    return req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
           req.headers['x-real-ip'] ||
           req.connection?.remoteAddress ||
           req.socket?.remoteAddress ||
           'unknown';
};

// 🔥 Helper do hashowania IP (spójny z redirectRoutes.js)
const hashIP = (ip) => {
    if (!ip || ip === 'unknown') return null;
    return crypto
        .createHash('sha256')
        .update(ip + (process.env.IP_HASH_SALT || 'angoralinks-2024'))
        .digest('hex')
        .substring(0, 32);
};

class AuthController {
    // POST /api/auth/register
    async register(req, res) {
        try {
            const { email, password, confirmPassword, referralCode } = req.body;

            console.log('========================================');
            console.log('📝 REGISTRATION STARTED');
            console.log('📝 Email:', email);
            console.log('📝 Received referralCode:', referralCode || 'NONE');
            console.log('========================================');

            // Walidacje
            if (!email || !password || !confirmPassword) {
                return res.status(400).json({ error: 'Wszystkie pola są wymagane' });
            }

            if (!authService.isValidEmail(email)) {
                return res.status(400).json({ error: 'Nieprawidłowy format email' });
            }

            if (!authService.isValidPassword(password)) {
                return res.status(400).json({ error: 'Hasło musi mieć min. 8 znaków, 1 cyfrę i 1 wielką literę' });
            }

            if (password !== confirmPassword) {
                return res.status(400).json({ error: 'Hasła nie są identyczne' });
            }

            const existingUser = await authService.findByEmail(email);
            if (existingUser) {
                return res.status(409).json({ error: 'Użytkownik z tym emailem już istnieje' });
            }

            // Pobierz IP rejestracji
            const registrationIp = getClientIp(req);
            console.log('📝 Registration IP:', registrationIp);

            // 🔥 NOWE: Stwórz HASH IP do porównań (self-click detection)
            const ipHash = hashIP(registrationIp);
            console.log('📝 Registration IP Hash:', ipHash);

            // ========================================
            // WALIDACJA KODU POLECAJĄCEGO
            // ========================================
            let referrerData = null;
            let referrerId = null;

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
                            code: referrerData.referralCode
                        });
                    } else {
                        console.log('⚠️ Referral code NOT FOUND in database:', cleanCode);
                    }
                } catch (refError) {
                    console.error('❌ Error validating referral code:', refError.message);
                }
            } else {
                console.log('📝 No referral code provided');
            }

            // ========================================
            // GENEROWANIE KODU DLA NOWEGO UŻYTKOWNIKA
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
                console.error('❌ Failed to generate unique referral code after 10 attempts');
                userReferralCode = null;
            } else {
                console.log('✅ Generated referral code for new user:', userReferralCode);
            }

            // ========================================
            // USTAWIENIA BONUSU REFERRAL
            // ========================================
            let bonusExpires = null;
            if (referrerId) {
                try {
                    const settings = await ReferralService.getSettings();
                    if (settings && settings.referralBonusDuration) {
                        bonusExpires = new Date();
                        bonusExpires.setDate(bonusExpires.getDate() + settings.referralBonusDuration);
                        console.log('📝 Bonus expires:', bonusExpires);
                    } else {
                        console.log('📝 No bonus duration set - permanent referral');
                    }
                } catch (settingsError) {
                    console.error('❌ Error getting settings:', settingsError.message);
                }
            }

            // ========================================
            // SPRAWDZENIE FRAUDU (używa własnego hasha z ReferralService)
            // ========================================
            let fraudData = { isFraud: false, reason: null };
            if (referrerId && ipHash) {
                try {
                    fraudData = await ReferralService.checkFraudulentReferral(referrerId, ipHash);
                    console.log('📝 Fraud check result:', fraudData);
                } catch (fraudError) {
                    console.error('❌ Error checking fraud:', fraudError.message);
                }
            }

            // ========================================
            // HASH HASŁA I GENEROWANIE KODU WERYFIKACYJNEGO
            // ========================================
            const passwordHash = await authService.hashPassword(password);
            const verificationCode = emailUtils.generateCode();
            const verificationExpires = new Date(Date.now() + 15 * 60 * 1000);

            // ========================================
            // PRZYGOTOWANIE DANYCH UŻYTKOWNIKA
            // 🔥 registrationIp = HASH (do self-click detection w redirectRoutes)
            // 🔥 referralIpHash = HASH (do fraud detection)
            // ========================================
            const userData = {
                email: email.toLowerCase().trim(),
                password_hash: passwordHash,
                verification_code: verificationCode,
                verification_expires: verificationExpires,
                isVerified: false,
                referralCode: userReferralCode,
                referredById: referrerId,
                referralBonusExpires: bonusExpires,
                registrationIp: ipHash,              // 🔥 HASH do self-click detection
                referralIpHash: ipHash,              // 🔥 HASH do fraud detection
                referralFraudFlag: fraudData.isFraud,
                referralFraudReason: fraudData.reason || null,
                referralFraudCheckedAt: referrerId ? new Date() : null
            };

            console.log('========================================');
            console.log('📝 USER DATA TO SAVE:');
            console.log('   - email:', userData.email);
            console.log('   - referralCode:', userData.referralCode);
            console.log('   - referredById:', userData.referredById);
            console.log('   - registrationIp (HASH):', userData.registrationIp);
            console.log('   - referralFraudFlag:', userData.referralFraudFlag);
            console.log('========================================');

            // ========================================
            // TWORZENIE UŻYTKOWNIKA
            // ========================================
            let newUser;
            try {
                newUser = await prisma.user.create({
                    data: userData
                });
                console.log('✅ USER CREATED SUCCESSFULLY:');
                console.log('   - ID:', newUser.id);
                console.log('   - Email:', newUser.email);
                console.log('   - referralCode:', newUser.referralCode);
                console.log('   - referredById:', newUser.referredById);
            } catch (createError) {
                console.error('❌ ERROR CREATING USER:', createError.message);
                console.error('   Full error:', createError);
                return res.status(500).json({ error: 'Błąd tworzenia konta' });
            }

            // ========================================
            // WYSYŁANIE EMAILA
            // ========================================
            try {
                await emailUtils.sendVerificationEmail(email, verificationCode);
                console.log('✅ Verification email sent to:', email);
            } catch (emailError) {
                console.error('❌ Error sending email:', emailError.message);
                await prisma.user.delete({ where: { id: newUser.id } });
                return res.status(500).json({ error: 'Błąd wysyłania email weryfikacyjnego' });
            }

            console.log('========================================');
            console.log('✅ REGISTRATION COMPLETED SUCCESSFULLY');
            console.log('========================================');

            res.status(201).json({
                success: true,
                message: 'Konto utworzone. Sprawdź email i wpisz kod weryfikacyjny.',
                requiresVerification: true,
                email: newUser.email,
                referredBy: !!referrerId
            });

        } catch (error) {
            console.error('========================================');
            console.error('❌ REGISTRATION ERROR:', error.message);
            console.error('❌ Stack:', error.stack);
            console.error('========================================');
            res.status(500).json({ error: 'Błąd serwera podczas rejestracji' });
        }
    }

    // POST /api/auth/verify
    async verify(req, res) {
        try {
            const { email, code } = req.body;

            if (!email || !code) {
                return res.status(400).json({ error: 'Email i kod są wymagane' });
            }

            const user = await prisma.user.findUnique({
                where: { email: email.toLowerCase() }
            });

            if (!user) {
                return res.status(404).json({ error: 'Użytkownik nie znaleziony' });
            }

            if (user.isVerified) {
                return res.status(400).json({ error: 'Konto już zweryfikowane' });
            }

            if (!user.verification_code || !user.verification_expires) {
                return res.status(400).json({ error: 'Brak kodu weryfikacyjnego' });
            }

            if (new Date() > user.verification_expires) {
                return res.status(400).json({ error: 'Kod wygasł. Poproś o nowy kod.' });
            }

            if (user.verification_code !== code) {
                return res.status(400).json({ error: 'Nieprawidłowy kod' });
            }

            // Zweryfikuj użytkownika
            const verifiedUser = await prisma.user.update({
                where: { id: user.id },
                data: {
                    isVerified: true,
                    verification_code: null,
                    verification_expires: null
                }
            });

            // Wyślij welcome email
            console.log('🔔 Wysyłam welcome email do:', verifiedUser.email);
            emailUtils.sendWelcomeEmail(verifiedUser.email)
                .then(() => console.log('✅ Welcome email wysłany!'))
                .catch(err => console.error('❌ Welcome email error:', err));

            // Generuj token
            const token = authService.generateToken(verifiedUser.id);

            res.json({
                message: 'Konto zweryfikowane!',
                user: {
                    id: verifiedUser.id,
                    email: verifiedUser.email,
                    balance: parseFloat(verifiedUser.balance || 0),
                    isVerified: verifiedUser.isVerified,
                    referralCode: verifiedUser.referralCode
                },
                token
            });

        } catch (error) {
            console.error('Błąd weryfikacji:', error);
            res.status(500).json({ error: 'Błąd serwera' });
        }
    }

    // POST /api/auth/resend-code
    async resendCode(req, res) {
        try {
            const { email } = req.body;

            if (!email) {
                return res.status(400).json({ error: 'Email jest wymagany' });
            }

            const user = await prisma.user.findUnique({
                where: { email: email.toLowerCase() }
            });

            if (!user) {
                return res.status(404).json({ error: 'Użytkownik nie znaleziony' });
            }

            if (user.isVerified) {
                return res.status(400).json({ error: 'Konto już zweryfikowane' });
            }

            // Generuj nowy kod
            const verificationCode = emailUtils.generateCode();
            const verificationExpires = new Date(Date.now() + 15 * 60 * 1000);

            await prisma.user.update({
                where: { id: user.id },
                data: {
                    verification_code: verificationCode,
                    verification_expires: verificationExpires
                }
            });

            // Wyślij email
            try {
                await emailUtils.sendVerificationEmail(email, verificationCode);
            } catch (emailError) {
                return res.status(500).json({ error: 'Błąd wysyłania email' });
            }

            res.json({ message: 'Nowy kod został wysłany na email' });

        } catch (error) {
            console.error('Błąd wysyłania kodu:', error);
            res.status(500).json({ error: 'Błąd serwera' });
        }
    }

    // ========================================
    // POST /api/auth/login - Z OBSŁUGĄ 2FA
    // 🔥 ZAKTUALIZOWANE: Zapisuje HASH IP do lastLoginIp
    // ========================================
    async login(req, res) {
        try {
            const { email, password } = req.body;

            if (!email || !password) {
                return res.status(400).json({ error: 'Email i hasło są wymagane' });
            }

            const user = await prisma.user.findUnique({
                where: { email: email.toLowerCase() },
                select: {
                    id: true,
                    email: true,
                    password_hash: true,
                    isVerified: true,
                    isActive: true,
                    isAdmin: true,
                    balance: true,
                    referralCode: true,
                    twoFactorEnabled: true,
                    twoFactorMethod: true,
                    twoFactorRequired: true
                }
            });

            if (!user) {
                return res.status(401).json({ error: 'Nieprawidłowy email lub hasło' });
            }

            if (!user.isActive) {
                return res.status(403).json({ 
                    error: 'Konto zostało zablokowane. Skontaktuj się z supportem.' 
                });
            }

            if (!user.isVerified) {
                return res.status(403).json({
                    error: 'Konto nie zostało zweryfikowane. Sprawdź email.',
                    requiresVerification: true,
                    email: user.email
                });
            }

            const isValidPassword = await authService.verifyPassword(password, user.password_hash);
            if (!isValidPassword) {
                return res.status(401).json({ error: 'Nieprawidłowy email lub hasło' });
            }

            // 🔥 Pobierz IP i zrób HASH (spójnie z redirectRoutes.js)
            const loginIp = getClientIp(req);
            const ipHash = hashIP(loginIp);
            
            console.log('🔐 Login IP:', loginIp);
            console.log('🔐 Login IP Hash:', ipHash);

            // ========================================
            // SPRAWDZENIE 2FA
            // ========================================

            if (user.twoFactorRequired && !user.twoFactorEnabled) {
                console.log('🔐 2FA required but not enabled for:', user.email);
                
                const setupToken = authService.generateToken(user.id, '15m');
                
                return res.json({
                    success: true,
                    requiresTwoFactorSetup: true,
                    message: 'Administrator wymaga włączenia 2FA. Skonfiguruj teraz aby kontynuować.',
                    setupToken,
                    userId: user.id,
                    email: user.email
                });
            }

            if (user.twoFactorEnabled && user.twoFactorMethod && user.twoFactorMethod.length > 0) {
                console.log('🔐 2FA enabled for:', user.email, 'Methods:', user.twoFactorMethod);
                
                const challengeToken = authService.generateToken(user.id, '5m');
                
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
            // 🔥 lastLoginIp = HASH (do self-click detection)
            // ========================================
            console.log('✅ Login without 2FA for:', user.email);

            await prisma.user.update({
                where: { id: user.id },
                data: { 
                    lastLoginAt: new Date(),
                    lastLoginIp: ipHash    // 🔥 HASH do self-click detection
                }
            });

            const token = authService.generateToken(user.id);

            res.cookie('token', token, {
                httpOnly: true,
                secure: process.env.NODE_ENV === 'production',
                sameSite: 'strict',
                maxAge: 7 * 24 * 60 * 60 * 1000
            });

            res.json({
                success: true,
                message: 'Logowanie udane',
                user: {
                    id: user.id,
                    email: user.email,
                    balance: parseFloat(user.balance || 0),
                    isVerified: user.isVerified,
                    isAdmin: user.isAdmin,
                    referralCode: user.referralCode,
                    twoFactorEnabled: user.twoFactorEnabled
                },
                token
            });

        } catch (error) {
            console.error('Błąd logowania:', error);
            res.status(500).json({ error: 'Błąd serwera podczas logowania' });
        }
    }

    // ========================================
    // POST /api/auth/2fa/verify
    // 🔥 ZAKTUALIZOWANE: Zapisuje HASH IP
    // ========================================
    async verifyTwoFactor(req, res) {
        try {
            const { challengeToken, code, method, response } = req.body;

            if (!challengeToken) {
                return res.status(400).json({ error: 'Token weryfikacyjny jest wymagany' });
            }

            let decoded;
            try {
                decoded = authService.verifyToken(challengeToken);
            } catch (tokenError) {
                return res.status(401).json({ error: 'Token wygasł. Zaloguj się ponownie.' });
            }

            const userId = decoded.id || decoded.userId;

            const user = await prisma.user.findUnique({
                where: { id: userId },
                select: {
                    id: true,
                    email: true,
                    isActive: true,
                    isAdmin: true,
                    balance: true,
                    referralCode: true,
                    twoFactorEnabled: true,
                    twoFactorMethod: true,
                    twoFactorSecret: true
                }
            });

            if (!user) {
                return res.status(404).json({ error: 'Użytkownik nie znaleziony' });
            }

            if (!user.twoFactorEnabled) {
                return res.status(400).json({ error: '2FA nie jest włączone dla tego konta' });
            }

            const loginIp = getClientIp(req);
            const userAgent = req.headers['user-agent'];
            let verified = false;

            if (method === 'TOTP' || (!method && code)) {
                if (!code) {
                    return res.status(400).json({ error: 'Kod weryfikacyjny jest wymagany' });
                }

                if (!twoFactorService) {
                    return res.status(500).json({ error: 'Serwis 2FA niedostępny' });
                }

                verified = await twoFactorService.verifyTwoFactorCode(userId, code, loginIp, userAgent);

            } else if (method === 'WEBAUTHN') {
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

            } else if (method === 'BACKUP_CODE') {
                if (!code) {
                    return res.status(400).json({ error: 'Kod zapasowy jest wymagany' });
                }

                if (!twoFactorService) {
                    return res.status(500).json({ error: 'Serwis 2FA niedostępny' });
                }

                verified = await twoFactorService.verifyBackupCode(userId, code);

                if (verified) {
                    const remainingCodes = await twoFactorService.getRemainingBackupCodesCount(userId);
                    emailUtils.sendBackupCodeUsedAlert(user.email, remainingCodes)
                        .catch(err => console.error('Error sending backup code alert:', err));
                }
            } else {
                return res.status(400).json({ error: 'Nieobsługiwana metoda weryfikacji' });
            }

            if (!verified) {
                return res.status(401).json({ error: 'Nieprawidłowy kod weryfikacyjny' });
            }

            // ========================================
            // 2FA zweryfikowane
            // 🔥 lastLoginIp = HASH
            // ========================================
            console.log('✅ 2FA verified for:', user.email);

            const ipHash = hashIP(loginIp);

            await prisma.user.update({
                where: { id: user.id },
                data: { 
                    lastLoginAt: new Date(),
                    lastLoginIp: ipHash,    // 🔥 HASH
                    twoFactorLastUsedAt: new Date()
                }
            });

            const token = authService.generateToken(user.id);

            res.cookie('token', token, {
                httpOnly: true,
                secure: process.env.NODE_ENV === 'production',
                sameSite: 'strict',
                maxAge: 7 * 24 * 60 * 60 * 1000
            });

            res.json({
                success: true,
                message: 'Weryfikacja 2FA udana',
                user: {
                    id: user.id,
                    email: user.email,
                    balance: parseFloat(user.balance || 0),
                    isAdmin: user.isAdmin,
                    referralCode: user.referralCode,
                    twoFactorEnabled: user.twoFactorEnabled
                },
                token
            });

        } catch (error) {
            console.error('Błąd weryfikacji 2FA:', error);
            res.status(500).json({ error: 'Błąd serwera podczas weryfikacji 2FA' });
        }
    }

    // POST /api/auth/2fa/webauthn/options
    async getWebAuthnLoginOptions(req, res) {
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

            const userId = decoded.id || decoded.userId;

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
    }

    // POST /api/auth/logout
    async logout(req, res) {
        try {
            res.clearCookie('token');
            res.json({ message: 'Wylogowano pomyślnie' });
        } catch (error) {
            res.status(500).json({ error: 'Błąd serwera' });
        }
    }

    // GET /api/auth/me
    async me(req, res) {
        try {
            if (!req.user) {
                return res.status(401).json({ error: 'Nie zalogowano' });
            }

            const user = await prisma.user.findUnique({
                where: { id: req.user.id },
                select: {
                    id: true,
                    email: true,
                    balance: true,
                    totalEarned: true,
                    isVerified: true,
                    isAdmin: true,
                    referralCode: true,
                    referralEarnings: true,
                    twoFactorEnabled: true,
                    twoFactorMethod: true,
                    twoFactorRequired: true
                }
            });

            if (!user) {
                return res.status(404).json({ error: 'Użytkownik nie znaleziony' });
            }

            res.json({ 
                user: {
                    id: user.id,
                    email: user.email,
                    balance: parseFloat(user.balance || 0),
                    totalEarned: parseFloat(user.totalEarned || 0),
                    isVerified: user.isVerified,
                    isAdmin: user.isAdmin,
                    referralCode: user.referralCode,
                    referralEarnings: parseFloat(user.referralEarnings || 0),
                    twoFactorEnabled: user.twoFactorEnabled,
                    twoFactorMethods: user.twoFactorMethod || [],
                    twoFactorRequired: user.twoFactorRequired
                }
            });
        } catch (error) {
            console.error('Błąd /me:', error);
            res.status(500).json({ error: 'Błąd serwera' });
        }
    }
}

module.exports = { authController: new AuthController() };