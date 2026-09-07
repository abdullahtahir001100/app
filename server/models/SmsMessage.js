const mongoose = require('mongoose');

const SmsMessageSchema = new mongoose.Schema({
    deviceId: { type: String, required: true, index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    address: { type: String, default: '' },
    body: { type: String, default: '' },
    type: { type: Number, default: 0 },
    timestamp: { type: Date, required: true, index: true },
    read: { type: Boolean, default: false }
}, { timestamps: true });

SmsMessageSchema.index({ deviceId: 1, timestamp: -1 });
SmsMessageSchema.index({ userId: 1, deviceId: 1, timestamp: -1 });

module.exports = mongoose.models.SmsMessage || mongoose.model('SmsMessage', SmsMessageSchema);
