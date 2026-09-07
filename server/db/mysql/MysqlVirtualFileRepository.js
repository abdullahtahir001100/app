const { BaseVirtualFileRepository } = require('../BaseVirtualFileRepository');

const TABLE = 'virtual_files';

const CREATE_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS ${TABLE} (
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
    INDEX idx_vf_device_folder (device_id, virtual_folder),
    INDEX idx_vf_device_deleted (device_id, is_deleted)
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
        originalPath: row.original_path,
        virtualFolder: row.virtual_folder,
        cloudinaryUrl: row.cloudinary_url,
        cloudinaryPublicId: row.cloudinary_public_id,
        resourceType: row.resource_type,
        fileType: row.file_type,
        pageType: row.page_type,
        mimeType: row.mime_type,
        size: Number(row.size || 0),
        tags: typeof row.tags === 'string' ? JSON.parse(row.tags || '[]') : row.tags || [],
        shareEnabled: !!row.share_enabled,
        shareToken: row.share_token,
        isDeleted: !!row.is_deleted,
        deletedAt: row.deleted_at,
        createdAt: row.created_at,
        updatedAt: row.updated_at
    };
}

class MysqlVirtualFileRepository extends BaseVirtualFileRepository {
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

    async findByFolder(deviceId, folder, options = {}) {
        const includeDeleted = options.includeDeleted ? '' : 'AND is_deleted = 0';
        const [rows] = await this.pool.query(
            `SELECT * FROM ${TABLE} WHERE device_id = ? AND virtual_folder = ? ${includeDeleted} ORDER BY name ASC LIMIT ?`,
            [deviceId, folder, options.limit || 200]
        );
        return rows.map(mapRow);
    }

    async findTrash(deviceId) {
        const [rows] = await this.pool.query(
            `SELECT * FROM ${TABLE} WHERE device_id = ? AND is_deleted = 1 ORDER BY deleted_at DESC, updated_at DESC LIMIT 200`,
            [deviceId]
        );
        return rows.map(mapRow);
    }

    async findById(id) {
        const [rows] = await this.pool.query(`SELECT * FROM ${TABLE} WHERE id = ?`, [id]);
        return mapRow(rows[0]);
    }

    async findByShareToken(token) {
        const [rows] = await this.pool.query(
            `SELECT * FROM ${TABLE} WHERE share_token = ? AND share_enabled = 1 AND is_deleted = 0 LIMIT 1`,
            [token]
        );
        return mapRow(rows[0]);
    }

    async findOneInFolder(deviceId, folder, options = {}) {
        const includeDeleted = options.includeDeleted ? '' : 'AND is_deleted = 0';
        const [rows] = await this.pool.query(
            `SELECT * FROM ${TABLE} WHERE device_id = ? AND virtual_folder = ? ${includeDeleted} LIMIT 1`,
            [deviceId, folder]
        );
        return mapRow(rows[0]);
    }

    async findInFolders(deviceId, folders, options = {}) {
        if (!folders.length) return [];
        const includeDeleted = options.includeDeleted ? '' : 'AND is_deleted = 0';
        const placeholders = folders.map(() => '?').join(',');
        const [rows] = await this.pool.query(
            `SELECT * FROM ${TABLE} WHERE device_id = ? AND virtual_folder IN (${placeholders}) ${includeDeleted} ORDER BY created_at DESC LIMIT ?`,
            [deviceId, ...folders, options.limit || 80]
        );
        return rows.map(mapRow);
    }

    async create(data) {
        const [result] = await this.pool.query(
            `INSERT INTO ${TABLE}
            (device_id, name, original_path, virtual_folder, cloudinary_url, cloudinary_public_id, resource_type, file_type, page_type, mime_type, size, tags, share_enabled, share_token, is_deleted)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,0)`,
            [
                data.deviceId,
                data.name,
                data.originalPath || '',
                data.virtualFolder || '/',
                data.cloudinaryUrl,
                data.cloudinaryPublicId,
                data.resourceType || 'raw',
                data.fileType || data.resourceType || 'raw',
                data.pageType || 'file',
                data.mimeType || 'application/octet-stream',
                data.size || 0,
                JSON.stringify(data.tags || []),
                data.shareEnabled ? 1 : 0,
                data.shareToken || null
            ]
        );
        return this.findById(result.insertId);
    }

    async updateById(id, updates) {
        const map = {
            name: 'name',
            virtualFolder: 'virtual_folder',
            shareEnabled: 'share_enabled',
            shareToken: 'share_token'
        };
        const sets = [];
        const values = [];
        for (const [key, column] of Object.entries(map)) {
            if (updates[key] !== undefined) {
                sets.push(`${column} = ?`);
                values.push(key === 'shareEnabled' ? (updates[key] ? 1 : 0) : updates[key]);
            }
        }
        if (!sets.length) return this.findById(id);
        values.push(id);
        await this.pool.query(`UPDATE ${TABLE} SET ${sets.join(', ')} WHERE id = ?`, values);
        return this.findById(id);
    }

    async softDeleteById(id) {
        await this.pool.query(
            `UPDATE ${TABLE} SET is_deleted = 1, deleted_at = NOW() WHERE id = ?`,
            [id]
        );
        return this.findById(id);
    }

    async restoreById(id) {
        await this.pool.query(
            `UPDATE ${TABLE} SET is_deleted = 0, deleted_at = NULL WHERE id = ?`,
            [id]
        );
        return this.findById(id);
    }

    async purgeById(id) {
        const doc = await this.findById(id);
        await this.pool.query(`DELETE FROM ${TABLE} WHERE id = ?`, [id]);
        return doc;
    }
}

module.exports = { MysqlVirtualFileRepository };
