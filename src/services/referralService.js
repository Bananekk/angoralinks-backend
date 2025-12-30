// services/referralService.js
const { PrismaClient } = require('@prisma/client');
const crypto = require('crypto');
const prisma = new PrismaClient();

class ReferralService {

    // Generuje unikalny kod polecający
    static generateReferralCode() {
        return crypto.randomBytes(4).toString('hex').toUpperCase();
    }

    // 🆕 Hashuje IP (taki sam algorytm jak w earningsService)
    static hashIP(ip) {
        const salt = process.env.IP_HASH_SALT || 'angoralinks-2024';
        return crypto
            .createHash('sha256')
            .update(ip + salt)
            .digest('hex')
            .substring(0, 32);
    }

    // Pobiera ustawienia systemu referali
    static async getSettings() {
        let settings = await prisma.systemSettings.findUnique({
            where: { id: 'settings' }
        });

        if (!settings) {
            settings = await prisma.systemSettings.create({
                data: {
                    id: 'settings',
                    referralCommissionRate: 0.10,
                    referralBonusDuration: null,
                    minReferralPayout: 5.00,
                    referralSystemActive: true
                }
            });
        }

        return settings;
    }

    // Waliduje kod polecający przy rejestracji
    static async validateReferralCode(code) {
        if (!code) return null;

        const referrer = await prisma.user.findFirst({
            where: { 
                referralCode: code.toUpperCase(),
                isActive: true
            },
            select: {
                id: true,
                email: true,
                isActive: true,
                referralCode: true,
                referralIpHash: true,
                registrationIp: true
            }
        });

        return referrer || null;
    }

    // 🆕 Sprawdza czy IP poleconego matchuje z IP polecającego
    static async checkFraudulentReferral(referrerId, registrationIpHash) {
        const referrer = await prisma.user.findUnique({
            where: { id: referrerId },
            select: {
                id: true,
                referralIpHash: true,
                registrationIp: true
            }
        });

        if (!referrer) return { isFraud: false };

        // Sprawdź czy IP rejestracji poleconego = IP rejestracji polecającego
        // Lub IP rejestracji poleconego = IP z którego polecający wygenerował kod
        const referrerIpHashes = [];
        
        if (referrer.referralIpHash) {
            referrerIpHashes.push(referrer.referralIpHash);
        }
        
        // Jeśli mamy zaszyfrowane IP rejestracji, hashujemy je do porównania
        // (zakładamy że registrationIp może być już zahashowane lub zaszyfrowane)
        if (referrer.registrationIp) {
            // Jeśli to jest już hash (32 znaki hex), użyj go bezpośrednio
            if (referrer.registrationIp.length === 32 && /^[a-f0-9]+$/i.test(referrer.registrationIp)) {
                referrerIpHashes.push(referrer.registrationIp);
            }
        }

        // Sprawdź dopasowanie
        const isFraud = referrerIpHashes.includes(registrationIpHash);

        return {
            isFraud,
            reason: isFraud ? 'same_ip_as_referrer' : null,
            matchedHash: isFraud ? registrationIpHash : null
        };
    }

    // 🆕 Zaktualizowana funkcja przypisania referera z wykrywaniem fraudu
    static async assignReferrer(userId, referralCode, registrationIp) {
        const settings = await this.getSettings();

        if (!settings.referralSystemActive) {
            return { success: false, message: 'System referali jest wyłączony' };
        }

        const referrer = await this.validateReferralCode(referralCode);
        if (!referrer) {
            return { success: false, message: 'Nieprawidłowy kod polecający' };
        }

        if (referrer.id === userId) {
            return { success: false, message: 'Nie możesz polecić sam siebie' };
        }

        let bonusExpires = null;
        if (settings.referralBonusDuration) {
            bonusExpires = new Date();
            bonusExpires.setDate(bonusExpires.getDate() + settings.referralBonusDuration);
        }

        // 🆕 Hashuj IP rejestracji i sprawdź fraud
        const registrationIpHash = registrationIp ? this.hashIP(registrationIp) : null;
        let fraudData = { isFraud: false, reason: null };

        if (registrationIpHash) {
            fraudData = await this.checkFraudulentReferral(referrer.id, registrationIpHash);
        }

        await prisma.user.update({
            where: { id: userId },
            data: {
                referredById: referrer.id,
                referralBonusExpires: bonusExpires,
                referralIpHash: registrationIpHash,
                referralFraudFlag: fraudData.isFraud,
                referralFraudReason: fraudData.reason,
                referralFraudCheckedAt: new Date()
            }
        });

        return {
            success: true,
            referrer: referrer,
            bonusExpires: bonusExpires,
            fraudDetected: fraudData.isFraud,
            fraudReason: fraudData.reason
        };
    }

    // 🆕 Aktualizuje IP hash polecającego (wywoływane przy logowaniu)
    static async updateReferrerIpHash(userId, ip) {
        if (!ip) return;

        const ipHash = this.hashIP(ip);
        
        await prisma.user.update({
            where: { id: userId },
            data: {
                referralIpHash: ipHash
            }
        });
    }

// Nalicza prowizję od wizyty poleconego użytkownika - Z PULI PLATFORMY
static async processReferralCommission(userId, visitId, userEarning, platformEarning) {
    try {
        const settings = await this.getSettings();

        if (!settings.referralSystemActive) {
            return null;
        }

        const user = await prisma.user.findUnique({
            where: { id: userId },
            include: {
                referredBy: {
                    select: { id: true, isActive: true }
                }
            }
        });

        if (!user?.referredBy || !user.referredBy.isActive) {
            return null;
        }

        // Nie naliczaj prowizji jeśli wykryto fraud
        if (user.referralFraudFlag) {
            console.log(`Skipping referral commission for user ${userId} - fraud detected`);
            return null;
        }

        if (user.referralBonusExpires && new Date() > user.referralBonusExpires) {
            return null;
        }

        const commissionRate = parseFloat(settings.referralCommissionRate);
        
        // 🆕 ZMIANA: Prowizja liczona od zarobku PLATFORMY, nie użytkownika
        const commission = parseFloat(platformEarning) * commissionRate;

        if (commission <= 0) {
            return null;
        }

        // Sprawdź czy prowizja nie przekracza zarobku platformy
        if (commission > parseFloat(platformEarning)) {
            console.log(`Referral commission ${commission} exceeds platform earning ${platformEarning}, skipping`);
            return null;
        }

        const result = await prisma.$transaction(async (tx) => {
            const commissionRecord = await tx.referralCommission.create({
                data: {
                    referrerId: user.referredBy.id,
                    referredId: userId,
                    visitId: visitId,
                    amount: commission,
                    referredEarning: userEarning,
                    commissionRate: commissionRate,
                    status: 'processed',
                    processedAt: new Date()
                }
            });

            await tx.user.update({
                where: { id: user.referredBy.id },
                data: {
                    balance: { increment: commission },
                    referralEarnings: { increment: commission },
                    totalEarned: { increment: commission }
                }
            });

            return commissionRecord;
        });

        return result;
    } catch (error) {
        console.error('Error processing referral commission:', error);
        return null;
    }
}

    // Pobiera statystyki referali dla użytkownika
    static async getUserReferralStats(userId) {
        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: {
                referralCode: true,
                referralEarnings: true,
                referredBy: {
                    select: { email: true, referralCode: true }
                }
            }
        });

        const referralsCount = await prisma.user.count({
            where: { referredById: userId }
        });

        const activeReferrals = await prisma.user.count({
            where: {
                referredById: userId,
                totalEarned: { gt: 0 }
            }
        });

        const referrals = await prisma.user.findMany({
            where: { referredById: userId },
            select: {
                id: true,
                email: true,
                createdAt: true,
                totalEarned: true,
                isActive: true,
                referralBonusExpires: true
            },
            orderBy: { createdAt: 'desc' },
            take: 50
        });

        const commissionsAggregate = await prisma.referralCommission.aggregate({
            where: { referrerId: userId },
            _sum: { amount: true },
            _count: true
        });

        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

        const recentCommissions = await prisma.referralCommission.aggregate({
            where: {
                referrerId: userId,
                createdAt: { gte: thirtyDaysAgo }
            },
            _sum: { amount: true }
        });

        return {
            referralCode: user.referralCode,
            referralLink: `https://angoralinks.pl/ref/${user.referralCode}`,
            referredBy: user.referredBy ? {
                email: this.maskEmail(user.referredBy.email)
            } : null,
            stats: {
                totalReferrals: referralsCount,
                activeReferrals: activeReferrals,
                totalEarnings: parseFloat(user.referralEarnings || 0),
                last30DaysEarnings: parseFloat(recentCommissions._sum.amount || 0),
                totalCommissions: commissionsAggregate._count
            },
            referrals: referrals.map(ref => ({
                id: ref.id,
                email: this.maskEmail(ref.email),
                joinedAt: ref.createdAt,
                totalEarned: parseFloat(ref.totalEarned || 0),
                isActive: ref.isActive,
                bonusExpires: ref.referralBonusExpires
            }))
        };
    }

    // Pobiera szczegóły prowizji dla użytkownika
    static async getUserCommissions(userId, page = 1, limit = 20) {
        const skip = (page - 1) * limit;

        const [commissions, total] = await Promise.all([
            prisma.referralCommission.findMany({
                where: { referrerId: userId },
                include: {
                    referred: {
                        select: { email: true }
                    }
                },
                orderBy: { createdAt: 'desc' },
                skip,
                take: limit
            }),
            prisma.referralCommission.count({
                where: { referrerId: userId }
            })
        ]);

        return {
            commissions: commissions.map(c => ({
                id: c.id,
                referredEmail: this.maskEmail(c.referred.email),
                referredEarning: parseFloat(c.referredEarning),
                commission: parseFloat(c.amount),
                commissionRate: `${parseFloat(c.commissionRate) * 100}%`,
                createdAt: c.createdAt
            })),
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit)
            }
        };
    }

    // Maskuje email dla prywatności
    static maskEmail(email) {
        if (!email) return '';
        const [local, domain] = email.split('@');
        if (local.length <= 2) return `${local[0]}***@${domain}`;
        return `${local[0]}${local[1]}***@${domain}`;
    }

    // ============ ADMIN METHODS ============

    // 🆕 Pobiera podejrzane polecenia (fraud alerts)
    static async getFraudAlerts() {
        const fraudulentReferrals = await prisma.user.findMany({
            where: {
                referralFraudFlag: true,
                referredById: { not: null }
            },
            select: {
                id: true,
                email: true,
                createdAt: true,
                isActive: true,
                referralFraudReason: true,
                referralFraudCheckedAt: true,
                totalEarned: true,
                referredBy: {
                    select: {
                        id: true,
                        email: true,
                        referralCode: true
                    }
                }
            },
            orderBy: { createdAt: 'desc' }
        });

        // Oblicz ile prowizji wygenerowały te podejrzane konta
        const alertsWithCommissions = await Promise.all(
            fraudulentReferrals.map(async (user) => {
                const commissions = await prisma.referralCommission.aggregate({
                    where: { referredId: user.id },
                    _sum: { amount: true }
                });

                return {
                    ...user,
                    commissionGenerated: parseFloat(commissions._sum.amount || 0)
                };
            })
        );

        return alertsWithCommissions;
    }

    // 🆕 Oznacz referral jako sprawdzony (usuń flagę fraud lub zostaw)
    static async resolveFraudAlert(userId, action) {
        if (action === 'dismiss') {
            // Usuń flagę fraud - uznaj za prawidłowe
            await prisma.user.update({
                where: { id: userId },
                data: {
                    referralFraudFlag: false,
                    referralFraudReason: 'dismissed_by_admin'
                }
            });
            return { success: true, message: 'Alert odrzucony' };
        } else if (action === 'block') {
            // Zablokuj użytkownika
            await prisma.user.update({
                where: { id: userId },
                data: {
                    isActive: false,
                    referralFraudReason: 'blocked_by_admin'
                }
            });
            return { success: true, message: 'Użytkownik zablokowany' };
        } else if (action === 'block_both') {
            // Zablokuj zarówno poleconego jak i polecającego
            const user = await prisma.user.findUnique({
                where: { id: userId },
                select: { referredById: true }
            });

            await prisma.user.updateMany({
                where: {
                    id: { in: [userId, user.referredById].filter(Boolean) }
                },
                data: {
                    isActive: false
                }
            });

            await prisma.user.update({
                where: { id: userId },
                data: {
                    referralFraudReason: 'blocked_both_by_admin'
                }
            });

            return { success: true, message: 'Obaj użytkownicy zablokowani' };
        }

        return { success: false, message: 'Nieznana akcja' };
    }

    static async getAdminStats() {
        const [
            totalReferrals,
            totalCommissions,
            commissionsSum,
            activeReferrers,
            fraudAlerts,
            topReferrers,
            recentReferrals,
            settings
        ] = await Promise.all([
            prisma.user.count({
                where: { referredById: { not: null } }
            }),
            prisma.referralCommission.count(),
            prisma.referralCommission.aggregate({
                _sum: { amount: true }
            }),
            prisma.user.count({
                where: {
                    referrals: { some: {} }
                }
            }),
            // 🆕 Liczba alertów fraud
            prisma.user.count({
                where: {
                    referralFraudFlag: true,
                    referredById: { not: null }
                }
            }),
            prisma.user.findMany({
                where: {
                    referralEarnings: { gt: 0 }
                },
                select: {
                    id: true,
                    email: true,
                    referralCode: true,
                    referralEarnings: true,
                    _count: {
                        select: { referrals: true }
                    }
                },
                orderBy: { referralEarnings: 'desc' },
                take: 10
            }),
            prisma.user.findMany({
                where: { referredById: { not: null } },
                select: {
                    id: true,
                    email: true,
                    createdAt: true,
                    referralFraudFlag: true,
                    referredBy: {
                        select: { email: true, referralCode: true }
                    }
                },
                orderBy: { createdAt: 'desc' },
                take: 20
            }),
            this.getSettings()
        ]);

        return {
            overview: {
                totalReferrals,
                totalCommissions,
                totalCommissionsAmount: parseFloat(commissionsSum._sum.amount || 0),
                activeReferrers,
                fraudAlerts // 🆕
            },
            topReferrers: topReferrers.map(u => ({
                id: u.id,
                email: u.email,
                referralCode: u.referralCode,
                earnings: parseFloat(u.referralEarnings),
                referralsCount: u._count.referrals
            })),
            recentReferrals: recentReferrals.map(u => ({
                id: u.id,
                email: this.maskEmail(u.email),
                joinedAt: u.createdAt,
                fraudFlag: u.referralFraudFlag, // 🆕
                referredBy: {
                    email: u.referredBy.email,
                    code: u.referredBy.referralCode
                }
            })),
            settings: {
                commissionRate: parseFloat(settings.referralCommissionRate) * 100,
                bonusDuration: settings.referralBonusDuration,
                minPayout: parseFloat(settings.minReferralPayout),
                isActive: settings.referralSystemActive
            }
        };
    }

    static async updateSettings(data) {
        const updateData = {};

        if (data.commissionRate !== undefined) {
            updateData.referralCommissionRate = data.commissionRate / 100;
        }
        if (data.bonusDuration !== undefined) {
            updateData.referralBonusDuration = data.bonusDuration;
        }
        if (data.minPayout !== undefined) {
            updateData.minReferralPayout = data.minPayout;
        }
        if (data.isActive !== undefined) {
            updateData.referralSystemActive = data.isActive;
        }

        const settings = await prisma.systemSettings.update({
            where: { id: 'settings' },
            data: updateData
        });

        return {
            commissionRate: parseFloat(settings.referralCommissionRate) * 100,
            bonusDuration: settings.referralBonusDuration,
            minPayout: parseFloat(settings.minReferralPayout),
            isActive: settings.referralSystemActive
        };
    }

    static async getAllReferrals(page = 1, limit = 50, search = '') {
        const skip = (page - 1) * limit;

        const where = {
            referredById: { not: null },
            ...(search && {
                OR: [
                    { email: { contains: search, mode: 'insensitive' } },
                    { referredBy: { email: { contains: search, mode: 'insensitive' } } }
                ]
            })
        };

        const [referrals, total] = await Promise.all([
            prisma.user.findMany({
                where,
                include: {
                    referredBy: {
                        select: { id: true, email: true, referralCode: true }
                    }
                },
                orderBy: { createdAt: 'desc' },
                skip,
                take: limit
            }),
            prisma.user.count({ where })
        ]);

        const referralsWithCommissions = await Promise.all(
            referrals.map(async (user) => {
                const commissions = await prisma.referralCommission.aggregate({
                    where: { referredId: user.id },
                    _sum: { amount: true }
                });

                return {
                    id: user.id,
                    email: user.email,
                    joinedAt: user.createdAt,
                    totalEarned: parseFloat(user.totalEarned || 0),
                    bonusExpires: user.referralBonusExpires,
                    isActive: user.isActive,
                    fraudFlag: user.referralFraudFlag, // 🆕
                    fraudReason: user.referralFraudReason, // 🆕
                    referredBy: {
                        id: user.referredBy.id,
                        email: user.referredBy.email,
                        code: user.referredBy.referralCode
                    },
                    totalCommissionGenerated: parseFloat(commissions._sum.amount || 0)
                };
            })
        );

        return {
            referrals: referralsWithCommissions,
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit)
            }
        };
    }
}

module.exports = ReferralService;