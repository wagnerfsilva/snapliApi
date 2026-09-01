/**
 * Teste completo end-to-end do fluxo do perfil Organizador.
 * Chama os controllers diretamente (com req/res mockados) para exercitar
 * validação, permissões e regras de negócio reais. Cria dados reais no banco
 * de produção e os REMOVE no final (bloco finally), independente de sucesso/falha.
 *
 * Uso: node scripts/test/test-organizador-flow.js
 */

const { sequelize, User, Event, Photo, Order, OrderItem, WithdrawalRequest } = require('../../src/models');

const userController = require('../../src/controllers/user.controller');
const eventController = require('../../src/controllers/event.controller');
const withdrawalController = require('../../src/controllers/withdrawal.controller');

let passed = 0;
let failed = 0;

function assert(condition, message) {
    if (condition) {
        passed++;
        console.log(`  OK   ${message}`);
    } else {
        failed++;
        console.log(`  FAIL ${message}`);
    }
}

// Mock res/next capturing status+body synchronously via a promise wrapper.
// JSON round-trip mirrors real Express res.json() (invokes toJSON() on Sequelize
// instances, flattening dataValues) — without it, raw model instances don't expose
// ad-hoc literal attributes (e.g. totalRevenue) as plain properties like real HTTP does.
function invoke(controllerFn, req) {
    return new Promise((resolve) => {
        const res = {
            statusCode: 200,
            status(code) { this.statusCode = code; return this; },
            json(body) { resolve({ status: this.statusCode, body: JSON.parse(JSON.stringify(body)) }); }
        };
        const next = (err) => resolve({ status: 500, body: { success: false, message: err?.message, error: err } });
        controllerFn(req, res, next);
    });
}

async function main() {
    console.log('\n=== TESTE COMPLETO: Fluxo do Organizador ===\n');

    const testEmail = `organizador.teste.${Date.now()}@snapli-test.com`;
    let adminUser, organizadorId, secondOrganizadorId, eventId, photoId;
    const orderIds = [];
    const withdrawalIds = [];

    try {
        adminUser = await User.findOne({ where: { role: 'admin' } });
        assert(!!adminUser, 'Encontrou um usuário admin existente para usar como criador do evento de teste');
        if (!adminUser) throw new Error('Sem admin no banco — não é possível continuar o teste');

        // --- 1. Criação de organizador (user.controller.create) ---
        console.log('\n-- Criação de usuários --');

        let r = await invoke(userController.create, {
            body: { name: 'Organizador Teste', email: testEmail, password: 'senha123', role: 'organizador' }
        });
        assert(r.status === 201 && r.body.success, 'Cria organizador com sucesso (201)');
        organizadorId = r.body?.data?.user?.id;

        r = await invoke(userController.create, {
            body: { name: 'Hacker', email: `hacker.${Date.now()}@snapli-test.com`, password: 'senha123', role: 'admin' }
        });
        assert(r.status === 400, 'Bloqueia criação de usuário com role=admin (400)');

        r = await invoke(userController.create, {
            body: { name: 'Duplicado', email: testEmail, password: 'senha123', role: 'organizador' }
        });
        assert(r.status === 409, 'Bloqueia criação com email duplicado (409)');

        r = await invoke(userController.searchOrganizers, { query: { q: 'Organizador Teste' } });
        assert(
            r.status === 200 && r.body.data.users.some((u) => u.id === organizadorId),
            'searchOrganizers encontra o organizador criado pelo nome'
        );

        // Segundo organizador, para validar isolamento (não deve enxergar dados do primeiro)
        r = await invoke(userController.create, {
            body: { name: 'Organizador Teste 2', email: `organizador2.${Date.now()}@snapli-test.com`, password: 'senha123', role: 'organizador' }
        });
        secondOrganizadorId = r.body?.data?.user?.id;
        assert(!!secondOrganizadorId, 'Cria segundo organizador (para teste de isolamento)');

        // --- 2. Criação de evento com organizador + comissão ---
        console.log('\n-- Criação de evento --');

        r = await invoke(eventController.create, {
            userId: adminUser.id,
            body: {
                name: `Evento Teste Organizador ${Date.now()}`,
                date: new Date().toISOString(),
                location: 'Local de Teste',
                organizerId: organizadorId,
                organizerCommissionPercentage: 10
            }
        });
        assert(r.status === 201 && r.body.success, 'Cria evento com organizerId + comissão 10% (201)');
        eventId = r.body?.data?.event?.id;
        assert(r.body?.data?.event?.organizerId === organizadorId, 'Evento salvo com organizerId correto');

        r = await invoke(eventController.create, {
            userId: adminUser.id,
            body: {
                name: 'Evento Inválido',
                date: new Date().toISOString(),
                location: 'Local',
                organizerId: adminUser.id, // não é organizador
                organizerCommissionPercentage: 10
            }
        });
        assert(r.status === 400, 'Bloqueia organizerId que não referencia um usuário organizador (400)');

        // --- 3. Simula vendas pagas (fotos + pedidos), fora dos controllers (dado de apoio) ---
        console.log('\n-- Simulação de vendas pagas --');

        const photo = await Photo.create({
            eventId,
            originalFilename: 'teste.jpg',
            originalKey: `events/${eventId}/originals/teste.jpg`,
            uploadedBy: adminUser.id,
            processingStatus: 'completed'
        });
        photoId = photo.id;

        const order1 = await Order.create({ customerName: 'Cliente Um', customerEmail: 'cliente1@teste.com', status: 'paid', totalAmount: 100 });
        const order2 = await Order.create({ customerName: 'Cliente Dois', customerEmail: 'cliente2@teste.com', status: 'paid', totalAmount: 50 });
        orderIds.push(order1.id, order2.id);
        await OrderItem.create({ orderId: order1.id, photoId, price: 100 });
        await OrderItem.create({ orderId: order2.id, photoId, price: 50 });

        assert(true, 'Criados 2 pedidos pagos totalizando R$ 150,00 vinculados ao evento de teste');

        // --- 4. Listagem/permissões de evento por role ---
        console.log('\n-- Permissões de leitura de evento --');

        r = await invoke(eventController.getAll, {
            userRole: 'organizador', userId: organizadorId,
            query: {}
        });
        const ownEvents = r.body?.data?.events || [];
        assert(
            r.status === 200 && ownEvents.some((e) => e.id === eventId) && ownEvents.length === 1,
            'Organizador enxerga apenas o próprio evento em getAll'
        );
        const totalRevenueSeen = parseFloat(ownEvents.find((e) => e.id === eventId)?.totalRevenue || 0);
        assert(totalRevenueSeen === 150, `totalRevenue calculado corretamente no getAll (esperado 150, obtido ${totalRevenueSeen})`);

        r = await invoke(eventController.getAll, {
            userRole: 'organizador', userId: secondOrganizadorId,
            query: {}
        });
        const otherEvents = r.body?.data?.events || [];
        assert(otherEvents.length === 0, 'Segundo organizador não enxerga o evento do primeiro (isolamento)');

        r = await invoke(eventController.getById, { userRole: 'organizador', userId: secondOrganizadorId, params: { id: eventId } });
        assert(r.status === 403, 'Segundo organizador recebe 403 ao tentar acessar getById do evento alheio');

        // --- 5. Saldo/comissão ---
        console.log('\n-- Saldo e comissão --');

        r = await invoke(withdrawalController.getBalance, { userRole: 'organizador', userId: organizadorId, params: { eventId } });
        assert(r.status === 200, 'getBalance retorna 200 para o organizador dono do evento');
        const balance = r.body?.data?.balance;
        assert(balance?.totalRevenue === 150, `balance.totalRevenue == 150 (obtido ${balance?.totalRevenue})`);
        assert(balance?.commissionTotal === 15, `balance.commissionTotal == 15 (10% de 150) (obtido ${balance?.commissionTotal})`);
        assert(balance?.availableBalance === 15, `balance.availableBalance == 15 antes de qualquer resgate (obtido ${balance?.availableBalance})`);
        assert(r.body?.data?.hasOpenRequest === false, 'hasOpenRequest == false antes de qualquer solicitação');

        r = await invoke(withdrawalController.getBalance, { userRole: 'organizador', userId: secondOrganizadorId, params: { eventId } });
        assert(r.status === 403, 'Segundo organizador recebe 403 ao tentar ver saldo de evento alheio');

        // --- 6. Solicitação de resgate ---
        console.log('\n-- Solicitação de resgate --');

        r = await invoke(withdrawalController.create, {
            userRole: 'organizador', userId: organizadorId,
            body: { eventId, amount: 1000, notes: 'valor absurdo' }
        });
        assert(r.status === 400, 'Bloqueia solicitação de valor maior que o saldo disponível (400)');

        r = await invoke(withdrawalController.create, {
            userRole: 'organizador', userId: organizadorId,
            body: { eventId, amount: 10, notes: 'primeiro resgate' }
        });
        assert(r.status === 201 && r.body?.data?.withdrawalRequest?.status === 'pending', 'Cria solicitação de resgate válida (201, status pending)');
        const firstWithdrawalId = r.body?.data?.withdrawalRequest?.id;
        if (firstWithdrawalId) withdrawalIds.push(firstWithdrawalId);

        r = await invoke(withdrawalController.create, {
            userRole: 'organizador', userId: organizadorId,
            body: { eventId, amount: 1, notes: 'segundo resgate enquanto o primeiro está aberto' }
        });
        assert(r.status === 400, 'Bloqueia segunda solicitação enquanto já existe uma aberta (400)');

        r = await invoke(withdrawalController.getAll, { userRole: 'admin', query: {} });
        assert(
            r.status === 200 && r.body?.data?.withdrawalRequests?.some((w) => w.id === firstWithdrawalId),
            'Admin vê a solicitação de resgate na listagem geral'
        );

        r = await invoke(withdrawalController.getAll, { userRole: 'organizador', userId: secondOrganizadorId, query: {} });
        assert(
            !r.body?.data?.withdrawalRequests?.some((w) => w.id === firstWithdrawalId),
            'Segundo organizador não vê solicitação de resgate alheia na listagem'
        );

        // --- 7. Aprovação/transições de status (admin) ---
        console.log('\n-- Transições de status (admin) --');

        r = await invoke(withdrawalController.updateStatus, {
            userId: adminUser.id,
            params: { id: firstWithdrawalId }, body: { status: 'paid' }
        });
        assert(r.status === 400, 'Bloqueia transição inválida pending -> paid direto (400)');

        r = await invoke(withdrawalController.updateStatus, {
            userId: adminUser.id,
            params: { id: firstWithdrawalId }, body: { status: 'approved' }
        });
        assert(r.status === 200 && r.body?.data?.withdrawalRequest?.status === 'approved', 'Aprova solicitação pending -> approved (200)');

        r = await invoke(withdrawalController.getBalance, { userRole: 'organizador', userId: organizadorId, params: { eventId } });
        assert(r.body?.data?.hasOpenRequest === true, 'hasOpenRequest continua true com status approved (ainda é "aberto")');
        assert(r.body?.data?.balance?.availableBalance === 5, `availableBalance reduz para 5 (15 - 10 reservado) (obtido ${r.body?.data?.balance?.availableBalance})`);

        r = await invoke(withdrawalController.updateStatus, {
            userId: adminUser.id,
            params: { id: firstWithdrawalId }, body: { status: 'paid' }
        });
        assert(r.status === 200 && r.body?.data?.withdrawalRequest?.status === 'paid', 'Marca solicitação approved -> paid (200)');

        r = await invoke(withdrawalController.getBalance, { userRole: 'organizador', userId: organizadorId, params: { eventId } });
        assert(r.body?.data?.hasOpenRequest === false, 'hasOpenRequest volta a false após status paid');

        r = await invoke(withdrawalController.create, {
            userRole: 'organizador', userId: organizadorId,
            body: { eventId, amount: 5, notes: 'segundo ciclo, após o primeiro ser pago' }
        });
        assert(r.status === 201, 'Nova solicitação pode ser criada após a anterior virar paid (201)');
        const secondWithdrawalId = r.body?.data?.withdrawalRequest?.id;
        if (secondWithdrawalId) withdrawalIds.push(secondWithdrawalId);

        r = await invoke(withdrawalController.updateStatus, {
            userId: adminUser.id,
            params: { id: secondWithdrawalId }, body: { status: 'rejected' }
        });
        assert(r.status === 200 && r.body?.data?.withdrawalRequest?.status === 'rejected', 'Rejeita solicitação pending -> rejected (200)');

        // --- 8. Segurança: gap de PII em /orders/event/:eventId ---
        console.log('\n-- Segurança adicional --');
        const orderController = require('../../src/controllers/order.controller');
        const fakeRes = { statusCode: 200, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; } };
        await orderController.listOrdersByEvent({ userRole: 'organizador', params: { eventId } }, fakeRes);
        assert(fakeRes.statusCode === 403, 'organizador bloqueado (403) em GET /orders/event/:eventId (PII)');

    } catch (error) {
        failed++;
        console.error('\nERRO INESPERADO DURANTE O TESTE:', error);
    } finally {
        console.log('\n-- Limpeza dos dados de teste --');
        try {
            if (withdrawalIds.length) await WithdrawalRequest.destroy({ where: { id: withdrawalIds } });
            if (orderIds.length) await OrderItem.destroy({ where: { orderId: orderIds } });
            if (orderIds.length) await Order.destroy({ where: { id: orderIds } });
            if (photoId) await Photo.destroy({ where: { id: photoId } });
            if (eventId) await Event.destroy({ where: { id: eventId } });
            // Apaga também o "Evento Inválido" não deveria ter sido criado, mas por segurança:
            await Event.destroy({ where: { name: 'Evento Inválido' } });
            if (organizadorId) await User.destroy({ where: { id: organizadorId } });
            if (secondOrganizadorId) await User.destroy({ where: { id: secondOrganizadorId } });
            await User.destroy({ where: { email: { [require('sequelize').Op.like]: '%@snapli-test.com' } } });
            console.log('  Dados de teste removidos com sucesso.');
        } catch (cleanupError) {
            console.error('  FALHA NA LIMPEZA — verifique manualmente:', cleanupError.message);
        }
    }

    console.log(`\n=== Resultado: ${passed} passaram, ${failed} falharam ===\n`);
    await sequelize.close();
    process.exit(failed > 0 ? 1 : 0);
}

main();
