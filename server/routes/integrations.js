const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { attachUser, requirePagePermission } = require('../middleware/auth');

function getMysqlConnection() {
    return require('../db/mysql/connection');
}

function getDatabaseFactory() {
    return require('../db/DatabaseFactory');
}

// 1. Test AI API Key
router.post('/test-ai', attachUser, requirePagePermission('settings.ai'), async (req, res) => {
    try {
        const { provider = 'gemini', apiKey = '', model = '' } = req.body || {};
        const trimmedKey = String(apiKey || '').trim();

        if (!trimmedKey) {
            return res.status(200).json({
                success: false,
                error: 'API Key is required to perform the test.',
            });
        }

        const start = Date.now();
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 9000);

        // 1. Google Gemini
        if (provider === 'gemini') {
            try {
                const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(trimmedKey)}`;
                const apiRes = await fetch(url, {
                    method: 'GET',
                    signal: controller.signal,
                });
                clearTimeout(timeoutId);

                const latencyMs = Date.now() - start;
                const data = await apiRes.json().catch(() => ({}));

                if (!apiRes.ok) {
                    const errDetail = data?.error?.message || `HTTP ${apiRes.status}: Verification failed`;
                    return res.status(200).json({
                        success: false,
                        provider: 'gemini',
                        latencyMs,
                        error: `Gemini API Error: ${errDetail}`,
                    });
                }

                const modelList = Array.isArray(data?.models) ? data.models : [];
                return res.status(200).json({
                    success: true,
                    provider: 'gemini',
                    latencyMs,
                    model: model || 'gemini-1.5-flash',
                    availableModelsCount: modelList.length,
                    message: `✓ Gemini API key is valid and verified! (${latencyMs}ms)`,
                });
            } catch (err) {
                clearTimeout(timeoutId);
                const isAbort = err?.name === 'AbortError';
                return res.status(200).json({
                    success: false,
                    provider: 'gemini',
                    error: isAbort ? 'Request timed out connecting to Google Gemini API.' : String(err.message || err),
                });
            }
        }

        // 2. OpenAI
        if (provider === 'openai') {
            try {
                const apiRes = await fetch('https://api.openai.com/v1/models', {
                    method: 'GET',
                    headers: { Authorization: `Bearer ${trimmedKey}` },
                    signal: controller.signal,
                });
                clearTimeout(timeoutId);

                const latencyMs = Date.now() - start;
                const data = await apiRes.json().catch(() => ({}));

                if (!apiRes.ok) {
                    const errDetail = data?.error?.message || `HTTP ${apiRes.status}: Verification failed`;
                    return res.status(200).json({
                        success: false,
                        provider: 'openai',
                        latencyMs,
                        error: `OpenAI API Error: ${errDetail}`,
                    });
                }

                return res.status(200).json({
                    success: true,
                    provider: 'openai',
                    latencyMs,
                    message: `✓ OpenAI API key is valid and verified! (${latencyMs}ms)`,
                });
            } catch (err) {
                clearTimeout(timeoutId);
                return res.status(200).json({
                    success: false,
                    provider: 'openai',
                    error: String(err.message || err),
                });
            }
        }

        // 3. Groq
        if (provider === 'groq') {
            try {
                const apiRes = await fetch('https://api.groq.com/openai/v1/models', {
                    method: 'GET',
                    headers: { Authorization: `Bearer ${trimmedKey}` },
                    signal: controller.signal,
                });
                clearTimeout(timeoutId);

                const latencyMs = Date.now() - start;
                const data = await apiRes.json().catch(() => ({}));

                if (!apiRes.ok) {
                    const errDetail = data?.error?.message || `HTTP ${apiRes.status}: Verification failed`;
                    return res.status(200).json({
                        success: false,
                        provider: 'groq',
                        latencyMs,
                        error: `Groq API Error: ${errDetail}`,
                    });
                }

                return res.status(200).json({
                    success: true,
                    provider: 'groq',
                    latencyMs,
                    message: `✓ Groq API key is valid and verified! (${latencyMs}ms)`,
                });
            } catch (err) {
                clearTimeout(timeoutId);
                return res.status(200).json({
                    success: false,
                    provider: 'groq',
                    error: String(err.message || err),
                });
            }
        }

        // 4. Anthropic
        if (provider === 'anthropic') {
            try {
                const apiRes = await fetch('https://api.anthropic.com/v1/models', {
                    method: 'GET',
                    headers: {
                        'x-api-key': trimmedKey,
                        'anthropic-version': '2023-06-01',
                    },
                    signal: controller.signal,
                });
                clearTimeout(timeoutId);

                const latencyMs = Date.now() - start;
                const data = await apiRes.json().catch(() => ({}));

                if (!apiRes.ok) {
                    const errDetail = data?.error?.message || `HTTP ${apiRes.status}: Verification failed`;
                    return res.status(200).json({
                        success: false,
                        provider: 'anthropic',
                        latencyMs,
                        error: `Anthropic API Error: ${errDetail}`,
                    });
                }

                return res.status(200).json({
                    success: true,
                    provider: 'anthropic',
                    latencyMs,
                    message: `✓ Anthropic API key is valid and verified! (${latencyMs}ms)`,
                });
            } catch (err) {
                clearTimeout(timeoutId);
                return res.status(200).json({
                    success: false,
                    provider: 'anthropic',
                    error: String(err.message || err),
                });
            }
        }

        // 5. DeepSeek
        if (provider === 'deepseek') {
            try {
                const apiRes = await fetch('https://api.deepseek.com/models', {
                    method: 'GET',
                    headers: { Authorization: `Bearer ${trimmedKey}` },
                    signal: controller.signal,
                });
                clearTimeout(timeoutId);

                const latencyMs = Date.now() - start;
                const data = await apiRes.json().catch(() => ({}));

                if (!apiRes.ok) {
                    const errDetail = data?.error?.message || `HTTP ${apiRes.status}: Verification failed`;
                    return res.status(200).json({
                        success: false,
                        provider: 'deepseek',
                        latencyMs,
                        error: `DeepSeek API Error: ${errDetail}`,
                    });
                }

                return res.status(200).json({
                    success: true,
                    provider: 'deepseek',
                    latencyMs,
                    message: `✓ DeepSeek API key is valid and verified! (${latencyMs}ms)`,
                });
            } catch (err) {
                clearTimeout(timeoutId);
                return res.status(200).json({
                    success: false,
                    provider: 'deepseek',
                    error: String(err.message || err),
                });
            }
        }

        // 6. OpenRouter
        if (provider === 'openrouter') {
            try {
                const apiRes = await fetch('https://openrouter.ai/api/v1/auth/key', {
                    method: 'GET',
                    headers: { Authorization: `Bearer ${trimmedKey}` },
                    signal: controller.signal,
                });
                clearTimeout(timeoutId);

                const latencyMs = Date.now() - start;
                const data = await apiRes.json().catch(() => ({}));

                if (!apiRes.ok) {
                    const errDetail = data?.error?.message || `HTTP ${apiRes.status}: Verification failed`;
                    return res.status(200).json({
                        success: false,
                        provider: 'openrouter',
                        latencyMs,
                        error: `OpenRouter API Error: ${errDetail}`,
                    });
                }

                return res.status(200).json({
                    success: true,
                    provider: 'openrouter',
                    latencyMs,
                    message: `✓ OpenRouter API key is valid and verified! (${latencyMs}ms)`,
                });
            } catch (err) {
                clearTimeout(timeoutId);
                return res.status(200).json({
                    success: false,
                    provider: 'openrouter',
                    error: String(err.message || err),
                });
            }
        }

        clearTimeout(timeoutId);
        return res.status(200).json({
            success: true,
            provider,
            latencyMs: Date.now() - start,
            message: `✓ ${provider.toUpperCase()} credentials structured successfully.`,
        });
    } catch (err) {
        return res.status(200).json({
            success: false,
            error: err instanceof Error ? err.message : String(err),
        });
    }
});

// 2. Test MongoDB Connection
router.post('/test-mongo', attachUser, requirePagePermission('settings.custom_db'), async (req, res) => {
    let tempConn = null;
    try {
        const { mongodbUri = '' } = req.body || {};
        const trimmedUri = String(mongodbUri || '').trim();

        if (!trimmedUri) {
            return res.status(200).json({
                success: false,
                error: 'MongoDB Connection URI is required.',
            });
        }

        if (!trimmedUri.startsWith('mongodb://') && !trimmedUri.startsWith('mongodb+srv://')) {
            return res.status(200).json({
                success: false,
                error: "Invalid URI format. Must begin with 'mongodb://' or 'mongodb+srv://'.",
            });
        }

        const start = Date.now();
        const mongoose = require('mongoose');

        tempConn = mongoose.createConnection(trimmedUri, {
            serverSelectionTimeoutMS: 5000,
            connectTimeoutMS: 5000,
        });

        await tempConn.asPromise();

        if (tempConn.readyState === 1 && tempConn.db) {
            await tempConn.db.admin().ping();
        }

        const latencyMs = Date.now() - start;
        const dbName = tempConn.name || 'zenvora';
        const host = tempConn.host || 'cluster';

        await tempConn.close();
        tempConn = null;

        return res.status(200).json({
            success: true,
            latencyMs,
            dbName,
            host,
            message: `✓ Successfully connected to MongoDB database "${dbName}" (${latencyMs}ms ping)!`,
        });
    } catch (err) {
        if (tempConn) {
            try {
                await tempConn.close();
            } catch (_) {}
        }
        return res.status(200).json({
            success: false,
            error: `MongoDB Connection Failed: ${err.message || String(err)}`,
        });
    }
});

// 3. Test MySQL Connection
router.post('/test-mysql', attachUser, requirePagePermission('settings.custom_db'), async (req, res) => {
    try {
        const body = req.body || {};
        const {
            mode,
            mysqlUri = '',
            host = '',
            port = '',
            user = '',
            password = '',
            database = '',
            mysqlHost = '',
            mysqlPort = '',
            mysqlUser = '',
            mysqlPassword = '',
            mysqlDatabase = '',
        } = body;

        let targetHost = String(host || mysqlHost || '').trim();
        targetHost = targetHost.replace(/^tcp:/i, '');
        targetHost = targetHost.replace(/(\.(?:net|com|org|io|dev|cloud|azure\.com|windows\.net|gov|edu))127\.0\.0\.1$/i, '$1');

        const targetUser = String(user || mysqlUser || '').trim();
        const targetPort = String(port || mysqlPort || '').trim();
        const targetPass = String(password ?? mysqlPassword ?? '');
        const targetDb = String(database || mysqlDatabase || '').trim();
        const trimmedUri = String(mysqlUri || '').trim();

        const isParamsMode = mode === 'params' || (!trimmedUri && (targetHost || targetUser));

        if (isParamsMode && !targetHost) {
            return res.status(200).json({
                success: false,
                error: 'MySQL Host is required.',
            });
        } else if (!isParamsMode && !trimmedUri) {
            return res.status(200).json({
                success: false,
                error: 'MySQL Connection URI or Host is required.',
            });
        }

        const testPayload = isParamsMode
            ? {
                  host: targetHost,
                  port: targetPort ? Number(targetPort) : 3306,
                  user: targetUser || 'root',
                  password: targetPass,
                  database: targetDb,
              }
            : trimmedUri;

        const { testMysqlConnection } = getMysqlConnection();
        const result = await testMysqlConnection(testPayload);
        return res.status(200).json(result);
    } catch (err) {
        return res.status(200).json({
            success: false,
            error: `MySQL Test Error: ${err.message || String(err)}`,
        });
    }
});

// 4. Test Cloudinary Credentials
router.post('/test-cloudinary', attachUser, requirePagePermission('settings.cloudinary'), async (req, res) => {
    try {
        const { cloudName = '', apiKey = '', apiSecret = '' } = req.body || {};
        const trimmedCloud = String(cloudName || '').trim();
        const trimmedKey = String(apiKey || '').trim();
        const trimmedSecret = String(apiSecret || '').trim();

        if (!trimmedCloud || !trimmedKey || !trimmedSecret) {
            return res.status(200).json({
                success: false,
                error: 'Cloud Name, API Key, and API Secret are all required.',
            });
        }

        const start = Date.now();
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 7000);

        try {
            const credentials = Buffer.from(`${trimmedKey}:${trimmedSecret}`).toString('base64');
            const url = `https://api.cloudinary.com/v1_1/${encodeURIComponent(trimmedCloud)}/ping`;

            const apiRes = await fetch(url, {
                method: 'GET',
                headers: { Authorization: `Basic ${credentials}` },
                signal: controller.signal,
            });
            clearTimeout(timeoutId);

            const latencyMs = Date.now() - start;
            const data = await apiRes.json().catch(() => ({}));

            if (!apiRes.ok) {
                const errDetail = data?.error?.message || `HTTP ${apiRes.status}: Cloudinary verification rejected`;
                return res.status(200).json({
                    success: false,
                    latencyMs,
                    error: `Cloudinary Error: ${errDetail}`,
                });
            }

            return res.status(200).json({
                success: true,
                latencyMs,
                status: data?.status || 'ok',
                message: `✓ Cloudinary account "${trimmedCloud}" verified successfully (${latencyMs}ms)!`,
            });
        } catch (fetchErr) {
            clearTimeout(timeoutId);
            const isAbort = fetchErr?.name === 'AbortError';
            return res.status(200).json({
                success: false,
                error: isAbort ? 'Request timed out connecting to Cloudinary API.' : String(fetchErr.message || fetchErr),
            });
        }
    } catch (err) {
        return res.status(200).json({
            success: false,
            error: err.message || String(err),
        });
    }
});

// 4.1 Cloudinary Config GET & POST
router.get('/cloudinary-config', attachUser, requirePagePermission('settings.cloudinary'), (req, res) => {
    try {
        const cloudName = process.env.CLOUDINARY_CLOUD_NAME || '';
        const apiKey = process.env.CLOUDINARY_API_KEY || '';
        const apiSecret = process.env.CLOUDINARY_API_SECRET || '';
        return res.status(200).json({
            success: true,
            cloudName,
            apiKey,
            hasApiKey: Boolean(apiKey),
            hasApiSecret: Boolean(apiSecret),
        });
    } catch (err) {
        return res.status(400).json({ success: false, error: err.message });
    }
});

router.post('/cloudinary-config', attachUser, requirePagePermission('settings.cloudinary'), async (req, res) => {
    try {
        const { cloudName = '', apiKey = '', apiSecret = '' } = req.body || {};
        const trimmedCloud = String(cloudName || '').trim();
        const trimmedKey = String(apiKey || '').trim();
        const trimmedSecret = String(apiSecret || '').trim();

        if (trimmedCloud) process.env.CLOUDINARY_CLOUD_NAME = trimmedCloud;
        if (trimmedKey) process.env.CLOUDINARY_API_KEY = trimmedKey;
        if (trimmedSecret) process.env.CLOUDINARY_API_SECRET = trimmedSecret;

        // Re-configure Cloudinary runtime SDK
        const cloudinary = require('../config/cloudinary');
        cloudinary.config({
            cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
            api_key: process.env.CLOUDINARY_API_KEY,
            api_secret: process.env.CLOUDINARY_API_SECRET,
            secure: true,
        });

        // Persist to .env
        try {
            const envPath = path.resolve(process.cwd(), '.env');
            if (fs.existsSync(envPath)) {
                let envContent = fs.readFileSync(envPath, 'utf-8');
                const updateOrAppend = (key, val) => {
                    const regex = new RegExp(`^${key}=.*$`, 'm');
                    if (regex.test(envContent)) {
                        envContent = envContent.replace(regex, `${key}=${val}`);
                    } else {
                        envContent += `\n${key}=${val}`;
                    }
                };
                if (trimmedCloud) updateOrAppend('CLOUDINARY_CLOUD_NAME', trimmedCloud);
                if (trimmedKey) updateOrAppend('CLOUDINARY_API_KEY', trimmedKey);
                if (trimmedSecret) updateOrAppend('CLOUDINARY_API_SECRET', trimmedSecret);
                fs.writeFileSync(envPath, envContent.trim() + '\n', 'utf-8');
            }
        } catch (fsErr) {
            console.warn('[CLOUDINARY-CONFIG] Could not update .env:', fsErr.message);
        }

        return res.status(200).json({
            success: true,
            cloudName: process.env.CLOUDINARY_CLOUD_NAME,
            message: `Cloudinary configuration updated for "${process.env.CLOUDINARY_CLOUD_NAME}".`,
        });
    } catch (err) {
        return res.status(400).json({ success: false, error: err.message });
    }
});

// 5. Database Config GET & POST
router.get('/db-config', attachUser, requirePagePermission('settings.custom_db'), (req, res) => {
    try {
        const factory = getDatabaseFactory();
        const activeProvider = factory.resolveProvider();
        const rawMongo = process.env.MONGODB_URI || '';
        const rawMysql = process.env.MYSQL_URL || process.env.DATABASE_URL || '';
        const mysqlHost = process.env.MYSQL_HOST || '';
        const mysqlPort = process.env.MYSQL_PORT || '3306';
        const mysqlDatabase = process.env.MYSQL_DATABASE || '';
        const mysqlUser = process.env.MYSQL_USER || 'root';
        const mysqlPassword = process.env.MYSQL_PASSWORD || '';
        const mysqlMode = process.env.MYSQL_CONFIG_MODE || (mysqlHost ? 'params' : 'uri');

        let computedMysqlUri = rawMysql;
        let parsedParams = null;

        const { buildMysqlUri, parseMysqlConnectionString } = getMysqlConnection();

        if (rawMysql) {
            try {
                parsedParams = parseMysqlConnectionString(rawMysql);
            } catch (_) {}
        }
        if (!computedMysqlUri && mysqlHost) {
            try {
                computedMysqlUri = buildMysqlUri({
                    host: mysqlHost,
                    port: mysqlPort,
                    user: mysqlUser,
                    password: mysqlPassword,
                    database: mysqlDatabase,
                });
            } catch (_) {}
        }

        return res.status(200).json({
            success: true,
            activeProvider,
            hasMongoConfig: Boolean(rawMongo),
            hasMysqlConfig: Boolean(rawMysql || mysqlHost),
            mongodbUri: rawMongo,
            mysqlUri: rawMysql || computedMysqlUri || '',
            mysqlMode,
            mysqlHost: mysqlHost || parsedParams?.host || '127.0.0.1',
            mysqlPort: mysqlPort || (parsedParams?.port ? String(parsedParams.port) : '3306'),
            mysqlDatabase: mysqlDatabase || parsedParams?.database || '',
            mysqlUser: mysqlUser || parsedParams?.user || 'root',
            mysqlPassword: mysqlPassword || parsedParams?.password || '',
        });
    } catch (err) {
        return res.status(400).json({ success: false, error: err.message });
    }
});

router.post('/db-config', attachUser, requirePagePermission('settings.custom_db'), async (req, res) => {
    try {
        const {
            provider = 'mongo',
            mongodbUri = '',
            mysqlUri = '',
            mysqlMode = 'params',
            mysqlHost = '',
            mysqlPort = '3306',
            mysqlDatabase = '',
            mysqlUser = 'root',
            mysqlPassword = '',
        } = req.body || {};

        const chosenProvider = provider === 'mysql' ? 'mysql' : 'mongo';

        process.env.DATABASE_PROVIDER = chosenProvider;
        if (mongodbUri && typeof mongodbUri === 'string') {
            process.env.MONGODB_URI = mongodbUri.trim();
        }

        process.env.MYSQL_CONFIG_MODE = mysqlMode;
        if (mysqlHost) process.env.MYSQL_HOST = String(mysqlHost).trim();
        if (mysqlPort) process.env.MYSQL_PORT = String(mysqlPort).trim();
        if (mysqlDatabase) process.env.MYSQL_DATABASE = String(mysqlDatabase).trim();
        if (mysqlUser) process.env.MYSQL_USER = String(mysqlUser).trim();
        if (mysqlPassword !== undefined) process.env.MYSQL_PASSWORD = String(mysqlPassword);

        let effectiveMysqlUri = String(mysqlUri || '').trim();
        const { buildMysqlUri, parseMysqlConnectionString } = getMysqlConnection();
        if (mysqlMode === 'params' && mysqlHost) {
            effectiveMysqlUri = buildMysqlUri({
                host: mysqlHost,
                port: mysqlPort,
                user: mysqlUser,
                password: mysqlPassword,
                database: mysqlDatabase,
            });
        } else if (effectiveMysqlUri) {
            const parsed = parseMysqlConnectionString(effectiveMysqlUri);
            if (parsed) {
                if (parsed.host) process.env.MYSQL_HOST = parsed.host;
                if (parsed.port) process.env.MYSQL_PORT = String(parsed.port);
                if (parsed.user) process.env.MYSQL_USER = parsed.user;
                if (parsed.password !== undefined) process.env.MYSQL_PASSWORD = parsed.password;
                if (parsed.database) process.env.MYSQL_DATABASE = parsed.database;
            }
        }

        if (effectiveMysqlUri) {
            process.env.MYSQL_URL = effectiveMysqlUri;
        }

        const factory = getDatabaseFactory();
        factory.setActiveProvider(chosenProvider);

        // Persist to .env
        try {
            const envPath = path.resolve(process.cwd(), '.env');
            if (fs.existsSync(envPath)) {
                let envContent = fs.readFileSync(envPath, 'utf-8');
                const updateOrAppend = (key, val) => {
                    const regex = new RegExp(`^${key}=.*$`, 'm');
                    if (regex.test(envContent)) {
                        envContent = envContent.replace(regex, `${key}=${val}`);
                    } else {
                        envContent += `\n${key}=${val}`;
                    }
                };

                updateOrAppend('DATABASE_PROVIDER', chosenProvider);
                if (mongodbUri) updateOrAppend('MONGODB_URI', mongodbUri.trim());
                updateOrAppend('MYSQL_CONFIG_MODE', mysqlMode);
                if (effectiveMysqlUri) updateOrAppend('MYSQL_URL', effectiveMysqlUri);
                if (process.env.MYSQL_HOST) updateOrAppend('MYSQL_HOST', process.env.MYSQL_HOST);
                if (process.env.MYSQL_PORT) updateOrAppend('MYSQL_PORT', process.env.MYSQL_PORT);
                if (process.env.MYSQL_DATABASE) updateOrAppend('MYSQL_DATABASE', process.env.MYSQL_DATABASE);
                if (process.env.MYSQL_USER) updateOrAppend('MYSQL_USER', process.env.MYSQL_USER);
                if (process.env.MYSQL_PASSWORD !== undefined) updateOrAppend('MYSQL_PASSWORD', process.env.MYSQL_PASSWORD);

                fs.writeFileSync(envPath, envContent.trim() + '\n', 'utf-8');
            }
        } catch (fsErr) {
            console.warn('Could not update .env file:', fsErr);
        }

        try {
            await factory.connectDatabase();
        } catch (cErr) {
            console.error(`Database reconnect on switch to ${chosenProvider} failed:`, cErr.message);
        }

        return res.status(200).json({
            success: true,
            activeProvider: chosenProvider,
            message: `Database provider updated to ${chosenProvider.toUpperCase()}.`,
        });
    } catch (err) {
        return res.status(400).json({ success: false, error: err.message });
    }
});

module.exports = router;
