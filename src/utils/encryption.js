const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;

function getEncryptionKey() {
    const key = process.env.ENCRYPTION_KEY;
    
    if (!key) {
        console.warn('⚠️ ENCRYPTION_KEY nie jest ustawiony!');
        return crypto.scryptSync('default-dev-key', 'salt', 32);
    }
    
    if (key.length === 64 && /^[0-9a-fA-F]+$/.test(key)) {
        return Buffer.from(key, 'hex');
    }
    
    if (key.length === 32) {
        return Buffer.from(key, 'utf8');
    }
    
    return crypto.createHash('sha256').update(key).digest();
}

function encrypt(text) {
    if (!text) return null;
    
    try {
        const key = getEncryptionKey();
        const iv = crypto.randomBytes(IV_LENGTH);
        const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
        
        let encrypted = cipher.update(text, 'utf8', 'hex');
        encrypted += cipher.final('hex');
        
        const authTag = cipher.getAuthTag();
        return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
    } catch (error) {
        console.error('Błąd szyfrowania:', error.message);
        return null;
    }
}

function decrypt(encryptedText) {
    if (!encryptedText) return null;
    
    try {
        const key = getEncryptionKey();
        const parts = encryptedText.split(':');
        
        if (parts.length !== 3) return null;
        
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
        return null;
    }
}

function validateEncryptionKey() {
    try {
        const testData = 'test-123';
        const encrypted = encrypt(testData);
        const decrypted = decrypt(encrypted);
        return testData === decrypted;
    } catch (error) {
        return false;
    }
}

module.exports = { encrypt, decrypt, validateEncryptionKey };