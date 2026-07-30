const express = require('express');
const rateLimit = require('express-rate-limit');
const cors = require('cors');
const compression = require('compression');
const helmet = require('helmet');

const createApiLimiter = (windowMs = 15 * 60 * 1000, max = 200) =>
    rateLimit({
        windowMs,
        max,
        standardHeaders: true,
        legacyHeaders: false,
        message: { success: false, message: 'Too many requests. Please try again shortly.' }
    });

const authLimiter = createApiLimiter(15 * 60 * 1000, 20);
const pairingLimiter = createApiLimiter(10 * 60 * 1000, 20);
const uploadLimiter = createApiLimiter(15 * 60 * 1000, 50);

function parseAllowedOrigins() {
    const configured = process.env.CORS_ORIGINS || process.env.CORS_ORIGIN || '';
    if (!configured || configured === '*') {
        return [
            'http://localhost:3000',
            'http://127.0.0.1:3000',
            'https://localhost:3000',
            'https://zenvora.abdullahtahir.me',
            'https://app.javehandmade.store',
        ];
    }

    return String(configured)
        .split(',')
        .map((value) => String(value).trim())
        .filter(Boolean);
}

function getAllowedOrigins() {
    return parseAllowedOrigins();
}

function isOriginAllowed(origin) {
    if (!origin) return true;

    try {
        const normalizedOrigin = new URL(origin).origin;
        return getAllowedOrigins().some((allowedOrigin) => {
            if (allowedOrigin === '*') return true;
            try {
                return new URL(allowedOrigin).origin === normalizedOrigin;
            } catch {
                return allowedOrigin === normalizedOrigin;
            }
        });
    } catch {
        return false;
    }
}

function validateSameSiteOrigin(req, res, next) {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
        return next();
    }

    const origin = req.get('origin') || req.get('referer');
    if (!origin) {
        return next();
    }

    if (!isOriginAllowed(origin)) {
        return res.status(403).json({ success: false, message: 'Origin not allowed.' });
    }

    return next();
}

function registerSecurityMiddleware(app) {
    app.use(helmet({
        contentSecurityPolicy: false,
        referrerPolicy: { policy: 'strict-origin-when-cross-origin' }
    }));

    app.use(compression());

    app.use(cors({
        origin(origin, callback) {
            if (!origin) return callback(null, true);
            return callback(null, isOriginAllowed(origin));
        },
        credentials: true,
        methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-CSRF-Token']
    }));

    app.use('/api', validateSameSiteOrigin);
    app.use(express.json({ limit: '10mb' }));
    app.use(express.urlencoded({ extended: true, limit: '10mb' }));

    app.use('/api/auth/login', authLimiter);
    app.use('/api/auth/register', authLimiter);
    app.use('/api/auth/forgot-password', authLimiter);
    app.use('/api/auth/reset-password', authLimiter);
    app.use('/api/auth/agent/pair', pairingLimiter);
    app.use('/api/media/upload', uploadLimiter);
    app.use('/api/virtual-files/upload', uploadLimiter);
}

module.exports = {
    registerSecurityMiddleware,
    authLimiter,
    pairingLimiter,
    uploadLimiter,
    createApiLimiter,
    getAllowedOrigins,
    isOriginAllowed,
    validateSameSiteOrigin
};
