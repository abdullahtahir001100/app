const mongoose = require('mongoose');

const BrowserHistorySchema = new mongoose.Schema({
    deviceId: {
        type: String,
        required: true,
        index: true
    },
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    browser: {
        type: String,
        required: true,
        enum: ['Chrome', 'Edge', 'Firefox', 'Safari'],
        index: true
    },
    url: {
        type: String,
        required: true
    },
    title: {
        type: String,
        trim: true
    },
    visitTime: {
        type: Date,
        required: true,
        index: true
    },
    visitCount: {
        type: Number,
        default: 1
    },
    domain: {
        type: String
    },
    windowsUser: {
        type: String,
        default: '',
        index: true
    }
}, {
    timestamps: true
});

BrowserHistorySchema.index({ deviceId: 1, visitTime: -1 });
BrowserHistorySchema.index({ browser: 1, visitTime: -1 });

module.exports = mongoose.models.BrowserHistory || mongoose.model('BrowserHistory', BrowserHistorySchema);
