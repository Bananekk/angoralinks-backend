const jwt = require('jsonwebtoken');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

// Middleware weryfikacji JWT
const verifyToken = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;
        
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'Brak tokenu autoryzacji' });
        }
        
        const token = authHeader.split(' ')[1];
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        
        const user = await prisma.user.findUnique({
            where: { id: decoded.userId },
            select: { 
                id: true, 
                isActive: true, 
                isAdmin: true, 
                email: true,
                username: true,
                balance: true
            }
        });
        
        if (!user) {
            return res.status(401).json({ error: 'Użytkownik nie istnieje' });
        }
        
        if (!user.isActive) {
            return res.status(403).json({ error: 'Konto zostało zablokowane' });
        }
        
        // ✅ Ustawia OBA formaty dla pełnej kompatybilności
        req.userId = user.id;      // Dla plików używających req.userId
        req.isAdmin = user.isAdmin; // Dla sprawdzania admina
        req.user = user;            // 🔥 Dla kontrolerów używających req.user.id
        
        next();
    } catch (error) {
        if (error.name === 'JsonWebTokenError') {
            return res.status(401).json({ error: 'Nieprawidłowy token' });
        }
        if (error.name === 'TokenExpiredError') {
            return res.status(401).json({ error: 'Token wygasł' });
        }
        console.error('Błąd autoryzacji:', error);
        res.status(500).json({ error: 'Błąd serwera' });
    }
};

// Middleware sprawdzania uprawnień admina
const isAdmin = (req, res, next) => {
    if (!req.isAdmin) {
        return res.status(403).json({ error: 'Brak uprawnień administratora' });
    }
    next();
};

// Eksportuj pod WSZYSTKIMI nazwami dla kompatybilności
module.exports = { 
    // Główne nazwy
    verifyToken, 
    isAdmin,
    
    // Aliasy dla kompatybilności wstecznej
    auth: verifyToken,
    authenticate: verifyToken,
    requireAdmin: isAdmin
};