const { MongoVirtualFileRepository } = require('./mongo/MongoVirtualFileRepository');
const { MongoVirtualFolderRepository } = require('./mongo/MongoVirtualFolderRepository');
const { PostgresVirtualFileRepository } = require('./postgres/PostgresVirtualFileRepository');
const { PostgresVirtualFolderRepository } = require('./postgres/PostgresVirtualFolderRepository');
const { MysqlVirtualFileRepository } = require('./mysql/MysqlVirtualFileRepository');
const { MysqlVirtualFolderRepository } = require('./mysql/MysqlVirtualFolderRepository');
const { ensureMongooseConnected } = require('./mongo/connection');
const { ensureMysqlConnected, isMysqlConnected } = require('./mysql/connection');

let activeProvider = null;
let fileRepository = null;
let folderRepository = null;
let connectPromise = null;

function resolveProvider() {
    if (activeProvider) return activeProvider;
    if (process.env.DATABASE_PROVIDER) {
        return String(process.env.DATABASE_PROVIDER).trim().toLowerCase();
    }
    if (process.env.MYSQL_URL || process.env.MYSQL_HOST || process.env.DATABASE_URL?.includes('mysql')) return 'mysql';
    if (process.env.POSTGRES_URL || process.env.DATABASE_URL?.includes('postgres')) return 'postgres';
    if (process.env.MONGODB_URI) return 'mongo';
    return 'mongo';
}

function setActiveProvider(provider) {
    const p = String(provider || 'mongo').trim().toLowerCase();
    if (['mongo', 'mysql', 'postgres'].includes(p)) {
        activeProvider = p;
        process.env.DATABASE_PROVIDER = p;
        fileRepository = null;
        folderRepository = null;
        connectPromise = null;
    }
}

function isMysql() {
    return resolveProvider() === 'mysql';
}

function isMongo() {
    return resolveProvider() === 'mongo';
}

function isPostgres() {
    return resolveProvider() === 'postgres';
}

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
    const provider = resolveProvider();
    activeProvider = provider;

    if (provider === 'mysql') {
        await ensureMysqlConnected();
        console.log('=> MySQL connection pool and schema verified.');
    } else if (provider === 'postgres') {
        console.log('=> PostgreSQL ready.');
    } else {
        await ensureMongooseConnected();
        console.log('=> MongoDB connection verified.');
    }

    const repos = createRepositories(provider);
    fileRepository = repos.fileRepository;
    folderRepository = repos.folderRepository;

    try {
        await fileRepository.connect();
        await folderRepository.connect();
    } catch (repoErr) {
        console.warn(`Virtual storage repo init warning for ${provider}:`, repoErr.message);
    }

    console.log(`=> Database provider active: ${provider.toUpperCase()}`);
    return { provider, fileRepository, folderRepository };
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
    return resolveProvider();
}

function getMysqlAdapter() {
    return require('./mysql/MysqlModelAdapter');
}

module.exports = {
    connectDatabase,
    ensureDatabase,
    getFileRepository,
    getFolderRepository,
    getActiveProvider,
    setActiveProvider,
    resolveProvider,
    isMysql,
    isMongo,
    isPostgres,
    getMysqlAdapter,
};
