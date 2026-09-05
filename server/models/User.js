const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
        trim: true,
        default: 'User'
    },
    email: {
        type: String,
        required: true,
        unique: true,
        lowercase: true,
        trim: true,
        index: true
    },
    passwordHash: {
        type: String,
        default: ''
    },
    role: {
        type: String,
        enum: ['admin', 'user'],
        default: 'user'
    },
    provider: {
        type: String,
        enum: ['local', 'google'],
        default: 'local'
    },
    googleId: {
        type: String,
        default: ''
    },
    avatarUrl: {
        type: String,
        default: ''
    },
    emailVerified: {
        type: Boolean,
        default: false
    },
    authTokenHash: {
        type: String,
        default: ''
    },
    pairingToken: {
        type: String,
        unique: true,
        sparse: true
    },
    pairingUserId: {
        type: String,
        unique: true,
        sparse: true
    },
    lastLoginAt: {
        type: Date,
        default: null
    },
    passwordResetOtpHash: {
        type: String,
        default: ''
    },
    passwordResetOtpExpiresAt: {
        type: Date,
        default: null
    },
    adminPinHash: {
        type: String,
        default: ''
    }
}, {
    timestamps: true
});

module.exports = mongoose.models.User || mongoose.model('User', UserSchema);
