const { PrismaClient } = require('@prisma/client');
const { Resend } = require('resend');
const twoFactorService = require('../services/twoFactorService');

const prisma = new PrismaClient();
const resend = new Resend(process.env.RESEND_API_KEY);

// Prowizja platformy
const PLATFORM_FEE = 0.15;

class AdminController {
    // GET /api/admin/stats - statystyki platformy
    async platformStats(req, res) {
        try {
            // Liczba użytkowników
            const totalUsers = await prisma.user.count();
            
            // Liczba linków
            const totalLinks = await prisma.link.count();
            
            // Wszystkie wizyty
            const totalVisits = await prisma.visit.count();
            
            // Suma zarobków użytkowników
            const usersEarnings = await prisma.user.aggregate({
                _sum: { totalEarned: true }
            });
            
            // Oblicz zarobek platformy (15% z całości)
            const totalUserEarnings = parseFloat(usersEarnings._sum.totalEarned || 0);
            const platformEarnings = (totalUserEarnings / (1 - PLATFORM_FEE)) * PLATFORM_FEE;
            
            // Dzisiejsze statystyki
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            
            const todayVisits = await prisma.visit.count({
                where: { createdAt: { gte: today } }
            });
            
            const todayEarnings = await prisma.visit.aggregate({
                where: { createdAt: { gte: today } },
                _sum: { earned: true }
            });
            
            // Nowi użytkownicy dzisiaj
            const newUsersToday = await prisma.user.count({
                where: { createdAt: { gte: today } }
            });
            
            // Statystyki z ostatnich 7 dni
            const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
            
            const recentVisits = await prisma.visit.findMany({
                where: { createdAt: { gte: sevenDaysAgo } },
                select: { createdAt: true, earned: true }
            });
            
            // Grupuj po dniach
            const dailyStats = {};
            for (let i = 6; i >= 0; i--) {
                const date = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
                const dateKey = date.toISOString().split('T')[0];
                dailyStats[dateKey] = { visits: 0, earned: 0 };
            }
            
            recentVisits.forEach(visit => {
                const dateKey = visit.createdAt.toISOString().split('T')[0];
                if (dailyStats[dateKey]) {
                    dailyStats[dateKey].visits += 1;
                    dailyStats[dateKey].earned += parseFloat(visit.earned);
                }
            });

            // Statystyki 2FA
            const twoFactorStats = await prisma.user.groupBy({
                by: ['twoFactorEnabled'],
                _count: true
            });

            const usersWithTwoFactor = twoFactorStats.find(s => s.twoFactorEnabled)?._count || 0;
            const usersWithoutTwoFactor = twoFactorStats.find(s => !s.twoFactorEnabled)?._count || 0;

            res.json({
                users: {
                    total: totalUsers,
                    newToday: newUsersToday,
                    withTwoFactor: usersWithTwoFactor,
                    withoutTwoFactor: usersWithoutTwoFactor
                },
                links: {
                    total: totalLinks
                },
                visits: {
                    total: totalVisits,
                    today: todayVisits
                },
                earnings: {
                    usersTotal: totalUserEarnings,
                    platformTotal: platformEarnings,
                    today: parseFloat(todayEarnings._sum.earned || 0)
                },
                dailyStats: Object.entries(dailyStats).map(([date, stats]) => ({
                    date,
                    visits: stats.visits,
                    earned: parseFloat(stats.earned.toFixed(4))
                }))
            });

        } catch (error) {
            console.error('Błąd statystyk admina:', error);
            res.status(500).json({ error: 'Błąd serwera' });
        }
    }

    // GET /api/admin/users - lista użytkowników (z informacjami o 2FA)
    async listUsers(req, res) {
        try {
            const { page = 1, limit = 20, twoFactorFilter } = req.query;
            const skip = (parseInt(page) - 1) * parseInt(limit);

            // Filtr 2FA
            let where = {};
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
                    orderBy: { createdAt: 'desc' },
                    skip,
                    take: parseInt(limit),
                    select: {
                        id: true,
                        email: true,
                        balance: true,
                        totalEarned: true,
                        isVerified: true,
                        isActive: true,
                        isAdmin: true,
                        createdAt: true,
                        lastLoginAt: true,
                        // Pola 2FA
                        twoFactorEnabled: true,
                        twoFactorMethod: true,
                        twoFactorRequired: true,
                        twoFactorEnabledAt: true,
                        twoFactorLastUsedAt: true,
                        _count: {
                            select: { 
                                links: true,
                                webAuthnCredentials: true,
                                backupCodes: true
                            }
                        }
                    }
                }),
                prisma.user.count({ where })
            ]);

            // Pobierz liczbę niewykorzystanych backup codes dla każdego użytkownika
            const usersWithBackupInfo = await Promise.all(
                users.map(async (user) => {
                    const unusedBackupCodes = await prisma.backupCode.count({
                        where: {
                            userId: user.id,
                            usedAt: null
                        }
                    });

                    return {
                        id: user.id,
                        email: user.email,
                        balance: parseFloat(user.balance),
                        totalEarned: parseFloat(user.totalEarned),
                        isVerified: user.isVerified,
                        isActive: user.isActive,
                        isAdmin: user.isAdmin,
                        linksCount: user._count.links,
                        createdAt: user.createdAt,
                        lastLoginAt: user.lastLoginAt,
                        // Dane 2FA
                        twoFactor: {
                            enabled: user.twoFactorEnabled,
                            methods: user.twoFactorMethod,
                            required: user.twoFactorRequired,
                            enabledAt: user.twoFactorEnabledAt,
                            lastUsedAt: user.twoFactorLastUsedAt,
                            webAuthnCount: user._count.webAuthnCredentials,
                            backupCodesRemaining: unusedBackupCodes,
                            backupCodesTotal: user._count.backupCodes
                        }
                    };
                })
            );

            res.json({
                users: usersWithBackupInfo,
                total,
                pagination: {
                    page: parseInt(page),
                    limit: parseInt(limit),
                    pages: Math.ceil(total / parseInt(limit))
                }
            });

        } catch (error) {
            console.error('Błąd pobierania użytkowników:', error);
            res.status(500).json({ error: 'Błąd serwera' });
        }
    }

    // PUT /api/admin/users/:id - edycja użytkownika
    async updateUser(req, res) {
        try {
            const { id } = req.params;
            const { isActive, isAdmin, balance } = req.body;

            const user = await prisma.user.findUnique({ where: { id } });
            
            if (!user) {
                return res.status(404).json({ error: 'Użytkownik nie znaleziony' });
            }

            const updatedUser = await prisma.user.update({
                where: { id },
                data: {
                    isActive: isActive !== undefined ? isActive : user.isActive,
                    isAdmin: isAdmin !== undefined ? isAdmin : user.isAdmin,
                    balance: balance !== undefined ? balance : user.balance
                }
            });

            res.json({
                message: 'Użytkownik zaktualizowany',
                user: {
                    id: updatedUser.id,
                    email: updatedUser.email,
                    isActive: updatedUser.isActive,
                    isAdmin: updatedUser.isAdmin,
                    balance: parseFloat(updatedUser.balance)
                }
            });

        } catch (error) {
            console.error('Błąd aktualizacji użytkownika:', error);
            res.status(500).json({ error: 'Błąd serwera' });
        }
    }

    // DELETE /api/admin/users/:id - usuwanie użytkownika
    async deleteUser(req, res) {
        try {
            const { id } = req.params;

            const user = await prisma.user.findUnique({ where: { id } });
            
            if (!user) {
                return res.status(404).json({ error: 'Użytkownik nie znaleziony' });
            }

            if (user.isAdmin) {
                return res.status(403).json({ error: 'Nie można usunąć admina' });
            }

            await prisma.user.delete({ where: { id } });

            res.json({ message: 'Użytkownik usunięty' });

        } catch (error) {
            console.error('Błąd usuwania użytkownika:', error);
            res.status(500).json({ error: 'Błąd serwera' });
        }
    }

    // GET /api/admin/links - lista wszystkich linków
    async listLinks(req, res) {
        try {
            const links = await prisma.link.findMany({
                orderBy: { createdAt: 'desc' },
                include: {
                    user: {
                        select: { email: true }
                    }
                }
            });

            res.json({
                links: links.map(link => ({
                    id: link.id,
                    shortCode: link.shortCode,
                    originalUrl: link.originalUrl,
                    title: link.title,
                    userEmail: link.user.email,
                    totalClicks: link.totalClicks,
                    totalEarned: parseFloat(link.totalEarned),
                    isActive: link.isActive,
                    createdAt: link.createdAt
                })),
                total: links.length
            });

        } catch (error) {
            console.error('Błąd pobierania linków:', error);
            res.status(500).json({ error: 'Błąd serwera' });
        }
    }

    // DELETE /api/admin/links/:id - usuwanie linka
    async deleteLink(req, res) {
        try {
            const { id } = req.params;

            const link = await prisma.link.findUnique({ where: { id } });
            
            if (!link) {
                return res.status(404).json({ error: 'Link nie znaleziony' });
            }

            await prisma.link.delete({ where: { id } });

            res.json({ message: 'Link usunięty' });

        } catch (error) {
            console.error('Błąd usuwania linka:', error);
            res.status(500).json({ error: 'Błąd serwera' });
        }
    }

    // ============================================
    // === ZARZĄDZANIE WYPŁATAMI (PAYOUTS) ===
    // ============================================

    // GET /api/admin/payouts - lista wszystkich wypłat
    async listPayouts(req, res) {
        try {
            const payouts = await prisma.payout.findMany({
                orderBy: { createdAt: 'desc' },
                include: {
                    user: {
                        select: { email: true }
                    }
                }
            });

            res.json({
                payouts: payouts.map(p => ({
                    id: p.id,
                    userEmail: p.user.email,
                    amount: parseFloat(p.amount),
                    method: p.method,
                    address: p.address,
                    status: p.status,
                    createdAt: p.createdAt,
                    processedAt: p.processedAt
                }))
            });

        } catch (error) {
            console.error('Błąd pobierania wypłat:', error);
            res.status(500).json({ error: 'Błąd serwera' });
        }
    }

    // PUT /api/admin/payouts/:id - zmień status wypłaty
    async updatePayout(req, res) {
        try {
            const { id } = req.params;
            const { status } = req.body;

            if (!['PENDING', 'PROCESSING', 'COMPLETED', 'REJECTED'].includes(status)) {
                return res.status(400).json({ error: 'Nieprawidłowy status' });
            }

            const payout = await prisma.payout.findUnique({
                where: { id }
            });

            if (!payout) {
                return res.status(404).json({ error: 'Wypłata nie znaleziona' });
            }

            // Jeśli odrzucona - zwróć saldo
            if (status === 'REJECTED' && payout.status !== 'REJECTED') {
                await prisma.$transaction([
                    prisma.payout.update({
                        where: { id },
                        data: { 
                            status,
                            processedAt: new Date()
                        }
                    }),
                    prisma.user.update({
                        where: { id: payout.userId },
                        data: {
                            balance: { increment: parseFloat(payout.amount) }
                        }
                    })
                ]);
            } else {
                await prisma.payout.update({
                    where: { id },
                    data: { 
                        status,
                        processedAt: status === 'COMPLETED' ? new Date() : null
                    }
                });
            }

            res.json({ message: 'Status wypłaty zaktualizowany' });

        } catch (error) {
            console.error('Błąd aktualizacji wypłaty:', error);
            res.status(500).json({ error: 'Błąd serwera' });
        }
    }

    // ============================================
    // === ZARZĄDZANIE 2FA UŻYTKOWNIKÓW ===
    // ============================================

    // POST /api/admin/users/:id/recommend-2fa - wyślij email z zaleceniem 2FA
    async recommendTwoFactor(req, res) {
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
                return res.status(404).json({ error: 'Użytkownik nie znaleziony' });
            }

            if (!user.isActive) {
                return res.status(400).json({ error: 'Użytkownik jest nieaktywny' });
            }

            if (user.twoFactorEnabled) {
                return res.status(400).json({ error: 'Użytkownik ma już włączone 2FA' });
            }

            // Wyślij email
            await resend.emails.send({
                from: 'AngoraLinks <security@angoralinks.pl>',
                to: user.email,
                subject: 'Zalecenie włączenia dwuskładnikowego uwierzytelniania',
                html: `
                    <!DOCTYPE html>
                    <html>
                    <head>
                        <meta charset="utf-8">
                        <style>
                            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; }
                            .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
                            .content { background: #f9fafb; padding: 30px; border-radius: 0 0 8px 8px; }
                            .button { display: inline-block; background: #667eea; color: white; padding: 12px 30px; text-decoration: none; border-radius: 6px; margin: 20px 0; }
                            .benefits { background: white; padding: 20px; border-radius: 8px; margin: 20px 0; }
                            .benefit { margin: 10px 0; padding-left: 25px; position: relative; }
                            .benefit:before { content: "✅"; position: absolute; left: 0; }
                        </style>
                    </head>
                    <body>
                        <div class="header">
                            <h1>🔐 Zwiększ bezpieczeństwo konta</h1>
                        </div>
                        <div class="content">
                            <p>Cześć!</p>
                            
                            <p>Zalecamy włączenie <strong>dwuskładnikowego uwierzytelniania (2FA)</strong> na Twoim koncie AngoraLinks.</p>
                            
                            <div class="benefits">
                                <h3>Korzyści z 2FA:</h3>
                                <div class="benefit">Ochrona przed nieautoryzowanym dostępem</div>
                                <div class="benefit">Bezpieczeństwo nawet gdy hasło wycieknie</div>
                                <div class="benefit">Wsparcie dla aplikacji authenticator i kluczy sprzętowych</div>
                                <div class="benefit">Kody zapasowe na wypadek utraty urządzenia</div>
                            </div>
                            
                            <p>Konfiguracja zajmuje tylko minutę:</p>
                            
                            <a href="https://angoralinks.pl/settings/security" class="button">
                                Włącz 2FA teraz →
                            </a>
                            
                            <p style="color: #666; font-size: 14px;">
                                Jeśli masz pytania dotyczące bezpieczeństwa konta, skontaktuj się z nami.
                            </p>
                        </div>
                    </body>
                    </html>
                `
            });

            // Zapisz log
            await prisma.twoFactorLog.create({
                data: {
                    userId: id,
                    action: 'ADMIN_REQUIRED',
                    success: true,
                    ipAddress: req.ip,
                    userAgent: req.headers['user-agent']
                }
            });

            res.json({ 
                success: true,
                message: 'Email z zaleceniem 2FA został wysłany' 
            });

        } catch (error) {
            console.error('Błąd wysyłania zalecenia 2FA:', error);
            res.status(500).json({ error: 'Błąd serwera' });
        }
    }

    // POST /api/admin/users/:id/require-2fa - wymuś 2FA dla użytkownika
    async requireTwoFactor(req, res) {
        try {
            const { id } = req.params;
            const adminId = req.user.id;

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
                return res.status(404).json({ error: 'Użytkownik nie znaleziony' });
            }

            if (user.twoFactorRequired) {
                return res.status(400).json({ error: '2FA jest już wymagane dla tego użytkownika' });
            }

            // Ustaw wymóg 2FA
            await twoFactorService.requireTwoFactor(id, adminId);

            // Wyślij email informacyjny
            await resend.emails.send({
                from: 'AngoraLinks <security@angoralinks.pl>',
                to: user.email,
                subject: '⚠️ Wymagane dwuskładnikowe uwierzytelnianie',
                html: `
                    <!DOCTYPE html>
                    <html>
                    <head>
                        <meta charset="utf-8">
                        <style>
                            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; }
                            .header { background: #dc2626; color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
                            .content { background: #f9fafb; padding: 30px; border-radius: 0 0 8px 8px; }
                            .button { display: inline-block; background: #667eea; color: white; padding: 12px 30px; text-decoration: none; border-radius: 6px; margin: 20px 0; }
                            .warning { background: #fef3c7; border-left: 4px solid #f59e0b; padding: 15px; margin: 20px 0; border-radius: 0 8px 8px 0; }
                        </style>
                    </head>
                    <body>
                        <div class="header">
                            <h1>⚠️ Wymagane działanie</h1>
                        </div>
                        <div class="content">
                            <p>Cześć!</p>
                            
                            <div class="warning">
                                <strong>Administrator wymagał włączenia dwuskładnikowego uwierzytelniania (2FA) na Twoim koncie.</strong>
                            </div>
                            
                            <p>Przy następnym logowaniu będziesz musiał(a) skonfigurować 2FA, aby kontynuować korzystanie z AngoraLinks.</p>
                            
                            <p>Możesz to zrobić teraz:</p>
                            
                            <a href="https://angoralinks.pl/settings/security" class="button">
                                Skonfiguruj 2FA →
                            </a>
                            
                            <p><strong>Dostępne metody:</strong></p>
                            <ul>
                                <li>📱 Aplikacja Authenticator (Google Authenticator, Authy)</li>
                                <li>🔑 Klucz sprzętowy (YubiKey)</li>
                                <li>👆 Biometria urządzenia (Face ID, Touch ID, Windows Hello)</li>
                            </ul>
                            
                            <p style="color: #666; font-size: 14px;">
                                Jeśli masz pytania, skontaktuj się z supportem.
                            </p>
                        </div>
                    </body>
                    </html>
                `
            });

            res.json({ 
                success: true,
                message: '2FA zostało wymuszone dla użytkownika' 
            });

        } catch (error) {
            console.error('Błąd wymuszania 2FA:', error);
            res.status(500).json({ error: 'Błąd serwera' });
        }
    }

    // DELETE /api/admin/users/:id/require-2fa - usuń wymóg 2FA
    async removeRequireTwoFactor(req, res) {
        try {
            const { id } = req.params;

            const user = await prisma.user.findUnique({
                where: { id },
                select: { twoFactorRequired: true }
            });

            if (!user) {
                return res.status(404).json({ error: 'Użytkownik nie znaleziony' });
            }

            if (!user.twoFactorRequired) {
                return res.status(400).json({ error: '2FA nie jest wymagane dla tego użytkownika' });
            }

            await twoFactorService.removeRequireTwoFactor(id);

            res.json({ 
                success: true,
                message: 'Wymóg 2FA został usunięty' 
            });

        } catch (error) {
            console.error('Błąd usuwania wymogu 2FA:', error);
            res.status(500).json({ error: 'Błąd serwera' });
        }
    }

    // POST /api/admin/users/:id/reset-2fa - resetuj 2FA użytkownika
    async resetTwoFactor(req, res) {
        try {
            const { id } = req.params;
            const adminId = req.user.id;
            const { sendEmail = true } = req.body;

            const user = await prisma.user.findUnique({
                where: { id },
                select: {
                    email: true,
                    twoFactorEnabled: true
                }
            });

            if (!user) {
                return res.status(404).json({ error: 'Użytkownik nie znaleziony' });
            }

            if (!user.twoFactorEnabled) {
                return res.status(400).json({ error: 'Użytkownik nie ma włączonego 2FA' });
            }

            // Resetuj 2FA
            await twoFactorService.adminResetTwoFactor(id, adminId);

            // Wyślij email informacyjny
            if (sendEmail) {
                await resend.emails.send({
                    from: 'AngoraLinks <security@angoralinks.pl>',
                    to: user.email,
                    subject: '🔓 Twoje 2FA zostało zresetowane',
                    html: `
                        <!DOCTYPE html>
                        <html>
                        <head>
                            <meta charset="utf-8">
                            <style>
                                body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; }
                                .header { background: #f59e0b; color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
                                .content { background: #f9fafb; padding: 30px; border-radius: 0 0 8px 8px; }
                                .button { display: inline-block; background: #667eea; color: white; padding: 12px 30px; text-decoration: none; border-radius: 6px; margin: 20px 0; }
                                .warning { background: #fee2e2; border-left: 4px solid #ef4444; padding: 15px; margin: 20px 0; border-radius: 0 8px 8px 0; }
                            </style>
                        </head>
                        <body>
                            <div class="header">
                                <h1>🔓 2FA zresetowane</h1>
                            </div>
                            <div class="content">
                                <p>Cześć!</p>
                                
                                <p>Dwuskładnikowe uwierzytelnianie zostało zresetowane na Twoim koncie AngoraLinks przez administratora.</p>
                                
                                <div class="warning">
                                    <strong>Jeśli nie prosiłeś(aś) o reset 2FA, natychmiast skontaktuj się z supportem!</strong>
                                </div>
                                
                                <p>Zalecamy ponowne skonfigurowanie 2FA w celu ochrony konta:</p>
                                
                                <a href="https://angoralinks.pl/settings/security" class="button">
                                    Skonfiguruj 2FA ponownie →
                                </a>
                                
                                <p style="color: #666; font-size: 14px;">
                                    Data resetowania: ${new Date().toLocaleString('pl-PL')}
                                </p>
                            </div>
                        </body>
                        </html>
                    `
                });
            }

            res.json({ 
                success: true,
                message: '2FA użytkownika zostało zresetowane' 
            });

        } catch (error) {
            console.error('Błąd resetowania 2FA:', error);
            res.status(500).json({ error: 'Błąd serwera' });
        }
    }

    // GET /api/admin/users/:id/2fa-status - szczegółowy status 2FA użytkownika
    async getUserTwoFactorStatus(req, res) {
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
                    twoFactorLastUsedAt: true,
                    webAuthnCredentials: {
                        select: {
                            id: true,
                            deviceName: true,
                            credentialDeviceType: true,
                            lastUsedAt: true,
                            createdAt: true
                        }
                    }
                }
            });

            if (!user) {
                return res.status(404).json({ error: 'Użytkownik nie znaleziony' });
            }

            // Pobierz liczbę backup codes
            const [totalBackupCodes, unusedBackupCodes] = await Promise.all([
                prisma.backupCode.count({ where: { userId: id } }),
                prisma.backupCode.count({ where: { userId: id, usedAt: null } })
            ]);

            // Pobierz ostatnie logi 2FA
            const recentLogs = await prisma.twoFactorLog.findMany({
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

            // Pobierz dane admina który wymusił 2FA (jeśli dotyczy)
            let requiredByAdmin = null;
            if (user.twoFactorRequiredBy) {
                requiredByAdmin = await prisma.user.findUnique({
                    where: { id: user.twoFactorRequiredBy },
                    select: { email: true }
                });
            }

            res.json({
                success: true,
                data: {
                    userId: user.id,
                    email: user.email,
                    twoFactor: {
                        enabled: user.twoFactorEnabled,
                        methods: user.twoFactorMethod,
                        required: user.twoFactorRequired,
                        requiredAt: user.twoFactorRequiredAt,
                        requiredBy: requiredByAdmin?.email || null,
                        enabledAt: user.twoFactorEnabledAt,
                        lastUsedAt: user.twoFactorLastUsedAt
                    },
                    webAuthnCredentials: user.webAuthnCredentials,
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
            res.status(500).json({ error: 'Błąd serwera' });
        }
    }

    // GET /api/admin/2fa-stats - statystyki 2FA dla całej platformy
    async getTwoFactorStats(req, res) {
        try {
            // Ogólne statystyki
            const [
                totalUsers,
                usersWithTwoFactor,
                usersWithTotpOnly,
                usersWithWebAuthnOnly,
                usersWithBoth,
                usersWithRequired,
                totalWebAuthnCredentials,
                totalBackupCodesUsed
            ] = await Promise.all([
                prisma.user.count(),
                prisma.user.count({ where: { twoFactorEnabled: true } }),
                prisma.user.count({ 
                    where: { 
                        twoFactorEnabled: true,
                        twoFactorMethod: { has: 'TOTP' },
                        NOT: { twoFactorMethod: { has: 'WEBAUTHN' } }
                    } 
                }),
                prisma.user.count({ 
                    where: { 
                        twoFactorEnabled: true,
                        twoFactorMethod: { has: 'WEBAUTHN' },
                        NOT: { twoFactorMethod: { has: 'TOTP' } }
                    } 
                }),
                prisma.user.count({ 
                    where: { 
                        twoFactorEnabled: true,
                        twoFactorMethod: { hasEvery: ['TOTP', 'WEBAUTHN'] }
                    } 
                }),
                prisma.user.count({ where: { twoFactorRequired: true } }),
                prisma.webAuthnCredential.count(),
                prisma.backupCode.count({ where: { usedAt: { not: null } } })
            ]);

            // Statystyki logów z ostatnich 30 dni
            const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
            
            const recentLogs = await prisma.twoFactorLog.groupBy({
                by: ['action', 'success'],
                where: { createdAt: { gte: thirtyDaysAgo } },
                _count: true
            });

            // Przetwórz logi
            const logStats = {
                verifications: {
                    successful: 0,
                    failed: 0
                },
                enablements: 0,
                disablements: 0,
                adminResets: 0,
                backupCodesUsed: 0
            };

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
                        totpOnly: usersWithTotpOnly,
                        webAuthnOnly: usersWithWebAuthnOnly,
                        both: usersWithBoth
                    },
                    enforcement: {
                        usersWithRequired,
                        usersCompliant: usersWithTwoFactor,
                        usersPending: usersWithRequired - usersWithTwoFactor
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
            res.status(500).json({ error: 'Błąd serwera' });
        }
    }
}

module.exports = { adminController: new AdminController() };