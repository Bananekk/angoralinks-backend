// controllers/referralController.js
const ReferralService = require('../services/referralService');

class ReferralController {

    // GET /api/referrals/stats
    async getMyStats(req, res) {
        try {
            const stats = await ReferralService.getUserReferralStats(req.user.id);
            res.json(stats);
        } catch (error) {
            console.error('Error getting referral stats:', error);
            res.status(500).json({ error: 'Błąd pobierania statystyk referali' });
        }
    }

    // GET /api/referrals/commissions
    async getMyCommissions(req, res) {
        try {
            const page = parseInt(req.query.page) || 1;
            const limit = parseInt(req.query.limit) || 20;

            const commissions = await ReferralService.getUserCommissions(
                req.user.id,
                page,
                limit
            );

            res.json(commissions);
        } catch (error) {
            console.error('Error getting commissions:', error);
            res.status(500).json({ error: 'Błąd pobierania prowizji' });
        }
    }

    // GET /api/referrals/validate/:code
    async validateCode(req, res) {
        try {
            const { code } = req.params;
            const referrer = await ReferralService.validateReferralCode(code);

            res.json({
                valid: !!referrer,
                message: referrer ? 'Prawidłowy kod polecający' : 'Nieprawidłowy kod polecający'
            });
        } catch (error) {
            console.error('Error validating code:', error);
            res.status(500).json({ error: 'Błąd walidacji kodu' });
        }
    }

    // GET /api/referrals/settings
    async getPublicSettings(req, res) {
        try {
            const settings = await ReferralService.getSettings();
            res.json({
                commissionRate: parseFloat(settings.referralCommissionRate) * 100,
                bonusDuration: settings.referralBonusDuration,
                isActive: settings.referralSystemActive
            });
        } catch (error) {
            console.error('Error getting settings:', error);
            res.status(500).json({ error: 'Błąd pobierania ustawień' });
        }
    }

    // ============ ADMIN ENDPOINTS ============

    // GET /api/referrals/admin/stats
    async getAdminStats(req, res) {
        try {
            const stats = await ReferralService.getAdminStats();
            res.json(stats);
        } catch (error) {
            console.error('Error getting admin referral stats:', error);
            res.status(500).json({ error: 'Błąd pobierania statystyk admina' });
        }
    }

    // GET /api/referrals/admin/all
    async getAllReferrals(req, res) {
        try {
            const page = parseInt(req.query.page) || 1;
            const limit = parseInt(req.query.limit) || 50;
            const search = req.query.search || '';

            const result = await ReferralService.getAllReferrals(page, limit, search);
            res.json(result);
        } catch (error) {
            console.error('Error getting all referrals:', error);
            res.status(500).json({ error: 'Błąd pobierania referali' });
        }
    }

    // PUT /api/referrals/admin/settings
    async updateSettings(req, res) {
        try {
            const { commissionRate, bonusDuration, minPayout, isActive } = req.body;

            if (commissionRate !== undefined && (commissionRate < 0 || commissionRate > 50)) {
                return res.status(400).json({ error: 'Prowizja musi być między 0% a 50%' });
            }

            if (bonusDuration !== undefined && bonusDuration !== null && bonusDuration < 0) {
                return res.status(400).json({ error: 'Czas trwania bonusu musi być dodatni' });
            }

            const settings = await ReferralService.updateSettings({
                commissionRate,
                bonusDuration,
                minPayout,
                isActive
            });

            res.json({
                message: 'Ustawienia zaktualizowane',
                settings
            });
        } catch (error) {
            console.error('Error updating settings:', error);
            res.status(500).json({ error: 'Błąd aktualizacji ustawień' });
        }
    }
}

module.exports = new ReferralController();