const sgMail = require('@sendgrid/mail');

class EmailService {
    constructor() {
        this.initialized = false;
        this.fromEmail = 'angora.linx@gmail.com';
        this.fromName = 'AngoraLinks';
        this.init();
    }

    init() {
        console.log('🔧 Inicjalizacja SendGrid...');

        const apiKey = process.env.SENDGRID_API_KEY;

        console.log('SENDGRID_API_KEY:', apiKey ? '✅ ustawione' : '❌ BRAK');

        if (!apiKey) {
            console.warn('⚠️ SendGrid nie skonfigurowany - email wyłączony');
            return;
        }

        try {
            sgMail.setApiKey(apiKey);
            this.initialized = true;
            console.log('✅ SendGrid gotowy do wysyłania!');
        } catch (error) {
            console.error('❌ Błąd inicjalizacji SendGrid:', error.message);
        }
    }

    generateCode() {
        return Math.floor(100000 + Math.random() * 900000).toString();
    }

    async sendVerificationCode(email, code) {
        console.log(`📧 Próba wysłania kodu do: ${email}`);

        if (!this.initialized) {
            console.warn('❌ Email nie skonfigurowany - pomijam wysyłkę');
            return true;
        }

        try {
            console.log('📤 Wysyłam email przez SendGrid...');

            await sgMail.send({
                to: email,
                from: {
                    email: this.fromEmail,
                    name: this.fromName
                },
                subject: 'Kod weryfikacyjny - AngoraLinks',
                html: `
                    <!DOCTYPE html>
                    <html>
                    <head>
                        <style>
                            body { font-family: Arial, sans-serif; background-color: #0f172a; color: #f8fafc; padding: 20px; }
                            .container { max-width: 500px; margin: 0 auto; background-color: #1e293b; border-radius: 16px; padding: 32px; }
                            .logo { text-align: center; margin-bottom: 24px; }
                            .logo span { font-size: 24px; font-weight: bold; color: #0ea5e9; }
                            .code { background-color: #0f172a; border-radius: 12px; padding: 24px; text-align: center; margin: 24px 0; }
                            .code span { font-size: 36px; font-weight: bold; letter-spacing: 8px; color: #0ea5e9; }
                            .text { color: #94a3b8; line-height: 1.6; }
                            .footer { text-align: center; margin-top: 24px; color: #64748b; font-size: 12px; }
                        </style>
                    </head>
                    <body>
                        <div class="container">
                            <div class="logo">
                                <span>🔗 AngoraLinks</span>
                            </div>
                            <h2 style="text-align: center; margin-bottom: 16px;">Weryfikacja konta</h2>
                            <p class="text">Witaj! Użyj poniższego kodu aby zweryfikować swoje konto:</p>
                            <div class="code">
                                <span>${code}</span>
                            </div>
                            <p class="text">Kod jest ważny przez <strong>15 minut</strong>.</p>
                            <p class="text">Jeśli nie rejestrowałeś się na AngoraLinks, zignoruj tę wiadomość.</p>
                            <div class="footer">
                                &copy; 2024 AngoraLinks. Wszystkie prawa zastrzeżone.
                            </div>
                        </div>
                    </body>
                    </html>
                `
            });

            console.log(`✅ Email wysłany do: ${email}`);
            return true;

        } catch (error) {
            console.error('❌ Błąd wysyłania email:', error.message);
            if (error.response) {
                console.error('SendGrid response:', error.response.body);
            }
            return false;
        }
    }

    async sendWelcomeEmail(email) {
        if (!this.initialized) return true;

        try {
            await sgMail.send({
                to: email,
                from: {
                    email: this.fromEmail,
                    name: this.fromName
                },
                subject: 'Witaj w AngoraLinks! 🎉',
                html: `
                    <!DOCTYPE html>
                    <html>
                    <head>
                        <style>
                            body { font-family: Arial, sans-serif; background-color: #0f172a; color: #f8fafc; padding: 20px; }
                            .container { max-width: 500px; margin: 0 auto; background-color: #1e293b; border-radius: 16px; padding: 32px; }
                            .logo { text-align: center; margin-bottom: 24px; }
                            .logo span { font-size: 24px; font-weight: bold; color: #0ea5e9; }
                            .success { background-color: rgba(34, 197, 94, 0.2); border: 1px solid #22c55e; border-radius: 12px; padding: 16px; text-align: center; margin: 24px 0; }
                            .text { color: #94a3b8; line-height: 1.6; }
                            .button { display: inline-block; background-color: #0ea5e9; color: #ffffff; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: bold; }
                            .footer { text-align: center; margin-top: 24px; color: #64748b; font-size: 12px; }
                        </style>
                    </head>
                    <body>
                        <div class="container">
                            <div class="logo">
                                <span>🔗 AngoraLinks</span>
                            </div>
                            <div class="success">
                                <span style="font-size: 48px;">✅</span>
                                <h2 style="color: #22c55e; margin: 8px 0;">Konto zweryfikowane!</h2>
                            </div>
                            <p class="text">Twoje konto zostało pomyślnie zweryfikowane. Możesz teraz:</p>
                            <ul class="text">
                                <li>Tworzyć skrócone linki</li>
                                <li>Zarabiać na reklamach</li>
                                <li>Śledzić statystyki</li>
                            </ul>
                            <p style="text-align: center; margin-top: 24px;">
                                <a href="${process.env.FRONTEND_URL || 'https://angoralinks.com'}/dashboard" class="button">Przejdź do panelu</a>
                            </p>
                            <div class="footer">
                                &copy; 2024 AngoraLinks. Wszystkie prawa zastrzeżone.
                            </div>
                        </div>
                    </body>
                    </html>
                `
            });

            console.log(`✅ Welcome email wysłany do: ${email}`);
            return true;
        } catch (error) {
            console.error('❌ Błąd welcome email:', error.message);
            return false;
        }
    }

    async sendContactConfirmation(email, name, subject) {
        if (!this.initialized) return true;

        try {
            await sgMail.send({
                to: email,
                from: {
                    email: this.fromEmail,
                    name: this.fromName
                },
                subject: 'Otrzymaliśmy Twoją wiadomość - AngoraLinks',
                html: `
                    <div style="font-family: Arial, sans-serif; max-width: 500px; margin: 0 auto; padding: 20px;">
                        <h2>📨 Otrzymaliśmy Twoją wiadomość!</h2>
                        <p>Cześć <strong>${name}</strong>!</p>
                        <p>Temat: <strong>${subject}</strong></p>
                        <p>Odpowiemy w ciągu 24-48 godzin.</p>
                        <p>Pozdrawiamy,<br>Zespół AngoraLinks</p>
                    </div>
                `
            });

            console.log(`✅ Potwierdzenie kontaktu wysłane do: ${email}`);
            return true;
        } catch (error) {
            console.error('❌ Błąd kontakt email:', error.message);
            return false;
        }
    }

    async sendMessageReadNotification(email, name, subject) {
        if (!this.initialized) return true;

        try {
            await sgMail.send({
                to: email,
                from: {
                    email: this.fromEmail,
                    name: this.fromName
                },
                subject: 'Twoja wiadomość została przeczytana - AngoraLinks',
                html: `
                    <div style="font-family: Arial, sans-serif; max-width: 500px; margin: 0 auto; padding: 20px;">
                        <h2>👀 Wiadomość przeczytana</h2>
                        <p>Cześć <strong>${name}</strong>!</p>
                        <p>Twoja wiadomość "<strong>${subject}</strong>" została przeczytana.</p>
                        <p>Jeśli wymaga odpowiedzi, wkrótce się odezwiemy.</p>
                        <p>Pozdrawiamy,<br>Zespół AngoraLinks</p>
                    </div>
                `
            });

            console.log(`✅ Powiadomienie o przeczytaniu wysłane do: ${email}`);
            return true;
        } catch (error) {
            console.error('❌ Błąd powiadomienie email:', error.message);
            return false;
        }
    }
}

module.exports = new EmailService();