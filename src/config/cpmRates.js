// src/config/cpmRates.js

/**
 * Konfiguracja stawek CPM dla AngoraLinks
 * 
 * baseCpm = stawka którą TY dostajesz z Adsterra
 * userCpm = stawka dla użytkownika (85% z baseCpm)
 * perVisit = zarobek za 1 wizytę (userCpm / 1000)
 */

// Konfiguracja systemu zarobków
const EARNINGS_CONFIG = {
    USER_SHARE: 0.85,              // Użytkownik dostaje 85%
    PLATFORM_SHARE: 0.15,          // Platforma zatrzymuje 15%
    MIN_PAYOUT: 5.00,              // Minimalna wypłata w USD
    UNIQUENESS_WINDOW_HOURS: 24,   // Okno unikalności wizyty (24h)
    MAX_VISITS_PER_IP_PER_LINK: 1, // Max wizyt z jednego IP na link dziennie
    MAX_VISITS_PER_IP_DAILY: 50,   // Max wizyt z jednego IP dziennie (wszystkie linki)
    RATE_LIMIT_PER_MINUTE: 10,     // Max wizyt z jednego IP na minutę
};

// Stawki CPM per kraj
// WAŻNE: Dostosuj baseCpm do swoich rzeczywistych stawek z Adsterra!
const CPM_RATES = {
    // ============== TIER 1 - Kraje premium ==============
    // Typowe stawki Adsterra: $1.50 - $4.00 CPM
    
    'US': { countryName: 'United States', tier: 1, baseCpm: 3.00 },
    'GB': { countryName: 'United Kingdom', tier: 1, baseCpm: 2.80 },
    'CA': { countryName: 'Canada', tier: 1, baseCpm: 2.50 },
    'AU': { countryName: 'Australia', tier: 1, baseCpm: 2.60 },
    'DE': { countryName: 'Germany', tier: 1, baseCpm: 2.40 },
    'FR': { countryName: 'France', tier: 1, baseCpm: 2.20 },
    'NL': { countryName: 'Netherlands', tier: 1, baseCpm: 2.30 },
    'SE': { countryName: 'Sweden', tier: 1, baseCpm: 2.40 },
    'NO': { countryName: 'Norway', tier: 1, baseCpm: 2.50 },
    'DK': { countryName: 'Denmark', tier: 1, baseCpm: 2.30 },
    'CH': { countryName: 'Switzerland', tier: 1, baseCpm: 2.80 },
    'AT': { countryName: 'Austria', tier: 1, baseCpm: 2.20 },
    'BE': { countryName: 'Belgium', tier: 1, baseCpm: 2.10 },
    'NZ': { countryName: 'New Zealand', tier: 1, baseCpm: 2.20 },
    'IE': { countryName: 'Ireland', tier: 1, baseCpm: 2.30 },
    'FI': { countryName: 'Finland', tier: 1, baseCpm: 2.10 },
    'LU': { countryName: 'Luxembourg', tier: 1, baseCpm: 2.40 },
    'SG': { countryName: 'Singapore', tier: 1, baseCpm: 2.00 },
    'JP': { countryName: 'Japan', tier: 1, baseCpm: 1.80 },
    
    // ============== TIER 2 - Kraje średnie ==============
    // Typowe stawki Adsterra: $0.30 - $1.50 CPM
    
    'PL': { countryName: 'Poland', tier: 2, baseCpm: 0.80 },
    'ES': { countryName: 'Spain', tier: 2, baseCpm: 1.20 },
    'IT': { countryName: 'Italy', tier: 2, baseCpm: 1.10 },
    'PT': { countryName: 'Portugal', tier: 2, baseCpm: 0.90 },
    'CZ': { countryName: 'Czech Republic', tier: 2, baseCpm: 0.70 },
    'SK': { countryName: 'Slovakia', tier: 2, baseCpm: 0.60 },
    'HU': { countryName: 'Hungary', tier: 2, baseCpm: 0.55 },
    'RO': { countryName: 'Romania', tier: 2, baseCpm: 0.50 },
    'GR': { countryName: 'Greece', tier: 2, baseCpm: 0.70 },
    'HR': { countryName: 'Croatia', tier: 2, baseCpm: 0.55 },
    'SI': { countryName: 'Slovenia', tier: 2, baseCpm: 0.65 },
    'BG': { countryName: 'Bulgaria', tier: 2, baseCpm: 0.45 },
    'LT': { countryName: 'Lithuania', tier: 2, baseCpm: 0.55 },
    'LV': { countryName: 'Latvia', tier: 2, baseCpm: 0.50 },
    'EE': { countryName: 'Estonia', tier: 2, baseCpm: 0.55 },
    'RU': { countryName: 'Russia', tier: 2, baseCpm: 0.40 },
    'UA': { countryName: 'Ukraine', tier: 2, baseCpm: 0.30 },
    'TR': { countryName: 'Turkey', tier: 2, baseCpm: 0.50 },
    'BR': { countryName: 'Brazil', tier: 2, baseCpm: 0.60 },
    'MX': { countryName: 'Mexico', tier: 2, baseCpm: 0.55 },
    'AR': { countryName: 'Argentina', tier: 2, baseCpm: 0.45 },
    'CL': { countryName: 'Chile', tier: 2, baseCpm: 0.50 },
    'CO': { countryName: 'Colombia', tier: 2, baseCpm: 0.40 },
    'MY': { countryName: 'Malaysia', tier: 2, baseCpm: 0.70 },
    'TH': { countryName: 'Thailand', tier: 2, baseCpm: 0.55 },
    'ZA': { countryName: 'South Africa', tier: 2, baseCpm: 0.60 },
    'AE': { countryName: 'UAE', tier: 2, baseCpm: 1.00 },
    'SA': { countryName: 'Saudi Arabia', tier: 2, baseCpm: 0.90 },
    'IL': { countryName: 'Israel', tier: 2, baseCpm: 1.20 },
    'KR': { countryName: 'South Korea', tier: 2, baseCpm: 1.00 },
    'TW': { countryName: 'Taiwan', tier: 2, baseCpm: 0.80 },
    'HK': { countryName: 'Hong Kong', tier: 2, baseCpm: 1.00 },

    // ============== TIER 3 - Pozostałe kraje ==============
    // Typowe stawki Adsterra: $0.05 - $0.30 CPM
    
    'IN': { countryName: 'India', tier: 3, baseCpm: 0.15 },
    'PK': { countryName: 'Pakistan', tier: 3, baseCpm: 0.10 },
    'BD': { countryName: 'Bangladesh', tier: 3, baseCpm: 0.08 },
    'ID': { countryName: 'Indonesia', tier: 3, baseCpm: 0.20 },
    'PH': { countryName: 'Philippines', tier: 3, baseCpm: 0.25 },
    'VN': { countryName: 'Vietnam', tier: 3, baseCpm: 0.18 },
    'EG': { countryName: 'Egypt', tier: 3, baseCpm: 0.15 },
    'NG': { countryName: 'Nigeria', tier: 3, baseCpm: 0.12 },
    'KE': { countryName: 'Kenya', tier: 3, baseCpm: 0.15 },
    'GH': { countryName: 'Ghana', tier: 3, baseCpm: 0.12 },
    'MA': { countryName: 'Morocco', tier: 3, baseCpm: 0.20 },
    'DZ': { countryName: 'Algeria', tier: 3, baseCpm: 0.15 },
    'TN': { countryName: 'Tunisia', tier: 3, baseCpm: 0.18 },
    'CN': { countryName: 'China', tier: 3, baseCpm: 0.25 },
    'PE': { countryName: 'Peru', tier: 3, baseCpm: 0.30 },
    'VE': { countryName: 'Venezuela', tier: 3, baseCpm: 0.10 },
    'EC': { countryName: 'Ecuador', tier: 3, baseCpm: 0.25 },
    'BY': { countryName: 'Belarus', tier: 3, baseCpm: 0.20 },
    'KZ': { countryName: 'Kazakhstan', tier: 3, baseCpm: 0.25 },
    'UZ': { countryName: 'Uzbekistan', tier: 3, baseCpm: 0.10 },
    'MM': { countryName: 'Myanmar', tier: 3, baseCpm: 0.08 },
    'NP': { countryName: 'Nepal', tier: 3, baseCpm: 0.08 },
    'LK': { countryName: 'Sri Lanka', tier: 3, baseCpm: 0.12 },
    
    // Domyślny dla nieznanych krajów
    'XX': { countryName: 'Unknown', tier: 3, baseCpm: 0.10 },
};

// Domyślne stawki per tier (gdy brak konkretnego kraju)
const DEFAULT_TIER_RATES = {
    1: { baseCpm: 2.00, userCpm: 1.70 },
    2: { baseCpm: 0.60, userCpm: 0.51 },
    3: { baseCpm: 0.15, userCpm: 0.1275 },
};

/**
 * Pobiera stawkę CPM dla kraju
 */
function getCpmRateForCountry(countryCode) {
    const code = (countryCode || 'XX').toUpperCase();
    const rate = CPM_RATES[code] || CPM_RATES['XX'];
    
    const baseCpm = rate.baseCpm;
    const userCpm = baseCpm * EARNINGS_CONFIG.USER_SHARE;
    const perVisit = userCpm / 1000;
    
    return {
        countryCode: code,
        countryName: rate.countryName,
        tier: rate.tier,
        baseCpm: baseCpm,
        userCpm: userCpm,
        perVisit: perVisit,
        platformCut: (baseCpm * EARNINGS_CONFIG.PLATFORM_SHARE) / 1000
    };
}

/**
 * Pobiera wszystkie stawki jako tablicę (do wyświetlenia w adminie)
 */
function getAllCpmRates() {
    return Object.entries(CPM_RATES).map(([code, data]) => {
        const userCpm = data.baseCpm * EARNINGS_CONFIG.USER_SHARE;
        return {
            countryCode: code,
            countryName: data.countryName,
            tier: data.tier,
            baseCpm: data.baseCpm,
            userCpm: userCpm,
            perVisit: userCpm / 1000
        };
    }).sort((a, b) => a.tier - b.tier || b.baseCpm - a.baseCpm);
}

module.exports = {
    EARNINGS_CONFIG,
    CPM_RATES,
    DEFAULT_TIER_RATES,
    getCpmRateForCountry,
    getAllCpmRates
};