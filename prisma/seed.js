const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

// ======================
// DOMYŚLNE STAWKI CPM
// ======================

const defaultCpmRates = [
    // ===== TIER 1 - Premium ($3-5 CPM) =====
    { countryCode: 'US', countryName: 'United States', tier: 1, cpmRate: 4.00 },
    { countryCode: 'GB', countryName: 'United Kingdom', tier: 1, cpmRate: 3.80 },
    { countryCode: 'CA', countryName: 'Canada', tier: 1, cpmRate: 3.50 },
    { countryCode: 'AU', countryName: 'Australia', tier: 1, cpmRate: 3.50 },
    { countryCode: 'DE', countryName: 'Germany', tier: 1, cpmRate: 3.20 },
    { countryCode: 'FR', countryName: 'France', tier: 1, cpmRate: 3.00 },
    { countryCode: 'NL', countryName: 'Netherlands', tier: 1, cpmRate: 3.00 },
    { countryCode: 'SE', countryName: 'Sweden', tier: 1, cpmRate: 3.20 },
    { countryCode: 'NO', countryName: 'Norway', tier: 1, cpmRate: 3.50 },
    { countryCode: 'DK', countryName: 'Denmark', tier: 1, cpmRate: 3.20 },
    { countryCode: 'CH', countryName: 'Switzerland', tier: 1, cpmRate: 4.00 },
    { countryCode: 'AT', countryName: 'Austria', tier: 1, cpmRate: 3.00 },
    { countryCode: 'BE', countryName: 'Belgium', tier: 1, cpmRate: 2.80 },
    { countryCode: 'IE', countryName: 'Ireland', tier: 1, cpmRate: 3.00 },
    { countryCode: 'NZ', countryName: 'New Zealand', tier: 1, cpmRate: 3.00 },
    { countryCode: 'LU', countryName: 'Luxembourg', tier: 1, cpmRate: 3.50 },
    { countryCode: 'FI', countryName: 'Finland', tier: 1, cpmRate: 2.80 },
    { countryCode: 'IS', countryName: 'Iceland', tier: 1, cpmRate: 3.00 },

    // ===== TIER 2 - Good ($1-2.5 CPM) =====
    { countryCode: 'PL', countryName: 'Poland', tier: 2, cpmRate: 1.80 },
    { countryCode: 'CZ', countryName: 'Czech Republic', tier: 2, cpmRate: 1.70 },
    { countryCode: 'ES', countryName: 'Spain', tier: 2, cpmRate: 2.00 },
    { countryCode: 'IT', countryName: 'Italy', tier: 2, cpmRate: 2.00 },
    { countryCode: 'PT', countryName: 'Portugal', tier: 2, cpmRate: 1.80 },
    { countryCode: 'BR', countryName: 'Brazil', tier: 2, cpmRate: 1.50 },
    { countryCode: 'MX', countryName: 'Mexico', tier: 2, cpmRate: 1.50 },
    { countryCode: 'AR', countryName: 'Argentina', tier: 2, cpmRate: 1.20 },
    { countryCode: 'JP', countryName: 'Japan', tier: 2, cpmRate: 2.50 },
    { countryCode: 'KR', countryName: 'South Korea', tier: 2, cpmRate: 2.20 },
    { countryCode: 'SG', countryName: 'Singapore', tier: 2, cpmRate: 2.50 },
    { countryCode: 'HK', countryName: 'Hong Kong', tier: 2, cpmRate: 2.30 },
    { countryCode: 'IL', countryName: 'Israel', tier: 2, cpmRate: 2.00 },
    { countryCode: 'AE', countryName: 'United Arab Emirates', tier: 2, cpmRate: 2.20 },
    { countryCode: 'SA', countryName: 'Saudi Arabia', tier: 2, cpmRate: 2.00 },
    { countryCode: 'RU', countryName: 'Russia', tier: 2, cpmRate: 1.20 },
    { countryCode: 'UA', countryName: 'Ukraine', tier: 2, cpmRate: 0.80 },
    { countryCode: 'RO', countryName: 'Romania', tier: 2, cpmRate: 1.20 },
    { countryCode: 'HU', countryName: 'Hungary', tier: 2, cpmRate: 1.30 },
    { countryCode: 'SK', countryName: 'Slovakia', tier: 2, cpmRate: 1.40 },
    { countryCode: 'GR', countryName: 'Greece', tier: 2, cpmRate: 1.50 },
    { countryCode: 'HR', countryName: 'Croatia', tier: 2, cpmRate: 1.30 },
    { countryCode: 'SI', countryName: 'Slovenia', tier: 2, cpmRate: 1.50 },
    { countryCode: 'BG', countryName: 'Bulgaria', tier: 2, cpmRate: 1.00 },
    { countryCode: 'RS', countryName: 'Serbia', tier: 2, cpmRate: 0.90 },
    { countryCode: 'LT', countryName: 'Lithuania', tier: 2, cpmRate: 1.20 },
    { countryCode: 'LV', countryName: 'Latvia', tier: 2, cpmRate: 1.10 },
    { countryCode: 'EE', countryName: 'Estonia', tier: 2, cpmRate: 1.30 },
    { countryCode: 'TW', countryName: 'Taiwan', tier: 2, cpmRate: 1.80 },
    { countryCode: 'CL', countryName: 'Chile', tier: 2, cpmRate: 1.00 },
    { countryCode: 'CO', countryName: 'Colombia', tier: 2, cpmRate: 0.90 },
    { countryCode: 'QA', countryName: 'Qatar', tier: 2, cpmRate: 2.00 },
    { countryCode: 'KW', countryName: 'Kuwait', tier: 2, cpmRate: 1.80 },

    // ===== TIER 3 - Other ($0.2-1 CPM) =====
    { countryCode: 'IN', countryName: 'India', tier: 3, cpmRate: 0.50 },
    { countryCode: 'PK', countryName: 'Pakistan', tier: 3, cpmRate: 0.30 },
    { countryCode: 'BD', countryName: 'Bangladesh', tier: 3, cpmRate: 0.25 },
    { countryCode: 'ID', countryName: 'Indonesia', tier: 3, cpmRate: 0.60 },
    { countryCode: 'PH', countryName: 'Philippines', tier: 3, cpmRate: 0.50 },
    { countryCode: 'VN', countryName: 'Vietnam', tier: 3, cpmRate: 0.40 },
    { countryCode: 'TH', countryName: 'Thailand', tier: 3, cpmRate: 0.70 },
    { countryCode: 'MY', countryName: 'Malaysia', tier: 3, cpmRate: 0.80 },
    { countryCode: 'TR', countryName: 'Turkey', tier: 3, cpmRate: 0.60 },
    { countryCode: 'EG', countryName: 'Egypt', tier: 3, cpmRate: 0.40 },
    { countryCode: 'NG', countryName: 'Nigeria', tier: 3, cpmRate: 0.35 },
    { countryCode: 'ZA', countryName: 'South Africa', tier: 3, cpmRate: 0.80 },
    { countryCode: 'KE', countryName: 'Kenya', tier: 3, cpmRate: 0.40 },
    { countryCode: 'GH', countryName: 'Ghana', tier: 3, cpmRate: 0.35 },
    { countryCode: 'TZ', countryName: 'Tanzania', tier: 3, cpmRate: 0.30 },
    { countryCode: 'UG', countryName: 'Uganda', tier: 3, cpmRate: 0.25 },
    { countryCode: 'PE', countryName: 'Peru', tier: 3, cpmRate: 0.60 },
    { countryCode: 'VE', countryName: 'Venezuela', tier: 3, cpmRate: 0.30 },
    { countryCode: 'EC', countryName: 'Ecuador', tier: 3, cpmRate: 0.50 },
    { countryCode: 'CN', countryName: 'China', tier: 3, cpmRate: 0.80 },
    { countryCode: 'MA', countryName: 'Morocco', tier: 3, cpmRate: 0.45 },
    { countryCode: 'DZ', countryName: 'Algeria', tier: 3, cpmRate: 0.40 },
    { countryCode: 'TN', countryName: 'Tunisia', tier: 3, cpmRate: 0.45 },
    { countryCode: 'LK', countryName: 'Sri Lanka', tier: 3, cpmRate: 0.35 },
    { countryCode: 'MM', countryName: 'Myanmar', tier: 3, cpmRate: 0.25 },
    { countryCode: 'NP', countryName: 'Nepal', tier: 3, cpmRate: 0.25 },
    { countryCode: 'KH', countryName: 'Cambodia', tier: 3, cpmRate: 0.30 },
    { countryCode: 'BY', countryName: 'Belarus', tier: 3, cpmRate: 0.50 },
    { countryCode: 'KZ', countryName: 'Kazakhstan', tier: 3, cpmRate: 0.60 },
    { countryCode: 'UZ', countryName: 'Uzbekistan', tier: 3, cpmRate: 0.30 },
    { countryCode: 'GE', countryName: 'Georgia', tier: 3, cpmRate: 0.50 },
    { countryCode: 'AZ', countryName: 'Azerbaijan', tier: 3, cpmRate: 0.45 },
    { countryCode: 'JO', countryName: 'Jordan', tier: 3, cpmRate: 0.55 },
    { countryCode: 'LB', countryName: 'Lebanon', tier: 3, cpmRate: 0.50 },
    { countryCode: 'IQ', countryName: 'Iraq', tier: 3, cpmRate: 0.40 },
    { countryCode: 'IR', countryName: 'Iran', tier: 3, cpmRate: 0.35 },
];

// ======================
// DOMYŚLNE USTAWIENIA PLATFORMY
// ======================

const defaultSettings = [
    {
        settingKey: 'platform_commission',
        settingValue: '0.15',
        description: 'Prowizja platformy (0.15 = 15%). Użytkownik dostaje: CPM * (1 - prowizja)'
    },
    {
        settingKey: 'default_tier3_cpm',
        settingValue: '0.40',
        description: 'Domyślna stawka CPM dla nieznanych krajów (Tier 3)'
    },
    {
        settingKey: 'min_payout_amount',
        settingValue: '5.00',
        description: 'Minimalna kwota wypłaty w USD'
    },
    {
        settingKey: 'payout_enabled',
        settingValue: 'true',
        description: 'Czy wypłaty są włączone'
    },
    {
        settingKey: 'max_links_per_user',
        settingValue: '100',
        description: 'Maksymalna liczba linków na użytkownika'
    },
    {
        settingKey: 'ad_steps_count',
        settingValue: '3',
        description: 'Liczba kroków reklamowych przed przekierowaniem'
    },
    {
        settingKey: 'step_timer_seconds',
        settingValue: '5',
        description: 'Czas oczekiwania na każdym kroku (sekundy)'
    },
    {
        settingKey: 'duplicate_click_hours',
        settingValue: '24',
        description: 'Po ilu godzinach kliknięcie z tego samego IP jest liczone ponownie'
    }
];

// ======================
// FUNKCJA SEED
// ======================

async function main() {
    console.log('🌱 Rozpoczynam seedowanie bazy danych...\n');

    // ----- SEED CPM RATES -----
    console.log('📊 Dodawanie stawek CPM...');
    
    let addedRates = 0;
    let updatedRates = 0;

    for (const rate of defaultCpmRates) {
        const result = await prisma.cpmRate.upsert({
            where: { countryCode: rate.countryCode },
            update: {
                countryName: rate.countryName,
                tier: rate.tier,
                cpmRate: rate.cpmRate
            },
            create: rate
        });

        if (result.updatedAt > result.createdAt) {
            updatedRates++;
        } else {
            addedRates++;
        }
    }

    console.log(`   ✅ Dodano: ${addedRates} krajów`);
    console.log(`   🔄 Zaktualizowano: ${updatedRates} krajów`);
    console.log(`   📍 Łącznie: ${defaultCpmRates.length} krajów\n`);

    // ----- SEED PLATFORM SETTINGS -----
    console.log('⚙️  Dodawanie ustawień platformy...');

    let addedSettings = 0;

    for (const setting of defaultSettings) {
        await prisma.platformSettings.upsert({
            where: { settingKey: setting.settingKey },
            update: {
                description: setting.description
                // Nie aktualizujemy settingValue, żeby nie nadpisać ręcznych zmian
            },
            create: setting
        });
        addedSettings++;
    }

    console.log(`   ✅ Ustawienia: ${addedSettings}\n`);

    // ----- PODSUMOWANIE -----
    console.log('====================================');
    console.log('🎉 Seedowanie zakończone pomyślnie!');
    console.log('====================================\n');

    // Wyświetl statystyki
    const tier1Count = defaultCpmRates.filter(r => r.tier === 1).length;
    const tier2Count = defaultCpmRates.filter(r => r.tier === 2).length;
    const tier3Count = defaultCpmRates.filter(r => r.tier === 3).length;

    console.log('📈 Statystyki stawek CPM:');
    console.log(`   Tier 1 (Premium):  ${tier1Count} krajów  | $2.80 - $4.00 CPM`);
    console.log(`   Tier 2 (Good):     ${tier2Count} krajów  | $0.80 - $2.50 CPM`);
    console.log(`   Tier 3 (Other):    ${tier3Count} krajów  | $0.25 - $0.80 CPM`);
    console.log('');
    console.log('💰 Prowizja platformy: 15%');
    console.log('   Przykład: US ($4.00 CPM) → Użytkownik dostaje $3.40 CPM ($0.0034/klik)');
    console.log('');
}

// ======================
// URUCHOMIENIE
// ======================

main()
    .then(async () => {
        await prisma.$disconnect();
    })
    .catch(async (e) => {
        console.error('❌ Błąd podczas seedowania:', e);
        await prisma.$disconnect();
        process.exit(1);
    });