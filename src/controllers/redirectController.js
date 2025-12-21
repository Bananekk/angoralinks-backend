const { PrismaClient } = require('@prisma/client');
const linkService = require('../services/linkService');

const prisma = new PrismaClient();

const PLATFORM_FEE = 0.15;
const USER_SHARE = 1 - PLATFORM_FEE;

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
            const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
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

            let totalEarned = 0;
            let userEarned = 0;

            if (!existingVisit) {
                const country = 'PL';
                totalEarned = linkService.calculateEarning(country);
                userEarned = totalEarned * USER_SHARE;

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

                await prisma.link.update({
                    where: { id: link.id },
                    data: {
                        totalClicks: { increment: 1 },
                        totalEarned: { increment: userEarned }
                    }
                });

                await prisma.user.update({
                    where: { id: link.userId },
                    data: {
                        balance: { increment: userEarned },
                        totalEarned: { increment: userEarned }
                    }
                });
            } else {
                await prisma.link.update({
                    where: { id: link.id },
                    data: {
                        totalClicks: { increment: 1 }
                    }
                });
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
}

module.exports = { redirectController: new RedirectController() };