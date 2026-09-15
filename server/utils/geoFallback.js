/**
 * geoFallback.js — Server-side IP geolocation fallback
 * Jab agent khud geo data nahi bhejta, server IP se location fetch karta hai
 */

const https = require('https');

const geoCache = new Map(); // ip → { data, expiresAt }
const GEO_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Fetch geo data from ip-api.com (free, no key needed)
 * Returns null if failed or private IP
 */
function fetchGeoFromIp(ip) {
    return new Promise((resolve) => {
        if (!ip || isPrivateIp(ip) || ip === '127.0.0.1' || ip === '::1') {
            return resolve(null);
        }

        // Check cache
        const cached = geoCache.get(ip);
        if (cached && cached.expiresAt > Date.now()) {
            return resolve(cached.data);
        }

        const url = `http://ip-api.com/json/${ip}?fields=status,country,regionName,city,isp,lat,lon,timezone`;
        
        // Use http (ip-api free tier is HTTP only)
        const http = require('http');
        const req = http.get(url, { timeout: 5000 }, (res) => {
            let body = '';
            res.on('data', (chunk) => body += chunk);
            res.on('end', () => {
                try {
                    const data = JSON.parse(body);
                    if (data.status === 'success') {
                        const geo = {
                            latitude: data.lat || null,
                            longitude: data.lon || null,
                            country: data.country || '',
                            region: data.regionName || '',
                            city: data.city || '',
                            isp: data.isp || '',
                            timezone: data.timezone || '',
                        };
                        geoCache.set(ip, { data: geo, expiresAt: Date.now() + GEO_CACHE_TTL });
                        resolve(geo);
                    } else {
                        resolve(null);
                    }
                } catch {
                    resolve(null);
                }
            });
        });

        req.on('error', () => resolve(null));
        req.on('timeout', () => {
            req.destroy();
            resolve(null);
        });
    });
}

function isPrivateIp(ip) {
    if (!ip) return true;
    const s = String(ip).replace(/^::ffff:/, '');
    return (
        s.startsWith('10.') ||
        s.startsWith('172.16.') || s.startsWith('172.17.') || s.startsWith('172.18.') ||
        s.startsWith('172.19.') || s.startsWith('172.20.') || s.startsWith('172.21.') ||
        s.startsWith('172.22.') || s.startsWith('172.23.') || s.startsWith('172.24.') ||
        s.startsWith('172.25.') || s.startsWith('172.26.') || s.startsWith('172.27.') ||
        s.startsWith('172.28.') || s.startsWith('172.29.') || s.startsWith('172.30.') ||
        s.startsWith('172.31.') ||
        s.startsWith('192.168.') ||
        s.startsWith('127.') ||
        s === '::1' ||
        s === 'localhost'
    );
}

module.exports = { fetchGeoFromIp, isPrivateIp };
