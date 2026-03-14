const { Order, OrderItem, Photo, sequelize } = require('../src/models');

async function seedSalesData() {
    try {
        console.log('🌱 Iniciando seed de dados de vendas...');

        // Get all photos
        const photos = await Photo.findAll({
            where: { processingStatus: 'completed' },
            limit: 20
        });

        if (photos.length === 0) {
            console.log('❌ Nenhuma foto encontrada. Execute o seed de fotos primeiro.');
            return;
        }

        console.log(`✅ Encontradas ${photos.length} fotos`);

        // Create orders for the last 12 months
        const orders = [];
        const now = new Date();

        for (let i = 11; i >= 0; i--) {
            const month = new Date(now.getFullYear(), now.getMonth() - i, 1);
            const ordersInMonth = Math.floor(Math.random() * 5) + 2; // 2-6 orders per month

            for (let j = 0; j < ordersInMonth; j++) {
                const paidAt = new Date(
                    month.getFullYear(),
                    month.getMonth(),
                    Math.floor(Math.random() * 28) + 1,
                    Math.floor(Math.random() * 24),
                    Math.floor(Math.random() * 60)
                );

                // Random number of photos per order (1-5)
                const photoCount = Math.floor(Math.random() * 5) + 1;
                const selectedPhotos = photos
                    .sort(() => 0.5 - Math.random())
                    .slice(0, Math.min(photoCount, photos.length));

                // Calculate total (assuming R$ 15.00 per photo)
                const pricePerPhoto = 15.00;
                const totalAmount = selectedPhotos.length * pricePerPhoto;

                const order = await Order.create({
                    customerEmail: `cliente${Math.floor(Math.random() * 1000)}@example.com`,
                    customerName: `Cliente ${Math.floor(Math.random() * 1000)}`,
                    status: 'paid',
                    totalAmount,
                    paymentMethod: 'pix',
                    paidAt,
                    downloadExpiresAt: new Date(paidAt.getTime() + 30 * 24 * 60 * 60 * 1000), // 30 days
                    downloadToken: `token_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
                });

                // Create order items
                for (const photo of selectedPhotos) {
                    await OrderItem.create({
                        orderId: order.id,
                        photoId: photo.id,
                        price: pricePerPhoto
                    });
                }

                orders.push(order);
            }
        }

        console.log(`✅ Criados ${orders.length} pedidos de exemplo`);

        // Show statistics
        const stats = await Order.findAll({
            attributes: [
                [sequelize.fn('TO_CHAR', sequelize.col('paidAt'), 'YYYY-MM'), 'month'],
                [sequelize.fn('COUNT', sequelize.col('id')), 'orders'],
                [sequelize.fn('SUM', sequelize.col('totalAmount')), 'revenue']
            ],
            where: {
                status: 'paid'
            },
            group: [sequelize.fn('TO_CHAR', sequelize.col('paidAt'), 'YYYY-MM')],
            order: [[sequelize.fn('TO_CHAR', sequelize.col('paidAt'), 'YYYY-MM'), 'ASC']],
            raw: true
        });

        console.log('\n📊 Estatísticas de vendas por mês:');
        stats.forEach(stat => {
            console.log(`  ${stat.month}: ${stat.orders} pedidos - R$ ${parseFloat(stat.revenue).toFixed(2)}`);
        });

        console.log('\n✅ Seed concluído com sucesso!');
        process.exit(0);
    } catch (error) {
        console.error('❌ Erro ao executar seed:', error);
        process.exit(1);
    }
}

seedSalesData();
