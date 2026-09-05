const mongoose = require('mongoose');
const VirtualFolder = require('../../models/VirtualFolder');
const { BaseVirtualFolderRepository } = require('../BaseVirtualFolderRepository');
const { connectMongoose } = require('./connection');

class MongoVirtualFolderRepository extends BaseVirtualFolderRepository {
    async connect() {
        await connectMongoose();
    }

    async findByParent(deviceId, parentPath) {
        return VirtualFolder.find({ deviceId, parentPath }).sort({ name: 1 }).lean();
    }

    async findAll(deviceId) {
        return VirtualFolder.find({ deviceId }).sort({ path: 1 }).lean();
    }

    async findOneByPath(deviceId, path) {
        return VirtualFolder.findOne({ deviceId, path });
    }

    async findById(id) {
        return VirtualFolder.findById(id);
    }

    async findChildFolder(deviceId, parentPath) {
        return VirtualFolder.findOne({ deviceId, parentPath });
    }

    async create(data) {
        return VirtualFolder.create(data);
    }

    async deleteById(id) {
        return VirtualFolder.findByIdAndDelete(id);
    }
}

module.exports = { MongoVirtualFolderRepository };
