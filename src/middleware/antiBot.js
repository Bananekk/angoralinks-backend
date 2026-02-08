const https = require('https');

// Weryfikacja hCaptcha
const verifyCaptcha = async (token) => {
    return new Promise((resolve, reject) => {
        const secret = process.env.RECAPTCHA_SECRET;

        if (!secret) {
            console.warn('RECAPTCHA_SECRET nie ustawiony - pomijam weryfikację');
            resolve(true);
            return;
        }

        const data = `response=${token}&secret=${secret}`;

        const options = {
            hostname: 'www.google.com',
            port: 443,
            path: '/recaptcha/api/siteverify',
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Content-Length': data.length
            }
        };

        const req = https.request(options, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                try {
                    const result = JSON.parse(body);
                    resolve(result.success === true);
                } catch (e) {
                    resolve(false);
                }
            });
        });

        req.on('error', () => resolve(false));
        req.write(data);
        req.end();
    });
};

// Middleware do weryfikacji captcha
const requireCaptcha = async (req, res, next) => {
    const token = req.body.captchaToken || req.headers['x-captcha-token'];

    if (!process.env.RECAPTCHA_SECRET) {
        return next();
    }

    if (!token) {
        return res.status(400).json({ error: 'Wymagana weryfikacja captcha' });
    }

    const isValid = await verifyCaptcha(token);

    if (!isValid) {
        return res.status(403).json({ error: 'Nieprawidłowa weryfikacja captcha' });
    }

    next();
};

// Wykrywanie botów
const detectBot = (req, res, next) => {
    const userAgent = req.headers['user-agent'] || '';
    const suspiciousPatterns = [
        /bot/i,
        /crawler/i,
        /spider/i,
        /headless/i,
        /phantom/i,
        /selenium/i,
        /puppeteer/i,
        /playwright/i
    ];

    const isBot = suspiciousPatterns.some(pattern => pattern.test(userAgent));

    if (isBot) {
        return res.status(403).json({ error: 'Dostęp zabroniony' });
    }

    if (!userAgent || userAgent.length < 10) {
        return res.status(403).json({ error: 'Nieprawidłowe żądanie' });
    }

    next();
};

// Śledzenie IP
const suspiciousIPs = new Map();

const trackIP = (req, res, next) => {
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
    const now = Date.now();

    if (!suspiciousIPs.has(ip)) {
        suspiciousIPs.set(ip, { count: 1, firstSeen: now, lastSeen: now });
    } else {
        const data = suspiciousIPs.get(ip);
        data.count++;
        data.lastSeen = now;

        if (data.count > 100 && (now - data.firstSeen) < 60000) {
            return res.status(429).json({ error: 'Zbyt wiele żądań. Spróbuj później.' });
        }

        if (now - data.firstSeen > 3600000) {
            suspiciousIPs.set(ip, { count: 1, firstSeen: now, lastSeen: now });
        }
    }

    next();
};

// Czyszczenie co godzinę
setInterval(() => {
    const now = Date.now();
    for (const [ip, data] of suspiciousIPs.entries()) {
        if (now - data.lastSeen > 3600000) {
            suspiciousIPs.delete(ip);
        }
    }
}, 3600000);

module.exports = {
    verifyCaptcha,
    requireCaptcha,
    detectBot,
    trackIP
};