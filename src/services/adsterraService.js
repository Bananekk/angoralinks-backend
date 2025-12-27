// services/adsterraService.js

class AdsterraService {
    constructor() {
        this.apiToken = process.env.ADSTERRA_API_TOKEN;
        this.baseUrl = 'https://api3.adsterratools.com/publisher';
        this.cache = {
            data: null,
            timestamp: null,
            ttl: 5 * 60 * 1000 // 5 minut cache (Adsterra ma rate limits)
        };
    }

    async fetchWithAuth(endpoint) {
        if (!this.apiToken) {
            console.warn('Brak tokenu Adsterra API');
            return null;
        }

        try {
            const response = await fetch(`${this.baseUrl}${endpoint}`, {
                method: 'GET',
                headers: {
                    'Accept': 'application/json',
                    'X-API-Key': this.apiToken
                }
            });

            if (!response.ok) {
                throw new Error(`Adsterra API error: ${response.status}`);
            }

            return await response.json();
        } catch (error) {
            console.error('Błąd Adsterra API:', error);
            return null;
        }
    }

    // Formatowanie daty dla Adsterra API (YYYY-MM-DD)
    formatDate(date) {
        return date.toISOString().split('T')[0];
    }

    // Pobierz statystyki za okres
    async getStats(startDate, endDate) {
        const start = this.formatDate(startDate);
        const end = this.formatDate(endDate);
        
        // Endpoint: /stats.json?start_date=YYYY-MM-DD&finish_date=YYYY-MM-DD
        const data = await this.fetchWithAuth(
            `/stats.json?start_date=${start}&finish_date=${end}&group_by=date`
        );
        
        return data;
    }

    // Pobierz dzisiejsze zarobki
    async getTodayEarnings() {
        const today = new Date();
        const stats = await this.getStats(today, today);
        
        if (!stats || !stats.items || stats.items.length === 0) {
            return 0;
        }

        return stats.items.reduce((sum, item) => sum + parseFloat(item.revenue || 0), 0);
    }

    // Pobierz zarobki z ostatnich 7 dni
    async getLast7DaysEarnings() {
        const endDate = new Date();
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - 6);

        const stats = await this.getStats(startDate, endDate);
        
        if (!stats || !stats.items) {
            return { total: 0, daily: [] };
        }

        const daily = stats.items.map(item => ({
            date: item.date,
            revenue: parseFloat(item.revenue || 0),
            impressions: parseInt(item.impressions || 0),
            clicks: parseInt(item.clicks || 0)
        }));

        const total = daily.reduce((sum, day) => sum + day.revenue, 0);

        return { total, daily };
    }

    // Pobierz saldo konta (całkowite zarobki)
    async getAccountBalance() {
        // Adsterra może nie mieć bezpośredniego endpointa na saldo
        // Alternatywnie pobieramy statystyki za cały miesiąc
        const endDate = new Date();
        const startDate = new Date();
        startDate.setDate(1); // Początek miesiąca

        const stats = await this.getStats(startDate, endDate);
        
        if (!stats || !stats.items) {
            return null;
        }

        const monthlyRevenue = stats.items.reduce(
            (sum, item) => sum + parseFloat(item.revenue || 0), 
            0
        );

        return {
            monthlyRevenue,
            // Jeśli API zwraca saldo, użyj go tutaj
            balance: stats.balance || null
        };
    }

    // Główna metoda - pobierz wszystkie statystyki z cache
    async getAllStats() {
        // Sprawdź cache
        if (this.cache.data && this.cache.timestamp) {
            const age = Date.now() - this.cache.timestamp;
            if (age < this.cache.ttl) {
                return this.cache.data;
            }
        }

        try {
            const [todayEarnings, last7Days, accountBalance] = await Promise.all([
                this.getTodayEarnings(),
                this.getLast7DaysEarnings(),
                this.getAccountBalance()
            ]);

            const data = {
                today: todayEarnings,
                last7Days: last7Days.total,
                monthlyRevenue: accountBalance?.monthlyRevenue || 0,
                balance: accountBalance?.balance || null,
                dailyStats: last7Days.daily,
                lastUpdated: new Date().toISOString()
            };

            // Zapisz do cache
            this.cache.data = data;
            this.cache.timestamp = Date.now();

            return data;
        } catch (error) {
            console.error('Błąd pobierania statystyk Adsterra:', error);
            
            // Zwróć dane z cache jeśli są dostępne
            if (this.cache.data) {
                return { ...this.cache.data, fromCache: true };
            }
            
            return null;
        }
    }
}

module.exports = new AdsterraService();