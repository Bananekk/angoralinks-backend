// controllers/twoFactorController.js
const twoFactorService = require('../services/twoFactorService');
const prisma = require('../config/database');

// ========== TOTP ==========

/**
 * Rozpoczyna konfigurację TOTP - generuje sekret i QR code
 */
exports.initTotpSetup = async (req, res) => {
  try {
    const userId = req.user.id;
    
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, twoFactorMethod: true }
    });
    
    // Sprawdź czy TOTP już włączone
    if (user.twoFactorMethod.includes('TOTP')) {
      return res.status(400).json({
        success: false,
        message: 'TOTP jest już skonfigurowane'
      });
    }
    
    const { secret, qrCode, manualEntry } = await twoFactorService.generateTotpSecret(
      userId,
      user.email
    );
    
    // Tymczasowo zapisz sekret w sesji/cache (nie w bazie)
    // W produkcji użyj Redis
    req.session = req.session || {};
    req.session.pendingTotpSecret = secret;
    
    res.json({
      success: true,
      data: {
        qrCode,
        manualEntry: {
          secret: manualEntry.secret,
          issuer: manualEntry.issuer
        }
      }
    });
  } catch (error) {
    console.error('Init TOTP setup error:', error);
    res.status(500).json({
      success: false,
      message: 'Błąd podczas inicjalizacji TOTP'
    });
  }
};

/**
 * Finalizuje konfigurację TOTP - weryfikuje kod i zapisuje
 */
exports.enableTotp = async (req, res) => {
  try {
    const userId = req.user.id;
    const { code, secret } = req.body;
    
    if (!code || !secret) {
      return res.status(400).json({
        success: false,
        message: 'Kod weryfikacyjny i sekret są wymagane'
      });
    }
    
    await twoFactorService.enableTotp(userId, secret, code);
    
    // Wygeneruj kody zapasowe jeśli to pierwsza metoda 2FA
    const status = await twoFactorService.getTwoFactorStatus(userId);
    let backupCodes = null;
    
    if (status.backupCodesRemaining === 0) {
      backupCodes = await twoFactorService.generateBackupCodes(userId);
    }
    
    res.json({
      success: true,
      message: 'TOTP zostało włączone',
      data: {
        backupCodes // Tylko przy pierwszej konfiguracji
      }
    });
  } catch (error) {
    console.error('Enable TOTP error:', error);
    res.status(400).json({
      success: false,
      message: error.message || 'Błąd podczas włączania TOTP'
    });
  }
};

/**
 * Wyłącza TOTP
 */
exports.disableTotp = async (req, res) => {
  try {
    const userId = req.user.id;
    const { code } = req.body;
    
    // Wymagaj weryfikacji kodem
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { twoFactorSecret: true, twoFactorRequired: true }
    });
    
    if (user.twoFactorRequired) {
      return res.status(403).json({
        success: false,
        message: '2FA jest wymagane przez administratora'
      });
    }
    
    if (!code) {
      return res.status(400).json({
        success: false,
        message: 'Kod weryfikacyjny jest wymagany'
      });
    }
    
    const isValid = await twoFactorService.verifyTwoFactorCode(userId, code);
    
    if (!isValid) {
      return res.status(400).json({
        success: false,
        message: 'Nieprawidłowy kod weryfikacyjny'
      });
    }
    
    await twoFactorService.disableTotp(userId);
    
    res.json({
      success: true,
      message: 'TOTP zostało wyłączone'
    });
  } catch (error) {
    console.error('Disable TOTP error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Błąd podczas wyłączania TOTP'
    });
  }
};

// ========== WEBAUTHN ==========

/**
 * Rozpoczyna rejestrację WebAuthn
 */
exports.initWebAuthnRegistration = async (req, res) => {
  try {
    const userId = req.user.id;
    
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
    console.error('Init WebAuthn registration error:', error);
    res.status(500).json({
      success: false,
      message: 'Błąd podczas inicjalizacji rejestracji klucza'
    });
  }
};

/**
 * Finalizuje rejestrację WebAuthn
 */
exports.completeWebAuthnRegistration = async (req, res) => {
  try {
    const userId = req.user.id;
    const { response, deviceName } = req.body;
    
    if (!response) {
      return res.status(400).json({
        success: false,
        message: 'Odpowiedź WebAuthn jest wymagana'
      });
    }
    
    await twoFactorService.verifyWebAuthnRegistration(userId, response, deviceName);
    
    // Wygeneruj kody zapasowe jeśli to pierwsza metoda 2FA
    const status = await twoFactorService.getTwoFactorStatus(userId);
    let backupCodes = null;
    
    if (status.backupCodesRemaining === 0) {
      backupCodes = await twoFactorService.generateBackupCodes(userId);
    }
    
    res.json({
      success: true,
      message: 'Klucz bezpieczeństwa został zarejestrowany',
      data: {
        backupCodes
      }
    });
  } catch (error) {
    console.error('Complete WebAuthn registration error:', error);
    res.status(400).json({
      success: false,
      message: error.message || 'Błąd podczas rejestracji klucza'
    });
  }
};

/**
 * Rozpoczyna autentykację WebAuthn
 */
exports.initWebAuthnAuthentication = async (req, res) => {
  try {
    const { userId } = req.body; // Przesłane po weryfikacji hasła
    
    if (!userId) {
      return res.status(400).json({
        success: false,
        message: 'ID użytkownika jest wymagane'
      });
    }
    
    const options = await twoFactorService.generateWebAuthnAuthenticationOptions(userId);
    
    res.json({
      success: true,
      data: options
    });
  } catch (error) {
    console.error('Init WebAuthn authentication error:', error);
    res.status(400).json({
      success: false,
      message: error.message || 'Błąd podczas inicjalizacji autentykacji'
    });
  }
};

/**
 * Finalizuje autentykację WebAuthn
 */
exports.completeWebAuthnAuthentication = async (req, res) => {
  try {
    const { userId, response } = req.body;
    
    if (!userId || !response) {
      return res.status(400).json({
        success: false,
        message: 'ID użytkownika i odpowiedź są wymagane'
      });
    }
    
    await twoFactorService.verifyWebAuthnAuthentication(userId, response);
    
    res.json({
      success: true,
      verified: true
    });
  } catch (error) {
    console.error('Complete WebAuthn authentication error:', error);
    res.status(400).json({
      success: false,
      message: error.message || 'Błąd podczas autentykacji'
    });
  }
};

/**
 * Usuwa credential WebAuthn
 */
exports.removeWebAuthnCredential = async (req, res) => {
  try {
    const userId = req.user.id;
    const { credentialId } = req.params;
    const { code } = req.body;
    
    // Wymagaj weryfikacji
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { twoFactorMethod: true, twoFactorRequired: true }
    });
    
    // Sprawdź czy to nie ostatnia metoda przy wymaganiu 2FA
    const credentials = await prisma.webAuthnCredential.count({
      where: { userId }
    });
    
    if (user.twoFactorRequired && credentials <= 1 && !user.twoFactorMethod.includes('TOTP')) {
      return res.status(403).json({
        success: false,
        message: '2FA jest wymagane - nie można usunąć ostatniego klucza'
      });
    }
    
    // Weryfikacja kodem TOTP jeśli dostępne
    if (user.twoFactorMethod.includes('TOTP')) {
      if (!code) {
        return res.status(400).json({
          success: false,
          message: 'Kod weryfikacyjny jest wymagany'
        });
      }
      
      const isValid = await twoFactorService.verifyTwoFactorCode(userId, code);
      if (!isValid) {
        return res.status(400).json({
          success: false,
          message: 'Nieprawidłowy kod weryfikacyjny'
        });
      }
    }
    
    await twoFactorService.removeWebAuthnCredential(userId, credentialId);
    
    res.json({
      success: true,
      message: 'Klucz został usunięty'
    });
  } catch (error) {
    console.error('Remove WebAuthn credential error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Błąd podczas usuwania klucza'
    });
  }
};

// ========== BACKUP CODES ==========

/**
 * Regeneruje kody zapasowe
 */
exports.regenerateBackupCodes = async (req, res) => {
  try {
    const userId = req.user.id;
    const { code } = req.body;
    
    // Wymagaj weryfikacji
    if (!code) {
      return res.status(400).json({
        success: false,
        message: 'Kod weryfikacyjny jest wymagany'
      });
    }
    
    const isValid = await twoFactorService.verifyTwoFactorCode(userId, code);
    
    if (!isValid) {
      return res.status(400).json({
        success: false,
        message: 'Nieprawidłowy kod weryfikacyjny'
      });
    }
    
    const backupCodes = await twoFactorService.generateBackupCodes(userId);
    
    res.json({
      success: true,
      message: 'Wygenerowano nowe kody zapasowe',
      data: {
        backupCodes
      }
    });
  } catch (error) {
    console.error('Regenerate backup codes error:', error);
    res.status(500).json({
      success: false,
      message: 'Błąd podczas generowania kodów'
    });
  }
};

/**
 * Weryfikuje kod zapasowy
 */
exports.verifyBackupCode = async (req, res) => {
  try {
    const { userId, code } = req.body;
    
    if (!userId || !code) {
      return res.status(400).json({
        success: false,
        message: 'ID użytkownika i kod są wymagane'
      });
    }
    
    const isValid = await twoFactorService.verifyBackupCode(userId, code);
    
    if (!isValid) {
      return res.status(400).json({
        success: false,
        message: 'Nieprawidłowy lub użyty kod zapasowy'
      });
    }
    
    res.json({
      success: true,
      verified: true
    });
  } catch (error) {
    console.error('Verify backup code error:', error);
    res.status(500).json({
      success: false,
      message: 'Błąd podczas weryfikacji kodu'
    });
  }
};

// ========== STATUS I ZARZĄDZANIE ==========

/**
 * Pobiera status 2FA użytkownika
 */
exports.getTwoFactorStatus = async (req, res) => {
  try {
    const userId = req.user.id;
    
    const status = await twoFactorService.getTwoFactorStatus(userId);
    
    res.json({
      success: true,
      data: status
    });
  } catch (error) {
    console.error('Get 2FA status error:', error);
    res.status(500).json({
      success: false,
      message: 'Błąd podczas pobierania statusu 2FA'
    });
  }
};

/**
 * Całkowicie wyłącza 2FA
 */
exports.disableTwoFactor = async (req, res) => {
  try {
    const userId = req.user.id;
    const { code, password } = req.body;
    
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { twoFactorRequired: true, password_hash: true }
    });
    
    if (user.twoFactorRequired) {
      return res.status(403).json({
        success: false,
        message: '2FA jest wymagane przez administratora i nie może być wyłączone'
      });
    }
    
    // Weryfikuj hasło
    const bcrypt = require('bcryptjs');
    const passwordValid = await bcrypt.compare(password, user.password_hash);
    
    if (!passwordValid) {
      return res.status(400).json({
        success: false,
        message: 'Nieprawidłowe hasło'
      });
    }
    
    await twoFactorService.disableTwoFactor(userId, code, 'TOTP');
    
    res.json({
      success: true,
      message: '2FA zostało wyłączone'
    });
  } catch (error) {
    console.error('Disable 2FA error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Błąd podczas wyłączania 2FA'
    });
  }
};

/**
 * Weryfikuje kod TOTP (używane przy logowaniu)
 */
exports.verifyTotpCode = async (req, res) => {
  try {
    const { userId, code } = req.body;
    const ip = req.ip;
    const userAgent = req.headers['user-agent'];
    
    if (!userId || !code) {
      return res.status(400).json({
        success: false,
        message: 'ID użytkownika i kod są wymagane'
      });
    }
    
    const isValid = await twoFactorService.verifyTwoFactorCode(userId, code, ip, userAgent);
    
    if (!isValid) {
      return res.status(400).json({
        success: false,
        message: 'Nieprawidłowy kod'
      });
    }
    
    res.json({
      success: true,
      verified: true
    });
  } catch (error) {
    console.error('Verify TOTP code error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Błąd podczas weryfikacji kodu'
    });
  }
};