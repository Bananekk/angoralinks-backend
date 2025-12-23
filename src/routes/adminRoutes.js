const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { auth, isAdmin } = require('../middleware/auth');

// Bezpieczny import - jeśli nie istnieje, użyj fallback
let decrypt, validateEncryptionKey;
try {
    const encryption = require('../utils/encryption');
    decrypt = encryption.decrypt;
    validateEncryptionKey = encryption.validateEncryptionKey;
} catch (e) {
    decrypt = (text) => text;
    validateEncryptionKey = () => false;
}

let maskIp;
try {
    maskIp = require('../utils/ipHelper').maskIp;
} catch (e) {
    maskIp = (ip) => ip ? ip.replace(/\.\d+$/, '.***') : 'unknown';
}

const router = express.Router();
const prisma = new PrismaClient();

// Middleware - tylko admin
router.use(auth, isAdmin);

// ======================
// DASHBOARD & STATYSTYKI
// ======================

// Dashboard - główne statystyki
router.get('/dashboard', async (req, res) => {
    try {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const [
            totalUsers,
            totalLinks,
            totalVisits,
            todayVisits,
            pendingPayouts,
            totalEarningsResult,
            activeUsers,
            todayUsers
        ] = await Promise.all([
            prisma.user.count(),
            prisma.link.count(),
            prisma.visit.count(),
            prisma.visit.count({
                where: { createdAt: { gte: today } }
            }),
            prisma.payout.count({
                where: { status: 'PENDING' }
            }),
            prisma.user.aggregate({
                _sum: { totalEarned: true }
            }),
            prisma.user.count({
                where: { isActive: true }
            }),
            prisma.user.count({
                where: { createdAt: { gte: today } }
            })
        ]);

        // Statystyki z ostatnich 7 dni
        const last7Days = [];
        for (let i = 6; i >= 0; i--) {
            const date = new Date();
            date.setDate(date.getDate() - i);
            date.setHours(0, 0, 0, 0);
            
            const nextDate = new Date(date);
            nextDate.setDate(nextDate.getDate() + 1);
            
            const [visits, users, earnings] = await Promise.all([
                prisma.visit.count({
                    where: {
                        createdAt: { gte: date, lt: nextDate }
                    }
                }),
                prisma.user.count({
                    where: {
                        createdAt: { gte: date, lt: nextDate }
                    }
                }),
                prisma.visit.aggregate({
                    where: {
                        createdAt: { gte: date, lt: nextDate }
                    },
                    _sum: { earned: true }
                })
            ]);
            
            last7Days.push({
                date: date.toISOString().split('T')[0],
                visits,
                users,
                earnings: earnings._sum.earned || 0
            });
        }

        res.json({
            success: true,
            stats: {
                totalUsers,
                activeUsers,
                todayUsers,
                totalLinks,
                totalVisits,
                todayVisits,
                pendingPayouts,
                totalEarnings: totalEarningsResult._sum.totalEarned || 0
            },
            last7Days
        });
    } catch (error) {
        console.error('Błąd pobierania dashboard stats:', error);
        res.status(500).json({ success: false, message: 'Błąd serwera' });
    }
});

// Statystyki bezpieczeństwa
router.get('/stats', async (req, res) => {
    try {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        
        const [
            totalIpLogs,
            todayIpLogs,
            loginCount,
            registerCount,
            visitsWithIp
        ] = await Promise.all([
            prisma.ipLog.count(),
            prisma.ipLog.count({
                where: { createdAt: { gte: today } }
            }),
            prisma.ipLog.count({
                where: { action: 'LOGIN' }
            }),
            prisma.ipLog.count({
                where: { action: 'REGISTER' }
            }),
            prisma.visit.count({
                where: { encryptedIp: { not: null } }
            })
        ]);
        
        // Ostatnie 7 dni logowań
        const last7Days = [];
        for (let i = 6; i >= 0; i--) {
            const date = new Date();
            date.setDate(date.getDate() - i);
            date.setHours(0, 0, 0, 0);
            
            const nextDate = new Date(date);
            nextDate.setDate(nextDate.getDate() + 1);
            
            const count = await prisma.ipLog.count({
                where: {
                    createdAt: { gte: date, lt: nextDate }
                }
            });
            
            last7Days.push({
                date: date.toISOString().split('T')[0],
                count
            });
        }
        
        res.json({
            success: true,
            stats: {
                totalIpLogs,
                todayIpLogs,
                loginCount,
                registerCount,
                visitsWithIp,
                last7Days
            }
        });
        
    } catch (error) {
        console.error('Błąd pobierania statystyk bezpieczeństwa:', error);
        res.status(500).json({ success: false, message: 'Błąd serwera' });
    }
});

// ======================
// UŻYTKOWNICY
// ======================

// Lista użytkowników
router.get('/users', async (req, res) => {
    try {
        const { page = 1, limit = 20, search = '', status = 'all' } = req.query;
        const skip = (parseInt(page) - 1) * parseInt(limit);

        let where = {};
        
        // Filtr wyszukiwania
        if (search) {
            where.OR = [
                { email: { contains: search, mode: 'insensitive' } },
                { username: { contains: search, mode: 'insensitive' } }
            ];
        }
        
        // Filtr statusu
        if (status === 'active') {
            where.isActive = true;
        } else if (status === 'blocked') {
            where.isActive = false;
        } else if (status === 'admin') {
            where.isAdmin = true;
        }

        const [users, total] = await Promise.all([
            prisma.user.findMany({
                where,
                select: {
                    id: true,
                    email: true,
                    username: true,
                    isActive: true,
                    isAdmin: true,
                    balance: true,
                    totalEarned: true,
                    createdAt: true,
                    lastLoginAt: true,
                    emailVerified: true,
                    _count: {
                        select: { 
                            links: true,
                            payouts: true
                        }
                    }
                },
                orderBy: { createdAt: 'desc' },
                skip,
                take: parseInt(limit)
            }),
            prisma.user.count({ where })
        ]);

        res.json({
            success: true,
            users: users.map(user => ({
                ...user,
                linksCount: user._count.links,
                payoutsCount: user._count.payouts
            })),
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total,
                totalPages: Math.ceil(total / parseInt(limit))
            }
        });
    } catch (error) {
        console.error('Błąd pobierania użytkowników:', error);
        res.status(500).json({ success: false, message: 'Błąd serwera' });
    }
});

// Szczegóły użytkownika
router.get('/users/:id', async (req, res) => {
    try {
        const { id } = req.params;

        const user = await prisma.user.findUnique({
            where: { id },
            select: {
                id: true,
                email: true,
                username: true,
                isActive: true,
                isAdmin: true,
                balance: true,
                totalEarned: true,
                totalWithdrawn: true,
                createdAt: true,
                lastLoginAt: true,
                emailVerified: true,
                registrationIp: true,
                lastLoginIp: true,
                _count: {
                    select: { 
                        links: true,
                        payouts: true,
                        visits: true
                    }
                },
                links: {
                    take: 10,
                    orderBy: { createdAt: 'desc' },
                    select: {
                        id: true,
                        shortCode: true,
                        title: true,
                        clicks: true,
                        earned: true,
                        createdAt: true
                    }
                },
                payouts: {
                    take: 5,
                    orderBy: { createdAt: 'desc' }
                }
            }
        });

        if (!user) {
            return res.status(404).json({ 
                success: false, 
                message: 'Użytkownik nie znaleziony' 
            });
        }

        // Odszyfruj IP jeśli potrzeba
        let registrationIp = null;
        let lastLoginIp = null;
        
        try {
            if (user.registrationIp) {
                registrationIp = decrypt(user.registrationIp);
            }
            if (user.lastLoginIp) {
                lastLoginIp = decrypt(user.lastLoginIp);
            }
        } catch (e) {
            // Jeśli nie można odszyfrować, pokaż zamaskowane
            registrationIp = user.registrationIp ? maskIp(user.registrationIp) : null;
            lastLoginIp = user.lastLoginIp ? maskIp(user.lastLoginIp) : null;
        }

        res.json({
            success: true,
            user: {
                ...user,
                registrationIp,
                lastLoginIp,
                linksCount: user._count.links,
                payoutsCount: user._count.payouts,
                visitsCount: user._count.visits
            }
        });
    } catch (error) {
        console.error('Błąd pobierania użytkownika:', error);
        res.status(500).json({ success: false, message: 'Błąd serwera' });
    }
});

// Zablokuj/odblokuj użytkownika
router.patch('/users/:id/toggle-active', async (req, res) => {
    try {
        const { id } = req.params;

        const user = await prisma.user.findUnique({
            where: { id }
        });

        if (!user) {
            return res.status(404).json({ 
                success: false, 
                message: 'Użytkownik nie znaleziony' 
            });
        }

        // Nie pozwól zablokować samego siebie
        if (id === req.userId) {
            return res.status(400).json({ 
                success: false, 
                message: 'Nie możesz zablokować samego siebie' 
            });
        }

        const updatedUser = await prisma.user.update({
            where: { id },
            data: { isActive: !user.isActive },
            select: {
                id: true,
                email: true,
                isActive: true
            }
        });

        res.json({
            success: true,
            message: updatedUser.isActive ? 'Użytkownik odblokowany' : 'Użytkownik zablokowany',
            user: updatedUser
        });
    } catch (error) {
        console.error('Błąd zmiany statusu użytkownika:', error);
        res.status(500).json({ success: false, message: 'Błąd serwera' });
    }
});

// Nadaj/odbierz uprawnienia admina
router.patch('/users/:id/toggle-admin', async (req, res) => {
    try {
        const { id } = req.params;

        const user = await prisma.user.findUnique({
            where: { id }
        });

        if (!user) {
            return res.status(404).json({ 
                success: false, 
                message: 'Użytkownik nie znaleziony' 
            });
        }

        // Nie pozwól odebrać sobie uprawnień
        if (id === req.userId) {
            return res.status(400).json({ 
                success: false, 
                message: 'Nie możesz odebrać sobie uprawnień admina' 
            });
        }

        const updatedUser = await prisma.user.update({
            where: { id },
            data: { isAdmin: !user.isAdmin },
            select: {
                id: true,
                email: true,
                isAdmin: true
            }
        });

        res.json({
            success: true,
            message: updatedUser.isAdmin ? 'Nadano uprawnienia admina' : 'Odebrano uprawnienia admina',
            user: updatedUser
        });
    } catch (error) {
        console.error('Błąd zmiany uprawnień admina:', error);
        res.status(500).json({ success: false, message: 'Błąd serwera' });
    }
});

// Usuń użytkownika
router.delete('/users/:id', async (req, res) => {
    try {
        const { id } = req.params;

        // Nie pozwól usunąć samego siebie
        if (id === req.userId) {
            return res.status(400).json({ 
                success: false, 
                message: 'Nie możesz usunąć samego siebie' 
            });
        }

        const user = await prisma.user.findUnique({
            where: { id }
        });

        if (!user) {
            return res.status(404).json({ 
                success: false, 
                message: 'Użytkownik nie znaleziony' 
            });
        }

        // Usuń powiązane dane (kaskadowo)
        await prisma.$transaction([
            prisma.visit.deleteMany({ where: { link: { userId: id } } }),
            prisma.link.deleteMany({ where: { userId: id } }),
            prisma.payout.deleteMany({ where: { userId: id } }),
            prisma.ipLog.deleteMany({ where: { userId: id } }),
            prisma.user.delete({ where: { id } })
        ]);

        res.json({
            success: true,
            message: 'Użytkownik i wszystkie jego dane zostały usunięte'
        });
    } catch (error) {
        console.error('Błąd usuwania użytkownika:', error);
        res.status(500).json({ success: false, message: 'Błąd serwera' });
    }
});

// ======================
// LINKI
// ======================

// Lista wszystkich linków
router.get('/links', async (req, res) => {
    try {
        const { page = 1, limit = 20, search = '', userId = '' } = req.query;
        const skip = (parseInt(page) - 1) * parseInt(limit);

        let where = {};
        
        if (search) {
            where.OR = [
                { shortCode: { contains: search, mode: 'insensitive' } },
                { title: { contains: search, mode: 'insensitive' } },
                { originalUrl: { contains: search, mode: 'insensitive' } }
            ];
        }

        if (userId) {
            where.userId = userId;
        }

        const [links, total] = await Promise.all([
            prisma.link.findMany({
                where,
                include: {
                    user: {
                        select: { 
                            id: true,
                            email: true, 
                            username: true 
                        }
                    },
                    _count: {
                        select: { visits: true }
                    }
                },
                orderBy: { createdAt: 'desc' },
                skip,
                take: parseInt(limit)
            }),
            prisma.link.count({ where })
        ]);

        res.json({
            success: true,
            links: links.map(link => ({
                id: link.id,
                shortCode: link.shortCode,
                originalUrl: link.originalUrl,
                title: link.title,
                clicks: link.clicks,
                earned: link.earned,
                isActive: link.isActive,
                createdAt: link.createdAt,
                user: link.user,
                visitsCount: link._count.visits
            })),
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total,
                totalPages: Math.ceil(total / parseInt(limit))
            }
        });
    } catch (error) {
        console.error('Błąd pobierania linków:', error);
        res.status(500).json({ success: false, message: 'Błąd serwera' });
    }
});

// Szczegóły linku
router.get('/links/:id', async (req, res) => {
    try {
        const { id } = req.params;

        const link = await prisma.link.findUnique({
            where: { id },
            include: {
                user: {
                    select: { 
                        id: true,
                        email: true, 
                        username: true 
                    }
                },
                visits: {
                    take: 20,
                    orderBy: { createdAt: 'desc' },
                    select: {
                        id: true,
                        country: true,
                        device: true,
                        earned: true,
                        createdAt: true
                    }
                },
                _count: {
                    select: { visits: true }
                }
            }
        });

        if (!link) {
            return res.status(404).json({ 
                success: false, 
                message: 'Link nie znaleziony' 
            });
        }

        res.json({
            success: true,
            link: {
                ...link,
                visitsCount: link._count.visits
            }
        });
    } catch (error) {
        console.error('Błąd pobierania linku:', error);
        res.status(500).json({ success: false, message: 'Błąd serwera' });
    }
});

// Aktywuj/dezaktywuj link
router.patch('/links/:id/toggle-active', async (req, res) => {
    try {
        const { id } = req.params;

        const link = await prisma.link.findUnique({
            where: { id }
        });

        if (!link) {
            return res.status(404).json({ 
                success: false, 
                message: 'Link nie znaleziony' 
            });
        }

        const updatedLink = await prisma.link.update({
            where: { id },
            data: { isActive: !link.isActive }
        });

        res.json({
            success: true,
            message: updatedLink.isActive ? 'Link aktywowany' : 'Link dezaktywowany',
            link: updatedLink
        });
    } catch (error) {
        console.error('Błąd zmiany statusu linku:', error);
        res.status(500).json({ success: false, message: 'Błąd serwera' });
    }
});

// Usuń link
router.delete('/links/:id', async (req, res) => {
    try {
        const { id } = req.params;

        const link = await prisma.link.findUnique({
            where: { id }
        });

        if (!link) {
            return res.status(404).json({ 
                success: false, 
                message: 'Link nie znaleziony' 
            });
        }

        // Usuń wizyty i link
        await prisma.$transaction([
            prisma.visit.deleteMany({ where: { linkId: id } }),
            prisma.link.delete({ where: { id } })
        ]);

        res.json({
            success: true,
            message: 'Link i wszystkie wizyty zostały usunięte'
        });
    } catch (error) {
        console.error('Błąd usuwania linku:', error);
        res.status(500).json({ success: false, message: 'Błąd serwera' });
    }
});

// ======================
// WYPŁATY
// ======================

// Lista wypłat
router.get('/payouts', async (req, res) => {
    try {
        const { page = 1, limit = 20, status = 'all' } = req.query;
        const skip = (parseInt(page) - 1) * parseInt(limit);

        const where = status !== 'all' ? { status: status.toUpperCase() } : {};

        const [payouts, total, stats] = await Promise.all([
            prisma.payout.findMany({
                where,
                include: {
                    user: {
                        select: { 
                            id: true,
                            email: true, 
                            username: true 
                        }
                    }
                },
                orderBy: { createdAt: 'desc' },
                skip,
                take: parseInt(limit)
            }),
            prisma.payout.count({ where }),
            prisma.payout.groupBy({
                by: ['status'],
                _count: true,
                _sum: { amount: true }
            })
        ]);

        // Przetworz statystyki
        const statusStats = {};
        stats.forEach(s => {
            statusStats[s.status] = {
                count: s._count,
                totalAmount: s._sum.amount || 0
            };
        });

        res.json({
            success: true,
            payouts,
            stats: statusStats,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total,
                totalPages: Math.ceil(total / parseInt(limit))
            }
        });
    } catch (error) {
        console.error('Błąd pobierania wypłat:', error);
        res.status(500).json({ success: false, message: 'Błąd serwera' });
    }
});

// Zmień status wypłaty
router.patch('/payouts/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { status, adminNote } = req.body;

        const validStatuses = ['PENDING', 'PROCESSING', 'COMPLETED', 'REJECTED'];
        if (!validStatuses.includes(status)) {
            return res.status(400).json({ 
                success: false, 
                message: `Nieprawidłowy status. Dozwolone: ${validStatuses.join(', ')}` 
            });
        }

        const payout = await prisma.payout.findUnique({
            where: { id },
            include: { user: true }
        });

        if (!payout) {
            return res.status(404).json({ 
                success: false, 
                message: 'Wypłata nie znaleziona' 
            });
        }

        // Jeśli odrzucona, zwróć pieniądze na saldo
        if (status === 'REJECTED' && payout.status !== 'REJECTED') {
            await prisma.user.update({
                where: { id: payout.userId },
                data: {
                    balance: { increment: payout.amount }
                }
            });
        }

        // Jeśli zmieniana z odrzuconej na inną, odejmij saldo
        if (payout.status === 'REJECTED' && status !== 'REJECTED') {
            await prisma.user.update({
                where: { id: payout.userId },
                data: {
                    balance: { decrement: payout.amount }
                }
            });
        }

        const updatedPayout = await prisma.payout.update({
            where: { id },
            data: { 
                status,
                adminNote: adminNote || payout.adminNote,
                processedAt: status === 'COMPLETED' ? new Date() : payout.processedAt
            },
            include: {
                user: {
                    select: { email: true, username: true }
                }
            }
        });

        res.json({
            success: true,
            message: `Status wypłaty zmieniony na ${status}`,
            payout: updatedPayout
        });
    } catch (error) {
        console.error('Błąd aktualizacji wypłaty:', error);
        res.status(500).json({ success: false, message: 'Błąd serwera' });
    }
});

// ======================
// WIADOMOŚCI KONTAKTOWE
// ======================

// Lista wiadomości
router.get('/messages', async (req, res) => {
    try {
        const { page = 1, limit = 20, status = 'all' } = req.query;
        const skip = (parseInt(page) - 1) * parseInt(limit);

        // Sprawdź czy model ContactMessage istnieje
        let messages = [];
        let total = 0;

        try {
            const where = status !== 'all' ? { status: status.toUpperCase() } : {};

            [messages, total] = await Promise.all([
                prisma.contactMessage.findMany({
                    where,
                    orderBy: { createdAt: 'desc' },
                    skip,
                    take: parseInt(limit)
                }),
                prisma.contactMessage.count({ where })
            ]);
        } catch (e) {
            // Model nie istnieje - zwróć pustą listę
            console.log('Model ContactMessage nie istnieje:', e.message);
        }

        res.json({
            success: true,
            messages,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total,
                totalPages: Math.ceil(total / parseInt(limit))
            }
        });
    } catch (error) {
        console.error('Błąd pobierania wiadomości:', error);
        res.status(500).json({ success: false, message: 'Błąd serwera' });
    }
});

// Oznacz wiadomość jako przeczytaną
router.patch('/messages/:id/read', async (req, res) => {
    try {
        const { id } = req.params;

        const message = await prisma.contactMessage.update({
            where: { id },
            data: { status: 'READ' }
        });

        res.json({
            success: true,
            message: 'Wiadomość oznaczona jako przeczytana',
            data: message
        });
    } catch (error) {
        console.error('Błąd oznaczania wiadomości:', error);
        res.status(500).json({ success: false, message: 'Błąd serwera' });
    }
});

// Usuń wiadomość
router.delete('/messages/:id', async (req, res) => {
    try {
        const { id } = req.params;

        await prisma.contactMessage.delete({
            where: { id }
        });

        res.json({
            success: true,
            message: 'Wiadomość usunięta'
        });
    } catch (error) {
        console.error('Błąd usuwania wiadomości:', error);
        res.status(500).json({ success: false, message: 'Błąd serwera' });
    }
});

// ======================
// SZYFROWANIE & BEZPIECZEŃSTWO
// ======================

// Sprawdź status szyfrowania
router.get('/encryption-status', async (req, res) => {
    try {
        const isValid = validateEncryptionKey();
        
        res.json({
            success: true,
            encryptionEnabled: isValid,
            algorithm: 'AES-256-GCM',
            message: isValid 
                ? 'Szyfrowanie działa poprawnie' 
                : 'Problem z kluczem szyfrowania!'
        });
    } catch (error) {
        res.status(500).json({ 
            success: false, 
            message: 'Błąd sprawdzania szyfrowania' 
        });
    }
});

// Odszyfruj IP użytkownika
router.post('/decrypt-user-ip', async (req, res) => {
    try {
        const { userId } = req.body;
        
        if (!userId) {
            return res.status(400).json({ 
                success: false, 
                message: 'ID użytkownika jest wymagane' 
            });
        }
        
        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: {
                id: true,
                email: true,
                registrationIp: true,
                lastLoginIp: true,
                lastLoginAt: true,
                createdAt: true
            }
        });
        
        if (!user) {
            return res.status(404).json({ 
                success: false, 
                message: 'Użytkownik nie znaleziony' 
            });
        }
        
        let registrationIp = null;
        let lastLoginIp = null;
        
        try {
            if (user.registrationIp) {
                registrationIp = decrypt(user.registrationIp);
            }
        } catch (e) {
            registrationIp = '[błąd odszyfrowania]';
        }
        
        try {
            if (user.lastLoginIp) {
                lastLoginIp = decrypt(user.lastLoginIp);
            }
        } catch (e) {
            lastLoginIp = '[błąd odszyfrowania]';
        }
        
        res.json({
            success: true,
            user: {
                id: user.id,
                email: user.email,
                registrationIp,
                lastLoginIp,
                lastLoginAt: user.lastLoginAt,
                createdAt: user.createdAt
            }
        });
        
    } catch (error) {
        console.error('Błąd odszyfrowania IP użytkownika:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Błąd serwera' 
        });
    }
});

// Pobierz historię IP użytkownika
router.get('/user-ip-history/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        const { page = 1, limit = 20 } = req.query;
        
        const skip = (parseInt(page) - 1) * parseInt(limit);
        
        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { id: true, email: true }
        });
        
        if (!user) {
            return res.status(404).json({ 
                success: false, 
                message: 'Użytkownik nie znaleziony' 
            });
        }
        
        const [logs, total] = await Promise.all([
            prisma.ipLog.findMany({
                where: { userId },
                orderBy: { createdAt: 'desc' },
                skip,
                take: parseInt(limit)
            }),
            prisma.ipLog.count({ where: { userId } })
        ]);
        
        const decryptedLogs = logs.map(log => {
            let ip = null;
            try {
                ip = decrypt(log.encryptedIp);
            } catch (e) {
                ip = '[błąd odszyfrowania]';
            }
            
            return {
                id: log.id,
                ip,
                action: log.action,
                userAgent: log.userAgent,
                createdAt: log.createdAt
            };
        });
        
        res.json({
            success: true,
            user: { id: user.id, email: user.email },
            logs: decryptedLogs,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total,
                totalPages: Math.ceil(total / parseInt(limit))
            }
        });
        
    } catch (error) {
        console.error('Błąd pobierania historii IP:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Błąd serwera' 
        });
    }
});

// Odszyfruj IP wizyty
router.post('/decrypt-visit-ip', async (req, res) => {
    try {
        const { visitId } = req.body;
        
        if (!visitId) {
            return res.status(400).json({ 
                success: false, 
                message: 'ID wizyty jest wymagane' 
            });
        }
        
        const visit = await prisma.visit.findUnique({
            where: { id: visitId },
            include: {
                link: {
                    select: {
                        shortCode: true,
                        title: true,
                        user: {
                            select: { email: true }
                        }
                    }
                }
            }
        });
        
        if (!visit) {
            return res.status(404).json({ 
                success: false, 
                message: 'Wizyta nie znaleziona' 
            });
        }
        
        let ip = null;
        try {
            if (visit.encryptedIp) {
                ip = decrypt(visit.encryptedIp);
            }
        } catch (e) {
            ip = '[błąd odszyfrowania]';
        }
        
        res.json({
            success: true,
            visit: {
                id: visit.id,
                ip,
                country: visit.country,
                device: visit.device,
                userAgent: visit.userAgent,
                referer: visit.referer,
                earned: visit.earned,
                createdAt: visit.createdAt,
                link: {
                    shortCode: visit.link.shortCode,
                    title: visit.link.title,
                    ownerEmail: visit.link.user.email
                }
            }
        });
        
    } catch (error) {
        console.error('Błąd odszyfrowania IP wizyty:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Błąd serwera' 
        });
    }
});

// Wyszukaj użytkowników po IP
router.post('/search-by-ip', async (req, res) => {
    try {
        const { ip } = req.body;
        
        if (!ip) {
            return res.status(400).json({ 
                success: false, 
                message: 'Adres IP jest wymagany' 
            });
        }
        
        const users = await prisma.user.findMany({
            select: {
                id: true,
                email: true,
                registrationIp: true,
                lastLoginIp: true,
                createdAt: true,
                isActive: true
            }
        });
        
        const matchingUsers = [];
        
        for (const user of users) {
            let regIp = null;
            let loginIp = null;
            
            try {
                if (user.registrationIp) {
                    regIp = decrypt(user.registrationIp);
                }
                if (user.lastLoginIp) {
                    loginIp = decrypt(user.lastLoginIp);
                }
            } catch (e) {
                continue;
            }
            
            if (regIp === ip || loginIp === ip) {
                matchingUsers.push({
                    id: user.id,
                    email: user.email,
                    registrationIp: regIp,
                    lastLoginIp: loginIp,
                    createdAt: user.createdAt,
                    isActive: user.isActive,
                    matchType: regIp === ip && loginIp === ip 
                        ? 'both' 
                        : regIp === ip 
                            ? 'registration' 
                            : 'login'
                });
            }
        }
        
        res.json({
            success: true,
            searchedIp: ip,
            results: matchingUsers,
            count: matchingUsers.length
        });
        
    } catch (error) {
        console.error('Błąd wyszukiwania po IP:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Błąd serwera' 
        });
    }
});

module.exports = router;