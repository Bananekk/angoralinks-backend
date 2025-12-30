// scripts/initSettings.js
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function initSettings() {
    try {
        const settings = await prisma.systemSettings.upsert({
            where: { id: 'settings' },
            update: {},
            create: {
                id: 'settings',
                referralCommissionRate: 0.10, // 10%
                referralBonusDuration: null,  // null = dożywotni
                minReferralPayout: 5.00,
                referralSystemActive: true
            }
        });

        console.log('✅ System settings initialized:', settings);
    } catch (error) {
        console.error('❌ Error initializing settings:', error);
    } finally {
        await prisma.$disconnect();
    }
}

initSettings();