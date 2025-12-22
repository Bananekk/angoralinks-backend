const nodemailer = require('nodemailer');
const { google } = require('googleapis');

class EmailService {
    constructor() {
        this.transporter = null;
        this.fromEmail = 'AngoraLinks <angora.linx@gmail.com>';
        this.initGmail();
    }

    async initGmail() {
        console.log('🔧 Inicjalizacja Gmail OAuth2...');

        const clientId = process.env.GMAIL_CLIENT_ID;
        const clientSecret = process.env.GMAIL_CLIENT_SECRET;
        const refreshToken = process.env.GMAIL_REFRESH_TOKEN;
        const user = process.env.GMAIL_USER;

        console.log('GMAIL_CLIENT_ID:', clientId ? '✅ ustawione' : '❌ BRAK');
        console.log('GMAIL_CLIENT_SECRET:', clientSecret ? '✅ ustawione' : '❌ BRAK');
        console.log('GMAIL_REFRESH_TOKEN:', refreshToken ? '✅ ustawione' : '❌ BRAK');
        console.log('GMAIL_USER:', user || '❌ BRAK');

        if (!clientId || !clientSecret || !refreshToken || !user) {
            console.warn('⚠️ Gmail OAuth2 nie skonfigurowany - email wyłączony');
            return;
        }

        try {
            const oauth2Client = new google.auth.OAuth2(
                clientId,
                clientSecret,
                'https://developers.google.com/oauthplayground'
            );

            oauth2Client.setCredentials({
                refresh_token: refreshToken
            });

            const accessToken = await oauth2Client.getAccessToken();

            this.transporter = nodemailer.createTransport({
                service: 'gmail',
                auth: {
                    type: 'OAuth2',
                    user: user,
                    clientId: clientId,
                    clientSecret: clientSecret,
                    refreshToken: refreshToken,
                    accessToken: accessToken.token
                }
            });

            this.transporter.verify((error, success) => {
                if (error) {
                    console.error('❌ Gmail OAuth2 błąd:', error.message);
                } else {
                    console.log('✅ Gmail OAuth2 gotowy do wysyłania');
                }
            });

        } catch (error) {
            console.error('❌ Błąd inicjalizacji Gmail OAuth2:', error.message);
        }
    }

    generateCode() {
        return Math.floor(100000 + Math.random() * 900000).toString();
    }

    async sendVerificationCode(email, code) {
        console.log(`📧 Próba wysłania kodu do: ${email}`);

        if (!this.transporter) {
            console.warn('❌ Email nie skonfigurowany - pomijam wysyłkę');
            return true;
        }

        try {
            console.log('📤 Wysyłam email...');

            const info = await this.transporter.sendMail({
                from: this.fromEmail,
                to: email,
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

            console.log(`✅ Email wysłany! ID: ${info.messageId}`);
            return true;

        } catch (error) {
            console.error('❌ Błąd wysyłania email:', error.message);
            return false;
        }
    }

    async sendWelcomeEmail(email) {
        if (!this.transporter) return true;

        try {
            await this.transporter.sendMail({
                from: this.fromEmail,
                to: email,
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
        if (!this.transporter) return true;

        try {
            await this.transporter.sendMail({
                from: this.fromEmail,
                to: email,
                subject: 'Otrzymaliśmy Twoją wiadomość - AngoraLinks',
                html: `
                    <!DOCTYPE html>
                    <html>
                    <head>
                        <style>
                            body { font-family: Arial, sans-serif; background-color: #0f172a; color: #f8fafc; padding: 20px; }
                            .container { max-width: 500px; margin: 0 auto; background-color: #1e293b; border-radius: 16px; padding: 32px; }
                            .logo { text-align: center; margin-bottom: 24px; }
                            .logo span { font-size: 24px; font-weight: bold; color: #0ea5e9; }
                            .text { color: #94a3b8; line-height: 1.6; }
                            .info-box { background-color: #0f172a; border-radius: 12px; padding: 16px; margin: 24px 0; }
                            .footer { text-align: center; margin-top: 24px; color: #64748b; font-size: 12px; }
                        </style>
                    </head>
                    <body>
                        <div class="container">
                            <div class="logo">
                                <span>🔗 AngoraLinks</span>
                            </div>
                            <h2 style="text-align: center; color: #22c55e;">📨 Otrzymaliśmy Twoją wiadomość!</h2>
                            <p class="text">Cześć <strong style="color: #f8fafc;">${name}</strong>!</p>
                            <p class="text">Dziękujemy za kontakt. Twoja wiadomość została dostarczona.</p>
                            <div class="info-box">
                                <p style="color: #64748b; margin: 0;">Temat:</p>
                                <p style="color: #f8fafc; margin: 4px 0 0 0;"><strong>${subject}</strong></p>
                            </div>
                            <p class="text">Odpowiemy w ciągu <strong style="color: #f8fafc;">24-48 godzin</strong>.</p>
                            <p class="text">Pozdrawiamy,<br><strong style="color: #0ea5e9;">Zespół AngoraLinks</strong></p>
                            <div class="footer">
                                &copy; 2024 AngoraLinks. Wszystkie prawa zastrzeżone.
                            </div>
                        </div>
                    </body>
                    </html>
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
        if (!this.transporter) return true;

        try {
            await this.transporter.sendMail({
                from: this.fromEmail,
                to: email,
                subject: 'Twoja wiadomość została przeczytana - AngoraLinks',
                html: `
                    <!DOCTYPE html>
                    <html>
                    <head>
                        <style>
                            body { font-family: Arial, sans-serif; background-color: #0f172a; color: #f8fafc; padding: 20px; }
                            .container { max-width: 500px; margin: 0 auto; background-color: #1e293b; border-radius: 16px; padding: 32px; }
                            .logo { text-align: center; margin-bottom: 24px; }
                            .logo span { font-size: 24px; font-weight: bold; color: #0ea5e9; }
                            .status-box { background-color: rgba(34, 197, 94, 0.1); border: 1px solid #22c55e; border-radius: 12px; padding: 16px; margin: 24px 0; text-align: center; }
                            .text { color: #94a3b8; line-height: 1.6; }
                            .info-box { background-color: #0f172a; border-radius: 12px; padding: 16px; margin: 24px 0; }
                            .footer { text-align: center; margin-top: 24px; color: #64748b; font-size: 12px; }
                        </style>
                    </head>
                    <body>
                        <div class="container">
                            <div class="logo">
                                <span>🔗 AngoraLinks</span>
                            </div>
                            <h2 style="text-align: center;">👀 Wiadomość przeczytana</h2>
                            <div class="status-box">
                                <span style="color: #22c55e; font-weight: bold;">✓ Przeczytana przez zespół</span>
                            </div>
                            <p class="text">Cześć <strong style="color: #f8fafc;">${name}</strong>!</p>
                            <p class="text">Twoja wiadomość:</p>
                            <div class="info-box">
                                <p style="color: #0ea5e9; margin: 0; font-weight: bold;">"${subject}"</p>
                            </div>
                            <p class="text">została przeczytana. Jeśli wymaga odpowiedzi, wkrótce się odezwiemy.</p>
                            <p class="text">Pozdrawiamy,<br><strong style="color: #0ea5e9;">Zespół AngoraLinks</strong></p>
                            <div class="footer">
                                &copy; 2024 AngoraLinks. Wszystkie prawa zastrzeżone.
                            </div>
                        </div>
                    </body>
                    </html>
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