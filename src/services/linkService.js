const { customAlphabet } = require('nanoid');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

// Generator krótkich kodów (bezpieczne znaki, bez mylących: 0,O,l,1)
const generateCode = customAlphabet('abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789', 6);

class LinkService {
    constructor() {
        // Cache dla stawek CPM
        this.ratesCache = null;
        this.settingsCache = null;
        this.cacheExpiry = null;
        this.CACHE_TTL = 5 * 60 * 1000; // 5 minut
    }

    // Generuj unikalny krótki kod
    generateShortCode() {
        return generateCode();
    }

    // Walidacja URL
    isValidUrl(url) {
        try {
            const parsed = new URL(url);
            return ['http:', 'https:'].includes(parsed.protocol);
        } catch {
            return false;
        }
    }

    // ===== SYSTEM CPM =====

    // Pobierz ustawienia platformy z cache
    async getSettings() {
        if (this.settingsCache && this.cacheExpiry > Date.now()) {
            return this.settingsCache;
        }

        try {
            const settings = await prisma.platformSettings.findMany();
            this.settingsCache = settings.reduce((acc, s) => {
                acc[s.settingKey] = s.settingValue;
                return acc;
            }, {});
            this.cacheExpiry = Date.now() + this.CACHE_TTL;
            return this.settingsCache;
        } catch (error) {
            console.error('Błąd pobierania ustawień:', error);
            // Domyślne wartości jeśli baza niedostępna
            return {
                platform_commission: '0.15',
                default_tier3_cpm: '0.40'
            };
        }
    }

    // Pobierz prowizję platformy
    async getPlatformCommission() {
        const settings = await this.getSettings();
        return parseFloat(settings.platform_commission || '0.15');
    }

    // Pobierz wszystkie stawki CPM z cache
    async getAllRates() {
        if (this.ratesCache && this.cacheExpiry > Date.now()) {
            return this.ratesCache;
        }

        try {
            const rates = await prisma.cpmRate.findMany({
                where: { isActive: true },
                orderBy: [{ tier: 'asc' }, { cpmRate: 'desc' }]
            });
            this.ratesCache = rates;
            this.cacheExpiry = Date.now() + this.CACHE_TTL;
            return rates;
        } catch (error) {
            console.error('Błąd pobierania stawek CPM:', error);
            return [];
        }
    }

    // Pobierz stawkę dla konkretnego kraju
    async getRateForCountry(countryCode) {
        if (!countryCode) {
            return this.getDefaultRate();
        }

        try {
            const rate = await prisma.cpmRate.findUnique({
                where: { countryCode: countryCode.toUpperCase() }
            });

            if (rate && rate.isActive) {
                return rate;
            }

            return this.getDefaultRate();
        } catch (error) {
            console.error('Błąd pobierania stawki dla kraju:', error);
            return this.getDefaultRate();
        }
    }

    // Domyślna stawka dla nieznanych krajów
    async getDefaultRate() {
        const settings = await this.getSettings();
        return {
            countryCode: 'XX',
            countryName: 'Other',
            tier: 3,
            cpmRate: parseFloat(settings.default_tier3_cpm || '0.40')
        };
    }

    // 🔥 GŁÓWNA FUNKCJA - Oblicz zarobek za kliknięcie
    async calculateEarning(country) {
        const rate = await this.getRateForCountry(country);
        const commission = await this.getPlatformCommission();
        
        const grossCpm = parseFloat(rate.cpmRate);
        const netCpm = grossCpm * (1 - commission); // CPM po odjęciu prowizji
        const earningPerClick = netCpm / 1000; // Zarobek za pojedyncze kliknięcie
        
        return earningPerClick;
    }

    // Szczegółowe informacje o zarobku (dla API)
    async getEarningDetails(countryCode) {
        const rate = await this.getRateForCountry(countryCode);
        const commission = await this.getPlatformCommission();
        
        const grossCpm = parseFloat(rate.cpmRate);
        const netCpm = grossCpm * (1 - commission);
        const earningPerClick = netCpm / 1000;
        
        return {
            countryCode: rate.countryCode,
            countryName: rate.countryName,
            tier: rate.tier,
            grossCpm: grossCpm,
            netCpm: parseFloat(netCpm.toFixed(4)),
            earningPerClick: parseFloat(earningPerClick.toFixed(6)),
            commission: commission
        };
    }

    // Pobierz stawki pogrupowane według tierów (dla dashboardu)
    async getRatesGroupedByTier() {
        const rates = await this.getAllRates();
        const commission = await this.getPlatformCommission();
        
        const grouped = {
            tier1: [],
            tier2: [],
            tier3: []
        };

        rates.forEach(rate => {
            const grossCpm = parseFloat(rate.cpmRate);
            const netCpm = grossCpm * (1 - commission);
            const earningPerClick = netCpm / 1000;

            const enrichedRate = {
                countryCode: rate.countryCode,
                countryName: rate.countryName,
                grossCpm: grossCpm,
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
            tiers: grouped
        };
    }

    // ===== ADMIN FUNCTIONS =====

    // Aktualizuj stawkę CPM dla kraju
    async updateRate(countryCode, newCpmRate, adminId) {
        const existingRate = await prisma.cpmRate.findUnique({
            where: { countryCode }
        });

        if (!existingRate) {
            throw new Error(`Kraj ${countryCode} nie znaleziony`);
        }

        // Zapisz historię zmiany
        await prisma.cpmRateHistory.create({
            data: {
                countryCode,
                oldRate: existingRate.cpmRate,
                newRate: newCpmRate,
                changedBy: adminId
            }
        });

        // Aktualizuj stawkę
        const updated = await prisma.cpmRate.update({
            where: { countryCode },
            data: {
                cpmRate: newCpmRate,
                updatedBy: adminId
            }
        });

        // Wyczyść cache
        this.clearCache();

        return updated;
    }

    // Dodaj nowy kraj
    async addCountry(data, adminId) {
        const rate = await prisma.cpmRate.create({
            data: {
                ...data,
                updatedBy: adminId
            }
        });

        this.clearCache();
        return rate;
    }

    // Aktualizuj ustawienie
    async updateSetting(key, value, adminId) {
        const updated = await prisma.platformSettings.upsert({
            where: { settingKey: key },
            update: {
                settingValue: value,
                updatedBy: adminId
            },
            create: {
                settingKey: key,
                settingValue: value,
                updatedBy: adminId
            }
        });

        this.clearCache();
        return updated;
    }

    // Bulk update stawek
    async bulkUpdateRates(rates, adminId) {
        const results = [];
        
        for (const rate of rates) {
            try {
                const result = await this.updateRate(rate.countryCode, rate.cpmRate, adminId);
                results.push({ success: true, countryCode: rate.countryCode, result });
            } catch (error) {
                results.push({ success: false, countryCode: rate.countryCode, error: error.message });
            }
        }

        return results;
    }

    // Historia zmian stawek
    async getRateHistory(countryCode = null, limit = 50) {
        const where = countryCode ? { countryCode } : {};
        
        return prisma.cpmRateHistory.findMany({
            where,
            orderBy: { changedAt: 'desc' },
            take: limit
        });
    }

    // Wyczyść cache
    clearCache() {
        this.ratesCache = null;
        this.settingsCache = null;
        this.cacheExpiry = null;
    }

    // ===== DEVICE DETECTION =====

    // Wykryj urządzenie z User-Agent
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

    // Wykryj przeglądarkę
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