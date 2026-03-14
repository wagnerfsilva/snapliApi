const { Event, Photo, Order, OrderItem, sequelize } = require('../src/models');

async function cleanupDatabase() {
    try {
        console.log('🧹 Iniciando limpeza do banco de dados...');

        // Delete in correct order due to foreign keys
        console.log('📦 Removendo itens de pedidos...');
        await OrderItem.destroy({ where: {} });

        console.log('🛒 Removendo pedidos...');
        await Order.destroy({ where: {} });

        console.log('📸 Removendo fotos...');
        await Photo.destroy({ where: {} });

        console.log('📅 Removendo eventos...');
        await Event.destroy({ where: {} });

        console.log('✅ Banco de dados limpo com sucesso!');
        console.log('\n📊 Contadores:');
        console.log(`  Eventos: ${await Event.count()}`);
        console.log(`  Fotos: ${await Photo.count()}`);
        console.log(`  Pedidos: ${await Order.count()}`);
        console.log(`  Itens de pedidos: ${await OrderItem.count()}`);

        process.exit(0);
    } catch (error) {
        console.error('❌ Erro ao limpar banco de dados:', error);
        process.exit(1);
    }
}

cleanupDatabase();
