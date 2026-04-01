/**
 * Relatório de compradores por evento
 * 
 * Uso: node scripts/report/event-buyers-report.js <eventId>
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });

const { Op } = require('sequelize');
const { Order, OrderItem, Photo, Event, sequelize } = require('../../src/models');

async function main() {
    const eventId = process.argv[2] || '803bff31-1dab-4ef9-8223-5a0ade60ca32';

    try {
        await sequelize.authenticate();

        const event = await Event.findByPk(eventId);
        if (!event) {
            console.error(`Evento ${eventId} não encontrado.`);
            process.exit(1);
        }

        console.log(''); // separador dos logs SQL

        // Buscar apenas orders com pagamento confirmado (paidAt preenchido)
        const orders = await Order.findAll({
            where: {
                status: ['paid', 'completed'],
                paidAt: { [Op.ne]: null }
            },
            include: [{
                model: OrderItem,
                as: 'items',
                required: true,
                include: [{
                    model: Photo,
                    as: 'photo',
                    where: { eventId },
                    required: true
                }]
            }],
            order: [['createdAt', 'DESC']]
        });

        if (orders.length === 0) {
            console.log('\nNenhuma compra encontrada para este evento.');
            process.exit(0);
        }

        const frontendUrl = 'https://web.snapli.com.br';

        const lines = [];
        lines.push(`📸 *Relatório de Vendas - ${event.name}*`);
        lines.push(`📅 Data: ${new Date(event.date).toLocaleDateString('pt-BR')}`);
        lines.push(`📍 Local: ${event.location || 'N/A'}`);
        lines.push(`🛒 Compradores: ${orders.length}`);
        lines.push('');
        lines.push('---');

        let totalPhotos = 0;
        let totalRevenue = 0;

        orders.forEach((order, i) => {
            const photoCount = order.items.length;
            const downloadLink = order.downloadToken
                ? `${frontendUrl}/downloads/${order.downloadToken}`
                : 'Token não gerado';

            totalPhotos += photoCount;
            totalRevenue += Number(order.totalAmount);

            lines.push('');
            lines.push(`*${i + 1}. ${order.customerName.trim()}*`);
            lines.push(`   📧 ${order.customerEmail}`);
            lines.push(`   🖼️ Fotos: ${photoCount}`);
            lines.push(`   💰 Valor: R$ ${Number(order.totalAmount).toFixed(2)}`);
            lines.push(`   📅 Pago em: ${order.paidAt ? new Date(order.paidAt).toLocaleDateString('pt-BR') : 'N/A'}`);
            lines.push(`   ⏳ Expira em: ${order.downloadExpiresAt ? new Date(order.downloadExpiresAt).toLocaleDateString('pt-BR') : 'N/A'}`);
            lines.push(`   🔗 ${downloadLink}`);
        });

        lines.push('');
        lines.push('---');
        lines.push(`📊 *Resumo*`);
        lines.push(`   Compradores: ${orders.length}`);
        lines.push(`   Fotos vendidas: ${totalPhotos}`);
        lines.push(`   Receita total: R$ ${totalRevenue.toFixed(2)}`);

        const output = lines.join('\n');
        console.log('\n' + output + '\n');

    } catch (error) {
        console.error('Erro:', error.message);
    } finally {
        await sequelize.close();
    }
}

main();
