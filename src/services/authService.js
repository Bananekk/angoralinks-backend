const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

class AuthService {
    // Hashowanie hasła
    async hashPassword(password) {
        const salt = await bcrypt.genSalt(12);
        return bcrypt.hash(password, salt);
    }

    // Weryfikacja hasła
    async verifyPassword(password, hash) {
        return bcrypt.compare(password, hash);
    }

    // 🆕 Generowanie tokenu JWT z opcjonalnym expiresIn
    generateToken(userId, expiresIn = null) {
        return jwt.sign(
            { userId, id: userId }, // Dodaję też 'id' dla kompatybilności
            process.env.JWT_SECRET,
            { expiresIn: expiresIn || process.env.JWT_EXPIRES_IN || '7d' }
        );
    }

    // 🆕 Generowanie tymczasowego tokenu (np. dla 2FA)
    generateTemporaryToken(userId, purpose, expiresIn = '5m') {
        return jwt.sign(
            { userId, id: userId, purpose },
            process.env.JWT_SECRET,
            { expiresIn }
        );
    }

    // 🆕 Weryfikacja tokenu JWT - teraz rzuca wyjątek zamiast zwracać null
    verifyToken(token) {
        return jwt.verify(token, process.env.JWT_SECRET);
    }

    // 🆕 Bezpieczna weryfikacja (nie rzuca wyjątku)
    verifyTokenSafe(token) {
        try {
            return jwt.verify(token, process.env.JWT_SECRET);
        } catch (error) {
            return null;
        }
    }

    // Walidacja emaila
    isValidEmail(email) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return emailRegex.test(email);
    }

    // Walidacja hasła (min 8 znaków, 1 cyfra, 1 duża litera)
    isValidPassword(password) {
        if (password.length < 8) return false;
        if (!/\d/.test(password)) return false;
        if (!/[A-Z]/.test(password)) return false;
        return true;
    }

    // Znajdź użytkownika po ID
    async findById(id) {
        return prisma.user.findUnique({
            where: { id }
        });
    }

    // Znajdź użytkownika po email
    async findByEmail(email) {
        return prisma.user.findUnique({
            where: { email: email.toLowerCase() }
        });
    }

    // Utwórz użytkownika
    async createUser(email, passwordHash) {
        return prisma.user.create({
            data: {
                email: email.toLowerCase(),
                password_hash: passwordHash
            }
        });
    }
}

module.exports = new AuthService();