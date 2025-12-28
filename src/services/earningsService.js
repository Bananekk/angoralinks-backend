// src/services/earningsService.js

const { PrismaClient } = require('@prisma/client');
const crypto = require('crypto');
const { getCpmRateForCountry, EARNINGS_CONFIG } = require('../config/cpmRates');

const prisma = new PrismaClient();

class EarningsService {
    
    /**
     * Tworzy hash IP dla prywatności (GDPR compliant)
     * Używamy tego do sprawdzania unikalności bez przechowywania pełnego IP
     */
    hashIP(ip) {
        const salt = process.env.IP_HASH_SALT || 'angoralinks-2024';
        return crypto
            .createHash('sha256')
            .update(ip + salt)
            .digest('hex')
            .substring(0, 32);
    }

    /**
     * Sprawdza czy wizyta jest unikalna (w ciągu 24h dla danego linku)
     */
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

    /**
     * Sprawdza limity anty-fraud
     */
    async checkFraudLimits(ipHash) {
        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const oneMinuteAgo = new Date(now.getTime() - 60000);

        // Sprawdź ile wizyt z tego IP dzisiaj (wszystkie linki)
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

        // Sprawdź rate limit (wizyt na minutę)
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

    /**
     * Pobiera stawkę CPM - najpierw z bazy, potem z konfiguracji
     */
    async getCpmRate(countryCode) {
        const code = (countryCode || 'XX').toUpperCase();
        
        // 1. Sprawdź w bazie (mogły być ręczne aktualizacje)
        try {
            const dbRate = await prisma.cpmRate.findUnique({
                where: { countryCode: code }
            });

            if (dbRate && dbRate.isActive) {
                return {
                    countryCode: dbRate.countryCode,
                    countryName: dbRate.countryName,
                    tier: dbRate.tier,
                    baseCpm: parseFloat(dbRate.baseCpm),
                    userCpm: parseFloat(dbRate.userCpm),
                    perVisit: parseFloat(dbRate.userCpm) / 1000,
                    source: 'database'
                };
            }
        } catch (e) {
            // Tabela może nie istnieć - użyj konfiguracji
        }

        // 2. Użyj statycznej konfiguracji
        const staticRate = getCpmRateForCountry(code);
        return { ...staticRate, source: 'config' };
    }

    /**
     * Główna funkcja obliczania zarobków za wizytę
     */
    async calculateEarning(visitData) {
        const { ip, linkId, country } = visitData;
        const ipHash = this.hashIP(ip);
        const countryCode = (country || 'XX').toUpperCase();

        // 1. Sprawdź limity fraud
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

        // 2. Sprawdź unikalność
        const isUnique = await this.checkUniqueness(ipHash, linkId);

        // 3. Pobierz stawkę CPM
        const cpmRate = await this.getCpmRate(countryCode);

        // 4. Oblicz zarobek (tylko dla unikalnych wizyt)
        let earned = 0;
        let platformEarned = 0;

        if (isUnique) {
            earned = cpmRate.perVisit;
            platformEarned = (cpmRate.baseCpm / 1000) - earned;
        }

        return {
            earned: parseFloat(earned.toFixed(6)),
            platformEarned: parseFloat(platformEarned.toFixed(6)),
            isUnique,
            cpmRateUsed: cpmRate.baseCpm,
            tier: cpmRate.tier,
            blocked: false,
            ipHash
        };
    }

    /**
     * Zapisuje wizytę i aktualizuje wszystkie salda w transakcji
     */
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

        // Oblicz zarobki
        const earnings = await this.calculateEarning({ ip, linkId, country });

        // Pobierz link z użytkownikiem
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

        // Transakcja - zapisz wszystko atomowo
        const result = await prisma.$transaction(async (tx) => {
            // 1. Utwórz wizytę
            const visit = await tx.visit.create({
                data: {
                    linkId,
                    ipHash: earnings.ipHash,
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

            // 2. Aktualizuj statystyki linku
            await tx.link.update({
                where: { id: linkId },
                data: {
                    totalClicks: { increment: 1 },
                    uniqueClicks: earnings.isUnique ? { increment: 1 } : undefined,
                    totalEarned: { increment: earnings.earned }
                }
            });

            // 3. Aktualizuj saldo użytkownika (tylko dla unikalnych, niezablokowanych)
            if (earnings.isUnique && !earnings.blocked && earnings.earned > 0) {
                await tx.user.update({
                    where: { id: link.user.id },
                    data: {
                        balance: { increment: earnings.earned },
                        totalEarned: { increment: earnings.earned }
                    }
                });

                // 4. Zapisz w agregacji dziennej
                const today = new Date();
                today.setHours(0, 0, 0, 0);

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
            }

            return visit;
        });

        return { visit: result, earnings };
    }

    /**
     * Pobiera statystyki zarobków per kraj (dla admina)
     */
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

        // Pobierz unikalne wizyty osobno
        const enrichedStats = await Promise.all(
            stats.map(async (stat) => {
                const uniqueCount = await prisma.visit.count({
                    where: {
                        country: stat.country,
                        isUnique: true,
                        createdAt: { gte: since }
                    }
                });

                const cpmRate = await this.getCpmRate(stat.country);

                return {
                    country: stat.country,
                    countryName: cpmRate.countryName,
                    tier: cpmRate.tier,
                    totalVisits: stat._count.id,
                    uniqueVisits: uniqueCount,
                    userEarnings: parseFloat(stat._sum.earned || 0),
                    platformEarnings: parseFloat(stat._sum.platformEarned || 0),
                    configuredCpm: cpmRate.baseCpm,
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