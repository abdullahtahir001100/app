const mongoose = require('mongoose');

const AgentCredentialSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    deviceId: {
        type: String,
        required: true,
        unique: true,
        trim: true
    },
    label: {
        type: String,
        default: 'My Agent',
        trim: true
    },
    tokenHash: {
        type: String,
        required: true
    },
    lastConnectedAt: {
        type: Date,
        default: null
    }
}, {
    timestamps: true
});

AgentCredentialSchema.index({ userId: 1, deviceId: 1 });

module.exports = mongoose.models.AgentCredential
    || mongoose.model('AgentCredential', AgentCredentialSchema);
