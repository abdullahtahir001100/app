const mongoose = require('mongoose');

const AppHistorySchema = new mongoose.Schema({
    deviceId: {
        type: String,
        required: true,
        index: true
    },
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    appName: {
        type: String,
        required: true
    },
    executablePath: {
        type: String,
        trim: true
    },
    lastOpened: {
        type: Date,
        required: true,
        index: true
    },
    appType: {
        type: String,
        enum: ['app', 'file', 'process'],
        default: 'app'
    },
    duration: {
        type: Number,
        default: 0 // in seconds
    },
    category: {
        type: String,
        trim: true
    },
    windowsUser: {
        type: String,
        default: '',
        index: true
    }
}, {
    timestamps: true
});

AppHistorySchema.index({ deviceId: 1, lastOpened: -1 });
AppHistorySchema.index({ appType: 1, lastOpened: -1 });
AppHistorySchema.index({
    deviceId: 1,
    userId: 1,
    appName: 1,
    executablePath: 1,
    lastOpened: 1,
    windowsUser: 1
});

module.exports = mongoose.models.AppHistory || mongoose.model('AppHistory', AppHistorySchema);
