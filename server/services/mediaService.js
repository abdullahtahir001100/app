const cloudinary = require('../config/cloudinary');
const { ensureDatabase, getFileRepository } = require('../db/DatabaseFactory');
const {
    ensureVirtualFolderPath,
    resolveMediaVirtualFolder
} = require('./virtualFileService');

function uploadBufferToCloudinary(buffer, options) {
    return new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(options, (error, result) => {
            if (error) return reject(error);
            resolve(result);
        });
        stream.end(buffer);
    });
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

async function listMediaFromDb(deviceId, source) {
    await ensureDatabase();
    const files = getFileRepository();
    const folders = mediaFoldersForSource(source);
    const docs = await files.findInFolders(deviceId, folders, { limit: 80 });

    return docs.map((doc) => ({
        id: String(doc._id || doc.id),
        type: doc.fileType === 'video' || doc.resourceType === 'video' ? 'video' : 'image',
        url: doc.cloudinaryUrl,
        timestamp: doc.createdAt ? new Date(doc.createdAt).toISOString() : null,
        bytes: doc.size || 0,
        virtualFolder: doc.virtualFolder,
        name: doc.name,
        pageType: doc.pageType,
        fileType: doc.fileType || doc.resourceType
    }));
}

async function listMediaAssets(deviceId, source) {
    const dbItems = await listMediaFromDb(deviceId, source);
    return dbItems.sort(
        (a, b) => new Date(b.timestamp || 0).getTime() - new Date(a.timestamp || 0).getTime()
    );
}

async function uploadMediaAsset(payload) {
    await ensureDatabase();
    const files = getFileRepository();
    const {
        buffer,
        originalname,
        mimetype,
        size,
        deviceId = 'unknown-device',
        mediaType = 'image',
        source = 'camera'
    } = payload;

    if (!buffer) {
        const error = new Error('No media file received.');
        error.status = 400;
        throw error;
    }

    const type = mediaType === 'video' ? 'video' : 'image';
    const pageType = String(source || 'camera').toLowerCase() === 'screen' ? 'screen' : 'camera';
    const virtualFolder = resolveMediaVirtualFolder(source, type);
    await ensureVirtualFolderPath(deviceId, virtualFolder);

    const cloudFolder = `zenvora/${deviceId}/${type}s`;
    const fileName = originalname || `${type}_${Date.now()}`;

    const result = await uploadBufferToCloudinary(buffer, {
        folder: cloudFolder,
        resource_type: type,
        public_id: `${type}_${Date.now()}`,
        overwrite: false
    });

    const tags = [
        pageType,
        type === 'video' ? 'recording' : 'screenshot'
    ];

    const doc = await files.create({
        deviceId,
        name: fileName,
        originalPath: '',
        virtualFolder,
        cloudinaryUrl: result.secure_url,
        cloudinaryPublicId: result.public_id,
        resourceType: type,
        fileType: type,
        pageType,
        mimeType: mimetype || (type === 'video' ? 'video/webm' : 'image/jpeg'),
        size: size || result.bytes || 0,
        tags,
        isDeleted: false
    });

    return {
        success: true,
        url: result.secure_url,
        publicId: result.public_id,
        resourceType: result.resource_type,
        bytes: result.bytes,
        virtualFolder,
        virtualFileId: String(doc._id || doc.id),
        name: fileName,
        pageType,
        fileType: type
    };
}

function serviceErrorResponse(error, fallbackMessage) {
    return {
        success: false,
        message: error.message || fallbackMessage,
        status: error.status || 500
    };
}

module.exports = {
    listMediaAssets,
    uploadMediaAsset,
    serviceErrorResponse
};
