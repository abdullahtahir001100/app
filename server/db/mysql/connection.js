const mysql = require('mysql2/promise');
const dns = require('dns').promises;

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
    password_reset_otp_hash TEXT,
    password_reset_otp_expires_at DATETIME NULL,
    admin_pin_hash TEXT,
    last_login_at DATETIME NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_user_email (email),
    INDEX idx_user_google (google_id),
    INDEX idx_user_pairing (pairing_token, pairing_user_id)
);

CREATE TABLE IF NOT EXISTS devices (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    device_id VARCHAR(255) UNIQUE NOT NULL,
    user_id VARCHAR(64) NOT NULL DEFAULT '',
    platform VARCHAR(64) NOT NULL DEFAULT 'unknown',
    status VARCHAR(32) NOT NULL DEFAULT 'offline',
    cloudinary_enabled TINYINT(1) DEFAULT 1,
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

CREATE TABLE IF NOT EXISTS virtual_files (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    device_id VARCHAR(255) NOT NULL,
    name VARCHAR(512) NOT NULL,
    original_path TEXT,
    virtual_folder VARCHAR(1024) DEFAULT '/',
    cloudinary_url TEXT NOT NULL,
    cloudinary_public_id TEXT NOT NULL,
    resource_type VARCHAR(32) DEFAULT 'raw',
    file_type VARCHAR(32) DEFAULT 'raw',
    page_type VARCHAR(32) DEFAULT 'file',
    mime_type VARCHAR(255) DEFAULT 'application/octet-stream',
    size BIGINT DEFAULT 0,
    tags JSON,
    share_enabled TINYINT(1) DEFAULT 0,
    share_token VARCHAR(128),
    is_deleted TINYINT(1) DEFAULT 0,
    deleted_at DATETIME NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_vf_device_folder (device_id, virtual_folder(255)),
    INDEX idx_vf_device_deleted (device_id, is_deleted)
);

CREATE TABLE IF NOT EXISTS virtual_folders (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    device_id VARCHAR(255) NOT NULL,
    name VARCHAR(512) NOT NULL,
    path VARCHAR(1024) NOT NULL,
    parent_path VARCHAR(1024) DEFAULT '/',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uniq_device_path (device_id, path(255)),
    INDEX idx_vfo_device_parent (device_id, parent_path(255))
);

CREATE TABLE IF NOT EXISTS agent_credentials (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id VARCHAR(64) NOT NULL,
    device_id VARCHAR(255) UNIQUE NOT NULL,
    label VARCHAR(255) DEFAULT 'My Agent',
    token_hash TEXT NOT NULL,
    last_connected_at DATETIME NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_agent_user (user_id),
    INDEX idx_agent_device (device_id)
);

CREATE TABLE IF NOT EXISTS app_histories (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    device_id VARCHAR(255) NOT NULL,
    user_id VARCHAR(64) DEFAULT '',
    app_name VARCHAR(255) NOT NULL,
    executable_path TEXT,
    last_opened DATETIME NOT NULL,
    app_type VARCHAR(32) DEFAULT 'app',
    duration BIGINT DEFAULT 0,
    category VARCHAR(128) DEFAULT '',
    windows_user VARCHAR(255) DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_app_device (device_id),
    INDEX idx_app_user (user_id),
    INDEX idx_app_last_opened (last_opened)
);

CREATE TABLE IF NOT EXISTS browser_histories (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    device_id VARCHAR(255) NOT NULL,
    user_id VARCHAR(64) DEFAULT '',
    browser VARCHAR(64) NOT NULL,
    url TEXT NOT NULL,
    title TEXT,
    visit_time DATETIME NOT NULL,
    visit_count INT DEFAULT 1,
    domain VARCHAR(255) DEFAULT '',
    windows_user VARCHAR(255) DEFAULT '',
    browser_profile VARCHAR(255) DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_browser_device (device_id),
    INDEX idx_browser_user (user_id),
    INDEX idx_browser_time (visit_time)
);

CREATE TABLE IF NOT EXISTS call_logs (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    device_id VARCHAR(255) NOT NULL,
    user_id VARCHAR(64) DEFAULT '',
    number VARCHAR(64) DEFAULT '',
    name VARCHAR(255) DEFAULT '',
    type INT DEFAULT 0,
    duration INT DEFAULT 0,
    timestamp DATETIME NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_call_device (device_id),
    INDEX idx_call_user (user_id),
    INDEX idx_call_time (timestamp)
);

CREATE TABLE IF NOT EXISTS contacts (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    device_id VARCHAR(255) NOT NULL,
    user_id VARCHAR(64) DEFAULT '',
    name VARCHAR(255) DEFAULT '',
    phone VARCHAR(64) DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_contact_device (device_id),
    INDEX idx_contact_user (user_id)
);

CREATE TABLE IF NOT EXISTS sms_messages (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    device_id VARCHAR(255) NOT NULL,
    user_id VARCHAR(64) DEFAULT '',
    address VARCHAR(128) DEFAULT '',
    body TEXT,
    type INT DEFAULT 0,
    timestamp DATETIME NOT NULL,
    is_read TINYINT(1) DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_sms_device (device_id),
    INDEX idx_sms_user (user_id),
    INDEX idx_sms_time (timestamp)
);

CREATE TABLE IF NOT EXISTS admin_settings (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    setting_key VARCHAR(128) UNIQUE NOT NULL,
    setting_value JSON,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_setting_key (setting_key)
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

function cleanHostString(host) {
    if (!host) return '127.0.0.1';
    let clean = String(host).trim();
    clean = clean.replace(/^tcp:/i, '');
    // Clean up accidental paste of hostname next to default 127.0.0.1 (e.g. host.database.windows.net127.0.0.1)
    clean = clean.replace(/(\.(?:net|com|org|io|dev|cloud|azure\.com|windows\.net|gov|edu))127\.0\.0\.1$/i, '$1');
    return clean;
}

async function resolveHostIp(hostname) {
    if (!hostname || hostname === 'localhost' || /^\d+\.\d+\.\d+\.\d+$/.test(hostname)) {
        return hostname;
    }
    try {
        const res = await dns.lookup(hostname);
        if (res?.address) return res.address;
    } catch (_) {
        try {
            const addrs = await dns.resolve4(hostname);
            if (addrs && addrs.length > 0) return addrs[0];
        } catch (_) {}
    }
    return hostname;
}

function parseMysqlConnectionString(uri) {
    if (!uri || typeof uri !== 'string') return null;
    const raw = uri.trim();
    if (!raw) return null;

    // 1. Support ADO.NET / Azure connection string format
    // e.g. Server=tcp:ne-az-sql-serv1.database.windows.net,1433;Initial Catalog=dhodn6pdjcyqw98;User ID=...;Password=...
    if (/Server=/i.test(raw) || /Data Source=/i.test(raw) || /Initial Catalog=/i.test(raw)) {
        const parts = raw.split(';').map((p) => p.trim()).filter(Boolean);
        const kv = {};
        for (const p of parts) {
            const eq = p.indexOf('=');
            if (eq > 0) {
                kv[p.substring(0, eq).trim().toLowerCase()] = p.substring(eq + 1).trim();
            }
        }
        let server = (kv['server'] || kv['data source'] || '').replace(/^tcp:/i, '');
        let host = server;
        let port = 3306;
        if (server.includes(',')) {
            const [h, pt] = server.split(',');
            host = h.trim();
            port = Number(pt.trim()) || 3306;
        } else if (server.includes(':')) {
            const [h, pt] = server.split(':');
            host = h.trim();
            port = Number(pt.trim()) || 3306;
        }
        return {
            host: cleanHostString(host),
            port,
            database: kv['initial catalog'] || kv['database'] || '',
            user: kv['user id'] || kv['uid'] || kv['user'] || 'root',
            password: kv['password'] || kv['pwd'] || '',
            ssl: true,
        };
    }

    // 2. Standard URI format (e.g. mysql://user:pass@host:port/db?useSSL=true)
    try {
        const normalized = raw.startsWith('mysql://') ? raw : `mysql://${raw}`;
        const parsed = new URL(normalized);
        const sslParam = parsed.searchParams.get('useSSL') || parsed.searchParams.get('ssl') || parsed.searchParams.get('requireSSL');
        const ssl = sslParam ? /^(true|1|yes|require)$/i.test(sslParam) : undefined;
        return {
            host: cleanHostString(parsed.hostname || '127.0.0.1'),
            port: parsed.port ? Number(parsed.port) : 3306,
            user: parsed.username ? decodeURIComponent(parsed.username) : 'root',
            password: parsed.password ? decodeURIComponent(parsed.password) : '',
            database: parsed.pathname ? decodeURIComponent(parsed.pathname.replace(/^\//, '')) : '',
            ssl,
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
            const raw = String(input.mysqlUri || input.uri).trim();
            const parsed = parseMysqlConnectionString(raw);
            const uri = parsed ? buildMysqlUri(parsed) : (raw.startsWith('mysql://') ? raw : `mysql://${raw}`);
            return {
                mode: 'uri',
                uri,
                options: parsed || {},
            };
        }
        const host = cleanHostString(input.host || input.mysqlHost || '127.0.0.1');
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
        const raw = input.trim();
        const parsed = parseMysqlConnectionString(raw);
        const uri = parsed ? buildMysqlUri(parsed) : (raw.startsWith('mysql://') ? raw : `mysql://${raw}`);
        return {
            mode: 'uri',
            uri,
            options: parsed || {},
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

    const targetHost = cleanHostString(config.options?.host || '');
    const targetPort = Number(config.options?.port || 3306);
    const ip = await resolveHostIp(targetHost);
    const isRemote = ip !== '127.0.0.1' && ip !== 'localhost' && !ip.startsWith('192.168.') && !ip.startsWith('10.');

    let poolOptions = {
        host: ip || '127.0.0.1',
        port: targetPort,
        user: config.options?.user || 'root',
        password: config.options?.password ?? '',
        database: config.options?.database || undefined,
        ...POOL_OPTIONS,
        multipleStatements: true,
    };

    if (isRemote || config.options?.ssl) {
        poolOptions.ssl = {
            servername: targetHost,
            rejectUnauthorized: false,
        };
    }

    let newPool;
    try {
        newPool = mysql.createPool(poolOptions);
        const [rows] = await newPool.query('SELECT 1 AS ok');
        if (!rows || rows[0]?.ok !== 1) {
            throw new Error('MySQL connection verification failed.');
        }
    } catch (err) {
        if (poolOptions.ssl && (err.code === 'HANDSHAKE_NO_SSL_SUPPORT' || err.message?.includes('SSL'))) {
            delete poolOptions.ssl;
            newPool = mysql.createPool(poolOptions);
            const [rows] = await newPool.query('SELECT 1 AS ok');
            if (!rows || rows[0]?.ok !== 1) {
                throw new Error('MySQL connection verification failed.');
            }
        } else {
            throw err;
        }
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

        // Idempotent column and index migrations for tables created in earlier versions
        const migrations = [
            `ALTER TABLE users ADD COLUMN google_id VARCHAR(255) DEFAULT ''`,
            `ALTER TABLE users ADD COLUMN provider VARCHAR(32) NOT NULL DEFAULT 'local'`,
            `ALTER TABLE users ADD COLUMN avatar_url TEXT`,
            `ALTER TABLE users ADD COLUMN email_verified TINYINT(1) DEFAULT 0`,
            `ALTER TABLE users ADD COLUMN pairing_token VARCHAR(255) UNIQUE`,
            `ALTER TABLE users ADD COLUMN pairing_user_id VARCHAR(255) UNIQUE`,
            `ALTER TABLE users ADD COLUMN password_reset_otp_hash TEXT`,
            `ALTER TABLE users ADD COLUMN password_reset_otp_expires_at DATETIME NULL`,
            `ALTER TABLE users ADD COLUMN admin_pin_hash TEXT`,
            `ALTER TABLE users ADD INDEX idx_user_google (google_id)`,
            `ALTER TABLE users ADD INDEX idx_user_pairing (pairing_token, pairing_user_id)`,
            `ALTER TABLE devices ADD COLUMN cloudinary_enabled TINYINT(1) DEFAULT 1`
        ];
        for (const migration of migrations) {
            try {
                await p.query(migration);
            } catch (_) {
                // Column or index already exists, silently ignore
            }
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

async function resetMysqlPool() {
    if (pool) {
        try {
            await pool.end();
        } catch (_) {}
        pool = null;
    }
    tablesInitialized = false;
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

        const rawHost = config.options?.host || '';
        const targetHost = cleanHostString(rawHost);
        const targetPort = Number(config.options?.port || 3306);

        // Check if user is attempting to connect to Microsoft SQL Server (Azure SQL) instead of MySQL
        if (targetPort === 1433 || targetHost.includes('database.windows.net')) {
            return {
                success: false,
                latencyMs: Date.now() - start,
                host: targetHost,
                error: `Microsoft SQL Server detected (${targetHost}:${targetPort}). This driver connects to MySQL (port 3306). On Azure, you created an "Azure SQL Database" (MSSQL/TDS protocol). For MySQL, create an "Azure Database for MySQL flexible server" (port 3306).`,
            };
        }

        const ip = await resolveHostIp(targetHost);
        const isRemote = ip !== '127.0.0.1' && ip !== 'localhost' && !ip.startsWith('192.168.') && !ip.startsWith('10.');

        let connOptions = {
            host: ip || '127.0.0.1',
            port: targetPort,
            user: config.options?.user || 'root',
            password: config.options?.password ?? '',
            database: config.options?.database || undefined,
            connectTimeout: 6000,
        };

        if (isRemote || config.options?.ssl) {
            connOptions.ssl = {
                servername: targetHost,
                rejectUnauthorized: false,
            };
        }

        const timeoutPromise = new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error(`Connection timed out connecting to MySQL host (${targetHost}:${targetPort}). Check host, port, firewall or SSL.`)), 7000);
        });

        try {
            conn = await Promise.race([mysql.createConnection(connOptions), timeoutPromise]);
        } catch (connErr) {
            // If server rejects SSL with NO_SSL_SUPPORT, retry without SSL
            if (connOptions.ssl && (connErr.code === 'HANDSHAKE_NO_SSL_SUPPORT' || connErr.message?.includes('SSL'))) {
                delete connOptions.ssl;
                conn = await Promise.race([mysql.createConnection(connOptions), timeoutPromise]);
            } else {
                throw connErr;
            }
        }
        if (timer) clearTimeout(timer);

        const [rows] = await conn.query('SELECT VERSION() AS version, DATABASE() AS current_db');
        const latencyMs = Date.now() - start;
        const version = rows[0]?.version || 'Unknown';
        const dbName = rows[0]?.current_db || config.options?.database || 'default';
        const hostDisplay = targetHost || 'server';

        // Auto-initialize all tables on test success so phpMyAdmin immediately displays all 13 tables
        try {
            await initializeMysqlTables(conn);
        } catch (tableErr) {
            console.warn('Auto table initialization notice:', tableErr.message);
        }

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
            port: targetPort,
            ssl: Boolean(connOptions.ssl),
            message: `✓ Connected to MySQL host "${hostDisplay}:${targetPort}" (DB: "${dbName}") v${version}${connOptions.ssl ? ' [SSL Encrypted]' : ''} (${latencyMs}ms ping)!`,
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
    resetMysqlPool,
    initializeMysqlTables,
    testMysqlConnection,
    parseMysqlUri,
    buildMysqlUri,
    parseMysqlConnectionString,
    resolveMysqlConfig,
};
