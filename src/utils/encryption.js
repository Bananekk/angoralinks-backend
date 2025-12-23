// src/utils/encryption.js

const crypto = require('crypto');

// Algorytm szyfrowania
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16; // 128 bits
const AUTH_TAG_LENGTH = 16; // 128 bits
const SALT_LENGTH = 32;

/**
 * Pobiera klucz szyfrowania ze zmiennych środowiskowych
 * Klucz powinien mieć 32 bajty (256 bitów) dla AES-256
 */
function getEncryptionKey() {
  const key = process.env.ENCRYPTION_KEY;
  
  if (!key) {
    throw new Error('ENCRYPTION_KEY nie jest ustawiony w zmiennych środowiskowych!');
  }
  
  // Jeśli klucz jest krótszy niż 32 znaki, generujemy klucz z hasła
  if (key.length < 32) {
    return crypto.scryptSync(key, 'angoralinks-salt', 32);
  }
  
  // Jeśli klucz ma dokładnie 32 znaki, używamy go bezpośrednio
  if (key.length === 32) {
    return Buffer.from(key, 'utf8');
  }
  
  // Jeśli klucz jest w formacie hex (64 znaki = 32 bajty)
  if (key.length === 64 && /^[0-9a-fA-F]+$/.test(key)) {
    return Buffer.from(key, 'hex');
  }
  
  // W przeciwnym razie hashujemy klucz do 32 bajtów
  return crypto.createHash('sha256').update(key).digest();
}

/**
 * Szyfruje tekst (np. adres IP)
 * @param {string} text - Tekst do zaszyfrowania
 * @returns {string} - Zaszyfrowany tekst w formacie: iv:authTag:encryptedData (wszystko w hex)
 */
function encrypt(text) {
  if (!text) return null;
  
  try {
    const key = getEncryptionKey();
    const iv = crypto.randomBytes(IV_LENGTH);
    
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    const authTag = cipher.getAuthTag();
    
    // Format: iv:authTag:encryptedData
    return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
  } catch (error) {
    console.error('Błąd szyfrowania:', error.message);
    throw new Error('Nie udało się zaszyfrować danych');
  }
}

/**
 * Odszyfrowuje tekst
 * @param {string} encryptedText - Zaszyfrowany tekst w formacie: iv:authTag:encryptedData
 * @returns {string} - Odszyfrowany tekst
 */
function decrypt(encryptedText) {
  if (!encryptedText) return null;
  
  try {
    const key = getEncryptionKey();
    
    const parts = encryptedText.split(':');
    if (parts.length !== 3) {
      throw new Error('Nieprawidłowy format zaszyfrowanych danych');
    }
    
    const iv = Buffer.from(parts[0], 'hex');
    const authTag = Buffer.from(parts[1], 'hex');
    const encrypted = parts[2];
    
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
  } catch (error) {
    console.error('Błąd odszyfrowania:', error.message);
    throw new Error('Nie udało się odszyfrować danych');
  }
}

/**
 * Generuje bezpieczny klucz szyfrowania (do użycia jednorazowo przy setup)
 * @returns {string} - Klucz w formacie hex (64 znaki)
 */
function generateEncryptionKey() {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Sprawdza czy klucz szyfrowania jest prawidłowy
 * @returns {boolean}
 */
function validateEncryptionKey() {
  try {
    const testData = 'test-encryption-123';
    const encrypted = encrypt(testData);
    const decrypted = decrypt(encrypted);
    return testData === decrypted;
  } catch (error) {
    return false;
  }
}

module.exports = {
  encrypt,
  decrypt,
  generateEncryptionKey,
  validateEncryptionKey
};