const mongoose = require('mongoose');

const ContactSchema = new mongoose.Schema({
    deviceId: { type: String, required: true, index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    name: { type: String, default: '' },
    phone: { type: String, default: '' }
}, { timestamps: true });

ContactSchema.index({ deviceId: 1, phone: 1, name: 1 });
ContactSchema.index({ userId: 1, deviceId: 1, name: 1 });

module.exports = mongoose.models.Contact || mongoose.model('Contact', ContactSchema);
