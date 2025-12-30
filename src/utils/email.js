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
                            <li style="margin: 8px 0;">💰 Zarabiać na reklamach (85% CPM)</li>
                            <li style="margin: 8px 0;">📊 Śledzić statystyki w czasie rzeczywistym</li>
                            <li style="margin: 8px 0;">💸 Wypłacać zarobki od $5</li>
                        </ul>
                        <div style="text-align: center; margin-top: 24px;">
                            <a href="${FRONTEND_URL}/dashboard" style="display: inline-block; background-color: #0ea5e9; color: #ffffff; padding: 12px 32px; border-radius: 8px; text-decoration: none; font-weight: bold;">
                                Przejdź do panelu
                            </a>
                        </div>
                        <p style="color: #64748b; font-size: 12px; text-align: center; margin-top: 24px;">
                            © 2024 AngoraLinks. Wszystkie prawa zastrzeżone.
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
                            © 2024 AngoraLinks
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
                            © 2024 AngoraLinks
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
    testEmailConnection
};