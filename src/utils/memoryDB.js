/**
 * Tymczasowa baza danych w pamięci
 * Zastąpimy to Prismą po instalacji PostgreSQL
 */

const db = {
    users: [],
    links: [],
    visits: []
};

// ======================
// USERS
// ======================

const usersDB = {
    findByEmail: (email) => {
        return db.users.find(u => u.email === email) || null;
    },
    
    findById: (id) => {
        return db.users.find(u => u.id === id) || null;
    },
    
    create: (userData) => {
        const user = {
            id: generateId(),
            email: userData.email,
            passwordHash: userData.passwordHash,
            balance: 0,
            totalEarned: 0,
            isVerified: false,
            isActive: true,
            createdAt: new Date(),
            updatedAt: new Date()
        };
        db.users.push(user);
        return user;
    },
    
    update: (id, data) => {
        const index = db.users.findIndex(u => u.id === id);
        if (index === -1) return null;
        
        db.users[index] = {
            ...db.users[index],
            ...data,
            updatedAt: new Date()
        };
        return db.users[index];
    }
};

// ======================
// LINKS
// ======================

const linksDB = {
    findByShortCode: (shortCode) => {
        return db.links.find(l => l.shortCode === shortCode) || null;
    },
    
    findById: (id) => {
        return db.links.find(l => l.id === id) || null;
    },
    
    findByUserId: (userId) => {
        return db.links.filter(l => l.userId === userId);
    },
    
    create: (linkData) => {
        const link = {
            id: generateId(),
            userId: linkData.userId,
            originalUrl: linkData.originalUrl,
            shortCode: linkData.shortCode,
            title: linkData.title || null,
            description: linkData.description || null,
            totalClicks: 0,
            totalEarned: 0,
            isActive: true,
            createdAt: new Date(),
            updatedAt: new Date()
        };
        db.links.push(link);
        return link;
    },
    
    update: (id, data) => {
        const index = db.links.findIndex(l => l.id === id);
        if (index === -1) return null;
        
        db.links[index] = {
            ...db.links[index],
            ...data,
            updatedAt: new Date()
        };
        return db.links[index];
    },
    
    delete: (id) => {
        const index = db.links.findIndex(l => l.id === id);
        if (index === -1) return false;
        
        db.links.splice(index, 1);
        return true;
    }
};

// ======================
// VISITS
// ======================

const visitsDB = {
    create: (visitData) => {
        const visit = {
            id: generateId(),
            linkId: visitData.linkId,
            ipAddress: visitData.ipAddress,
            country: visitData.country || null,
            city: visitData.city || null,
            device: visitData.device || null,
            browser: visitData.browser || null,
            referer: visitData.referer || null,
            earned: visitData.earned || 0,
            completed: false,
            createdAt: new Date()
        };
        db.visits.push(visit);
        return visit;
    },
    
    findByLinkId: (linkId) => {
        return db.visits.filter(v => v.linkId === linkId);
    },
    
    countByIpToday: (ipAddress, linkId) => {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        
        return db.visits.filter(v => 
            v.ipAddress === ipAddress && 
            v.linkId === linkId &&
            new Date(v.createdAt) >= today
        ).length;
    }
};

// ======================
// HELPERS
// ======================

function generateId() {
    return Math.random().toString(36).substring(2, 15) + 
           Math.random().toString(36).substring(2, 15);
}

// Debug - podgląd bazy
function debugDB() {
    return {
        users: db.users.length,
        links: db.links.length,
        visits: db.visits.length
    };
}

module.exports = {
    usersDB,
    linksDB,
    visitsDB,
    debugDB
};