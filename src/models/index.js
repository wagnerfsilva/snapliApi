'use strict';

const fs = require('fs');
const path = require('path');
const Sequelize = require('sequelize');
const basename = path.basename(__filename);
const env = process.env.NODE_ENV || 'development';
const config = require(__dirname + '/../config/database.js')[env];
const db = {};

// Check if database credentials are configured
const hasDbCredentials = !!(config.use_env_variable
    ? process.env[config.use_env_variable]
    : (config.host && config.username && config.password && config.database));

if (!hasDbCredentials) {
    console.warn('⚠️  WARNING: Database credentials not configured. Application will start but database features will not work.');
}

let sequelize;
if (config.use_env_variable) {
    sequelize = new Sequelize(process.env[config.use_env_variable], config);
} else if (hasDbCredentials) {
    sequelize = new Sequelize(config.database, config.username, config.password, config);
} else {
    // Create a dummy sequelize instance that won't try to connect
    sequelize = {
        authenticate: async () => {
            throw new Error('Database not configured. Please set DB_HOST, DB_USER, DB_PASSWORD, and DB_NAME environment variables.');
        },
        sync: async () => {
            console.warn('Database sync skipped - no credentials configured');
        },
        close: async () => {},
        define: () => ({})
    };
}

// Only load models if database is configured
if (hasDbCredentials && sequelize.constructor.name === 'Sequelize') {
    fs
        .readdirSync(__dirname)
        .filter(file => {
            return (file.indexOf('.') !== 0) && (file !== basename) && (file.slice(-3) === '.js');
        })
        .forEach(file => {
            const model = require(path.join(__dirname, file))(sequelize, Sequelize.DataTypes);
            db[model.name] = model;
        });

    Object.keys(db).forEach(modelName => {
        if (db[modelName].associate) {
            db[modelName].associate(db);
        }
    });
}

db.sequelize = sequelize;
db.Sequelize = Sequelize;
db.isConfigured = hasDbCredentials;

module.exports = db;
