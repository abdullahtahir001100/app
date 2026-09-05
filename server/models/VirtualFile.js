const mongoose = require('mongoose');
const crypto = require('crypto');

const VirtualFileSchema = new mongoose.Schema({
    deviceId: {
        type: String,
        required: true,
        trim: true,
        index: true
    },
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        default: null,
        index: true
    },
    name: {
        type: String,
        required: true,
        trim: true
    },
    originalPath: {
        type: String,
        default: ''
    },
    virtualFolder: {
        type: String,
        default: '/',
        trim: true
    },
    cloudinaryUrl: {
        type: String,
        required: true
    },
    cloudinaryPublicId: {
        type: String,
        required: true
    },
    resourceType: {
        type: String,
        enum: ['image', 'video', 'raw'],
        default: 'raw'
    },
    fileType: {
        type: String,
        enum: ['image', 'video', 'raw'],
        default: 'raw'
    },
    pageType: {
        type: String,
        enum: ['camera', 'screen', 'file'],
        default: 'file'
    },
    isDeleted: {
        type: Boolean,
        default: false,
        index: true
    },
    deletedAt: {
        type: Date,
        default: null
    },
    mimeType: {
        type: String,
        default: 'application/octet-stream'
    },
    size: {
        type: Number,
        default: 0
    },
    tags: {
        type: [String],
        default: []
    },
    shareEnabled: {
        type: Boolean,
        default: false
    },
    shareToken: {
        type: String,
        unique: true,
        sparse: true
    }
}, {
    timestamps: true
});

VirtualFileSchema.index({ deviceId: 1, virtualFolder: 1, name: 1 });
VirtualFileSchema.index({ deviceId: 1, isDeleted: 1 });

VirtualFileSchema.statics.createShareToken = function createShareToken() {
    return crypto.randomBytes(16).toString('hex');
};

module.exports = mongoose.models.VirtualFile || mongoose.model('VirtualFile', VirtualFileSchema);
