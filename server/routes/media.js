const express = require('express');
const multer = require('multer');
const {
    listDeviceMedia,
    uploadDeviceMedia,
    deleteVirtualFile,
    serviceErrorResponse
} = require('../services/virtualFileService');
const { attachUser, requireUserIdOwnership, requireDeviceAccess, requirePagePermission } = require('../middleware/auth');
const { logMsg, msgText, Z } = require('../utils/messages');

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
        logMsg(Z.LOAD_FAILED, error.message);
        const err = serviceErrorResponse(error, msgText(Z.LOAD_FAILED));
        return res.status(err.status).json({ ...err, code: Z.LOAD_FAILED, items: [] });
    }
});

router.post('/upload', attachUser, upload.single('file'), requirePagePermission('camera'), requireUserIdOwnership, requireDeviceAccess, async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, code: Z.FILE_FAILED, message: msgText(Z.FILE_FAILED, 'No media file received') });
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
        logMsg(Z.FILE_FAILED, error.message);
        const err = serviceErrorResponse(error, msgText(Z.FILE_FAILED));
        return res.status(err.status).json({ ...err, code: Z.FILE_FAILED });
    }
});

router.delete('/:id', attachUser, requirePagePermission('camera'), requireUserIdOwnership, async (req, res) => {
    try {
        const payload = await deleteVirtualFile(req, req.params.id);
        return res.status(200).json(payload);
    } catch (error) {
        logMsg(Z.FILE_FAILED, error.message);
        const err = serviceErrorResponse(error, msgText(Z.FILE_FAILED));
        return res.status(err.status).json({ ...err, code: Z.FILE_FAILED });
    }
});

module.exports = router;
