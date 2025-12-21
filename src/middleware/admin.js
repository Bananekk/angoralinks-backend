const isAdmin = (req, res, next) => {
    if (!req.user) {
        return res.status(401).json({ error: 'Nie zalogowano' });
    }

    if (!req.user.isAdmin) {
        return res.status(403).json({ error: 'Brak uprawnień administratora' });
    }

    next();
};

module.exports = { isAdmin };