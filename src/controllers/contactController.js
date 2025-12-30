const { PrismaClient } = require('@prisma/client');
const emailUtils = require('../utils/email');

const prisma = new PrismaClient();

class ContactController {
    // POST /api/contact - wyślij wiadomość (publiczny)
    async send(req, res) {
        try {
            const { name, email, subject, message } = req.body;

            if (!name || !email || !subject || !message) {
                return res.status(400).json({ error: 'Wszystkie pola są wymagane' });
            }

            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (!emailRegex.test(email)) {
                return res.status(400).json({ error: 'Nieprawidłowy adres email' });
            }

            if (name.length > 100) {
                return res.status(400).json({ error: 'Imię jest za długie (max 100 znaków)' });
            }
            if (message.length > 5000) {
                return res.status(400).json({ error: 'Wiadomość jest za długa (max 5000 znaków)' });
            }

            // ContactMessage używa camelCase (isRead, createdAt)
            const contactMessage = await prisma.contactMessage.create({
                data: {
                    name: name.trim(),
                    email: email.trim().toLowerCase(),
                    subject: subject.trim(),
                    message: message.trim()
                }
            });

            // Wyślij potwierdzenie
            console.log('🔔 Wysyłam potwierdzenie kontaktu do:', email);
            emailUtils.sendContactConfirmation(
                email.trim().toLowerCase(),
                name.trim(),
                subject.trim()
            )
                .then(() => console.log('✅ Contact confirmation email wysłany!'))
                .catch(err => console.error('❌ Contact confirmation error:', err));

            res.status(201).json({
                message: 'Wiadomość została wysłana',
                id: contactMessage.id
            });

        } catch (error) {
            console.error('Błąd wysyłania wiadomości:', error);
            res.status(500).json({ error: 'Błąd serwera' });
        }
    }

    // GET /api/admin/messages - lista wiadomości (admin)
    async list(req, res) {
        try {
            const messages = await prisma.contactMessage.findMany({
                orderBy: { createdAt: 'desc' }
            });

            const unreadCount = await prisma.contactMessage.count({
                where: { isRead: false }
            });

            res.json({
                messages: messages.map(m => ({
                    id: m.id,
                    name: m.name,
                    email: m.email,
                    subject: m.subject,
                    message: m.message,
                    isRead: m.isRead,
                    createdAt: m.createdAt
                })),
                unreadCount
            });

        } catch (error) {
            console.error('Błąd pobierania wiadomości:', error);
            res.status(500).json({ error: 'Błąd serwera' });
        }
    }

    // PUT /api/admin/messages/:id/read - oznacz jako przeczytane (admin)
    async markAsRead(req, res) {
        try {
            const { id } = req.params;
            const { sendNotification = true } = req.body;

            const message = await prisma.contactMessage.findUnique({
                where: { id }
            });

            if (!message) {
                return res.status(404).json({ error: 'Wiadomość nie znaleziona' });
            }

            if (message.isRead) {
                return res.json({ message: 'Wiadomość już była oznaczona jako przeczytana' });
            }

            await prisma.contactMessage.update({
                where: { id },
                data: { isRead: true }
            });

            // Wyślij powiadomienie email
            if (sendNotification) {
                console.log('🔔 Wysyłam powiadomienie o przeczytaniu do:', message.email);
                emailUtils.sendMessageReadNotification(
                    message.email,
                    message.name,
                    message.subject
                )
                    .then(() => console.log('✅ Message read notification wysłany!'))
                    .catch(err => console.error('❌ Message read notification error:', err));
            }

            res.json({ message: 'Oznaczono jako przeczytane' });

        } catch (error) {
            console.error('Błąd aktualizacji wiadomości:', error);
            res.status(500).json({ error: 'Błąd serwera' });
        }
    }

    // DELETE /api/admin/messages/:id - usuń wiadomość (admin)
    async delete(req, res) {
        try {
            const { id } = req.params;

            const message = await prisma.contactMessage.findUnique({
                where: { id }
            });

            if (!message) {
                return res.status(404).json({ error: 'Wiadomość nie znaleziona' });
            }

            await prisma.contactMessage.delete({
                where: { id }
            });

            res.json({ message: 'Wiadomość usunięta' });

        } catch (error) {
            console.error('Błąd usuwania wiadomości:', error);
            res.status(500).json({ error: 'Błąd serwera' });
        }
    }
}

module.exports = { contactController: new ContactController() };