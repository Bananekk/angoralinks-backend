const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const { verifyToken, isAdmin } = require('../middleware/auth');

const prisma = new PrismaClient();

// Sprawdź czy encryption.js istnieje, jeśli nie - użyj dummy
let encrypt, decrypt, validateEncryptionKey;
try {
    const encryption = require('../utils/encryption');
    encrypt = encryption.encrypt;
    decrypt = encryption.decrypt;
    validateEncryptionKey = encryption.validateEncryptionKey;
} catch (e) {
    console.warn('⚠️ Moduł encryption nie znaleziony, używam dummy');
    encrypt = (text) => text;
    decrypt = (text) => text;
    validateEncryptionKey = () => false;
}

// Middleware - tylko admin
router.use(verifyToken, isAdmin);

// GET /encryption-status
router.get('/encryption-status', async (req, res) => {
    try {
        const isValid = validateEncryptionKey();
        res.json({
            success: true,
            encryptionEnabled: isValid,
            algorithm: 'AES-256-GCM'
        });
    } catch (error) {
        res.status(500).json({ error: 'Błąd sprawdzania szyfrowania' });
    }
});

// GET /stats
router.get('/stats', async (req, res) => {
    try {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        
        let totalIpLogs = 0;
        let todayIpLogs = 0;
        
        try {
            totalIpLogs = await prisma.ipLog.count();
            todayIpLogs = await prisma.ipLog.count({ where: { createdAt: { gte: today } } });
        } catch (e) {
            // Tabela może nie istnieć
        }
        
        const last7Days = [];
        for (let i = 6; i >= 0; i--) {
            const date = new Date();
            date.setDate(date.getDate() - i);
            date.setHours(0, 0, 0, 0);
            last7Days.push({ date: date.toISOString().split('T')[0], count: 0 });
        }
        
        res.json({
            success: true,
            stats: {
                totalIpLogs,
                todayIpLogs,
                loginCount: 0,
                registerCount: 0,
                visitsWithIp: 0,
                last7Days
            }
        });
    } catch (error) {
        console.error('Błąd stats:', error);
        res.status(500).json({ error: 'Błąd serwera' });
    }
});

// POST /decrypt-user-ip
router.post('/decrypt-user-ip', async (req, res) => {
    try {
        const { userId } = req.body;
        
        if (!userId) {
            return res.status(400).json({ error: 'ID użytkownika jest wymagane' });
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
            return res.status(404).json({ error: 'Użytkownik nie znaleziony' });
        }
        
        res.json({
            success: true,
            user: {
                ...user,
                registrationIp: user.registrationIp ? decrypt(user.registrationIp) : null,
                lastLoginIp: user.lastLoginIp ? decrypt(user.lastLoginIp) : null
            }
        });
    } catch (error) {
        console.error('Błąd decrypt-user-ip:', error);
        res.status(500).json({ error: 'Błąd serwera' });
    }
});

// GET /user-ip-history/:userId
router.get('/user-ip-history/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        
        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { id: true, email: true }
        });
        
        if (!user) {
            return res.status(404).json({ error: 'Użytkownik nie znaleziony' });
        }
        
        let logs = [];
        let total = 0;
        
        try {
            [logs, total] = await Promise.all([
                prisma.ipLog.findMany({
                    where: { userId },
                    orderBy: { createdAt: 'desc' },
                    skip: (page - 1) * limit,
                    take: limit
                }),
                prisma.ipLog.count({ where: { userId } })
            ]);
        } catch (e) {
            // Tabela może nie istnieć
        }
        
        const decryptedLogs = logs.map(log => ({
            id: log.id,
            ip: decrypt(log.encryptedIp) || '[błąd]',
            action: log.action,
            userAgent: log.userAgent,
            createdAt: log.createdAt
        }));
        
        res.json({
            success: true,
            user,
            logs: decryptedLogs,
            pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }
        });
    } catch (error) {
        console.error('Błąd user-ip-history:', error);
        res.status(500).json({ error: 'Błąd serwera' });
    }
});

// POST /decrypt-visit-ip
router.post('/decrypt-visit-ip', async (req, res) => {
    try {
        const { visitId } = req.body;
        
        if (!visitId) {
            return res.status(400).json({ error: 'ID wizyty jest wymagane' });
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
            return res.status(404).json({ error: 'Wizyta nie znaleziona' });
        }
        
        res.json({
            success: true,
            visit: {
                id: visit.id,
                ip: visit.encryptedIp ? decrypt(visit.encryptedIp) : visit.ip_address,
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
        console.error('Błąd decrypt-visit-ip:', error);
        res.status(500).json({ error: 'Błąd serwera' });
    }
});

// POST /search-by-ip
router.post('/search-by-ip', async (req, res) => {
    try {
        const { ip } = req.body;
        
        if (!ip) {
            return res.status(400).json({ error: 'Adres IP jest wymagany' });
        }
        
        const visits = await prisma.visit.findMany({
            where: { ip_address: ip },
            include: { link: { select: { userId: true } } },
            take: 100
        });
        
        const userIds = [...new Set(visits.map(v => v.link.userId))];
        
        const users = await prisma.user.findMany({
            where: { id: { in: userIds } },
            select: { id: true, email: true, isActive: true, createdAt: true }
        });
        
        res.json({
            success: true,
            searchedIp: ip,
            results: users.map(u => ({ ...u, matchType: 'visit' })),
            count: users.length
        });
    } catch (error) {
        console.error('Błąd search-by-ip:', error);
        res.status(500).json({ error: 'Błąd serwera' });
    }
});

module.exports = router;