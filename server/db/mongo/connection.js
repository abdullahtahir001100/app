const mongoose = require('mongoose');
const dns = require('dns');

try {
    dns.setDefaultResultOrder('ipv4first');
    dns.setServers(['8.8.8.8', '1.1.1.1', '192.168.100.1']);
} catch (_) {}

function mongoDnsLookup(hostname, options, callback) {
    if (typeof options === 'function') {
        callback = options;
        options = {};
    }
    dns.resolve4(hostname, (err, addresses) => {
        if (!err && addresses && addresses.length > 0) {
            if (options && options.all) {
                return callback(null, addresses.map(addr => ({ address: addr, family: 4 })));
            }
            return callback(null, addresses[0], 4);
        }
        dns.lookup(hostname, options, callback);
    });
}

const MONGO_OPTIONS = {
    serverSelectionTimeoutMS: 15000,
    connectTimeoutMS: 15000,
    socketTimeoutMS: 45000,
    maxPoolSize: 10,
    lookup: mongoDnsLookup,
};

async function connectMongoose() {
    if (mongoose.connection.readyState === 1) {
        return mongoose.connection;
    }

    if (!process.env.MONGODB_URI) {
        throw new Error('MONGODB_URI is missing. Set it in your .env file.');
    }

    await mongoose.connect(process.env.MONGODB_URI, MONGO_OPTIONS);
    return mongoose.connection;
}

async function ensureMongooseConnected() {
    if (mongoose.connection.readyState === 1) {
        return mongoose.connection;
    }
    return connectMongoose();
}

function isMongooseConnected() {
    return mongoose.connection.readyState === 1;
}

async function disconnectMongoose() {
    if (mongoose.connection.readyState !== 0) {
        try {
            await mongoose.disconnect();
        } catch (_) {}
    }
}

module.exports = {
    connectMongoose,
    ensureMongooseConnected,
    isMongooseConnected,
    disconnectMongoose,
    MONGO_OPTIONS,
};
