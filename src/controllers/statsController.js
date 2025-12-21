const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

class StatsController {
    // GET /api/stats/public - publiczne statystyki dla strony głównej
    async publicStats(req, res) {
        try {
            // Liczba użytkowników
            const totalUsers = await prisma.user.count();

            // Liczba wszystkich kliknięć (suma z linków)
            const clicksResult = await prisma.link.aggregate({
                _sum: { totalClicks: true }
            });
            const totalClicks = clicksResult._sum.totalClicks || 0;

            // Suma wypłaconych środków (status COMPLETED)
            const payoutsResult = await prisma.payout.aggregate({
                where: { status: 'COMPLETED' },
                _sum: { amount: true }
            });
            const totalPaidOut = parseFloat(payoutsResult._sum.amount || 0);

            // Uptime - zawsze 99.9% (lub możesz to liczyć dynamicznie)
            const uptime = 99.9;

            res.json({
                users: totalUsers,
                clicks: totalClicks,
                paidOut: totalPaidOut,
                uptime: uptime
            });

        } catch (error) {
            console.error('Błąd pobierania publicznych statystyk:', error);
            res.status(500).json({
                error: 'Błąd serwera'
            });
        }
    }

    // GET /api/stats/overview - ogólne statystyki użytkownika
    async overview(req, res) {
        try {
            const userId = req.user.id;

            // Pobierz użytkownika
            const user = await prisma.user.findUnique({
                where: { id: userId }
            });

            // Pobierz wszystkie linki użytkownika
            const links = await prisma.link.findMany({
                where: { userId }
            });

            // Policz statystyki
            const totalLinks = links.length;
            const totalClicks = links.reduce((sum, link) => sum + link.totalClicks, 0);
            const totalEarned = links.reduce((sum, link) => sum + parseFloat(link.totalEarned), 0);

            // Statystyki z ostatnich 7 dni
            const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
            
            const recentVisits = await prisma.visit.findMany({
                where: {
                    link: { userId },
                    createdAt: { gte: sevenDaysAgo }
                },
                orderBy: { createdAt: 'asc' }
            });

            // Grupuj wizyty po dniach
            const dailyStats = {};
            for (let i = 6; i >= 0; i--) {
                const date = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
                const dateKey = date.toISOString().split('T')[0];
                dailyStats[dateKey] = { clicks: 0, earned: 0 };
            }

            recentVisits.forEach(visit => {
                const dateKey = visit.createdAt.toISOString().split('T')[0];
                if (dailyStats[dateKey]) {
                    dailyStats[dateKey].clicks += 1;
                    dailyStats[dateKey].earned += parseFloat(visit.earned);
                }
            });

            // Statystyki z dzisiaj
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            
            const todayVisits = await prisma.visit.findMany({
                where: {
                    link: { userId },
                    createdAt: { gte: today }
                }
            });

            const todayClicks = todayVisits.length;
            const todayEarned = todayVisits.reduce((sum, v) => sum + parseFloat(v.earned), 0);

            res.json({
                balance: parseFloat(user.balance),
                totalEarned: totalEarned,
                totalLinks: totalLinks,
                totalClicks: totalClicks,
                today: {
                    clicks: todayClicks,
                    earned: todayEarned
                },
                dailyStats: Object.entries(dailyStats).map(([date, stats]) => ({
                    date,
                    clicks: stats.clicks,
                    earned: parseFloat(stats.earned.toFixed(4))
                })),
                platformFee: '15%',
                userShare: '85%'
            });

        } catch (error) {
            console.error('Błąd pobierania statystyk:', error);
            res.status(500).json({
                error: 'Błąd serwera'
            });
        }
    }

    // GET /api/stats/countries - statystyki według krajów
    async countries(req, res) {
        try {
            const userId = req.user.id;

            const visits = await prisma.visit.findMany({
                where: {
                    link: { userId }
                },
                select: {
                    country: true,
                    earned: true
                }
            });

            // Grupuj po krajach
            const countryStats = {};
            visits.forEach(visit => {
                const country = visit.country || 'Unknown';
                if (!countryStats[country]) {
                    countryStats[country] = { clicks: 0, earned: 0 };
                }
                countryStats[country].clicks += 1;
                countryStats[country].earned += parseFloat(visit.earned);
            });

            const result = Object.entries(countryStats)
                .map(([country, stats]) => ({
                    country,
                    clicks: stats.clicks,
                    earned: parseFloat(stats.earned.toFixed(4))
                }))
                .sort((a, b) => b.clicks - a.clicks);

            res.json({ countries: result });

        } catch (error) {
            console.error('Błąd pobierania statystyk krajów:', error);
            res.status(500).json({
                error: 'Błąd serwera'
            });
        }
    }

    // GET /api/stats/devices - statystyki według urządzeń
    async devices(req, res) {
        try {
            const userId = req.user.id;

            const visits = await prisma.visit.findMany({
                where: {
                    link: { userId }
                },
                select: {
                    device: true,
                    earned: true
                }
            });

            // Grupuj po urządzeniach
            const deviceStats = {};
            visits.forEach(visit => {
                const device = visit.device || 'Unknown';
                if (!deviceStats[device]) {
                    deviceStats[device] = { clicks: 0, earned: 0 };
                }
                deviceStats[device].clicks += 1;
                deviceStats[device].earned += parseFloat(visit.earned);
            });

            const result = Object.entries(deviceStats)
                .map(([device, stats]) => ({
                    device,
                    clicks: stats.clicks,
                    earned: parseFloat(stats.earned.toFixed(4))
                }))
                .sort((a, b) => b.clicks - a.clicks);

            res.json({ devices: result });

        } catch (error) {
            console.error('Błąd pobierania statystyk urządzeń:', error);
            res.status(500).json({
                error: 'Błąd serwera'
            });
        }
    }

    // GET /api/stats/links - statystyki poszczególnych linków
    async links(req, res) {
        try {
            const userId = req.user.id;

            const links = await prisma.link.findMany({
                where: { userId },
                orderBy: { totalClicks: 'desc' },
                take: 10
            });

            res.json({
                links: links.map(link => ({
                    id: link.id,
                    shortCode: link.shortCode,
                    title: link.title || link.originalUrl,
                    clicks: link.totalClicks,
                    earned: parseFloat(link.totalEarned)
                }))
            });

        } catch (error) {
            console.error('Błąd pobierania statystyk linków:', error);
            res.status(500).json({
                error: 'Błąd serwera'
            });
        }
    }
}

module.exports = { statsController: new StatsController() };