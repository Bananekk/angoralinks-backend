const { Resend } = require('resend');

const resend = new Resend(process.env.RESEND_API_KEY);
const DEFAULT_FROM = process.env.EMAIL_FROM || 'AngoraLinks <noreply@angoralinks.pl>';
const FRONTEND_URL = process.env.FRONTEND_URL || 'https://angoralinks.pl';

/**
 * Generuje 6-cyfrowy kod weryfikacyjny
 */
function generateCode() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

/**
 * Wysyła email z kodem weryfikacyjnym
 */
async function sendVerificationEmail(email, code) {
    try {
        const result = await resend.emails.send({
            from: DEFAULT_FROM,
            to: email,
            subject: 'Twój kod weryfikacyjny - AngoraLinks',
            html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #0f172a;">
                    <div style="background-color: #1e293b; border-radius: 16px; padding: 32px;">
                        <div style="text-align: center; margin-bottom: 24px;">
                            <h1 style="color: #0ea5e9; margin: 0;">🔗 AngoraLinks</h1>
                        </div>
                        <h2 style="color: #f8fafc; text-align: center;">Weryfikacja konta</h2>
                        <p style="color: #94a3b8; text-align: center;">Twój kod weryfikacyjny:</p>
                        <div style="background-color: #0f172a; border-radius: 12px; padding: 24px; text-align: center; margin: 24px 0;">
                            <span style="font-size: 36px; font-weight: bold; letter-spacing: 8px; color: #0ea5e9;">${code}</span>
                        </div>
                        <p style="color: #94a3b8; text-align: center;">Kod wygasa za <strong style="color: #f8fafc;">15 minut</strong>.</p>
                        <p style="color: #64748b; font-size: 12px; text-align: center; margin-top: 24px;">
                            Jeśli nie rejestrowałeś się w AngoraLinks, zignoruj tę wiadomość.
                        </p>
                    </div>
                </div>
            `
        });
        
        console.log(`✅ Email weryfikacyjny wysłany do: ${email}`);
        return true;
    } catch (error) {
        console.error('❌ Błąd wysyłania emaila:', error.message);
        throw error;
    }
}

/**
 * Wysyła email powitalny po weryfikacji konta
 */
async function sendWelcomeEmail(email) {
    try {
        const result = await resend.emails.send({
            from: DEFAULT_FROM,
            to: email,
            subject: 'Witaj w AngoraLinks! 🎉',
            html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #0f172a;">
                    <div style="background-color: #1e293b; border-radius: 16px; padding: 32px;">
                        <div style="text-align: center; margin-bottom: 24px;">
                            <h1 style="color: #0ea5e9; margin: 0;">🔗 AngoraLinks</h1>
                        </div>
                        <div style="background-color: rgba(34, 197, 94, 0.2); border: 1px solid #22c55e; border-radius: 12px; padding: 20px; text-align: center; margin: 24px 0;">
                            <span style="font-size: 48px;">✅</span>
                            <h2 style="color: #22c55e; margin: 8px 0;">Konto aktywowane!</h2>
                        </div>
                        <p style="color: #94a3b8; text-align: center;">Twoje konto zostało pomyślnie zweryfikowane. Możesz teraz:</p>
                        <ul style="color: #94a3b8; padding-left: 20px;">
                            <li style="margin: 8px 0;">🔗 Tworzyć skrócone linki</li>
                            <li style="margin: 8px 0;">💰 Zarabiać na reklamach</li>
                            <li style="margin: 8px 0;">📊 Śledzić statystyki w czasie rzeczywistym</li>
                            <li style="margin: 8px 0;">💸 Wypłacać zarobki od $10</li>
                        </ul>
                        <div style="text-align: center; margin-top: 24px;">
                            <a href="${FRONTEND_URL}/dashboard" style="display: inline-block; background-color: #0ea5e9; color: #ffffff; padding: 12px 32px; border-radius: 8px; text-decoration: none; font-weight: bold;">
                                Przejdź do panelu
                            </a>
                        </div>
                        <p style="color: #64748b; font-size: 12px; text-align: center; margin-top: 24px;">
                            © 2025 AngoraLinks. Wszystkie prawa zastrzeżone.
                        </p>
                    </div>
                </div>
            `
        });
        
        console.log(`✅ Welcome email wysłany do: ${email}`);
        return true;
    } catch (error) {
        console.error('❌ Błąd welcome email:', error.message);
        return false;
    }
}

/**
 * Wysyła email z kodem do resetu hasła
 */
async function sendPasswordResetEmail(email, code) {
    try {
        const result = await resend.emails.send({
            from: DEFAULT_FROM,
            to: email,
            subject: 'Reset hasła - AngoraLinks',
            html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #0f172a;">
                    <div style="background-color: #1e293b; border-radius: 16px; padding: 32px;">
                        <div style="text-align: center; margin-bottom: 24px;">
                            <h1 style="color: #0ea5e9; margin: 0;">🔗 AngoraLinks</h1>
                        </div>
                        <h2 style="color: #f8fafc; text-align: center;">Reset hasła</h2>
                        <p style="color: #94a3b8; text-align: center;">Twój kod do resetu hasła:</p>
                        <div style="background-color: #0f172a; border-radius: 12px; padding: 24px; text-align: center; margin: 24px 0;">
                            <span style="font-size: 36px; font-weight: bold; letter-spacing: 8px; color: #0ea5e9;">${code}</span>
                        </div>
                        <p style="color: #ef4444; text-align: center;">⏰ Kod wygasa za <strong>1 godzinę</strong>.</p>
                        <p style="color: #64748b; font-size: 12px; text-align: center; margin-top: 24px;">
                            Jeśli nie prosiłeś o reset hasła, zignoruj tę wiadomość.
                        </p>
                    </div>
                </div>
            `
        });
        
        console.log(`✅ Email resetujący wysłany do: ${email}`);
        return true;
    } catch (error) {
        console.error('❌ Błąd wysyłania emaila:', error.message);
        throw error;
    }
}

/**
 * Wysyła powiadomienie o wypłacie
 */
async function sendPayoutNotification(email, amount, status, method) {
    const statusConfig = {
        'COMPLETED': { text: 'została zrealizowana', icon: '✅', color: '#22c55e' },
        'REJECTED': { text: 'została odrzucona', icon: '❌', color: '#ef4444' },
        'PROCESSING': { text: 'jest przetwarzana', icon: '⏳', color: '#eab308' }
    };
    
    const config = statusConfig[status] || statusConfig['PROCESSING'];
    
    try {
        const result = await resend.emails.send({
            from: DEFAULT_FROM,
            to: email,
            subject: `${config.icon} Wypłata ${config.text} - AngoraLinks`,
            html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #0f172a;">
                    <div style="background-color: #1e293b; border-radius: 16px; padding: 32px;">
                        <div style="text-align: center; margin-bottom: 24px;">
                            <h1 style="color: #0ea5e9; margin: 0;">🔗 AngoraLinks</h1>
                        </div>
                        <h2 style="color: #f8fafc; text-align: center;">Status wypłaty</h2>
                        <div style="background-color: #0f172a; border-radius: 12px; padding: 24px; text-align: center; margin: 24px 0;">
                            <p style="color: #94a3b8; margin: 0 0 8px 0;">Twoja wypłata</p>
                            <p style="font-size: 32px; font-weight: bold; color: #22c55e; margin: 0;">$${parseFloat(amount).toFixed(2)}</p>
                            <p style="color: #94a3b8; margin: 8px 0 0 0;">przez <strong style="color: #f8fafc;">${method}</strong></p>
                        </div>
                        <div style="text-align: center; padding: 16px; border-radius: 8px; background-color: ${config.color}20; border: 1px solid ${config.color};">
                            <span style="font-size: 24px;">${config.icon}</span>
                            <p style="color: ${config.color}; margin: 8px 0 0 0; font-weight: bold;">${config.text.charAt(0).toUpperCase() + config.text.slice(1)}</p>
                        </div>
                        ${status === 'COMPLETED' ? '<p style="color: #22c55e; text-align: center; margin-top: 16px;">Środki powinny dotrzeć w ciągu 1-3 dni roboczych.</p>' : ''}
                        ${status === 'REJECTED' ? '<p style="color: #ef4444; text-align: center; margin-top: 16px;">Jeśli masz pytania, skontaktuj się z nami.</p>' : ''}
                        <p style="color: #64748b; font-size: 12px; text-align: center; margin-top: 24px;">
                            © 2025 AngoraLinks
                        </p>
                    </div>
                </div>
            `
        });
        
        console.log(`✅ Email o wypłacie wysłany do: ${email}`);
        return true;
    } catch (error) {
        console.error('❌ Błąd wysyłania emaila:', error.message);
        return false;
    }
}

/**
 * Wysyła potwierdzenie otrzymania wiadomości kontaktowej
 */
async function sendContactConfirmation(email, name, subject) {
    try {
        const result = await resend.emails.send({
            from: DEFAULT_FROM,
            to: email,
            subject: 'Otrzymaliśmy Twoją wiadomość - AngoraLinks',
            html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #0f172a;">
                    <div style="background-color: #1e293b; border-radius: 16px; padding: 32px;">
                        <div style="text-align: center; margin-bottom: 24px;">
                            <h1 style="color: #0ea5e9; margin: 0;">🔗 AngoraLinks</h1>
                        </div>
                        <div style="text-align: center; margin-bottom: 24px;">
                            <span style="font-size: 48px;">📨</span>
                            <h2 style="color: #f8fafc; margin: 8px 0;">Otrzymaliśmy Twoją wiadomość!</h2>
                        </div>
                        <p style="color: #94a3b8;">Cześć <strong style="color: #f8fafc;">${name}</strong>!</p>
                        <p style="color: #94a3b8;">Dziękujemy za kontakt. Otrzymaliśmy Twoją wiadomość:</p>
                        <div style="background-color: #0f172a; border-radius: 8px; padding: 16px; margin: 16px 0; border-left: 4px solid #0ea5e9;">
                            <p style="color: #0ea5e9; margin: 0; font-weight: bold;">${subject}</p>
                        </div>
                        <p style="color: #94a3b8;">Odpowiemy w ciągu <strong style="color: #f8fafc;">24-48 godzin</strong>.</p>
                        <p style="color: #64748b; font-size: 12px; text-align: center; margin-top: 24px;">
                            Pozdrawiamy,<br>Zespół AngoraLinks
                        </p>
                    </div>
                </div>
            `
        });
        
        console.log(`✅ Potwierdzenie kontaktu wysłane do: ${email}`);
        return true;
    } catch (error) {
        console.error('❌ Błąd wysyłania emaila:', error.message);
        return false;
    }
}

/**
 * Wysyła powiadomienie że wiadomość została przeczytana
 */
async function sendMessageReadNotification(email, name, subject) {
    try {
        const result = await resend.emails.send({
            from: DEFAULT_FROM,
            to: email,
            subject: 'Twoja wiadomość została przeczytana - AngoraLinks',
            html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #0f172a;">
                    <div style="background-color: #1e293b; border-radius: 16px; padding: 32px;">
                        <div style="text-align: center; margin-bottom: 24px;">
                            <h1 style="color: #0ea5e9; margin: 0;">🔗 AngoraLinks</h1>
                        </div>
                        <div style="text-align: center; margin-bottom: 24px;">
                            <span style="font-size: 48px;">👀</span>
                            <h2 style="color: #f8fafc; margin: 8px 0;">Wiadomość przeczytana</h2>
                        </div>
                        <p style="color: #94a3b8;">Cześć <strong style="color: #f8fafc;">${name}</strong>!</p>
                        <p style="color: #94a3b8;">Twoja wiadomość została przeczytana przez nasz zespół:</p>
                        <div style="background-color: #0f172a; border-radius: 8px; padding: 16px; margin: 16px 0; border-left: 4px solid #22c55e;">
                            <p style="color: #22c55e; margin: 0; font-weight: bold;">"${subject}"</p>
                        </div>
                        <p style="color: #94a3b8;">Jeśli Twoja wiadomość wymaga odpowiedzi, wkrótce się odezwiemy.</p>
                        <p style="color: #64748b; font-size: 12px; text-align: center; margin-top: 24px;">
                            Pozdrawiamy,<br>Zespół AngoraLinks
                        </p>
                    </div>
                </div>
            `
        });
        
        console.log(`✅ Powiadomienie o przeczytaniu wysłane do: ${email}`);
        return true;
    } catch (error) {
        console.error('❌ Błąd wysyłania emaila:', error.message);
        return false;
    }
}

/**
 * Wysyła email po usunięciu konta
 */
async function sendAccountDeletedEmail(email) {
    try {
        const result = await resend.emails.send({
            from: DEFAULT_FROM,
            to: email,
            subject: 'Twoje konto zostało usunięte - AngoraLinks',
            html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #0f172a;">
                    <div style="background-color: #1e293b; border-radius: 16px; padding: 32px;">
                        <div style="text-align: center; margin-bottom: 24px;">
                            <h1 style="color: #0ea5e9; margin: 0;">🔗 AngoraLinks</h1>
                        </div>
                        <div style="text-align: center; margin-bottom: 24px;">
                            <span style="font-size: 48px;">👋</span>
                            <h2 style="color: #f8fafc; margin: 8px 0;">Konto usunięte</h2>
                        </div>
                        <p style="color: #94a3b8; text-align: center;">
                            Twoje konto w AngoraLinks zostało pomyślnie usunięte zgodnie z Twoją prośbą.
                        </p>
                        <div style="background-color: #0f172a; border-radius: 8px; padding: 16px; margin: 24px 0;">
                            <p style="color: #94a3b8; margin: 0; font-size: 14px;">
                                <strong style="color: #f8fafc;">Co zostało usunięte:</strong>
                            </p>
                            <ul style="color: #94a3b8; margin: 8px 0 0 0; padding-left: 20px; font-size: 14px;">
                                <li>Twoje dane osobowe</li>
                                <li>Wszystkie utworzone linki</li>
                                <li>Historia wizyt i zarobków</li>
                            </ul>
                        </div>
                        <p style="color: #94a3b8; text-align: center;">
                            Dziękujemy za korzystanie z AngoraLinks!<br>
                            Jeśli kiedykolwiek zmienisz zdanie, zawsze możesz utworzyć nowe konto.
                        </p>
                        <div style="text-align: center; margin-top: 24px;">
                            <a href="${FRONTEND_URL}" style="display: inline-block; background-color: #0ea5e9; color: #ffffff; padding: 12px 32px; border-radius: 8px; text-decoration: none; font-weight: bold;">
                                Odwiedź stronę
                            </a>
                        </div>
                        <p style="color: #64748b; font-size: 12px; text-align: center; margin-top: 24px;">
                            © 2025 AngoraLinks
                        </p>
                    </div>
                </div>
            `
        });
        
        console.log(`✅ Email o usunięciu konta wysłany do: ${email}`);
        return true;
    } catch (error) {
        console.error('❌ Błąd wysyłania emaila:', error.message);
        return false;
    }
}

// =============================================
// 🆕 EMAILE 2FA (Two-Factor Authentication)
// =============================================

/**
 * Wysyła email z zaleceniem włączenia 2FA
 */
async function sendTwoFactorRecommendation(email) {
    try {
        const result = await resend.emails.send({
            from: DEFAULT_FROM,
            to: email,
            subject: '🔐 Zalecenie włączenia 2FA - AngoraLinks',
            html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #0f172a;">
                    <div style="background-color: #1e293b; border-radius: 16px; padding: 32px;">
                        <div style="text-align: center; margin-bottom: 24px;">
                            <h1 style="color: #0ea5e9; margin: 0;">🔗 AngoraLinks</h1>
                        </div>
                        
                        <div style="text-align: center; margin-bottom: 24px;">
                            <span style="font-size: 48px;">🔐</span>
                            <h2 style="color: #f8fafc; margin: 8px 0;">Zwiększ bezpieczeństwo konta</h2>
                        </div>
                        
                        <p style="color: #94a3b8; text-align: center;">
                            Zalecamy włączenie <strong style="color: #f8fafc;">dwuskładnikowego uwierzytelniania (2FA)</strong> 
                            na Twoim koncie AngoraLinks.
                        </p>
                        
                        <div style="background-color: #0f172a; border-radius: 12px; padding: 20px; margin: 24px 0;">
                            <h3 style="color: #22c55e; margin: 0 0 16px 0; text-align: center;">✨ Korzyści z 2FA</h3>
                            <ul style="color: #94a3b8; margin: 0; padding-left: 20px;">
                                <li style="margin: 8px 0;">✅ Ochrona przed nieautoryzowanym dostępem</li>
                                <li style="margin: 8px 0;">✅ Bezpieczeństwo nawet gdy hasło wycieknie</li>
                                <li style="margin: 8px 0;">✅ Wsparcie dla aplikacji authenticator i kluczy sprzętowych</li>
                                <li style="margin: 8px 0;">✅ Kody zapasowe na wypadek utraty urządzenia</li>
                            </ul>
                        </div>
                        
                        <p style="color: #94a3b8; text-align: center;">
                            Konfiguracja zajmuje tylko <strong style="color: #f8fafc;">1 minutę</strong>:
                        </p>
                        
                        <div style="text-align: center; margin: 24px 0;">
                            <a href="${FRONTEND_URL}/settings/security" style="display: inline-block; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: #ffffff; padding: 14px 36px; border-radius: 8px; text-decoration: none; font-weight: bold; font-size: 16px;">
                                🔒 Włącz 2FA teraz
                            </a>
                        </div>
                        
                        <div style="background-color: rgba(14, 165, 233, 0.1); border: 1px solid #0ea5e9; border-radius: 8px; padding: 16px; margin-top: 24px;">
                            <p style="color: #0ea5e9; margin: 0; font-size: 14px; text-align: center;">
                                💡 <strong>Wskazówka:</strong> Możesz użyć Google Authenticator, Authy, 
                                lub klucza sprzętowego jak YubiKey.
                            </p>
                        </div>
                        
                        <p style="color: #64748b; font-size: 12px; text-align: center; margin-top: 24px;">
                            Jeśli masz pytania dotyczące bezpieczeństwa konta, skontaktuj się z nami.<br>
                            © 2025 AngoraLinks
                        </p>
                    </div>
                </div>
            `
        });
        
        console.log(`✅ Email zalecenia 2FA wysłany do: ${email}`);
        return true;
    } catch (error) {
        console.error('❌ Błąd wysyłania emaila zalecenia 2FA:', error.message);
        return false;
    }
}

/**
 * Wysyła email o wymuszonej konfiguracji 2FA przez admina
 */
async function sendTwoFactorRequired(email) {
    try {
        const result = await resend.emails.send({
            from: DEFAULT_FROM,
            to: email,
            subject: '⚠️ Wymagane włączenie 2FA - AngoraLinks',
            html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #0f172a;">
                    <div style="background-color: #1e293b; border-radius: 16px; padding: 32px;">
                        <div style="text-align: center; margin-bottom: 24px;">
                            <h1 style="color: #0ea5e9; margin: 0;">🔗 AngoraLinks</h1>
                        </div>
                        
                        <div style="background-color: rgba(239, 68, 68, 0.2); border: 1px solid #ef4444; border-radius: 12px; padding: 20px; text-align: center; margin-bottom: 24px;">
                            <span style="font-size: 48px;">⚠️</span>
                            <h2 style="color: #ef4444; margin: 8px 0;">Wymagane działanie</h2>
                        </div>
                        
                        <div style="background-color: #fef3c7; border-left: 4px solid #f59e0b; padding: 16px; margin: 20px 0; border-radius: 0 8px 8px 0;">
                            <p style="color: #92400e; margin: 0; font-weight: bold;">
                                Administrator wymagał włączenia dwuskładnikowego uwierzytelniania (2FA) na Twoim koncie.
                            </p>
                        </div>
                        
                        <p style="color: #94a3b8; text-align: center;">
                            Przy następnym logowaniu będziesz musiał(a) skonfigurować 2FA, 
                            aby kontynuować korzystanie z AngoraLinks.
                        </p>
                        
                        <p style="color: #f8fafc; text-align: center; font-weight: bold;">
                            Możesz to zrobić teraz:
                        </p>
                        
                        <div style="text-align: center; margin: 24px 0;">
                            <a href="${FRONTEND_URL}/settings/security" style="display: inline-block; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: #ffffff; padding: 14px 36px; border-radius: 8px; text-decoration: none; font-weight: bold; font-size: 16px;">
                                🔒 Skonfiguruj 2FA
                            </a>
                        </div>
                        
                        <div style="background-color: #0f172a; border-radius: 12px; padding: 20px; margin: 24px 0;">
                            <h3 style="color: #f8fafc; margin: 0 0 16px 0;">📱 Dostępne metody:</h3>
                            <ul style="color: #94a3b8; margin: 0; padding-left: 20px;">
                                <li style="margin: 8px 0;">
                                    <strong style="color: #f8fafc;">Aplikacja Authenticator</strong><br>
                                    <span style="font-size: 13px;">Google Authenticator, Authy, Microsoft Authenticator</span>
                                </li>
                                <li style="margin: 8px 0;">
                                    <strong style="color: #f8fafc;">Klucz sprzętowy</strong><br>
                                    <span style="font-size: 13px;">YubiKey, Titan Security Key</span>
                                </li>
                                <li style="margin: 8px 0;">
                                    <strong style="color: #f8fafc;">Biometria urządzenia</strong><br>
                                    <span style="font-size: 13px;">Face ID, Touch ID, Windows Hello</span>
                                </li>
                            </ul>
                        </div>
                        
                        <p style="color: #64748b; font-size: 12px; text-align: center; margin-top: 24px;">
                            Jeśli masz pytania, skontaktuj się z supportem.<br>
                            © 2025 AngoraLinks
                        </p>
                    </div>
                </div>
            `
        });
        
        console.log(`✅ Email wymuszonego 2FA wysłany do: ${email}`);
        return true;
    } catch (error) {
        console.error('❌ Błąd wysyłania emaila wymuszonego 2FA:', error.message);
        return false;
    }
}

/**
 * Wysyła email o zresetowaniu 2FA przez admina
 */
async function sendTwoFactorReset(email) {
    try {
        const result = await resend.emails.send({
            from: DEFAULT_FROM,
            to: email,
            subject: '🔓 Twoje 2FA zostało zresetowane - AngoraLinks',
            html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #0f172a;">
                    <div style="background-color: #1e293b; border-radius: 16px; padding: 32px;">
                        <div style="text-align: center; margin-bottom: 24px;">
                            <h1 style="color: #0ea5e9; margin: 0;">🔗 AngoraLinks</h1>
                        </div>
                        
                        <div style="background-color: rgba(245, 158, 11, 0.2); border: 1px solid #f59e0b; border-radius: 12px; padding: 20px; text-align: center; margin-bottom: 24px;">
                            <span style="font-size: 48px;">🔓</span>
                            <h2 style="color: #f59e0b; margin: 8px 0;">2FA zresetowane</h2>
                        </div>
                        
                        <p style="color: #94a3b8; text-align: center;">
                            Dwuskładnikowe uwierzytelnianie zostało zresetowane na Twoim koncie 
                            AngoraLinks przez administratora.
                        </p>
                        
                        <div style="background-color: rgba(239, 68, 68, 0.1); border: 1px solid #ef4444; border-radius: 8px; padding: 16px; margin: 20px 0;">
                            <p style="color: #ef4444; margin: 0; font-weight: bold; text-align: center;">
                                ⚠️ Jeśli nie prosiłeś(aś) o reset 2FA, natychmiast skontaktuj się z supportem!
                            </p>
                        </div>
                        
                        <p style="color: #94a3b8; text-align: center;">
                            Zalecamy ponowne skonfigurowanie 2FA w celu ochrony konta:
                        </p>
                        
                        <div style="text-align: center; margin: 24px 0;">
                            <a href="${FRONTEND_URL}/settings/security" style="display: inline-block; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: #ffffff; padding: 14px 36px; border-radius: 8px; text-decoration: none; font-weight: bold; font-size: 16px;">
                                🔒 Skonfiguruj 2FA ponownie
                            </a>
                        </div>
                        
                        <div style="background-color: #0f172a; border-radius: 8px; padding: 16px; margin-top: 24px;">
                            <p style="color: #64748b; margin: 0; font-size: 13px; text-align: center;">
                                📅 Data resetowania: <strong style="color: #f8fafc;">${new Date().toLocaleString('pl-PL')}</strong>
                            </p>
                        </div>
                        
                        <p style="color: #64748b; font-size: 12px; text-align: center; margin-top: 24px;">
                            © 2025 AngoraLinks
                        </p>
                    </div>
                </div>
            `
        });
        
        console.log(`✅ Email resetu 2FA wysłany do: ${email}`);
        return true;
    } catch (error) {
        console.error('❌ Błąd wysyłania emaila resetu 2FA:', error.message);
        return false;
    }
}

/**
 * Wysyła email z kodami zapasowymi 2FA
 */
async function sendBackupCodes(email, backupCodes) {
    try {
        const codesHtml = backupCodes.map((code, index) => 
            `<span style="display: inline-block; background-color: #1e293b; color: #0ea5e9; padding: 8px 12px; margin: 4px; border-radius: 6px; font-family: monospace; font-size: 14px;">${index + 1}. ${code}</span>`
        ).join('');
        
        const result = await resend.emails.send({
            from: DEFAULT_FROM,
            to: email,
            subject: '🔑 Twoje kody zapasowe 2FA - AngoraLinks',
            html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #0f172a;">
                    <div style="background-color: #1e293b; border-radius: 16px; padding: 32px;">
                        <div style="text-align: center; margin-bottom: 24px;">
                            <h1 style="color: #0ea5e9; margin: 0;">🔗 AngoraLinks</h1>
                        </div>
                        
                        <div style="text-align: center; margin-bottom: 24px;">
                            <span style="font-size: 48px;">🔑</span>
                            <h2 style="color: #f8fafc; margin: 8px 0;">Kody zapasowe 2FA</h2>
                        </div>
                        
                        <div style="background-color: rgba(239, 68, 68, 0.1); border: 1px solid #ef4444; border-radius: 8px; padding: 16px; margin-bottom: 24px;">
                            <p style="color: #ef4444; margin: 0; font-weight: bold; text-align: center;">
                                ⚠️ WAŻNE: Zapisz te kody w bezpiecznym miejscu!
                            </p>
                            <p style="color: #fca5a5; margin: 8px 0 0 0; font-size: 13px; text-align: center;">
                                Każdy kod może być użyty tylko raz. Te kody nie będą pokazane ponownie.
                            </p>
                        </div>
                        
                        <p style="color: #94a3b8; text-align: center;">
                            Użyj tych kodów jeśli stracisz dostęp do swojego urządzenia 2FA:
                        </p>
                        
                        <div style="background-color: #0f172a; border-radius: 12px; padding: 20px; margin: 24px 0; text-align: center;">
                            ${codesHtml}
                        </div>
                        
                        <div style="background-color: rgba(34, 197, 94, 0.1); border: 1px solid #22c55e; border-radius: 8px; padding: 16px; margin-top: 24px;">
                            <p style="color: #22c55e; margin: 0; font-size: 14px;">
                                💡 <strong>Wskazówki:</strong>
                            </p>
                            <ul style="color: #86efac; margin: 8px 0 0 0; padding-left: 20px; font-size: 13px;">
                                <li>Wydrukuj lub zapisz kody w menedżerze haseł</li>
                                <li>Nie przechowuj kodów na tym samym urządzeniu co 2FA</li>
                                <li>Możesz wygenerować nowe kody w ustawieniach</li>
                            </ul>
                        </div>
                        
                        <p style="color: #64748b; font-size: 12px; text-align: center; margin-top: 24px;">
                            © 2025 AngoraLinks
                        </p>
                    </div>
                </div>
            `
        });
        
        console.log(`✅ Email z kodami zapasowymi wysłany do: ${email}`);
        return true;
    } catch (error) {
        console.error('❌ Błąd wysyłania emaila z kodami zapasowymi:', error.message);
        return false;
    }
}

/**
 * Wysyła alert o użyciu kodu zapasowego
 */
async function sendBackupCodeUsedAlert(email, remainingCodes) {
    try {
        const result = await resend.emails.send({
            from: DEFAULT_FROM,
            to: email,
            subject: '🚨 Użyto kodu zapasowego 2FA - AngoraLinks',
            html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #0f172a;">
                    <div style="background-color: #1e293b; border-radius: 16px; padding: 32px;">
                        <div style="text-align: center; margin-bottom: 24px;">
                            <h1 style="color: #0ea5e9; margin: 0;">🔗 AngoraLinks</h1>
                        </div>
                        
                        <div style="background-color: rgba(245, 158, 11, 0.2); border: 1px solid #f59e0b; border-radius: 12px; padding: 20px; text-align: center; margin-bottom: 24px;">
                            <span style="font-size: 48px;">🚨</span>
                            <h2 style="color: #f59e0b; margin: 8px 0;">Użyto kodu zapasowego</h2>
                        </div>
                        
                        <p style="color: #94a3b8; text-align: center;">
                            Właśnie użyto jednego z Twoich kodów zapasowych do logowania na konto AngoraLinks.
                        </p>
                        
                        <div style="background-color: #0f172a; border-radius: 12px; padding: 20px; margin: 24px 0; text-align: center;">
                            <p style="color: #94a3b8; margin: 0;">Pozostałe kody zapasowe:</p>
                            <p style="font-size: 48px; font-weight: bold; color: ${remainingCodes <= 2 ? '#ef4444' : '#22c55e'}; margin: 8px 0;">
                                ${remainingCodes}/10
                            </p>
                        </div>
                        
                        ${remainingCodes <= 2 ? `
                        <div style="background-color: rgba(239, 68, 68, 0.1); border: 1px solid #ef4444; border-radius: 8px; padding: 16px; margin: 20px 0;">
                            <p style="color: #ef4444; margin: 0; font-weight: bold; text-align: center;">
                                ⚠️ Masz mało kodów zapasowych! Wygeneruj nowe w ustawieniach.
                            </p>
                        </div>
                        ` : ''}
                        
                        <div style="background-color: rgba(14, 165, 233, 0.1); border: 1px solid #0ea5e9; border-radius: 8px; padding: 16px; margin: 20px 0;">
                            <p style="color: #0ea5e9; margin: 0; font-size: 14px;">
                                📅 Data: <strong>${new Date().toLocaleString('pl-PL')}</strong>
                            </p>
                        </div>
                        
                        <p style="color: #94a3b8; text-align: center; font-size: 14px;">
                            Jeśli to nie Ty logowałeś się na konto, natychmiast zmień hasło i skontaktuj się z supportem.
                        </p>
                        
                        <div style="text-align: center; margin-top: 24px;">
                            <a href="${FRONTEND_URL}/settings/security" style="display: inline-block; background-color: #0ea5e9; color: #ffffff; padding: 12px 32px; border-radius: 8px; text-decoration: none; font-weight: bold;">
                                Zarządzaj bezpieczeństwem
                            </a>
                        </div>
                        
                        <p style="color: #64748b; font-size: 12px; text-align: center; margin-top: 24px;">
                            © 2025 AngoraLinks
                        </p>
                    </div>
                </div>
            `
        });
        
        console.log(`✅ Alert o użyciu kodu zapasowego wysłany do: ${email}`);
        return true;
    } catch (error) {
        console.error('❌ Błąd wysyłania alertu:', error.message);
        return false;
    }
}

/**
 * Wysyła powiadomienie o włączeniu 2FA
 */
async function sendTwoFactorEnabledNotification(email, method) {
    const methodNames = {
        'TOTP': 'Aplikacja Authenticator',
        'WEBAUTHN': 'Klucz bezpieczeństwa / Biometria'
    };
    
    try {
        const result = await resend.emails.send({
            from: DEFAULT_FROM,
            to: email,
            subject: '✅ 2FA zostało włączone - AngoraLinks',
            html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #0f172a;">
                    <div style="background-color: #1e293b; border-radius: 16px; padding: 32px;">
                        <div style="text-align: center; margin-bottom: 24px;">
                            <h1 style="color: #0ea5e9; margin: 0;">🔗 AngoraLinks</h1>
                        </div>
                        
                        <div style="background-color: rgba(34, 197, 94, 0.2); border: 1px solid #22c55e; border-radius: 12px; padding: 20px; text-align: center; margin-bottom: 24px;">
                            <span style="font-size: 48px;">✅</span>
                            <h2 style="color: #22c55e; margin: 8px 0;">2FA włączone!</h2>
                        </div>
                        
                        <p style="color: #94a3b8; text-align: center;">
                            Dwuskładnikowe uwierzytelnianie zostało pomyślnie włączone na Twoim koncie.
                        </p>
                        
                        <div style="background-color: #0f172a; border-radius: 12px; padding: 20px; margin: 24px 0; text-align: center;">
                            <p style="color: #64748b; margin: 0;">Metoda:</p>
                            <p style="font-size: 18px; font-weight: bold; color: #f8fafc; margin: 8px 0;">
                                ${methodNames[method] || method}
                            </p>
                        </div>
                        
                        <div style="background-color: rgba(14, 165, 233, 0.1); border: 1px solid #0ea5e9; border-radius: 8px; padding: 16px; margin: 20px 0;">
                            <p style="color: #0ea5e9; margin: 0; font-size: 14px; text-align: center;">
                                💡 Pamiętaj o zapisaniu kodów zapasowych w bezpiecznym miejscu!
                            </p>
                        </div>
                        
                        <p style="color: #94a3b8; text-align: center; font-size: 14px;">
                            Od teraz przy każdym logowaniu będziemy prosić o dodatkową weryfikację.
                        </p>
                        
                        <p style="color: #64748b; font-size: 12px; text-align: center; margin-top: 24px;">
                            © 2025 AngoraLinks
                        </p>
                    </div>
                </div>
            `
        });
        
        console.log(`✅ Powiadomienie o włączeniu 2FA wysłane do: ${email}`);
        return true;
    } catch (error) {
        console.error('❌ Błąd wysyłania powiadomienia:', error.message);
        return false;
    }
}

/**
 * Testuje połączenie z Resend
 */
async function testEmailConnection() {
    if (!process.env.RESEND_API_KEY) {
        console.error('❌ RESEND_API_KEY nie jest ustawiony');
        return false;
    }
    console.log('✅ Resend API skonfigurowany');
    return true;
}

module.exports = {
    generateCode,
    sendVerificationEmail,
    sendWelcomeEmail,
    sendPasswordResetEmail,
    sendPayoutNotification,
    sendContactConfirmation,
    sendMessageReadNotification,
    sendAccountDeletedEmail,
    testEmailConnection,
    // 🆕 Funkcje 2FA
    sendTwoFactorRecommendation,
    sendTwoFactorRequired,
    sendTwoFactorReset,
    sendBackupCodes,
    sendBackupCodeUsedAlert,
    sendTwoFactorEnabledNotification
};