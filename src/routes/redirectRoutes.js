// src/routes/redirectRoutes.js

const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { encrypt } = require('../utils/encryption');
const { getClientIp, getUserAgent, getReferer, detectDevice, detectBrowser } = require('../utils/ipHelper');
const earningsService = require('../services/earningsService');

const router = express.Router();
const prisma = new PrismaClient();

// Główny route dla skróconych linków /:shortCode
router.get('/:shortCode', async (req, res, next) => {
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
                is_active: true,
                createdAt: true,
                user: {
                    select: { isActive: true }
                }
            }
        });
        
        if (!link) {
            return res.status(404).json({ 
                success: false, 
                message: 'Link nie znaleziony' 
            });
        }

        if (!link.is_active || !link.user.isActive) {
            return res.status(410).json({ 
                success: false, 
                message: 'Ten link jest niedostępny' 
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
                is_active: true,
                createdAt: true,
                user: {
                    select: { isActive: true }
                }
            }
        });
        
        if (!link) {
            return res.status(404).json({ 
                success: false, 
                message: 'Link nie znaleziony' 
            });
        }

        if (!link.is_active || !link.user.isActive) {
            return res.status(410).json({ 
                success: false, 
                message: 'Ten link jest niedostępny' 
            });
        }
        
        res.json({
            success: true,
            link: {
                id: link.id,
                shortCode: link.shortCode,
                title: link.title,
                originalUrl: link.originalUrl,
                createdAt: link.createdAt
            }
        });
        
    } catch (error) {
        console.error('Błąd pobierania linku:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Błąd serwera' 
        });
    }
});

// Odblokuj link i zapisz wizytę - GŁÓWNA LOGIKA ZAROBKÓW
router.post('/unlock/:shortCode', async (req, res) => {
    try {
        const { shortCode } = req.params;
        const { hcaptchaToken, country, device } = req.body;
        
        // Pobierz dane klienta
        const clientIp = getClientIp(req);
        const userAgent = getUserAgent(req);
        const referer = getReferer(req);
        const detectedDevice = device || detectDevice(userAgent);
        const detectedBrowser = detectBrowser(userAgent);
        
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
        
        if (!link.is_active) {
            return res.status(410).json({ 
                success: false, 
                message: 'Ten link jest wyłączony' 
            });
        }
        
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
        
        // Zaszyfruj IP do przechowywania
        const encryptedIp = encrypt(clientIp);
        
        // ========================================
        // NOWY SYSTEM ZAROBKÓW - 85% dla użytkownika
        // ========================================
        
        const { visit, earnings } = await earningsService.recordVisit({
            linkId: link.id,
            ip: clientIp,
            encryptedIp,
            country: country || 'XX',
            device: detectedDevice,
            browser: detectedBrowser,
            userAgent,
            referer
        });
        
        // Logowanie (do debugowania - możesz wyłączyć w produkcji)
        console.log(`📊 Visit: ${shortCode} | Country: ${country || 'XX'} | ` +
                    `Unique: ${earnings.isUnique} | Earned: $${earnings.earned.toFixed(6)} | ` +
                    `Blocked: ${earnings.blocked ? earnings.blockReason : 'no'}`);
        
        res.json({
            success: true,
            message: 'Link odblokowany',
            redirectUrl: link.originalUrl,
            // Opcjonalnie - możesz nie wysyłać tych danych do klienta
            debug: process.env.NODE_ENV === 'development' ? {
                isUnique: earnings.isUnique,
                earned: earnings.earned,
                tier: earnings.tier,
                blocked: earnings.blocked
            } : undefined
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