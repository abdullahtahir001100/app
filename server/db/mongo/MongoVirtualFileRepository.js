const mongoose = require('mongoose');
const VirtualFile = require('../../models/VirtualFile');
const { BaseVirtualFileRepository } = require('../BaseVirtualFileRepository');
const { connectMongoose } = require('./connection');

class MongoVirtualFileRepository extends BaseVirtualFileRepository {
    async connect() {
        await connectMongoose();
    }

    buildActiveFilter(includeDeleted = false) {
        return includeDeleted ? {} : { isDeleted: { $ne: true } };
    }

    async findByFolder(deviceId, folder, options = {}) {
        const filter = {
            deviceId,
            virtualFolder: folder,
            ...this.buildActiveFilter(options.includeDeleted)
        };
        return VirtualFile.find(filter).sort({ name: 1 }).limit(options.limit || 200).lean();
    }

    async findTrash(deviceId) {
        return VirtualFile.find({ deviceId, isDeleted: true })
            .sort({ deletedAt: -1, updatedAt: -1 })
            .limit(200)
            .lean();
    }

    async findById(id) {
        return VirtualFile.findById(id);
    }

    async findByShareToken(token) {
        return VirtualFile.findOne({
            shareToken: token,
            shareEnabled: true,
            isDeleted: { $ne: true }
        }).lean();
    }

    async findOneInFolder(deviceId, folder, options = {}) {
        return VirtualFile.findOne({
            deviceId,
            virtualFolder: folder,
            ...this.buildActiveFilter(options.includeDeleted)
        });
    }

    async findInFolders(deviceId, folders, options = {}) {
        return VirtualFile.find({
            deviceId,
            virtualFolder: { $in: folders },
            ...this.buildActiveFilter(options.includeDeleted)
        })
            .sort({ createdAt: -1 })
            .limit(options.limit || 80)
            .lean();
    }

    async create(data) {
        return VirtualFile.create(data);
    }

    async updateById(id, updates) {
        return VirtualFile.findByIdAndUpdate(id, updates, { new: true });
    }

    async softDeleteById(id) {
        return VirtualFile.findByIdAndUpdate(
            id,
            { isDeleted: true, deletedAt: new Date() },
            { new: true }
        );
    }

    async restoreById(id) {
        return VirtualFile.findByIdAndUpdate(
            id,
            { isDeleted: false, deletedAt: null },
            { new: true }
        );
    }

    async purgeById(id) {
        return VirtualFile.findByIdAndDelete(id);
    }
}

module.exports = { MongoVirtualFileRepository };
