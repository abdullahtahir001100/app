const mongoose = require('mongoose');

const CallLogSchema = new mongoose.Schema({
    deviceId: { type: String, required: true, index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    number: { type: String, default: '' },
    name: { type: String, default: '' },
    type: { type: Number, default: 0 },
    duration: { type: Number, default: 0 },
    timestamp: { type: Date, required: true, index: true }
}, { timestamps: true });

CallLogSchema.index({ deviceId: 1, timestamp: -1 });
CallLogSchema.index({ userId: 1, deviceId: 1, timestamp: -1 });

module.exports = mongoose.models.CallLog || mongoose.model('CallLog', CallLogSchema);
