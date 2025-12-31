// controllers/authController.js
const authService = require('../services/authService');
const emailUtils = require('../utils/email');
const ReferralService = require('../services/referralService');
const { PrismaClient } = require('@prisma/client');
const crypto = require('crypto');

const prisma = new PrismaClient();

// Helper do pobierania IP
const getClientIp = (req) => {
    return req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
           req.headers['x-real-ip'] ||
           req.connection?.remoteAddress ||
           req.socket?.remoteAddress ||
           'unknown';
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
            // HASH IP
            // ========================================
            let ipHash = null;
            if (registrationIp && registrationIp !== 'unknown') {
                try {
                    ipHash = ReferralService.hashIP(registrationIp);
                    console.log('✅ IP hashed successfully');
                } catch (hashError) {
                    console.error('❌ Error hashing IP:', hashError.message);
                }
            }

            // ========================================
            // SPRAWDZENIE FRAUDU
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
            // ========================================
            const userData = {
                email: email.toLowerCase().trim(),
                password_hash: passwordHash,
                verification_code: verificationCode,
                verification_expires: verificationExpires,
                isVerified: false,
                referralCode: userReferralCode,
                referredById: referrerId,  // <-- KLUCZOWE POLE
                referralBonusExpires: bonusExpires,
                registrationIp: ipHash,
                referralIpHash: ipHash,
                referralFraudFlag: fraudData.isFraud,
                referralFraudReason: fraudData.reason || null,
                referralFraudCheckedAt: referrerId ? new Date() : null
            };

            console.log('========================================');
            console.log('📝 USER DATA TO SAVE:');
            console.log('   - email:', userData.email);
            console.log('   - referralCode:', userData.referralCode);
            console.log('   - referredById:', userData.referredById);
            console.log('   - referralBonusExpires:', userData.referralBonusExpires);
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
                // Usuń użytkownika jeśli email się nie wysłał
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

    // POST /api/auth/login
    async login(req, res) {
        try {
            const { email, password } = req.body;

            if (!email || !password) {
                return res.status(400).json({ error: 'Email i hasło są wymagane' });
            }

            const user = await authService.findByEmail(email);
            if (!user) {
                return res.status(401).json({ error: 'Nieprawidłowy email lub hasło' });
            }

            // Sprawdź czy zweryfikowany
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

            // Pobierz IP i zaktualizuj
            const loginIp = getClientIp(req);
            let ipHash = null;
            
            try {
                ipHash = ReferralService.hashIP(loginIp);
            } catch (e) {
                console.error('Error hashing login IP:', e.message);
            }

            // Aktualizuj ostatnie logowanie
            await prisma.user.update({
                where: { id: user.id },
                data: { 
                    lastLoginAt: new Date(),
                    lastLoginIp: ipHash,
                    referralIpHash: ipHash
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
                message: 'Logowanie udane',
                user: {
                    id: user.id,
                    email: user.email,
                    balance: parseFloat(user.balance || 0),
                    isVerified: user.isVerified,
                    isAdmin: user.isAdmin,
                    referralCode: user.referralCode
                },
                token
            });

        } catch (error) {
            console.error('Błąd logowania:', error);
            res.status(500).json({ error: 'Błąd serwera podczas logowania' });
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
            res.json({ 
                user: {
                    ...req.user,
                    referralCode: req.user.referralCode
                }
            });
        } catch (error) {
            res.status(500).json({ error: 'Błąd serwera' });
        }
    }
}

module.exports = { authController: new AuthController() };