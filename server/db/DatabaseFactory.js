const { MongoVirtualFileRepository } = require('./mongo/MongoVirtualFileRepository');
const { MongoVirtualFolderRepository } = require('./mongo/MongoVirtualFolderRepository');
const { PostgresVirtualFileRepository } = require('./postgres/PostgresVirtualFileRepository');
const { PostgresVirtualFolderRepository } = require('./postgres/PostgresVirtualFolderRepository');
const { MysqlVirtualFileRepository } = require('./mysql/MysqlVirtualFileRepository');
const { MysqlVirtualFolderRepository } = require('./mysql/MysqlVirtualFolderRepository');

function resolveProvider() {
    if (process.env.DATABASE_PROVIDER) {
        return String(process.env.DATABASE_PROVIDER).trim().toLowerCase();
    }
    if (process.env.MONGODB_URI) return 'mongo';
    if (process.env.POSTGRES_URL || process.env.DATABASE_URL?.includes('postgres')) return 'postgres';
    if (process.env.MYSQL_URL || process.env.DATABASE_URL?.includes('mysql')) return 'mysql';
    return 'mongo';
}

let fileRepository = null;
let folderRepository = null;
let activeProvider = null;
let connectPromise = null;

function createRepositories(provider) {
    switch (provider) {
        case 'postgres':
            return {
                fileRepository: new PostgresVirtualFileRepository(),
                folderRepository: new PostgresVirtualFolderRepository()
            };
        case 'mysql':
            return {
                fileRepository: new MysqlVirtualFileRepository(),
                folderRepository: new MysqlVirtualFolderRepository()
            };
        case 'mongo':
        default:
            return {
                fileRepository: new MongoVirtualFileRepository(),
                folderRepository: new MongoVirtualFolderRepository()
            };
    }
}

async function connectDatabase() {
    activeProvider = resolveProvider();
    const repos = createRepositories(activeProvider);
    fileRepository = repos.fileRepository;
    folderRepository = repos.folderRepository;

    await fileRepository.connect();
    await folderRepository.connect();

    console.log(`=> Database provider active: ${activeProvider.toUpperCase()}`);
    return { provider: activeProvider, fileRepository, folderRepository };
}

async function ensureDatabase() {
    if (fileRepository && folderRepository) {
        return { fileRepository, folderRepository };
    }
    if (!connectPromise) {
        connectPromise = connectDatabase().catch((err) => {
            connectPromise = null;
            throw err;
        });
    }
    await connectPromise;
    return { fileRepository, folderRepository };
}

function getFileRepository() {
    if (!fileRepository) {
        throw new Error('Database not initialized. Call connectDatabase() first.');
    }
    return fileRepository;
}

function getFolderRepository() {
    if (!folderRepository) {
        throw new Error('Database not initialized. Call connectDatabase() first.');
    }
    return folderRepository;
}

function getActiveProvider() {
    return activeProvider || resolveProvider();
}

module.exports = {
    connectDatabase,
    ensureDatabase,
    getFileRepository,
    getFolderRepository,
    getActiveProvider,
    resolveProvider
};
