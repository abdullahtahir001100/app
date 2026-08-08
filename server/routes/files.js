const express = require('express');
const { getConnectionRegistry } = require('../sockets/registry');
const { execFileCommand, FILE_ACTION_TOKENS } = require('../sockets/fileHandler');
const { attachUser, requireUserIdOwnership, requireDeviceAccess, requirePagePermission } = require('../middleware/auth');

const router = express.Router();

router.post('/exec', attachUser, requirePagePermission('files'), requireUserIdOwnership, requireDeviceAccess, async (req, res) => {
    try {
        const action = String(req.body?.action || '');
        const targetDeviceId = String(req.body?.targetDeviceId || '');
        const payload = req.body?.payload && typeof req.body.payload === 'object'
            ? req.body.payload
            : {};

        if (!FILE_ACTION_TOKENS.includes(action)) {
            return res.status(400).json({
                success: false,
                message: `Unsupported file action: ${action}`
            });
        }

        if (!targetDeviceId) {
            return res.status(400).json({
                success: false,
                message: 'targetDeviceId is required.'
            });
        }

        getConnectionRegistry();
        const packet = await execFileCommand(action, targetDeviceId, payload);

        const fileResult = packet.file_result || {};
        if (fileResult.error) {
            return res.status(400).json({
                success: false,
                message: String(fileResult.error),
                action: packet.last_action || action,
                file_result: fileResult
            });
        }

        return res.status(200).json({
            success: true,
            action: packet.last_action || action,
            status: packet.status || 'OK',
            message: packet.message || null,
            file_result: fileResult
        });
    } catch (error) {
        console.error('[FILES API]', error.message);
        return res.status(error.message?.includes('offline') ? 503 : 504).json({
            success: false,
            message: error.message || 'File operation failed.'
        });
    }
});

module.exports = router;
