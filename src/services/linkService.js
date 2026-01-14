const { customAlphabet } = require('nanoid');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const generateCode = customAlphabet('abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789', 6);

class LinkService {
    constructor() {
        this.ratesCache = null;
        this.settingsCache = null;
        this.cacheExpiry = null;
        this.CACHE_TTL = 5 * 60 * 1000;
    }

    generateShortCode() {
        return generateCode();
    }

    isValidUrl(url) {
        try {
            const parsed = new URL(url);
            return ['http:', 'https:'].includes(parsed.protocol);
        } catch {
            return false;
        }
    }

    // ===== SYSTEM CPM =====

    async getSettings() {
        if (this.settingsCache && this.cacheExpiry > Date.now()) {
            return this.settingsCache;
        }

        try {
            const settings = await prisma.platformSettings.findMany();
            this.settingsCache = settings.reduce((acc, s) => {
                acc[s.setting_key] = s.setting_value;
                return acc;
            }, {});
            this.cacheExpiry = Date.now() + this.CACHE_TTL;
            return this.settingsCache;
        } catch (error) {
            console.error('Błąd pobierania ustawień:', error);
            return {
                platform_commission: '0.15',
                default_tier3_cpm: '0.10',
                revenue_correction_factor: '0.10'
            };
        }
    }

    async getPlatformCommission() {
        const settings = await this.getSettings();
        return parseFloat(settings.platform_commission || '0.15');
    }

    // 🔥 NOWA FUNKCJA: Współczynnik korekcji przychodów
    async getRevenueCorrectionFactor() {
        const settings = await this.getSettings();
        const factor = parseFloat(settings.revenue_correction_factor || '0.10');
        // Zabezpieczenie przed absurdalnymi wartościami
        if (factor <= 0 || factor > 1) {
            console.warn(`Nieprawidłowy revenue_correction_factor: ${factor}, używam 0.10`);
            return 0.10;
        }
        return factor;
    }

    async getAllRates() {
        if (this.ratesCache && this.cacheExpiry > Date.now()) {
            return this.ratesCache;
        }

        try {
            const rates = await prisma.cpmRate.findMany({
                where: { isActive: true },
                orderBy: [{ tier: 'asc' }, { cpm_rate: 'desc' }]
            });
            this.ratesCache = rates;
            this.cacheExpiry = Date.now() + this.CACHE_TTL;
            return rates;
        } catch (error) {
            console.error('Błąd pobierania stawek CPM:', error);
            return [];
        }
    }

    async getRateForCountry(countryCode) {
        if (!countryCode) {
            return this.getDefaultRate();
        }

        try {
            const rate = await prisma.cpmRate.findUnique({
                where: { countryCode: countryCode.toUpperCase() }
            });

            if (rate && rate.isActive) {
                return {
                    countryCode: rate.countryCode,
                    countryName: rate.countryName,
                    tier: rate.tier,
                    cpmRate: Number(rate.cpm_rate) || Number(rate.baseCpm) || 0,
                    isActive: rate.isActive
                };
            }

            return this.getDefaultRate();
        } catch (error) {
            console.error('Błąd pobierania stawki dla kraju:', error);
            return this.getDefaultRate();
        }
    }

    async getDefaultRate() {
        const settings = await this.getSettings();
        return {
            countryCode: 'XX',
            countryName: 'Other',
            tier: 3,
            cpmRate: parseFloat(settings.default_tier3_cpm || '0.10')
        };
    }

    // 🔥 ZAKTUALIZOWANA FUNKCJA: Obliczanie zarobku z korekcją
    async calculateEarning(country) {
        const rate = await this.getRateForCountry(country);
        const commission = await this.getPlatformCommission();
        const correctionFactor = await this.getRevenueCorrectionFactor();
        
        const grossCpm = parseFloat(rate.cpmRate);
        
        // 🔥 Zastosuj współczynnik korekcji!
        const adjustedCpm = grossCpm * correctionFactor;
        
        const netCpm = adjustedCpm * (1 - commission);
        const earningPerClick = netCpm / 1000;
        
        console.log(`💰 Kalkulacja: ${country} | Bazowy CPM: $${grossCpm} | Skorygowany: $${adjustedCpm.toFixed(4)} | User earning: $${earningPerClick.toFixed(6)}`);
        
        return earningPerClick;
    }

    // 🔥 ZAKTUALIZOWANA FUNKCJA: Szczegóły zarobku z korekcją
    async getEarningDetails(countryCode) {
        const rate = await this.getRateForCountry(countryCode);
        const commission = await this.getPlatformCommission();
        const correctionFactor = await this.getRevenueCorrectionFactor();
        
        const grossCpm = parseFloat(rate.cpmRate);
        const adjustedCpm = grossCpm * correctionFactor;
        const netCpm = adjustedCpm * (1 - commission);
        const earningPerClick = netCpm / 1000;
        
        return {
            countryCode: rate.countryCode,
            countryName: rate.countryName,
            tier: rate.tier,
            // Wartości PRZED korekcją (do wyświetlania)
            displayCpm: grossCpm,
            // Wartości PO korekcji (faktyczne)
            grossCpm: parseFloat(adjustedCpm.toFixed(4)),
            netCpm: parseFloat(netCpm.toFixed(4)),
            earningPerClick: parseFloat(earningPerClick.toFixed(6)),
            commission: commission,
            correctionFactor: correctionFactor
        };
    }

    async getRatesGroupedByTier() {
        const rates = await this.getAllRates();
        const commission = await this.getPlatformCommission();
        const correctionFactor = await this.getRevenueCorrectionFactor();
        
        const grouped = {
            tier1: [],
            tier2: [],
            tier3: []
        };

        rates.forEach(rate => {
            const grossCpm = Number(rate.cpm_rate) || Number(rate.baseCpm) || 0;
            const adjustedCpm = grossCpm * correctionFactor;
            const netCpm = adjustedCpm * (1 - commission);
            const earningPerClick = netCpm / 1000;

            const enrichedRate = {
                countryCode: rate.countryCode,
                countryName: rate.countryName,
                // Wyświetlaj bazową stawkę (marketing)
                displayCpm: grossCpm,
                // Faktyczne wartości po korekcji
                grossCpm: parseFloat(adjustedCpm.toFixed(4)),
                netCpm: parseFloat(netCpm.toFixed(4)),
                earningPerClick: parseFloat(earningPerClick.toFixed(6))
            };

            if (rate.tier === 1) grouped.tier1.push(enrichedRate);
            else if (rate.tier === 2) grouped.tier2.push(enrichedRate);
            else grouped.tier3.push(enrichedRate);
        });

        return {
            commission: commission,
            commissionPercent: `${(commission * 100).toFixed(0)}%`,
            correctionFactor: correctionFactor,
            tiers: grouped
        };
    }

    // ===== ADMIN FUNCTIONS =====

    async updateRate(countryCode, newCpmRate, adminId) {
        const existingRate = await prisma.cpmRate.findUnique({
            where: { countryCode }
        });

        if (!existingRate) {
            throw new Error(`Kraj ${countryCode} nie znaleziony`);
        }

        await prisma.cpm_rate_history.create({
            data: {
                country_code: countryCode,
                old_rate: existingRate.cpm_rate,
                new_rate: newCpmRate,
                changed_by: adminId
            }
        });

        const updated = await prisma.cpmRate.update({
            where: { countryCode },
            data: {
                cpm_rate: newCpmRate,
                baseCpm: newCpmRate,
                userCpm: newCpmRate * 0.85,
                updated_by: adminId,
                lastVerified: new Date()
            }
        });

        this.clearCache();

        return {
            countryCode: updated.countryCode,
            countryName: updated.countryName,
            tier: updated.tier,
            cpmRate: parseFloat(updated.cpm_rate)
        };
    }

    // 🔥 NOWA FUNKCJA: Aktualizacja współczynnika korekcji
    async updateCorrectionFactor(newFactor, adminId) {
        if (newFactor <= 0 || newFactor > 1) {
            throw new Error('Współczynnik korekcji musi być między 0.01 a 1.00');
        }

        const updated = await prisma.platformSettings.upsert({
            where: { setting_key: 'revenue_correction_factor' },
            update: {
                setting_value: newFactor.toString(),
                updated_by: adminId
            },
            create: {
                setting_key: 'revenue_correction_factor',
                setting_value: newFactor.toString(),
                description: 'Współczynnik korekcji zarobków względem Adsterra',
                updated_by: adminId
            }
        });

        this.clearCache();
        
        console.log(`📊 Zaktualizowano współczynnik korekcji na: ${newFactor}`);
        
        return updated;
    }

    // 🔥 NOWA FUNKCJA: Automatyczna kalibracja na podstawie danych Adsterra
    async calibrateFromAdsterra(adsterraRevenue, ourCalculatedGross, adminId) {
        if (ourCalculatedGross <= 0) {
            throw new Error('Nasz obliczony gross musi być większy od 0');
        }

        const newFactor = adsterraRevenue / ourCalculatedGross;
        const clampedFactor = Math.max(0.01, Math.min(1.0, newFactor));

        console.log(`📊 Kalibracja: Adsterra=$${adsterraRevenue}, Nasze=$${ourCalculatedGross}, Nowy faktor=${clampedFactor.toFixed(4)}`);

        return this.updateCorrectionFactor(clampedFactor, adminId);
    }

    async addCountry(data, adminId) {
        const cpmRate = parseFloat(data.cpmRate || data.cpm_rate);
        
        const rate = await prisma.cpmRate.create({
            data: {
                countryCode: data.countryCode,
                countryName: data.countryName,
                tier: data.tier || 3,
                cpm_rate: cpmRate,
                baseCpm: cpmRate,
                userCpm: cpmRate * 0.85,
                updated_by: adminId,
                isActive: true
            }
        });

        this.clearCache();
        return rate;
    }

    async updateSetting(key, value, adminId) {
        const updated = await prisma.platformSettings.upsert({
            where: { setting_key: key },
            update: {
                setting_value: value,
                updated_by: adminId
            },
            create: {
                setting_key: key,
                setting_value: value,
                updated_by: adminId
            }
        });

        this.clearCache();
        return updated;
    }

    async bulkUpdateRates(rates, adminId) {
        const results = [];
        
        for (const rate of rates) {
            try {
                const cpmValue = rate.cpmRate || rate.cpm_rate || rate.baseCpm;
                const result = await this.updateRate(rate.countryCode, cpmValue, adminId);
                results.push({ success: true, countryCode: rate.countryCode, result });
            } catch (error) {
                results.push({ success: false, countryCode: rate.countryCode, error: error.message });
            }
        }

        return results;
    }

    async getRateHistory(countryCode = null, limit = 50) {
        const where = countryCode ? { country_code: countryCode } : {};
        
        return prisma.cpm_rate_history.findMany({
            where,
            orderBy: { changed_at: 'desc' },
            take: limit
        });
    }

    // 🔥 NOWA FUNKCJA: Statystyki do kalibracji
    async getCalibrationStats() {
        const settings = await this.getSettings();
        const correctionFactor = parseFloat(settings.revenue_correction_factor || '0.10');

        // Pobierz sumę zarobków z ostatnich 7 dni
        const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        
        const visits = await prisma.visit.aggregate({
            where: {
                completed: true,
                createdAt: { gte: sevenDaysAgo }
            },
            _sum: {
                earned: true,
                platformEarned: true
            },
            _count: true
        });

        return {
            correctionFactor,
            last7Days: {
                totalVisits: visits._count,
                userEarnings: parseFloat(visits._sum.earned || 0),
                platformEarnings: parseFloat(visits._sum.platformEarned || 0),
                grossEarnings: parseFloat(visits._sum.earned || 0) + parseFloat(visits._sum.platformEarned || 0)
            }
        };
    }

    clearCache() {
        this.ratesCache = null;
        this.settingsCache = null;
        this.cacheExpiry = null;
    }

    // ===== DEVICE DETECTION =====

    detectDevice(userAgent) {
        if (!userAgent) return 'unknown';
        
        userAgent = userAgent.toLowerCase();
        
        if (/mobile|android|iphone|ipad|ipod|blackberry|windows phone/.test(userAgent)) {
            if (/tablet|ipad/.test(userAgent)) {
                return 'tablet';
            }
            return 'mobile';
        }
        return 'desktop';
    }

    detectBrowser(userAgent) {
        if (!userAgent) return 'unknown';
        
        userAgent = userAgent.toLowerCase();
        
        if (userAgent.includes('firefox')) return 'Firefox';
        if (userAgent.includes('edg')) return 'Edge';
        if (userAgent.includes('chrome')) return 'Chrome';
        if (userAgent.includes('safari')) return 'Safari';
        if (userAgent.includes('opera')) return 'Opera';
        
        return 'Other';
    }
}

module.exports = new LinkService();