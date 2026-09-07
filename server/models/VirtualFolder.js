const mongoose = require('mongoose');

const VirtualFolderSchema = new mongoose.Schema({
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
    path: {
        type: String,
        required: true,
        trim: true
    },
    parentPath: {
        type: String,
        default: '/',
        trim: true
    }
}, {
    timestamps: true
});

VirtualFolderSchema.index({ deviceId: 1, path: 1 }, { unique: true });
VirtualFolderSchema.index({ deviceId: 1, parentPath: 1 });

module.exports = mongoose.models.VirtualFolder || mongoose.model('VirtualFolder', VirtualFolderSchema);
