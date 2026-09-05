const mongoose = require('mongoose');

const NotificationSchema = new mongoose.Schema({
    deviceId: {
        type: String,
        index: true,
        trim: true
    },
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    app: {
        type: String,
        required: true,
        trim: true
    },
    title: {
        type: String,
        required: true,
        trim: true
    },
    message: {
        type: String,
        trim: true
    },
    icon: {
        type: String,
        trim: true
    },
    image: {
        type: String,
        trim: true
    },
    category: {
        type: String,
        trim: true
    },
    read: {
        type: Boolean,
        default: false
    },
    isDeleted: {
        type: Boolean,
        default: false,
        index: true
    }
}, {
    timestamps: true
});

NotificationSchema.index(
{
    deviceId:1,
    app:1,
    title:1,
    message:1
},
{
    unique:true
});

module.exports = mongoose.models.Notification || mongoose.model('Notification', NotificationSchema);
