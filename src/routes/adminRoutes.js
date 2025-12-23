// src/routes/admin/security.js

const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { decrypt, validateEncryptionKey } = require('../../utils/encryption');
const { maskIp } = require('../../utils/ipHelper');
const { auth, isAdmin } = require('../../middleware/auth');

const router = express.Router();
const prisma = new PrismaClient();

// Middleware - tylko admin
router.use(auth, isAdmin);

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
    
    // Odszyfruj IP
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
    
    // Sprawdź czy użytkownik istnieje
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
    
    // Pobierz logi IP
    const [logs, total] = await Promise.all([
      prisma.ipLog.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        skip,
        take: parseInt(limit)
      }),
      prisma.ipLog.count({ where: { userId } })
    ]);
    
    // Odszyfruj IP w logach
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
      user: {
        id: user.id,
        email: user.email
      },
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
    
    // Odszyfruj IP
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
    
    // Pobierz wszystkich użytkowników i sprawdź ich IP
    // UWAGA: To jest wolne dla dużych baz - rozważ indeksowanie
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
          createdAt: {
            gte: date,
            lt: nextDate
          }
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
    res.status(500).json({ 
      success: false, 
      message: 'Błąd serwera' 
    });
  }
});

module.exports = router;