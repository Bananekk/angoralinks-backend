// src/routes/redirect.js

const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { encrypt } = require('../utils/encryption');
const { getClientIp, getUserAgent, getReferer } = require('../utils/ipHelper');

const router = express.Router();
const prisma = new PrismaClient();

// Główny route dla skróconych linków /:shortCode
// (będzie działać jako /l/:shortCode bo w server.js masz app.use('/l', redirectRoutes))
router.get('/:shortCode', async (req, res) => {
  try {
    const { shortCode } = req.params;
    
    // Pomiń jeśli to info lub unlock
    if (shortCode === 'info' || shortCode === 'unlock') {
      return next();
    }
    
    const link = await prisma.link.findUnique({
      where: { shortCode },
      select: {
        id: true,
        shortCode: true,
        title: true,
        originalUrl: true,
        createdAt: true
      }
    });
    
    if (!link) {
      return res.status(404).json({ 
        success: false, 
        message: 'Link nie znaleziony' 
      });
    }
    
    // Przekieruj do frontendu ze stroną reklam
    const frontendUrl = process.env.FRONTEND_URL || 'https://angoralinks.pl';
    res.redirect(`${frontendUrl}/l/${shortCode}`);
    
  } catch (error) {
    console.error('Błąd przekierowania:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Błąd serwera' 
    });
  }
});

// Pobierz informacje o linku (przed reklamami)
router.get('/info/:shortCode', async (req, res) => {
  try {
    const { shortCode } = req.params;
    
    const link = await prisma.link.findUnique({
      where: { shortCode },
      select: {
        id: true,
        shortCode: true,
        title: true,
        originalUrl: true,
        createdAt: true
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
      link
    });
    
  } catch (error) {
    console.error('Błąd pobierania linku:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Błąd serwera' 
    });
  }
});

// Odblokuj link i zapisz wizytę
router.post('/unlock/:shortCode', async (req, res) => {
  try {
    const { shortCode } = req.params;
    const { hcaptchaToken, country, device } = req.body;
    
    // Pobierz IP, User-Agent i Referer
    const clientIp = getClientIp(req);
    const userAgent = getUserAgent(req);
    const referer = getReferer(req);
    
    // Znajdź link
    const link = await prisma.link.findUnique({
      where: { shortCode },
      include: {
        user: {
          select: { id: true, isActive: true }
        }
      }
    });
    
    if (!link) {
      return res.status(404).json({ 
        success: false, 
        message: 'Link nie znaleziony' 
      });
    }
    
    // Sprawdź czy właściciel linku jest aktywny
    if (!link.user.isActive) {
      return res.status(403).json({ 
        success: false, 
        message: 'Ten link jest niedostępny' 
      });
    }
    
    // Weryfikacja hCaptcha (opcjonalnie)
    if (process.env.HCAPTCHA_SECRET && hcaptchaToken) {
      const hcaptchaValid = await verifyHcaptcha(hcaptchaToken);
      if (!hcaptchaValid) {
        return res.status(400).json({ 
          success: false, 
          message: 'Weryfikacja captcha nie powiodła się' 
        });
      }
    }
    
    // Pobierz stawkę CPM dla kraju
    const countryCode = country || 'XX';
    const cpmRate = await prisma.cpmRate.findUnique({
      where: { countryCode }
    });
    
    // Oblicz zarobek (CPM / 1000)
    const rate = cpmRate?.cpmRate || 0.10; // Domyślna stawka
    const earned = parseFloat(rate) / 1000;
    
    // Zaszyfruj IP
    const encryptedIp = encrypt(clientIp);
    
    // Zapisz wizytę
    const visit = await prisma.visit.create({
      data: {
        linkId: link.id,
        country: countryCode,
        device: device || 'desktop',
        earned,
        encryptedIp,
        ip_address: encryptedIp,
        userAgent: userAgent.substring(0, 500),
        referer: referer?.substring(0, 500)
      }
    });
    
    // Aktualizuj statystyki linku
    await prisma.link.update({
      where: { id: link.id },
      data: {
        totalClicks: { increment: 1 },
        totalEarned: { increment: earned }
      }
    });
    
    // Aktualizuj saldo użytkownika (właściciela linku)
    await prisma.user.update({
      where: { id: link.user.id },
      data: {
        balance: { increment: earned },
        totalEarned: { increment: earned }
      }
    });
    
    res.json({
      success: true,
      message: 'Link odblokowany',
      redirectUrl: link.originalUrl
    });
    
  } catch (error) {
    console.error('Błąd odblokowywania linku:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Błąd serwera' 
    });
  }
});

// Pomocnicza funkcja weryfikacji hCaptcha
async function verifyHcaptcha(token) {
  try {
    const response = await fetch('https://hcaptcha.com/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `secret=${process.env.HCAPTCHA_SECRET}&response=${token}`
    });
    
    const data = await response.json();
    return data.success;
  } catch (error) {
    console.error('Błąd weryfikacji hCaptcha:', error);
    return false;
  }
}

module.exports = router;