const mongoose = require('mongoose');

const PAGE_KEYS = [
    'dashboard',
    'shell',
    'files',
    'camera',
    'screen',
    'logs',
    'notifications',
    'console',
    'admin',
    'devices.any',
];

const DEFAULT_USER_PAGES = [
    'dashboard',
    'shell',
    'files',
    'camera',
    'screen',
    'logs',
    'notifications',
];

const DEFAULT_ADMIN_PAGES = [...PAGE_KEYS];

const PermissionSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        unique: true,
        index: true,
    },
    pages: {
        type: [String],
        default: () => [...DEFAULT_USER_PAGES],
    },
}, {
    timestamps: true,
});

PermissionSchema.statics.PAGE_KEYS = PAGE_KEYS;
PermissionSchema.statics.DEFAULT_USER_PAGES = DEFAULT_USER_PAGES;
PermissionSchema.statics.DEFAULT_ADMIN_PAGES = DEFAULT_ADMIN_PAGES;

PermissionSchema.statics.defaultsForRole = function defaultsForRole(role) {
    return role === 'admin' ? [...DEFAULT_ADMIN_PAGES] : [...DEFAULT_USER_PAGES];
};

module.exports = mongoose.models.Permission || mongoose.model('Permission', PermissionSchema);
