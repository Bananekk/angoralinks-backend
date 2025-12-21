const { PrismaClient } = require('@prisma/client');
const authService = require('../services/authService');

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
                    balance: parseFloat(user.balance),
                    totalEarned: parseFloat(user.totalEarned),
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

            // Walidacja emaila
            if (email && !authService.isValidEmail(email)) {
                return res.status(400).json({ error: 'Nieprawidłowy format email' });
            }

            // Sprawdź czy email jest zajęty
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

            // Walidacja pól
            if (!currentPassword || !newPassword || !confirmPassword) {
                return res.status(400).json({ error: 'Wszystkie pola są wymagane' });
            }

            // Sprawdź zgodność nowych haseł
            if (newPassword !== confirmPassword) {
                return res.status(400).json({ error: 'Nowe hasła nie są identyczne' });
            }

            // Walidacja nowego hasła
            if (!authService.isValidPassword(newPassword)) {
                return res.status(400).json({ 
                    error: 'Nowe hasło musi mieć min. 8 znaków, 1 cyfrę i 1 wielką literę' 
                });
            }

            // Pobierz użytkownika z hasłem
            const user = await prisma.user.findUnique({
                where: { id: req.user.id }
            });

            // Sprawdź aktualne hasło
            const isValid = await authService.verifyPassword(currentPassword, user.passwordHash);
            if (!isValid) {
                return res.status(401).json({ error: 'Aktualne hasło jest nieprawidłowe' });
            }

            // Hashuj nowe hasło
            const newPasswordHash = await authService.hashPassword(newPassword);

            // Zaktualizuj hasło
            await prisma.user.update({
                where: { id: req.user.id },
                data: { passwordHash: newPasswordHash }
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

            // Pobierz użytkownika
            const user = await prisma.user.findUnique({
                where: { id: req.user.id }
            });

            // Sprawdź hasło
            const isValid = await authService.verifyPassword(password, user.passwordHash);
            if (!isValid) {
                return res.status(401).json({ error: 'Nieprawidłowe hasło' });
            }

            // Usuń użytkownika (kaskadowo usunie też linki i wizyty)
            await prisma.user.delete({
                where: { id: req.user.id }
            });

            res.json({ message: 'Konto zostało usunięte' });

        } catch (error) {
            console.error('Błąd usuwania konta:', error);
            res.status(500).json({ error: 'Błąd serwera' });
        }
    }
}

module.exports = { profileController: new ProfileController() };