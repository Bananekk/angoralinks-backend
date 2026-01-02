// services/twoFactorService.js

// Polyfill dla WebCrypto na starszych wersjach Node.js
const { webcrypto } = require('crypto');
if (!globalThis.crypto) {
    globalThis.crypto = webcrypto;
}

const { authenticator } = require('otplib');
const QRCode = require('qrcode');
const crypto = require('crypto');
const { 
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse 
} = require('@simplewebauthn/server');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// Konfiguracja
const ENCRYPTION_KEY = process.env.TWO_FACTOR_ENCRYPTION_KEY;
const ISSUER = process.env.TWO_FACTOR_ISSUER || 'AngoraLinks';
const RP_NAME = process.env.WEBAUTHN_RP_NAME || 'AngoraLinks';
const RP_ID = process.env.WEBAUTHN_RP_ID || 'angoralinks.pl';
const ORIGIN = process.env.WEBAUTHN_ORIGIN || 'https://angoralinks.pl';

// Konfiguracja TOTP
authenticator.options = {
  digits: 6,
  step: 30,
  window: 1
};

// ========== POMOCNICZE FUNKCJE SZYFROWANIA ==========

function encrypt(text) {
  const iv = crypto.randomBytes(16);
  const key = crypto.scryptSync(ENCRYPTION_KEY, 'salt', 32);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  
  const authTag = cipher.getAuthTag();
  
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
}

function decrypt(encryptedText) {
  const [ivHex, authTagHex, encrypted] = encryptedText.split(':');
  
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  const key = crypto.scryptSync(ENCRYPTION_KEY, 'salt', 32);
  
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  
  return decrypted;
}

function hashBackupCode(code) {
  return crypto.createHash('sha256').update(code).digest('hex');
}

function generateBackupCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 8; i++) {
    code += chars.charAt(crypto.randomInt(chars.length));
  }
  return code;
}

// ========== TOTP (Google Authenticator) ==========

async function generateTotpSecret(userId, userEmail) {
  const secret = authenticator.generateSecret();
  const otpauth = authenticator.keyuri(userEmail, ISSUER, secret);
  
  const qrCodeDataUrl = await QRCode.toDataURL(otpauth, {
    width: 256,
    margin: 2,
    color: {
      dark: '#000000',
      light: '#ffffff'
    }
  });
  
  return {
    secret,
    qrCode: qrCodeDataUrl,
    manualEntry: {
      secret: secret,
      issuer: ISSUER,
      account: userEmail
    }
  };
}

function verifyTotpCode(secret, code) {
  try {
    return authenticator.verify({ token: code, secret });
  } catch (error) {
    console.error('TOTP verification error:', error);
    return false;
  }
}

async function enableTotp(userId, secret, verificationCode) {
  const isValid = verifyTotpCode(secret, verificationCode);
  
  if (!isValid) {
    throw new Error('Nieprawidłowy kod weryfikacyjny');
  }
  
  const encryptedSecret = encrypt(secret);
  
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { twoFactorMethod: true }
  });
  
  const methods = user.twoFactorMethod || [];
  if (!methods.includes('TOTP')) {
    methods.push('TOTP');
  }
  
  await prisma.user.update({
    where: { id: userId },
    data: {
      twoFactorSecret: encryptedSecret,
      twoFactorEnabled: true,
      twoFactorMethod: methods,
      twoFactorEnabledAt: new Date()
    }
  });
  
  await logTwoFactorAction(userId, 'ENABLED', 'TOTP', true);
  
  return true;
}

async function disableTotp(userId) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { twoFactorMethod: true }
  });
  
  const methods = (user.twoFactorMethod || []).filter(m => m !== 'TOTP');
  
  await prisma.user.update({
    where: { id: userId },
    data: {
      twoFactorSecret: null,
      twoFactorMethod: methods,
      twoFactorEnabled: methods.length > 0
    }
  });
  
  await logTwoFactorAction(userId, 'DISABLED', 'TOTP', true);
  
  return true;
}

// ========== WEBAUTHN (Passkeys/Security Keys) ==========

const challengeStore = new Map();

async function generateWebAuthnRegistrationOptions(userId, userEmail) {
  const existingCredentials = await prisma.webAuthnCredential.findMany({
    where: { userId },
    select: { credentialId: true }
  });
  
  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: RP_ID,
    userID: new TextEncoder().encode(userId),
    userName: userEmail,
    userDisplayName: userEmail.split('@')[0],
    attestationType: 'none',
    excludeCredentials: existingCredentials.map(cred => ({
      id: cred.credentialId,
      type: 'public-key',
      transports: ['usb', 'ble', 'nfc', 'internal']
    })),
    authenticatorSelection: {
      residentKey: 'preferred',
      userVerification: 'preferred',
    },
    supportedAlgorithmIDs: [-7, -257]
  });
  
  // Zapisz challenge
  challengeStore.set(`reg_${userId}`, {
    challenge: options.challenge,
    expiresAt: Date.now() + 5 * 60 * 1000
  });
  
  console.log('Registration challenge saved for:', `reg_${userId}`);
  
  return options;
}

async function verifyWebAuthnRegistration(userId, response, deviceName = null) {
  const stored = challengeStore.get(`reg_${userId}`);
  
  if (!stored || stored.expiresAt < Date.now()) {
    throw new Error('Challenge wygasł lub nie istnieje');
  }
  
  try {
    const verification = await verifyRegistrationResponse({
      response,
      expectedChallenge: stored.challenge,
      expectedOrigin: ORIGIN,
      expectedRPID: RP_ID,
      requireUserVerification: true
    });
    
    if (!verification.verified || !verification.registrationInfo) {
      throw new Error('Weryfikacja nie powiodła się');
    }
    
    const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;
    
    // W v13+ używamy response.id który jest już prawidłowym base64url stringiem
    const credentialIdToStore = response.id;
    const publicKeyBase64 = Buffer.from(credential.publicKey).toString('base64url');
    
    console.log('Saving credential with public key length:', credential.publicKey.length);
    console.log('Public key Base64URL:', publicKeyBase64.substring(0, 50) + '...');
    
    await prisma.webAuthnCredential.create({
      data: {
        userId,
        credentialId: credentialIdToStore,
        credentialPublicKey: publicKeyBase64,
        counter: BigInt(credential.counter),
        credentialDeviceType,
        credentialBackedUp,
        transports: response.response.transports || [],
        deviceName: deviceName || detectDeviceName(response)
      }
    });
    
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { twoFactorMethod: true }
    });
    
    const methods = user.twoFactorMethod || [];
    if (!methods.includes('WEBAUTHN')) {
      methods.push('WEBAUTHN');
    }
    
    await prisma.user.update({
      where: { id: userId },
      data: {
        twoFactorEnabled: true,
        twoFactorMethod: methods,
        twoFactorEnabledAt: new Date()
      }
    });
    
    challengeStore.delete(`reg_${userId}`);
    
    await logTwoFactorAction(userId, 'WEBAUTHN_REGISTERED', 'WEBAUTHN', true);
    
    return { verified: true };
  } catch (error) {
    console.error('WebAuthn registration error:', error);
    throw error;
  }
}

async function generateWebAuthnAuthenticationOptions(userId) {
  const credentials = await prisma.webAuthnCredential.findMany({
    where: { userId },
    select: { credentialId: true, transports: true }
  });
  
  if (credentials.length === 0) {
    throw new Error('Brak zarejestrowanych kluczy');
  }
  
  console.log('Generating auth options for userId:', userId);
  console.log('Credentials from DB:', credentials.map(c => c.credentialId));
  
  const options = await generateAuthenticationOptions({
    rpID: RP_ID,
    allowCredentials: credentials.map(cred => ({
      id: cred.credentialId,
      type: 'public-key',
      transports: cred.transports?.length > 0 ? cred.transports : ['internal', 'hybrid']
    })),
    userVerification: 'preferred'
  });
  
  // Zapisz challenge do store
  challengeStore.set(`auth_${userId}`, {
    challenge: options.challenge,
    expiresAt: Date.now() + 5 * 60 * 1000
  });
  
  console.log('Auth challenge saved for:', `auth_${userId}`);
  console.log('ChallengeStore size:', challengeStore.size);
  
  return options;
}

async function verifyWebAuthnAuthentication(userId, response) {
  console.log('=== VERIFY AUTH START ===');
  console.log('userId:', userId);
  console.log('Looking for key:', `auth_${userId}`);
  console.log('ChallengeStore size:', challengeStore.size);
  console.log('ChallengeStore keys:', Array.from(challengeStore.keys()));
  
  const stored = challengeStore.get(`auth_${userId}`);
  
  console.log('Stored challenge found:', !!stored);
  
  if (!stored || stored.expiresAt < Date.now()) {
    console.log('Challenge expired or not found!');
    throw new Error('Challenge wygasł lub nie istnieje');
  }
  
  const credential = await prisma.webAuthnCredential.findUnique({
    where: { credentialId: response.id }
  });
  
  if (!credential || credential.userId !== userId) {
    throw new Error('Nieznany klucz');
  }
  
  try {
    // ⭐ KLUCZOWA POPRAWKA - konwersja Base64URL -> Uint8Array/Buffer
    const publicKeyBytes = Buffer.from(credential.credentialPublicKey, 'base64url');
    
    console.log('Public key from DB:', credential.credentialPublicKey?.substring(0, 50) + '...');
    console.log('Public key bytes length:', publicKeyBytes.length);
    
    // Sprawdź czy klucz nie jest pusty
    if (publicKeyBytes.length === 0) {
      throw new Error('Klucz publiczny jest pusty - wymagana ponowna rejestracja');
    }
    
    const verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge: stored.challenge,
      expectedOrigin: ORIGIN,
      expectedRPID: RP_ID,
      credential: {
        id: credential.credentialId,
        publicKey: publicKeyBytes,  // ⭐ Teraz to Buffer/Uint8Array!
        counter: Number(credential.counter)
      },
      requireUserVerification: true
    });
    
    if (!verification.verified) {
      throw new Error('Weryfikacja nie powiodła się');
    }
    
    await prisma.webAuthnCredential.update({
      where: { id: credential.id },
      data: {
        counter: BigInt(verification.authenticationInfo.newCounter),
        lastUsedAt: new Date()
      }
    });
    
    challengeStore.delete(`auth_${userId}`);
    
    await logTwoFactorAction(userId, 'VERIFIED', 'WEBAUTHN', true);
    
    await prisma.user.update({
      where: { id: userId },
      data: { twoFactorLastUsedAt: new Date() }
    });
    
    console.log('=== VERIFY AUTH SUCCESS ===');
    
    return { verified: true };
  } catch (error) {
    console.error('WebAuthn verification error:', error);
    await logTwoFactorAction(userId, 'FAILED', 'WEBAUTHN', false, null, null, error.message);
    throw error;
  }
}

async function removeWebAuthnCredential(userId, credentialId) {
  const credential = await prisma.webAuthnCredential.findFirst({
    where: { id: credentialId, userId }
  });
  
  if (!credential) {
    throw new Error('Credential nie znaleziony');
  }
  
  await prisma.webAuthnCredential.delete({
    where: { id: credentialId }
  });
  
  const remainingCredentials = await prisma.webAuthnCredential.count({
    where: { userId }
  });
  
  if (remainingCredentials === 0) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { twoFactorMethod: true }
    });
    
    const methods = (user.twoFactorMethod || []).filter(m => m !== 'WEBAUTHN');
    
    await prisma.user.update({
      where: { id: userId },
      data: {
        twoFactorMethod: methods,
        twoFactorEnabled: methods.length > 0
      }
    });
  }
  
  await logTwoFactorAction(userId, 'WEBAUTHN_REMOVED', 'WEBAUTHN', true);
  
  return true;
}

// ========== BACKUP CODES ==========

async function generateBackupCodes(userId) {
  await prisma.backupCode.deleteMany({
    where: { userId }
  });
  
  const codes = [];
  const codeRecords = [];
  
  for (let i = 0; i < 10; i++) {
    const code = generateBackupCode();
    codes.push(code);
    codeRecords.push({
      userId,
      codeHash: hashBackupCode(code)
    });
  }
  
  await prisma.backupCode.createMany({
    data: codeRecords
  });
  
  await logTwoFactorAction(userId, 'BACKUP_REGENERATED', null, true);
  
  return codes;
}

async function verifyBackupCode(userId, code) {
  const codeHash = hashBackupCode(code.toUpperCase().replace(/\s/g, ''));
  
  const backupCode = await prisma.backupCode.findFirst({
    where: {
      userId,
      codeHash,
      usedAt: null
    }
  });
  
  if (!backupCode) {
    await logTwoFactorAction(userId, 'FAILED', 'BACKUP_CODE', false, null, null, 'Nieprawidłowy lub użyty kod');
    return false;
  }
  
  await prisma.backupCode.update({
    where: { id: backupCode.id },
    data: { usedAt: new Date() }
  });
  
  await logTwoFactorAction(userId, 'BACKUP_USED', 'BACKUP_CODE', true);
  
  await prisma.user.update({
    where: { id: userId },
    data: { twoFactorLastUsedAt: new Date() }
  });
  
  return true;
}

async function getRemainingBackupCodesCount(userId) {
  return await prisma.backupCode.count({
    where: {
      userId,
      usedAt: null
    }
  });
}

// ========== ZARZĄDZANIE 2FA ==========

async function getTwoFactorStatus(userId) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      twoFactorEnabled: true,
      twoFactorMethod: true,
      twoFactorRequired: true,
      twoFactorEnabledAt: true,
      twoFactorLastUsedAt: true,
      webAuthnCredentials: {
        select: {
          id: true,
          deviceName: true,
          credentialDeviceType: true,
          lastUsedAt: true,
          createdAt: true
        }
      }
    }
  });
  
  const remainingBackupCodes = await getRemainingBackupCodesCount(userId);
  
  return {
    enabled: user.twoFactorEnabled,
    methods: user.twoFactorMethod,
    required: user.twoFactorRequired,
    enabledAt: user.twoFactorEnabledAt,
    lastUsedAt: user.twoFactorLastUsedAt,
    totpEnabled: user.twoFactorMethod.includes('TOTP'),
    webauthnEnabled: user.twoFactorMethod.includes('WEBAUTHN'),
    webauthnCredentials: user.webAuthnCredentials,
    backupCodesRemaining: remainingBackupCodes,
    backupCodesTotal: 10
  };
}

async function disableTwoFactor(userId, verificationCode = null, method = null) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { 
      twoFactorSecret: true, 
      twoFactorMethod: true,
      twoFactorRequired: true 
    }
  });
  
  if (user.twoFactorRequired) {
    throw new Error('2FA jest wymagane przez administratora i nie może być wyłączone');
  }
  
  if (verificationCode && user.twoFactorMethod.includes('TOTP') && user.twoFactorSecret) {
    const secret = decrypt(user.twoFactorSecret);
    const isValid = verifyTotpCode(secret, verificationCode);
    if (!isValid) {
      throw new Error('Nieprawidłowy kod weryfikacyjny');
    }
  }
  
  await prisma.$transaction([
    prisma.webAuthnCredential.deleteMany({ where: { userId } }),
    prisma.backupCode.deleteMany({ where: { userId } }),
    prisma.user.update({
      where: { id: userId },
      data: {
        twoFactorEnabled: false,
        twoFactorSecret: null,
        twoFactorMethod: [],
        twoFactorEnabledAt: null
      }
    })
  ]);
  
  await logTwoFactorAction(userId, 'DISABLED', method, true);
  
  return true;
}

async function verifyTwoFactorCode(userId, code, ipAddress = null, userAgent = null) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { twoFactorSecret: true, twoFactorMethod: true }
  });
  
  if (!user.twoFactorMethod.includes('TOTP') || !user.twoFactorSecret) {
    throw new Error('TOTP nie jest skonfigurowane');
  }
  
  const secret = decrypt(user.twoFactorSecret);
  const isValid = verifyTotpCode(secret, code);
  
  if (isValid) {
    await logTwoFactorAction(userId, 'VERIFIED', 'TOTP', true, ipAddress, userAgent);
    await prisma.user.update({
      where: { id: userId },
      data: { twoFactorLastUsedAt: new Date() }
    });
  } else {
    await logTwoFactorAction(userId, 'FAILED', 'TOTP', false, ipAddress, userAgent, 'Nieprawidłowy kod');
  }
  
  return isValid;
}

// ========== FUNKCJE ADMINA ==========

async function requireTwoFactor(userId, adminId) {
  await prisma.user.update({
    where: { id: userId },
    data: {
      twoFactorRequired: true,
      twoFactorRequiredAt: new Date(),
      twoFactorRequiredBy: adminId
    }
  });
  
  await logTwoFactorAction(userId, 'ADMIN_REQUIRED', null, true);
  
  return true;
}

async function removeRequireTwoFactor(userId) {
  await prisma.user.update({
    where: { id: userId },
    data: {
      twoFactorRequired: false,
      twoFactorRequiredAt: null,
      twoFactorRequiredBy: null
    }
  });
  
  return true;
}

async function adminResetTwoFactor(userId, adminId) {
  await prisma.$transaction([
    prisma.webAuthnCredential.deleteMany({ where: { userId } }),
    prisma.backupCode.deleteMany({ where: { userId } }),
    prisma.user.update({
      where: { id: userId },
      data: {
        twoFactorEnabled: false,
        twoFactorSecret: null,
        twoFactorMethod: [],
        twoFactorEnabledAt: null
      }
    })
  ]);
  
  await logTwoFactorAction(userId, 'ADMIN_RESET', null, true);
  
  return true;
}

// ========== POMOCNICZE ==========

async function logTwoFactorAction(userId, action, method, success, ipAddress = null, userAgent = null, failReason = null) {
  await prisma.twoFactorLog.create({
    data: {
      userId,
      action,
      method,
      success,
      ipAddress,
      userAgent,
      failReason
    }
  });
}

function detectDeviceName(response) {
  const transports = response.response?.transports || [];
  
  if (transports.includes('internal')) {
    return 'Biometria urządzenia';
  } else if (transports.includes('usb')) {
    return 'Klucz USB';
  } else if (transports.includes('nfc')) {
    return 'Klucz NFC';
  } else if (transports.includes('ble')) {
    return 'Klucz Bluetooth';
  }
  
  return 'Klucz bezpieczeństwa';
}

module.exports = {
  // TOTP
  generateTotpSecret,
  verifyTotpCode,
  enableTotp,
  disableTotp,
  
  // WebAuthn
  generateWebAuthnRegistrationOptions,
  verifyWebAuthnRegistration,
  generateWebAuthnAuthenticationOptions,
  verifyWebAuthnAuthentication,
  removeWebAuthnCredential,
  
  // Backup codes
  generateBackupCodes,
  verifyBackupCode,
  getRemainingBackupCodesCount,
  
  // Zarządzanie
  getTwoFactorStatus,
  disableTwoFactor,
  verifyTwoFactorCode,
  
  // Admin
  requireTwoFactor,
  removeRequireTwoFactor,
  adminResetTwoFactor,
  
  // Pomocnicze
  logTwoFactorAction
};