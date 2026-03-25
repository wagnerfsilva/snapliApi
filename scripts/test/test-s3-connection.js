/**
 * Script para testar conexão com AWS S3
 * Execute: node test-s3-connection.js
 */

// Carrega variáveis de ambiente PRIMEIRO
require('dotenv').config();

const { s3Client, buckets } = require('../src/config/aws');
const { ListObjectsV2Command, PutObjectCommand, HeadBucketCommand } = require('@aws-sdk/client-s3');

const colors = {
    reset: '\x1b[0m',
    green: '\x1b[32m',
    red: '\x1b[31m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m'
};

async function testBucketAccess(bucketName, bucketType) {
    try {
        console.log(`\n${colors.blue}Testando acesso ao bucket: ${bucketName}${colors.reset}`);

        // Verifica se o bucket existe e está acessível
        const headCommand = new HeadBucketCommand({ Bucket: bucketName });
        await s3Client.send(headCommand);
        console.log(`${colors.green}✓ Bucket existe e está acessível${colors.reset}`);

        // Lista objetos (verifica permissão de leitura)
        const listCommand = new ListObjectsV2Command({
            Bucket: bucketName,
            MaxKeys: 1
        });
        await s3Client.send(listCommand);
        console.log(`${colors.green}✓ Permissão de leitura OK${colors.reset}`);

        // Testa upload (verifica permissão de escrita)
        const testKey = `test-${Date.now()}.txt`;
        const putCommand = new PutObjectCommand({
            Bucket: bucketName,
            Key: testKey,
            Body: Buffer.from('Test file from Snapli'),
            ContentType: 'text/plain'
        });
        await s3Client.send(putCommand);
        console.log(`${colors.green}✓ Permissão de escrita OK${colors.reset}`);
        console.log(`${colors.green}✓ Arquivo de teste criado: ${testKey}${colors.reset}`);

        return true;
    } catch (error) {
        console.error(`${colors.red}✗ Erro ao testar bucket ${bucketName}:${colors.reset}`, error.message);
        if (error.name === 'NoSuchBucket') {
            console.error(`${colors.yellow}  → O bucket não existe. Verifique o nome.${colors.reset}`);
        } else if (error.name === 'AccessDenied') {
            console.error(`${colors.yellow}  → Sem permissão. Verifique as credenciais IAM.${colors.reset}`);
        } else if (error.name === 'InvalidAccessKeyId') {
            console.error(`${colors.yellow}  → Access Key ID inválido.${colors.reset}`);
        } else if (error.name === 'SignatureDoesNotMatch') {
            console.error(`${colors.yellow}  → Secret Access Key inválido.${colors.reset}`);
        }
        return false;
    }
}

async function testConnection() {
    console.log(`${colors.blue}═══════════════════════════════════════════${colors.reset}`);
    console.log(`${colors.blue}  Teste de Conexão AWS S3 - Snapli${colors.reset}`);
    console.log(`${colors.blue}═══════════════════════════════════════════${colors.reset}`);

    // Verifica variáveis de ambiente
    console.log(`\n${colors.blue}Configurações:${colors.reset}`);
    console.log(`Region: ${process.env.AWS_REGION || colors.red + 'NÃO DEFINIDA' + colors.reset}`);
    console.log(`Access Key ID: ${process.env.AWS_ACCESS_KEY_ID ? '****' + process.env.AWS_ACCESS_KEY_ID.slice(-4) : colors.red + 'NÃO DEFINIDA' + colors.reset}`);
    console.log(`Secret Access Key: ${process.env.AWS_SECRET_ACCESS_KEY ? '****' + process.env.AWS_SECRET_ACCESS_KEY.slice(-4) : colors.red + 'NÃO DEFINIDA' + colors.reset}`);
    console.log(`Bucket Original: ${buckets.original || colors.red + 'NÃO DEFINIDO' + colors.reset}`);
    console.log(`Bucket Watermarked: ${buckets.watermarked || colors.red + 'NÃO DEFINIDO' + colors.reset}`);

    // Verifica se todas as variáveis estão definidas
    if (!process.env.AWS_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID === 'your-aws-access-key') {
        console.error(`\n${colors.red}✗ AWS_ACCESS_KEY_ID não está configurado corretamente!${colors.reset}`);
        console.log(`${colors.yellow}  Atualize o arquivo .env com sua AWS Access Key ID${colors.reset}`);
        process.exit(1);
    }

    if (!process.env.AWS_SECRET_ACCESS_KEY || process.env.AWS_SECRET_ACCESS_KEY === 'your-aws-secret-key') {
        console.error(`\n${colors.red}✗ AWS_SECRET_ACCESS_KEY não está configurado corretamente!${colors.reset}`);
        console.log(`${colors.yellow}  Atualize o arquivo .env com sua AWS Secret Access Key${colors.reset}`);
        process.exit(1);
    }

    // Testa buckets
    const results = [];

    if (buckets.original) {
        const result = await testBucketAccess(buckets.original, 'Original Photos');
        results.push({ name: 'Original', success: result });
    }

    if (buckets.watermarked) {
        const result = await testBucketAccess(buckets.watermarked, 'Watermarked Photos');
        results.push({ name: 'Watermarked', success: result });
    }

    // Resumo
    console.log(`\n${colors.blue}═══════════════════════════════════════════${colors.reset}`);
    console.log(`${colors.blue}  Resumo dos Testes${colors.reset}`);
    console.log(`${colors.blue}═══════════════════════════════════════════${colors.reset}`);

    results.forEach(result => {
        const status = result.success
            ? `${colors.green}✓ SUCESSO${colors.reset}`
            : `${colors.red}✗ FALHOU${colors.reset}`;
        console.log(`Bucket ${result.name}: ${status}`);
    });

    const allSuccess = results.every(r => r.success);
    if (allSuccess) {
        console.log(`\n${colors.green}✓ Todos os testes passaram! S3 está configurado corretamente.${colors.reset}`);
    } else {
        console.log(`\n${colors.red}✗ Alguns testes falharam. Verifique as configurações acima.${colors.reset}`);
        process.exit(1);
    }
}

// Executa testes
testConnection()
    .then(() => {
        console.log(`\n${colors.green}Teste concluído com sucesso!${colors.reset}\n`);
        process.exit(0);
    })
    .catch(error => {
        console.error(`\n${colors.red}Erro fatal:${colors.reset}`, error);
        process.exit(1);
    });
