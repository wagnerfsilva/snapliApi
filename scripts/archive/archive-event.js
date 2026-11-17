require('dotenv').config();
const readline = require('node:readline/promises');
const { sequelize } = require('../../src/models');
const { archiveEvent, UNPAID_GRACE_DAYS } = require('../../src/services/event-archive.service');

// Uso: node scripts/archive/archive-event.js --event-id <uuid> [--dry-run] [--yes]
// Remove do S3 todas as fotos/thumbs/previews/vídeos do evento e as faces do Rekognition.
// Os registros do banco (fotos, pedidos) são mantidos para que métricas e relatórios não mudem.
// A operação é irreversível.

function parseArgs(argv) {
    const args = { dryRun: false, yes: false, eventId: null };
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === '--event-id') args.eventId = argv[++i];
        else if (argv[i] === '--dry-run') args.dryRun = true;
        else if (argv[i] === '--yes') args.yes = true;
    }
    return args;
}

async function confirm(eventId, summary) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const answer = await rl.question(
        `Remover ${summary.originalObjects} objeto(s) do bucket original, ${summary.watermarkedObjects} do bucket de watermark ` +
        `e ${summary.faces} face(s) do Rekognition do evento ${eventId}? IRREVERSÍVEL. Digite "arquivar" para continuar: `
    );
    rl.close();
    return answer.trim() === 'arquivar';
}

async function run() {
    const { eventId, dryRun, yes } = parseArgs(process.argv.slice(2));
    if (!eventId) {
        console.error('Uso: node scripts/archive/archive-event.js --event-id <uuid> [--dry-run] [--yes]');
        return 1;
    }

    const preview = await archiveEvent(eventId, { dryRun: true });
    if (preview.blockers.length > 0) {
        console.error('Evento NÃO pode ser arquivado:');
        preview.blockers.forEach(blocker => console.error(` - ${blocker.message}`));
        console.error(`(prazo de download vencido em todos os pedidos pagos e nenhum pedido não pago com menos de ${UNPAID_GRACE_DAYS} dias)`);
        return 2;
    }

    console.log('Resumo do que será removido:', preview.summary);
    if (dryRun) {
        console.log('Dry-run: nada foi alterado.');
        return 0;
    }

    if (!yes && !(await confirm(eventId, preview.summary))) {
        console.log('Cancelado.');
        return 0;
    }

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
