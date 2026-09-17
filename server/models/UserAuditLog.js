const mongoose = require('mongoose');

const UserAuditLogSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        default: null,
        index: true
    },
    email: {
        type: String,
        required: true,
        lowercase: true,
        trim: true,
        index: true
    },
    eventType: {
        type: String,
        enum: [
            'login_success',
            'login_failure',
            'page_visit',
            'page_dwell',
            'logout',
            'account_blocked',
            'account_unblocked',
            'account_deleted'
        ],
        required: true,
        index: true
    },
    page: {
        type: String,
        default: ''
    },
    pageTitle: {
        type: String,
        default: ''
    },
    dwellSeconds: {
        type: Number,
        default: 0
    },
    ip: {
        type: String,
        default: ''
    },
    userAgent: {
        type: String,
        default: ''
    },
    status: {
        type: String,
        enum: ['success', 'failed', 'info', 'warning'],
        default: 'info'
    },
    reason: {
        type: String,
        default: ''
    },
    metadata: {
        type: mongoose.Schema.Types.Mixed,
        default: {}
    }
}, {
    timestamps: true
});

UserAuditLogSchema.index({ userId: 1, createdAt: -1 });
UserAuditLogSchema.index({ email: 1, createdAt: -1 });
UserAuditLogSchema.index({ eventType: 1, createdAt: -1 });

module.exports = mongoose.models.UserAuditLog || mongoose.model('UserAuditLog', UserAuditLogSchema);
