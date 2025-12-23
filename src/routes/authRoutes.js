// src/routes/auth.js

const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { PrismaClient } = require('@prisma/client');
const { sendVerificationEmail } = require('../utils/email');
const { encrypt } = require('../utils/encryption');
const { getClientIp, getUserAgent } = require('../utils/ipHelper');

const router = express.Router();
const prisma = new PrismaClient();

// Rejestracja
router.post('/register', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    // Pobierz IP i User-Agent
    const clientIp = getClientIp(req);
    const userAgent = getUserAgent(req);
    
    // Walidacja
    if (!email || !password) {
      return res.status(400).json({ 
        success: false, 
        message: 'Email i hasło są wymagane' 
      });
    }
    
    if (password.length < 8) {
      return res.status(400).json({ 
        success: false, 
        message: 'Hasło musi mieć minimum 8 znaków' 
      });
    }
    
    // Sprawdź czy użytkownik istnieje
    const existingUser = await prisma.user.findUnique({
      where: { email: email.toLowerCase() }
    });
    
    if (existingUser) {
      return res.status(400).json({ 
        success: false, 
        message: 'Użytkownik z tym emailem już istnieje' 
      });
    }
    
    // Hashuj hasło
    const hashedPassword = await bcrypt.hash(password, 12);
    
    // Token weryfikacyjny
    const verifyToken = crypto.randomBytes(32).toString('hex');
    
    // Zaszyfruj IP
    const encryptedIp = encrypt(clientIp);
    
    // Utwórz użytkownika
    const user = await prisma.user.create({
      data: {
        email: email.toLowerCase(),
        password: hashedPassword,
        verifyToken,
        registrationIp: encryptedIp,
        lastLoginIp: encryptedIp,
        lastLoginAt: new Date()
      }
    });
    
    // Zapisz log IP
    await prisma.ipLog.create({
      data: {
        userId: user.id,
        encryptedIp,
        action: 'REGISTER',
        userAgent
      }
    });
    
    // Wyślij email weryfikacyjny
    try {
      await sendVerificationEmail(email, verifyToken);
    } catch (emailError) {
      console.error('Błąd wysyłania emaila:', emailError);
      // Kontynuuj mimo błędu emaila
    }
    
    res.status(201).json({
      success: true,
      message: 'Konto zostało utworzone. Sprawdź email aby je zweryfikować.'
    });
    
  } catch (error) {
    console.error('Błąd rejestracji:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Błąd serwera podczas rejestracji' 
    });
  }
});

// Logowanie
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    // Pobierz IP i User-Agent
    const clientIp = getClientIp(req);
    const userAgent = getUserAgent(req);
    
    // Walidacja
    if (!email || !password) {
      return res.status(400).json({ 
        success: false, 
        message: 'Email i hasło są wymagane' 
      });
    }
    
    // Znajdź użytkownika
    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase() }
    });
    
    if (!user) {
      return res.status(401).json({ 
        success: false, 
        message: 'Nieprawidłowy email lub hasło' 
      });
    }
    
    // Sprawdź czy konto jest aktywne
    if (!user.isActive) {
      return res.status(403).json({ 
        success: false, 
        message: 'Twoje konto zostało zablokowane' 
      });
    }
    
    // Sprawdź hasło
    const isPasswordValid = await bcrypt.compare(password, user.password);
    
    if (!isPasswordValid) {
      return res.status(401).json({ 
        success: false, 
        message: 'Nieprawidłowy email lub hasło' 
      });
    }
    
    // Sprawdź weryfikację
    if (!user.isVerified) {
      return res.status(403).json({ 
        success: false, 
        message: 'Zweryfikuj swój email przed zalogowaniem' 
      });
    }
    
    // Zaszyfruj IP
    const encryptedIp = encrypt(clientIp);
    
    // Aktualizuj ostatnie logowanie
    await prisma.user.update({
      where: { id: user.id },
      data: {
        lastLoginIp: encryptedIp,
        lastLoginAt: new Date()
      }
    });
    
    // Zapisz log IP
    await prisma.ipLog.create({
      data: {
        userId: user.id,
        encryptedIp,
        action: 'LOGIN',
        userAgent
      }
    });
    
    // Generuj JWT
    const token = jwt.sign(
      { 
        userId: user.id, 
        email: user.email,
        isAdmin: user.isAdmin 
      },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );
    
    res.json({
      success: true,
      message: 'Zalogowano pomyślnie',
      token,
      user: {
        id: user.id,
        email: user.email,
        isAdmin: user.isAdmin,
        balance: user.balance,
        totalEarned: user.totalEarned
      }
    });
    
  } catch (error) {
    console.error('Błąd logowania:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Błąd serwera podczas logowania' 
    });
  }
});

// Weryfikacja emaila
router.get('/verify/:token', async (req, res) => {
  try {
    const { token } = req.params;
    
    const user = await prisma.user.findFirst({
      where: { verifyToken: token }
    });
    
    if (!user) {
      return res.status(400).json({ 
        success: false, 
        message: 'Nieprawidłowy token weryfikacyjny' 
      });
    }
    
    await prisma.user.update({
      where: { id: user.id },
      data: {
        isVerified: true,
        verifyToken: null
      }
    });
    
    res.json({
      success: true,
      message: 'Email został zweryfikowany. Możesz się teraz zalogować.'
    });
    
  } catch (error) {
    console.error('Błąd weryfikacji:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Błąd serwera podczas weryfikacji' 
    });
  }
});

// Pobierz aktualnego użytkownika
router.get('/me', require('../middleware/auth'), async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.userId },
      select: {
        id: true,
        email: true,
        isAdmin: true,
        balance: true,
        totalEarned: true,
        createdAt: true,
        isVerified: true
      }
    });
    
    if (!user) {
      return res.status(404).json({ 
        success: false, 
        message: 'Użytkownik nie znaleziony' 
      });
    }
    
    res.json({
      success: true,
      user
    });
    
  } catch (error) {
    console.error('Błąd pobierania użytkownika:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Błąd serwera' 
    });
  }
});

module.exports = router;