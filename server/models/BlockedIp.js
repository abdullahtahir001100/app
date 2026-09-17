const mongoose = require('mongoose');

const BlockedIpSchema = new mongoose.Schema({
    ip: {
        type: String,
        required: true,
        unique: true,
        trim: true,
        index: true
    },
    reason: {
        type: String,
        default: 'Security violation / Suspicious activity',
        trim: true
    },
    blockedBy: {
        type: String,
        default: 'Security System',
        trim: true
    },
    attempts: {
        type: Number,
        default: 1
    },
    status: {
        type: String,
        enum: ['active', 'unblocked'],
        default: 'active',
        index: true
    },
    expiresAt: {
        type: Date,
        default: null
    }
}, {
    timestamps: true
});

module.exports = mongoose.models.BlockedIp || mongoose.model('BlockedIp', BlockedIpSchema);
