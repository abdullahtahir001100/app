const mongoose = require('mongoose');

/**
 * First-class page / capability keys for ACL.
 * - Core Free: 'dashboard', 'devices', 'settings'
 * - Premium Full Pages: 'camera', 'screen', 'files', 'shell', 'ops', 'apps', 'fleet', 'cockpit', 'notifications', 'console', 'architecture', 'usage'
 * - Granular Tab Add-ons:
 *   - Logs: 'logs' (all), 'logs.browser', 'logs.activity', 'logs.apps', 'logs.usage'
 *   - Phone: 'phone' (all), 'phone.calls', 'phone.sms', 'phone.contacts', 'phone.lock'
 * - Admin: 'admin', 'devices.any'
 */
const PAGE_KEYS = [
    // Core Free Pages
    'dashboard',
    'devices',
    'settings',

    // Premium Full Pages
    'camera',
    'screen',
    'files',
    'shell',
    'ops',
    'apps',
    'fleet',
    'cockpit',
    'notifications',
    'console',
    'architecture',
    'usage',

    // Activity Logs Suite & Granular Tabs
    'logs',
    'logs.browser',
    'logs.activity',
    'logs.apps',
    'logs.usage',

    // Phone Suite & Granular Tabs
    'phone',
    'phone.calls',
    'phone.sms',
    'phone.contacts',
    'phone.lock',

    // System Administration
    'admin',
    'devices.any',
];

const PAGE_LABELS = {
    dashboard: 'Dashboard (Free)',
    devices: 'Devices (Free)',
    settings: 'Settings (Free)',

    camera: 'Camera Access (Premium)',
    screen: 'Screen Monitor (Premium)',
    files: 'File Manager (Premium)',
    shell: 'Shell Control (Premium)',
    ops: 'Agent Ops (Premium)',
    apps: 'Install Apps (Premium)',
    fleet: 'Fleet Grid (Premium)',
    cockpit: 'Cockpit Control (Premium)',
    notifications: 'Notifications (Premium)',
    console: 'Live Console (Premium)',
    architecture: 'Architecture & Diagrams (Premium)',
    usage: 'Usage Metrics (Premium)',

    // Granular Logs Capabilities
    logs: 'Activity Logs Suite (All Tabs)',
    'logs.browser': 'Browser History Tab (Add-on)',
    'logs.activity': 'Activity Logs Tab (Add-on)',
    'logs.apps': 'App Usage Tab (Add-on)',
    'logs.usage': 'Usage Telemetry Tab (Add-on)',

    // Granular Phone Capabilities
    phone: 'Phone Suite (All Tabs)',
    'phone.calls': 'Call Logs Tab (Add-on)',
    'phone.sms': 'SMS Messages Tab (Add-on)',
    'phone.contacts': 'Contacts Tab (Add-on)',
    'phone.lock': 'Remote Device Lock Tab (Add-on)',

    admin: 'Admin Dashboard (Master)',
    'devices.any': 'All Devices Access (Cross-User)',
};

const DEFAULT_USER_PAGES = [
    'dashboard',
    'devices',
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
