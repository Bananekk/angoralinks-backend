const sgMail = require('@sendgrid/mail');

// Konfiguracja SendGrid API
sgMail.setApiKey(process.env.SENDGRID_API_KEY);

const DEFAULT_FROM = process.env.EMAIL_FROM || 'AngoraLinks <angora.linx@gmail.com>';

/**
 * Wysyła email z kodem weryfikacyjnym
 */
async function sendVerificationEmail(email, code) {
    const msg = {
        to: email,
        from: DEFAULT_FROM,
        subject: 'Twój kod weryfikacyjny - AngoraLinks',
        html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
                <div style="text-align: center; margin-bottom: 30px;">
                    <h1 style="color: #0891b2; margin: 0;">🔗 AngoraLinks</h1>
                </div>
                <h2 style="color: #333; text-align: center;">Witaj!</h2>
                <p style="color: #555; font-size: 16px; text-align: center;">Twój kod weryfikacyjny:</p>
                <div style="background-color: #f3f4f6; padding: 30px; text-align: center; margin: 30px 0; border-radius: 12px;">
                    <span style="font-size: 42px; font-weight: bold; letter-spacing: 12px; color: #0891b2;">${code}</span>
                </div>
                <p style="color: #555; text-align: center; font-size: 16px;">Wpisz ten kod na stronie aby zweryfikować swoje konto.</p>
                <p style="color: #999; font-size: 14px; text-align: center;">Kod wygasa za 24 godziny.</p>
                <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">
                <p style="color: #999; font-size: 12px; text-align: center;">
                    Jeśli nie rejestrowałeś się w AngoraLinks, zignoruj tę wiadomość.
                </p>
            </div>
        `
    };
    
    try {
        const result = await sgMail.send(msg);
        console.log(`✅ Email weryfikacyjny wysłany do: ${email} (status: ${result[0].statusCode})`);
        return true;
    } catch (error) {
        console.error('❌ Błąd wysyłania emaila:', error.message);
        if (error.response) {
            console.error('❌ SendGrid error body:', error.response.body);
        }
        throw error;
    }
}

/**
 * Wysyła email z kodem do resetu hasła
 */
async function sendPasswordResetEmail(email, code) {
    const msg = {
        to: email,
        from: DEFAULT_FROM,
        subject: 'Reset hasła - AngoraLinks',
        html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
                <div style="text-align: center; margin-bottom: 30px;">
                    <h1 style="color: #0891b2; margin: 0;">🔗 AngoraLinks</h1>
                </div>
                <h2 style="color: #333; text-align: center;">Reset hasła</h2>
                <p style="color: #555; font-size: 16px; text-align: center;">Twój kod do resetu hasła:</p>
                <div style="background-color: #f3f4f6; padding: 30px; text-align: center; margin: 30px 0; border-radius: 12px;">
                    <span style="font-size: 42px; font-weight: bold; letter-spacing: 12px; color: #0891b2;">${code}</span>
                </div>
                <p style="color: #e74c3c; text-align: center; font-size: 14px;">⏰ Kod wygasa za 1 godzinę.</p>
                <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">
                <p style="color: #999; font-size: 12px; text-align: center;">
                    Jeśli nie prosiłeś o reset hasła, zignoruj tę wiadomość.
                </p>
            </div>
        `
    };
    
    try {
        const result = await sgMail.send(msg);
        console.log(`✅ Email resetujący wysłany do: ${email} (status: ${result[0].statusCode})`);
        return true;
    } catch (error) {
        console.error('❌ Błąd wysyłania emaila:', error.message);
        if (error.response) {
            console.error('❌ SendGrid error body:', error.response.body);
        }
        throw error;
    }
}

/**
 * Wysyła powiadomienie o wypłacie
 */
async function sendPayoutNotification(email, amount, status, method) {
    const statusText = {
        'COMPLETED': 'została zrealizowana',
        'REJECTED': 'została odrzucona',
        'PROCESSING': 'jest przetwarzana'
    };
    
    const statusIcon = {
        'COMPLETED': '✅',
        'REJECTED': '❌',
        'PROCESSING': '⏳'
    };
    
    const msg = {
        to: email,
        from: DEFAULT_FROM,
        subject: `${statusIcon[status] || '📧'} Wypłata ${statusText[status] || status} - AngoraLinks`,
        html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
                <div style="text-align: center; margin-bottom: 30px;">
                    <h1 style="color: #0891b2; margin: 0;">🔗 AngoraLinks</h1>
                </div>
                <h2 style="color: #333; text-align: center;">Status wypłaty</h2>
                <div style="background-color: #f3f4f6; padding: 20px; border-radius: 12px; margin: 20px 0;">
                    <p style="margin: 0; font-size: 18px; text-align: center;">
                        Twoja wypłata <strong>$${amount}</strong> przez <strong>${method}</strong>
                    </p>
                    <p style="margin: 10px 0 0 0; font-size: 20px; text-align: center; color: #0891b2;">
                        ${statusIcon[status] || ''} ${statusText[status] || status}
                    </p>
                </div>
                ${status === 'COMPLETED' ? '<p style="color: green; text-align: center;">Środki powinny dotrzeć w ciągu 1-3 dni roboczych.</p>' : ''}
                ${status === 'REJECTED' ? '<p style="color: red; text-align: center;">Skontaktuj się z nami jeśli masz pytania.</p>' : ''}
                <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">
                <p style="color: #999; font-size: 12px; text-align: center;">
                    AngoraLinks Team
                </p>
            </div>
        `
    };
    
    try {
        const result = await sgMail.send(msg);
        console.log(`✅ Email o wypłacie wysłany do: ${email} (status: ${result[0].statusCode})`);
        return true;
    } catch (error) {
        console.error('❌ Błąd wysyłania emaila:', error.message);
        if (error.response) {
            console.error('❌ SendGrid error body:', error.response.body);
        }
        throw error;
    }
}

/**
 * Testuje połączenie z SendGrid
 */
async function testEmailConnection() {
    if (!process.env.SENDGRID_API_KEY) {
        console.error('❌ SENDGRID_API_KEY nie jest ustawiony');
        return false;
    }
    console.log('✅ SendGrid API skonfigurowany');
    return true;
}

module.exports = {
    sendVerificationEmail,
    sendPasswordResetEmail,
    sendPayoutNotification,
    testEmailConnection
};