const mysql = require('mysql2/promise');

let pool = null;
let tablesInitialized = false;

const POOL_OPTIONS = {
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    connectTimeout: 10000,
};

const SCHEMA_DDL = `
CREATE TABLE IF NOT EXISTS users (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    _id VARCHAR(64) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL DEFAULT 'User',
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash TEXT,
    role VARCHAR(32) NOT NULL DEFAULT 'user',
    provider VARCHAR(32) NOT NULL DEFAULT 'local',
    google_id VARCHAR(255) DEFAULT '',
    avatar_url TEXT,
    email_verified TINYINT(1) DEFAULT 0,
    auth_token_hash TEXT,
    pairing_token VARCHAR(255) UNIQUE,
    pairing_user_id VARCHAR(255) UNIQUE,
    last_login_at DATETIME NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_user_email (email),
    INDEX idx_user_pairing (pairing_token, pairing_user_id)
);

CREATE TABLE IF NOT EXISTS devices (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    device_id VARCHAR(255) UNIQUE NOT NULL,
    user_id VARCHAR(64) NOT NULL DEFAULT '',
    platform VARCHAR(64) NOT NULL DEFAULT 'unknown',
    status VARCHAR(32) NOT NULL DEFAULT 'offline',
    client_port INT DEFAULT 0,
    local_ip VARCHAR(128) DEFAULT '',
    public_ip VARCHAR(128) DEFAULT '',
    battery INT DEFAULT NULL,
    storage BIGINT DEFAULT NULL,
    ram BIGINT DEFAULT NULL,
    cpu VARCHAR(255) DEFAULT '',
    network VARCHAR(128) DEFAULT '',
    latitude DOUBLE DEFAULT NULL,
    longitude DOUBLE DEFAULT NULL,
    country VARCHAR(128) DEFAULT '',
    region VARCHAR(128) DEFAULT '',
    city VARCHAR(128) DEFAULT '',
    isp VARCHAR(255) DEFAULT '',
    timezone VARCHAR(128) DEFAULT '',
    hostname VARCHAR(255) DEFAULT '',
    username VARCHAR(255) DEFAULT '',
    os_version VARCHAR(255) DEFAULT '',
    architecture VARCHAR(64) DEFAULT '',
    metadata JSON,
    last_seen DATETIME DEFAULT CURRENT_TIMESTAMP,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_device_user (user_id),
    INDEX idx_device_lastseen (last_seen)
);

CREATE TABLE IF NOT EXISTS permissions (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id VARCHAR(64) UNIQUE NOT NULL,
    pages JSON,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_permission_user (user_id)
);

CREATE TABLE IF NOT EXISTS activity_logs (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id VARCHAR(64) DEFAULT '',
    device_id VARCHAR(255) DEFAULT '',
    action VARCHAR(128) NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'info',
    details JSON,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_act_user (user_id),
    INDEX idx_act_device (device_id),
    INDEX idx_act_created (created_at)
);

CREATE TABLE IF NOT EXISTS notifications (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id VARCHAR(64) NOT NULL,
    title VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    type VARCHAR(32) DEFAULT 'info',
    is_read TINYINT(1) DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_notif_user (user_id),
    INDEX idx_notif_unread (user_id, is_read)
);
`;

function parseMysqlUri(uri) {
    if (!uri) return null;
    try {
        if (uri.startsWith('mysql://')) {
            return uri;
        }
        return `mysql://${uri}`;
    } catch {
        return uri;
    }
}

async function connectMysql(customUri) {
    if (pool && !customUri) {
        return pool;
    }

    const uri = parseMysqlUri(customUri || process.env.MYSQL_URL || process.env.DATABASE_URL);
    if (!uri) {
        throw new Error('MYSQL_URL is missing. Set MYSQL_URL or configure MySQL in Settings.');
    }

    const newPool = mysql.createPool({
        uri,
        ...POOL_OPTIONS,
        multipleStatements: true,
    });

    // Verify connectivity
    const [rows] = await newPool.query('SELECT 1 AS ok');
    if (!rows || rows[0]?.ok !== 1) {
        throw new Error('MySQL connection verification failed.');
    }

    if (!customUri) {
        pool = newPool;
        if (!tablesInitialized) {
            await initializeMysqlTables(pool);
            tablesInitialized = true;
        }
    }

    return newPool;
}

async function initializeMysqlTables(targetPool) {
    try {
        const p = targetPool || pool;
        if (!p) return;
        const statements = SCHEMA_DDL
            .split(';')
            .map((s) => s.trim())
            .filter((s) => s.length > 0);

        for (const statement of statements) {
            await p.query(statement);
        }
    } catch (err) {
        console.error('MySQL schema initialization warning:', err.message);
    }
}

async function ensureMysqlConnected() {
    if (pool) return pool;
    return connectMysql();
}

function isMysqlConnected() {
    return pool !== null;
}

function getMysqlPool() {
    return pool;
}

async function testMysqlConnection(uri) {
    const start = Date.now();
    let conn = null;
    let timer = null;
    try {
        const parsed = parseMysqlUri(uri);
        if (!parsed) {
            throw new Error('MySQL URI is required.');
        }

        const connectPromise = mysql.createConnection({
            uri: parsed,
            connectTimeout: 3000,
        });

        const timeoutPromise = new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error('Connection timed out connecting to MySQL host (3000ms).')), 3500);
        });

        conn = await Promise.race([connectPromise, timeoutPromise]);
        if (timer) clearTimeout(timer);

        const [rows] = await conn.query('SELECT VERSION() AS version, DATABASE() AS current_db');
        const latencyMs = Date.now() - start;
        const version = rows[0]?.version || 'Unknown';
        const dbName = rows[0]?.current_db || 'default';

        try {
            await conn.end();
        } catch (_) {
            conn.destroy();
        }
        conn = null;

        return {
            success: true,
            latencyMs,
            version,
            dbName,
            message: `✓ Connected to MySQL database "${dbName}" v${version} (${latencyMs}ms ping)!`,
        };
    } catch (err) {
        if (timer) clearTimeout(timer);
        if (conn) {
            try {
                conn.destroy();
            } catch (_) {}
        }
        return {
            success: false,
            error: err instanceof Error ? err.message : String(err),
        };
    }
}

module.exports = {
    connectMysql,
    ensureMysqlConnected,
    isMysqlConnected,
    getMysqlPool,
    initializeMysqlTables,
    testMysqlConnection,
    parseMysqlUri,
};
