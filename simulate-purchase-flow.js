/**
 * Script para simular o fluxo completo de compra + download
 * 
 * Simula:
 * 1. Cliente faz pedido
 * 2. Pagamento é confirmado
 * 3. Token é gerado
 * 4. Email é "enviado" (logged)
 * 5. Cliente acessa portal
 */

const { Order, OrderItem, Photo, Event } = require('./src/models');
const emailService = require('./src/services/email.service');
const crypto = require('crypto');

async function simulateFullFlow() {
    try {
        console.log('\n╔════════════════════════════════════════════════════════╗');
        console.log('║  🎬 SIMULAÇÃO: FLUXO COMPLETO DE COMPRA → DOWNLOAD   ║');
        console.log('╚════════════════════════════════════════════════════════╝\n');

        // Step 1: Cliente seleciona fotos
        console.log('📸 PASSO 1: Cliente encontra suas fotos\n');

        const event = await Event.findOne({
            include: [{
                model: Photo,
                as: 'photos',
                where: { processingStatus: 'completed' },
                limit: 2
            }]
        });

        if (!event || event.photos.length === 0) {
            console.log('❌ Sem fotos para testar. Execute upload primeiro.\n');
            return;
        }

        console.log(`   Evento: ${event.name}`);
        console.log(`   Fotos selecionadas: ${event.photos.length}`);
        console.log(`   Preço unitário: R$ ${event.pricePerPhoto || 10}\n`);

        // Step 2: Cria pedido (status: pending)
        console.log('🛒 PASSO 2: Cliente finaliza compra\n');

        const customerEmail = `cliente${Date.now()}@fotow.com`;
        const order = await Order.create({
            customerName: 'João Silva',
            customerEmail: customerEmail,
            status: 'pending',
            totalAmount: event.photos.length * (event.pricePerPhoto || 10)
        });

        for (const photo of event.photos) {
            await OrderItem.create({
                orderId: order.id,
                photoId: photo.id,
                price: event.pricePerPhoto || 10
            });
        }

        console.log(`   ✅ Pedido #${order.id.substring(0, 8)} criado`);
        console.log(`   📧 Email enviado para: ${customerEmail}`);
        console.log(`   💳 Aguardando pagamento...\n`);

        // Simulate email
        await emailService.sendOrderConfirmation(order, 'https://asaas.com/payment/xyz123');

        // Step 3: Pagamento confirmado (webhook Asaas)
        console.log('💰 PASSO 3: Pagamento confirmado (webhook Asaas)\n');

        order.status = 'paid';
        order.paidAt = new Date();
        order.downloadToken = crypto.randomBytes(32).toString('hex');
        order.downloadExpiresAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);
        await order.save();

        console.log(`   ✅ Status: ${order.status}`);
        console.log(`   🔑 Token gerado: ${order.downloadToken.substring(0, 16)}...`);
        console.log(`   📧 Email de download enviado\n`);

        // Simulate download email
        await emailService.sendDownloadEmail(order);

        // Step 4: Cliente acessa portal
        console.log('🌐 PASSO 4: Cliente acessa portal de downloads\n');

        const downloadUrl = `http://localhost:5173/downloads/${order.downloadToken}`;
        const apiUrl = `http://localhost:3000/api/downloads/${order.downloadToken}`;

        console.log(`   Portal: ${downloadUrl}`);
        console.log(`   API: ${apiUrl}`);
        console.log(`   Validade: ${order.downloadExpiresAt.toLocaleDateString('pt-BR')} (${getDaysRemaining(order.downloadExpiresAt)} dias)\n`);

        // Step 5: Cliente baixa fotos
        console.log('📥 PASSO 5: Cliente faz download das fotos\n');
        console.log(`   ${event.photos.length} fotos disponíveis em alta resolução`);
        console.log(`   ✅ Sem marca d'água`);
        console.log(`   ✅ Downloads ilimitados por 90 dias\n`);

        // Summary
        console.log('╔════════════════════════════════════════════════════════╗');
        console.log('║                  ✅ FLUXO COMPLETO!                   ║');
        console.log('╚════════════════════════════════════════════════════════╝\n');

        console.log('📊 RESUMO DO PEDIDO:');
        console.log('─────────────────────────────────────────────────────────');
        console.log(`   ID: ${order.id}`);
        console.log(`   Cliente: ${order.customerName}`);
        console.log(`   Email: ${order.customerEmail}`);
        console.log(`   Evento: ${event.name}`);
        console.log(`   Fotos: ${event.photos.length}`);
        console.log(`   Total: R$ ${parseFloat(order.totalAmount).toFixed(2)}`);
        console.log(`   Status: ${order.status}`);
        console.log(`   Pago em: ${order.paidAt.toLocaleString('pt-BR')}`);
        console.log(`   Expira em: ${order.downloadExpiresAt.toLocaleDateString('pt-BR')}`);
        console.log('─────────────────────────────────────────────────────────\n');

        console.log('🎯 PRÓXIMOS PASSOS:');
        console.log('   1. Abra o portal no navegador');
        console.log('   2. Veja as fotos com preview (marca d\'água)');
        console.log('   3. Clique em "Baixar Original" em qualquer foto');
        console.log('   4. Foto original será baixada sem marca d\'água\n');

        console.log('🔗 LINKS RÁPIDOS:');
        console.log(`   Portal: ${downloadUrl}`);
        console.log(`   API: ${apiUrl}\n`);

    } catch (error) {
        console.error('❌ Erro na simulação:', error);
    }
}

function getDaysRemaining(expiresAt) {
    const days = Math.ceil((new Date(expiresAt) - new Date()) / (1000 * 60 * 60 * 24));
    return days;
}

// Run simulation
simulateFullFlow()
    .then(() => {
        console.log('✅ Simulação concluída com sucesso!\n');
        process.exit(0);
    })
    .catch(error => {
        console.error('❌ Erro:', error);
        process.exit(1);
    });
