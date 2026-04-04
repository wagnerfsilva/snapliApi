/**
 * Análise detalhada: Asaas fees vs Sistema
 * Compara valor bruto, líquido (netValue) e taxas de cada transação
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });

const axios = require('axios');
const { Order, OrderItem, Photo, sequelize, Event } = require('../../src/models');

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

async function main() {
    await sequelize.authenticate();
    const eventId = process.argv[2] || '803bff31-1dab-4ef9-8223-5a0ade60ca32';

    const event = await Event.findByPk(eventId);
    if (!event) { console.error('Evento não encontrado'); process.exit(1); }

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

    let totalBruto = 0, totalLiquido = 0, totalTaxas = 0;
    let totalEstornado = 0;
    const received = [];
    const refunded = [];
    const overdue = [];

    for (const order of orders) {
        if (!order.paymentId) continue;
        try {
            const resp = await asaasClient.get(`/payments/${order.paymentId}`);
            const p = resp.data;
            const value = p.value || 0;
            const netValue = p.netValue || 0;
            const fee = +(value - netValue).toFixed(2);

            if (p.status === 'RECEIVED' || p.status === 'CONFIRMED') {
                totalBruto += value;
                totalLiquido += netValue;
                totalTaxas += fee;
                received.push({ status: p.status, value, netValue, fee, paymentId: order.paymentId });
            } else if (p.status === 'REFUNDED') {
                totalEstornado += value;
                refunded.push({ status: p.status, value, netValue, paymentId: order.paymentId });
            } else {
                overdue.push({ status: p.status, value, paymentId: order.paymentId });
            }
        } catch(e) {
            console.log(`ERR: ${order.paymentId} - ${e.message}`);
        }
    }

    console.log('══════════════════════════════════════════════════════════════');
    console.log(`ANÁLISE FINANCEIRA DETALHADA - ${event.name}`);
    console.log('══════════════════════════════════════════════════════════════');

    console.log(`\n✅ RECEBIDOS (${received.length} transações):`);
    received.forEach(r => {
        console.log(`   ${r.status} | Bruto R$ ${r.value.toFixed(2)} → Líquido R$ ${r.netValue.toFixed(2)} (taxa R$ ${r.fee.toFixed(2)})`);
    });

    console.log(`\n🔴 ESTORNADOS (${refunded.length} transações):`);
    refunded.forEach(r => {
        console.log(`   ${r.status} | R$ ${r.value.toFixed(2)} (netValue R$ ${r.netValue.toFixed(2)})`);
    });

    console.log(`\n⏳ PENDENTES/VENCIDOS (${overdue.length} transações):`);
    overdue.forEach(r => {
        console.log(`   ${r.status} | R$ ${r.value.toFixed(2)}`);
    });

    console.log('\n══════════════════════════════════════════════════════════════');
    console.log(`💰 Total bruto recebido (RECEIVED):    R$ ${totalBruto.toFixed(2)}`);
    console.log(`💸 Total taxas Asaas:                  R$ ${totalTaxas.toFixed(2)}`);
    console.log(`✅ Total líquido (netValue):           R$ ${totalLiquido.toFixed(2)}`);
    console.log(`🔴 Total estornado (REFUNDED):         R$ ${totalEstornado.toFixed(2)}`);
    console.log('──────────────────────────────────────────────────────────────');
    const saldoEsperado = +(totalLiquido - totalEstornado).toFixed(2);
    const saldoReal = 900.35;
    const diff = +(saldoEsperado - saldoReal).toFixed(2);
    console.log(`📊 Saldo esperado (líquido - estornos): R$ ${saldoEsperado.toFixed(2)}`);
    console.log(`📊 Saldo real no Asaas:                 R$ ${saldoReal.toFixed(2)}`);
    console.log(`📊 Diferença não explicada:             R$ ${diff.toFixed(2)}`);
    console.log('══════════════════════════════════════════════════════════════');

    // Receita no sistema vs realidade
    console.log('\n📋 COMPARATIVO SISTEMA vs ASAAS:');
    console.log(`   Sistema mostra receita:  R$ 970.00`);
    console.log(`   Asaas bruto recebido:    R$ ${totalBruto.toFixed(2)}`);
    console.log(`   Asaas líquido:           R$ ${totalLiquido.toFixed(2)}`);
    console.log(`   Saldo conta Asaas:       R$ ${saldoReal.toFixed(2)}`);

    await sequelize.close();
}

main().catch(e => { console.error(e); process.exit(1); });
