// controllers/adminTwoFactorController.js
const twoFactorService = require('../services/twoFactorService');
const prisma = require('../config/database');
const { Resend } = require('resend');

const resend = new Resend(process.env.RESEND_API_KEY);

/**
 * Wysyła email z zaleceniem włączenia 2FA
 */
exports.recommendTwoFactor = async (req, res) => {
  try {
    const { id: targetUserId } = req.params;
    const adminId = req.user.id;
    
    const user = await prisma.user.findUnique({
      where: { id: targetUserId },
      select: { 
        email: true, 
        twoFactorEnabled: true,
        isActive: true 
      }
    });
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'Użytkownik nie znaleziony'
      });
    }
    
    if (user.twoFactorEnabled) {
      return res.status(400).json({
        success: false,
        message: 'Użytkownik ma już włączone 2FA'
      });
    }
    
    // Wyślij email
    await resend.emails.send({
      from: 'AngoraLinks <security@angoralinks.pl>',
      to: user.email,
      subject: 'Zalecenie włączenia dwuskładnikowego uwierzytelniania',
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
            .content { background: #f9fafb; padding: 30px; border-radius: 0 0 8px 8px; }
            .button { display: inline-block; background: #667eea; color: white; padding: 12px 30px; text-decoration: none; border-radius: 6px; margin: 20px 0; }
            .benefits { background: white; padding: 20px; border-radius: 8px; margin: 20px 0; }
            .benefit { display: flex; align-items: center; margin: 10px 0; }
            .benefit-icon { width: 24px; height: 24px; margin-right: 10px; color: #10b981; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>🔐 Zwiększ bezpieczeństwo konta</h1>
            </div>
            <div class="content">
              <p>Cześć!</p>
              
              <p>Zalecamy włączenie <strong>dwuskładnikowego uwierzytelniania (2FA)</strong> na Twoim koncie AngoraLinks.</p>
              
              <div class="benefits">
                <h3>Korzyści z 2FA:</h3>
                <div class="benefit">✅ Ochrona przed nieautoryzowanym dostępem</div>
                <div class="benefit">✅ Bezpieczeństwo nawet gdy hasło wycieknie</div>
                <div class="benefit">✅ Wsparcie dla aplikacji authenticator i kluczy sprzętowych</div>
                <div class="benefit">✅ Kody zapasowe na wypadek utraty urządzenia</div>
              </div>
              
              <p>Konfiguracja zajmuje tylko minutę:</p>
              
              <a href="https://angoralinks.pl/settings/security" class="button">
                Włącz 2FA teraz →
              </a>
              
              <p style="color: #666; font-size: 14px;">
                Jeśli masz pytania dotyczące bezpieczeństwa konta, skontaktuj się z nami.
              </p>
            </div>
          </div>
        </body>
        </html>
      `
    });
    
    // Zapisz log
    await prisma.twoFactorLog.create({
      data: {
        userId: targetUserId,
        action: 'ADMIN_REQUIRED', // Użyj istniejącego typu
        success: true,
        ipAddress: req.ip
      }
    });
    
    res.json({
      success: true,
      message: 'Email z zaleceniem został wysłany'
    });
  } catch (error) {
    console.error('Recommend 2FA error:', error);
    res.status(500).json({
      success: false,
      message: 'Błąd podczas wysyłania zalecenia'
    });
  }
};

/**
 * Wymusza 2FA dla użytkownika
 */
exports.requireTwoFactor = async (req, res) => {
  try {
    const { id: targetUserId } = req.params;
    const adminId = req.user.id;
    
    const user = await prisma.user.findUnique({
      where: { id: targetUserId },
      select: { 
        email: true, 
        twoFactorEnabled: true,
        twoFactorRequired: true,
        isActive: true 
      }
    });
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'Użytkownik nie znaleziony'
      });
    }
    
    if (user.twoFactorRequired) {
      return res.status(400).json({
        success: false,
        message: '2FA jest już wymagane dla tego użytkownika'
      });
    }
    
    await twoFactorService.requireTwoFactor(targetUserId, adminId);
    
    // Wyślij email informacyjny
    await resend.emails.send({
      from: 'AngoraLinks <security@angoralinks.pl>',
      to: user.email,
      subject: 'Wymagane dwuskładnikowe uwierzytelnianie',
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: #ef4444; color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
            .content { background: #f9fafb; padding: 30px; border-radius: 0 0 8px 8px; }
            .button { display: inline-block; background: #667eea; color: white; padding: 12px 30px; text-decoration: none; border-radius: 6px; margin: 20px 0; }
            .warning { background: #fef3c7; border-left: 4px solid #f59e0b; padding: 15px; margin: 20px 0; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>⚠️ Wymagane działanie</h1>
            </div>
            <div class="content">
              <p>Cześć!</p>
              
              <div class="warning">
                <strong>Administrator wymagał włączenia dwuskładnikowego uwierzytelniania (2FA) na Twoim koncie.</strong>
              </div>
              
              <p>Przy następnym logowaniu będziesz musiał(a) skonfigurować 2FA, aby kontynuować korzystanie z AngoraLinks.</p>
              
              <p>Możesz to zrobić teraz:</p>
              
              <a href="https://angoralinks.pl/settings/security" class="button">
                Skonfiguruj 2FA →
              </a>
              
              <p>Dostępne metody:</p>
              <ul>
                <li>📱 Aplikacja Authenticator (Google Authenticator, Authy)</li>
                <li>🔑 Klucz sprzętowy (YubiKey)</li>
                <li>👆 Biometria urządzenia (Face ID, Touch ID, Windows Hello)</li>
              </ul>
              
              <p style="color: #666; font-size: 14px;">
                Jeśli masz pytania, skontaktuj się z supportem.
              </p>
            </div>
          </div>
        </body>
        </html>
      `
    });
    
    res.json({
      success: true,
      message: '2FA zostało wymuszone dla użytkownika'
    });
  } catch (error) {
    console.error('Require 2FA error:', error);
    res.status(500).json({
      success: false,
      message: 'Błąd podczas wymuszania 2FA'
    });
  }
};

/**
 * Usuwa wymóg 2FA
 */
exports.removeRequireTwoFactor = async (req, res) => {
  try {
    const { id: targetUserId } = req.params;
    
    const user = await prisma.user.findUnique({
      where: { id: targetUserId },
      select: { twoFactorRequired: true }
    });
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'Użytkownik nie znaleziony'
      });
    }
    
    if (!user.twoFactorRequired) {
      return res.status(400).json({
        success: false,
        message: '2FA nie jest wymagane dla tego użytkownika'
      });
    }
    
    await twoFactorService.removeRequireTwoFactor(targetUserId);
    
    res.json({
      success: true,
      message: 'Wymóg 2FA został usunięty'
    });
  } catch (error) {
    console.error('Remove require 2FA error:', error);
    res.status(500).json({
      success: false,
      message: 'Błąd podczas usuwania wymogu 2FA'
    });
  }
};

/**
 * Resetuje 2FA użytkownika
 */
exports.resetTwoFactor = async (req, res) => {
  try {
    const { id: targetUserId } = req.params;
    const adminId = req.user.id;
    const { sendEmail } = req.body;
    
    const user = await prisma.user.findUnique({
      where: { id: targetUserId },
      select: { 
        email: true, 
        twoFactorEnabled: true 
      }
    });
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'Użytkownik nie znaleziony'
      });
    }
    
    if (!user.twoFactorEnabled) {
      return res.status(400).json({
        success: false,
        message: 'Użytkownik nie ma włączonego 2FA'
      });
    }
    
    await twoFactorService.adminResetTwoFactor(targetUserId, adminId);
    
    // Opcjonalnie wyślij email
    if (sendEmail !== false) {
      await resend.emails.send({
        from: 'AngoraLinks <security@angoralinks.pl>',
        to: user.email,
        subject: 'Twoje 2FA zostało zresetowane',
        html: `
          <!DOCTYPE html>
          <html>
          <head>
            <meta charset="utf-8">
            <style>
              body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
              .container { max-width: 600px; margin: 0 auto; padding: 20px; }
              .header { background: #f59e0b; color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
              .content { background: #f9fafb; padding: 30px; border-radius: 0 0 8px 8px; }
              .button { display: inline-block; background: #667eea; color: white; padding: 12px 30px; text-decoration: none; border-radius: 6px; margin: 20px 0; }
              .warning { background: #fee2e2; border-left: 4px solid #ef4444; padding: 15px; margin: 20px 0; }
            </style>
          </head>
          <body>
            <div class="container">
              <div class="header">
                <h1>🔓 2FA zresetowane</h1>
              </div>
              <div class="content">
                <p>Cześć!</p>
                
                <p>Dwuskładnikowe uwierzytelnianie zostało zresetowane na Twoim koncie AngoraLinks przez administratora.</p>
                
                <div class="warning">
                  <strong>Jeśli nie prosiłeś(aś) o reset 2FA, natychmiast skontaktuj się z supportem!</strong>
                </div>
                
                <p>Zalecamy ponowne skonfigurowanie 2FA w celu ochrony konta:</p>
                
                <a href="https://angoralinks.pl/settings/security" class="button">
                  Skonfiguruj 2FA ponownie →
                </a>
                
                <p style="color: #666; font-size: 14px;">
                  Data resetowania: ${new Date().toLocaleString('pl-PL')}
                </p>
              </div>
            </div>
          </body>
          </html>
        `
      });
    }
    
    res.json({
      success: true,
      message: '2FA zostało zresetowane'
    });
  } catch (error) {
    console.error('Reset 2FA error:', error);
    res.status(500).json({
      success: false,
      message: 'Błąd podczas resetowania 2FA'
    });
  }
};

/**
 * Pobiera status 2FA użytkownika (dla admina)
 */
exports.getUserTwoFactorStatus = async (req, res) => {
  try {
    const { id: targetUserId } = req.params;
    
    const status = await twoFactorService.getTwoFactorStatus(targetUserId);
    
    // Pobierz logi 2FA
    const logs = await prisma.twoFactorLog.findMany({
      where: { userId: targetUserId },
      orderBy: { createdAt: 'desc' },
      take: 10
    });
    
    res.json({
      success: true,
      data: {
        ...status,
        recentLogs: logs
      }
    });
  } catch (error) {
    console.error('Get user 2FA status error:', error);
    res.status(500).json({
      success: false,
      message: 'Błąd podczas pobierania statusu 2FA'
    });
  }
};

/**
 * Pobiera listę użytkowników ze statusem 2FA
 */
exports.getUsersWithTwoFactorStatus = async (req, res) => {
  try {
    const { page = 1, limit = 20, filter } = req.query;
    const skip = (page - 1) * limit;
    
    let where = {};
    
    if (filter === 'enabled') {
      where.twoFactorEnabled = true;
    } else if (filter === 'disabled') {
      where.twoFactorEnabled = false;
    } else if (filter === 'required') {
      where.twoFactorRequired = true;
    }
    
    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        select: {
          id: true,
          email: true,
          twoFactorEnabled: true,
          twoFactorMethod: true,
          twoFactorRequired: true,
          twoFactorEnabledAt: true,
          twoFactorLastUsedAt: true,
          createdAt: true,
          lastLoginAt: true,
          isActive: true,
          _count: {
            select: {
              webAuthnCredentials: true,
              backupCodes: {
                where: { usedAt: null }
              }
            }
          }
        },
        skip,
        take: parseInt(limit),
        orderBy: { createdAt: 'desc' }
      }),
      prisma.user.count({ where })
    ]);
    
    res.json({
      success: true,
      data: {
        users: users.map(user => ({
          ...user,
          webAuthnCount: user._count.webAuthnCredentials,
          backupCodesRemaining: user._count.backupCodes
        })),
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / limit)
        }
      }
    });
  } catch (error) {
    console.error('Get users with 2FA status error:', error);
    res.status(500).json({
      success: false,
      message: 'Błąd podczas pobierania listy użytkowników'
    });
  }
};