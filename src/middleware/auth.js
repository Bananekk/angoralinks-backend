// src/middleware/auth.js

const jwt = require('jsonwebtoken');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

// Middleware weryfikacji JWT
const auth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ 
        success: false, 
        message: 'Brak tokenu autoryzacji' 
      });
    }
    
    const token = authHeader.split(' ')[1];
    
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // Sprawdź czy użytkownik istnieje i jest aktywny
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: { id: true, isActive: true, isAdmin: true }
    });
    
    if (!user) {
      return res.status(401).json({ 
        success: false, 
        message: 'Użytkownik nie istnieje' 
      });
    }
    
    if (!user.isActive) {
      return res.status(403).json({ 
        success: false, 
        message: 'Konto zostało zablokowane' 
      });
    }
    
    req.userId = decoded.userId;
    req.isAdmin = user.isAdmin;
    
    next();
  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({ 
        success: false, 
        message: 'Nieprawidłowy token' 
      });
    }
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ 
        success: false, 
        message: 'Token wygasł' 
      });
    }
    
    console.error('Błąd autoryzacji:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Błąd serwera' 
    });
  }
};

// Middleware sprawdzania uprawnień admina
const isAdmin = (req, res, next) => {
  if (!req.isAdmin) {
    return res.status(403).json({ 
      success: false, 
      message: 'Brak uprawnień administratora' 
    });
  }
  next();
};

module.exports = { auth, isAdmin };