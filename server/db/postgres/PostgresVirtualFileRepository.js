const { BaseVirtualFileRepository } = require('../BaseVirtualFileRepository');

const TABLE = 'virtual_files';

const CREATE_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS ${TABLE} (
    id SERIAL PRIMARY KEY,
    device_id VARCHAR(255) NOT NULL,
    name VARCHAR(512) NOT NULL,
    original_path TEXT DEFAULT '',
    virtual_folder VARCHAR(1024) DEFAULT '/',
    cloudinary_url TEXT NOT NULL,
    cloudinary_public_id TEXT NOT NULL,
    resource_type VARCHAR(32) DEFAULT 'raw',
    file_type VARCHAR(32) DEFAULT 'raw',
    page_type VARCHAR(32) DEFAULT 'file',
    mime_type VARCHAR(255) DEFAULT 'application/octet-stream',
    size BIGINT DEFAULT 0,
    tags JSONB DEFAULT '[]',
    share_enabled BOOLEAN DEFAULT FALSE,
    share_token VARCHAR(128),
    is_deleted BOOLEAN DEFAULT FALSE,
    deleted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_vf_device_folder ON ${TABLE}(device_id, virtual_folder);
CREATE INDEX IF NOT EXISTS idx_vf_device_deleted ON ${TABLE}(device_id, is_deleted);
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
        originalPath: row.original_path,
        virtualFolder: row.virtual_folder,
        cloudinaryUrl: row.cloudinary_url,
        cloudinaryPublicId: row.cloudinary_public_id,
        resourceType: row.resource_type,
        fileType: row.file_type,
        pageType: row.page_type,
        mimeType: row.mime_type,
        size: Number(row.size || 0),
        tags: Array.isArray(row.tags) ? row.tags : [],
        shareEnabled: row.share_enabled,
        shareToken: row.share_token,
        isDeleted: row.is_deleted,
        deletedAt: row.deleted_at,
        createdAt: row.created_at,
        updatedAt: row.updated_at
    };
}

class PostgresVirtualFileRepository extends BaseVirtualFileRepository {
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

    async findByFolder(deviceId, folder, options = {}) {
        const includeDeleted = options.includeDeleted ? '' : 'AND is_deleted = FALSE';
        const { rows } = await this.pool.query(
            `SELECT * FROM ${TABLE} WHERE device_id = $1 AND virtual_folder = $2 ${includeDeleted} ORDER BY name ASC LIMIT $3`,
            [deviceId, folder, options.limit || 200]
        );
        return rows.map(mapRow);
    }

    async findTrash(deviceId) {
        const { rows } = await this.pool.query(
            `SELECT * FROM ${TABLE} WHERE device_id = $1 AND is_deleted = TRUE ORDER BY deleted_at DESC NULLS LAST, updated_at DESC LIMIT 200`,
            [deviceId]
        );
        return rows.map(mapRow);
    }

    async findById(id) {
        const { rows } = await this.pool.query(`SELECT * FROM ${TABLE} WHERE id = $1`, [id]);
        return mapRow(rows[0]);
    }

    async findByShareToken(token) {
        const { rows } = await this.pool.query(
            `SELECT * FROM ${TABLE} WHERE share_token = $1 AND share_enabled = TRUE AND is_deleted = FALSE LIMIT 1`,
            [token]
        );
        return mapRow(rows[0]);
    }

    async findOneInFolder(deviceId, folder, options = {}) {
        const includeDeleted = options.includeDeleted ? '' : 'AND is_deleted = FALSE';
        const { rows } = await this.pool.query(
            `SELECT * FROM ${TABLE} WHERE device_id = $1 AND virtual_folder = $2 ${includeDeleted} LIMIT 1`,
            [deviceId, folder]
        );
        return mapRow(rows[0]);
    }

    async findInFolders(deviceId, folders, options = {}) {
        const includeDeleted = options.includeDeleted ? '' : 'AND is_deleted = FALSE';
        const { rows } = await this.pool.query(
            `SELECT * FROM ${TABLE} WHERE device_id = $1 AND virtual_folder = ANY($2) ${includeDeleted} ORDER BY created_at DESC LIMIT $3`,
            [deviceId, folders, options.limit || 80]
        );
        return rows.map(mapRow);
    }

    async create(data) {
        const { rows } = await this.pool.query(
            `INSERT INTO ${TABLE}
            (device_id, name, original_path, virtual_folder, cloudinary_url, cloudinary_public_id, resource_type, file_type, page_type, mime_type, size, tags, share_enabled, share_token, is_deleted)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
            RETURNING *`,
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
                data.shareEnabled || false,
                data.shareToken || null,
                false
            ]
        );
        return mapRow(rows[0]);
    }

    async updateById(id, updates) {
        const fields = [];
        const values = [];
        let idx = 1;
        const map = {
            name: 'name',
            virtualFolder: 'virtual_folder',
            shareEnabled: 'share_enabled',
            shareToken: 'share_token'
        };
        for (const [key, column] of Object.entries(map)) {
            if (updates[key] !== undefined) {
                fields.push(`${column} = $${idx++}`);
                values.push(updates[key]);
            }
        }
        if (!fields.length) return this.findById(id);
        values.push(id);
        const { rows } = await this.pool.query(
            `UPDATE ${TABLE} SET ${fields.join(', ')}, updated_at = NOW() WHERE id = $${idx} RETURNING *`,
            values
        );
        return mapRow(rows[0]);
    }

    async softDeleteById(id) {
        const { rows } = await this.pool.query(
            `UPDATE ${TABLE} SET is_deleted = TRUE, deleted_at = NOW(), updated_at = NOW() WHERE id = $1 RETURNING *`,
            [id]
        );
        return mapRow(rows[0]);
    }

    async restoreById(id) {
        const { rows } = await this.pool.query(
            `UPDATE ${TABLE} SET is_deleted = FALSE, deleted_at = NULL, updated_at = NOW() WHERE id = $1 RETURNING *`,
            [id]
        );
        return mapRow(rows[0]);
    }

    async purgeById(id) {
        const { rows } = await this.pool.query(`DELETE FROM ${TABLE} WHERE id = $1 RETURNING *`, [id]);
        return mapRow(rows[0]);
    }
}

module.exports = { PostgresVirtualFileRepository };
