const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const AgentCredential = require('../models/AgentCredential');
const Device = require('../models/Device');
const { ensureMongooseConnected } = require('../db/mongo/connection');

const JWT_SECRET = process.env.JWT_SECRET || process.env.NEXTAUTH_SECRET;
const JWT_EXPIRES = process.env.JWT_EXPIRES || '7d';
const AUTH_COOKIE = 'auth_token';

function getJwtSecret() {
    if (!JWT_SECRET) {
        throw new Error('JWT_SECRET is required.');
    }
    return JWT_SECRET;
}

function signUserToken(user) {
    return jwt.sign(
        {
            sub: String(user._id),
            email: user.email,
            role: user.role,
            name: user.name,
            avatarUrl: user.avatarUrl || ''
        },
        getJwtSecret(),
        { expiresIn: JWT_EXPIRES }
    );
}

async function verifyUserToken(token) {
    if (!token) return null;
    try {
        const payload = jwt.verify(token, getJwtSecret());
        if (!payload?.sub) return null;

        const user = await User.findById(payload.sub).lean();
        if (!user) return null;
        if (user.authTokenHash) {
            const matches = await bcrypt.compare(token, user.authTokenHash);
            if (!matches) return null;
        }

        return {
            ...payload,
            avatarUrl: user.avatarUrl || ''
        };
    } catch {
        return null;
    }
}

/**
 * Sync JWT-only check for WebSocket upgrade.
 * Never touches Mongo/bcrypt — upgrade must stay under ~50ms or browsers fail the handshake.
 */
function verifyUserTokenFast(token) {
    if (!token) return null;
    try {
        const payload = jwt.verify(token, getJwtSecret());
        if (!payload?.sub) return null;
        return payload;
    } catch {
        return null;
    }
}

async function ensureAuthDatabase() {
    await ensureMongooseConnected();
}

async function setUserAuthSession(user, token) {
    if (!user?._id || !token) return null;
    const tokenHash = await bcrypt.hash(token, 12);
    await User.findByIdAndUpdate(user._id, {
        authTokenHash: tokenHash,
        lastLoginAt: new Date()
    });
    return tokenHash;
}

async function clearUserAuthSession(userId) {
    if (!userId) return null;
    await User.findByIdAndUpdate(userId, {
        authTokenHash: '',
        passwordResetOtpHash: '',
        passwordResetOtpExpiresAt: null
    });
    return true;
}

function authCookieOptions() {
    const secure = process.env.NODE_ENV === 'production';
    return {
        httpOnly: true,
        secure,
        sameSite: 'lax',
        path: '/',
        maxAge: 7 * 24 * 60 * 60 * 1000
    };
}

function generateSixDigitCode() {
    return String(Math.floor(100000 + Math.random() * 900000));
}

async function generateUniqueUserField(fieldName) {
    while (true) {
        const candidate = generateSixDigitCode();
        const existing = await User.findOne({ [fieldName]: candidate }).lean();
        if (!existing) {
            return candidate;
        }
    }
}

async function ensureUserPairingFields(user) {
    if (!user?._id) return user;
    const updates = {};
    if (!user.pairingToken) {
        updates.pairingToken = await generateUniqueUserField('pairingToken');
    }
    if (!user.pairingUserId) {
        updates.pairingUserId = await generateUniqueUserField('pairingUserId');
    }
    if (Object.keys(updates).length === 0) {
        return user;
    }
    await User.findByIdAndUpdate(user._id, updates);
    return await User.findById(user._id).lean();
}

async function registerUser({ email, password, passwordHash, name, provider = 'local', googleId = '', avatarUrl = '' }) {
    const normalized = String(email || '').trim().toLowerCase();
    const plain = String(password || '');

    if (!normalized || (!plain && !passwordHash)) {
        const error = new Error('Email and password are required.');
        error.status = 400;
        throw error;
    }

    const existing = await User.findOne({ email: normalized });
    if (existing) {
        const error = new Error('Email already registered.');
        error.status = 409;
        throw error;
    }

    const passwordHashValue = passwordHash
        ? String(passwordHash)
        : await bcrypt.hash(plain, 12);
    const userCount = await User.countDocuments();
    const user = await User.create({
        email: normalized,
        passwordHash: passwordHashValue,
        name: String(name || normalized.split('@')[0] || 'User').trim(),
        role: userCount === 0 ? 'admin' : 'user',
        provider,
        googleId: String(googleId || '').trim(),
        avatarUrl: String(avatarUrl || '').trim(),
        emailVerified: provider === 'google',
        pairingToken: await generateUniqueUserField('pairingToken'),
        pairingUserId: await generateUniqueUserField('pairingUserId')
    });

    return user;
}

async function loginUser({ email, password }) {
    const normalized = String(email || '').trim().toLowerCase();
    const user = await User.findOne({ email: normalized });
    if (!user) {
        const error = new Error('Invalid email or password.');
        error.status = 401;
        throw error;
    }

    if (!user.passwordHash) {
        const error = new Error('This account requires Google sign-in.');
        error.status = 401;
        throw error;
    }

    const ok = await bcrypt.compare(String(password || ''), user.passwordHash);
    if (!ok) {
        const error = new Error('Invalid email or password.');
        error.status = 401;
        throw error;
    }

    return await ensureUserPairingFields(user);
}

async function upsertGoogleUser(profile) {
    const normalized = String(profile.email || '').trim().toLowerCase();
    const googleId = String(profile.id || profile.sub || '').trim();

    if (!normalized || !googleId) {
        const error = new Error('Google profile is incomplete.');
        error.status = 400;
        throw error;
    }

    let user = await User.findOne({ $or: [{ googleId }, { email: normalized }] });

    if (!user) {
        const passwordHashValue = await bcrypt.hash(crypto.randomBytes(24).toString('hex'), 12);
        user = await User.create({
            email: normalized,
            passwordHash: passwordHashValue,
            name: String(profile.name || profile.given_name || normalized.split('@')[0] || 'Google User').trim(),
            provider: 'google',
            googleId,
            avatarUrl: String(profile.picture || '').trim(),
            emailVerified: true,
            role: 'user',
            pairingToken: await generateUniqueUserField('pairingToken'),
            pairingUserId: await generateUniqueUserField('pairingUserId')
        });
    } else {
        const updates = {
            provider: 'google',
            googleId,
            emailVerified: true,
            avatarUrl: String(profile.picture || user.avatarUrl || '').trim()
        };
        if (!user.name && profile.name) updates.name = String(profile.name).trim();
        await User.findByIdAndUpdate(user._id, updates);
        user = await ensureUserPairingFields(await User.findById(user._id));
    }

    return user;
}

async function requestPasswordReset(email) {
    const normalized = String(email || '').trim().toLowerCase();
    const user = await User.findOne({ email: normalized });
    if (!user) return { success: true, message: 'If that email exists, a reset code was generated.' };

    const otp = String(Math.floor(100000 + Math.random() * 900000));
    const otpHash = await bcrypt.hash(otp, 10);
    await User.findByIdAndUpdate(user._id, {
        passwordResetOtpHash: otpHash,
        passwordResetOtpExpiresAt: new Date(Date.now() + 10 * 60 * 1000)
    });

    if (process.env.NODE_ENV === 'production') {
        return { success: true, message: 'If that email exists, a reset code was generated.' };
    }

    return { success: true, message: 'If that email exists, a reset code was generated.', otp };
}

async function verifyPasswordResetOtp(email, otp) {
    const normalized = String(email || '').trim().toLowerCase();
    const user = await User.findOne({ email: normalized });
    if (!user?.passwordResetOtpHash || !user.passwordResetOtpExpiresAt) {
        const error = new Error('Invalid or expired verification code.');
        error.status = 401;
        throw error;
    }

    if (new Date(user.passwordResetOtpExpiresAt) < new Date()) {
        const error = new Error('Verification code expired.');
        error.status = 401;
        throw error;
    }

    const ok = await bcrypt.compare(String(otp || ''), user.passwordResetOtpHash);
    if (!ok) {
        const error = new Error('Invalid verification code.');
        error.status = 401;
        throw error;
    }

    await User.findByIdAndUpdate(user._id, {
        passwordResetOtpHash: '',
        passwordResetOtpExpiresAt: null
    });

    return user;
}

async function resetPassword(email, otp, newPassword) {
    const normalized = String(email || '').trim().toLowerCase();
    const user = await verifyPasswordResetOtp(normalized, otp);
    const plain = String(newPassword || '').trim();
    if (!plain || plain.length < 6) {
        const error = new Error('Password must be at least 6 characters.');
        error.status = 400;
        throw error;
    }

    const passwordHash = await bcrypt.hash(plain, 12);
    await User.findByIdAndUpdate(user._id, { passwordHash });
    return true;
}

function generateAgentToken() {
    return crypto.randomBytes(32).toString('hex');
}

async function createAgentCredential(userId, deviceId, label = 'My Agent') {
    const cleanDeviceId = String(deviceId || '').trim();
    if (!cleanDeviceId) {
        const error = new Error('deviceId is required.');
        error.status = 400;
        throw error;
    }

    const existing = await AgentCredential.findOne({ deviceId: cleanDeviceId });
    if (existing && String(existing.userId) !== String(userId)) {
        const error = new Error('This device is already registered to another account.');
        error.status = 409;
        throw error;
    }

    const agentToken = generateAgentToken();
    const tokenHash = await bcrypt.hash(agentToken, 12);

    const doc = await AgentCredential.findOneAndUpdate(
        { deviceId: cleanDeviceId },
        {
            userId,
            deviceId: cleanDeviceId,
            label: String(label || 'My Agent').trim(),
            tokenHash,
            lastConnectedAt: new Date()
        },
        { upsert: true, new: true }
    );

    await Device.findOneAndUpdate(
        { deviceId: cleanDeviceId },
        {
            userId,
            deviceId: cleanDeviceId,
            status: 'offline',
            lastSeen: new Date()
        },
        { upsert: true, new: true }
    );

    return { credential: doc, agentToken };
}

async function verifyAgentToken(deviceId, agentToken) {
    const cred = await AgentCredential.findOne({ deviceId: String(deviceId || '').trim() })
        .maxTimeMS(5000)
        .lean();
    if (!cred || !agentToken || !cred.tokenHash) return null;
    const ok = await bcrypt.compare(String(agentToken), cred.tokenHash);
    if (!ok) return null;

    // Fire-and-forget lastConnectedAt update so WS upgrade is not blocked.
    AgentCredential.updateOne(
        { _id: cred._id },
        { $set: { lastConnectedAt: new Date() } }
    ).catch(() => {});

    return cred;
}
async function pairAgent(body) {
    console.log("\n==================================================");
    console.log("PAIR REQUEST START");
    console.log("==================================================");

    console.log("\n[1] Raw Request Body:");
    console.dir(body, { depth: null });

    const pairingToken = String(body.pairingToken || '').trim();
    const pairingUserId = String(body.pairingUserId || '').trim();
    const deviceId = String(body.deviceId || body.hostname || '').trim();
    const hostname = String(body.hostname || 'Rust Agent').trim();

    console.log("\n[2] Parsed Values:");
    console.log({
        pairingToken,
        pairingUserId,
        deviceId,
        hostname,
        pairingTokenType: typeof pairingToken,
        pairingUserIdType: typeof pairingUserId
    });

    if (!pairingToken || !pairingUserId || !deviceId) {
        console.log("\n[ERROR] Missing Required Fields");
        console.log({
            pairingToken,
            pairingUserId,
            deviceId
        });

        const error = new Error('Missing pairing token, user ID, or device configuration.');
        error.status = 400;
        throw error;
    }

    console.log("\n[3] Fetching users from database...");

    const allUsers = await User.find(
        {},
        {
            email: 1,
            pairingToken: 1,
            pairingUserId: 1
        }
    ).lean();

    console.log("\n========== USERS IN DATABASE ==========");

    if (allUsers.length === 0) {
        console.log("NO USERS FOUND");
    }

    allUsers.forEach((u, index) => {
        console.log(`\nUser ${index + 1}`);
        console.log("----------------------");
        console.log("_id:", u._id);
        console.log("email:", u.email);

        console.log(
            "pairingToken:",
            u.pairingToken,
            "| type:",
            typeof u.pairingToken
        );

        console.log(
            "pairingUserId:",
            u.pairingUserId,
            "| type:",
            typeof u.pairingUserId
        );
    });

    console.log("\n========================================");

    console.log("\n[4] Query (String)");

    const stringQuery = {
        pairingToken,
        pairingUserId
    };

    console.log(stringQuery);

    let user = await User.findOne(stringQuery);

    console.log("\nResult (String Query):");
    console.dir(user);

    console.log("\n[5] Query (Number)");

    const numberQuery = {
        pairingToken: Number(pairingToken),
        pairingUserId: Number(pairingUserId)
    };

    console.log(numberQuery);

    const numericUser = await User.findOne(numberQuery);

    console.log("\nResult (Number Query):");
    console.dir(numericUser);

    if (!user && numericUser) {
        console.log("\n========================================");
        console.log("FOUND USING NUMBER QUERY");
        console.log("Database stores numeric values.");
        console.log("========================================");

        user = numericUser;
    }

    if (!user) {
        console.log("\n========================================");
        console.log("NO MATCH FOUND");
        console.log("========================================");

        console.log("Incoming:");
        console.log({
            pairingToken,
            pairingUserId
        });

        console.log("\nDatabase:");
        console.dir(allUsers, { depth: null });

        const error = new Error("Invalid pairing token or user ID.");
        error.status = 404;
        throw error;
    }

    console.log("\n========================================");
    console.log("MATCHED USER");
    console.dir(user, { depth: null });
    console.log("========================================");

    const agentToken = crypto.randomBytes(32).toString("hex");
    const tokenHash = await bcrypt.hash(agentToken, 12);

    console.log("\n[6] Saving AgentCredential...");

    const credential = await AgentCredential.findOneAndUpdate(
        { deviceId },
        {
            userId: user._id,
            deviceId,
            label: hostname,
            tokenHash,
            lastConnectedAt: new Date()
        },
        {
            upsert: true,
            new: true
        }
    );

    console.dir(credential, { depth: null });

    console.log("\n[7] Saving Device...");

    const device = await Device.findOneAndUpdate(
        { deviceId },
        {
            userId: user._id,
            deviceId,
            status: "offline",
            lastSeen: new Date()
        },
        {
            upsert: true,
            new: true
        }
    );

    console.dir(device, { depth: null });

    console.log("\n========================================");
    console.log("PAIR SUCCESS");
    console.log("Device:", deviceId);
    console.log("Hostname:", hostname);
    console.log("========================================\n");

    return {
        agentToken,
        gatewayUrl:
            process.env.ZENVORA_GATEWAY_URL ||
            process.env.NEXT_PUBLIC_GATEWAY_URL ||
            "wss://zenvora.abdullahtahir.me/ws/gateway"
    };
}
async function userOwnsDevice(userId, deviceId) {
    if (!userId || !deviceId) return false;
    const cred = await AgentCredential.findOne({
        userId,
        deviceId: String(deviceId).trim()
    }).lean();
    if (cred) return true;

    const device = await Device.findOne({
        userId,
        deviceId: String(deviceId).trim()
    }).lean();
    return !!device;
}

async function listUserDevices(userId) {
    return AgentCredential.find({ userId }).sort({ updatedAt: -1 }).lean();
}

async function ensureDefaultAdmin() {
    const count = await User.countDocuments();
    if (count > 0) return null;

    if (process.env.NODE_ENV === 'production') {
        if (!process.env.DEFAULT_ADMIN_EMAIL || !process.env.DEFAULT_ADMIN_PASSWORD) {
            console.warn('=> Production bootstrap skipped: set DEFAULT_ADMIN_EMAIL and DEFAULT_ADMIN_PASSWORD to create the admin account.');
            return null;
        }
    }

    const user = await registerUser({
        email: process.env.DEFAULT_ADMIN_EMAIL || 'admin@zenvora.local',
        password: process.env.DEFAULT_ADMIN_PASSWORD || 'admin123',
        name: 'Admin'
    });

    console.log('=> Default admin account created.');
    console.log(`=> Email: ${user.email}`);
    console.log('=> Password: (see DEFAULT_ADMIN_PASSWORD or admin123) — change after first login.');
    return user;
}

module.exports = {
    AUTH_COOKIE,
    authCookieOptions,
    signUserToken,
    verifyUserToken,
    verifyUserTokenFast,
    setUserAuthSession,
    clearUserAuthSession,
    ensureAuthDatabase,
    registerUser,
    loginUser,
    upsertGoogleUser,
    requestPasswordReset,
    verifyPasswordResetOtp,
    resetPassword,
    createAgentCredential,
    verifyAgentToken,
    userOwnsDevice,
    listUserDevices,
    ensureDefaultAdmin,
    pairAgent
};
