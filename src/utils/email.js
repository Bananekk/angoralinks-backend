const nodemailer = require('nodemailer');

// Konfiguracja transportera email
const transporter = nodemailer.createTransport({
    host: process.env.EMAIL_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.EMAIL_PORT) || 587,
    secure: false,
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

/**
 * Wysyła email weryfikacyjny
 */
async function sendVerificationEmail(email, token) {
    const verificationUrl = `${process.env.FRONTEND_URL}/verify/${token}`;
    
    const mailOptions = {
        from: process.env.EMAIL_FROM || 'AngoraLinks <noreply@angoralinks.com>',
        to: email,
        subject: 'Zweryfikuj swoje konto - AngoraLinks',
        html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                <h1 style="color: #0891b2;">Witaj w AngoraLinks!</h1>
                <p>Dziękujemy za rejestrację. Kliknij poniższy przycisk, aby zweryfikować swoje konto:</p>
                <a href="${verificationUrl}" style="display: inline-block; background-color: #0891b2; color: white; padding: 12px 24px; text-decoration: none; border-radius: 8px; margin: 20px 0;">
                    Zweryfikuj konto
                </a>
                <p>Lub skopiuj ten link:</p>
                <p style="color: #666; word-break: break-all;">${verificationUrl}</p>
                <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">
                <p style="color: #999; font-size: 12px;">
                    Jeśli nie rejestrowałeś się w AngoraLinks, zignoruj tę wiadomość.
                </p>
            </div>
        `
    };
    
    try {
        await transporter.sendMail(mailOptions);
        console.log(`✅ Email weryfikacyjny wysłany do: ${email}`);
        return true;
    } catch (error) {
        console.error('❌ Błąd wysyłania emaila:', error.message);
        throw error;
    }
}

/**
 * Wysyła email z resetem hasła
 */
async function sendPasswordResetEmail(email, token) {
    const resetUrl = `${process.env.FRONTEND_URL}/reset-password/${token}`;
    
    const mailOptions = {
        from: process.env.EMAIL_FROM || 'AngoraLinks <noreply@angoralinks.com>',
        to: email,
        subject: 'Reset hasła - AngoraLinks',
        html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                <h1 style="color: #0891b2;">Reset hasła</h1>
                <p>Otrzymaliśmy prośbę o reset hasła dla Twojego konta.</p>
                <a href="${resetUrl}" style="display: inline-block; background-color: #0891b2; color: white; padding: 12px 24px; text-decoration: none; border-radius: 8px; margin: 20px 0;">
                    Resetuj hasło
                </a>
                <p>Link wygasa za 1 godzinę.</p>
                <p>Lub skopiuj ten link:</p>
                <p style="color: #666; word-break: break-all;">${resetUrl}</p>
                <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">
                <p style="color: #999; font-size: 12px;">
                    Jeśli nie prosiłeś o reset hasła, zignoruj tę wiadomość.
                </p>
            </div>
        `
    };
    
    try {
        await transporter.sendMail(mailOptions);
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
    const statusText = {
        'COMPLETED': 'została zrealizowana',
        'REJECTED': 'została odrzucona',
        'PROCESSING': 'jest przetwarzana'
    };
    
    const mailOptions = {
        from: process.env.EMAIL_FROM || 'AngoraLinks <noreply@angoralinks.com>',
        to: email,
        subject: `Wypłata ${statusText[status] || status} - AngoraLinks`,
        html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                <h1 style="color: #0891b2;">Status wypłaty</h1>
                <p>Twoja wypłata <strong>$${amount}</strong> przez <strong>${method}</strong> ${statusText[status] || status}.</p>
                ${status === 'COMPLETED' ? '<p style="color: green;">✅ Środki powinny dotrzeć w ciągu 1-3 dni roboczych.</p>' : ''}
                ${status === 'REJECTED' ? '<p style="color: red;">❌ Skontaktuj się z nami jeśli masz pytania.</p>' : ''}
                <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">
                <p style="color: #999; font-size: 12px;">
                    AngoraLinks Team
                </p>
            </div>
        `
    };
    
    try {
        await transporter.sendMail(mailOptions);
        return true;
    } catch (error) {
        console.error('❌ Błąd wysyłania emaila:', error.message);
        throw error;
    }
}

/**
 * Testuje połączenie z serwerem email
 */
async function testEmailConnection() {
    try {
        await transporter.verify();
        console.log('✅ Połączenie z serwerem email działa');
        return true;
    } catch (error) {
        console.error('❌ Błąd połączenia z serwerem email:', error.message);
        return false;
    }
}

module.exports = {
    sendVerificationEmail,
    sendPasswordResetEmail,
    sendPayoutNotification,
    testEmailConnection,
    transporter
};