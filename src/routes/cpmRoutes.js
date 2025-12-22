const express = require('express');
const router = express.Router();
const linkService = require('../services/linkService');
const { authenticate, requireAdmin } = require('../middleware/auth');

// ===== PUBLIC ROUTES (wymagają logowania) =====

// GET /api/cpm/rates - Pobierz stawki pogrupowane według tierów (dla dashboardu użytkownika)
router.get('/rates', authenticate, async (req, res) => {
    try {
        const rates = await linkService.getRatesGroupedByTier();
        res.json({
            success: true,
            data: rates
        });
    } catch (error) {
        console.error('Błąd pobierania stawek CPM:', error);
        res.status(500).json({
            success: false,
            error: 'Nie udało się pobrać stawek CPM'
        });
    }
});

// GET /api/cpm/rates/:countryCode - Pobierz stawkę dla konkretnego kraju
router.get('/rates/:countryCode', authenticate, async (req, res) => {
    try {
        const { countryCode } = req.params;
        const earning = await linkService.getEarningDetails(countryCode);
        res.json({
            success: true,
            data: earning
        });
    } catch (error) {
        console.error('Błąd pobierania stawki dla kraju:', error);
        res.status(500).json({
            success: false,
            error: 'Nie udało się pobrać stawki'
        });
    }
});

// ===== ADMIN ROUTES =====

// GET /api/cpm/admin/rates - Pobierz wszystkie stawki (dla admina)
router.get('/admin/rates', authenticate, requireAdmin, async (req, res) => {
    try {
        const rates = await linkService.getAllRates();
        const settings = await linkService.getSettings();
        
        res.json({
            success: true,
            data: {
                rates,
                settings
            }
        });
    } catch (error) {
        console.error('Błąd pobierania stawek admina:', error);
        res.status(500).json({
            success: false,
            error: 'Nie udało się pobrać stawek'
        });
    }
});

// PUT /api/cpm/admin/rates/:countryCode - Aktualizuj stawkę dla kraju
router.put('/admin/rates/:countryCode', authenticate, requireAdmin, async (req, res) => {
    try {
        const { countryCode } = req.params;
        const { cpmRate } = req.body;

        if (cpmRate === undefined || isNaN(cpmRate) || cpmRate < 0) {
            return res.status(400).json({
                success: false,
                error: 'Nieprawidłowa stawka CPM'
            });
        }

        const updated = await linkService.updateRate(
            countryCode.toUpperCase(),
            parseFloat(cpmRate),
            req.user.id
        );

        res.json({
            success: true,
            message: `Stawka CPM dla ${countryCode} zaktualizowana`,
            data: updated
        });
    } catch (error) {
        console.error('Błąd aktualizacji stawki:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Nie udało się zaktualizować stawki'
        });
    }
});

// POST /api/cpm/admin/rates - Dodaj nowy kraj
router.post('/admin/rates', authenticate, requireAdmin, async (req, res) => {
    try {
        const { countryCode, countryName, tier, cpmRate } = req.body;

        if (!countryCode || !countryName || cpmRate === undefined) {
            return res.status(400).json({
                success: false,
                error: 'Brakujące wymagane pola: countryCode, countryName, cpmRate'
            });
        }

        const rate = await linkService.addCountry({
            countryCode: countryCode.toUpperCase(),
            countryName,
            tier: tier || 3,
            cpmRate: parseFloat(cpmRate)
        }, req.user.id);

        res.status(201).json({
            success: true,
            message: 'Kraj dodany pomyślnie',
            data: rate
        });
    } catch (error) {
        console.error('Błąd dodawania kraju:', error);
        res.status(500).json({
            success: false,
            error: 'Nie udało się dodać kraju'
        });
    }
});

// POST /api/cpm/admin/rates/bulk - Bulk update stawek
router.post('/admin/rates/bulk', authenticate, requireAdmin, async (req, res) => {
    try {
        const { rates } = req.body;

        if (!Array.isArray(rates)) {
            return res.status(400).json({
                success: false,
                error: 'Rates musi być tablicą'
            });
        }

        const results = await linkService.bulkUpdateRates(rates, req.user.id);

        const successCount = results.filter(r => r.success).length;
        const failCount = results.filter(r => !r.success).length;

        res.json({
            success: true,
            message: `Zaktualizowano ${successCount} stawek, ${failCount} błędów`,
            data: results
        });
    } catch (error) {
        console.error('Błąd bulk update:', error);
        res.status(500).json({
            success: false,
            error: 'Nie udało się przetworzyć bulk update'
        });
    }
});

// PUT /api/cpm/admin/settings/:key - Aktualizuj ustawienie platformy
router.put('/admin/settings/:key', authenticate, requireAdmin, async (req, res) => {
    try {
        const { key } = req.params;
        const { value } = req.body;

        if (value === undefined) {
            return res.status(400).json({
                success: false,
                error: 'Brakująca wartość'
            });
        }

        const updated = await linkService.updateSetting(key, value, req.user.id);

        res.json({
            success: true,
            message: 'Ustawienie zaktualizowane',
            data: updated
        });
    } catch (error) {
        console.error('Błąd aktualizacji ustawienia:', error);
        res.status(500).json({
            success: false,
            error: 'Nie udało się zaktualizować ustawienia'
        });
    }
});

// GET /api/cpm/admin/history - Historia zmian stawek
router.get('/admin/history', authenticate, requireAdmin, async (req, res) => {
    try {
        const { countryCode, limit } = req.query;
        const history = await linkService.getRateHistory(
            countryCode,
            parseInt(limit) || 50
        );

        res.json({
            success: true,
            data: history
        });
    } catch (error) {
        console.error('Błąd pobierania historii:', error);
        res.status(500).json({
            success: false,
            error: 'Nie udało się pobrać historii'
        });
    }
});

// POST /api/cpm/admin/clear-cache - Wyczyść cache stawek
router.post('/admin/clear-cache', authenticate, requireAdmin, async (req, res) => {
    try {
        linkService.clearCache();
        res.json({
            success: true,
            message: 'Cache wyczyszczony'
        });
    } catch (error) {
        console.error('Błąd czyszczenia cache:', error);
        res.status(500).json({
            success: false,
            error: 'Nie udało się wyczyścić cache'
        });
    }
});

module.exports = router;