const mongoose = require('mongoose');

const DeviceSchema = new mongoose.Schema(
{
    deviceId: {
        type: String,
        required: true,
        unique: true,
        trim: true
    },

    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        default: null,
        index: true
    },

    platform: {
        type: String,
        enum: ['windows', 'mac', 'android', 'linux', 'unknown'],
        default: 'unknown'
    },

    status: {
        type: String,
        enum: ['online', 'offline'],
        default: 'offline'
    },

    clientPort: {
        type: Number,
        default: 8080
    },

    localIp: {
        type: String,
        default: ''
    },

    publicIp: {
        type: String,
        default: ''
    },

    battery: {
        type: Number,
        default: null,
        min: 0,
        max: 100
    },

    storage: {
        type: Number,
        default: null,
        min: 0,
        max: 100
    },

    network: {
        type: String,
        default: ''
    },

    latitude: {
        type: Number,
        default: null
    },

    longitude: {
        type: Number,
        default: null
    },

    country: {
        type: String,
        default: ''
    },

    region: {
        type: String,
        default: ''
    },

    city: {
        type: String,
        default: ''
    },

    isp: {
        type: String,
        default: ''
    },

    timezone: {
        type: String,
        default: ''
    },

    hostname: {
        type: String,
        default: ''
    },

    username: {
        type: String,
        default: ''
    },

    osVersion: {
        type: String,
        default: ''
    },

    architecture: {
        type: String,
        default: ''
    },

    cpu: {
        type: String,
        default: ''
    },

    ram: {
        type: Number,
        default: null
    },

    lastSeen: {
        type: Date,
        default: Date.now
    },

    lastAndroidBeatAt: {
        type: Date,
        default: null
    }
},
{
    timestamps: true
});

module.exports =
    mongoose.models.Device ||
    mongoose.model('Device', DeviceSchema);