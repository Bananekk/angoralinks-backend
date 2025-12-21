const { customAlphabet } = require('nanoid');

// Generator krótkich kodów (bezpieczne znaki, bez mylących: 0,O,l,1)
const generateCode = customAlphabet('abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789', 6);

class LinkService {
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

    // Oblicz zarobek na podstawie kraju
    calculateEarning(country) {
        // Stawki CPM per tier (za 1000 wyświetleń)
        // Przeliczamy na pojedyncze wyświetlenie
        const rates = {
            // Tier 1 - $3 CPM
            tier1: ['US', 'GB', 'CA', 'AU', 'DE', 'FR', 'NL', 'SE', 'NO', 'DK', 'CH'],
            // Tier 2 - $1.5 CPM  
            tier2: ['PL', 'CZ', 'ES', 'IT', 'PT', 'BR', 'MX', 'AR', 'JP', 'KR'],
            // Tier 3 - $0.5 CPM
            tier3: [] // Reszta świata
        };

        if (rates.tier1.includes(country)) {
            return 0.003; // $3 / 1000
        } else if (rates.tier2.includes(country)) {
            return 0.0015; // $1.5 / 1000
        } else {
            return 0.0005; // $0.5 / 1000
        }
    }

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