const cloudinary = require('../config/cloudinary');
const VirtualFile = require('../models/VirtualFile');
const Device = require('../models/Device');
const { ensureDatabase, getFileRepository, getFolderRepository, isMysql, getMysqlAdapter } = require('../db/DatabaseFactory');

async function assertDeviceCloudinaryAllowed(deviceId) {
    if (!deviceId || deviceId === 'unknown-device') return;
    try {
        let device = null;
        if (isMysql()) {
            device = await getMysqlAdapter().findDeviceById(deviceId);
        } else {
            device = await Device.findOne({ deviceId }).lean();
        }
        if (device && device.cloudinaryEnabled === false) {
            const error = new Error(`Cloudinary storage upload is disabled for device "${deviceId}" by administrator.`);
            error.status = 403;
            throw error;
        }
    } catch (err) {
        if (err.status === 403) throw err;
    }
}

async function getRepos() {
    await ensureDatabase();
    return {
        files: getFileRepository(),
        folders: getFolderRepository()
    };
}

function getRequestUserId(req) {
    return String(req?.user?.id || req?.user?._id || '').trim();
}

function assertOwnedRecord(record, req, resourceName) {
    const userId = getRequestUserId(req);
    if (!record || !userId || String(record.userId || '') !== userId) {
        const error = new Error(`${resourceName} not found.`);
        error.status = 404;
        throw error;
    }
    return record;
}

function normalizeFolder(folder) {
    let value = String(folder || '/').trim().replace(/\\/g, '/');
    if (!value.startsWith('/')) value = `/${value}`;
    if (value.length > 1 && value.endsWith('/')) value = value.slice(0, -1);
    return value || '/';
}

function joinFolder(parentPath, name) {
    const parent = normalizeFolder(parentPath);
    const cleanName = String(name || '').trim().replace(/[/\\]/g, '');
    if (!cleanName) throw new Error('Folder name is required.');
    return parent === '/' ? `/${cleanName}` : `${parent}/${cleanName}`;
}

function formatSize(bytes) {
    if (!bytes || bytes <= 0) return '--';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function getBaseUrl(req) {
    if (req && typeof req.get === 'function' && req.protocol) {
        return `${req.protocol}://${req.get('host')}`;
    }
    const host = req?.headers?.get?.('host') || 'www.zenvora.abdullahtahir.me';
    const proto = req?.headers?.get?.('x-forwarded-proto') || 'http';
    return `${proto}://${host}`;
}

function uploadBufferToCloudinary(buffer, options) {
    return new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(options, (error, result) => {
            if (error) return reject(error);
            resolve(result);
        });
        stream.end(buffer);
    });
}

function detectResourceType(mimeType, fileName) {
    if (mimeType && mimeType.startsWith('video/')) return 'video';
    if (mimeType && mimeType.startsWith('image/')) return 'image';
    if (/\.(mp4|webm|mov|avi|mkv)$/i.test(fileName || '')) return 'video';
    if (/\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(fileName || '')) return 'image';
    return 'raw';
}

function serializeFile(doc, req) {
    const baseUrl = getBaseUrl(req);
    const folder = normalizeFolder(doc.virtualFolder);
    return {
        id: String(doc._id || doc.id),
        deviceId: doc.deviceId,
        name: doc.name,
        path: `${folder}/${doc.name}`,
        virtualPath: folder,
        kind: 'file',
        originalPath: doc.originalPath || '',
        url: doc.cloudinaryUrl,
        mimeType: doc.mimeType,
        fileType: doc.fileType || doc.resourceType || 'raw',
        pageType: doc.pageType || 'file',
        isDeleted: !!doc.isDeleted,
        size: doc.size,
        size_label: formatSize(doc.size),
        tags: doc.tags || [],
        shareEnabled: doc.shareEnabled,
        shareToken: doc.shareToken || null,
        shareUrl: doc.shareEnabled && doc.shareToken
            ? `${baseUrl}/api/virtual-files/share/${doc.shareToken}`
            : null,
        time: doc.createdAt ? new Date(doc.createdAt).toISOString() : null,
        createdAt: doc.createdAt,
        deletedAt: doc.deletedAt || null
    };
}

function serializeFolder(doc) {
    return {
        id: String(doc._id || doc.id),
        deviceId: doc.deviceId,
        name: doc.name,
        path: normalizeFolder(doc.path),
        virtualPath: normalizeFolder(doc.path),
        parentPath: normalizeFolder(doc.parentPath),
        kind: 'folder',
        size: 0,
        size_label: '--',
        time: doc.createdAt ? new Date(doc.createdAt).toISOString() : null
    };
}

function getQueryParam(req, key, fallback = '') {
    if (req?.query?.[key] !== undefined && req.query[key] !== null) {
        return String(req.query[key]);
    }
    if (typeof req?.nextUrl?.searchParams?.get === 'function') {
        return req.nextUrl.searchParams.get(key) || fallback;
    }
    if (typeof req?.searchParams?.get === 'function') {
        return req.searchParams.get(key) || fallback;
    }
    return fallback;
}

const DEFAULT_MEDIA_FOLDERS = [
    '/Screenshots',
    '/Screenshots/Camera',
    '/Screenshots/Screen',
    '/Recordings',
    '/Recordings/Camera',
    '/Recordings/Screen'
];

const QUICK_MEDIA_ROOTS = [
    { label: 'Screenshots', path: '/Screenshots' },
    { label: 'Screenshots / Camera', path: '/Screenshots/Camera' },
    { label: 'Screenshots / Screen', path: '/Screenshots/Screen' },
    { label: 'Recordings', path: '/Recordings' },
    { label: 'Recordings / Camera', path: '/Recordings/Camera' },
    { label: 'Recordings / Screen', path: '/Recordings/Screen' }
];

function resolveMediaVirtualFolder(source, mediaType) {
    const origin = String(source || 'camera').toLowerCase() === 'screen' ? 'Screen' : 'Camera';
    const category = mediaType === 'video' ? 'Recordings' : 'Screenshots';
    return `/${category}/${origin}`;
}

function mediaFoldersForSource(source) {
    if (String(source || '').toLowerCase() === 'screen') {
        return ['/Screenshots/Screen', '/Recordings/Screen'];
    }
    if (String(source || '').toLowerCase() === 'camera') {
        return ['/Screenshots/Camera', '/Recordings/Camera'];
    }
    return [
        '/Screenshots/Camera',
        '/Screenshots/Screen',
        '/Recordings/Camera',
        '/Recordings/Screen'
    ];
}

function serializeMediaItem(doc) {
    return {
        id: String(doc._id || doc.id),
        type: doc.fileType === 'video' || doc.resourceType === 'video' ? 'video' : 'image',
        url: doc.cloudinaryUrl,
        timestamp: doc.createdAt ? new Date(doc.createdAt).toISOString() : null,
        bytes: doc.size || 0,
        virtualFolder: doc.virtualFolder,
        name: doc.name,
        pageType: doc.pageType,
        fileType: doc.fileType || doc.resourceType,
        deviceId: doc.deviceId
    };
}

async function listDeviceMedia(req) {
    const { files } = await getRepos();
    const deviceId = getQueryParam(req, 'deviceId', '');
    const source = getQueryParam(req, 'source', '');

    if (!deviceId || deviceId === 'unknown-device') {
        const error = new Error('deviceId is required.');
        error.status = 400;
        throw error;
    }

    await ensureDefaultMediaFolders(deviceId);
    const folders = mediaFoldersForSource(source);
    const docs = await files.findInFolders(deviceId, folders, { limit: 80 });
    const items = docs
        .map(serializeMediaItem)
        .sort((a, b) => new Date(b.timestamp || 0).getTime() - new Date(a.timestamp || 0).getTime());

    return { success: true, deviceId, source: source || 'all', items };
}

async function uploadDeviceMedia(req, filePayload) {
    const { files } = await getRepos();

    if (!filePayload?.buffer) {
        const error = new Error('No media file received.');
        error.status = 400;
        throw error;
    }

    const body = req.body || {};
    const deviceId = String(body.deviceId || '');
    const mediaType = String(body.mediaType || body.type || 'image');
    const source = String(body.source || 'camera');

    if (!deviceId || deviceId === 'unknown-device') {
        const error = new Error('deviceId is required.');
        error.status = 400;
        throw error;
    }

    await assertDeviceCloudinaryAllowed(deviceId);

    const type = mediaType === 'video' ? 'video' : 'image';
    const pageType = String(source).toLowerCase() === 'screen' ? 'screen' : 'camera';
    const virtualFolder = resolveMediaVirtualFolder(source, type);
    const userId = req?.user?.id || req?.user?._id || null;
    await ensureVirtualFolderPath(deviceId, virtualFolder, userId);

    const cloudFolder = `zenvora/${deviceId}/${type}s`;
    const fileName = filePayload.originalname || `${type}_${Date.now()}`;

    const result = await uploadBufferToCloudinary(filePayload.buffer, {
        folder: cloudFolder,
        resource_type: type,
        public_id: `${type}_${Date.now()}`,
        overwrite: false
    });

    const tags = [pageType, type === 'video' ? 'recording' : 'screenshot'];

    const doc = await files.create({
        deviceId,
        userId: req?.user?.id || req?.user?._id || null,
        name: fileName,
        originalPath: '',
        virtualFolder,
        cloudinaryUrl: result.secure_url,
        cloudinaryPublicId: result.public_id,
        resourceType: type,
        fileType: type,
        pageType,
        mimeType: filePayload.mimetype || (type === 'video' ? 'video/webm' : 'image/jpeg'),
        size: filePayload.size || result.bytes || 0,
        tags,
        isDeleted: false
    });

    const item = serializeMediaItem(doc);

    return {
        success: true,
        url: result.secure_url,
        publicId: result.public_id,
        resourceType: result.resource_type,
        bytes: result.bytes,
        virtualFolder,
        virtualFileId: item.id,
        item,
        name: fileName,
        pageType,
        fileType: type
    };
}

async function ensureVirtualFolderPath(deviceId, targetPath, userId = null) {
    const { folders } = await getRepos();
    const normalized = normalizeFolder(targetPath);
    if (normalized === '/') return normalized;

    const segments = normalized.split('/').filter(Boolean);
    let parentPath = '/';

    for (const segment of segments) {
        const path = parentPath === '/' ? `/${segment}` : `${parentPath}/${segment}`;
        const existing = await folders.findOneByPath(deviceId, path);
        if (!existing) {
            await folders.create({
                deviceId,
                userId,
                name: segment,
                path,
                parentPath
            });
        }
        parentPath = path;
    }

    return normalized;
}

async function ensureDefaultMediaFolders(deviceId, userId = null) {
    for (const path of DEFAULT_MEDIA_FOLDERS) {
        await ensureVirtualFolderPath(deviceId, path, userId);
    }
}

async function browseVirtualFolder(req) {
    const { files, folders } = await getRepos();
    const deviceId = getQueryParam(req, 'deviceId', 'unknown-device');
    const folder = normalizeFolder(getQueryParam(req, 'folder', '/'));

    await ensureDefaultMediaFolders(deviceId);

    const [folderDocs, fileDocs] = await Promise.all([
        folders.findByParent(deviceId, folder),
        files.findByFolder(deviceId, folder)
    ]);

    const items = [
        ...folderDocs.map(serializeFolder),
        ...fileDocs.map((doc) => serializeFile(doc, req))
    ];

    return { success: true, deviceId, folder, items, quickRoots: QUICK_MEDIA_ROOTS };
}

async function listVirtualFolders(req) {
    const { folders } = await getRepos();
    const deviceId = getQueryParam(req, 'deviceId', 'unknown-device');
    await ensureDefaultMediaFolders(deviceId);
    const folderDocs = await folders.findAll(deviceId);

    const paths = [
        { label: 'Cloud Drive (root)', value: '/' },
        ...QUICK_MEDIA_ROOTS.map((root) => ({ label: root.label, value: root.path })),
        ...folderDocs
            .filter((f) => !DEFAULT_MEDIA_FOLDERS.includes(normalizeFolder(f.path)))
            .map((f) => {
                const path = normalizeFolder(f.path);
                const depth = path === '/' ? 0 : path.split('/').filter(Boolean).length;
                const indent = depth > 1 ? `${'  '.repeat(depth - 1)}└ ` : depth === 1 ? '' : '';
                return {
                    label: `${indent}${f.name || path.split('/').pop() || path} (${path})`,
                    value: path
                };
            })
    ];

    return { success: true, deviceId, folders: paths, quickRoots: QUICK_MEDIA_ROOTS };
}

async function listTrashItems(req) {
    const { files } = await getRepos();
    const deviceId = getQueryParam(req, 'deviceId', 'unknown-device');
    const docs = await files.findTrash(deviceId);
    return {
        success: true,
        deviceId,
        folder: '/.Trash',
        items: docs.map((doc) => serializeFile(doc, req))
    };
}

async function createVirtualFolder(reqOrBody) {
    const { folders } = await getRepos();
    const body = reqOrBody?.body || reqOrBody || {};
    const deviceId = String(body.deviceId || 'unknown-device');
    const parentPath = normalizeFolder(body.parentPath || '/');
    const name = String(body.name || '').trim();
    const userId = reqOrBody?.user?.id || reqOrBody?.user?._id || body?.userId || null;

    if (!name) {
        const error = new Error('Folder name is required.');
        error.status = 400;
        throw error;
    }

    const path = joinFolder(parentPath, name);
    const existing = await folders.findOneByPath(deviceId, path);
    if (existing) {
        const error = new Error('Folder already exists.');
        error.status = 400;
        throw error;
    }

    const doc = await folders.create({
        deviceId,
        userId,
        name,
        path,
        parentPath
    });
    return { success: true, item: serializeFolder(doc) };
}

async function uploadVirtualFile(req, filePayload) {
    const { files } = await getRepos();

    if (!filePayload?.buffer) {
        const error = new Error('No file received.');
        error.status = 400;
        throw error;
    }

    const body = req.body || {};
    const deviceId = String(body.deviceId || 'unknown-device');
    const virtualFolder = normalizeFolder(body.virtualFolder || '/');
    const originalPath = String(body.originalPath || '');
    const resourceType = detectResourceType(filePayload.mimetype, filePayload.originalname);
    const pageType = String(body.pageType || 'file').toLowerCase();
    const folder = `zenvora/${deviceId}/virtual${virtualFolder === '/' ? '' : virtualFolder}`;
    const userId = req?.user?.id || req?.user?._id || null;

    await ensureVirtualFolderPath(deviceId, virtualFolder, userId);
    await assertDeviceCloudinaryAllowed(deviceId);

    const result = await uploadBufferToCloudinary(filePayload.buffer, {
        folder,
        resource_type: resourceType,
        public_id: `${resourceType}_${Date.now()}`,
        overwrite: false
    });

    const doc = await files.create({
        deviceId,
        userId: req?.user?.id || req?.user?._id || null,
        name: filePayload.originalname,
        originalPath,
        virtualFolder,
        cloudinaryUrl: result.secure_url,
        cloudinaryPublicId: result.public_id,
        resourceType,
        fileType: resourceType,
        pageType: ['camera', 'screen'].includes(pageType) ? pageType : 'file',
        mimeType: filePayload.mimetype || 'application/octet-stream',
        size: filePayload.size,
        isDeleted: false
    });

    return { success: true, item: serializeFile(doc, req) };
}

async function renameVirtualFile(req, id, body) {
    const { files } = await getRepos();
    const name = String(body.name || '').trim();
    if (!name) {
        const error = new Error('Name is required.');
        error.status = 400;
        throw error;
    }

    const existing = await files.findById(id);
    assertOwnedRecord(existing, req, 'File');

    const doc = await files.updateById(id, { name });
    if (!doc) {
        const error = new Error('File not found.');
        error.status = 404;
        throw error;
    }

    return { success: true, item: serializeFile(doc, req) };
}

async function moveVirtualFile(req, id, body) {
    const { files } = await getRepos();
    const virtualFolder = normalizeFolder(body.virtualFolder || '/');
    const existing = await files.findById(id);
    assertOwnedRecord(existing, req, 'File');

    const doc = await files.updateById(id, { virtualFolder });
    if (!doc) {
        const error = new Error('File not found.');
        error.status = 404;
        throw error;
    }

    return { success: true, item: serializeFile(doc, req) };
}

async function shareVirtualFile(req, id) {
    const { files } = await getRepos();
    const doc = await files.findById(id);
    assertOwnedRecord(doc, req, 'File');
    if (doc.isDeleted) {
        const error = new Error('File not found.');
        error.status = 404;
        throw error;
    }

    const shareToken = doc.shareToken || VirtualFile.createShareToken();
    const updated = await files.updateById(id, {
        shareToken,
        shareEnabled: true
    });

    return { success: true, item: serializeFile(updated, req) };
}

async function lookupShareToken(req, token) {
    const { files } = await getRepos();
    const doc = await files.findByShareToken(token);

    if (!doc) {
        const error = new Error('Share link expired or invalid.');
        error.status = 404;
        throw error;
    }

    return { success: true, item: serializeFile(doc, req) };
}

async function deleteVirtualFolder(req, id) {
    const { files, folders } = await getRepos();
    const folder = await folders.findById(id);
    assertOwnedRecord(folder, req, 'Folder');

    const path = normalizeFolder(folder.path);
    const [childFolder, childFile] = await Promise.all([
        folders.findChildFolder(folder.deviceId, path),
        files.findOneInFolder(folder.deviceId, path)
    ]);

    if (childFolder || childFile) {
        const error = new Error('Folder is not empty.');
        error.status = 400;
        throw error;
    }

    await folders.deleteById(folder._id || folder.id);
    return { success: true, id: String(folder._id || folder.id) };
}

async function deleteVirtualFile(req, id) {
    const { files } = await getRepos();
    const existing = await files.findById(id);
    assertOwnedRecord(existing, req, 'File');

    const doc = await files.softDeleteById(id);
    if (!doc) {
        const error = new Error('File not found.');
        error.status = 404;
        throw error;
    }

    return {
        success: true,
        id: String(doc._id || doc.id),
        softDeleted: true,
        item: serializeFile(doc, null)
    };
}

async function restoreVirtualFile(req, id) {
    const { files } = await getRepos();
    const existing = await files.findById(id);
    assertOwnedRecord(existing, req, 'File');

    const doc = await files.restoreById(id);
    if (!doc) {
        const error = new Error('File not found.');
        error.status = 404;
        throw error;
    }

    return { success: true, item: serializeFile(doc, req) };
}

async function purgeVirtualFile(req, id) {
    const { files } = await getRepos();
    const existing = await files.findById(id);
    assertOwnedRecord(existing, req, 'File');

    const doc = await files.purgeById(id);
    if (!doc) {
        const error = new Error('File not found.');
        error.status = 404;
        throw error;
    }

    try {
        await cloudinary.uploader.destroy(doc.cloudinaryPublicId, {
            resource_type: doc.resourceType || doc.fileType || 'raw'
        });
    } catch (cloudErr) {
        console.warn('[VIRTUAL-FILES] Cloudinary purge skipped:', cloudErr.message);
    }

    return { success: true, id: String(doc._id || doc.id), purged: true };
}

function serviceErrorResponse(error, fallbackMessage) {
    return {
        success: false,
        message: error.message || fallbackMessage,
        status: error.status || 500
    };
}

module.exports = {
    browseVirtualFolder,
    listVirtualFolders,
    listTrashItems,
    createVirtualFolder,
    uploadVirtualFile,
    renameVirtualFile,
    moveVirtualFile,
    shareVirtualFile,
    lookupShareToken,
    deleteVirtualFolder,
    deleteVirtualFile,
    restoreVirtualFile,
    purgeVirtualFile,
    ensureVirtualFolderPath,
    resolveMediaVirtualFolder,
    ensureDefaultMediaFolders,
    listDeviceMedia,
    uploadDeviceMedia,
    serializeMediaItem,
    serviceErrorResponse,
    QUICK_MEDIA_ROOTS
};
