require('dotenv').config();
const readline = require('node:readline/promises');
const { sequelize } = require('../../src/models');
const { archiveEvent, getEventOverview, UNPAID_GRACE_DAYS } = require('../../src/services/event-archive.service');

// Uso: node scripts/archive/archive-event.js <event-id> [--dry-run] [--yes]
// Mostra os dados do evento, informa se ele pode ser arquivado e pede confirmação.
// Remove do S3 todas as fotos/thumbs/previews/vídeos do evento e as faces do Rekognition.
// Os registros do banco (fotos, pedidos) são mantidos para que métricas e relatórios não mudem.
// A operação é irreversível.

const USAGE = 'Uso: node scripts/archive/archive-event.js <event-id> [--dry-run] [--yes]';

function parseArgs(argv) {
    const args = { dryRun: false, yes: false, eventId: null };
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === '--event-id') args.eventId = argv[++i];
        else if (argv[i] === '--dry-run') args.dryRun = true;
        else if (argv[i] === '--yes') args.yes = true;
        else if (!argv[i].startsWith('--')) args.eventId = argv[i];
    }
    return args;
}

const formatDate = (date, timeZone) => (date ? new Date(date).toLocaleDateString('pt-BR', { timeZone }) : '—');

function printOverview({ event, orders, blockers }) {
    console.log('\n=== Evento ===');
    console.log(`Nome:            ${event.name}`);
    console.log(`ID:              ${event.id}`);
    console.log(`Data:            ${formatDate(event.date, 'UTC')}`);
    console.log(`Local:           ${event.location || '—'}`);
    console.log(`Ativo:           ${event.isActive ? 'sim' : 'não'}`);
    console.log(`Fotos / vídeos:  ${event.photoCount} / ${event.videoCount}`);
    console.log(`Pedidos pagos:   ${orders.paid} (+ ${orders.courtesy} cortesia)`);
    console.log(`Pedidos em aberto (pending/processing): ${orders.unpaid}`);
    console.log(`Último prazo de download: ${formatDate(orders.lastDownloadExpiry)}`);

    console.log('\n=== Pode ser arquivado? ===');
    if (blockers.length === 0) {
        console.log(`SIM — todos os prazos de download expiraram e não há pedido em aberto com menos de ${UNPAID_GRACE_DAYS} dias.`);
    } else {
        console.log('NÃO. Motivos:');
        blockers.forEach(blocker => console.log(` - ${blocker.message}`));
    }
}

async function confirm(event, summary) {
    console.log('\n=== Será removido (IRREVERSÍVEL) ===');
    console.log(`Bucket original:   ${summary.originalObjects} objeto(s)`);
    console.log(`Bucket watermark:  ${summary.watermarkedObjects} objeto(s)`);
    console.log(`Rekognition:       ${summary.faces} face(s)`);
    console.log('O evento continua contando em métricas, dashboard e relatórios.\n');

    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const answer = await rl.question(`Digite o nome do evento ("${event.name}") para confirmar o arquivamento: `);
    rl.close();
    return answer.trim() === event.name.trim();
}

async function run() {
    const { eventId, dryRun, yes } = parseArgs(process.argv.slice(2));
    if (!eventId) {
        console.error(USAGE);
        return 1;
    }

    const overview = await getEventOverview(eventId);
    printOverview(overview);
    if (overview.blockers.length > 0) return 2;

    const preview = await archiveEvent(eventId, { dryRun: true });
    if (dryRun) {
        console.log('\nBucket original:', preview.summary.originalObjects, '| watermark:', preview.summary.watermarkedObjects, '| faces:', preview.summary.faces);
        console.log('Dry-run: nada foi alterado.');
        return 0;
    }

    if (!yes && !(await confirm(overview.event, preview.summary))) {
        console.log('Cancelado. Nada foi alterado.');
        return 0;
    }

    console.log('\nArquivando... (pode levar alguns minutos)');
    const result = await archiveEvent(eventId);
    if (!result.archived) {
        console.error('Arquivamento abortado:');
        result.blockers.forEach(blocker => console.error(` - ${blocker.message}`));
        return 2;
    }

    console.log('Evento arquivado com sucesso:', result.summary);
    return 0;
}

run()
    .catch(error => {
        console.error('ERRO FATAL (rode novamente para continuar; é idempotente):', error.message);
        return 1;
    })
    .then(async code => {
        await sequelize.close().catch(() => {});
        process.exit(code);
    });
