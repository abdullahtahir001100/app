const mongoose = require('mongoose');

/**
 * First-class page / capability keys for ACL.
 * Keep in sync with auth-guard pathToPageKey + sidebar.
 */
const PAGE_KEYS = [
    'dashboard',
    'devices',
    'shell',
    'ops',
    'apps',
    'files',
    'camera',
    'screen',
    'fleet',
    'cockpit',
    'logs',
    'usage',
    'phone',
    'notifications',
    'console',
    'settings',
    'admin',
    'devices.any',
];

const PAGE_LABELS = {
    dashboard: 'Dashboard',
    devices: 'Devices',
    shell: 'Shell Control',
    ops: 'Agent Ops',
    apps: 'Install Apps',
    files: 'File Manager',
    camera: 'Camera Access',
    screen: 'Screen Monitor',
    fleet: 'Fleet Grid',
    cockpit: 'Cockpit',
    logs: 'Activity Logs',
    usage: 'Usage',
    phone: 'Phone',
    notifications: 'Notifications',
    console: 'Live Console',
    settings: 'Settings',
    admin: 'Admin',
    'devices.any': 'All devices (cross-user)',
};

const DEFAULT_USER_PAGES = [
    'dashboard',
    'devices',
    'shell',
    'ops',
    'apps',
    'files',
    'camera',
    'screen',
    'fleet',
    'cockpit',
    'logs',
    'usage',
    'phone',
    'notifications',
    'settings',
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
PermissionSchema.statics.PAGE_LABELS = PAGE_LABELS;
PermissionSchema.statics.DEFAULT_USER_PAGES = DEFAULT_USER_PAGES;
PermissionSchema.statics.DEFAULT_ADMIN_PAGES = DEFAULT_ADMIN_PAGES;

PermissionSchema.statics.defaultsForRole = function defaultsForRole(role) {
    return role === 'admin' ? [...DEFAULT_ADMIN_PAGES] : [...DEFAULT_USER_PAGES];
};

module.exports = mongoose.models.Permission || mongoose.model('Permission', PermissionSchema);
