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
        lastLoginAt: row.last_login_at,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
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
        const pool = await this.getPool();
        const [rows] = await pool.query(
            'SELECT * FROM users WHERE _id = ? OR id = ? LIMIT 1',
            [String(id), String(id)]
        );
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
        if (updates.lastLoginAt !== undefined) {
            fields.push('last_login_at = ?');
            values.push(updates.lastLoginAt ? new Date(updates.lastLoginAt) : new Date());
        }
        if (updates.avatarUrl !== undefined) {
            fields.push('avatar_url = ?');
            values.push(updates.avatarUrl);
        }

        if (fields.length === 0) {
            return this.findUserById(id);
        }

        values.push(String(id), String(id));
        await pool.query(
            `UPDATE users SET ${fields.join(', ')} WHERE _id = ? OR id = ?`,
            values
        );

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

        const sql = `
            INSERT INTO devices (
                device_id, user_id, platform, status, client_port, local_ip, public_ip,
                battery, storage, ram, cpu, network, hostname, username, os_version,
                architecture, metadata, last_seen
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
            ON DUPLICATE KEY UPDATE
                user_id = IF(VALUES(user_id) != '', VALUES(user_id), user_id),
                platform = VALUES(platform),
                status = VALUES(status),
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
            deviceId, userId, platform, status, clientPort, localIp, publicIp,
            battery, storage, ram, cpu, network, hostname, username, osVersion,
            architecture, metadata
        ]);

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
}

module.exports = new MysqlModelAdapter();
