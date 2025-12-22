const { PrismaClient } = require('@prisma/client');
const linkService = require('../services/linkService');

const prisma = new PrismaClient();

class RedirectController {
    // GET /l/:shortCode
    async showAdPage(req, res) {
        try {
            const { shortCode } = req.params;

            const link = await prisma.link.findUnique({
                where: { shortCode }
            });

            if (!link || !link.isActive) {
                return res.status(404).json({
                    error: 'Link nie istnieje lub został wyłączony'
                });
            }

            res.json({
                shortCode: link.shortCode,
                title: link.title || 'Przekierowanie',
                description: link.description,
                captchaRequired: true
            });

        } catch (error) {
            console.error('Błąd pobierania linka:', error);
            res.status(500).json({ error: 'Błąd serwera' });
        }
    }

    // POST /l/:shortCode/unlock
    async unlock(req, res) {
        try {
            const { shortCode } = req.params;
            const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress || 'unknown';
            const userAgent = req.headers['user-agent'] || '';

            const link = await prisma.link.findUnique({
                where: { shortCode },
                include: { user: true }
            });

            if (!link || !link.isActive) {
                return res.status(404).json({ error: 'Link nie istnieje' });
            }

            // Sprawdź czy ten IP już nie odwiedził w ciągu 24h
            const existingVisit = await prisma.visit.findFirst({
                where: {
                    linkId: link.id,
                    ipAddress: ip,
                    createdAt: {
                        gte: new Date(Date.now() - 24 * 60 * 60 * 1000)
                    }
                }
            });

            let userEarned = 0;

            if (!existingVisit) {
                // Pobierz kraj z IP (na razie domyślnie PL, później dodamy GeoIP)
                const country = await this.getCountryFromIP(ip);
                
                // 🔥 Oblicz zarobek używając nowego systemu CPM
                userEarned = await linkService.calculateEarning(country);

                // Zapisz wizytę
                await prisma.visit.create({
                    data: {
                        linkId: link.id,
                        ipAddress: ip,
                        country: country,
                        device: linkService.detectDevice(userAgent),
                        browser: linkService.detectBrowser(userAgent),
                        earned: userEarned,
                        completed: true
                    }
                });

                // Aktualizuj statystyki linku
                await prisma.link.update({
                    where: { id: link.id },
                    data: {
                        totalClicks: { increment: 1 },
                        totalEarned: { increment: userEarned }
                    }
                });

                // Aktualizuj balance użytkownika
                await prisma.user.update({
                    where: { id: link.userId },
                    data: {
                        balance: { increment: userEarned },
                        totalEarned: { increment: userEarned }
                    }
                });

                console.log(`✅ Nowa wizyta: ${country} -> $${userEarned.toFixed(6)} dla użytkownika ${link.userId}`);
            } else {
                // Powtórna wizyta - tylko zwiększ licznik kliknięć (bez zarobku)
                await prisma.link.update({
                    where: { id: link.id },
                    data: {
                        totalClicks: { increment: 1 }
                    }
                });

                console.log(`⏭️ Powtórna wizyta z IP: ${ip} (bez zarobku)`);
            }

            res.json({
                success: true,
                url: link.originalUrl,
                earned: userEarned
            });

        } catch (error) {
            console.error('Błąd odblokowania:', error);
            res.status(500).json({ error: 'Błąd serwera' });
        }
    }

    // Pobierz kraj z IP (placeholder - później dodamy prawdziwe GeoIP)
    async getCountryFromIP(ip) {
        // TODO: Zintegrować z prawdziwym serwisem GeoIP
        // Na razie próbujemy prostą logikę lub zwracamy domyślny kraj
        
        // Jeśli to localhost/development
        if (ip === '127.0.0.1' || ip === '::1' || ip === 'unknown') {
            return 'PL'; // Domyślnie Polska dla testów
        }

        try {
            // Próba użycia darmowego API (ip-api.com - max 45 req/min)
            const fetch = (await import('node-fetch')).default;
            const response = await fetch(`http://ip-api.com/json/${ip}?fields=countryCode`);
            
            if (response.ok) {
                const data = await response.json();
                if (data.countryCode) {
                    return data.countryCode;
                }
            }
        } catch (error) {
            console.warn('GeoIP lookup failed:', error.message);
        }

        return 'XX'; // Nieznany kraj
    }

    // GET /l/:shortCode/earnings-preview
    async getEarningsPreview(req, res) {
        try {
            const { shortCode } = req.params;
            const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress || 'unknown';

            const link = await prisma.link.findUnique({
                where: { shortCode }
            });

            if (!link || !link.isActive) {
                return res.status(404).json({ error: 'Link nie istnieje' });
            }

            const country = await this.getCountryFromIP(ip);
            const earningDetails = await linkService.getEarningDetails(country);

            res.json({
                success: true,
                country: earningDetails.countryCode,
                tier: earningDetails.tier,
                potentialEarning: earningDetails.earningPerClick
            });

        } catch (error) {
            console.error('Błąd pobierania preview zarobków:', error);
            res.status(500).json({ error: 'Błąd serwera' });
        }
    }
}

module.exports = { redirectController: new RedirectController() };