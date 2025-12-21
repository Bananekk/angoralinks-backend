const nodemailer = require('nodemailer');

class EmailService {
    constructor() {
        this.transporter = null;
        this.initTransporter();
    }

    initTransporter() {
        if (process.env.EMAIL_HOST && process.env.EMAIL_USER && process.env.EMAIL_PASS) {
            this.transporter = nodemailer.createTransport({
                host: process.env.EMAIL_HOST,
                port: parseInt(process.env.EMAIL_PORT) || 587,
                secure: false,
                auth: {
                    user: process.env.EMAIL_USER,
                    pass: process.env.EMAIL_PASS
                }
            });
        } else {
            console.warn('Email nie skonfigurowany - weryfikacja email wyłączona');
        }
    }

    // Generuj 6-cyfrowy kod
    generateCode() {
        return Math.floor(100000 + Math.random() * 900000).toString();
    }

    // Wyślij email z kodem weryfikacyjnym
    async sendVerificationCode(email, code) {
        if (!this.transporter) {
            console.warn('Email nie skonfigurowany - pomijam wysyłkę');
            return true;
        }

        try {
            await this.transporter.sendMail({
                from: process.env.EMAIL_FROM || 'AngoraLinks <noreply@angoralinks.com>',
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

            console.log(`Email weryfikacyjny wysłany do: ${email}`);
            return true;

        } catch (error) {
            console.error('Błąd wysyłania email:', error);
            return false;
        }
    }

    // Wyślij email o udanej weryfikacji
    async sendWelcomeEmail(email) {
        if (!this.transporter) return true;

        try {
            await this.transporter.sendMail({
                from: process.env.EMAIL_FROM || 'AngoraLinks <noreply@angoralinks.com>',
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
                                <a href="${process.env.FRONTEND_URL || 'http://localhost:5173'}/dashboard" class="button">Przejdź do panelu</a>
                            </p>
                            <div class="footer">
                                &copy; 2024 AngoraLinks. Wszystkie prawa zastrzeżone.
                            </div>
                        </div>
                    </body>
                    </html>
                `
            });

            return true;
        } catch (error) {
            console.error('Błąd wysyłania welcome email:', error);
            return false;
        }
    }

    // ====================================
    // NOWE METODY - FORMULARZE KONTAKTOWE
    // ====================================

    // Wyślij potwierdzenie otrzymania wiadomości do użytkownika
    async sendContactConfirmation(email, name, subject) {
        if (!this.transporter) {
            console.warn('Email nie skonfigurowany - pomijam wysyłkę potwierdzenia');
            return true;
        }

        try {
            await this.transporter.sendMail({
                from: process.env.EMAIL_FROM || 'AngoraLinks <noreply@angoralinks.com>',
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
                            .icon { text-align: center; margin: 24px 0; }
                            .icon span { font-size: 64px; }
                            .info-box { background-color: #0f172a; border-radius: 12px; padding: 16px; margin: 24px 0; }
                            .info-row { display: flex; margin-bottom: 8px; }
                            .info-label { color: #64748b; width: 80px; }
                            .info-value { color: #f8fafc; }
                            .text { color: #94a3b8; line-height: 1.6; }
                            .footer { text-align: center; margin-top: 24px; color: #64748b; font-size: 12px; }
                        </style>
                    </head>
                    <body>
                        <div class="container">
                            <div class="logo">
                                <span>🔗 AngoraLinks</span>
                            </div>
                            <div class="icon">
                                <span>📨</span>
                            </div>
                            <h2 style="text-align: center; margin-bottom: 16px; color: #22c55e;">Otrzymaliśmy Twoją wiadomość!</h2>
                            <p class="text">Cześć <strong style="color: #f8fafc;">${name}</strong>!</p>
                            <p class="text">Dziękujemy za kontakt z nami. Twoja wiadomość została pomyślnie dostarczona.</p>
                            
                            <div class="info-box">
                                <div class="info-row">
                                    <span class="info-label">Temat:</span>
                                    <span class="info-value">${subject}</span>
                                </div>
                            </div>
                            
                            <p class="text">Postaramy się odpowiedzieć najszybciej jak to możliwe, zazwyczaj w ciągu <strong style="color: #f8fafc;">24-48 godzin</strong>.</p>
                            
                            <p class="text" style="margin-top: 24px;">Pozdrawiamy,<br><strong style="color: #0ea5e9;">Zespół AngoraLinks</strong></p>
                            
                            <div class="footer">
                                &copy; 2024 AngoraLinks. Wszystkie prawa zastrzeżone.
                            </div>
                        </div>
                    </body>
                    </html>
                `
            });

            console.log(`Email potwierdzenia kontaktu wysłany do: ${email}`);
            return true;

        } catch (error) {
            console.error('Błąd wysyłania email potwierdzenia:', error);
            return false;
        }
    }

    // Wyślij powiadomienie, że wiadomość została odczytana
    async sendMessageReadNotification(email, name, subject) {
        if (!this.transporter) {
            console.warn('Email nie skonfigurowany - pomijam wysyłkę powiadomienia');
            return true;
        }

        try {
            await this.transporter.sendMail({
                from: process.env.EMAIL_FROM || 'AngoraLinks <noreply@angoralinks.com>',
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
                            .icon { text-align: center; margin: 24px 0; }
                            .icon span { font-size: 64px; }
                            .status-box { background-color: rgba(34, 197, 94, 0.1); border: 1px solid #22c55e; border-radius: 12px; padding: 16px; margin: 24px 0; text-align: center; }
                            .info-box { background-color: #0f172a; border-radius: 12px; padding: 16px; margin: 24px 0; }
                            .text { color: #94a3b8; line-height: 1.6; }
                            .footer { text-align: center; margin-top: 24px; color: #64748b; font-size: 12px; }
                        </style>
                    </head>
                    <body>
                        <div class="container">
                            <div class="logo">
                                <span>🔗 AngoraLinks</span>
                            </div>
                            <div class="icon">
                                <span>👀</span>
                            </div>
                            <h2 style="text-align: center; margin-bottom: 16px;">Twoja wiadomość została przeczytana</h2>
                            
                            <div class="status-box">
                                <span style="color: #22c55e; font-weight: bold;">✓ Przeczytana przez zespół</span>
                            </div>
                            
                            <p class="text">Cześć <strong style="color: #f8fafc;">${name}</strong>!</p>
                            <p class="text">Informujemy, że Twoja wiadomość dotycząca tematu:</p>
                            
                            <div class="info-box">
                                <p style="color: #0ea5e9; margin: 0; font-weight: bold;">"${subject}"</p>
                            </div>
                            
                            <p class="text">została przeczytana przez nasz zespół. Jeśli Twoje zgłoszenie wymaga odpowiedzi, wkrótce się z Tobą skontaktujemy.</p>
                            
                            <p class="text" style="margin-top: 24px;">Pozdrawiamy,<br><strong style="color: #0ea5e9;">Zespół AngoraLinks</strong></p>
                            
                            <div class="footer">
                                &copy; 2024 AngoraLinks. Wszystkie prawa zastrzeżone.
                            </div>
                        </div>
                    </body>
                    </html>
                `
            });

            console.log(`Email o odczytaniu wiadomości wysłany do: ${email}`);
            return true;

        } catch (error) {
            console.error('Błąd wysyłania email o odczytaniu:', error);
            return false;
        }
    }
}

module.exports = new EmailService();