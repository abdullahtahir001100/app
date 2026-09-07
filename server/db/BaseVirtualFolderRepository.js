class BaseVirtualFolderRepository {
    async connect() {
        throw new Error('connect() not implemented');
    }

    async findByParent(_deviceId, _parentPath) {
        throw new Error('findByParent() not implemented');
    }

    async findAll(_deviceId) {
        throw new Error('findAll() not implemented');
    }

    async findOneByPath(_deviceId, _path) {
        throw new Error('findOneByPath() not implemented');
    }

    async findById(_id) {
        throw new Error('findById() not implemented');
    }

    async findChildFolder(_deviceId, _parentPath) {
        throw new Error('findChildFolder() not implemented');
    }

    async create(_data) {
        throw new Error('create() not implemented');
    }

    async deleteById(_id) {
        throw new Error('deleteById() not implemented');
    }
}

module.exports = { BaseVirtualFolderRepository };
