require('dotenv').config();
const { Sequelize } = require('sequelize');

console.log('🔍 Testando conexão com o banco de dados Supabase...\n');

const sequelize = new Sequelize({
    database: process.env.DB_NAME,
    username: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    dialect: 'postgres',
    dialectOptions: {
        ssl: {
            require: true,
            rejectUnauthorized: false
        }
    },
    logging: false
});

async function testConnection() {
    try {
        console.log('📡 Conectando ao banco de dados...');
        console.log(`   Host: ${process.env.DB_HOST}`);
        console.log(`   Database: ${process.env.DB_NAME}`);
        console.log(`   User: ${process.env.DB_USER}`);
        console.log(`   Port: ${process.env.DB_PORT}\n`);

        await sequelize.authenticate();
        
        console.log('✅ SUCESSO! Conexão com o banco de dados estabelecida com sucesso!');
        
        // Testar uma query simples
        const [results] = await sequelize.query('SELECT version();');
        console.log(`\n📊 Versão do PostgreSQL: ${results[0].version}\n`);
        
        // Listar tabelas existentes
        const [tables] = await sequelize.query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public' 
            ORDER BY table_name;
        `);
        
        if (tables.length > 0) {
            console.log('📋 Tabelas encontradas no banco:');
            tables.forEach(table => {
                console.log(`   - ${table.table_name}`);
            });
        } else {
            console.log('⚠️  Nenhuma tabela encontrada. Você precisará executar as migrações.');
        }
        
        await sequelize.close();
        console.log('\n✅ Teste concluído com sucesso!');
        process.exit(0);
        
    } catch (error) {
        console.error('❌ ERRO ao conectar com o banco de dados:\n');
        console.error(`   ${error.message}\n`);
        
        if (error.message.includes('password authentication failed')) {
            console.error('💡 Dica: A senha do banco de dados está incorreta.');
        } else if (error.message.includes('getaddrinfo ENOTFOUND')) {
            console.error('💡 Dica: O host do banco de dados está incorreto ou inacessível.');
        } else if (error.message.includes('timeout')) {
            console.error('💡 Dica: Timeout na conexão. Verifique se o projeto Supabase está ativo.');
        }
        
        await sequelize.close();
        process.exit(1);
    }
}

testConnection();
