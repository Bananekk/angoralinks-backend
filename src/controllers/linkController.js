const { PrismaClient } = require('@prisma/client');
const linkService = require('../services/linkService');

const prisma = new PrismaClient();

class LinkController {
    // POST /api/links
    async create(req, res) {
        try {
            const { url, title, description } = req.body;
            const userId = req.user.id;

            if (!url) {
                return res.status(400).json({
                    error: 'URL jest wymagany'
                });
            }

            if (!linkService.isValidUrl(url)) {
                return res.status(400).json({
                    error: 'Nieprawidłowy format URL'
                });
            }

            // Walidacja tytułu
            if (title && title.length > 100) {
                return res.status(400).json({
                    error: 'Tytuł może mieć maksymalnie 100 znaków'
                });
            }

            // Walidacja opisu
            if (description && description.length > 500) {
                return res.status(400).json({
                    error: 'Opis może mieć maksymalnie 500 znaków'
                });
            }

            // Generuj unikalny kod
            let shortCode;
            let exists = true;
            while (exists) {
                shortCode = linkService.generateShortCode();
                const existing = await prisma.link.findUnique({
                    where: { shortCode }
                });
                exists = !!existing;
            }

            const newLink = await prisma.link.create({
                data: {
                    userId,
                    originalUrl: url,
                    shortCode,
                    title: title || null,
                    description: description || null
                }
            });

            res.status(201).json({
                message: 'Link utworzony',
                link: {
                    id: newLink.id,
                    originalUrl: newLink.originalUrl,
                    shortCode: newLink.shortCode,
                    shortUrl: `${process.env.APP_URL}/l/${newLink.shortCode}`,
                    title: newLink.title,
                    description: newLink.description,
                    totalClicks: newLink.totalClicks,
                    totalEarned: parseFloat(newLink.totalEarned),
                    isActive: newLink.is_active,
                    createdAt: newLink.createdAt
                }
            });

        } catch (error) {
            console.error('Błąd tworzenia linka:', error);
            res.status(500).json({
                error: 'Błąd serwera podczas tworzenia linka'
            });
        }
    }

    // GET /api/links
    async list(req, res) {
        try {
            const userId = req.user.id;

            const links = await prisma.link.findMany({
                where: { userId },
                orderBy: { createdAt: 'desc' }
            });

            res.json({
                links: links.map(link => ({
                    id: link.id,
                    originalUrl: link.originalUrl,
                    shortCode: link.shortCode,
                    shortUrl: `${process.env.APP_URL}/l/${link.shortCode}`,
                    title: link.title,
                    description: link.description,
                    totalClicks: link.totalClicks,
                    totalEarned: parseFloat(link.totalEarned),
                    isActive: link.is_active,
                    createdAt: link.createdAt
                })),
                total: links.length
            });

        } catch (error) {
            console.error('Błąd pobierania linków:', error);
            res.status(500).json({
                error: 'Błąd serwera'
            });
        }
    }

    // GET /api/links/:id
    async get(req, res) {
        try {
            const { id } = req.params;
            const userId = req.user.id;

            const link = await prisma.link.findFirst({
                where: { id, userId },
                include: {
                    visits: {
                        take: 10,
                        orderBy: { createdAt: 'desc' }
                    }
                }
            });

            if (!link) {
                return res.status(404).json({
                    error: 'Link nie znaleziony'
                });
            }

            res.json({
                link: {
                    id: link.id,
                    originalUrl: link.originalUrl,
                    shortCode: link.shortCode,
                    shortUrl: `${process.env.APP_URL}/l/${link.shortCode}`,
                    title: link.title,
                    description: link.description,
                    totalClicks: link.totalClicks,
                    totalEarned: parseFloat(link.totalEarned),
                    isActive: link.is_active,
                    createdAt: link.createdAt
                },
                recentVisits: link.visits
            });

        } catch (error) {
            console.error('Błąd pobierania linka:', error);
            res.status(500).json({
                error: 'Błąd serwera'
            });
        }
    }

    // PUT /api/links/:id - ROZBUDOWANA WERSJA
    async update(req, res) {
        try {
            const { id } = req.params;
            const { originalUrl, title, description, isActive } = req.body;
            const userId = req.user.id;

            // Sprawdź czy link istnieje i należy do użytkownika
            const link = await prisma.link.findFirst({
                where: { id, userId }
            });

            if (!link) {
                return res.status(404).json({
                    error: 'Link nie znaleziony'
                });
            }

            // Walidacja URL jeśli podany
            if (originalUrl !== undefined) {
                if (!originalUrl || originalUrl.trim() === '') {
                    return res.status(400).json({
                        error: 'URL nie może być pusty'
                    });
                }

                if (!linkService.isValidUrl(originalUrl)) {
                    return res.status(400).json({
                        error: 'Nieprawidłowy format URL. URL musi zaczynać się od http:// lub https://'
                    });
                }
            }

            // Walidacja tytułu
            if (title !== undefined && title !== null && title.length > 100) {
                return res.status(400).json({
                    error: 'Tytuł może mieć maksymalnie 100 znaków'
                });
            }

            // Walidacja opisu
            if (description !== undefined && description !== null && description.length > 500) {
                return res.status(400).json({
                    error: 'Opis może mieć maksymalnie 500 znaków'
                });
            }

            // Przygotuj dane do aktualizacji
            const updateData = {};

            if (originalUrl !== undefined) {
                updateData.originalUrl = originalUrl.trim();
            }

            if (title !== undefined) {
                updateData.title = title === '' ? null : title;
            }

            if (description !== undefined) {
                updateData.description = description === '' ? null : description;
            }

            if (isActive !== undefined) {
                updateData.is_active = Boolean(isActive);
            }

            // Aktualizuj link
            const updatedLink = await prisma.link.update({
                where: { id },
                data: updateData
            });

            res.json({
                message: 'Link zaktualizowany',
                link: {
                    id: updatedLink.id,
                    originalUrl: updatedLink.originalUrl,
                    shortCode: updatedLink.shortCode,
                    shortUrl: `${process.env.APP_URL}/l/${updatedLink.shortCode}`,
                    title: updatedLink.title,
                    description: updatedLink.description,
                    totalClicks: updatedLink.totalClicks,
                    totalEarned: parseFloat(updatedLink.totalEarned),
                    isActive: updatedLink.is_active,
                    createdAt: updatedLink.createdAt,
                    updatedAt: updatedLink.updated_at
                }
            });

        } catch (error) {
            console.error('Błąd aktualizacji linka:', error);
            res.status(500).json({
                error: 'Błąd serwera podczas aktualizacji linka'
            });
        }
    }

    // DELETE /api/links/:id
    async delete(req, res) {
        try {
            const { id } = req.params;
            const userId = req.user.id;

            const link = await prisma.link.findFirst({
                where: { id, userId }
            });

            if (!link) {
                return res.status(404).json({
                    error: 'Link nie znaleziony'
                });
            }

            await prisma.link.delete({
                where: { id }
            });

            res.json({
                message: 'Link usunięty'
            });

        } catch (error) {
            console.error('Błąd usuwania linka:', error);
            res.status(500).json({
                error: 'Błąd serwera'
            });
        }
    }
}

module.exports = { linkController: new LinkController() };