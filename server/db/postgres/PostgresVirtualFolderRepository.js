const { BaseVirtualFolderRepository } = require('../BaseVirtualFolderRepository');

const TABLE = 'virtual_folders';

const CREATE_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS ${TABLE} (
    id SERIAL PRIMARY KEY,
    device_id VARCHAR(255) NOT NULL,
    name VARCHAR(512) NOT NULL,
    path VARCHAR(1024) NOT NULL,
    parent_path VARCHAR(1024) DEFAULT '/',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(device_id, path)
);
CREATE INDEX IF NOT EXISTS idx_vfo_device_parent ON ${TABLE}(device_id, parent_path);
`;

function loadPg() {
    try {
        return require('pg');
    } catch {
        throw new Error('PostgreSQL selected but "pg" is not installed. Run: npm install pg');
    }
}

function mapRow(row) {
    if (!row) return null;
    return {
        _id: String(row.id),
        id: String(row.id),
        deviceId: row.device_id,
        name: row.name,
        path: row.path,
        parentPath: row.parent_path,
        createdAt: row.created_at,
        updatedAt: row.updated_at
    };
}

class PostgresVirtualFolderRepository extends BaseVirtualFolderRepository {
    constructor() {
        super();
        this.pool = null;
    }

    async connect() {
        const connectionString = process.env.POSTGRES_URL || process.env.DATABASE_URL;
        if (!connectionString) {
            throw new Error('POSTGRES_URL is missing. Set DATABASE_PROVIDER=postgres and POSTGRES_URL.');
        }
        const { Pool } = loadPg();
        this.pool = new Pool({ connectionString });
        await this.pool.query(CREATE_TABLE_SQL);
    }

    async findByParent(deviceId, parentPath) {
        const { rows } = await this.pool.query(
            `SELECT * FROM ${TABLE} WHERE device_id = $1 AND parent_path = $2 ORDER BY name ASC`,
            [deviceId, parentPath]
        );
        return rows.map(mapRow);
    }

    async findAll(deviceId) {
        const { rows } = await this.pool.query(
            `SELECT * FROM ${TABLE} WHERE device_id = $1 ORDER BY path ASC`,
            [deviceId]
        );
        return rows.map(mapRow);
    }

    async findOneByPath(deviceId, path) {
        const { rows } = await this.pool.query(
            `SELECT * FROM ${TABLE} WHERE device_id = $1 AND path = $2 LIMIT 1`,
            [deviceId, path]
        );
        return mapRow(rows[0]);
    }

    async findById(id) {
        const { rows } = await this.pool.query(`SELECT * FROM ${TABLE} WHERE id = $1`, [id]);
        return mapRow(rows[0]);
    }

    async findChildFolder(deviceId, parentPath) {
        const { rows } = await this.pool.query(
            `SELECT * FROM ${TABLE} WHERE device_id = $1 AND parent_path = $2 LIMIT 1`,
            [deviceId, parentPath]
        );
        return mapRow(rows[0]);
    }

    async create(data) {
        const { rows } = await this.pool.query(
            `INSERT INTO ${TABLE} (device_id, name, path, parent_path) VALUES ($1,$2,$3,$4) RETURNING *`,
            [data.deviceId, data.name, data.path, data.parentPath || '/']
        );
        return mapRow(rows[0]);
    }

    async deleteById(id) {
        const { rows } = await this.pool.query(`DELETE FROM ${TABLE} WHERE id = $1 RETURNING *`, [id]);
        return mapRow(rows[0]);
    }
}

module.exports = { PostgresVirtualFolderRepository };
