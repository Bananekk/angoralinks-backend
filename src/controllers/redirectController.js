const { PrismaClient } = require('@prisma/client');
const linkService = require('../services/linkService');

const prisma = new PrismaClient();

class RedirectController {

    // GET /api/redirect/:shortCode - Pobierz info o linku
    async showAdPage(req, res) {
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
                    user: {
                        select: { isActive: true }
                    }
                }
            });

            if (!link) {
                return res.status(404).json({
                    success: false,
                    error: 'Link nie znaleziony'
                });
            }

            if (!link.is_active || !link.user.isActive) {
                return res.status(410).json({
                    success: false,
                    error: 'Link jest niedostępny'
                });
            }

            res.json({
                success: true,
                link: {
                    shortCode: link.shortCode,
                    title: link.title || 'Przekierowanie',
                    description: link.description,
                    createdAt: link.createdAt
                }
            });

        } catch (error) {
            console.error('Błąd pobierania linka:', error);
            res.status(500).json({ success: false, error: 'Błąd serwera' });
        }
    }

    // POST /api/redirect/:shortCode/unlock - KROK 1: Rejestracja wizyty (bez zarobku)
    async unlock(req, res) {
        try {
            const { shortCode } = req.params;
            const { recaptchaToken, country: clientCountry } = req.body;

            const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim()
                || req.socket.remoteAddress
                || 'unknown';
            const userAgent = req.headers['user-agent'] || '';
            const referer = req.headers['referer'] || null;

            // Znajdź link
            const link = await prisma.link.findUnique({
                where: { shortCode },
                include: {
                    user: {
                        select: {
                            id: true,
                            isActive: true,
                            referredById: true,
                            referralDisabled: true,
                            referralBonusExpires: true
                        }
                    }
                }
            });

            if (!link) {
                return res.status(404).json({ success: false, error: 'Link nie znaleziony' });
            }

            if (!link.is_active) {
                return res.status(410).json({ success: false, error: 'Link jest wyłączony' });
            }

            if (!link.user.isActive) {
                return res.status(403).json({ success: false, error: 'Link jest niedostępny' });
            }

            // Weryfikacja reCAPTCHA (opcjonalnie)
            if (process.env.RECAPTCHA_SECRET && recaptchaToken) {
                const recaptchaValid = await this.verifyRecaptcha(recaptchaToken);
                if (!recaptchaValid) {
                    return res.status(400).json({
                        success: false,
                        error: 'Weryfikacja captcha nie powiodła się'
                    });
                }
            }

            // Hash IP dla prywatności
            const crypto = require('crypto');
            const ipHash = crypto.createHash('sha256')
                .update(ip + (process.env.IP_SALT || 'angora-salt-2024'))
                .digest('hex');

            // Sprawdź czy wizyta jest unikalna (24h)
            const existingVisit = await prisma.visit.findFirst({
                where: {
                    linkId: link.id,
                    ipHash: ipHash,
                    createdAt: {
                        gte: new Date(Date.now() - 24 * 60 * 60 * 1000)
                    }
                }
            });

            if (existingVisit) {
                // Powtórna wizyta - tylko licznik
                await prisma.link.update({
                    where: { id: link.id },
                    data: { totalClicks: { increment: 1 } }
                });

                console.log(`⏭️ Powtórna wizyta: ${shortCode} [${ipHash.substring(0, 8)}...]`);

                return res.json({
                    success: true,
                    redirectUrl: link.originalUrl,
                    visitId: null,
                    isRepeat: true,
                    message: 'Powtórna wizyta - przekierowanie'
                });
            }

            // Pobierz kraj z IP lub użyj podanego przez klienta
            const country = clientCountry || await this.getCountryFromIP(ip);

            // Pobierz szczegóły zarobków (z korekcją!)
            const earningDetails = await linkService.getEarningDetails(country);

            // Zaszyfruj IP do przechowywania (RODO)
            let encryptedIp = null;
            try {
                const { encrypt } = require('../utils/encryption');
                encryptedIp = encrypt(ip);
            } catch (e) {
                // Jeśli szyfrowanie nie dostępne, zapisz hash
                encryptedIp = ipHash;
            }

            // KROK 1: Tworzymy wizytę BEZ zarobku
            const visit = await prisma.visit.create({
                data: {
                    linkId: link.id,
                    ip_address: ip,
                    ipHash: ipHash,
                    encryptedIp: encryptedIp,
                    country: country,
                    countryTier: earningDetails.tier,
                    cpmRateUsed: earningDetails.realGrossCpm, // Zapisujemy REALNE CPM (po korekcji)
                    device: linkService.detectDevice(userAgent),
                    browser: linkService.detectBrowser(userAgent),
                    userAgent: userAgent.substring(0, 500),
                    referer: referer?.substring(0, 500),
                    earned: 0,              // ZERO - czekamy na potwierdzenie
                    platformEarned: 0,
                    completed: false,
                    adDisplayed: false,     // Jeszcze nie wyświetlono reklamy
                    isUnique: true,
                    fraudBlocked: false
                }
            });

            // Aktualizuj liczniki
            await prisma.link.update({
                where: { id: link.id },
                data: {
                    totalClicks: { increment: 1 },
                    uniqueClicks: { increment: 1 }
                }
            });

            console.log(`🔓 Nowa wizyta: ${shortCode} [${country}] Tier ${earningDetails.tier} - czekam na reklamę`);

            res.json({
                success: true,
                redirectUrl: link.originalUrl,
                visitId: visit.id,      // Frontend użyje tego do potwierdzenia
                isRepeat: false,
                country: country,
                tier: earningDetails.tier
            });

        } catch (error) {
            console.error('Błąd odblokowywania:', error);
            res.status(500).json({ success: false, error: 'Błąd serwera' });
        }
    }

    // POST /api/redirect/:shortCode/confirm-ad - KROK 2: Naliczenie zarobku
    async confirmAdDisplayed(req, res) {
        try {
            const { shortCode } = req.params;
            const { visitId, adType } = req.body;

            if (!visitId) {
                return res.status(400).json({ success: false, error: 'Brak visitId' });
            }

            // Znajdź wizytę
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
                return res.status(404).json({ success: false, error: 'Wizyta nie istnieje' });
            }

            // Sprawdź czy wizyta należy do tego linka
            if (visit.link.shortCode !== shortCode) {
                return res.status(400).json({ success: false, error: 'Nieprawidłowy link' });
            }

            // Już potwierdzone?
            if (visit.adDisplayed) {
                console.log(`⚠️ Już potwierdzone: ${visitId}`);
                return res.json({
                    success: true,
                    alreadyConfirmed: true,
                    earned: parseFloat(visit.earned)
                });
            }

            // Sprawdź czy nie za stare (max 15 minut)
            const visitAge = Date.now() - new Date(visit.createdAt).getTime();
            if (visitAge > 15 * 60 * 1000) {
                console.log(`⏰ Wizyta wygasła: ${visitId} (${Math.round(visitAge / 1000 / 60)} min)`);
                return res.status(400).json({ success: false, error: 'Wizyta wygasła' });
            }

            // KROK 2: Naliczamy zarobek!
            const commission = await linkService.getPlatformCommission();
            const realGrossCpm = parseFloat(visit.cpmRateUsed); // Już skorygowane!

            const userEarning = (realGrossCpm * (1 - commission)) / 1000;
            const platformEarning = (realGrossCpm * commission) / 1000;

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
                })
            ]);

            // Obsługa prowizji referalnej
            const user = visit.link.user;
            if (user.referredById && !user.referralDisabled) {
                // Sprawdź czy bonus nie wygasł
                const bonusValid = !user.referralBonusExpires ||
                    new Date(user.referralBonusExpires) > new Date();

                if (bonusValid) {
                    await this.processReferralCommission(
                        user.referredById,
                        user.id,
                        userEarning,
                        visitId
                    );
                }
            }

            console.log(`💰 Zarobek: $${userEarning.toFixed(6)} [${visit.country}] | Platform: $${platformEarning.toFixed(6)}`);

            res.json({
                success: true,
                earned: userEarning,
                alreadyConfirmed: false
            });

        } catch (error) {
            console.error('Błąd potwierdzania reklamy:', error);
            res.status(500).json({ success: false, error: 'Błąd serwera' });
        }
    }

    // Pomocnicza: Prowizja referalna
    async processReferralCommission(referrerId, referredId, userEarning, visitId) {
        try {
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

            console.log(`🎁 Prowizja referalna: $${commissionAmount.toFixed(6)} -> ${referrerId.substring(0, 8)}...`);

        } catch (error) {
            console.error('Błąd prowizji referalnej:', error);
        }
    }

    // Pomocnicza: Pobierz kraj z IP
    async getCountryFromIP(ip) {
        if (ip === '127.0.0.1' || ip === '::1' || ip === 'unknown') {
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
            console.warn('GeoIP lookup failed:', error.message);
        }

        return 'XX'; // Nieznany
    }

    // Pomocnicza: Weryfikacja reCAPTCHA
    async verifyRecaptcha(token) {
        try {
            const response = await fetch('https://www.google.com/recaptcha/api/siteverify', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: `secret=${process.env.RECAPTCHA_SECRET}&response=${token}`
            });

            const data = await response.json();
            return data.success;
        } catch (error) {
            console.error('Błąd reCAPTCHA:', error);
            return false;
        }
    }
}

module.exports = { redirectController: new RedirectController() };