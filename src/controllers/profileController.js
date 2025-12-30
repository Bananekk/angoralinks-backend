const { PrismaClient } = require('@prisma/client');
const authService = require('../services/authService');
const emailUtils = require('../utils/email');

const prisma = new PrismaClient();

class ProfileController {
    // GET /api/profile - pobierz profil
    async getProfile(req, res) {
        try {
            const user = await prisma.user.findUnique({
                where: { id: req.user.id },
                select: {
                    id: true,
                    email: true,
                    balance: true,
                    totalEarned: true,
                    isVerified: true,
                    createdAt: true,
                    _count: {
                        select: { links: true }
                    }
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
                    linksCount: user._count.links,
                    createdAt: user.createdAt
                }
            });

        } catch (error) {
            console.error('Błąd pobierania profilu:', error);
            res.status(500).json({ error: 'Błąd serwera' });
        }
    }

    // PUT /api/profile - aktualizuj profil
    async updateProfile(req, res) {
        try {
            const { email } = req.body;

            if (email && !authService.isValidEmail(email)) {
                return res.status(400).json({ error: 'Nieprawidłowy format email' });
            }

            if (email) {
                const existingUser = await prisma.user.findUnique({
                    where: { email: email.toLowerCase() }
                });

                if (existingUser && existingUser.id !== req.user.id) {
                    return res.status(409).json({ error: 'Ten email jest już zajęty' });
                }
            }

            const updatedUser = await prisma.user.update({
                where: { id: req.user.id },
                data: {
                    email: email ? email.toLowerCase() : undefined
                }
            });

            res.json({
                message: 'Profil zaktualizowany',
                user: {
                    id: updatedUser.id,
                    email: updatedUser.email
                }
            });

        } catch (error) {
            console.error('Błąd aktualizacji profilu:', error);
            res.status(500).json({ error: 'Błąd serwera' });
        }
    }

    // PUT /api/profile/password - zmiana hasła
    async changePassword(req, res) {
        try {
            const { currentPassword, newPassword, confirmPassword } = req.body;

            if (!currentPassword || !newPassword || !confirmPassword) {
                return res.status(400).json({ error: 'Wszystkie pola są wymagane' });
            }

            if (newPassword !== confirmPassword) {
                return res.status(400).json({ error: 'Nowe hasła nie są identyczne' });
            }

            if (!authService.isValidPassword(newPassword)) {
                return res.status(400).json({ 
                    error: 'Nowe hasło musi mieć min. 8 znaków, 1 cyfrę i 1 wielką literę' 
                });
            }

            const user = await prisma.user.findUnique({
                where: { id: req.user.id }
            });

            if (!user) {
                return res.status(404).json({ error: 'Użytkownik nie znaleziony' });
            }

            // password_hash - bez @map w schema!
            const isValid = await authService.verifyPassword(currentPassword, user.password_hash);
            if (!isValid) {
                return res.status(401).json({ error: 'Aktualne hasło jest nieprawidłowe' });
            }

            const newPasswordHash = await authService.hashPassword(newPassword);

            await prisma.user.update({
                where: { id: req.user.id },
                data: { password_hash: newPasswordHash }
            });

            res.json({ message: 'Hasło zostało zmienione' });

        } catch (error) {
            console.error('Błąd zmiany hasła:', error);
            res.status(500).json({ error: 'Błąd serwera' });
        }
    }

    // DELETE /api/profile - usuń konto
    async deleteAccount(req, res) {
        try {
            const { password } = req.body;

            if (!password) {
                return res.status(400).json({ error: 'Hasło jest wymagane' });
            }

            const user = await prisma.user.findUnique({
                where: { id: req.user.id }
            });

            if (!user) {
                return res.status(404).json({ error: 'Użytkownik nie znaleziony' });
            }

            // password_hash - bez @map w schema!
            const isValid = await authService.verifyPassword(password, user.password_hash);
            if (!isValid) {
                return res.status(401).json({ error: 'Nieprawidłowe hasło' });
            }

            const userEmail = user.email;

            await prisma.user.delete({
                where: { id: req.user.id }
            });

            // Wyślij email o usunięciu konta
            console.log('🔔 Wysyłam email o usunięciu konta do:', userEmail);
            emailUtils.sendAccountDeletedEmail(userEmail)
                .then(() => console.log('✅ Account deleted email wysłany!'))
                .catch(err => console.error('❌ Account deleted email error:', err));

            res.json({ message: 'Konto zostało usunięte' });

        } catch (error) {
            console.error('Błąd usuwania konta:', error);
            res.status(500).json({ error: 'Błąd serwera' });
        }
    }
}

module.exports = { profileController: new ProfileController() };