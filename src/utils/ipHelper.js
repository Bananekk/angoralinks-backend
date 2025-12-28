// src/utils/ipHelper.js

function getClientIp(req) {
    const headers = [
        'cf-connecting-ip',
        'x-real-ip',
        'x-forwarded-for',
        'x-client-ip'
    ];
    
    for (const header of headers) {
        const value = req.headers[header];
        if (value) {
            return value.split(',')[0].trim();
        }
    }
    
    return req.ip || req.connection?.remoteAddress || 'unknown';
}

function getUserAgent(req) {
    return req.headers['user-agent'] || 'unknown';
}

function getReferer(req) {
    return req.headers['referer'] || null;
}

function maskIp(ip) {
    if (!ip) return 'unknown';
    
    // IPv4
    if (ip.includes('.')) {
        return ip.replace(/\.\d+$/, '.***');
    }
    
    // IPv6
    if (ip.includes(':')) {
        const parts = ip.split(':');
        if (parts.length > 4) {
            return parts.slice(0, 4).join(':') + ':***';
        }
    }
    
    return ip.substring(0, Math.min(ip.length, 10)) + '***';
}

function detectDevice(userAgent) {
    if (!userAgent) return 'unknown';
    
    const ua = userAgent.toLowerCase();
    
    if (ua.includes('mobile') || ua.includes('android') || ua.includes('iphone')) {
        return 'mobile';
    }
    
    if (ua.includes('tablet') || ua.includes('ipad')) {
        return 'tablet';
    }
    
    return 'desktop';
}

function detectBrowser(userAgent) {
    if (!userAgent) return 'unknown';
    
    const ua = userAgent.toLowerCase();
    
    if (ua.includes('firefox')) return 'Firefox';
    if (ua.includes('edg')) return 'Edge';
    if (ua.includes('chrome')) return 'Chrome';
    if (ua.includes('safari')) return 'Safari';
    if (ua.includes('opera') || ua.includes('opr')) return 'Opera';
    
    return 'Other';
}

module.exports = { 
    getClientIp, 
    getUserAgent, 
    getReferer, 
    maskIp,
    detectDevice,
    detectBrowser
};