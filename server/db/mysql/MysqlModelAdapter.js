const crypto = require('crypto');
const { getMysqlPool, ensureMysqlConnected } = require('./connection');

function mapUser(row) {
    if (!row) return null;
    return {
        _id: String(row._id || row.id),
        id: String(row._id || row.id),
        name: row.name,
        email: row.email,
        passwordHash: row.password_hash || '',
        role: row.role || 'user',
        provider: row.provider || 'local',
        googleId: row.google_id || '',
        avatarUrl: row.avatar_url || '',
        emailVerified: Boolean(row.email_verified),
        authTokenHash: row.auth_token_hash || '',
        pairingToken: row.pairing_token || '',
        pairingUserId: row.pairing_user_id || '',
        passwordResetOtpHash: row.password_reset_otp_hash || '',
        passwordResetOtpExpiresAt: row.password_reset_otp_expires_at ? new Date(row.password_reset_otp_expires_at) : null,
        adminPinHash: row.admin_pin_hash || '',
        lastLoginAt: row.last_login_at ? new Date(row.last_login_at) : null,
        createdAt: row.created_at ? new Date(row.created_at) : null,
        updatedAt: row.updated_at ? new Date(row.updated_at) : null,
    };
}

function mapAgentCredential(row) {
    if (!row) return null;
    return {
        _id: String(row.id),
        id: String(row.id),
        userId: row.user_id,
        deviceId: row.device_id,
        label: row.label || 'My Agent',
        tokenHash: row.token_hash || '',
        lastConnectedAt: row.last_connected_at ? new Date(row.last_connected_at) : null,
        createdAt: row.created_at ? new Date(row.created_at) : null,
        updatedAt: row.updated_at ? new Date(row.updated_at) : null,
    };
}

function mapDevice(row) {
    if (!row) return null;
    let metadata = {};
    if (row.metadata) {
        try {
            metadata = typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata;
        } catch (_) {}
    }
    return {
        _id: String(row.id),
        id: String(row.id),
        deviceId: row.device_id,
        userId: row.user_id,
        platform: row.platform,
        status: row.status,
        clientPort: Number(row.client_port || 0),
        localIp: row.local_ip || '',
        publicIp: row.public_ip || '',
        battery: row.battery !== null ? Number(row.battery) : null,
        storage: row.storage !== null ? Number(row.storage) : null,
        ram: row.ram !== null ? Number(row.ram) : null,
        cpu: row.cpu || '',
        network: row.network || '',
        latitude: row.latitude !== null ? Number(row.latitude) : null,
        longitude: row.longitude !== null ? Number(row.longitude) : null,
        country: row.country || '',
        region: row.region || '',
        city: row.city || '',
        isp: row.isp || '',
        timezone: row.timezone || '',
        hostname: row.hostname || '',
        username: row.username || '',
        osVersion: row.os_version || '',
        architecture: row.architecture || '',
        metadata,
        cloudinaryEnabled: row.cloudinary_enabled === null || row.cloudinary_enabled === undefined ? true : Boolean(row.cloudinary_enabled),
        lastSeen: row.last_seen ? new Date(row.last_seen).toISOString() : new Date().toISOString(),
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}

class MysqlModelAdapter {
    async getPool() {
        let pool = getMysqlPool();
        if (!pool) {
            pool = await ensureMysqlConnected();
        }
        return pool;
    }

    // ================= USER OPERATIONS ================= //
    async findUserById(id) {
        if (!id) return null;
        const pool = await this.getPool();
        const isNum = /^\d+$/.test(String(id).trim());
        const [rows] = isNum
            ? await pool.query('SELECT * FROM users WHERE _id = ? OR id = ? LIMIT 1', [String(id), Number(id)])
            : await pool.query('SELECT * FROM users WHERE _id = ? LIMIT 1', [String(id)]);
        return mapUser(rows[0]);
    }

    async findUserByEmail(email) {
        if (!email) return null;
        const pool = await this.getPool();
        const [rows] = await pool.query(
            'SELECT * FROM users WHERE email = ? LIMIT 1',
            [String(email).trim().toLowerCase()]
        );
        return mapUser(rows[0]);
    }

    async findUserByGoogleId(googleId) {
        if (!googleId) return null;
        const pool = await this.getPool();
        const [rows] = await pool.query(
            'SELECT * FROM users WHERE google_id = ? LIMIT 1',
            [String(googleId).trim()]
        );
        return mapUser(rows[0]);
    }

    async findUserByPairing(pairingToken, pairingUserId) {
        const pool = await this.getPool();
        if (pairingToken && pairingUserId) {
            const [rows] = await pool.query(
                'SELECT * FROM users WHERE pairing_token = ? AND pairing_user_id = ? LIMIT 1',
                [pairingToken, pairingUserId]
            );
            return mapUser(rows[0]);
        }
        if (pairingToken) {
            const [rows] = await pool.query(
                'SELECT * FROM users WHERE pairing_token = ? LIMIT 1',
                [pairingToken]
            );
            return mapUser(rows[0]);
        }
        return null;
    }

    async createUser(data) {
        const pool = await this.getPool();
        const uid = data._id || data.id || crypto.randomBytes(12).toString('hex');
        const email = String(data.email || '').trim().toLowerCase();
        const name = data.name || 'User';
        const passwordHash = data.passwordHash || '';
        const role = data.role || 'user';
        const provider = data.provider || 'local';
        const googleId = data.googleId || '';
        const avatarUrl = data.avatarUrl || '';
        const emailVerified = data.emailVerified ? 1 : 0;
        const authTokenHash = data.authTokenHash || '';
        const pairingToken = data.pairingToken || null;
        const pairingUserId = data.pairingUserId || null;

        await pool.query(
            `INSERT INTO users (_id, name, email, password_hash, role, provider, google_id, avatar_url, email_verified, auth_token_hash, pairing_token, pairing_user_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [uid, name, email, passwordHash, role, provider, googleId, avatarUrl, emailVerified, authTokenHash, pairingToken, pairingUserId]
        );

        return this.findUserById(uid);
    }

    async updateUser(id, updates = {}) {
        const pool = await this.getPool();
        const fields = [];
        const values = [];

        if (updates.name !== undefined) {
            fields.push('name = ?');
            values.push(updates.name);
        }
        if (updates.passwordHash !== undefined) {
            fields.push('password_hash = ?');
            values.push(updates.passwordHash);
        }
        if (updates.authTokenHash !== undefined) {
            fields.push('auth_token_hash = ?');
            values.push(updates.authTokenHash);
        }
        if (updates.pairingToken !== undefined) {
            fields.push('pairing_token = ?');
            values.push(updates.pairingToken);
        }
        if (updates.pairingUserId !== undefined) {
            fields.push('pairing_user_id = ?');
            values.push(updates.pairingUserId);
        }
        if (updates.role !== undefined) {
            fields.push('role = ?');
            values.push(updates.role);
        }
        if (updates.provider !== undefined) {
            fields.push('provider = ?');
            values.push(updates.provider);
        }
        if (updates.googleId !== undefined) {
            fields.push('google_id = ?');
            values.push(updates.googleId);
        }
        if (updates.emailVerified !== undefined) {
            fields.push('email_verified = ?');
            values.push(updates.emailVerified ? 1 : 0);
        }
        if (updates.lastLoginAt !== undefined) {
            fields.push('last_login_at = ?');
            values.push(updates.lastLoginAt ? new Date(updates.lastLoginAt) : new Date());
        }
        if (updates.avatarUrl !== undefined) {
            fields.push('avatar_url = ?');
            values.push(updates.avatarUrl);
        }
        if (updates.passwordResetOtpHash !== undefined) {
            fields.push('password_reset_otp_hash = ?');
            values.push(updates.passwordResetOtpHash);
        }
        if (updates.passwordResetOtpExpiresAt !== undefined) {
            fields.push('password_reset_otp_expires_at = ?');
            values.push(updates.passwordResetOtpExpiresAt ? new Date(updates.passwordResetOtpExpiresAt) : null);
        }
        if (updates.adminPinHash !== undefined) {
            fields.push('admin_pin_hash = ?');
            values.push(updates.adminPinHash);
        }

        if (fields.length === 0) {
            return this.findUserById(id);
        }

        const isNum = /^\d+$/.test(String(id).trim());
        if (isNum) {
            values.push(String(id), Number(id));
            await pool.query(
                `UPDATE users SET ${fields.join(', ')} WHERE _id = ? OR id = ?`,
                values
            );
        } else {
            values.push(String(id));
            await pool.query(
                `UPDATE users SET ${fields.join(', ')} WHERE _id = ?`,
                values
            );
        }

        return this.findUserById(id);
    }

    async countUsers() {
        const pool = await this.getPool();
        const [rows] = await pool.query('SELECT COUNT(*) AS cnt FROM users');
        return Number(rows[0]?.cnt || 0);
    }

    async listAllUsers() {
        const pool = await this.getPool();
        const [rows] = await pool.query('SELECT * FROM users ORDER BY created_at DESC');
        return rows.map(mapUser);
    }

    // ================= DEVICE OPERATIONS ================= //
    async findDeviceById(deviceId) {
        if (!deviceId) return null;
        const pool = await this.getPool();
        const [rows] = await pool.query(
            'SELECT * FROM devices WHERE device_id = ? LIMIT 1',
            [String(deviceId)]
        );
        return mapDevice(rows[0]);
    }

    async listDevices(filter = {}, options = {}) {
        const pool = await this.getPool();
        const conditions = [];
        const values = [];

        if (filter.userId) {
            conditions.push('user_id = ?');
            values.push(String(filter.userId));
        }
        if (filter.status) {
            conditions.push('status = ?');
            values.push(String(filter.status));
        }

        const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
        const limit = Number(options.limit || 500);

        const [rows] = await pool.query(
            `SELECT * FROM devices ${whereClause} ORDER BY last_seen DESC LIMIT ?`,
            [...values, limit]
        );
        return rows.map(mapDevice);
    }

    async upsertDevice(deviceId, data = {}) {
        if (!deviceId) return null;
        const pool = await this.getPool();
        const existing = await this.findDeviceById(deviceId);

        const userId = data.userId !== undefined ? String(data.userId) : (existing?.userId || '');
        const platform = data.platform || existing?.platform || 'unknown';
        const status = data.status || existing?.status || 'online';
        const clientPort = data.clientPort !== undefined ? Number(data.clientPort) : (existing?.clientPort || 0);
        const localIp = data.localIp !== undefined ? String(data.localIp) : (existing?.localIp || '');
        const publicIp = data.publicIp !== undefined ? String(data.publicIp) : (existing?.publicIp || '');
        const battery = data.battery !== undefined ? (data.battery !== null ? Number(data.battery) : null) : (existing?.battery ?? null);
        const storage = data.storage !== undefined ? (data.storage !== null ? Number(data.storage) : null) : (existing?.storage ?? null);
        const ram = data.ram !== undefined ? (data.ram !== null ? Number(data.ram) : null) : (existing?.ram ?? null);
        const cpu = data.cpu || existing?.cpu || '';
        const network = data.network || existing?.network || '';
        const hostname = data.hostname || existing?.hostname || '';
        const username = data.username || existing?.username || '';
        const osVersion = data.osVersion || existing?.osVersion || '';
        const architecture = data.architecture || existing?.architecture || '';
        const metadata = JSON.stringify(data.metadata || existing?.metadata || {});
        const cloudinaryEnabled = data.cloudinaryEnabled !== undefined
            ? (data.cloudinaryEnabled ? 1 : 0)
            : (existing?.cloudinaryEnabled !== false ? 1 : 0);

        const sql = `
            INSERT INTO devices (
                device_id, user_id, platform, status, cloudinary_enabled, client_port, local_ip, public_ip,
                battery, storage, ram, cpu, network, hostname, username, os_version,
                architecture, metadata, last_seen
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
            ON DUPLICATE KEY UPDATE
                user_id = IF(VALUES(user_id) != '', VALUES(user_id), user_id),
                platform = VALUES(platform),
                status = VALUES(status),
                cloudinary_enabled = VALUES(cloudinary_enabled),
                client_port = VALUES(client_port),
                local_ip = VALUES(local_ip),
                public_ip = VALUES(public_ip),
                battery = VALUES(battery),
                storage = VALUES(storage),
                ram = VALUES(ram),
                cpu = VALUES(cpu),
                network = VALUES(network),
                hostname = VALUES(hostname),
                username = VALUES(username),
                os_version = VALUES(os_version),
                architecture = VALUES(architecture),
                metadata = VALUES(metadata),
                last_seen = NOW()
        `;

        await pool.query(sql, [
            deviceId, userId, platform, status, cloudinaryEnabled, clientPort, localIp, publicIp,
            battery, storage, ram, cpu, network, hostname, username, osVersion,
            architecture, metadata
        ]);

        return this.findDeviceById(deviceId);
    }

    async updateDeviceCloudinary(deviceId, enabled) {
        if (!deviceId) return null;
        const pool = await this.getPool();
        await pool.query(
            'UPDATE devices SET cloudinary_enabled = ? WHERE device_id = ?',
            [enabled ? 1 : 0, String(deviceId).trim()]
        );
        return this.findDeviceById(deviceId);
    }

    async countDevices() {
        const pool = await this.getPool();
        const [rows] = await pool.query('SELECT COUNT(*) AS cnt FROM devices');
        return Number(rows[0]?.cnt || 0);
    }

    // ================= PERMISSION OPERATIONS ================= //
    async findPermissionByUser(userId) {
        if (!userId) return null;
        const pool = await this.getPool();
        const [rows] = await pool.query(
            'SELECT * FROM permissions WHERE user_id = ? LIMIT 1',
            [String(userId)]
        );
        if (!rows[0]) return null;
        let pages = [];
        try {
            pages = typeof rows[0].pages === 'string' ? JSON.parse(rows[0].pages) : rows[0].pages;
        } catch (_) {}
        return { userId: rows[0].user_id, pages: Array.isArray(pages) ? pages : [] };
    }

    async savePermission(userId, pages = []) {
        if (!userId) return null;
        const pool = await this.getPool();
        const jsonPages = JSON.stringify(pages);
        await pool.query(
            `INSERT INTO permissions (user_id, pages) VALUES (?, ?)
             ON DUPLICATE KEY UPDATE pages = VALUES(pages)`,
            [String(userId), jsonPages]
        );
        return { userId, pages };
    }

    async listAllPermissions() {
        const pool = await this.getPool();
        const [rows] = await pool.query('SELECT * FROM permissions');
        return rows.map((r) => {
            let pages = [];
            try {
                pages = typeof r.pages === 'string' ? JSON.parse(r.pages) : r.pages;
            } catch (_) {}
            return { userId: String(r.user_id), pages: Array.isArray(pages) ? pages : [] };
        });
    }

    // ================= AGENT CREDENTIAL OPERATIONS ================= //
    async findAgentCredential(deviceId) {
        if (!deviceId) return null;
        const pool = await this.getPool();
        const [rows] = await pool.query(
            'SELECT * FROM agent_credentials WHERE device_id = ? LIMIT 1',
            [String(deviceId).trim()]
        );
        return mapAgentCredential(rows[0]);
    }

    async upsertAgentCredential(data) {
        const pool = await this.getPool();
        const deviceId = String(data.deviceId).trim();
        const userId = String(data.userId);
        const label = data.label || 'My Agent';
        const tokenHash = data.tokenHash || '';
        const lastConnectedAt = data.lastConnectedAt ? new Date(data.lastConnectedAt) : new Date();

        await pool.query(
            `INSERT INTO agent_credentials (user_id, device_id, label, token_hash, last_connected_at)
             VALUES (?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE
                user_id = VALUES(user_id),
                label = VALUES(label),
                token_hash = VALUES(token_hash),
                last_connected_at = VALUES(last_connected_at)`,
            [userId, deviceId, label, tokenHash, lastConnectedAt]
        );

        return this.findAgentCredential(deviceId);
    }

    async updateAgentCredentialLastConnected(deviceId) {
        if (!deviceId) return;
        const pool = await this.getPool();
        await pool.query(
            'UPDATE agent_credentials SET last_connected_at = NOW() WHERE device_id = ?',
            [String(deviceId).trim()]
        ).catch(() => {});
    }

    async listAgentCredentials(userId) {
        const pool = await this.getPool();
        const [rows] = await pool.query(
            'SELECT * FROM agent_credentials WHERE user_id = ? ORDER BY updated_at DESC',
            [String(userId)]
        );
        return rows.map(mapAgentCredential);
    }

    async listAllAgentCredentials(limit = 500) {
        const pool = await this.getPool();
        const [rows] = await pool.query(
            'SELECT * FROM agent_credentials ORDER BY updated_at DESC LIMIT ?',
            [Number(limit) || 500]
        );
        return rows.map(mapAgentCredential);
    }

    async countAgentCredentials() {
        const pool = await this.getPool();
        const [rows] = await pool.query('SELECT COUNT(*) AS cnt FROM agent_credentials');
        return Number(rows[0]?.cnt || 0);
    }

    async deleteAgentCredentials(deviceId, notUserId) {
        if (!deviceId) return;
        const pool = await this.getPool();
        if (notUserId) {
            await pool.query(
                'DELETE FROM agent_credentials WHERE device_id = ? AND user_id != ?',
                [String(deviceId).trim(), String(notUserId)]
            );
        } else {
            await pool.query(
                'DELETE FROM agent_credentials WHERE device_id = ?',
                [String(deviceId).trim()]
            );
        }
    }

    async deleteDevices({ deviceId, notUserId } = {}) {
        if (!deviceId) return;
        const pool = await this.getPool();
        if (notUserId) {
            await pool.query(
                'DELETE FROM devices WHERE device_id = ? AND user_id != ?',
                [String(deviceId).trim(), String(notUserId)]
            );
        } else {
            await pool.query(
                'DELETE FROM devices WHERE device_id = ?',
                [String(deviceId).trim()]
            );
        }
    }

    // ================= ADMIN SETTINGS OPERATIONS ================= //
    async getAdminSetting(key) {
        if (!key) return null;
        const pool = await this.getPool();
        const [rows] = await pool.query(
            'SELECT * FROM admin_settings WHERE setting_key = ? LIMIT 1',
            [String(key).trim()]
        );
        if (!rows[0]) return null;
        try {
            return typeof rows[0].setting_value === 'string'
                ? JSON.parse(rows[0].setting_value)
                : rows[0].setting_value;
        } catch (_) {
            return rows[0].setting_value;
        }
    }

    async setAdminSetting(key, value) {
        if (!key) return null;
        const pool = await this.getPool();
        const jsonVal = JSON.stringify(value);
        await pool.query(
            `INSERT INTO admin_settings (setting_key, setting_value) VALUES (?, ?)
             ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
            [String(key).trim(), jsonVal]
        );
        return value;
    }

    // ================= ACTIVITY LOG OPERATIONS ================= //
    async createActivityLog(data) {
        const pool = await this.getPool();
        const userId = String(data.userId || '');
        const deviceId = String(data.deviceId || '');
        const action = String(data.action || 'system');
        const status = String(data.status || 'info');
        const category = String(data.category || data.details?.category || 'general');
        const appName = String(data.appName || data.processName || data.details?.appName || '');
        const duration = Number(data.duration || data.metadata?.duration || 0) || 0;
        const details = JSON.stringify(data.details || data.metadata || {});

        try {
            const [result] = await pool.query(
                `INSERT INTO activity_logs (user_id, device_id, action, status, category, app_name, duration, details, created_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
                [userId, deviceId, action, status, category, appName, duration, details]
            );
            return { id: result.insertId, userId, deviceId, action, status, category, appName, duration, createdAt: new Date() };
        } catch (_) {
            const [result] = await pool.query(
                `INSERT INTO activity_logs (user_id, device_id, action, status, details, created_at)
                 VALUES (?, ?, ?, ?, ?, NOW())`,
                [userId, deviceId, action, status, details]
            );
            return { id: result.insertId, userId, deviceId, action, status, createdAt: new Date() };
        }
    }

    async findActivityLogs(filter = {}, options = {}) {
        const pool = await this.getPool();
        const conditions = [];
        const values = [];

        if (filter.userId) {
            conditions.push('user_id = ?');
            values.push(String(filter.userId));
        }
        if (filter.deviceId) {
            conditions.push('device_id = ?');
            values.push(String(filter.deviceId));
        }
        if (filter.status) {
            conditions.push('status = ?');
            values.push(String(filter.status));
        }
        if (filter.action) {
            conditions.push('action = ?');
            values.push(String(filter.action));
        }

        const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
        const limit = Math.max(1, Number(options.limit || 50));
        const offset = Math.max(0, Number(options.offset || 0));

        const [rows] = await pool.query(
            `SELECT * FROM activity_logs ${whereClause} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
            [...values, limit, offset]
        );

        return rows.map((r) => {
            let details = {};
            try {
                details = typeof r.details === 'string' ? JSON.parse(r.details) : r.details;
            } catch (_) {}
            return {
                _id: String(r.id),
                id: String(r.id),
                userId: r.user_id,
                deviceId: r.device_id,
                action: r.action,
                status: r.status,
                category: r.category || details?.category || 'general',
                appName: r.app_name || details?.appName || '',
                duration: Number(r.duration || details?.duration || 0),
                details,
                createdAt: r.created_at,
            };
        });
    }

    async countActivityLogs(filter = {}) {
        const pool = await this.getPool();
        const conditions = [];
        const values = [];

        if (filter.userId) {
            conditions.push('user_id = ?');
            values.push(String(filter.userId));
        }
        if (filter.deviceId) {
            conditions.push('device_id = ?');
            values.push(String(filter.deviceId));
        }
        if (filter.status) {
            conditions.push('status = ?');
            values.push(String(filter.status));
        }

        const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
        const [rows] = await pool.query(
            `SELECT COUNT(*) AS cnt FROM activity_logs ${whereClause}`,
            values
        );
        return Number(rows[0]?.cnt || 0);
    }

    // ================= BROWSER HISTORY OPERATIONS ================= //
    async upsertBrowserHistories(deviceId, entries, userId = '') {
        if (!deviceId || !Array.isArray(entries) || entries.length === 0) return { count: 0 };
        const pool = await this.getPool();
        let inserted = 0;

        for (const e of entries) {
            const browser = String(e.browser || 'Edge');
            const url = String(e.url || '');
            if (!url) continue;
            const title = String(e.title || url);
            const domain = String(e.domain || '');
            const windowsUser = String(e.windowsUser || e.windows_user || '');
            const browserProfile = String(e.browserProfile || e.browser_profile || '');
            const visitTime = e.visitTime ? new Date(e.visitTime) : new Date();
            const visitCount = Number(e.visitCount) || 1;

            await pool.query(
                `INSERT INTO browser_histories 
                 (device_id, user_id, browser, url, title, visit_time, visit_count, domain, windows_user, browser_profile)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [deviceId, String(userId || ''), browser, url, title, visitTime, visitCount, domain, windowsUser, browserProfile]
            );
            inserted++;
        }
        return { count: inserted };
    }

    async findBrowserHistories(filter = {}, options = {}) {
        const pool = await this.getPool();
        const conditions = [];
        const values = [];

        if (filter.userId) {
            conditions.push('user_id = ?');
            values.push(String(filter.userId));
        }
        if (filter.deviceId) {
            conditions.push('device_id = ?');
            values.push(String(filter.deviceId));
        }
        if (filter.browser) {
            conditions.push('browser = ?');
            values.push(String(filter.browser));
        }
        if (filter.domain) {
            conditions.push('domain = ?');
            values.push(String(filter.domain));
        }
        if (filter.search) {
            conditions.push('(title LIKE ? OR url LIKE ?)');
            values.push(`%${filter.search}%`, `%${filter.search}%`);
        }

        const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
        const limit = Math.max(1, Number(options.limit || 100));
        const offset = Math.max(0, Number(options.offset || 0));
        const order = String(options.order || 'DESC').toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

        const [rows] = await pool.query(
            `SELECT * FROM browser_histories ${whereClause} ORDER BY visit_time ${order} LIMIT ? OFFSET ?`,
            [...values, limit, offset]
        );

        return rows.map((r) => ({
            _id: String(r.id),
            id: String(r.id),
            deviceId: r.device_id,
            userId: r.user_id,
            browser: r.browser,
            url: r.url,
            title: r.title,
            visitTime: r.visit_time,
            visitCount: r.visit_count,
            domain: r.domain,
            windowsUser: r.windows_user,
            browserProfile: r.browser_profile,
            createdAt: r.created_at,
        }));
    }

    async countBrowserHistories(filter = {}) {
        const pool = await this.getPool();
        const conditions = [];
        const values = [];

        if (filter.userId) {
            conditions.push('user_id = ?');
            values.push(String(filter.userId));
        }
        if (filter.deviceId) {
            conditions.push('device_id = ?');
            values.push(String(filter.deviceId));
        }

        const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
        const [rows] = await pool.query(
            `SELECT COUNT(*) AS cnt FROM browser_histories ${whereClause}`,
            values
        );
        return Number(rows[0]?.cnt || 0);
    }

    // ================= APP HISTORY OPERATIONS ================= //
    async upsertAppHistories(deviceId, entries, userId = '') {
        if (!deviceId || !Array.isArray(entries) || entries.length === 0) return { count: 0 };
        const pool = await this.getPool();
        let inserted = 0;

        for (const e of entries) {
            const appName = String(e.appName || e.app_name || 'Unknown');
            const execPath = String(e.executablePath || e.executable_path || '');
            const lastOpened = e.lastOpened ? new Date(e.lastOpened) : new Date();
            const appType = String(e.appType || e.app_type || 'app');
            const duration = Math.max(0, Number(e.duration) || 0);
            const category = String(e.category || '');
            const windowsUser = String(e.windowsUser || e.windows_user || '');

            await pool.query(
                `INSERT INTO app_histories 
                 (device_id, user_id, app_name, executable_path, last_opened, app_type, duration, category, windows_user)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [deviceId, String(userId || ''), appName, execPath, lastOpened, appType, duration, category, windowsUser]
            );
            inserted++;
        }
        return { count: inserted };
    }

    async findAppHistories(filter = {}, options = {}) {
        const pool = await this.getPool();
        const conditions = [];
        const values = [];

        if (filter.userId) {
            conditions.push('user_id = ?');
            values.push(String(filter.userId));
        }
        if (filter.deviceId) {
            conditions.push('device_id = ?');
            values.push(String(filter.deviceId));
        }
        if (filter.appType) {
            conditions.push('app_type = ?');
            values.push(String(filter.appType));
        }
        if (filter.search) {
            conditions.push('app_name LIKE ?');
            values.push(`%${filter.search}%`);
        }

        const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
        const limit = Math.max(1, Number(options.limit || 100));
        const offset = Math.max(0, Number(options.offset || 0));

        const [rows] = await pool.query(
            `SELECT * FROM app_histories ${whereClause} ORDER BY last_opened DESC LIMIT ? OFFSET ?`,
            [...values, limit, offset]
        );

        return rows.map((r) => ({
            _id: String(r.id),
            id: String(r.id),
            deviceId: r.device_id,
            userId: r.user_id,
            appName: r.app_name,
            executablePath: r.executable_path,
            lastOpened: r.last_opened,
            appType: r.app_type,
            duration: r.duration,
            category: r.category,
            windowsUser: r.windows_user,
            createdAt: r.created_at,
        }));
    }

    async countAppHistories(filter = {}) {
        const pool = await this.getPool();
        const conditions = [];
        const values = [];

        if (filter.userId) {
            conditions.push('user_id = ?');
            values.push(String(filter.userId));
        }
        if (filter.deviceId) {
            conditions.push('device_id = ?');
            values.push(String(filter.deviceId));
        }

        const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
        const [rows] = await pool.query(
            `SELECT COUNT(*) AS cnt FROM app_histories ${whereClause}`,
            values
        );
        return Number(rows[0]?.cnt || 0);
    }

    // ================= NOTIFICATION OPERATIONS ================= //
    async createNotification(data) {
        const pool = await this.getPool();
        const userId = String(data.userId || '');
        const title = String(data.title || 'Notification');
        const message = String(data.message || '');
        const type = String(data.type || data.category || 'info');
        const isRead = data.isRead || data.read ? 1 : 0;

        const [result] = await pool.query(
            `INSERT INTO notifications (user_id, title, message, type, is_read, created_at)
             VALUES (?, ?, ?, ?, ?, NOW())`,
            [userId, title, message, type, isRead]
        );
        return { id: result.insertId, _id: String(result.insertId), userId, title, message, type, isRead: Boolean(isRead), createdAt: new Date() };
    }

    async findNotifications(filter = {}, options = {}) {
        const pool = await this.getPool();
        const conditions = [];
        const values = [];

        if (filter.userId) {
            conditions.push('user_id = ?');
            values.push(String(filter.userId));
        }
        if (filter.type) {
            conditions.push('type = ?');
            values.push(String(filter.type));
        }
        if (filter.isRead !== undefined) {
            conditions.push('is_read = ?');
            values.push(filter.isRead ? 1 : 0);
        }

        const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
        const limit = Math.max(1, Number(options.limit || 50));
        const offset = Math.max(0, Number(options.offset || 0));

        const [rows] = await pool.query(
            `SELECT * FROM notifications ${whereClause} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
            [...values, limit, offset]
        );

        return rows.map((r) => ({
            _id: String(r.id),
            id: String(r.id),
            userId: r.user_id,
            title: r.title,
            message: r.message,
            type: r.type,
            category: r.type,
            read: Boolean(r.is_read),
            isRead: Boolean(r.is_read),
            createdAt: r.created_at,
        }));
    }

    async countNotifications(filter = {}) {
        const pool = await this.getPool();
        const conditions = [];
        const values = [];

        if (filter.userId) {
            conditions.push('user_id = ?');
            values.push(String(filter.userId));
        }
        if (filter.isRead !== undefined) {
            conditions.push('is_read = ?');
            values.push(filter.isRead ? 1 : 0);
        }

        const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
        const [rows] = await pool.query(
            `SELECT COUNT(*) AS cnt FROM notifications ${whereClause}`,
            values
        );
        return Number(rows[0]?.cnt || 0);
    }

    async markNotificationRead(id, userId = null) {
        const pool = await this.getPool();
        const conditions = ['id = ?'];
        const values = [Number(id) || id];
        if (userId) {
            conditions.push('user_id = ?');
            values.push(String(userId));
        }
        await pool.query(
            `UPDATE notifications SET is_read = 1 WHERE ${conditions.join(' AND ')}`,
            values
        );
        return { success: true };
    }

    async markAllNotificationsRead(userId = null) {
        const pool = await this.getPool();
        if (userId) {
            const [res] = await pool.query('UPDATE notifications SET is_read = 1 WHERE user_id = ?', [String(userId)]);
            return { modifiedCount: res.affectedRows };
        }
        const [res] = await pool.query('UPDATE notifications SET is_read = 1');
        return { modifiedCount: res.affectedRows };
    }

    async deleteNotification(id, userId = null) {
        const pool = await this.getPool();
        const conditions = ['id = ?'];
        const values = [Number(id) || id];
        if (userId) {
            conditions.push('user_id = ?');
            values.push(String(userId));
        }
        await pool.query(
            `DELETE FROM notifications WHERE ${conditions.join(' AND ')}`,
            values
        );
        return { success: true };
    }

    async clearAllNotifications(userId = null) {
        const pool = await this.getPool();
        if (userId) {
            await pool.query('DELETE FROM notifications WHERE user_id = ?', [String(userId)]);
        } else {
            await pool.query('DELETE FROM notifications');
        }
        return { success: true };
    }

    // ================= CALL LOGS OPERATIONS ================= //
    async upsertCallLogs(deviceId, entries, userId = '') {
        if (!deviceId || !Array.isArray(entries) || entries.length === 0) return { count: 0 };
        const pool = await this.getPool();
        let inserted = 0;

        for (const e of entries) {
            const number = String(e.number || '');
            const name = String(e.name || '');
            if (!number && !name) continue;
            const type = Number(e.type) || 0;
            const duration = Number(e.duration) || 0;
            const timestamp = e.timestamp ? new Date(e.timestamp) : new Date();

            await pool.query(
                `INSERT INTO call_logs (device_id, user_id, number, name, type, duration, timestamp)
                 VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [deviceId, String(userId || ''), number, name, type, duration, timestamp]
            );
            inserted++;
        }
        return { count: inserted };
    }

    async findCallLogs(filter = {}, options = {}) {
        const pool = await this.getPool();
        const conditions = [];
        const values = [];

        if (filter.userId) {
            conditions.push('user_id = ?');
            values.push(String(filter.userId));
        }
        if (filter.deviceId) {
            conditions.push('device_id = ?');
            values.push(String(filter.deviceId));
        }

        const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
        const limit = Math.max(1, Number(options.limit || 100));
        const offset = Math.max(0, Number(options.offset || 0));

        const [rows] = await pool.query(
            `SELECT * FROM call_logs ${whereClause} ORDER BY timestamp DESC LIMIT ? OFFSET ?`,
            [...values, limit, offset]
        );

        return rows.map((r) => ({
            _id: String(r.id),
            id: String(r.id),
            deviceId: r.device_id,
            userId: r.user_id,
            number: r.number,
            name: r.name,
            type: r.type,
            duration: r.duration,
            timestamp: r.timestamp,
            createdAt: r.created_at,
        }));
    }

    // ================= SMS MESSAGES OPERATIONS ================= //
    async upsertSmsMessages(deviceId, entries, userId = '') {
        if (!deviceId || !Array.isArray(entries) || entries.length === 0) return { count: 0 };
        const pool = await this.getPool();
        let inserted = 0;

        for (const e of entries) {
            const address = String(e.address || '');
            const body = String(e.body || '');
            if (!address && !body) continue;
            const type = Number(e.type) || 0;
            const isRead = e.read || e.isRead ? 1 : 0;
            const timestamp = e.timestamp ? new Date(e.timestamp) : new Date();

            await pool.query(
                `INSERT INTO sms_messages (device_id, user_id, address, body, type, is_read, timestamp)
                 VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [deviceId, String(userId || ''), address, body, type, isRead, timestamp]
            );
            inserted++;
        }
        return { count: inserted };
    }

    async findSmsMessages(filter = {}, options = {}) {
        const pool = await this.getPool();
        const conditions = [];
        const values = [];

        if (filter.userId) {
            conditions.push('user_id = ?');
            values.push(String(filter.userId));
        }
        if (filter.deviceId) {
            conditions.push('device_id = ?');
            values.push(String(filter.deviceId));
        }

        const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
        const limit = Math.max(1, Number(options.limit || 100));
        const offset = Math.max(0, Number(options.offset || 0));

        const [rows] = await pool.query(
            `SELECT * FROM sms_messages ${whereClause} ORDER BY timestamp DESC LIMIT ? OFFSET ?`,
            [...values, limit, offset]
        );

        return rows.map((r) => ({
            _id: String(r.id),
            id: String(r.id),
            deviceId: r.device_id,
            userId: r.user_id,
            address: r.address,
            body: r.body,
            type: r.type,
            read: Boolean(r.is_read),
            timestamp: r.timestamp,
            createdAt: r.created_at,
        }));
    }

    // ================= CONTACTS OPERATIONS ================= //
    async upsertContacts(deviceId, entries, userId = '') {
        if (!deviceId || !Array.isArray(entries) || entries.length === 0) return { count: 0 };
        const pool = await this.getPool();
        let inserted = 0;

        for (const e of entries) {
            const name = String(e.name || '');
            const phone = String(e.phone || e.number || '');
            if (!name && !phone) continue;

            await pool.query(
                `INSERT INTO contacts (device_id, user_id, name, phone)
                 VALUES (?, ?, ?, ?)`,
                [deviceId, String(userId || ''), name, phone]
            );
            inserted++;
        }
        return { count: inserted };
    }

    async findContacts(filter = {}, options = {}) {
        const pool = await this.getPool();
        const conditions = [];
        const values = [];

        if (filter.userId) {
            conditions.push('user_id = ?');
            values.push(String(filter.userId));
        }
        if (filter.deviceId) {
            conditions.push('device_id = ?');
            values.push(String(filter.deviceId));
        }

        const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
        const limit = Math.max(1, Number(options.limit || 100));
        const offset = Math.max(0, Number(options.offset || 0));

        const [rows] = await pool.query(
            `SELECT * FROM contacts ${whereClause} ORDER BY name ASC LIMIT ? OFFSET ?`,
            [...values, limit, offset]
        );

        return rows.map((r) => ({
            _id: String(r.id),
            id: String(r.id),
            deviceId: r.device_id,
            userId: r.user_id,
            name: r.name,
            phone: r.phone,
            createdAt: r.created_at,
        }));
    }

    // ================= ANALYTICS & USAGE OPERATIONS ================= //
    async aggregateBrowserStats(filter = {}) {
        const pool = await this.getPool();
        const conditions = [];
        const values = [];

        if (filter.userId) {
            conditions.push('user_id = ?');
            values.push(String(filter.userId));
        }
        if (filter.deviceId) {
            conditions.push('device_id = ?');
            values.push(String(filter.deviceId));
        }

        const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
        const [rows] = await pool.query(
            `SELECT browser AS _id, COUNT(*) AS count, MAX(visit_time) AS lastVisit
             FROM browser_histories
             ${whereClause}
             GROUP BY browser
             ORDER BY count DESC`,
            values
        );

        return rows.map((r) => ({
            _id: r._id || 'Unknown',
            count: Number(r.count || 0),
            lastVisit: r.lastVisit ? new Date(r.lastVisit).toISOString() : null,
        }));
    }

    async aggregateActivityStats(filter = {}) {
        const pool = await this.getPool();
        const conditions = [];
        const values = [];

        if (filter.userId) {
            conditions.push('user_id = ?');
            values.push(String(filter.userId));
        }
        if (filter.deviceId) {
            conditions.push('device_id = ?');
            values.push(String(filter.deviceId));
        }

        const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
        let rows = [];
        try {
            const [r] = await pool.query(
                `SELECT COALESCE(NULLIF(category, ''), action) AS _id, COUNT(*) AS count, MAX(created_at) AS lastActivity
                 FROM activity_logs
                 ${whereClause}
                 GROUP BY _id
                 ORDER BY count DESC`,
                values
            );
            rows = r;
        } catch (_) {
            const [r] = await pool.query(
                `SELECT action AS _id, COUNT(*) AS count, MAX(created_at) AS lastActivity
                 FROM activity_logs
                 ${whereClause}
                 GROUP BY action
                 ORDER BY count DESC`,
                values
            );
            rows = r;
        }

        return rows.map((r) => ({
            _id: r._id || 'system',
            count: Number(r.count || 0),
            lastActivity: r.lastActivity ? new Date(r.lastActivity).toISOString() : null,
        }));
    }

    async getTopDomains(filter = {}, limit = 20) {
        const pool = await this.getPool();
        const conditions = [];
        const values = [];

        if (filter.userId) {
            conditions.push('user_id = ?');
            values.push(String(filter.userId));
        }
        if (filter.deviceId) {
            conditions.push('device_id = ?');
            values.push(String(filter.deviceId));
        }

        conditions.push("domain IS NOT NULL AND domain != ''");
        const whereClause = `WHERE ${conditions.join(' AND ')}`;
        const cappedLimit = Math.max(1, Math.min(100, Number(limit) || 20));

        const [rows] = await pool.query(
            `SELECT domain AS _id, COUNT(*) AS count, MAX(visit_time) AS lastVisit
             FROM browser_histories
             ${whereClause}
             GROUP BY domain
             ORDER BY count DESC
             LIMIT ?`,
            [...values, cappedLimit]
        );

        return rows.map((r) => ({
            _id: r._id,
            count: Number(r.count || 0),
            lastVisit: r.lastVisit ? new Date(r.lastVisit).toISOString() : null,
        }));
    }

    async getTopApps(filter = {}, limit = 20) {
        const pool = await this.getPool();
        const conditions = [];
        const values = [];

        if (filter.userId) {
            conditions.push('user_id = ?');
            values.push(String(filter.userId));
        }
        if (filter.deviceId) {
            conditions.push('device_id = ?');
            values.push(String(filter.deviceId));
        }

        conditions.push("app_name IS NOT NULL AND app_name != ''");
        const whereClause = `WHERE ${conditions.join(' AND ')}`;
        const cappedLimit = Math.max(1, Math.min(100, Number(limit) || 20));

        const [rows] = await pool.query(
            `SELECT app_name AS _id, COUNT(*) AS count, MAX(last_opened) AS lastOpened
             FROM app_histories
             ${whereClause}
             GROUP BY app_name
             ORDER BY count DESC
             LIMIT ?`,
            [...values, cappedLimit]
        );

        return rows.map((r) => ({
            _id: r._id,
            count: Number(r.count || 0),
            lastOpened: r.lastOpened ? new Date(r.lastOpened).toISOString() : null,
        }));
    }

    async getUsageData({ userId, deviceId, start, end }) {
        const pool = await this.getPool();
        const appConditions = ['user_id = ?', 'last_opened >= ?', 'last_opened <= ?', 'duration > 0', "category != 'usagestats'"];
        const appValues = [String(userId), start, end];
        if (deviceId) {
            appConditions.push('device_id = ?');
            appValues.push(String(deviceId));
        }

        const actConditions = ['user_id = ?', 'created_at >= ?', 'created_at <= ?', "action = 'app_closed'"];
        const actValues = [String(userId), start, end];
        if (deviceId) {
            actConditions.push('device_id = ?');
            actValues.push(String(deviceId));
        }

        const [appRows] = await pool.query(
            `SELECT * FROM app_histories WHERE ${appConditions.join(' AND ')} ORDER BY last_opened DESC LIMIT 2000`,
            appValues
        );

        let actRows = [];
        try {
            const [r] = await pool.query(
                `SELECT * FROM activity_logs WHERE ${actConditions.join(' AND ')} ORDER BY created_at DESC LIMIT 2000`,
                actValues
            );
            actRows = r;
        } catch (_) {}

        const byApp = new Map();
        const hourly = Array.from({ length: 24 }, (_, hour) => ({ hour, duration: 0, sessions: 0 }));
        const timeline = [];

        const add = (name, duration, at) => {
            const seconds = Math.max(0, Number(duration) || 0);
            if (seconds <= 0) return;
            const appName = String(name || 'Unknown').trim() || 'Unknown';
            const prev = byApp.get(appName) || { appName, duration: 0, sessions: 0, lastOpened: at };
            prev.duration += seconds;
            prev.sessions += 1;
            if (at && (!prev.lastOpened || at > prev.lastOpened)) prev.lastOpened = at;
            byApp.set(appName, prev);
            const opened = at ? new Date(at) : null;
            if (opened && !Number.isNaN(opened.getTime())) {
                hourly[opened.getHours()].duration += seconds;
                hourly[opened.getHours()].sessions += 1;
            }
            timeline.push({ appName, duration: seconds, lastOpened: at });
        };

        const closed = actRows.filter((row) => {
            let meta = {};
            try {
                meta = typeof row.details === 'string' ? JSON.parse(row.details) : (row.details || {});
            } catch (_) {}
            const seconds = Math.max(0, Number(row.duration) || Number(meta.duration) || 0);
            return seconds > 0;
        });

        if (closed.length > 0) {
            for (const row of closed) {
                let meta = {};
                try {
                    meta = typeof row.details === 'string' ? JSON.parse(row.details) : (row.details || {});
                } catch (_) {}
                add(
                    row.app_name || meta.appName || meta.processName || row.action,
                    Number(row.duration) || Number(meta.duration) || 0,
                    row.created_at
                );
            }
        } else {
            for (const row of appRows) {
                add(row.app_name, row.duration, row.last_opened);
            }
        }

        const apps = [...byApp.values()].sort((a, b) => b.duration - a.duration).slice(0, 40);
        timeline.sort((a, b) => b.duration - a.duration);

        return {
            apps,
            hourly,
            timeline: timeline.slice(0, 200),
        };
    }

    async getUsageDetail({ userId, deviceId, appName, start, end }) {
        const pool = await this.getPool();
        const isBrowser = /chrome|edge|firefox|brave|opera|safari|browser|msedge/i.test(appName);
        const searchPattern = `%${appName}%`;

        let actRows = [];
        try {
            const [r] = await pool.query(
                `SELECT * FROM activity_logs 
                 WHERE user_id = ? AND device_id = ? AND created_at >= ? AND created_at <= ?
                   AND (action LIKE ? OR details LIKE ? OR app_name LIKE ?)
                 ORDER BY created_at DESC LIMIT 300`,
                [String(userId), String(deviceId), start, end, searchPattern, searchPattern, searchPattern]
            );
            actRows = r;
        } catch (_) {
            const [r] = await pool.query(
                `SELECT * FROM activity_logs 
                 WHERE user_id = ? AND device_id = ? AND created_at >= ? AND created_at <= ?
                   AND (action LIKE ? OR details LIKE ?)
                 ORDER BY created_at DESC LIMIT 300`,
                [String(userId), String(deviceId), start, end, searchPattern, searchPattern]
            );
            actRows = r;
        }

        const [appRows] = await pool.query(
            `SELECT * FROM app_histories 
             WHERE user_id = ? AND device_id = ? AND last_opened >= ? AND last_opened <= ?
               AND app_name LIKE ? AND duration > 0
             ORDER BY last_opened DESC LIMIT 100`,
            [String(userId), String(deviceId), start, end, searchPattern]
        );

        let browserRows = [];
        if (isBrowser) {
            const [bRows] = await pool.query(
                `SELECT * FROM browser_histories 
                 WHERE user_id = ? AND device_id = ? AND visit_time >= ? AND visit_time <= ?
                 ORDER BY visit_time DESC LIMIT 200`,
                [String(userId), String(deviceId), start, end]
            );
            browserRows = bRows;
        }

        const activity = actRows.map((r) => {
            let details = {};
            try {
                details = typeof r.details === 'string' ? JSON.parse(r.details) : (r.details || {});
            } catch (_) {}
            return {
                _id: String(r.id),
                userId: r.user_id,
                deviceId: r.device_id,
                action: r.action,
                appName: r.app_name || details.appName || '',
                status: r.status,
                details,
                createdAt: r.created_at,
            };
        });

        const appSessions = appRows.map((r) => ({
            _id: String(r.id),
            userId: r.user_id,
            deviceId: r.device_id,
            appName: r.app_name,
            executablePath: r.executable_path,
            lastOpened: r.last_opened,
            duration: r.duration,
            appType: r.app_type,
            category: r.category,
        }));

        const browser = browserRows.map((r) => ({
            _id: String(r.id),
            userId: r.user_id,
            deviceId: r.device_id,
            browser: r.browser,
            url: r.url,
            title: r.title,
            domain: r.domain,
            visitTime: r.visit_time,
            visitCount: r.visit_count,
        }));

        return {
            activity,
            appSessions,
            browserHistory: browser,
        };
    }
}

module.exports = new MysqlModelAdapter();
