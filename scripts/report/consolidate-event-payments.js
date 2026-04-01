/**
 * Consolidação de pagamentos - Asaas vs Sistema
 * 
 * Verifica todos os pedidos de um evento e cruza com o status real no Asaas.
 * Trata: pagamentos confirmados, estornos totais, estornos parciais e valores divergentes.
 * 
 * Uso: node scripts/report/consolidate-event-payments.js <eventId>
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });

const axios = require('axios');
const crypto = require('crypto');
const { Op } = require('sequelize');
const { Order, OrderItem, Photo, Event, sequelize } = require('../../src/models');

const asaasBaseURL = process.env.ASAAS_API_URL ||
    (process.env.ASAAS_ENVIRONMENT === 'producao'
        ? 'https://api.asaas.com/v3'
        : 'https://sandbox.asaas.com/api/v3');

const asaasClient = axios.create({
    baseURL: asaasBaseURL,
    headers: {
        'access_token': process.env.ASAAS_API_KEY,
        'Content-Type': 'application/json'
    }
});

async function checkAsaasStatus(paymentId) {
    try {
        const response = await asaasClient.get(`/payments/${paymentId}`);
        return response.data;
    } catch (error) {
        return { error: error.message, status: 'ERRO_CONSULTA' };
    }
}

async function main() {
    const eventId = process.argv[2] || '803bff31-1dab-4ef9-8223-5a0ade60ca32';

    try {
        await sequelize.authenticate();

        const event = await Event.findByPk(eventId);
        if (!event) {
            console.error(`Evento ${eventId} não encontrado.`);
            process.exit(1);
        }

        console.log(`\n🔍 Consolidando pagamentos - ${event.name}`);
        console.log('─'.repeat(70));

        // Buscar TODOS os pedidos do evento (incluindo pendentes)
        const orders = await Order.findAll({
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
            console.log('\nNenhum pedido encontrado para este evento.');
            process.exit(0);
        }

        console.log(`📋 Total de pedidos encontrados: ${orders.length}\n`);

        const fixes = [];
        const frontendUrl = 'https://web.snapli.com.br';

        for (const order of orders) {
            const systemStatus = order.status;
            const systemPaid = ['paid', 'completed'].includes(systemStatus) && order.paidAt;
            const systemAmount = Number(order.totalAmount);

            let asaasStatus = 'SEM_PAYMENT_ID';
            let asaasPaid = false;
            let asaasRefunded = false;
            let asaasData = null;
            let asaasNetValue = null;

            if (order.paymentId) {
                asaasData = await checkAsaasStatus(order.paymentId);
                asaasStatus = asaasData.status || 'ERRO';
                asaasPaid = ['RECEIVED', 'CONFIRMED'].includes(asaasStatus);
                asaasRefunded = ['REFUNDED', 'REFUND_REQUESTED', 'REFUND_IN_PROGRESS'].includes(asaasStatus);

                // Calcular valor líquido (valor original - estorno)
                if (asaasData.value !== undefined) {
                    const refundedValue = asaasData.refundedValue || 0;
                    asaasNetValue = asaasData.value - refundedValue;
                }
            }

            // Determinar tipo de divergência
            let fixType = null;

            if (asaasRefunded && systemStatus !== 'refunded') {
                // Estorno total no Asaas mas sistema não sabe
                fixType = 'REFUND';
            } else if (asaasPaid && !systemPaid) {
                // Pago no Asaas mas pendente no sistema
                fixType = 'PAYMENT';
            } else if (asaasPaid && systemPaid && asaasNetValue !== null) {
                // Pago em ambos, mas verificar valor (estorno parcial)
                const asaasOriginalValue = asaasData.value || 0;
                const refundedValue = asaasData.refundedValue || 0;

                if (refundedValue > 0 && Math.abs(systemAmount - asaasNetValue) > 0.01) {
                    fixType = 'PARTIAL_REFUND';
                } else if (Math.abs(systemAmount - asaasOriginalValue) > 0.01 && refundedValue === 0) {
                    fixType = 'VALUE_MISMATCH';
                }
            }

            // Ícone por status
            let icon = '⏳';
            if (fixType === 'REFUND') icon = '🔴';
            else if (fixType === 'PARTIAL_REFUND') icon = '🟡';
            else if (fixType === 'PAYMENT') icon = '⚠️';
            else if (fixType === 'VALUE_MISMATCH') icon = '🟠';
            else if (systemPaid) icon = '✅';

            const refundInfo = asaasData?.refundedValue ? ` | Estornado: R$ ${asaasData.refundedValue.toFixed(2)}` : '';
            const netInfo = asaasNetValue !== null && asaasData?.refundedValue ? ` | Líquido: R$ ${asaasNetValue.toFixed(2)}` : '';

            console.log(`${icon} ${order.customerName.trim()} (${order.customerEmail})`);
            console.log(`   Sistema: ${systemStatus} R$ ${systemAmount.toFixed(2)} | Asaas: ${asaasStatus} R$ ${(asaasData?.value || 0).toFixed(2)}${refundInfo}${netInfo}`);
            console.log(`   Fotos: ${order.items.length} | Pedido: ${order.id}`);

            if (fixType) {
                const labels = {
                    'REFUND': '🔴 ESTORNO TOTAL: Reembolsado no Asaas',
                    'PARTIAL_REFUND': `🟡 ESTORNO PARCIAL: R$ ${asaasData?.refundedValue?.toFixed(2)} devolvido`,
                    'PAYMENT': `⚠️ PAGAMENTO: Pago no Asaas mas "${systemStatus}" no sistema`,
                    'VALUE_MISMATCH': `🟠 VALOR DIVERGENTE: Sistema R$ ${systemAmount.toFixed(2)} vs Asaas R$ ${asaasData?.value?.toFixed(2)}`
                };
                console.log(`   ${labels[fixType]}`);
                fixes.push({ order, asaasData, fixType, asaasNetValue });
            }

            console.log('');
        }

        // Aplicar correções
        if (fixes.length > 0) {
            console.log('─'.repeat(70));
            console.log(`\n🔧 Corrigindo ${fixes.length} divergência(s)...\n`);

            for (const { order, asaasData, fixType, asaasNetValue } of fixes) {
                console.log(`   📝 ${order.customerName.trim()} — ${fixType}`);

                if (fixType === 'REFUND') {
                    // Estorno total
                    order.status = 'refunded';
                    order.totalAmount = 0;
                    await order.save();
                    console.log(`   ✅ Status → refunded | Valor → R$ 0.00`);

                } else if (fixType === 'PARTIAL_REFUND') {
                    // Estorno parcial — atualiza valor líquido, mantém status paid
                    const oldAmount = Number(order.totalAmount);
                    order.totalAmount = asaasNetValue;
                    await order.save();
                    console.log(`   ✅ Valor atualizado: R$ ${oldAmount.toFixed(2)} → R$ ${asaasNetValue.toFixed(2)}`);

                } else if (fixType === 'PAYMENT') {
                    // Pagamento não registrado
                    order.status = 'paid';
                    order.paidAt = asaasData.confirmedDate || asaasData.paymentDate || new Date();
                    if (asaasData.value) order.totalAmount = asaasData.value;
                    if (!order.downloadToken) {
                        order.downloadToken = crypto.randomBytes(32).toString('hex');
                    }
                    if (!order.downloadExpiresAt) {
                        order.downloadExpiresAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);
                    }
                    await order.save();
                    const downloadLink = `${frontendUrl}/downloads/${order.downloadToken}`;
                    console.log(`   ✅ Status → paid | paidAt: ${order.paidAt}`);
                    console.log(`   🔗 ${downloadLink}`);

                } else if (fixType === 'VALUE_MISMATCH') {
                    // Valor diferente sem estorno
                    const oldAmount = Number(order.totalAmount);
                    order.totalAmount = asaasData.value;
                    await order.save();
                    console.log(`   ✅ Valor atualizado: R$ ${oldAmount.toFixed(2)} → R$ ${asaasData.value.toFixed(2)}`);
                }

                console.log('');
            }
        } else {
            console.log('✅ Nenhuma divergência encontrada. Tudo sincronizado!\n');
        }

        // Gerar relatório final copiável
        console.log('─'.repeat(70));
        console.log('\n📋 RELATÓRIO FINAL PARA ENVIO:\n');

        // Re-buscar com dados atualizados
        const paidOrders = await Order.findAll({
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

        const lines = [];
        lines.push(`📸 *Relatório de Vendas - ${event.name}*`);
        lines.push(`📅 Data: ${new Date(event.date).toLocaleDateString('pt-BR')}`);
        lines.push(`📍 Local: ${event.location || 'N/A'}`);
        lines.push(`🛒 Compradores: ${paidOrders.length}`);
        lines.push('');
        lines.push('---');

        let totalPhotos = 0;
        let totalRevenue = 0;

        paidOrders.forEach((order, i) => {
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
        lines.push(`   Compradores: ${paidOrders.length}`);
        lines.push(`   Fotos vendidas: ${totalPhotos}`);
        lines.push(`   Receita total: R$ ${totalRevenue.toFixed(2)}`);

        const output = lines.join('\n');
        console.log(output + '\n');

    } catch (error) {
        console.error('Erro:', error.message);
    } finally {
        await sequelize.close();
    }
}

main();
