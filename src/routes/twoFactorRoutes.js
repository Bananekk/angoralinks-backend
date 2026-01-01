// routes/twoFactorRoutes.js
const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { verifyToken } = require('../middleware/auth');
const twoFactorService = require('../services/twoFactorService');
const emailUtils = require('../utils/email');

const router = express.Router();
const prisma = new PrismaClient();

// Wszystkie routy wymagają zalogowania
router.use(verifyToken);

// Helper do pobierania IP
const getClientIp = (req) => {
    return req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
           req.headers['x-real-ip'] ||
           req.connection?.remoteAddress ||
           req.ip || 
           'unknown';
};

// =====================================
// GET /api/2fa/status - Status 2FA użytkownika
// =====================================
router.get('/status', async (req, res) => {
    try {
        const userId = req.userId;

        const status = await twoFactorService.getTwoFactorStatus(userId);

        res.json({
            success: true,
            data: status
        });

    } catch (error) {
        console.error('Error getting 2FA status:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Błąd pobierania statusu 2FA' 
        });
    }
});

// =====================================
// TOTP (Google Authenticator, Authy, etc.)
// =====================================

// POST /api/2fa/totp/setup - Rozpocznij konfigurację TOTP
router.post('/totp/setup', async (req, res) => {
    try {
        const userId = req.userId;

        // Sprawdź czy TOTP już włączone
        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { 
                email: true, 
                twoFactorMethod: true 
            }
        });

        if (user.twoFactorMethod?.includes('TOTP')) {
            return res.status(400).json({
                success: false,
                error: 'TOTP jest już skonfigurowane. Najpierw je wyłącz.'
            });
        }

        // Generuj sekret i QR code
        const { secret, qrCode, manualEntry } = await twoFactorService.generateTotpSecret(
            userId,
            user.email
        );

        res.json({
            success: true,
            data: {
                secret,  // Potrzebne do weryfikacji
                qrCode,  // Data URL do wyświetlenia
                manualEntry: {
                    secret: manualEntry.secret,
                    issuer: manualEntry.issuer,
                    account: manualEntry.account
                }
            }
        });

    } catch (error) {
        console.error('Error setting up TOTP:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Błąd konfiguracji TOTP' 
        });
    }
});

// POST /api/2fa/totp/verify - Zweryfikuj i włącz TOTP
router.post('/totp/verify', async (req, res) => {
    try {
        const userId = req.userId;
        const { secret, code } = req.body;

        if (!secret || !code) {
            return res.status(400).json({
                success: false,
                error: 'Sekret i kod są wymagane'
            });
        }

        // Włącz TOTP
        await twoFactorService.enableTotp(userId, secret, code);

        // Sprawdź czy to pierwsza metoda 2FA - jeśli tak, wygeneruj kody zapasowe
        const status = await twoFactorService.getTwoFactorStatus(userId);
        let backupCodes = null;

        if (status.backupCodesRemaining === 0) {
            backupCodes = await twoFactorService.generateBackupCodes(userId);
            
            // Wyślij kody zapasowe emailem
            const user = await prisma.user.findUnique({
                where: { id: userId },
                select: { email: true }
            });
            
            emailUtils.sendBackupCodes(user.email, backupCodes)
                .catch(err => console.error('Error sending backup codes email:', err));
        }

        // Wyślij powiadomienie o włączeniu 2FA
        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { email: true }
        });

        emailUtils.sendTwoFactorEnabledNotification(user.email, 'TOTP')
            .catch(err => console.error('Error sending 2FA enabled notification:', err));

        res.json({
            success: true,
            message: 'TOTP zostało włączone',
            data: {
                backupCodes  // Null jeśli już były wygenerowane wcześniej
            }
        });

    } catch (error) {
        console.error('Error verifying TOTP:', error);
        res.status(400).json({ 
            success: false, 
            error: error.message || 'Nieprawidłowy kod weryfikacyjny' 
        });
    }
});

// DELETE /api/2fa/totp - Wyłącz TOTP
router.delete('/totp', async (req, res) => {
    try {
        const userId = req.userId;
        const { code, password } = req.body;

        // Sprawdź czy użytkownik ma włączone TOTP
        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { 
                twoFactorMethod: true, 
                twoFactorRequired: true,
                password_hash: true
            }
        });

        if (!user.twoFactorMethod?.includes('TOTP')) {
            return res.status(400).json({
                success: false,
                error: 'TOTP nie jest włączone'
            });
        }

        // Sprawdź czy 2FA nie jest wymagane przez admina
        if (user.twoFactorRequired) {
            // Sprawdź czy zostanie inna metoda
            const otherMethods = user.twoFactorMethod.filter(m => m !== 'TOTP');
            if (otherMethods.length === 0) {
                return res.status(403).json({
                    success: false,
                    error: '2FA jest wymagane przez administratora. Nie możesz wyłączyć ostatniej metody.'
                });
            }
        }

        // Wymagaj weryfikacji kodem TOTP lub hasłem
        if (code) {
            const isValid = await twoFactorService.verifyTwoFactorCode(userId, code);
            if (!isValid) {
                return res.status(400).json({
                    success: false,
                    error: 'Nieprawidłowy kod weryfikacyjny'
                });
            }
        } else if (password) {
            const bcrypt = require('bcryptjs');
            const isValidPassword = await bcrypt.compare(password, user.password_hash);
            if (!isValidPassword) {
                return res.status(400).json({
                    success: false,
                    error: 'Nieprawidłowe hasło'
                });
            }
        } else {
            return res.status(400).json({
                success: false,
                error: 'Wymagany kod 2FA lub hasło'
            });
        }

        await twoFactorService.disableTotp(userId);

        res.json({
            success: true,
            message: 'TOTP zostało wyłączone'
        });

    } catch (error) {
        console.error('Error disabling TOTP:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message || 'Błąd wyłączania TOTP' 
        });
    }
});

// =====================================
// WebAuthn (Passkeys, Security Keys, Biometrics)
// =====================================

// POST /api/2fa/webauthn/register/options - Opcje rejestracji WebAuthn
router.post('/webauthn/register/options', async (req, res) => {
    try {
        const userId = req.userId;

        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { email: true }
        });

        const options = await twoFactorService.generateWebAuthnRegistrationOptions(
            userId,
            user.email
        );

        res.json({
            success: true,
            data: options
        });

    } catch (error) {
        console.error('Error generating WebAuthn registration options:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Błąd generowania opcji rejestracji' 
        });
    }
});

// POST /api/2fa/webauthn/register/verify - Zweryfikuj i zapisz credential WebAuthn
router.post('/webauthn/register/verify', async (req, res) => {
    try {
        const userId = req.userId;
        const { response, deviceName } = req.body;

        if (!response) {
            return res.status(400).json({
                success: false,
                error: 'Odpowiedź WebAuthn jest wymagana'
            });
        }

        await twoFactorService.verifyWebAuthnRegistration(userId, response, deviceName);

        // Sprawdź czy to pierwsza metoda 2FA
        const status = await twoFactorService.getTwoFactorStatus(userId);
        let backupCodes = null;

        if (status.backupCodesRemaining === 0) {
            backupCodes = await twoFactorService.generateBackupCodes(userId);
            
            const user = await prisma.user.findUnique({
                where: { id: userId },
                select: { email: true }
            });
            
            emailUtils.sendBackupCodes(user.email, backupCodes)
                .catch(err => console.error('Error sending backup codes email:', err));
        }

        // Wyślij powiadomienie
        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { email: true }
        });

        emailUtils.sendTwoFactorEnabledNotification(user.email, 'WEBAUTHN')
            .catch(err => console.error('Error sending 2FA enabled notification:', err));

        res.json({
            success: true,
            message: 'Klucz bezpieczeństwa został zarejestrowany',
            data: {
                backupCodes
            }
        });

    } catch (error) {
        console.error('Error verifying WebAuthn registration:', error);
        res.status(400).json({ 
            success: false, 
            error: error.message || 'Błąd rejestracji klucza' 
        });
    }
});

// GET /api/2fa/webauthn/credentials - Lista zarejestrowanych kluczy
router.get('/webauthn/credentials', async (req, res) => {
    try {
        const userId = req.userId;

        const credentials = await prisma.webAuthnCredential.findMany({
            where: { userId },
            select: {
                id: true,
                deviceName: true,
                credentialDeviceType: true,
                credentialBackedUp: true,
                lastUsedAt: true,
                createdAt: true
            },
            orderBy: { createdAt: 'desc' }
        });

        res.json({
            success: true,
            data: credentials.map(cred => ({
                id: cred.id,
                deviceName: cred.deviceName || 'Klucz bezpieczeństwa',
                type: cred.credentialDeviceType,
                backedUp: cred.credentialBackedUp,
                lastUsedAt: cred.lastUsedAt,
                createdAt: cred.createdAt
            }))
        });

    } catch (error) {
        console.error('Error getting WebAuthn credentials:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Błąd pobierania kluczy' 
        });
    }
});

// DELETE /api/2fa/webauthn/credentials/:id - Usuń klucz WebAuthn
router.delete('/webauthn/credentials/:id', async (req, res) => {
    try {
        const userId = req.userId;
        const { id } = req.params;
        const { code, password } = req.body;

        // Sprawdź czy klucz należy do użytkownika
        const credential = await prisma.webAuthnCredential.findFirst({
            where: { id, userId }
        });

        if (!credential) {
            return res.status(404).json({
                success: false,
                error: 'Klucz nie znaleziony'
            });
        }

        // Sprawdź czy to nie ostatnia metoda przy wymaganiu 2FA
        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { 
                twoFactorMethod: true, 
                twoFactorRequired: true,
                password_hash: true
            }
        });

        const credentialsCount = await prisma.webAuthnCredential.count({
            where: { userId }
        });

        if (user.twoFactorRequired && credentialsCount <= 1 && !user.twoFactorMethod?.includes('TOTP')) {
            return res.status(403).json({
                success: false,
                error: '2FA jest wymagane. Nie możesz usunąć ostatniego klucza bez innej metody 2FA.'
            });
        }

        // Wymagaj weryfikacji
        if (code && user.twoFactorMethod?.includes('TOTP')) {
            const isValid = await twoFactorService.verifyTwoFactorCode(userId, code);
            if (!isValid) {
                return res.status(400).json({
                    success: false,
                    error: 'Nieprawidłowy kod weryfikacyjny'
                });
            }
        } else if (password) {
            const bcrypt = require('bcryptjs');
            const isValidPassword = await bcrypt.compare(password, user.password_hash);
            if (!isValidPassword) {
                return res.status(400).json({
                    success: false,
                    error: 'Nieprawidłowe hasło'
                });
            }
        } else {
            return res.status(400).json({
                success: false,
                error: 'Wymagany kod 2FA lub hasło'
            });
        }

        await twoFactorService.removeWebAuthnCredential(userId, id);

        res.json({
            success: true,
            message: 'Klucz został usunięty'
        });

    } catch (error) {
        console.error('Error removing WebAuthn credential:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message || 'Błąd usuwania klucza' 
        });
    }
});

// PATCH /api/2fa/webauthn/credentials/:id - Zmień nazwę klucza
router.patch('/webauthn/credentials/:id', async (req, res) => {
    try {
        const userId = req.userId;
        const { id } = req.params;
        const { deviceName } = req.body;

        if (!deviceName || deviceName.trim().length === 0) {
            return res.status(400).json({
                success: false,
                error: 'Nazwa jest wymagana'
            });
        }

        const credential = await prisma.webAuthnCredential.findFirst({
            where: { id, userId }
        });

        if (!credential) {
            return res.status(404).json({
                success: false,
                error: 'Klucz nie znaleziony'
            });
        }

        await prisma.webAuthnCredential.update({
            where: { id },
            data: { deviceName: deviceName.trim().substring(0, 100) }
        });

        res.json({
            success: true,
            message: 'Nazwa klucza została zmieniona'
        });

    } catch (error) {
        console.error('Error updating WebAuthn credential:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Błąd aktualizacji klucza' 
        });
    }
});

// =====================================
// Kody zapasowe (Backup Codes)
// =====================================

// GET /api/2fa/backup-codes/count - Liczba pozostałych kodów
router.get('/backup-codes/count', async (req, res) => {
    try {
        const userId = req.userId;

        const remaining = await twoFactorService.getRemainingBackupCodesCount(userId);

        res.json({
            success: true,
            data: {
                remaining,
                total: 10
            }
        });

    } catch (error) {
        console.error('Error getting backup codes count:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Błąd pobierania liczby kodów' 
        });
    }
});

// POST /api/2fa/backup-codes/regenerate - Wygeneruj nowe kody zapasowe
router.post('/backup-codes/regenerate', async (req, res) => {
    try {
        const userId = req.userId;
        const { code, password } = req.body;

        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { 
                email: true,
                twoFactorEnabled: true,
                twoFactorMethod: true,
                password_hash: true
            }
        });

        if (!user.twoFactorEnabled) {
            return res.status(400).json({
                success: false,
                error: '2FA nie jest włączone'
            });
        }

        // Wymagaj weryfikacji
        if (code && user.twoFactorMethod?.includes('TOTP')) {
            const isValid = await twoFactorService.verifyTwoFactorCode(userId, code);
            if (!isValid) {
                return res.status(400).json({
                    success: false,
                    error: 'Nieprawidłowy kod weryfikacyjny'
                });
            }
        } else if (password) {
            const bcrypt = require('bcryptjs');
            const isValidPassword = await bcrypt.compare(password, user.password_hash);
            if (!isValidPassword) {
                return res.status(400).json({
                    success: false,
                    error: 'Nieprawidłowe hasło'
                });
            }
        } else {
            return res.status(400).json({
                success: false,
                error: 'Wymagany kod 2FA lub hasło'
            });
        }

        const backupCodes = await twoFactorService.generateBackupCodes(userId);

        // Wyślij nowe kody emailem
        emailUtils.sendBackupCodes(user.email, backupCodes)
            .catch(err => console.error('Error sending backup codes email:', err));

        res.json({
            success: true,
            message: 'Wygenerowano nowe kody zapasowe',
            data: {
                backupCodes
            }
        });

    } catch (error) {
        console.error('Error regenerating backup codes:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Błąd generowania kodów' 
        });
    }
});

// =====================================
// Całkowite wyłączenie 2FA
// =====================================

// DELETE /api/2fa - Wyłącz całkowicie 2FA
router.delete('/', async (req, res) => {
    try {
        const userId = req.userId;
        const { code, password } = req.body;

        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { 
                email: true,
                twoFactorEnabled: true,
                twoFactorRequired: true,
                twoFactorMethod: true,
                password_hash: true
            }
        });

        if (!user.twoFactorEnabled) {
            return res.status(400).json({
                success: false,
                error: '2FA nie jest włączone'
            });
        }

        if (user.twoFactorRequired) {
            return res.status(403).json({
                success: false,
                error: '2FA jest wymagane przez administratora i nie może być wyłączone'
            });
        }

        // Wymagaj weryfikacji
        let verified = false;

        if (code && user.twoFactorMethod?.includes('TOTP')) {
            verified = await twoFactorService.verifyTwoFactorCode(userId, code);
        }
        
        if (!verified && password) {
            const bcrypt = require('bcryptjs');
            verified = await bcrypt.compare(password, user.password_hash);
        }

        if (!verified) {
            return res.status(400).json({
                success: false,
                error: 'Nieprawidłowy kod weryfikacyjny lub hasło'
            });
        }

        await twoFactorService.disableTwoFactor(userId);

        res.json({
            success: true,
            message: '2FA zostało całkowicie wyłączone'
        });

    } catch (error) {
        console.error('Error disabling 2FA:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message || 'Błąd wyłączania 2FA' 
        });
    }
});

// =====================================
// Historia/Logi 2FA
// =====================================

// GET /api/2fa/logs - Historia aktywności 2FA
router.get('/logs', async (req, res) => {
    try {
        const userId = req.userId;
        const { limit = 20 } = req.query;

        const logs = await prisma.twoFactorLog.findMany({
            where: { userId },
            orderBy: { createdAt: 'desc' },
            take: Math.min(parseInt(limit), 100),
            select: {
                id: true,
                action: true,
                method: true,
                success: true,
                ipAddress: true,
                createdAt: true
            }
        });

        // Zamaskuj IP
        const maskedLogs = logs.map(log => ({
            ...log,
            ipAddress: log.ipAddress 
                ? log.ipAddress.replace(/\.\d+$/, '.***') 
                : null
        }));

        res.json({
            success: true,
            data: maskedLogs
        });

    } catch (error) {
        console.error('Error getting 2FA logs:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Błąd pobierania historii' 
        });
    }
});

module.exports = router;