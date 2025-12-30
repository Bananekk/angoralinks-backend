const authService = require('../services/authService');
const emailUtils = require('../utils/email');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

class AuthController {
    // POST /api/auth/register
    async register(req, res) {
        try {
            const { email, password, confirmPassword } = req.body;

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

            const passwordHash = await authService.hashPassword(password);
            
            // Generuj kod weryfikacyjny
            const verificationCode = emailUtils.generateCode();
            const verificationExpires = new Date(Date.now() + 15 * 60 * 1000);

            // Utwórz użytkownika - UWAGA: password_hash i verification_* są bez @map!
            const newUser = await prisma.user.create({
                data: {
                    email: email.toLowerCase(),
                    password_hash: passwordHash,
                    verification_code: verificationCode,
                    verification_expires: verificationExpires,
                    isVerified: false
                }
            });

            // Wyślij email
            try {
                await emailUtils.sendVerificationEmail(email, verificationCode);
            } catch (emailError) {
                console.error('Błąd wysyłki email:', emailError);
                await prisma.user.delete({ where: { id: newUser.id } });
                return res.status(500).json({ error: 'Błąd wysyłania email weryfikacyjnego' });
            }

            res.status(201).json({
                message: 'Konto utworzone. Sprawdź email i wpisz kod weryfikacyjny.',
                requiresVerification: true,
                email: newUser.email
            });

        } catch (error) {
            console.error('Błąd rejestracji:', error);
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
                    isVerified: verifiedUser.isVerified
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

            // Aktualizuj ostatnie logowanie
            await prisma.user.update({
                where: { id: user.id },
                data: { lastLoginAt: new Date() }
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
                    isAdmin: user.isAdmin
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
            res.json({ user: req.user });
        } catch (error) {
            res.status(500).json({ error: 'Błąd serwera' });
        }
    }
}

module.exports = { authController: new AuthController() };