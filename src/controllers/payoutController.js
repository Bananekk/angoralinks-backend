const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const MIN_PAYOUT = 10.00;

class PayoutController {
    // GET /api/payouts - lista wypłat użytkownika
    async list(req, res) {
        try {
            const payouts = await prisma.payout.findMany({
                where: { userId: req.user.id },
                orderBy: { createdAt: 'desc' }
            });

            res.json({
                payouts: payouts.map(p => ({
                    id: p.id,
                    amount: parseFloat(p.amount),
                    method: p.method,
                    address: p.address,
                    status: p.status,
                    createdAt: p.createdAt,
                    processedAt: p.processedAt
                }))
            });
        } catch (error) {
            console.error('Błąd pobierania wypłat:', error);
            res.status(500).json({ error: 'Błąd serwera' });
        }
    }

    // POST /api/payouts - nowy wniosek o wypłatę
    async create(req, res) {
        try {
            const { amount, method, address } = req.body;

            if (!amount || !method || !address) {
                return res.status(400).json({ error: 'Wszystkie pola są wymagane' });
            }

            const parsedAmount = parseFloat(amount);

            if (parsedAmount < MIN_PAYOUT) {
                return res.status(400).json({ error: `Minimalna wypłata to $${MIN_PAYOUT}` });
            }

            // Mapowanie metod na enum
            const methodMap = {
                'paypal': 'PAYPAL',
                'PAYPAL': 'PAYPAL',
                'bitcoin': 'BITCOIN',
                'BITCOIN': 'BITCOIN',
                'btc': 'BITCOIN',
                'bank_transfer': 'BANK_TRANSFER',
                'BANK_TRANSFER': 'BANK_TRANSFER'
            };

            const normalizedMethod = methodMap[method];

            if (!normalizedMethod) {
                return res.status(400).json({ error: 'Nieprawidłowa metoda wypłaty' });
            }

            const user = await prisma.user.findUnique({
                where: { id: req.user.id }
            });

            if (parseFloat(user.balance) < parsedAmount) {
                return res.status(400).json({ error: 'Niewystarczające środki' });
            }

            // Sprawdź czy nie ma oczekującej wypłaty
            const pendingPayout = await prisma.payout.findFirst({
                where: {
                    userId: req.user.id,
                    status: { in: ['PENDING', 'PROCESSING'] }
                }
            });

            if (pendingPayout) {
                return res.status(400).json({ error: 'Masz już oczekującą wypłatę' });
            }

            // Utwórz wypłatę i odejmij saldo
            const [payout] = await prisma.$transaction([
                prisma.payout.create({
                    data: {
                        userId: req.user.id,
                        amount: parsedAmount,
                        method: normalizedMethod,
                        address: address.trim(),
                        status: 'PENDING'
                    }
                }),
                prisma.user.update({
                    where: { id: req.user.id },
                    data: {
                        balance: { decrement: parsedAmount }
                    }
                })
            ]);

            res.status(201).json({
                message: 'Wniosek o wypłatę został złożony',
                payout: {
                    id: payout.id,
                    amount: parseFloat(payout.amount),
                    method: payout.method,
                    status: payout.status,
                    address: payout.address,
                    createdAt: payout.createdAt
                }
            });

        } catch (error) {
            console.error('Błąd tworzenia wypłaty:', error);
            res.status(500).json({ error: 'Błąd serwera' });
        }
    }
}

module.exports = { payoutController: new PayoutController() };