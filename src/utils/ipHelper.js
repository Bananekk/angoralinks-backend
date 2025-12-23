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

module.exports = { getClientIp, getUserAgent, getReferer };