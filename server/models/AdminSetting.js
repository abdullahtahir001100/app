const mongoose = require('mongoose');

const AdminSettingSchema = new mongoose.Schema(
    {
        key: {
            type: String,
            required: true,
            unique: true,
            trim: true,
            index: true,
        },
        value: {
            type: mongoose.Schema.Types.Mixed,
            default: null,
        },
    },
    {
        timestamps: true,
    }
);

module.exports =
    mongoose.models.AdminSetting ||
    mongoose.model('AdminSetting', AdminSettingSchema);
