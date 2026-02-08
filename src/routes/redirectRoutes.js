const express = require('express');
const { PrismaClient } = require('@prisma/client');
const crypto = require('crypto');
const linkService = require('../services/linkService');

const router = express.Router();
const prisma = new PrismaClient();

// Konfiguracja
const CONFIG = {
    UNIQUENESS_WINDOW_HOURS: 24,
    MAX_VISITS_PER_IP_DAILY: 50,
    RATE_LIMIT_PER_MINUTE: 10,
    CONFIRM_TIMEOUT_MINUTES: 15
};

// 🔥 Helper do hashowania IP (spójny z authController.js)
const hashIP = (ip) => {
    if (!ip || ip === 'unknown') return null;
    return crypto
        .createHash('sha256')
        .update(ip + (process.env.IP_HASH_SALT || 'angoralinks-2024'))
        .digest('hex')
        .substring(0, 32);
};

// ============================================================
// GET /:shortCode - Przekierowanie do frontendu
// ============================================================
router.get('/:shortCode', async (req, res, next) => {
    try {
        const { shortCode } = req.params;

        // Pomiń specjalne ścieżki
        if (['info', 'unlock', 'confirm-ad', 'api', 'health'].includes(shortCode)) {
            return next();
        }

        const link = await prisma.link.findUnique({
            where: { shortCode },
            select: {
                id: true,
                is_active: true,
                user: { select: { isActive: true } }
            }
        });

        if (!link) {
            return res.status(404).json({ success: false, message: 'Link nie znaleziony' });
        }

        if (!link.is_active || !link.user.isActive) {
            return res.status(410).json({ success: false, message: 'Link niedostępny' });
        }

        const frontendUrl = process.env.FRONTEND_URL || 'https://angoralinks.pl';
        res.redirect(`${frontendUrl}/l/${shortCode}`);

    } catch (error) {
        console.error('Błąd przekierowania:', error);
        res.status(500).json({ success: false, message: 'Błąd serwera' });
    }
});

// ============================================================
// GET /info/:shortCode - Informacje o linku
// ============================================================
router.get('/info/:shortCode', async (req, res) => {
    try {
        const { shortCode } = req.params;

        const link = await prisma.link.findUnique({
            where: { shortCode },
            select: {
                id: true,
                shortCode: true,
                title: true,
                description: true,
                originalUrl: true,
                is_active: true,
                createdAt: true,
                user: { select: { isActive: true } }
            }
        });

        if (!link) {
            return res.status(404).json({ success: false, message: 'Link nie znaleziony' });
        }

        if (!link.is_active || !link.user.isActive) {
            return res.status(410).json({ success: false, message: 'Link niedostępny' });
        }

        res.json({
            success: true,
            link: {
                id: link.id,
                shortCode: link.shortCode,
                title: link.title || 'Przekierowanie',
                description: link.description,
                createdAt: link.createdAt
            }
        });

    } catch (error) {
        console.error('Błąd info:', error);
        res.status(500).json({ success: false, message: 'Błąd serwera' });
    }
});

// ============================================================
// POST /unlock/:shortCode - KROK 1: Rejestracja wizyty (BEZ zarobku!)
// ============================================================
router.post('/unlock/:shortCode', async (req, res) => {
    try {
        const { shortCode } = req.params;
        const { recaptchaToken, country: clientCountry, device } = req.body;

        // Pobierz IP
        const clientIp = req.headers['x-forwarded-for']?.split(',')[0]?.trim()
            || req.socket.remoteAddress
            || 'unknown';
        const userAgent = req.headers['user-agent'] || '';
        const referer = req.headers['referer'] || null;

        // Hash IP (spójny z authController.js)
        const ipHash = hashIP(clientIp);

        // Znajdź link z danymi właściciela
        const link = await prisma.link.findUnique({
            where: { shortCode },
            include: {
                user: {
                    select: {
                        id: true,
                        isActive: true,
                        referredById: true,
                        referralDisabled: true,
                        referralBonusExpires: true,
                        registrationIp: true,    // 🔥 HASH IP rejestracji
                        lastLoginIp: true        // 🔥 HASH ostatniego logowania
                    }
                }
            }
        });

        if (!link) {
            return res.status(404).json({ success: false, message: 'Link nie znaleziony' });
        }

        if (!link.is_active) {
            return res.status(410).json({ success: false, message: 'Link wyłączony' });
        }

        if (!link.user.isActive) {
            return res.status(403).json({ success: false, message: 'Link niedostępny' });
        }

        // Weryfikacja reCAPTCHA (opcjonalnie)
        if (process.env.RECAPTCHA_SECRET && recaptchaToken) {
            const valid = await verifyRecaptcha(recaptchaToken);
            if (!valid) {
                return res.status(400).json({ success: false, message: 'Captcha nieprawidłowa' });
            }
        }

        // ========================================
        // 🔥 SELF-CLICK DETECTION
        // Blokuj tylko właściciela linka (nie wszystkich!)
        // ========================================
        const isSelfClick = (link.user.registrationIp && ipHash === link.user.registrationIp) ||
            (link.user.lastLoginIp && ipHash === link.user.lastLoginIp);

        if (isSelfClick) {
            console.log(`🚫 Self-click blocked: ${shortCode} [Owner IP: ${ipHash?.substring(0, 8)}...]`);

            // Zapisz zablokowaną wizytę (do analityki)
            await prisma.visit.create({
                data: {
                    linkId: link.id,
                    ip_address: clientIp,
                    ipHash: ipHash,
                    country: clientCountry || 'XX',
                    countryTier: 3,
                    cpmRateUsed: 0,
                    device: device || detectDevice(userAgent),
                    browser: detectBrowser(userAgent),
                    userAgent: userAgent.substring(0, 500),
                    earned: 0,
                    platformEarned: 0,
                    completed: false,
                    adDisplayed: false,
                    isUnique: false,
                    fraudBlocked: true,
                    blockReason: 'self_click'
                }
            });

            // Daj dostęp do linku, ale bez zarobku
            return res.json({
                success: true,
                redirectUrl: link.originalUrl,
                visitId: null,
                isRepeat: true,
                blocked: true,
                reason: 'self_click'
            });
        }

        // ========================================
        // FRAUD DETECTION (rate limiting)
        // ========================================
        const fraudCheck = await checkFraudLimits(ipHash);
        if (!fraudCheck.allowed) {
            console.log(`🚫 Fraud blocked: ${shortCode} [${fraudCheck.reason}]`);

            await prisma.visit.create({
                data: {
                    linkId: link.id,
                    ip_address: clientIp,
                    ipHash: ipHash,
                    country: clientCountry || 'XX',
                    countryTier: 3,
                    cpmRateUsed: 0,
                    device: device || detectDevice(userAgent),
                    browser: detectBrowser(userAgent),
                    userAgent: userAgent.substring(0, 500),
                    earned: 0,
                    platformEarned: 0,
                    completed: false,
                    adDisplayed: false,
                    isUnique: false,
                    fraudBlocked: true,
                    blockReason: fraudCheck.reason
                }
            });

            return res.json({
                success: true,
                redirectUrl: link.originalUrl,
                visitId: null,
                isRepeat: true,
                blocked: true,
                reason: fraudCheck.reason
            });
        }

        // ========================================
        // UNIQUENESS CHECK (24h na tym samym linku)
        // ========================================
        const windowStart = new Date();
        windowStart.setHours(windowStart.getHours() - CONFIG.UNIQUENESS_WINDOW_HOURS);

        const existingVisit = await prisma.visit.findFirst({
            where: {
                ipHash: ipHash,
                linkId: link.id,
                createdAt: { gte: windowStart }
            }
        });

        if (existingVisit) {
            // Powtórna wizyta - tylko licznik, bez zarobku
            await prisma.link.update({
                where: { id: link.id },
                data: { totalClicks: { increment: 1 } }
            });

            console.log(`⏭️ Repeat visit: ${shortCode} [${ipHash?.substring(0, 8)}...]`);

            return res.json({
                success: true,
                redirectUrl: link.originalUrl,
                visitId: null,
                isRepeat: true
            });
        }

        // ========================================
        // 🎉 NOWA UNIKALNA WIZYTA!
        // ========================================
        const country = (clientCountry || await getCountryFromIP(clientIp)).toUpperCase();
        const earningDetails = await linkService.getEarningDetails(country);

        // Tworzymy wizytę z earned: 0 (czekamy na /confirm-ad)
        const visit = await prisma.visit.create({
            data: {
                linkId: link.id,
                ip_address: clientIp,
                ipHash: ipHash,
                country: country,
                countryTier: earningDetails.tier,
                cpmRateUsed: earningDetails.realGrossCpm, // 🔥 Zapisujemy REALNE CPM (po korekcji)
                device: device || detectDevice(userAgent),
                browser: detectBrowser(userAgent),
                userAgent: userAgent.substring(0, 500),
                referer: referer?.substring(0, 500),
                earned: 0,              // 🔴 ZERO - czekamy na confirm-ad
                platformEarned: 0,
                completed: false,       // 🔴 Jeszcze nie ukończone
                adDisplayed: false,     // 🔴 Reklama nie wyświetlona
                isUnique: true,
                fraudBlocked: false
            }
        });

        // Aktualizuj liczniki (ale NIE zarobki!)
        await prisma.link.update({
            where: { id: link.id },
            data: {
                totalClicks: { increment: 1 },
                uniqueClicks: { increment: 1 }
            }
        });

        console.log(`🔓 New visit: ${shortCode} [${country}] Tier ${earningDetails.tier} | CPM: $${earningDetails.realGrossCpm} | ID: ${visit.id}`);

        res.json({
            success: true,
            redirectUrl: link.originalUrl,
            visitId: visit.id,      // 🔑 Frontend użyje do /confirm-ad
            isRepeat: false,
            country: country,
            tier: earningDetails.tier
        });

    } catch (error) {
        console.error('Błąd unlock:', error);
        res.status(500).json({ success: false, message: 'Błąd serwera' });
    }
});

// ============================================================
// POST /confirm-ad/:shortCode - KROK 2: Potwierdzenie reklamy = ZAROBEK!
// ============================================================
router.post('/confirm-ad/:shortCode', async (req, res) => {
    try {
        const { shortCode } = req.params;
        const { visitId } = req.body;

        if (!visitId) {
            return res.status(400).json({ success: false, message: 'Brak visitId' });
        }

        // Znajdź wizytę z danymi linka i użytkownika
        const visit = await prisma.visit.findUnique({
            where: { id: visitId },
            include: {
                link: {
                    include: {
                        user: {
                            select: {
                                id: true,
                                referredById: true,
                                referralDisabled: true,
                                referralBonusExpires: true
                            }
                        }
                    }
                }
            }
        });

        if (!visit) {
            return res.status(404).json({ success: false, message: 'Wizyta nie istnieje' });
        }

        // Sprawdź czy wizyta należy do tego linka
        if (visit.link.shortCode !== shortCode) {
            return res.status(400).json({ success: false, message: 'Nieprawidłowy link' });
        }

        // Już potwierdzone?
        if (visit.adDisplayed) {
            console.log(`⚠️ Already confirmed: ${visitId}`);
            return res.json({
                success: true,
                alreadyConfirmed: true,
                earned: parseFloat(visit.earned)
            });
        }

        // Sprawdź timeout (15 minut)
        const visitAge = Date.now() - new Date(visit.createdAt).getTime();
        if (visitAge > CONFIG.CONFIRM_TIMEOUT_MINUTES * 60 * 1000) {
            console.log(`⏰ Visit timeout: ${visitId} (${Math.round(visitAge / 1000 / 60)} min)`);

            await prisma.visit.update({
                where: { id: visitId },
                data: { blockReason: 'timeout' }
            });

            return res.status(400).json({ success: false, message: 'Sesja wygasła' });
        }

        // ========================================
        // 🔥 NALICZANIE ZAROBKU!
        // ========================================
        const commission = await linkService.getPlatformCommission();
        const realGrossCpm = parseFloat(visit.cpmRateUsed); // Już skorygowane przy /unlock

        const userEarning = (realGrossCpm * (1 - commission)) / 1000;
        const platformEarning = (realGrossCpm * commission) / 1000;

        // Data dzisiejsza dla agregacji
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        // Transakcja atomowa
        await prisma.$transaction([
            // 1. Aktualizuj wizytę
            prisma.visit.update({
                where: { id: visitId },
                data: {
                    earned: userEarning,
                    platformEarned: platformEarning,
                    adDisplayed: true,
                    completed: true
                }
            }),

            // 2. Dodaj zarobek użytkownikowi
            prisma.user.update({
                where: { id: visit.link.userId },
                data: {
                    balance: { increment: userEarning },
                    totalEarned: { increment: userEarning }
                }
            }),

            // 3. Aktualizuj statystyki linka
            prisma.link.update({
                where: { id: visit.linkId },
                data: {
                    totalEarned: { increment: userEarning }
                }
            }),

            // 4. Agregacja dzienna
            prisma.dailyEarning.upsert({
                where: {
                    userId_date_country: {
                        userId: visit.link.userId,
                        date: today,
                        country: visit.country || 'XX'
                    }
                },
                create: {
                    userId: visit.link.userId,
                    date: today,
                    country: visit.country || 'XX',
                    visits: 1,
                    uniqueVisits: 1,
                    userEarnings: userEarning,
                    platformEarnings: platformEarning
                },
                update: {
                    visits: { increment: 1 },
                    uniqueVisits: { increment: 1 },
                    userEarnings: { increment: userEarning },
                    platformEarnings: { increment: platformEarning }
                }
            })
        ]);

        // ========================================
        // PROWIZJA REFERALNA
        // ========================================
        const user = visit.link.user;
        if (user.referredById && !user.referralDisabled) {
            const bonusValid = !user.referralBonusExpires ||
                new Date(user.referralBonusExpires) > new Date();

            if (bonusValid) {
                try {
                    await processReferralCommission(
                        user.referredById,
                        user.id,
                        userEarning,
                        visitId
                    );
                } catch (refError) {
                    console.error('Referral error:', refError);
                    // Nie przerywaj - referral to bonus
                }
            }
        }

        console.log(`💰 Earning confirmed: $${userEarning.toFixed(6)} [${visit.country}] | Platform: $${platformEarning.toFixed(6)} | Link: ${shortCode}`);

        res.json({
            success: true,
            earned: userEarning,
            alreadyConfirmed: false
        });

    } catch (error) {
        console.error('Błąd confirm-ad:', error);
        res.status(500).json({ success: false, message: 'Błąd serwera' });
    }
});

// ============================================================
// FUNKCJE POMOCNICZE
// ============================================================

async function checkFraudLimits(ipHash) {
    if (!ipHash) return { allowed: true };

    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const oneMinuteAgo = new Date(now.getTime() - 60000);

    // Limit dzienny
    const visitsToday = await prisma.visit.count({
        where: {
            ipHash: ipHash,
            createdAt: { gte: today }
        }
    });

    if (visitsToday >= CONFIG.MAX_VISITS_PER_IP_DAILY) {
        return { allowed: false, reason: 'daily_limit' };
    }

    // Rate limit (na minutę)
    const recentVisits = await prisma.visit.count({
        where: {
            ipHash: ipHash,
            createdAt: { gte: oneMinuteAgo }
        }
    });

    if (recentVisits >= CONFIG.RATE_LIMIT_PER_MINUTE) {
        return { allowed: false, reason: 'rate_limit' };
    }

    return { allowed: true };
}

async function getCountryFromIP(ip) {
    if (!ip || ip === '127.0.0.1' || ip === '::1' || ip === 'unknown') {
        return 'PL'; // Domyślnie dla localhost
    }

    try {
        const fetch = (await import('node-fetch')).default;
        const response = await fetch(`http://ip-api.com/json/${ip}?fields=countryCode`, {
            timeout: 3000
        });

        if (response.ok) {
            const data = await response.json();
            if (data.countryCode) {
                return data.countryCode;
            }
        }
    } catch (error) {
        console.warn('GeoIP failed:', error.message);
    }

    return 'XX'; // Nieznany
}

function detectDevice(userAgent) {
    if (!userAgent) return 'unknown';
    userAgent = userAgent.toLowerCase();

    if (/mobile|android|iphone|ipod|blackberry|windows phone/.test(userAgent)) {
        return 'mobile';
    }
    if (/tablet|ipad/.test(userAgent)) {
        return 'tablet';
    }
    return 'desktop';
}

function detectBrowser(userAgent) {
    if (!userAgent) return 'unknown';
    userAgent = userAgent.toLowerCase();

    if (userAgent.includes('firefox')) return 'Firefox';
    if (userAgent.includes('edg')) return 'Edge';
    if (userAgent.includes('chrome')) return 'Chrome';
    if (userAgent.includes('safari')) return 'Safari';
    if (userAgent.includes('opera')) return 'Opera';
    return 'Other';
}

async function verifyRecaptcha(token) {
    if (!token || !process.env.RECAPTCHA_SECRET) return false;

    try {
        const response = await fetch('https://www.google.com/recaptcha/api/siteverify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: `secret=${process.env.RECAPTCHA_SECRET}&response=${token}`
        });

        const data = await response.json();
        return data.success;
    } catch (error) {
        console.error('reCAPTCHA error:', error);
        return false;
    }
}

async function processReferralCommission(referrerId, referredId, userEarning, visitId) {
    // Pobierz ustawienia systemu referalnego
    const settings = await prisma.systemSettings.findUnique({
        where: { id: 'settings' }
    });

    if (!settings || !settings.referralSystemActive) {
        return;
    }

    const commissionRate = parseFloat(settings.referralCommissionRate || '0.10');
    const commissionAmount = userEarning * commissionRate;

    if (commissionAmount <= 0) return;

    // Zapisz prowizję
    await prisma.referralCommission.create({
        data: {
            referrerId: referrerId,
            referredId: referredId,
            visitId: visitId,
            amount: commissionAmount,
            referredEarning: userEarning,
            commissionRate: commissionRate,
            status: 'processed',
            processedAt: new Date()
        }
    });

    // Dodaj do salda referrera
    await prisma.user.update({
        where: { id: referrerId },
        data: {
            balance: { increment: commissionAmount },
            referralEarnings: { increment: commissionAmount }
        }
    });

    console.log(`🎁 Referral commission: $${commissionAmount.toFixed(6)} -> ${referrerId.substring(0, 8)}...`);
}

module.exports = router;