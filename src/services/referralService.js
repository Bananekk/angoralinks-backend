// services/referralService.js
const { PrismaClient } = require('@prisma/client');
const crypto = require('crypto');
const prisma = new PrismaClient();

class ReferralService {

    // ================== HASHING ==================

    // Generuje unikalny kod polecający
    static generateReferralCode() {
        return crypto.randomBytes(4).toString('hex').toUpperCase();
    }

    // Hashuje IP (taki sam algorytm jak w earningsService)
    static hashIP(ip) {
        if (!ip) return null;
        const salt = process.env.IP_HASH_SALT || 'angoralinks-2024';
        return crypto
            .createHash('sha256')
            .update(ip + salt)
            .digest('hex')
            .substring(0, 32);
    }

    // 🆕 Hashuje User-Agent
    static hashUserAgent(userAgent) {
        if (!userAgent) return null;
        const salt = process.env.UA_HASH_SALT || 'angoralinks-ua-2024';
        return crypto
            .createHash('sha256')
            .update(userAgent + salt)
            .digest('hex')
            .substring(0, 32);
    }

    // 🆕 Generuje fingerprint urządzenia
    static generateDeviceFingerprint(deviceData) {
        if (!deviceData) return null;
        
        const {
            screenResolution,
            timezone,
            language,
            platform,
            colorDepth,
            hardwareConcurrency,
            deviceMemory
        } = deviceData;
        
        const fingerprintString = [
            screenResolution || '',
            timezone || '',
            language || '',
            platform || '',
            colorDepth || '',
            hardwareConcurrency || '',
            deviceMemory || ''
        ].join('|');
        
        if (fingerprintString === '||||||') return null;
        
        const salt = process.env.FP_HASH_SALT || 'angoralinks-fp-2024';
        return crypto
            .createHash('sha256')
            .update(fingerprintString + salt)
            .digest('hex')
            .substring(0, 32);
    }

    // Generuje kod dla użytkownika (na żądanie)
    static async generateCodeForUser(userId) {
        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { referralCode: true }
        });

        // Jeśli już ma kod, zwróć go
        if (user?.referralCode) {
            return { 
                success: true, 
                code: user.referralCode,
                alreadyExists: true 
            };
        }

        // Generuj unikalny kod
        let code;
        let isUnique = false;
        let attempts = 0;

        while (!isUnique && attempts < 10) {
            code = crypto.randomBytes(4).toString('hex').toUpperCase();
            const existing = await prisma.user.findFirst({
                where: { referralCode: code }
            });
            if (!existing) isUnique = true;
            attempts++;
        }

        if (!isUnique) {
            return { success: false, error: 'Nie udało się wygenerować unikalnego kodu' };
        }

        // Zapisz kod
        await prisma.user.update({
            where: { id: userId },
            data: { referralCode: code }
        });

        return { 
            success: true, 
            code: code,
            alreadyExists: false 
        };
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
                    referralCommissionRate: 0.05,
                    referralBonusDuration: null,
                    minReferralPayout: 5.00,
                    referralSystemActive: true
                }
            });
        }

        return settings;
    }

    // 🆕 Waliduje kod polecający przy rejestracji - ROZSZERZONA
    static async validateReferralCode(code) {
        if (!code) return null;

        const referrer = await prisma.user.findFirst({
            where: { 
                referralCode: code.toUpperCase(),
                isActive: true,
                referralDisabled: false  // 🆕 Sprawdź czy zaproszenia nie są wyłączone
            },
            select: {
                id: true,
                email: true,
                isActive: true,
                referralCode: true,
                referralIpHash: true,
                registrationIp: true,
                deviceFingerprint: true,
                userAgentHash: true,
                browserLanguage: true,
                screenResolution: true,
                timezone: true,
                createdAt: true,
                referralDisabled: true,
                referrals: {
                    select: {
                        id: true,
                        referralIpHash: true,
                        deviceFingerprint: true,
                        createdAt: true
                    },
                    orderBy: { createdAt: 'desc' },
                    take: 10
                }
            }
        });

        return referrer || null;
    }

    // 🆕 ROZSZERZONE sprawdzenie fraudu
    static async checkFraudulentReferral(referrerId, registrationData) {
        const {
            ipHash,
            userAgentHash,
            deviceFingerprint,
            browserLanguage,
            screenResolution,
            timezone
        } = registrationData;

        // Pobierz dane polecającego
        const referrer = await prisma.user.findUnique({
            where: { id: referrerId },
            select: {
                id: true,
                email: true,
                referralIpHash: true,
                registrationIp: true,
                deviceFingerprint: true,
                userAgentHash: true,
                browserLanguage: true,
                screenResolution: true,
                timezone: true,
                createdAt: true,
                referrals: {
                    select: {
                        id: true,
                        referralIpHash: true,
                        deviceFingerprint: true,
                        createdAt: true
                    },
                    orderBy: { createdAt: 'desc' },
                    take: 10
                }
            }
        });

        if (!referrer) {
            return { isSuspicious: false, riskScore: 0, reasons: [], details: {} };
        }

        const reasons = [];
        const details = {
            ipMatch: false,
            deviceMatch: false,
            userAgentMatch: false,
            timingAnomaly: false,
            patternAnomaly: false
        };
        let riskScore = 0;

        // Zbierz wszystkie hashe IP polecającego
        const referrerIpHashes = [];
        if (referrer.referralIpHash) referrerIpHashes.push(referrer.referralIpHash);
        if (referrer.registrationIp && referrer.registrationIp.length === 32 && /^[a-f0-9]+$/i.test(referrer.registrationIp)) {
            referrerIpHashes.push(referrer.registrationIp);
        }

        // 1. Sprawdzenie IP
        if (ipHash && referrerIpHashes.includes(ipHash)) {
            reasons.push('same_ip_as_referrer');
            details.ipMatch = true;
            riskScore += 40;
        }

        // 2. Sprawdzenie Device Fingerprint
        if (deviceFingerprint && referrer.deviceFingerprint === deviceFingerprint) {
            reasons.push('same_device_fingerprint');
            details.deviceMatch = true;
            riskScore += 35;
        }

        // 3. Sprawdzenie User-Agent
        if (userAgentHash && referrer.userAgentHash === userAgentHash) {
            reasons.push('same_user_agent');
            details.userAgentMatch = true;
            riskScore += 15;
        }

        // 4. Sprawdzenie podobieństwa profilu urządzenia
        const profileSimilarity = this.calculateProfileSimilarity(
            {
                browserLanguage: referrer.browserLanguage,
                screenResolution: referrer.screenResolution,
                timezone: referrer.timezone
            },
            { browserLanguage, screenResolution, timezone }
        );

        if (profileSimilarity >= 100) {
            reasons.push('identical_device_profile');
            riskScore += 20;
        } else if (profileSimilarity >= 66) {
            reasons.push('similar_device_profile');
            riskScore += 10;
        }

        // 5. Sprawdzenie timing anomalii
        const referrerAge = Date.now() - new Date(referrer.createdAt).getTime();
        const hoursSinceReferrerCreated = referrerAge / (1000 * 60 * 60);

        if (hoursSinceReferrerCreated < 1) {
            reasons.push('suspicious_timing_very_fast');
            details.timingAnomaly = true;
            riskScore += 15;
        } else if (hoursSinceReferrerCreated < 24) {
            reasons.push('suspicious_timing_fast');
            details.timingAnomaly = true;
            riskScore += 5;
        }

        // 6. Sprawdzenie wzorców w poprzednich referralach
        const patternAnomaly = this.checkReferralPatterns(referrer.referrals, {
            ipHash,
            deviceFingerprint
        });

        if (patternAnomaly.isSuspicious) {
            reasons.push(...patternAnomaly.reasons);
            details.patternAnomaly = true;
            riskScore += patternAnomaly.score;
        }

        // Ogranicz do 100
        riskScore = Math.min(100, riskScore);

        return {
            isSuspicious: riskScore >= 30,
            riskScore,
            reasons,
            details,
            // Stara kompatybilność
            isFraud: riskScore >= 30,
            reason: reasons.join(', ') || null
        };
    }

    // 🆕 Oblicza podobieństwo profilu urządzenia
    static calculateProfileSimilarity(profile1, profile2) {
        let matches = 0;
        let total = 0;

        const fields = ['browserLanguage', 'screenResolution', 'timezone'];

        for (const field of fields) {
            if (profile1[field] && profile2[field]) {
                total++;
                if (profile1[field] === profile2[field]) {
                    matches++;
                }
            }
        }

        if (total === 0) return 0;
        return Math.round((matches / total) * 100);
    }

    // 🆕 Sprawdza wzorce w poprzednich referralach
    static checkReferralPatterns(existingReferrals, newReferralData) {
        const reasons = [];
        let score = 0;

        if (!existingReferrals || existingReferrals.length === 0) {
            return { isSuspicious: false, reasons: [], score: 0 };
        }

        // Sprawdź czy nowy referral ma takie samo IP jak którykolwiek poprzedni
        if (newReferralData.ipHash) {
            const sameIpReferrals = existingReferrals.filter(
                r => r.referralIpHash === newReferralData.ipHash
            );

            if (sameIpReferrals.length > 0) {
                reasons.push('ip_matches_previous_referrals');
                score += 25;
            }
        }

        // Sprawdź czy nowy referral ma taki sam fingerprint jak którykolwiek poprzedni
        if (newReferralData.deviceFingerprint) {
            const sameDeviceReferrals = existingReferrals.filter(
                r => r.deviceFingerprint === newReferralData.deviceFingerprint
            );

            if (sameDeviceReferrals.length > 0) {
                reasons.push('device_matches_previous_referrals');
                score += 30;
            }
        }

        // Sprawdź burst pattern (wiele rejestracji w krótkim czasie)
        const recentReferrals = existingReferrals.filter(r => {
            const age = Date.now() - new Date(r.createdAt).getTime();
            return age < 24 * 60 * 60 * 1000; // ostatnie 24h
        });

        if (recentReferrals.length >= 5) {
            reasons.push('burst_referral_pattern');
            score += 20;
        } else if (recentReferrals.length >= 3) {
            reasons.push('high_referral_frequency');
            score += 10;
        }

        return {
            isSuspicious: reasons.length > 0,
            reasons,
            score
        };
    }

    // 🆕 Tworzy alert fraudu
    static async createFraudAlert(referrerId, referredId, fraudCheck) {
        const { riskScore, reasons, details } = fraudCheck;

        try {
            return await prisma.fraudAlert.create({
                data: {
                    referrerId,
                    referredId,
                    reasons: reasons || [],
                    riskScore: riskScore || 0,
                    ipMatch: details?.ipMatch || false,
                    deviceMatch: details?.deviceMatch || false,
                    userAgentMatch: details?.userAgentMatch || false,
                    timingAnomaly: details?.timingAnomaly || false,
                    status: 'PENDING'
                },
                include: {
                    referrer: {
                        select: { id: true, email: true }
                    },
                    referred: {
                        select: { id: true, email: true }
                    }
                }
            });
        } catch (error) {
            console.error('Error creating fraud alert:', error);
            return null;
        }
    }

    // Przypisanie referera z wykrywaniem fraudu - ROZSZERZONE
    static async assignReferrer(userId, referralCode, registrationIp, deviceData = null, userAgent = null) {
        const settings = await this.getSettings();

        if (!settings.referralSystemActive) {
            return { success: false, message: 'System referali jest wyłączony' };
        }

        const referrer = await this.validateReferralCode(referralCode);
        if (!referrer) {
            return { success: false, message: 'Nieprawidłowy kod polecający lub zaproszenia wyłączone' };
        }

        if (referrer.id === userId) {
            return { success: false, message: 'Nie możesz polecić sam siebie' };
        }

        let bonusExpires = null;
        if (settings.referralBonusDuration) {
            bonusExpires = new Date();
            bonusExpires.setDate(bonusExpires.getDate() + settings.referralBonusDuration);
        }

        // Przygotuj dane do fraud check
        const ipHash = registrationIp ? this.hashIP(registrationIp) : null;
        const userAgentHash = userAgent ? this.hashUserAgent(userAgent) : null;
        const deviceFingerprint = deviceData ? this.generateDeviceFingerprint(deviceData) : null;

        // Rozszerzone sprawdzenie fraudu
        const fraudData = await this.checkFraudulentReferral(referrer.id, {
            ipHash,
            userAgentHash,
            deviceFingerprint,
            browserLanguage: deviceData?.language,
            screenResolution: deviceData?.screenResolution,
            timezone: deviceData?.timezone
        });

        // Aktualizuj użytkownika
        await prisma.user.update({
            where: { id: userId },
            data: {
                referredById: referrer.id,
                referralBonusExpires: bonusExpires,
                referralIpHash: ipHash,
                deviceFingerprint: deviceFingerprint,
                userAgentHash: userAgentHash,
                browserLanguage: deviceData?.language || null,
                screenResolution: deviceData?.screenResolution || null,
                timezone: deviceData?.timezone || null,
                referralFraudFlag: fraudData.isSuspicious,
                referralFraudReason: fraudData.reasons?.join(', ') || null,
                referralFraudCheckedAt: new Date()
            }
        });

        // 🆕 Jeśli wykryto fraud, utwórz alert
        if (fraudData.isSuspicious) {
            await this.createFraudAlert(referrer.id, userId, fraudData);
            console.log(`🚨 Fraud alert created: user ${userId}, risk score: ${fraudData.riskScore}`);
        }

        return {
            success: true,
            referrer: referrer,
            bonusExpires: bonusExpires,
            fraudDetected: fraudData.isSuspicious,
            fraudReason: fraudData.reasons?.join(', ') || null,
            riskScore: fraudData.riskScore
        };
    }

    // Aktualizuje IP hash polecającego (wywoływane przy logowaniu)
    static async updateReferrerIpHash(userId, ip, userAgent = null) {
        if (!ip) return;

        const ipHash = this.hashIP(ip);
        const userAgentHash = userAgent ? this.hashUserAgent(userAgent) : undefined;
        
        const updateData = { referralIpHash: ipHash };
        if (userAgentHash) updateData.userAgentHash = userAgentHash;

        await prisma.user.update({
            where: { id: userId },
            data: updateData
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
            
            // Prowizja liczona od zarobku PLATFORMY
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

        // Jeśli użytkownik nie ma kodu, zwróć podstawowe dane
        if (!user?.referralCode) {
            return {
                referralCode: null,
                referralLink: null,
                referredBy: user?.referredBy ? {
                    email: this.maskEmail(user.referredBy.email)
                } : null,
                stats: {
                    totalReferrals: 0,
                    activeReferrals: 0,
                    totalEarnings: 0,
                    last30DaysEarnings: 0,
                    totalCommissions: 0
                },
                referrals: []
            };
        }

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

    // 🆕 Pobiera alerty fraudu z paginacją i filtrami
    static async getFraudAlerts(options = {}) {
        const {
            status = null,
            page = 1,
            limit = 20,
            sortBy = 'createdAt',
            sortOrder = 'desc'
        } = options;

        const where = {};
        if (status) {
            where.status = status;
        }

        const [alerts, total] = await Promise.all([
            prisma.fraudAlert.findMany({
                where,
                include: {
                    referrer: {
                        select: {
                            id: true,
                            email: true,
                            referralCode: true,
                            referralDisabled: true,
                            isActive: true
                        }
                    },
                    referred: {
                        select: {
                            id: true,
                            email: true,
                            isActive: true,
                            createdAt: true
                        }
                    }
                },
                orderBy: { [sortBy]: sortOrder },
                skip: (page - 1) * limit,
                take: limit
            }),
            prisma.fraudAlert.count({ where })
        ]);

        return {
            alerts,
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit)
            }
        };
    }

    // 🆕 Statystyki alertów
    static async getFraudAlertStats() {
        const [pending, approved, blocked, total] = await Promise.all([
            prisma.fraudAlert.count({ where: { status: 'PENDING' } }),
            prisma.fraudAlert.count({ where: { status: 'APPROVED' } }),
            prisma.fraudAlert.count({
                where: {
                    status: {
                        in: ['BLOCKED_REFERRED', 'BLOCKED_BOTH', 'REFERRAL_DISABLED']
                    }
                }
            }),
            prisma.fraudAlert.count()
        ]);

        // Średni risk score dla pending
        const avgRiskScore = await prisma.fraudAlert.aggregate({
            where: { status: 'PENDING' },
            _avg: { riskScore: true }
        });

        // High risk count
        const highRisk = await prisma.fraudAlert.count({
            where: {
                status: 'PENDING',
                riskScore: { gte: 70 }
            }
        });

        return {
            pending,
            approved,
            blocked,
            total,
            highRisk,
            avgRiskScore: Math.round(avgRiskScore._avg.riskScore || 0)
        };
    }

    // 🆕 Rozwiązuje alert (akcja admina)
    static async resolveAlert(alertId, resolution, adminId, notes = null) {
        const alert = await prisma.fraudAlert.findUnique({
            where: { id: alertId },
            include: {
                referrer: true,
                referred: true
            }
        });

        if (!alert) {
            throw new Error('Alert nie znaleziony');
        }

        if (alert.status !== 'PENDING') {
            throw new Error('Alert został już rozwiązany');
        }

        const resolutionDescriptions = {
            'APPROVED': 'Fałszywy alarm - zezwolono',
            'BLOCKED_REFERRED': 'Zablokowano konto poleconego',
            'BLOCKED_BOTH': 'Zablokowano oba konta',
            'REFERRAL_DISABLED': 'Wyłączono zaproszenia polecającego'
        };

        // Wykonaj akcję w transakcji
        return prisma.$transaction(async (tx) => {
            // Aktualizuj alert
            const updatedAlert = await tx.fraudAlert.update({
                where: { id: alertId },
                data: {
                    status: resolution,
                    resolvedAt: new Date(),
                    resolvedById: adminId,
                    resolution: resolutionDescriptions[resolution] || resolution,
                    adminNotes: notes
                }
            });

            // Wykonaj akcje na użytkownikach
            switch (resolution) {
                case 'APPROVED':
                    // Fałszywy alarm - usuń flagę fraudu z poleconego
                    await tx.user.update({
                        where: { id: alert.referredId },
                        data: {
                            referralFraudFlag: false,
                            referralFraudReason: 'cleared_by_admin'
                        }
                    });
                    break;

                case 'BLOCKED_REFERRED':
                    // Zablokuj poleconego
                    await tx.user.update({
                        where: { id: alert.referredId },
                        data: {
                            isActive: false,
                            referralFraudFlag: true,
                            referralFraudReason: 'blocked_by_admin'
                        }
                    });
                    break;

                case 'BLOCKED_BOTH':
                    // Zablokuj obu
                    await tx.user.update({
                        where: { id: alert.referredId },
                        data: {
                            isActive: false,
                            referralFraudFlag: true,
                            referralFraudReason: 'blocked_by_admin'
                        }
                    });
                    await tx.user.update({
                        where: { id: alert.referrerId },
                        data: {
                            isActive: false,
                            referralDisabled: true,
                            referralDisabledAt: new Date(),
                            referralDisabledReason: 'blocked_by_admin_fraud'
                        }
                    });
                    break;

                case 'REFERRAL_DISABLED':
                    // Wyłącz tylko zaproszenia polecającego
                    await tx.user.update({
                        where: { id: alert.referrerId },
                        data: {
                            referralDisabled: true,
                            referralDisabledAt: new Date(),
                            referralDisabledReason: 'disabled_by_admin_fraud_suspicion'
                        }
                    });
                    break;
            }

            return updatedAlert;
        });
    }

    // 🆕 Włącza/wyłącza zaproszenia użytkownika
    static async toggleReferralStatus(userId, disabled, reason = null) {
        return prisma.user.update({
            where: { id: userId },
            data: {
                referralDisabled: disabled,
                referralDisabledAt: disabled ? new Date() : null,
                referralDisabledReason: disabled ? reason : null
            }
        });
    }

    // Pobiera podejrzane polecenia (fraud alerts) - STARA WERSJA dla kompatybilności
    static async getFraudAlertsLegacy() {
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

    // Oznacz referral jako sprawdzony - STARA WERSJA dla kompatybilności
    static async resolveFraudAlertLegacy(userId, action) {
        if (action === 'dismiss') {
            await prisma.user.update({
                where: { id: userId },
                data: {
                    referralFraudFlag: false,
                    referralFraudReason: 'dismissed_by_admin'
                }
            });
            return { success: true, message: 'Alert odrzucony' };
        } else if (action === 'block') {
            await prisma.user.update({
                where: { id: userId },
                data: {
                    isActive: false,
                    referralFraudReason: 'blocked_by_admin'
                }
            });
            return { success: true, message: 'Użytkownik zablokowany' };
        } else if (action === 'block_both') {
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
            fraudAlertStats,
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
            prisma.user.count({
                where: {
                    referralFraudFlag: true,
                    referredById: { not: null }
                }
            }),
            this.getFraudAlertStats(),
            prisma.user.findMany({
                where: {
                    referralEarnings: { gt: 0 }
                },
                select: {
                    id: true,
                    email: true,
                    referralCode: true,
                    referralEarnings: true,
                    referralDisabled: true,
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
                fraudAlerts,
                // 🆕 Nowe statystyki alertów
                pendingFraudAlerts: fraudAlertStats.pending,
                highRiskAlerts: fraudAlertStats.highRisk
            },
            fraudAlertStats,
            topReferrers: topReferrers.map(u => ({
                id: u.id,
                email: u.email,
                referralCode: u.referralCode,
                earnings: parseFloat(u.referralEarnings),
                referralsCount: u._count.referrals,
                referralDisabled: u.referralDisabled
            })),
            recentReferrals: recentReferrals.map(u => ({
                id: u.id,
                email: this.maskEmail(u.email),
                joinedAt: u.createdAt,
                fraudFlag: u.referralFraudFlag,
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
                        select: { id: true, email: true, referralCode: true, referralDisabled: true }
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
                    fraudFlag: user.referralFraudFlag,
                    fraudReason: user.referralFraudReason,
                    referredBy: {
                        id: user.referredBy.id,
                        email: user.referredBy.email,
                        code: user.referredBy.referralCode,
                        referralDisabled: user.referredBy.referralDisabled
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