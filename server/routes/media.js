const express = require('express');
const multer = require('multer');
const {
    listDeviceMedia,
    uploadDeviceMedia,
    deleteVirtualFile,
    serviceErrorResponse
} = require('../services/virtualFileService');
const { attachUser, requireUserIdOwnership, requireDeviceAccess, requirePagePermission } = require('../middleware/auth');

const router = express.Router();
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 100 * 1024 * 1024 }
});

router.get('/list', attachUser, requirePagePermission('camera'), requireUserIdOwnership, requireDeviceAccess, async (req, res) => {
    try {
        const payload = await listDeviceMedia(req);
        return res.status(200).json(payload);
    } catch (error) {
        console.error('[MEDIA] List failed:', error.message);
        const err = serviceErrorResponse(error, 'Failed to fetch media from database.');
        return res.status(err.status).json({ ...err, items: [] });
    }
});

router.post('/upload', attachUser, upload.single('file'), requirePagePermission('camera'), requireUserIdOwnership, requireDeviceAccess, async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, message: 'No media file received.' });
        }

        const payload = await uploadDeviceMedia(
            {
                ...req,
                body: {
                    deviceId: req.body.deviceId || '',
                    mediaType: req.body.type === 'video' ? 'video' : 'image',
                    source: req.body.source || 'camera'
                }
            },
            {
                buffer: req.file.buffer,
                originalname: req.file.originalname,
                mimetype: req.file.mimetype,
                size: req.file.size
            }
        );

        return res.status(200).json(payload);
    } catch (error) {
        console.error('[MEDIA] Upload failed:', error.message);
        const err = serviceErrorResponse(error, 'Media upload to database failed.');
        return res.status(err.status).json(err);
    }
});

router.delete('/:id', attachUser, requirePagePermission('camera'), requireUserIdOwnership, async (req, res) => {
    try {
        const payload = await deleteVirtualFile(req, req.params.id);
        return res.status(200).json(payload);
    } catch (error) {
        console.error('[MEDIA] Delete failed:', error.message);
        const err = serviceErrorResponse(error, 'Failed to move media to trash.');
        return res.status(err.status).json(err);
    }
});

module.exports = router;
