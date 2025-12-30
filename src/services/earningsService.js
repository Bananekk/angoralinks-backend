// services/earningsService.js
const { PrismaClient } = require('@prisma/client');
const crypto = require('crypto');
const linkService = require('./linkService');
const ReferralService = require('./referralService');

const prisma = new PrismaClient();

// Konfiguracja
const EARNINGS_CONFIG = {
    UNIQUENESS_WINDOW_HOURS: 24,
    MAX_VISITS_PER_IP_PER_LINK: 1,
    MAX_VISITS_PER_IP_DAILY: 50,
    RATE_LIMIT_PER_MINUTE: 10,
};

class EarningsService {

    hashIP(ip) {
        const salt = process.env.IP_HASH_SALT || 'angoralinks-2024';
        return crypto
            .createHash('sha256')
            .update(ip + salt)
            .digest('hex')
            .substring(0, 32);
    }

    async checkUniqueness(ipHash, linkId) {
        const windowStart = new Date();
        windowStart.setHours(windowStart.getHours() - EARNINGS_CONFIG.UNIQUENESS_WINDOW_HOURS);

        const existingVisit = await prisma.visit.findFirst({
            where: {
                ipHash,
                linkId,
                createdAt: { gte: windowStart }
            }
        });

        return !existingVisit;
    }

    async checkFraudLimits(ipHash) {
        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const oneMinuteAgo = new Date(now.getTime() - 60000);

        const visitsToday = await prisma.visit.count({
            where: {
                ipHash,
                createdAt: { gte: today }
            }
        });

        if (visitsToday >= EARNINGS_CONFIG.MAX_VISITS_PER_IP_DAILY) {
            return {
                allowed: false,
                reason: 'daily_limit',
                message: 'Przekroczono dzienny limit wizyt z tego IP'
            };
        }

        const recentVisits = await prisma.visit.count({
            where: {
                ipHash,
                createdAt: { gte: oneMinuteAgo }
            }
        });

        if (recentVisits >= EARNINGS_CONFIG.RATE_LIMIT_PER_MINUTE) {
            return {
                allowed: false,
                reason: 'rate_limit',
                message: 'Zbyt wiele żądań. Spróbuj za chwilę.'
            };
        }

        return { allowed: true };
    }

    async calculateEarning(visitData) {
        const { ip, linkId, country } = visitData;
        const ipHash = this.hashIP(ip);
        const countryCode = (country || 'XX').toUpperCase();

        const fraudCheck = await this.checkFraudLimits(ipHash);
        if (!fraudCheck.allowed) {
            return {
                earned: 0,
                platformEarned: 0,
                isUnique: false,
                cpmRateUsed: 0,
                tier: 3,
                blocked: true,
                blockReason: fraudCheck.reason,
                ipHash
            };
        }

        const isUnique = await this.checkUniqueness(ipHash, linkId);

        const rate = await linkService.getRateForCountry(countryCode);
        const commission = await linkService.getPlatformCommission();

        const grossCpm = parseFloat(rate.cpmRate || rate.cpm_rate || 0);
        const userCpm = grossCpm * (1 - commission);
        const platformCpm = grossCpm * commission;

        let earned = 0;
        let platformEarned = 0;

        if (isUnique) {
            earned = userCpm / 1000;
            platformEarned = platformCpm / 1000;
        }

        return {
            earned: parseFloat(earned.toFixed(6)),
            platformEarned: parseFloat(platformEarned.toFixed(6)),
            isUnique,
            cpmRateUsed: grossCpm,
            tier: rate.tier || 3,
            blocked: false,
            ipHash,
            commission
        };
    }

    async recordVisit(visitData) {
        const {
            linkId,
            ip,
            encryptedIp,
            country,
            device,
            browser,
            userAgent,
            referer
        } = visitData;

        const earnings = await this.calculateEarning({ ip, linkId, country });

        const link = await prisma.link.findUnique({
            where: { id: linkId },
            include: { user: { select: { id: true, isActive: true } } }
        });

        if (!link) {
            throw new Error('Link nie znaleziony');
        }

        if (!link.user.isActive) {
            throw new Error('Właściciel linku jest nieaktywny');
        }

        const result = await prisma.$transaction(async (tx) => {
            const visit = await tx.visit.create({
                data: {
                    linkId,
                    ipHash: earnings.ipHash,
                    ip_address: earnings.ipHash,
                    encryptedIp: encryptedIp || null,
                    country: country?.toUpperCase() || 'XX',
                    countryTier: earnings.tier,
                    device: device || 'desktop',
                    browser: browser || null,
                    userAgent: userAgent?.substring(0, 500) || null,
                    referer: referer?.substring(0, 500) || null,
                    earned: earnings.earned,
                    platformEarned: earnings.platformEarned,
                    cpmRateUsed: earnings.cpmRateUsed,
                    isUnique: earnings.isUnique,
                    adDisplayed: true,
                    fraudBlocked: earnings.blocked,
                    blockReason: earnings.blockReason || null
                }
            });

            await tx.link.update({
                where: { id: linkId },
                data: {
                    totalClicks: { increment: 1 },
                    uniqueClicks: earnings.isUnique ? { increment: 1 } : undefined,
                    totalEarned: { increment: earnings.earned }
                }
            });

            if (earnings.isUnique && !earnings.blocked && earnings.earned > 0) {
                await tx.user.update({
                    where: { id: link.user.id },
                    data: {
                        balance: { increment: earnings.earned },
                        totalEarned: { increment: earnings.earned }
                    }
                });

                // Agregacja dzienna
                const today = new Date();
                today.setHours(0, 0, 0, 0);

                try {
                    await tx.dailyEarning.upsert({
                        where: {
                            userId_date_country: {
                                userId: link.user.id,
                                date: today,
                                country: country?.toUpperCase() || 'XX'
                            }
                        },
                        create: {
                            userId: link.user.id,
                            date: today,
                            country: country?.toUpperCase() || 'XX',
                            visits: 1,
                            uniqueVisits: 1,
                            userEarnings: earnings.earned,
                            platformEarnings: earnings.platformEarned
                        },
                        update: {
                            visits: { increment: 1 },
                            uniqueVisits: { increment: 1 },
                            userEarnings: { increment: earnings.earned },
                            platformEarnings: { increment: earnings.platformEarned }
                        }
                    });
                } catch (e) {
                    console.log('DailyEarning upsert skipped:', e.message);
                }
            }

            return visit;
        });

        // ============ PROWIZJA REFERALNA ============
        if (earnings.isUnique && !earnings.blocked && earnings.earned > 0) {
            try {
                await ReferralService.processReferralCommission(
                    link.user.id,
                    result.id,
                    earnings.earned
                );
            } catch (error) {
                console.error('Referral commission error:', error);
                // Nie przerywaj procesu nawet jeśli prowizja się nie naliczy
            }
        }
        // ============================================

        return { visit: result, earnings };
    }

    async getEarningsStatsByCountry(days = 30) {
        const since = new Date();
        since.setDate(since.getDate() - days);

        const stats = await prisma.visit.groupBy({
            by: ['country'],
            where: {
                createdAt: { gte: since }
            },
            _count: { id: true },
            _sum: { earned: true, platformEarned: true }
        });

        const enrichedStats = await Promise.all(
            stats.map(async (stat) => {
                const uniqueCount = await prisma.visit.count({
                    where: {
                        country: stat.country,
                        isUnique: true,
                        createdAt: { gte: since }
                    }
                });

                const rate = await linkService.getRateForCountry(stat.country);

                return {
                    country: stat.country || 'XX',
                    countryName: rate.countryName || 'Unknown',
                    tier: rate.tier || 3,
                    totalVisits: stat._count.id,
                    uniqueVisits: uniqueCount,
                    userEarnings: parseFloat(stat._sum.earned || 0),
                    platformEarnings: parseFloat(stat._sum.platformEarned || 0),
                    configuredCpm: parseFloat(rate.cpmRate || 0),
                    effectiveCpm: uniqueCount > 0
                        ? ((parseFloat(stat._sum.earned || 0) / uniqueCount) * 1000).toFixed(4)
                        : '0.0000'
                };
            })
        );

        return enrichedStats.sort((a, b) => b.userEarnings - a.userEarnings);
    }
}

module.exports = new EarningsService();