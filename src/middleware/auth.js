const authService = require('../services/authService');

const authenticate = async (req, res, next) => {
    try {
        let token = null;

        const authHeader = req.headers.authorization;
        if (authHeader && authHeader.startsWith('Bearer ')) {
            token = authHeader.substring(7);
        }

        if (!token && req.cookies.token) {
            token = req.cookies.token;
        }

        if (!token) {
            return res.status(401).json({
                error: 'Brak tokenu autoryzacji'
            });
        }

        const decoded = authService.verifyToken(token);
        if (!decoded) {
            return res.status(401).json({
                error: 'Nieprawidłowy token'
            });
        }

        const user = await authService.findById(decoded.userId);
        if (!user) {
            return res.status(401).json({
                error: 'Użytkownik nie istnieje'
            });
        }

        req.user = {
            id: user.id,
            email: user.email,
            balance: parseFloat(user.balance),
            totalEarned: parseFloat(user.totalEarned),
            isVerified: user.isVerified,
            isAdmin: user.isAdmin
        };

        next();
    } catch (error) {
        console.error('Błąd autoryzacji:', error);
        res.status(500).json({
            error: 'Błąd serwera podczas autoryzacji'
        });
    }
};

const optionalAuth = async (req, res, next) => {
    try {
        let token = null;

        const authHeader = req.headers.authorization;
        if (authHeader && authHeader.startsWith('Bearer ')) {
            token = authHeader.substring(7);
        }

        if (!token && req.cookies.token) {
            token = req.cookies.token;
        }

        if (token) {
            const decoded = authService.verifyToken(token);
            if (decoded) {
                const user = await authService.findById(decoded.userId);
                if (user) {
                    req.user = {
                        id: user.id,
                        email: user.email,
                        balance: parseFloat(user.balance),
                        totalEarned: parseFloat(user.totalEarned),
                        isVerified: user.isVerified,
                        isAdmin: user.isAdmin
                    };
                }
            }
        }

        next();
    } catch (error) {
        next();
    }
};

module.exports = { authenticate, optionalAuth };