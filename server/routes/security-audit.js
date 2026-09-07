const express = require('express');
const { attachUser } = require('../middleware/auth');
const { createAuditLogger } = require('../sockets/abuseControl');

const router = express.Router();
const auditLogger = createAuditLogger();

router.get('/audit', attachUser, async (req, res) => {
    res.status(200).json({ success: true, events: auditLogger.getRecent(100) });
});

module.exports = router;
