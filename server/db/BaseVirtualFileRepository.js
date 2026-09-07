class BaseVirtualFileRepository {
    async connect() {
        throw new Error('connect() not implemented');
    }

    async findByFolder(_deviceId, _folder, _options = {}) {
        throw new Error('findByFolder() not implemented');
    }

    async findTrash(_deviceId) {
        throw new Error('findTrash() not implemented');
    }

    async findById(_id) {
        throw new Error('findById() not implemented');
    }

    async findByShareToken(_token) {
        throw new Error('findByShareToken() not implemented');
    }

    async findOneInFolder(_deviceId, _folder) {
        throw new Error('findOneInFolder() not implemented');
    }

    async create(_data) {
        throw new Error('create() not implemented');
    }

    async updateById(_id, _updates) {
        throw new Error('updateById() not implemented');
    }

    async softDeleteById(_id) {
        throw new Error('softDeleteById() not implemented');
    }

    async restoreById(_id) {
        throw new Error('restoreById() not implemented');
    }

    async purgeById(_id) {
        throw new Error('purgeById() not implemented');
    }
}

module.exports = { BaseVirtualFileRepository };
