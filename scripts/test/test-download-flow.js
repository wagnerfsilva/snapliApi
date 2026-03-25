/**
 * Test script to create a sample order with download token
 * 
 * Usage: node test-download-flow.js
 */

const { Order, OrderItem, Photo, Event, User } = require('../src/models');
const crypto = require('crypto');

async function createTestOrder() {
    try {
        console.log('🧪 Criando pedido de teste...\n');

        // Find first event with photos
        const event = await Event.findOne({
            include: [{
                model: Photo,
                as: 'photos',
                where: {
                    processingStatus: 'completed'
                },
                limit: 3
            }]
        });

        if (!event || event.photos.length === 0) {
            console.log('❌ Nenhum evento com fotos encontrado');
            console.log('💡 Execute o upload de fotos primeiro');
            return;
        }

        console.log(`✅ Evento encontrado: ${event.name}`);
        console.log(`📸 Fotos disponíveis: ${event.photos.length}\n`);

        // Create order
        const order = await Order.create({
            customerName: 'Cliente Teste',
            customerEmail: 'teste@snapli.com',
            status: 'paid',
            totalAmount: event.photos.length * (event.pricePerPhoto || 10),
            paidAt: new Date(),
            downloadToken: crypto.randomBytes(32).toString('hex'),
            downloadExpiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000) // 90 days
        });

        console.log(`✅ Pedido criado: ${order.id}`);
        console.log(`🔑 Token: ${order.downloadToken}\n`);

        // Create order items
        for (const photo of event.photos) {
            await OrderItem.create({
                orderId: order.id,
                photoId: photo.id,
                price: event.pricePerPhoto || 10
            });
        }

        console.log(`✅ ${event.photos.length} itens adicionados ao pedido\n`);

        // Display results
        console.log('═══════════════════════════════════════════════');
        console.log('🎉 PEDIDO DE TESTE CRIADO COM SUCESSO!');
        console.log('═══════════════════════════════════════════════\n');

        console.log('📋 Informações do Pedido:');
        console.log(`   ID: ${order.id}`);
        console.log(`   Cliente: ${order.customerName}`);
        console.log(`   Email: ${order.customerEmail}`);
        console.log(`   Total: R$ ${parseFloat(order.totalAmount).toFixed(2)}`);
        console.log(`   Fotos: ${event.photos.length}`);
        console.log(`   Status: ${order.status}\n`);

        console.log('🔗 Portal de Downloads:');
        console.log(`   http://localhost:5173/downloads/${order.downloadToken}\n`);

        console.log('🧪 Testar API (backend):');
        console.log(`   curl http://localhost:3000/api/downloads/${order.downloadToken}\n`);

        console.log('⏰ Validade:');
        console.log(`   ${order.downloadExpiresAt.toLocaleDateString('pt-BR')}\n`);

    } catch (error) {
        console.error('❌ Erro ao criar pedido de teste:', error);
    }
}

// Run test
createTestOrder()
    .then(() => {
        console.log('✅ Script finalizado');
        process.exit(0);
    })
    .catch(error => {
        console.error('❌ Erro:', error);
        process.exit(1);
    });
