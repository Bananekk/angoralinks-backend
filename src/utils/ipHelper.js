// src/utils/ipHelper.js

/**
 * Pobiera prawdziwy adres IP z nagłówków HTTP
 * Obsługuje różne proxy i load balancery (Railway, Vercel, Cloudflare)
 * 
 * @param {Request} req - Express request object
 * @returns {string} - Adres IP
 */
function getClientIp(req) {
  // Kolejność sprawdzania nagłówków (od najbardziej specyficznych)
  const headers = [
    'cf-connecting-ip',      // Cloudflare
    'x-real-ip',             // Nginx proxy
    'x-forwarded-for',       // Standard proxy header
    'x-client-ip',           // Apache
    'true-client-ip',        // Akamai
    'x-cluster-client-ip',   // Rackspace
    'forwarded-for',
    'forwarded',
    'x-forwarded',
    'x-vercel-forwarded-for', // Vercel
    'x-railway-forwarded-for' // Railway
  ];
  
  for (const header of headers) {
    const value = req.headers[header];
    if (value) {
      // x-forwarded-for może zawierać wiele IP oddzielonych przecinkami
      // Pierwszy IP to oryginalny klient
      const ip = value.split(',')[0].trim();
      
      // Walidacja IP
      if (isValidIp(ip)) {
        return ip;
      }
    }
  }
  
  // Fallback do req.ip lub socket
  const socketIp = req.ip || 
                   req.connection?.remoteAddress || 
                   req.socket?.remoteAddress ||
                   req.connection?.socket?.remoteAddress;
  
  if (socketIp) {
    // Usuń prefix IPv6 dla IPv4 (::ffff:)
    return socketIp.replace(/^::ffff:/, '');
  }
  
  return 'unknown';
}

/**
 * Sprawdza czy string jest prawidłowym adresem IP (IPv4 lub IPv6)
 * @param {string} ip 
 * @returns {boolean}
 */
function isValidIp(ip) {
  if (!ip || typeof ip !== 'string') return false;
  
  // IPv4 pattern
  const ipv4Pattern = /^(\d{1,3}\.){3}\d{1,3}$/;
  
  // IPv6 pattern (uproszczony)
  const ipv6Pattern = /^([0-9a-fA-F]{0,4}:){2,7}[0-9a-fA-F]{0,4}$/;
  
  // Sprawdź IPv4
  if (ipv4Pattern.test(ip)) {
    const parts = ip.split('.');
    return parts.every(part => {
      const num = parseInt(part, 10);
      return num >= 0 && num <= 255;
    });
  }
  
  // Sprawdź IPv6
  return ipv6Pattern.test(ip);
}

/**
 * Pobiera User-Agent z request
 * @param {Request} req 
 * @returns {string}
 */
function getUserAgent(req) {
  return req.headers['user-agent'] || 'unknown';
}

/**
 * Pobiera Referer z request
 * @param {Request} req 
 * @returns {string|null}
 */
function getReferer(req) {
  return req.headers['referer'] || req.headers['referrer'] || null;
}

/**
 * Maskuje IP do celów logowania (nie pokazuje pełnego IP)
 * @param {string} ip 
 * @returns {string}
 */
function maskIp(ip) {
  if (!ip || ip === 'unknown') return 'unknown';
  
  // IPv4: 192.168.1.100 -> 192.168.1.***
  if (ip.includes('.')) {
    const parts = ip.split('.');
    return `${parts[0]}.${parts[1]}.${parts[2]}.***`;
  }
  
  // IPv6: ukryj ostatnie segmenty
  if (ip.includes(':')) {
    const parts = ip.split(':');
    return parts.slice(0, 4).join(':') + ':****:****';
  }
  
  return ip;
}

module.exports = {
  getClientIp,
  isValidIp,
  getUserAgent,
  getReferer,
  maskIp
};