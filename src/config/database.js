require('dotenv').config();

// Helper: build config from DATABASE_URL or individual vars
const buildDbConfig = (extras = {}) => {
    if (process.env.DATABASE_URL) {
        return { use_env_variable: 'DATABASE_URL', ...extras };
    }
    return {
        username: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
        host: process.env.DB_HOST,
        port: process.env.DB_PORT || 5432,
        ...extras
    };
};

// Defaults to true (secure). Set DB_SSL_REJECT_UNAUTHORIZED=false only if the
// server uses a self-signed cert that cannot be added to the trust store.
const rejectUnauthorized = process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false';

module.exports = {
    development: {
        ...buildDbConfig(),
        dialect: 'postgres',
        dialectOptions: {
            ssl: {
                require: true,
                rejectUnauthorized
            }
        },
        logging: console.log
    },
    test: {
        ...buildDbConfig(),
        dialect: 'postgres',
        logging: false
    },
    production: {
        ...buildDbConfig(),
        dialect: 'postgres',
        dialectOptions: {
            ssl: {
                require: true,
                rejectUnauthorized
            },
            family: 4,
            prepare: false
        },
        logging: false,
        pool: {
            max: 10,
            min: 2,
            acquire: 30000,
            idle: 10000
        }
    }
};
