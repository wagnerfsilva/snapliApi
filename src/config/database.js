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

module.exports = {
    development: {
        ...buildDbConfig(),
        dialect: 'postgres',
        dialectOptions: {
            ssl: {
                require: true,
                rejectUnauthorized: false
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
                rejectUnauthorized: false
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
