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

function buildMysqlUri(params) {
    if (!params || typeof params !== 'object') return '';
    const user = params.user || params.mysqlUser || '';
    const password = params.password ?? params.mysqlPassword ?? '';
    const host = params.host || params.mysqlHost || '127.0.0.1';
    const port = Number(params.port || params.mysqlPort) || 3306;
    const database = params.database || params.mysqlDatabase || '';

    const auth = user ? `${encodeURIComponent(user)}${password ? `:${encodeURIComponent(password)}` : ''}@` : '';
    const db = database ? `/${encodeURIComponent(database)}` : '';
    return `mysql://${auth}${host}:${port}${db}`;
}

function parseMysqlConnectionString(uri) {
    if (!uri || typeof uri !== 'string') return null;
    try {
        const raw = uri.trim();
        const normalized = raw.startsWith('mysql://') ? raw : `mysql://${raw}`;
        const parsed = new URL(normalized);
        return {
            host: parsed.hostname || '127.0.0.1',
            port: parsed.port ? Number(parsed.port) : 3306,
            user: parsed.username ? decodeURIComponent(parsed.username) : 'root',
            password: parsed.password ? decodeURIComponent(parsed.password) : '',
            database: parsed.pathname ? decodeURIComponent(parsed.pathname.replace(/^\//, '')) : '',
        };
    } catch {
        return null;
    }
}

function parseMysqlUri(uri) {
    if (!uri) return null;
    if (typeof uri === 'object') {
        return buildMysqlUri(uri);
    }
    try {
        if (uri.startsWith('mysql://')) {
            return uri;
        }
        return `mysql://${uri}`;
    } catch {
        return uri;
    }
}

function resolveMysqlConfig(input) {
    // 1. Explicit object provided
    if (input && typeof input === 'object') {
        if (input.mysqlUri || input.uri) {
            const rawUri = String(input.mysqlUri || input.uri).trim();
            const uri = rawUri.startsWith('mysql://') ? rawUri : `mysql://${rawUri}`;
            return {
                mode: 'uri',
                uri,
                options: parseMysqlConnectionString(uri) || {},
            };
        }
        const host = input.host || input.mysqlHost || '127.0.0.1';
        const port = Number(input.port || input.mysqlPort) || 3306;
        const user = input.user || input.mysqlUser || 'root';
        const password = input.password ?? input.mysqlPassword ?? '';
        const database = input.database || input.mysqlDatabase || '';
        const generatedUri = buildMysqlUri({ host, port, user, password, database });

        return {
            mode: 'params',
            uri: generatedUri,
            options: { host, port, user, password, database },
        };
    }

    // 2. String URI provided
    if (typeof input === 'string' && input.trim()) {
        const trimmed = input.trim();
        const uri = trimmed.startsWith('mysql://') ? trimmed : `mysql://${trimmed}`;
        return {
            mode: 'uri',
            uri,
            options: parseMysqlConnectionString(uri) || {},
        };
    }

    // 3. Fallback to process.env (MYSQL_URL / DATABASE_URL)
    const envUrl = process.env.MYSQL_URL || (process.env.DATABASE_URL?.includes('mysql') ? process.env.DATABASE_URL : null);
    if (envUrl) {
        const uri = envUrl.startsWith('mysql://') ? envUrl : `mysql://${envUrl}`;
        return {
            mode: 'uri',
            uri,
            options: parseMysqlConnectionString(uri) || {},
        };
    }

    // 4. Fallback to discrete env vars (MYSQL_HOST, etc.)
    if (process.env.MYSQL_HOST) {
        const host = process.env.MYSQL_HOST;
        const port = Number(process.env.MYSQL_PORT) || 3306;
        const user = process.env.MYSQL_USER || 'root';
        const password = process.env.MYSQL_PASSWORD || '';
        const database = process.env.MYSQL_DATABASE || '';
        const generatedUri = buildMysqlUri({ host, port, user, password, database });
        return {
            mode: 'params',
            uri: generatedUri,
            options: { host, port, user, password, database },
        };
    }

    return null;
}

async function connectMysql(customConfig) {
    if (pool && !customConfig) {
        return pool;
    }

    const config = resolveMysqlConfig(customConfig);
    if (!config) {
        throw new Error('MYSQL configuration is missing. Configure MySQL Host/Port/User/Password or Connection URI in Settings.');
    }

    let poolOptions;
    if (config.mode === 'params' && config.options.host) {
        poolOptions = {
            host: config.options.host,
            port: config.options.port,
            user: config.options.user,
            password: config.options.password,
            database: config.options.database || undefined,
            ...POOL_OPTIONS,
            multipleStatements: true,
        };
    } else {
        poolOptions = {
            uri: config.uri,
            ...POOL_OPTIONS,
            multipleStatements: true,
        };
    }

    const newPool = mysql.createPool(poolOptions);

    // Verify connectivity
    const [rows] = await newPool.query('SELECT 1 AS ok');
    if (!rows || rows[0]?.ok !== 1) {
        throw new Error('MySQL connection verification failed.');
    }

    if (!customConfig) {
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

async function testMysqlConnection(targetConfig) {
    const start = Date.now();
    let conn = null;
    let timer = null;
    try {
        const config = resolveMysqlConfig(targetConfig);
        if (!config) {
            throw new Error('MySQL configuration is required (either Host/User or Connection String).');
        }

        let connOptions;
        if (config.mode === 'params' && config.options.host) {
            connOptions = {
                host: config.options.host,
                port: config.options.port,
                user: config.options.user,
                password: config.options.password,
                database: config.options.database || undefined,
                connectTimeout: 3500,
            };
        } else {
            connOptions = {
                uri: config.uri,
                connectTimeout: 3500,
            };
        }

        const connectPromise = mysql.createConnection(connOptions);

        const timeoutPromise = new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error('Connection timed out connecting to MySQL host (3500ms).')), 4000);
        });

        conn = await Promise.race([connectPromise, timeoutPromise]);
        if (timer) clearTimeout(timer);

        const [rows] = await conn.query('SELECT VERSION() AS version, DATABASE() AS current_db');
        const latencyMs = Date.now() - start;
        const version = rows[0]?.version || 'Unknown';
        const dbName = rows[0]?.current_db || config.options?.database || 'default';
        const hostDisplay = config.options?.host || 'server';

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
            host: hostDisplay,
            message: `✓ Connected to MySQL host "${hostDisplay}" (DB: "${dbName}") v${version} (${latencyMs}ms ping)!`,
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
    buildMysqlUri,
    parseMysqlConnectionString,
    resolveMysqlConfig,
};
