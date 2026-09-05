const mongoose = require('mongoose');

const MONGO_OPTIONS = {
    serverSelectionTimeoutMS: 15000,
    connectTimeoutMS: 15000,
    socketTimeoutMS: 45000,
    maxPoolSize: 10,
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

module.exports = {
    connectMongoose,
    ensureMongooseConnected,
    isMongooseConnected,
    MONGO_OPTIONS,
};
