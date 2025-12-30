// scripts/generateReferralCodes.js
const { PrismaClient } = require('@prisma/client');
const crypto = require('crypto');
const prisma = new PrismaClient();

function generateReferralCode() {
    return crypto.randomBytes(4).toString('hex').toUpperCase();
}

async function generateCodesForExistingUsers() {
    try {
        const users = await prisma.user.findMany({
            where: {
                OR: [
                    { referralCode: null },
                    { referralCode: '' }
                ]
            }
        });

        console.log(`Found ${users.length} users without referral codes`);

        for (const user of users) {
            let code;
            let isUnique = false;

            while (!isUnique) {
                code = generateReferralCode();
                const existing = await prisma.user.findFirst({
                    where: { referralCode: code }
                });
                if (!existing) isUnique = true;
            }

            await prisma.user.update({
                where: { id: user.id },
                data: { referralCode: code }
            });

            console.log(`✅ Generated code ${code} for user ${user.email}`);
        }

        console.log('\n✅ All referral codes generated!');
    } catch (error) {
        console.error('❌ Error:', error);
    } finally {
        await prisma.$disconnect();
    }
}

generateCodesForExistingUsers();