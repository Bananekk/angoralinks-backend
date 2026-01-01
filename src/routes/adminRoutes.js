// routes/adminRoutes.js

const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { auth, isAdmin } = require('../middleware/auth');
const emailUtils = require('../utils/email');
const ReferralService = require('../services/referralService');

// =====================
// BEZPIECZNE IMPORTY
// =====================

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

// 🆕 Import serwisu 2FA
let twoFactorService;
try {
    twoFactorService = require('../services/twoFactorService');
} catch (e) {
    console.warn('twoFactorService nie znaleziony - funkcje 2FA będą niedostępne');
    twoFactorService = null;
}

// =====================
// SERWIS ADSTERRA
// =====================

class AdsterraService {
    constructor() {
        this.apiToken = process.env.ADSTERRA_API_TOKEN;
        this.baseUrl = 'https://api3.adsterratools.com/publisher';
        this.cache = {
            data: null,
            timestamp: null,
            ttl: 5 * 60 * 1000 // 5 minut cache
        };
    }

    async fetchWithAuth(endpoint) {
        if (!this.apiToken) {
            console.warn('Brak tokenu Adsterra API - ustaw ADSTERRA_API_TOKEN');
            return null;
        }

        try {
            const response = await fetch(`${this.baseUrl}${endpoint}`, {
                method: 'GET',
                headers: {
                    'Accept': 'application/json',
                    'X-API-Key': this.apiToken
                }
            });

            if (!response.ok) {
                const errorText = await response.text();
                console.error(`Adsterra API error: ${response.status} - ${errorText}`);
                return null;
            }

            return await response.json();
        } catch (error) {
            console.error('Błąd Adsterra API:', error.message);
            return null;
        }
    }

    formatDate(date) {
        return date.toISOString().split('T')[0];
    }

    async getStats(startDate, endDate) {
        const start = this.formatDate(startDate);
        const end = this.formatDate(endDate);
        
        return await this.fetchWithAuth(
            `/stats.json?start_date=${start}&finish_date=${end}&group_by=date`
        );
    }

    async getTodayEarnings() {
        const today = new Date();
        const stats = await this.getStats(today, today);
        
        if (!stats?.items?.length) return 0;
        
        return stats.items.reduce((sum, item) => sum + parseFloat(item.revenue || 0), 0);
    }

    async getLast7DaysEarnings() {
        const endDate = new Date();
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - 6);

        const stats = await this.getStats(startDate, endDate);
        
        if (!stats?.items) return { total: 0, daily: [] };

        const daily = stats.items.map(item => ({
            date: item.date,
            revenue: parseFloat(item.revenue || 0),
            impressions: parseInt(item.impressions || 0),
            clicks: parseInt(item.clicks || 0)
        }));

        const total = daily.reduce((sum, day) => sum + day.revenue, 0);

        return { total, daily };
    }

    async getMonthlyRevenue() {
        const endDate = new Date();
        const startDate = new Date();
        startDate.setDate(1); // Początek miesiąca

        const stats = await this.getStats(startDate, endDate);
        
        if (!stats?.items) return 0;

        return stats.items.reduce((sum, item) => sum + parseFloat(item.revenue || 0), 0);
    }

    async getAllStats() {
        // Sprawdź cache
        if (this.cache.data && this.cache.timestamp) {
            const age = Date.now() - this.cache.timestamp;
            if (age < this.cache.ttl) {
                return { ...this.cache.data, fromCache: true };
            }
        }

        try {
            const [todayEarnings, last7Days, monthlyRevenue] = await Promise.all([
                this.getTodayEarnings(),
                this.getLast7DaysEarnings(),
                this.getMonthlyRevenue()
            ]);

            const data = {
                today: todayEarnings,
                last7Days: last7Days.total,
                monthlyRevenue,
                dailyStats: last7Days.daily,
                lastUpdated: new Date().toISOString(),
                fromCache: false
            };

            // Zapisz do cache
            this.cache.data = data;
            this.cache.timestamp = Date.now();

            return data;
        } catch (error) {
            console.error('Błąd pobierania statystyk Adsterra:', error);
            
            if (this.cache.data) {
                return { ...this.cache.data, fromCache: true, error: true };
            }
            
            return null;
        }
    }

    clearCache() {
        this.cache.data = null;
        this.cache.timestamp = null;
    }
}

const adsterraService = new AdsterraService();

// =====================
// INICJALIZACJA
// =====================

const router = express.Router();
const prisma = new PrismaClient();

// Middleware - tylko admin
router.use(auth, isAdmin);

// ======================
// DASHBOARD & STATYSTYKI
// ======================

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
            todayUsers,
            adsterraStats,
            // 🆕 Statystyki 2FA
            usersWithTwoFactor
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
            }),
            adsterraService.getAllStats(),
            // 🆕 Liczba użytkowników z 2FA
            prisma.user.count({
                where: { twoFactorEnabled: true }
            })
        ]);

        const last7Days = [];
        for (let i = 6; i >= 0; i--) {
            const date = new Date();
            date.setDate(date.getDate() - i);
            date.setHours(0, 0, 0, 0);
            
            const nextDate = new Date(date);
            nextDate.setDate(nextDate.getDate() + 1);
            
            const dateStr = date.toISOString().split('T')[0];
            
            const [visits, users, earnings] = await Promise.all([
                prisma.visit.count({
                    where: { createdAt: { gte: date, lt: nextDate } }
                }),
                prisma.user.count({
                    where: { createdAt: { gte: date, lt: nextDate } }
                }),
                prisma.visit.aggregate({
                    where: { createdAt: { gte: date, lt: nextDate } },
                    _sum: { earned: true }
                })
            ]);
            
            // Znajdź zarobki Adsterra dla tego dnia
            const adsterraDay = adsterraStats?.dailyStats?.find(d => d.date === dateStr);
            
            last7Days.push({
                date: dateStr,
                visits,
                users,
                earnings: earnings._sum.earned || 0,
                adsterraRevenue: adsterraDay?.revenue || 0
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
                totalEarnings: totalEarningsResult._sum.totalEarned || 0,
                // 🆕 Dane 2FA
                usersWithTwoFactor,
                twoFactorAdoptionRate: totalUsers > 0 
                    ? ((usersWithTwoFactor / totalUsers) * 100).toFixed(1) 
                    : 0
            },
            adsterra: adsterraStats,
            last7Days
        });
    } catch (error) {
        console.error('Błąd pobierania dashboard stats:', error);
        res.status(500).json({ success: false, message: 'Błąd serwera' });
    }
});

// ENDPOINT /stats - z Adsterra
router.get('/stats', async (req, res) => {
    try {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const [
            totalUsers,
            todayUsers,
            totalLinks,
            totalVisits,
            todayVisits,
            totalEarningsResult,
            pendingPayoutsResult,
            adsterraStats
        ] = await Promise.all([
            prisma.user.count(),
            prisma.user.count({ where: { createdAt: { gte: today } } }),
            prisma.link.count(),
            prisma.visit.count(),
            prisma.visit.count({ where: { createdAt: { gte: today } } }),
            prisma.user.aggregate({ _sum: { totalEarned: true } }),
            prisma.payout.aggregate({
                where: { status: 'PENDING' },
                _sum: { amount: true },
                _count: true
            }),
            adsterraService.getAllStats()
        ]);

        // Dane z ostatnich 7 dni
        const dailyStats = [];
        for (let i = 6; i >= 0; i--) {
            const date = new Date();
            date.setDate(date.getDate() - i);
            date.setHours(0, 0, 0, 0);
            
            const nextDate = new Date(date);
            nextDate.setDate(nextDate.getDate() + 1);
            
            const dateStr = date.toISOString().split('T')[0];
            
            const visits = await prisma.visit.count({
                where: { createdAt: { gte: date, lt: nextDate } }
            });
            
            // Znajdź zarobki Adsterra dla tego dnia
            const adsterraDay = adsterraStats?.dailyStats?.find(d => d.date === dateStr);
            
            dailyStats.push({
                date: dateStr,
                visits,
                adsterraRevenue: adsterraDay?.revenue || 0
            });
        }

        // Struktura zgodna z frontendem
        res.json({
            users: {
                total: totalUsers,
                newToday: todayUsers
            },
            links: {
                total: totalLinks
            },
            visits: {
                total: totalVisits,
                today: todayVisits
            },
            earnings: {
                platformTotal: totalEarningsResult._sum.totalEarned || 0,
                pendingPayouts: pendingPayoutsResult._sum.amount || 0,
                pendingPayoutsCount: pendingPayoutsResult._count || 0
            },
            adsterra: adsterraStats ? {
                today: adsterraStats.today || 0,
                last7Days: adsterraStats.last7Days || 0,
                monthlyRevenue: adsterraStats.monthlyRevenue || 0,
                dailyStats: adsterraStats.dailyStats || [],
                lastUpdated: adsterraStats.lastUpdated,
                fromCache: adsterraStats.fromCache || false
            } : null,
            dailyStats
        });
        
    } catch (error) {
        console.error('Błąd pobierania statystyk:', error);
        res.status(500).json({ error: 'Błąd serwera' });
    }
});

// ======================
// ADSTERRA - DEDYKOWANE ENDPOINTY
// ======================

// Pobierz tylko statystyki Adsterra
router.get('/adsterra-stats', async (req, res) => {
    try {
        const stats = await adsterraService.getAllStats();
        
        if (!stats) {
            return res.status(503).json({ 
                success: false,
                error: 'Nie można pobrać danych z Adsterra',
                message: 'Sprawdź czy token API jest poprawny (ADSTERRA_API_TOKEN)'
            });
        }

        res.json({
            success: true,
            ...stats
        });
    } catch (error) {
        console.error('Błąd Adsterra:', error);
        res.status(500).json({ success: false, error: 'Błąd serwera' });
    }
});

// Odśwież cache Adsterra
router.post('/adsterra-stats/refresh', async (req, res) => {
    try {
        // Wyczyść cache
        adsterraService.clearCache();
        
        // Pobierz świeże dane
        const stats = await adsterraService.getAllStats();
        
        res.json({ 
            success: true, 
            message: 'Cache Adsterra odświeżony',
            data: stats 
        });
    } catch (error) {
        console.error('Błąd odświeżania Adsterra:', error);
        res.status(500).json({ success: false, error: 'Błąd odświeżania' });
    }
});

// Status konfiguracji Adsterra
router.get('/adsterra-status', async (req, res) => {
    try {
        const hasToken = !!process.env.ADSTERRA_API_TOKEN;
        const tokenPreview = hasToken 
            ? `${process.env.ADSTERRA_API_TOKEN.substring(0, 8)}...` 
            : null;
        
        let testResult = null;
        if (hasToken) {
            const stats = await adsterraService.getAllStats();
            testResult = stats ? 'connected' : 'error';
        }
        
        res.json({
            success: true,
            configured: hasToken,
            tokenPreview,
            status: testResult,
            cacheAge: adsterraService.cache.timestamp 
                ? Math.round((Date.now() - adsterraService.cache.timestamp) / 1000) + 's'
                : null
        });
    } catch (error) {
        res.status(500).json({ success: false, error: 'Błąd sprawdzania statusu' });
    }
});

// ======================
// UŻYTKOWNICY (z danymi 2FA)
// ======================

router.get('/users', async (req, res) => {
    try {
        const { 
            page = 1, 
            limit = 20, 
            search = '', 
            status = 'all',
            twoFactorFilter = 'all'  // 🆕 Filtr 2FA
        } = req.query;
        const skip = (parseInt(page) - 1) * parseInt(limit);

        let where = {};
        
        if (search) {
            where.email = { contains: search, mode: 'insensitive' };
        }
        
        if (status === 'active') {
            where.isActive = true;
        } else if (status === 'blocked') {
            where.isActive = false;
        } else if (status === 'admin') {
            where.isAdmin = true;
        }

        // 🆕 Filtr 2FA
        if (twoFactorFilter === 'enabled') {
            where.twoFactorEnabled = true;
        } else if (twoFactorFilter === 'disabled') {
            where.twoFactorEnabled = false;
        } else if (twoFactorFilter === 'required') {
            where.twoFactorRequired = true;
        }

        const [users, total] = await Promise.all([
            prisma.user.findMany({
                where,
                select: {
                    id: true,
                    email: true,
                    isActive: true,
                    isAdmin: true,
                    balance: true,
                    totalEarned: true,
                    isVerified: true,
                    createdAt: true,
                    lastLoginAt: true,
                    referralDisabled: true,
                    referralDisabledAt: true,
                    referralDisabledReason: true,
                    referralEarnings: true,
                    // 🆕 Pola 2FA
                    twoFactorEnabled: true,
                    twoFactorMethod: true,
                    twoFactorRequired: true,
                    twoFactorEnabledAt: true,
                    twoFactorLastUsedAt: true,
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

        // 🆕 Pobierz liczbę niewykorzystanych backup codes dla każdego użytkownika
        const usersWithTwoFactorInfo = await Promise.all(
            users.map(async (user) => {
                let backupCodesRemaining = 0;
                let webAuthnCount = 0;
                
                if (user.twoFactorEnabled) {
                    try {
                        backupCodesRemaining = await prisma.backupCode.count({
                            where: {
                                userId: user.id,
                                usedAt: null
                            }
                        });
                    } catch (e) {
                        // Tabela może nie istnieć
                    }
                    
                    try {
                        webAuthnCount = await prisma.webAuthnCredential.count({
                            where: { userId: user.id }
                        });
                    } catch (e) {
                        // Tabela może nie istnieć
                    }
                }

                return {
                    id: user.id,
                    email: user.email,
                    isActive: user.isActive,
                    isAdmin: user.isAdmin,
                    balance: parseFloat(user.balance || 0),
                    totalEarned: parseFloat(user.totalEarned || 0),
                    isVerified: user.isVerified,
                    createdAt: user.createdAt,
                    lastLoginAt: user.lastLoginAt,
                    referralDisabled: user.referralDisabled,
                    referralEarnings: parseFloat(user.referralEarnings || 0),
                    linksCount: user._count.links,
                    payoutsCount: user._count.payouts,
                    // 🆕 Dane 2FA
                    twoFactor: {
                        enabled: user.twoFactorEnabled,
                        methods: user.twoFactorMethod || [],
                        required: user.twoFactorRequired,
                        enabledAt: user.twoFactorEnabledAt,
                        lastUsedAt: user.twoFactorLastUsedAt,
                        webAuthnCount,
                        backupCodesRemaining
                    }
                };
            })
        );

        res.json({
            success: true,
            users: usersWithTwoFactorInfo,
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

router.get('/users/:id', async (req, res) => {
    try {
        const { id } = req.params;

        const user = await prisma.user.findUnique({
            where: { id },
            select: {
                id: true,
                email: true,
                isActive: true,
                isAdmin: true,
                balance: true,
                totalEarned: true,
                isVerified: true,
                createdAt: true,
                lastLoginAt: true,
                registrationIp: true,
                lastLoginIp: true,
                // 🆕 Pola 2FA
                twoFactorEnabled: true,
                twoFactorMethod: true,
                twoFactorRequired: true,
                twoFactorRequiredAt: true,
                twoFactorRequiredBy: true,
                twoFactorEnabledAt: true,
                twoFactorLastUsedAt: true,
                _count: {
                    select: { 
                        links: true,
                        payouts: true
                    }
                },
                links: {
                    take: 10,
                    orderBy: { createdAt: 'desc' },
                    select: {
                        id: true,
                        shortCode: true,
                        title: true,
                        totalClicks: true,
                        totalEarned: true,
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

        let registrationIp = null;
        let lastLoginIp = null;
        
        try {
            if (user.registrationIp) registrationIp = decrypt(user.registrationIp);
            if (user.lastLoginIp) lastLoginIp = decrypt(user.lastLoginIp);
        } catch (e) {
            registrationIp = user.registrationIp ? maskIp(user.registrationIp) : null;
            lastLoginIp = user.lastLoginIp ? maskIp(user.lastLoginIp) : null;
        }

        // 🆕 Pobierz backup codes info
        let backupCodesInfo = { total: 0, remaining: 0 };
        try {
            const [total, remaining] = await Promise.all([
                prisma.backupCode.count({ where: { userId: id } }),
                prisma.backupCode.count({ where: { userId: id, usedAt: null } })
            ]);
            backupCodesInfo = { total, remaining, used: total - remaining };
        } catch (e) {
            // Tabela może nie istnieć
        }

        // 🆕 Pobierz WebAuthn credentials
        let webAuthnCredentials = [];
        try {
            webAuthnCredentials = await prisma.webAuthnCredential.findMany({
                where: { userId: id },
                select: {
                    id: true,
                    deviceName: true,
                    credentialDeviceType: true,
                    lastUsedAt: true,
                    createdAt: true
                }
            });
        } catch (e) {
            // Tabela może nie istnieć
        }

        // 🆕 Pobierz admina który wymusił 2FA
        let requiredByAdmin = null;
        if (user.twoFactorRequiredBy) {
            const admin = await prisma.user.findUnique({
                where: { id: user.twoFactorRequiredBy },
                select: { email: true }
            });
            requiredByAdmin = admin?.email || null;
        }

        res.json({
            success: true,
            user: {
                ...user,
                registrationIp,
                lastLoginIp,
                linksCount: user._count.links,
                payoutsCount: user._count.payouts,
                // 🆕 Szczegóły 2FA
                twoFactor: {
                    enabled: user.twoFactorEnabled,
                    methods: user.twoFactorMethod || [],
                    required: user.twoFactorRequired,
                    requiredAt: user.twoFactorRequiredAt,
                    requiredBy: requiredByAdmin,
                    enabledAt: user.twoFactorEnabledAt,
                    lastUsedAt: user.twoFactorLastUsedAt,
                    webAuthnCredentials,
                    backupCodes: backupCodesInfo
                }
            }
        });
    } catch (error) {
        console.error('Błąd pobierania użytkownika:', error);
        res.status(500).json({ success: false, message: 'Błąd serwera' });
    }
});

router.put('/users/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { isActive, isAdmin: makeAdmin } = req.body;

        const user = await prisma.user.findUnique({ where: { id } });

        if (!user) {
            return res.status(404).json({ success: false, message: 'Użytkownik nie znaleziony' });
        }

        if (id === req.userId && (isActive === false || makeAdmin === false)) {
            return res.status(400).json({ success: false, message: 'Nie możesz zablokować/degradować samego siebie' });
        }

        const updateData = {};
        if (typeof isActive === 'boolean') updateData.isActive = isActive;
        if (typeof makeAdmin === 'boolean') updateData.isAdmin = makeAdmin;

        const updatedUser = await prisma.user.update({
            where: { id },
            data: updateData,
            select: { id: true, email: true, isActive: true, isAdmin: true }
        });

        res.json({
            success: true,
            message: 'Użytkownik zaktualizowany',
            user: updatedUser
        });
    } catch (error) {
        console.error('Błąd aktualizacji użytkownika:', error);
        res.status(500).json({ success: false, message: 'Błąd serwera' });
    }
});

router.patch('/users/:id/toggle-active', async (req, res) => {
    try {
        const { id } = req.params;

        const user = await prisma.user.findUnique({ where: { id } });

        if (!user) {
            return res.status(404).json({ success: false, message: 'Użytkownik nie znaleziony' });
        }

        if (id === req.userId) {
            return res.status(400).json({ success: false, message: 'Nie możesz zablokować samego siebie' });
        }

        const updatedUser = await prisma.user.update({
            where: { id },
            data: { isActive: !user.isActive },
            select: { id: true, email: true, isActive: true }
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

router.patch('/users/:id/toggle-admin', async (req, res) => {
    try {
        const { id } = req.params;

        const user = await prisma.user.findUnique({ where: { id } });

        if (!user) {
            return res.status(404).json({ success: false, message: 'Użytkownik nie znaleziony' });
        }

        if (id === req.userId) {
            return res.status(400).json({ success: false, message: 'Nie możesz odebrać sobie uprawnień admina' });
        }

        const updatedUser = await prisma.user.update({
            where: { id },
            data: { isAdmin: !user.isAdmin },
            select: { id: true, email: true, isAdmin: true }
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

router.delete('/users/:id', async (req, res) => {
    try {
        const { id } = req.params;

        if (id === req.userId) {
            return res.status(400).json({ success: false, message: 'Nie możesz usunąć samego siebie' });
        }

        const user = await prisma.user.findUnique({ where: { id } });

        if (!user) {
            return res.status(404).json({ success: false, message: 'Użytkownik nie znaleziony' });
        }

        // Usuń w transakcji - bezpieczne usuwanie
        const deleteOperations = [
            prisma.visit.deleteMany({ where: { link: { userId: id } } }),
            prisma.link.deleteMany({ where: { userId: id } }),
            prisma.payout.deleteMany({ where: { userId: id } })
        ];

        // 🆕 Dodaj usuwanie danych 2FA jeśli tabele istnieją
        try {
            deleteOperations.push(prisma.webAuthnCredential.deleteMany({ where: { userId: id } }));
        } catch (e) {}
        
        try {
            deleteOperations.push(prisma.backupCode.deleteMany({ where: { userId: id } }));
        } catch (e) {}
        
        try {
            deleteOperations.push(prisma.twoFactorLog.deleteMany({ where: { userId: id } }));
        } catch (e) {}

        deleteOperations.push(prisma.user.delete({ where: { id } }));

        await prisma.$transaction(deleteOperations);

        res.json({ success: true, message: 'Użytkownik i wszystkie jego dane zostały usunięte' });
    } catch (error) {
        console.error('Błąd usuwania użytkownika:', error);
        res.status(500).json({ success: false, message: 'Błąd serwera' });
    }
});

// ======================
// 🆕 ZARZĄDZANIE 2FA UŻYTKOWNIKÓW
// ======================

// Wyślij email z zaleceniem 2FA
router.post('/users/:id/recommend-2fa', async (req, res) => {
    try {
        const { id } = req.params;

        const user = await prisma.user.findUnique({
            where: { id },
            select: {
                email: true,
                twoFactorEnabled: true,
                isActive: true
            }
        });

        if (!user) {
            return res.status(404).json({ success: false, message: 'Użytkownik nie znaleziony' });
        }

        if (!user.isActive) {
            return res.status(400).json({ success: false, message: 'Użytkownik jest nieaktywny' });
        }

        if (user.twoFactorEnabled) {
            return res.status(400).json({ success: false, message: 'Użytkownik ma już włączone 2FA' });
        }

        // Wyślij email za pomocą emailUtils
        try {
            await emailUtils.sendTwoFactorRecommendation(user.email);
        } catch (emailError) {
            console.error('Błąd wysyłania emaila:', emailError);
            // Kontynuuj mimo błędu emaila
        }

        // Zapisz log
        try {
            await prisma.twoFactorLog.create({
                data: {
                    userId: id,
                    action: 'ADMIN_RECOMMENDED',
                    success: true,
                    ipAddress: req.ip,
                    userAgent: req.headers['user-agent']
                }
            });
        } catch (logError) {
            console.error('Błąd zapisywania logu 2FA:', logError);
        }

        res.json({ 
            success: true,
            message: 'Email z zaleceniem 2FA został wysłany' 
        });

    } catch (error) {
        console.error('Błąd wysyłania zalecenia 2FA:', error);
        res.status(500).json({ success: false, message: 'Błąd serwera' });
    }
});

// Wymuś 2FA dla użytkownika
router.post('/users/:id/require-2fa', async (req, res) => {
    try {
        const { id } = req.params;
        const adminId = req.userId;

        const user = await prisma.user.findUnique({
            where: { id },
            select: {
                email: true,
                twoFactorEnabled: true,
                twoFactorRequired: true,
                isActive: true
            }
        });

        if (!user) {
            return res.status(404).json({ success: false, message: 'Użytkownik nie znaleziony' });
        }

        if (user.twoFactorRequired) {
            return res.status(400).json({ success: false, message: '2FA jest już wymagane dla tego użytkownika' });
        }

        // Ustaw wymóg 2FA
        if (twoFactorService) {
            await twoFactorService.requireTwoFactor(id, adminId);
        } else {
            await prisma.user.update({
                where: { id },
                data: {
                    twoFactorRequired: true,
                    twoFactorRequiredAt: new Date(),
                    twoFactorRequiredBy: adminId
                }
            });
        }

        // Wyślij email informacyjny
        try {
            await emailUtils.sendTwoFactorRequired(user.email);
        } catch (emailError) {
            console.error('Błąd wysyłania emaila:', emailError);
        }

        // Zapisz log
        try {
            await prisma.twoFactorLog.create({
                data: {
                    userId: id,
                    action: 'ADMIN_REQUIRED',
                    success: true,
                    ipAddress: req.ip
                }
            });
        } catch (logError) {
            console.error('Błąd zapisywania logu:', logError);
        }

        res.json({ 
            success: true,
            message: '2FA zostało wymuszone dla użytkownika' 
        });

    } catch (error) {
        console.error('Błąd wymuszania 2FA:', error);
        res.status(500).json({ success: false, message: 'Błąd serwera' });
    }
});

// Alias dla kompatybilności z frontendem - /users/:id/2fa/force
router.post('/users/:id/2fa/force', async (req, res) => {
    try {
        const { id } = req.params;
        const adminId = req.userId;

        const user = await prisma.user.findUnique({
            where: { id },
            select: {
                email: true,
                twoFactorEnabled: true,
                twoFactorRequired: true,
                isActive: true
            }
        });

        if (!user) {
            return res.status(404).json({ success: false, message: 'Użytkownik nie znaleziony' });
        }

        if (user.twoFactorRequired) {
            return res.status(400).json({ success: false, message: '2FA jest już wymagane dla tego użytkownika' });
        }

        await prisma.user.update({
            where: { id },
            data: {
                twoFactorRequired: true,
                twoFactorRequiredAt: new Date(),
                twoFactorRequiredBy: adminId
            }
        });

        try {
            await emailUtils.sendTwoFactorRequired(user.email);
        } catch (emailError) {
            console.error('Błąd wysyłania emaila:', emailError);
        }

        try {
            await prisma.twoFactorLog.create({
                data: {
                    userId: id,
                    action: 'ADMIN_REQUIRED',
                    success: true,
                    ipAddress: req.ip
                }
            });
        } catch (logError) {
            console.error('Błąd zapisywania logu:', logError);
        }

        res.json({ 
            success: true,
            message: '2FA zostało wymuszone dla użytkownika' 
        });

    } catch (error) {
        console.error('Błąd wymuszania 2FA:', error);
        res.status(500).json({ success: false, message: 'Błąd serwera' });
    }
});

// Wymuś 2FA dla użytkownika - /users/:id/2fa/force
router.post('/users/:id/2fa/force', async (req, res) => {
    try {
        const { id } = req.params;
        const adminId = req.userId;

        const user = await prisma.user.findUnique({
            where: { id },
            select: {
                email: true,
                twoFactorEnabled: true,
                twoFactorRequired: true,
                isActive: true
            }
        });

        if (!user) {
            return res.status(404).json({ success: false, message: 'Użytkownik nie znaleziony' });
        }

        if (user.twoFactorEnabled) {
            return res.status(400).json({ success: false, message: 'Użytkownik ma już włączone 2FA' });
        }

        if (user.twoFactorRequired) {
            return res.status(400).json({ success: false, message: '2FA jest już wymagane dla tego użytkownika' });
        }

        await prisma.user.update({
            where: { id },
            data: {
                twoFactorRequired: true,
                twoFactorRequiredAt: new Date(),
                twoFactorRequiredBy: adminId
            }
        });

        // Wyślij email informacyjny
        try {
            await emailUtils.sendTwoFactorRequired(user.email);
        } catch (emailError) {
            console.error('Błąd wysyłania emaila:', emailError);
        }

        // Zapisz log
        try {
            await prisma.twoFactorLog.create({
                data: {
                    userId: id,
                    action: 'ADMIN_FORCED',
                    success: true,
                    ipAddress: req.ip
                }
            });
        } catch (logError) {
            console.error('Błąd zapisywania logu:', logError);
        }

        res.json({ 
            success: true,
            message: '2FA zostało wymuszone dla użytkownika' 
        });

    } catch (error) {
        console.error('Błąd wymuszania 2FA:', error);
        res.status(500).json({ success: false, message: 'Błąd serwera' });
    }
});

// Usuń wymóg 2FA - /users/:id/2fa/remove-force
router.post('/users/:id/2fa/remove-force', async (req, res) => {
    try {
        const { id } = req.params;

        const user = await prisma.user.findUnique({
            where: { id },
            select: { 
                email: true,
                twoFactorRequired: true 
            }
        });

        if (!user) {
            return res.status(404).json({ success: false, message: 'Użytkownik nie znaleziony' });
        }

        if (!user.twoFactorRequired) {
            return res.status(400).json({ success: false, message: '2FA nie jest wymagane dla tego użytkownika' });
        }

        await prisma.user.update({
            where: { id },
            data: {
                twoFactorRequired: false,
                twoFactorRequiredAt: null,
                twoFactorRequiredBy: null
            }
        });

        // Zapisz log
        try {
            await prisma.twoFactorLog.create({
                data: {
                    userId: id,
                    action: 'ADMIN_REMOVED_FORCE',
                    success: true,
                    ipAddress: req.ip
                }
            });
        } catch (logError) {
            console.error('Błąd zapisywania logu:', logError);
        }

        res.json({ 
            success: true,
            message: 'Wymóg 2FA został usunięty' 
        });

    } catch (error) {
        console.error('Błąd usuwania wymogu 2FA:', error);
        res.status(500).json({ success: false, message: 'Błąd serwera' });
    }
});

// Resetuj 2FA użytkownika - /users/:id/2fa/reset
router.post('/users/:id/2fa/reset', async (req, res) => {
    try {
        const { id } = req.params;
        const adminId = req.userId;

        const user = await prisma.user.findUnique({
            where: { id },
            select: {
                email: true,
                twoFactorEnabled: true
            }
        });

        if (!user) {
            return res.status(404).json({ success: false, message: 'Użytkownik nie znaleziony' });
        }

        if (!user.twoFactorEnabled) {
            return res.status(400).json({ success: false, message: 'Użytkownik nie ma włączonego 2FA' });
        }

        // Usuń wszystkie dane 2FA
        const deleteOperations = [];
        
        try {
            deleteOperations.push(prisma.webAuthnCredential.deleteMany({ where: { userId: id } }));
        } catch (e) {}
        
        try {
            deleteOperations.push(prisma.backupCode.deleteMany({ where: { userId: id } }));
        } catch (e) {}

        deleteOperations.push(
            prisma.user.update({
                where: { id },
                data: {
                    twoFactorEnabled: false,
                    twoFactorSecret: null,
                    twoFactorMethod: [],
                    twoFactorEnabledAt: null,
                    twoFactorLastUsedAt: null
                }
            })
        );

        await prisma.$transaction(deleteOperations);

        // Zapisz log
        try {
            await prisma.twoFactorLog.create({
                data: {
                    userId: id,
                    action: 'ADMIN_RESET',
                    success: true,
                    ipAddress: req.ip
                }
            });
        } catch (logError) {
            console.error('Błąd zapisywania logu:', logError);
        }

        // Wyślij email
        try {
            await emailUtils.sendTwoFactorReset(user.email);
        } catch (emailError) {
            console.error('Błąd wysyłania emaila:', emailError);
        }

        res.json({ 
            success: true,
            message: '2FA użytkownika zostało zresetowane' 
        });

    } catch (error) {
        console.error('Błąd resetowania 2FA:', error);
        res.status(500).json({ success: false, message: 'Błąd serwera' });
    }
});

// 🆕 Alias dla kompatybilności z frontendem - /users/:id/2fa/recommend
router.post('/users/:id/2fa/recommend', async (req, res) => {
    try {
        const { id } = req.params;
        const adminId = req.userId;

        const user = await prisma.user.findUnique({
            where: { id },
            select: {
                email: true,
                twoFactorEnabled: true,
                twoFactorRequired: true,
                isActive: true
            }
        });

        if (!user) {
            return res.status(404).json({ success: false, message: 'Użytkownik nie znaleziony' });
        }

        if (user.twoFactorRequired) {
            return res.status(400).json({ success: false, message: '2FA jest już wymagane dla tego użytkownika' });
        }

        // Ustaw wymóg 2FA
        await prisma.user.update({
            where: { id },
            data: {
                twoFactorRequired: true,
                twoFactorRequiredAt: new Date(),
                twoFactorRequiredBy: adminId
            }
        });

        // Wyślij email informacyjny
        try {
            await emailUtils.sendTwoFactorRequired(user.email);
        } catch (emailError) {
            console.error('Błąd wysyłania emaila:', emailError);
        }

        // Zapisz log
        try {
            await prisma.twoFactorLog.create({
                data: {
                    userId: id,
                    action: 'ADMIN_REQUIRED',
                    success: true,
                    ipAddress: req.ip
                }
            });
        } catch (logError) {
            console.error('Błąd zapisywania logu:', logError);
        }

        res.json({ 
            success: true,
            message: '2FA zostało wymuszone dla użytkownika' 
        });

    } catch (error) {
        console.error('Błąd wymuszania 2FA:', error);
        res.status(500).json({ success: false, message: 'Błąd serwera' });
    }
});

// Usuń wymóg 2FA
router.delete('/users/:id/require-2fa', async (req, res) => {
    try {
        const { id } = req.params;

        const user = await prisma.user.findUnique({
            where: { id },
            select: { twoFactorRequired: true }
        });

        if (!user) {
            return res.status(404).json({ success: false, message: 'Użytkownik nie znaleziony' });
        }

        if (!user.twoFactorRequired) {
            return res.status(400).json({ success: false, message: '2FA nie jest wymagane dla tego użytkownika' });
        }

        if (twoFactorService) {
            await twoFactorService.removeRequireTwoFactor(id);
        } else {
            await prisma.user.update({
                where: { id },
                data: {
                    twoFactorRequired: false,
                    twoFactorRequiredAt: null,
                    twoFactorRequiredBy: null
                }
            });
        }

        res.json({ 
            success: true,
            message: 'Wymóg 2FA został usunięty' 
        });

    } catch (error) {
        console.error('Błąd usuwania wymogu 2FA:', error);
        res.status(500).json({ success: false, message: 'Błąd serwera' });
    }
});

// Resetuj 2FA użytkownika
router.post('/users/:id/reset-2fa', async (req, res) => {
    try {
        const { id } = req.params;
        const adminId = req.userId;
        const { sendEmail = true } = req.body;

        const user = await prisma.user.findUnique({
            where: { id },
            select: {
                email: true,
                twoFactorEnabled: true
            }
        });

        if (!user) {
            return res.status(404).json({ success: false, message: 'Użytkownik nie znaleziony' });
        }

        if (!user.twoFactorEnabled) {
            return res.status(400).json({ success: false, message: 'Użytkownik nie ma włączonego 2FA' });
        }

        // Resetuj 2FA
        if (twoFactorService) {
            await twoFactorService.adminResetTwoFactor(id, adminId);
        } else {
            const deleteOperations = [
                prisma.user.update({
                    where: { id },
                    data: {
                        twoFactorEnabled: false,
                        twoFactorSecret: null,
                        twoFactorMethod: [],
                        twoFactorEnabledAt: null
                    }
                })
            ];

            try {
                deleteOperations.unshift(prisma.webAuthnCredential.deleteMany({ where: { userId: id } }));
            } catch (e) {}
            
            try {
                deleteOperations.unshift(prisma.backupCode.deleteMany({ where: { userId: id } }));
            } catch (e) {}

            await prisma.$transaction(deleteOperations);

            // Zapisz log
            try {
                await prisma.twoFactorLog.create({
                    data: {
                        userId: id,
                        action: 'ADMIN_RESET',
                        success: true,
                        ipAddress: req.ip
                    }
                });
            } catch (e) {}
        }

        // Wyślij email informacyjny
        if (sendEmail) {
            try {
                await emailUtils.sendTwoFactorReset(user.email);
            } catch (emailError) {
                console.error('Błąd wysyłania emaila:', emailError);
            }
        }

        res.json({ 
            success: true,
            message: '2FA użytkownika zostało zresetowane' 
        });

    } catch (error) {
        console.error('Błąd resetowania 2FA:', error);
        res.status(500).json({ success: false, message: 'Błąd serwera' });
    }
});

// Szczegółowy status 2FA użytkownika
router.get('/users/:id/2fa-status', async (req, res) => {
    try {
        const { id } = req.params;

        const user = await prisma.user.findUnique({
            where: { id },
            select: {
                id: true,
                email: true,
                twoFactorEnabled: true,
                twoFactorMethod: true,
                twoFactorRequired: true,
                twoFactorRequiredAt: true,
                twoFactorRequiredBy: true,
                twoFactorEnabledAt: true,
                twoFactorLastUsedAt: true
            }
        });

        if (!user) {
            return res.status(404).json({ success: false, message: 'Użytkownik nie znaleziony' });
        }

        // Pobierz WebAuthn credentials
        let webAuthnCredentials = [];
        try {
            webAuthnCredentials = await prisma.webAuthnCredential.findMany({
                where: { userId: id },
                select: {
                    id: true,
                    deviceName: true,
                    credentialDeviceType: true,
                    lastUsedAt: true,
                    createdAt: true
                }
            });
        } catch (e) {}

        // Pobierz backup codes
        let totalBackupCodes = 0, unusedBackupCodes = 0;
        try {
            [totalBackupCodes, unusedBackupCodes] = await Promise.all([
                prisma.backupCode.count({ where: { userId: id } }),
                prisma.backupCode.count({ where: { userId: id, usedAt: null } })
            ]);
        } catch (e) {}

        // Pobierz ostatnie logi 2FA
        let recentLogs = [];
        try {
            recentLogs = await prisma.twoFactorLog.findMany({
                where: { userId: id },
                orderBy: { createdAt: 'desc' },
                take: 10,
                select: {
                    action: true,
                    method: true,
                    success: true,
                    ipAddress: true,
                    failReason: true,
                    createdAt: true
                }
            });
        } catch (e) {}

        // Pobierz admina który wymusił 2FA
        let requiredByAdmin = null;
        if (user.twoFactorRequiredBy) {
            const admin = await prisma.user.findUnique({
                where: { id: user.twoFactorRequiredBy },
                select: { email: true }
            });
            requiredByAdmin = admin?.email || null;
        }

        res.json({
            success: true,
            data: {
                userId: user.id,
                email: user.email,
                twoFactor: {
                    enabled: user.twoFactorEnabled,
                    methods: user.twoFactorMethod || [],
                    required: user.twoFactorRequired,
                    requiredAt: user.twoFactorRequiredAt,
                    requiredBy: requiredByAdmin,
                    enabledAt: user.twoFactorEnabledAt,
                    lastUsedAt: user.twoFactorLastUsedAt
                },
                webAuthnCredentials,
                backupCodes: {
                    total: totalBackupCodes,
                    remaining: unusedBackupCodes,
                    used: totalBackupCodes - unusedBackupCodes
                },
                recentLogs
            }
        });

    } catch (error) {
        console.error('Błąd pobierania statusu 2FA:', error);
        res.status(500).json({ success: false, message: 'Błąd serwera' });
    }
});

// Statystyki 2FA dla całej platformy
router.get('/2fa-stats', async (req, res) => {
    try {
        const [
            totalUsers,
            usersWithTwoFactor,
            usersWithRequired
        ] = await Promise.all([
            prisma.user.count(),
            prisma.user.count({ where: { twoFactorEnabled: true } }),
            prisma.user.count({ where: { twoFactorRequired: true } })
        ]);

        // Metody 2FA
        let usersWithTotp = 0, usersWithWebAuthn = 0;
        try {
            usersWithTotp = await prisma.user.count({
                where: {
                    twoFactorEnabled: true,
                    twoFactorMethod: { has: 'TOTP' }
                }
            });
        } catch (e) {}

        try {
            usersWithWebAuthn = await prisma.user.count({
                where: {
                    twoFactorEnabled: true,
                    twoFactorMethod: { has: 'WEBAUTHN' }
                }
            });
        } catch (e) {}

        // Dodatkowe statystyki
        let totalWebAuthnCredentials = 0, totalBackupCodesUsed = 0;
        try {
            totalWebAuthnCredentials = await prisma.webAuthnCredential.count();
        } catch (e) {}
        
        try {
            totalBackupCodesUsed = await prisma.backupCode.count({ where: { usedAt: { not: null } } });
        } catch (e) {}

        // Logi z ostatnich 30 dni
        const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        
        let logStats = {
            verifications: { successful: 0, failed: 0 },
            enablements: 0,
            disablements: 0,
            adminResets: 0,
            backupCodesUsed: 0
        };

        try {
            const recentLogs = await prisma.twoFactorLog.groupBy({
                by: ['action', 'success'],
                where: { createdAt: { gte: thirtyDaysAgo } },
                _count: true
            });

            recentLogs.forEach(log => {
                if (log.action === 'VERIFIED') {
                    if (log.success) logStats.verifications.successful += log._count;
                    else logStats.verifications.failed += log._count;
                } else if (log.action === 'ENABLED') {
                    logStats.enablements += log._count;
                } else if (log.action === 'DISABLED') {
                    logStats.disablements += log._count;
                } else if (log.action === 'ADMIN_RESET') {
                    logStats.adminResets += log._count;
                } else if (log.action === 'BACKUP_USED') {
                    logStats.backupCodesUsed += log._count;
                }
            });
        } catch (e) {}

        res.json({
            success: true,
            data: {
                overview: {
                    totalUsers,
                    usersWithTwoFactor,
                    usersWithoutTwoFactor: totalUsers - usersWithTwoFactor,
                    adoptionRate: totalUsers > 0 
                        ? ((usersWithTwoFactor / totalUsers) * 100).toFixed(1) 
                        : 0
                },
                methods: {
                    totp: usersWithTotp,
                    webauthn: usersWithWebAuthn
                },
                enforcement: {
                    usersWithRequired,
                    usersCompliant: usersWithTwoFactor,
                    usersPending: Math.max(0, usersWithRequired - usersWithTwoFactor)
                },
                credentials: {
                    totalWebAuthnCredentials,
                    totalBackupCodesUsed
                },
                last30Days: logStats
            }
        });

    } catch (error) {
        console.error('Błąd pobierania statystyk 2FA:', error);
        res.status(500).json({ success: false, message: 'Błąd serwera' });
    }
});

// ======================
// LINKI
// ======================

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
                        select: { id: true, email: true }
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
                totalClicks: link.totalClicks,
                totalEarned: link.totalEarned,
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

router.get('/links/:id', async (req, res) => {
    try {
        const { id } = req.params;

        const link = await prisma.link.findUnique({
            where: { id },
            include: {
                user: { select: { id: true, email: true } },
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
                _count: { select: { visits: true } }
            }
        });

        if (!link) {
            return res.status(404).json({ success: false, message: 'Link nie znaleziony' });
        }

        res.json({
            success: true,
            link: { ...link, visitsCount: link._count.visits }
        });
    } catch (error) {
        console.error('Błąd pobierania linku:', error);
        res.status(500).json({ success: false, message: 'Błąd serwera' });
    }
});

router.patch('/links/:id/toggle-active', async (req, res) => {
    try {
        const { id } = req.params;

        const link = await prisma.link.findUnique({ where: { id } });

        if (!link) {
            return res.status(404).json({ success: false, message: 'Link nie znaleziony' });
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

router.delete('/links/:id', async (req, res) => {
    try {
        const { id } = req.params;

        const link = await prisma.link.findUnique({ where: { id } });

        if (!link) {
            return res.status(404).json({ success: false, message: 'Link nie znaleziony' });
        }

        await prisma.$transaction([
            prisma.visit.deleteMany({ where: { linkId: id } }),
            prisma.link.delete({ where: { id } })
        ]);

        res.json({ success: true, message: 'Link usunięty' });
    } catch (error) {
        console.error('Błąd usuwania linku:', error);
        res.status(500).json({ success: false, message: 'Błąd serwera' });
    }
});

// ======================
// WYPŁATY
// ======================

router.get('/payouts', async (req, res) => {
    try {
        const { page = 1, limit = 20, status = 'all' } = req.query;
        const skip = (parseInt(page) - 1) * parseInt(limit);

        const where = status !== 'all' ? { status: status.toUpperCase() } : {};

        const [payouts, total, stats] = await Promise.all([
            prisma.payout.findMany({
                where,
                include: {
                    user: { select: { id: true, email: true } }
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
            return res.status(404).json({ success: false, message: 'Wypłata nie znaleziona' });
        }

        // Zwrot środków przy odrzuceniu
        if (status === 'REJECTED' && payout.status !== 'REJECTED') {
            await prisma.user.update({
                where: { id: payout.userId },
                data: { balance: { increment: payout.amount } }
            });
        }

        // Ponowne pobranie przy zmianie z REJECTED na inny status
        if (payout.status === 'REJECTED' && status !== 'REJECTED') {
            const user = await prisma.user.findUnique({ where: { id: payout.userId } });
            if (user.balance < payout.amount) {
                return res.status(400).json({ 
                    success: false, 
                    message: 'Użytkownik nie ma wystarczających środków' 
                });
            }
            await prisma.user.update({
                where: { id: payout.userId },
                data: { balance: { decrement: payout.amount } }
            });
        }

        const updatedPayout = await prisma.payout.update({
            where: { id },
            data: { 
                status,
                adminNote: adminNote || payout.adminNote,
                processedAt: status === 'COMPLETED' ? new Date() : payout.processedAt
            },
            include: { user: { select: { email: true } } }
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

// Alias PUT dla kompatybilności
router.put('/payouts/:id', async (req, res) => {
    req.method = 'PATCH';
    return router.handle(req, res);
});

// ======================
// WIADOMOŚCI KONTAKTOWE
// ======================

router.get('/messages', async (req, res) => {
    try {
        const { page = 1, limit = 20, status = 'all' } = req.query;
        const skip = (parseInt(page) - 1) * parseInt(limit);

        let messages = [];
        let total = 0;
        let unreadCount = 0;

        try {
            const where = status === 'unread' ? { isRead: false } : 
                         status === 'read' ? { isRead: true } : {};
                         
            [messages, total, unreadCount] = await Promise.all([
                prisma.contactMessage.findMany({
                    where,
                    orderBy: { createdAt: 'desc' },
                    skip,
                    take: parseInt(limit)
                }),
                prisma.contactMessage.count({ where }),
                prisma.contactMessage.count({ where: { isRead: false } })
            ]);
        } catch (e) {
            console.log('Model ContactMessage może nie istnieć:', e.message);
        }

        res.json({
            success: true,
            messages: messages.map(m => ({
                id: m.id,
                name: m.name,
                email: m.email,
                subject: m.subject,
                message: m.message,
                isRead: m.isRead,
                createdAt: m.createdAt
            })),
            unreadCount,
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

router.patch('/messages/:id/read', async (req, res) => {
    try {
        const { id } = req.params;
        const { sendNotification = true } = req.body;
        
        const message = await prisma.contactMessage.findUnique({
            where: { id }
        });
        
        if (!message) {
            return res.status(404).json({ success: false, message: 'Wiadomość nie znaleziona' });
        }
        
        if (message.isRead) {
            return res.json({ success: true, message: 'Wiadomość już była oznaczona jako przeczytana' });
        }
        
        await prisma.contactMessage.update({
            where: { id },
            data: { isRead: true }
        });
        
        if (sendNotification) {
            emailUtils.sendMessageReadNotification(
                message.email,
                message.name,
                message.subject
            ).catch(err => console.error('Message read notification error:', err));
        }
        
        res.json({ success: true, message: 'Oznaczono jako przeczytane' });
    } catch (error) {
        console.error('Błąd oznaczania wiadomości:', error);
        res.status(500).json({ success: false, message: 'Błąd serwera' });
    }
});

router.put('/messages/:id/read', async (req, res) => {
    try {
        const { id } = req.params;
        const { sendNotification = true } = req.body;
        
        const message = await prisma.contactMessage.findUnique({
            where: { id }
        });
        
        if (!message) {
            return res.status(404).json({ success: false, message: 'Wiadomość nie znaleziona' });
        }
        
        if (message.isRead) {
            return res.json({ success: true, message: 'Wiadomość już była oznaczona jako przeczytana' });
        }
        
        await prisma.contactMessage.update({
            where: { id },
            data: { isRead: true }
        });
        
        if (sendNotification) {
            emailUtils.sendMessageReadNotification(
                message.email,
                message.name,
                message.subject
            ).catch(err => console.error('Message read notification error:', err));
        }
        
        res.json({ success: true, message: 'Oznaczono jako przeczytane' });
    } catch (error) {
        console.error('Błąd oznaczania wiadomości:', error);
        res.status(500).json({ success: false, message: 'Błąd serwera' });
    }
});

router.delete('/messages/:id', async (req, res) => {
    try {
        const { id } = req.params;
        
        const message = await prisma.contactMessage.findUnique({
            where: { id }
        });
        
        if (!message) {
            return res.status(404).json({ success: false, message: 'Wiadomość nie znaleziona' });
        }
        
        await prisma.contactMessage.delete({ where: { id } });
        res.json({ success: true, message: 'Wiadomość usunięta' });
    } catch (error) {
        console.error('Błąd usuwania wiadomości:', error);
        res.status(500).json({ success: false, message: 'Błąd serwera' });
    }
});

// ======================
// SZYFROWANIE & BEZPIECZEŃSTWO
// ======================

router.get('/encryption-status', async (req, res) => {
    try {
        const isValid = validateEncryptionKey();
        const hasAdsterraToken = !!process.env.ADSTERRA_API_TOKEN;
        const hasTwoFactorKey = !!process.env.TWO_FACTOR_ENCRYPTION_KEY;
        
        res.json({
            success: true,
            encryption: {
                enabled: isValid,
                algorithm: 'AES-256-GCM',
                status: isValid ? 'OK' : 'Problem z kluczem!'
            },
            adsterra: {
                configured: hasAdsterraToken,
                status: hasAdsterraToken ? 'Token ustawiony' : 'Brak tokenu ADSTERRA_API_TOKEN'
            },
            twoFactor: {
                configured: hasTwoFactorKey,
                status: hasTwoFactorKey ? 'Klucz szyfrowania 2FA ustawiony' : 'Brak TWO_FACTOR_ENCRYPTION_KEY'
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Błąd sprawdzania statusu' });
    }
});

router.post('/decrypt-user-ip', async (req, res) => {
    try {
        const { userId } = req.body;
        
        if (!userId) {
            return res.status(400).json({ success: false, message: 'ID użytkownika jest wymagane' });
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
            return res.status(404).json({ success: false, message: 'Użytkownik nie znaleziony' });
        }
        
        let registrationIp = null, lastLoginIp = null;
        
        try {
            if (user.registrationIp) registrationIp = decrypt(user.registrationIp);
        } catch (e) { 
            registrationIp = '[błąd odszyfrowania]'; 
        }
        
        try {
            if (user.lastLoginIp) lastLoginIp = decrypt(user.lastLoginIp);
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
        console.error('Błąd odszyfrowania IP:', error);
        res.status(500).json({ success: false, message: 'Błąd serwera' });
    }
});

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
            return res.status(404).json({ success: false, message: 'Użytkownik nie znaleziony' });
        }
        
        let logs = [], total = 0;
        
        try {
            [logs, total] = await Promise.all([
                prisma.ipLog.findMany({
                    where: { userId },
                    orderBy: { createdAt: 'desc' },
                    skip,
                    take: parseInt(limit)
                }),
                prisma.ipLog.count({ where: { userId } })
            ]);
        } catch (e) {
            console.log('Model IpLog może nie istnieć');
        }
        
        const decryptedLogs = logs.map(log => {
            let ip = null;
            try { 
                ip = decrypt(log.encryptedIp); 
            } catch (e) { 
                ip = '[błąd]'; 
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
        res.status(500).json({ success: false, message: 'Błąd serwera' });
    }
});

router.post('/decrypt-visit-ip', async (req, res) => {
    try {
        const { visitId } = req.body;
        
        if (!visitId) {
            return res.status(400).json({ success: false, message: 'ID wizyty jest wymagane' });
        }
        
        const visit = await prisma.visit.findUnique({
            where: { id: visitId },
            include: {
                link: {
                    select: { 
                        shortCode: true, 
                        title: true, 
                        user: { select: { email: true } } 
                    }
                }
            }
        });
        
        if (!visit) {
            return res.status(404).json({ success: false, message: 'Wizyta nie znaleziona' });
        }
        
        let ip = null;
        try {
            if (visit.encryptedIp) ip = decrypt(visit.encryptedIp);
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
        res.status(500).json({ success: false, message: 'Błąd serwera' });
    }
});

router.post('/search-by-ip', async (req, res) => {
    try {
        const { ip } = req.body;
        
        if (!ip) {
            return res.status(400).json({ success: false, message: 'Adres IP jest wymagany' });
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
            let regIp = null, loginIp = null;
            
            try {
                if (user.registrationIp) regIp = decrypt(user.registrationIp);
                if (user.lastLoginIp) loginIp = decrypt(user.lastLoginIp);
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
                    matchType: regIp === ip && loginIp === ip ? 'both' : regIp === ip ? 'registration' : 'login'
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
        res.status(500).json({ success: false, message: 'Błąd serwera' });
    }
});

// ======================
// ZARZĄDZANIE STAWKAMI CPM
// ======================

const linkService = require('../services/linkService');
const earningsService = require('../services/earningsService');

router.get('/cpm-rates', async (req, res) => {
    try {
        const rates = await linkService.getAllRates();
        const commission = await linkService.getPlatformCommission();

        const enrichedRates = rates.map(rate => {
            const grossCpm = Number(rate.cpm_rate) || Number(rate.baseCpm) || 0;
            const userCpm = grossCpm * (1 - commission);
            
            return {
                countryCode: rate.countryCode,
                countryName: rate.countryName,
                tier: rate.tier,
                baseCpm: grossCpm,
                userCpm: parseFloat(userCpm.toFixed(4)),
                perVisit: parseFloat((userCpm / 1000).toFixed(6)),
                source: 'database',
                isActive: rate.isActive
            };
        });

        res.json({
            success: true,
            config: {
                userShare: 1 - commission,
                platformShare: commission,
                minPayout: 10.00
            },
            rates: enrichedRates.sort((a, b) => a.tier - b.tier || b.baseCpm - a.baseCpm),
            totalCountries: enrichedRates.length
        });

    } catch (error) {
        console.error('Błąd /cpm-rates:', error);
        res.status(500).json({ success: false, message: 'Błąd serwera' });
    }
});

router.put('/cpm-rates/:countryCode', async (req, res) => {
    try {
        const { countryCode } = req.params;
        const { baseCpm } = req.body;

        if (baseCpm === undefined || baseCpm < 0) {
            return res.status(400).json({
                success: false,
                message: 'baseCpm musi być liczbą >= 0'
            });
        }

        const updated = await linkService.updateRate(
            countryCode.toUpperCase(),
            parseFloat(baseCpm),
            req.userId || 'admin'
        );

        const commission = await linkService.getPlatformCommission();
        const userCpm = parseFloat(baseCpm) * (1 - commission);

        res.json({
            success: true,
            message: `Stawka CPM dla ${countryCode} zaktualizowana`,
            rate: {
                countryCode: updated.countryCode,
                countryName: updated.countryName,
                tier: updated.tier,
                baseCpm: parseFloat(baseCpm),
                userCpm: userCpm,
                perVisit: userCpm / 1000
            }
        });

    } catch (error) {
        console.error('Błąd aktualizacji stawki CPM:', error);
        res.status(500).json({ success: false, message: error.message || 'Błąd serwera' });
    }
});

router.get('/earnings-by-country', async (req, res) => {
    try {
        const { days = 30 } = req.query;
        const stats = await earningsService.getEarningsStatsByCountry(parseInt(days));

        const totals = stats.reduce((acc, s) => ({
            totalVisits: acc.totalVisits + s.totalVisits,
            uniqueVisits: acc.uniqueVisits + s.uniqueVisits,
            userEarnings: acc.userEarnings + s.userEarnings,
            platformEarnings: acc.platformEarnings + s.platformEarnings
        }), { totalVisits: 0, uniqueVisits: 0, userEarnings: 0, platformEarnings: 0 });

        res.json({
            success: true,
            period: `${days} dni`,
            totals,
            countries: stats
        });

    } catch (error) {
        console.error('Błąd statystyk:', error);
        res.status(500).json({ success: false, message: 'Błąd serwera' });
    }
});

router.get('/cpm-rates/history', async (req, res) => {
    try {
        const { countryCode, limit = 50 } = req.query;
        const history = await linkService.getRateHistory(countryCode, parseInt(limit));

        res.json({
            success: true,
            history: history.map(h => ({
                ...h,
                old_rate: parseFloat(h.oldRate),
                new_rate: parseFloat(h.newRate),
                change: ((parseFloat(h.newRate) - parseFloat(h.oldRate)) / parseFloat(h.oldRate) * 100).toFixed(2) + '%'
            }))
        });

    } catch (error) {
        console.error('Błąd historii CPM:', error);
        res.status(500).json({ success: false, message: 'Błąd serwera' });
    }
});

// ======================
// FRAUD ALERTS
// ======================

router.get('/fraud-alerts', async (req, res) => {
    try {
        const {
            status,
            page = 1,
            limit = 20,
            sortBy = 'createdAt',
            sortOrder = 'desc'
        } = req.query;

        const result = await ReferralService.getFraudAlerts({
            status: status || null,
            page: parseInt(page),
            limit: parseInt(limit),
            sortBy,
            sortOrder
        });

        res.json({
            success: true,
            data: result
        });

    } catch (error) {
        console.error('Get fraud alerts error:', error);
        res.status(500).json({
            success: false,
            message: 'Błąd pobierania alertów'
        });
    }
});

router.get('/fraud-alerts/stats', async (req, res) => {
    try {
        const stats = await ReferralService.getFraudAlertStats();

        res.json({
            success: true,
            data: stats
        });

    } catch (error) {
        console.error('Get fraud stats error:', error);
        res.status(500).json({
            success: false,
            message: 'Błąd pobierania statystyk'
        });
    }
});

router.get('/fraud-alerts/:id', async (req, res) => {
    try {
        const { id } = req.params;

        const alert = await prisma.fraudAlert.findUnique({
            where: { id },
            include: {
                referrer: {
                    select: {
                        id: true,
                        email: true,
                        referralCode: true,
                        referralDisabled: true,
                        isActive: true,
                        createdAt: true,
                        referrals: {
                            select: {
                                id: true,
                                email: true,
                                createdAt: true,
                                referralFraudFlag: true
                            },
                            take: 10,
                            orderBy: { createdAt: 'desc' }
                        }
                    }
                },
                referred: {
                    select: {
                        id: true,
                        email: true,
                        isActive: true,
                        createdAt: true,
                        referralFraudFlag: true,
                        referralFraudReason: true
                    }
                }
            }
        });

        if (!alert) {
            return res.status(404).json({
                success: false,
                message: 'Alert nie znaleziony'
            });
        }

        res.json({
            success: true,
            data: alert
        });

    } catch (error) {
        console.error('Get fraud alert error:', error);
        res.status(500).json({
            success: false,
            message: 'Błąd pobierania alertu'
        });
    }
});

router.post('/fraud-alerts/:id/resolve', async (req, res) => {
    try {
        const { id } = req.params;
        const { resolution, notes } = req.body;

        const validResolutions = [
            'APPROVED',
            'BLOCKED_REFERRED',
            'BLOCKED_BOTH',
            'REFERRAL_DISABLED'
        ];

        if (!validResolutions.includes(resolution)) {
            return res.status(400).json({
                success: false,
                message: `Nieprawidłowa akcja. Dozwolone: ${validResolutions.join(', ')}`
            });
        }

        const updatedAlert = await ReferralService.resolveAlert(
            id,
            resolution,
            req.userId,
            notes
        );

        res.json({
            success: true,
            message: 'Alert został rozwiązany',
            data: updatedAlert
        });

    } catch (error) {
        console.error('Resolve alert error:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Błąd rozwiązywania alertu'
        });
    }
});

router.post('/users/:id/toggle-referral', async (req, res) => {
    try {
        const { id } = req.params;
        const { disabled, reason } = req.body;

        const user = await prisma.user.findUnique({
            where: { id },
            select: { id: true, email: true, referralDisabled: true }
        });

        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'Użytkownik nie znaleziony'
            });
        }

        const updatedUser = await ReferralService.toggleReferralStatus(
            id,
            disabled,
            reason
        );

        res.json({
            success: true,
            message: disabled
                ? 'Zaproszenia zostały wyłączone'
                : 'Zaproszenia zostały włączone',
            data: {
                id: updatedUser.id,
                email: updatedUser.email,
                referralDisabled: updatedUser.referralDisabled
            }
        });

    } catch (error) {
        console.error('Toggle referral error:', error);
        res.status(500).json({
            success: false,
            message: 'Błąd zmiany statusu zaproszeń'
        });
    }
});

router.get('/referral-stats', async (req, res) => {
    try {
        const stats = await ReferralService.getAdminStats();
        
        res.json({
            success: true,
            data: stats
        });

    } catch (error) {
        console.error('Get referral stats error:', error);
        res.status(500).json({
            success: false,
            message: 'Błąd pobierania statystyk'
        });
    }
});

router.post('/users/:id/disable-referral-reset-earnings', async (req, res) => {
    try {
        const { id } = req.params;

        const user = await prisma.user.findUnique({
            where: { id },
            select: { id: true, email: true, referralEarnings: true }
        });

        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'Użytkownik nie znaleziony'
            });
        }

        await prisma.user.update({
            where: { id },
            data: {
                referralDisabled: true,
                referralDisabledAt: new Date(),
                referralDisabledReason: 'Wyłączone przez admina - zarobki wyzerowane',
                referralEarnings: 0
            }
        });

        res.json({
            success: true,
            message: 'Polecenia wyłączone i zarobki wyzerowane',
            data: {
                id: user.id,
                email: user.email,
                previousEarnings: parseFloat(user.referralEarnings || 0)
            }
        });

    } catch (error) {
        console.error('Disable referral and reset earnings error:', error);
        res.status(500).json({
            success: false,
            message: 'Błąd operacji'
        });
    }
});

module.exports = router;