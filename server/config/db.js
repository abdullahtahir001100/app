const { connectDatabase } = require('../db/DatabaseFactory');

const MAX_RETRIES = 5;
const RETRY_DELAY_MS = 4000;

const connectDB = async () => {
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
        try {
            await connectDatabase();
            console.log('=> Database connected successfully.');
            return true;
        } catch (error) {
            console.error(
                `Database connection attempt ${attempt}/${MAX_RETRIES} failed:`,
                error.message
            );
            if (attempt < MAX_RETRIES) {
                await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS * attempt));
            }
        }
    }

    const { getActiveProvider } = require('../db/DatabaseFactory');
    const provider = getActiveProvider().toUpperCase();
    console.error(
        `=> Database (${provider}) unavailable. Login, Google auth, and data features will fail until ${provider} connects.`
    );
    if (provider === 'MYSQL') {
        console.error('=> Check MYSQL_URL in .env and verify your MySQL host, credentials, and port.');
    } else {
        console.error('=> Check MONGODB_URI in .env and ensure your IP is allowed in MongoDB Atlas.');
    }
    return false;
};

module.exports = connectDB;
