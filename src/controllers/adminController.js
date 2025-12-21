const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

// Prowizja platformy
const PLATFORM_FEE = 0.15;

class AdminController {
    // GET /api/admin/stats - statystyki platformy
    async platformStats(req, res) {
        try {
            // Liczba użytkowników
            const totalUsers = await prisma.user.count();
            
            // Liczba linków
            const totalLinks = await prisma.link.count();
            
            // Wszystkie wizyty
            const totalVisits = await prisma.visit.count();
            
            // Suma zarobków użytkowników
            const usersEarnings = await prisma.user.aggregate({
                _sum: { totalEarned: true }
            });
            
            // Oblicz zarobek platformy (15% z całości)
            const totalUserEarnings = parseFloat(usersEarnings._sum.totalEarned || 0);
            const platformEarnings = (totalUserEarnings / (1 - PLATFORM_FEE)) * PLATFORM_FEE;
            
            // Dzisiejsze statystyki
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            
            const todayVisits = await prisma.visit.count({
                where: { createdAt: { gte: today } }
            });
            
            const todayEarnings = await prisma.visit.aggregate({
                where: { createdAt: { gte: today } },
                _sum: { earned: true }
            });
            
            // Nowi użytkownicy dzisiaj
            const newUsersToday = await prisma.user.count({
                where: { createdAt: { gte: today } }
            });
            
            // Statystyki z ostatnich 7 dni
            const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
            
            const recentVisits = await prisma.visit.findMany({
                where: { createdAt: { gte: sevenDaysAgo } },
                select: { createdAt: true, earned: true }
            });
            
            // Grupuj po dniach
            const dailyStats = {};
            for (let i = 6; i >= 0; i--) {
                const date = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
                const dateKey = date.toISOString().split('T')[0];
                dailyStats[dateKey] = { visits: 0, earned: 0 };
            }
            
            recentVisits.forEach(visit => {
                const dateKey = visit.createdAt.toISOString().split('T')[0];
                if (dailyStats[dateKey]) {
                    dailyStats[dateKey].visits += 1;
                    dailyStats[dateKey].earned += parseFloat(visit.earned);
                }
            });

            res.json({
                users: {
                    total: totalUsers,
                    newToday: newUsersToday
                },
                links: {
                    total: totalLinks
                },
                visits: {
                    total: totalVisits,
                    today: todayVisits
                },
                earnings: {
                    usersTotal: totalUserEarnings,
                    platformTotal: platformEarnings,
                    today: parseFloat(todayEarnings._sum.earned || 0)
                },
                dailyStats: Object.entries(dailyStats).map(([date, stats]) => ({
                    date,
                    visits: stats.visits,
                    earned: parseFloat(stats.earned.toFixed(4))
                }))
            });

        } catch (error) {
            console.error('Błąd statystyk admina:', error);
            res.status(500).json({ error: 'Błąd serwera' });
        }
    }

    // GET /api/admin/users - lista użytkowników
    async listUsers(req, res) {
        try {
            const users = await prisma.user.findMany({
                orderBy: { createdAt: 'desc' },
                select: {
                    id: true,
                    email: true,
                    balance: true,
                    totalEarned: true,
                    isVerified: true,
                    isActive: true,
                    isAdmin: true,
                    createdAt: true,
                    _count: {
                        select: { links: true }
                    }
                }
            });

            res.json({
                users: users.map(user => ({
                    id: user.id,
                    email: user.email,
                    balance: parseFloat(user.balance),
                    totalEarned: parseFloat(user.totalEarned),
                    isVerified: user.isVerified,
                    isActive: user.isActive,
                    isAdmin: user.isAdmin,
                    linksCount: user._count.links,
                    createdAt: user.createdAt
                })),
                total: users.length
            });

        } catch (error) {
            console.error('Błąd pobierania użytkowników:', error);
            res.status(500).json({ error: 'Błąd serwera' });
        }
    }

    // PUT /api/admin/users/:id - edycja użytkownika
    async updateUser(req, res) {
        try {
            const { id } = req.params;
            const { isActive, isAdmin, balance } = req.body;

            const user = await prisma.user.findUnique({ where: { id } });
            
            if (!user) {
                return res.status(404).json({ error: 'Użytkownik nie znaleziony' });
            }

            const updatedUser = await prisma.user.update({
                where: { id },
                data: {
                    isActive: isActive !== undefined ? isActive : user.isActive,
                    isAdmin: isAdmin !== undefined ? isAdmin : user.isAdmin,
                    balance: balance !== undefined ? balance : user.balance
                }
            });

            res.json({
                message: 'Użytkownik zaktualizowany',
                user: {
                    id: updatedUser.id,
                    email: updatedUser.email,
                    isActive: updatedUser.isActive,
                    isAdmin: updatedUser.isAdmin,
                    balance: parseFloat(updatedUser.balance)
                }
            });

        } catch (error) {
            console.error('Błąd aktualizacji użytkownika:', error);
            res.status(500).json({ error: 'Błąd serwera' });
        }
    }

    // DELETE /api/admin/users/:id - usuwanie użytkownika
    async deleteUser(req, res) {
        try {
            const { id } = req.params;

            const user = await prisma.user.findUnique({ where: { id } });
            
            if (!user) {
                return res.status(404).json({ error: 'Użytkownik nie znaleziony' });
            }

            if (user.isAdmin) {
                return res.status(403).json({ error: 'Nie można usunąć admina' });
            }

            await prisma.user.delete({ where: { id } });

            res.json({ message: 'Użytkownik usunięty' });

        } catch (error) {
            console.error('Błąd usuwania użytkownika:', error);
            res.status(500).json({ error: 'Błąd serwera' });
        }
    }

    // GET /api/admin/links - lista wszystkich linków
    async listLinks(req, res) {
        try {
            const links = await prisma.link.findMany({
                orderBy: { createdAt: 'desc' },
                include: {
                    user: {
                        select: { email: true }
                    }
                }
            });

            res.json({
                links: links.map(link => ({
                    id: link.id,
                    shortCode: link.shortCode,
                    originalUrl: link.originalUrl,
                    title: link.title,
                    userEmail: link.user.email,
                    totalClicks: link.totalClicks,
                    totalEarned: parseFloat(link.totalEarned),
                    isActive: link.isActive,
                    createdAt: link.createdAt
                })),
                total: links.length
            });

        } catch (error) {
            console.error('Błąd pobierania linków:', error);
            res.status(500).json({ error: 'Błąd serwera' });
        }
    }

    // DELETE /api/admin/links/:id - usuwanie linka
    async deleteLink(req, res) {
        try {
            const { id } = req.params;

            const link = await prisma.link.findUnique({ where: { id } });
            
            if (!link) {
                return res.status(404).json({ error: 'Link nie znaleziony' });
            }

            await prisma.link.delete({ where: { id } });

            res.json({ message: 'Link usunięty' });

        } catch (error) {
            console.error('Błąd usuwania linka:', error);
            res.status(500).json({ error: 'Błąd serwera' });
        }
    }

    // ============================================
    // === ZARZĄDZANIE WYPŁATAMI (PAYOUTS) ===
    // ============================================

    // GET /api/admin/payouts - lista wszystkich wypłat
    async listPayouts(req, res) {
        try {
            const payouts = await prisma.payout.findMany({
                orderBy: { createdAt: 'desc' },
                include: {
                    user: {
                        select: { email: true }
                    }
                }
            });

            res.json({
                payouts: payouts.map(p => ({
                    id: p.id,
                    userEmail: p.user.email,
                    amount: parseFloat(p.amount),
                    method: p.method,
                    address: p.address,
                    status: p.status,
                    createdAt: p.createdAt,
                    processedAt: p.processedAt
                }))
            });

        } catch (error) {
            console.error('Błąd pobierania wypłat:', error);
            res.status(500).json({ error: 'Błąd serwera' });
        }
    }

    // PUT /api/admin/payouts/:id - zmień status wypłaty
    async updatePayout(req, res) {
        try {
            const { id } = req.params;
            const { status } = req.body;

            if (!['PENDING', 'PROCESSING', 'COMPLETED', 'REJECTED'].includes(status)) {
                return res.status(400).json({ error: 'Nieprawidłowy status' });
            }

            const payout = await prisma.payout.findUnique({
                where: { id }
            });

            if (!payout) {
                return res.status(404).json({ error: 'Wypłata nie znaleziona' });
            }

            // Jeśli odrzucona - zwróć saldo
            if (status === 'REJECTED' && payout.status !== 'REJECTED') {
                await prisma.$transaction([
                    prisma.payout.update({
                        where: { id },
                        data: { 
                            status,
                            processedAt: new Date()
                        }
                    }),
                    prisma.user.update({
                        where: { id: payout.userId },
                        data: {
                            balance: { increment: parseFloat(payout.amount) }
                        }
                    })
                ]);
            } else {
                await prisma.payout.update({
                    where: { id },
                    data: { 
                        status,
                        processedAt: status === 'COMPLETED' ? new Date() : null
                    }
                });
            }

            res.json({ message: 'Status wypłaty zaktualizowany' });

        } catch (error) {
            console.error('Błąd aktualizacji wypłaty:', error);
            res.status(500).json({ error: 'Błąd serwera' });
        }
    }
}

module.exports = { adminController: new AdminController() };