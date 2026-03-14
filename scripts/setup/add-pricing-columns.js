const { Sequelize } = require('sequelize');
require('dotenv').config();

const config = require('../src/config/database');
const dbConfig = config.development;

const sequelize = new Sequelize(
    dbConfig.database,
    dbConfig.username,
    dbConfig.password,
    {
        host: dbConfig.host,
        port: dbConfig.port,
        dialect: dbConfig.dialect,
        dialectOptions: dbConfig.dialectOptions,
        logging: false
    }
);

async function addPricingColumns() {
    try {
        await sequelize.authenticate();
        console.log('✓ Conectado ao banco de dados');

        // Adiciona coluna pricePerPhoto
        await sequelize.query(`
            ALTER TABLE events 
            ADD COLUMN IF NOT EXISTS "pricePerPhoto" NUMERIC(10,2) DEFAULT 5.00;
        `);
        console.log('✓ Coluna pricePerPhoto adicionada');

        // Adiciona coluna pricingPackages
        await sequelize.query(`
            ALTER TABLE events 
            ADD COLUMN IF NOT EXISTS "pricingPackages" JSON;
        `);
        console.log('✓ Coluna pricingPackages adicionada');

        // Adiciona coluna allPhotosPrice
        await sequelize.query(`
            ALTER TABLE events 
            ADD COLUMN IF NOT EXISTS "allPhotosPrice" NUMERIC(10,2);
        `);
        console.log('✓ Coluna allPhotosPrice adicionada');

        console.log('\n✅ Todas as colunas foram adicionadas com sucesso!');
        process.exit(0);
    } catch (error) {
        console.error('❌ Erro:', error.message);
        process.exit(1);
    }
}

addPricingColumns();
