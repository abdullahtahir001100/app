const { BaseVirtualFolderRepository } = require('../BaseVirtualFolderRepository');

const TABLE = 'virtual_folders';

const CREATE_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS ${TABLE} (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    device_id VARCHAR(255) NOT NULL,
    name VARCHAR(512) NOT NULL,
    path VARCHAR(1024) NOT NULL,
    parent_path VARCHAR(1024) DEFAULT '/',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uniq_device_path (device_id, path),
    INDEX idx_vfo_device_parent (device_id, parent_path)
);
`;

function loadMysql() {
    try {
        return require('mysql2/promise');
    } catch {
        throw new Error('MySQL selected but "mysql2" is not installed. Run: npm install mysql2');
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

class MysqlVirtualFolderRepository extends BaseVirtualFolderRepository {
    constructor() {
        super();
        this.pool = null;
    }

    async connect() {
        const uri = process.env.MYSQL_URL || process.env.DATABASE_URL;
        if (!uri) {
            throw new Error('MYSQL_URL is missing. Set DATABASE_PROVIDER=mysql and MYSQL_URL.');
        }
        const mysql = loadMysql();
        this.pool = mysql.createPool(uri);
        await this.pool.query(CREATE_TABLE_SQL);
    }

    async findByParent(deviceId, parentPath) {
        const [rows] = await this.pool.query(
            `SELECT * FROM ${TABLE} WHERE device_id = ? AND parent_path = ? ORDER BY name ASC`,
            [deviceId, parentPath]
        );
        return rows.map(mapRow);
    }

    async findAll(deviceId) {
        const [rows] = await this.pool.query(
            `SELECT * FROM ${TABLE} WHERE device_id = ? ORDER BY path ASC`,
            [deviceId]
        );
        return rows.map(mapRow);
    }

    async findOneByPath(deviceId, path) {
        const [rows] = await this.pool.query(
            `SELECT * FROM ${TABLE} WHERE device_id = ? AND path = ? LIMIT 1`,
            [deviceId, path]
        );
        return mapRow(rows[0]);
    }

    async findById(id) {
        const [rows] = await this.pool.query(`SELECT * FROM ${TABLE} WHERE id = ?`, [id]);
        return mapRow(rows[0]);
    }

    async findChildFolder(deviceId, parentPath) {
        const [rows] = await this.pool.query(
            `SELECT * FROM ${TABLE} WHERE device_id = ? AND parent_path = ? LIMIT 1`,
            [deviceId, parentPath]
        );
        return mapRow(rows[0]);
    }

    async create(data) {
        const [result] = await this.pool.query(
            `INSERT INTO ${TABLE} (device_id, name, path, parent_path) VALUES (?,?,?,?)`,
            [data.deviceId, data.name, data.path, data.parentPath || '/']
        );
        return this.findById(result.insertId);
    }

    async deleteById(id) {
        const folder = await this.findById(id);
        await this.pool.query(`DELETE FROM ${TABLE} WHERE id = ?`, [id]);
        return folder;
    }
}

module.exports = { MysqlVirtualFolderRepository };
