# Snapli Lambda - Image Processing

Lambda function que processa imagens automaticamente quando são enviadas para o bucket S3 de originais.

> **Status**: Em produção desde 28/04/2026. Fluxo 100% assíncrono e validado.

## Funcionalidades

- **Marca d'água** (watermark SVG 4 camadas) na imagem
- **Detecção de faces** usando AWS Rekognition
- **Indexação de faces** na coleção do Rekognition para busca futura
- **Callback HTTP** para API Railway para atualizar o banco de dados

> Thumbnails foram removidos (abril 2026) — apenas `watermarked/` é gerado.

## Deploy (atualizar Lambda existente)

```bash
# 1. Instalar sharp para Linux (rodar uma vez ou se mudar versão)
npm install --os=linux --cpu=x64 --libc=glibc sharp

# 2. Rebuild zip
rm -f function.zip && zip -r function.zip index.js package.json node_modules/

# 3. Deploy via script
cd .. && node scripts/setup/update-lambda.js
```

## Configuração da Lambda no AWS Console

**Configurações básicas:**

- Nome: `snapli-image-processor`
- Runtime: Node.js 18.x
- Architecture: x86_64
- Memory: 1024 MB
- Timeout: 5 minutos
- IAM Role: `snapli-lambda-execution-role`

**Variáveis de ambiente:**

```
WATERMARKED_BUCKET=snapli-watermarked
REKOGNITION_COLLECTION_ID=snapli-faces
API_CALLBACK_URL=https://snapliapi-production.up.railway.app/api/photos/lambda-callback
LAMBDA_INTERNAL_SECRET=<valor do .env>
```

> ⚠️ NÃO setar `AWS_REGION` — é reservado pelo Lambda runtime e causa erro.

**Permissões IAM necessárias (role `snapli-lambda-execution-role`):**

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:GetObject", "s3:PutObject"],
      "Resource": [
        "arn:aws:s3:::snapli-originals/*",
        "arn:aws:s3:::snapli-watermarked/*"
      ]
    },
    {
      "Effect": "Allow",
      "Action": ["rekognition:DetectFaces", "rekognition:IndexFaces"],
      "Resource": "*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "logs:CreateLogGroup",
        "logs:CreateLogStream",
        "logs:PutLogEvents"
      ],
      "Resource": "arn:aws:logs:*:*:*"
    }
  ]
}
```

### Configurar S3 Trigger

No bucket `snapli-originals`, evento configurado:

- Event type: `PUT`
- Prefix: `events/`
- Suffix: `.jpg`, `.jpeg`, `.png`
- Destination: Lambda function `snapli-image-processor`

## Fluxo de Processamento

1. **Upload**: Admin faz upload via `POST /api/photos/upload` — API salva original em `s3://snapli-originals/events/{eventId}/originals/` e cria registro DB com `processingStatus: 'pending'`
2. **Trigger**: S3 aciona Lambda automaticamente
3. **Download**: Lambda baixa imagem original
4. **Processamento**:
   - Aplica watermark SVG (4 camadas: retângulos semitransparentes + texto SNAPLI)
   - Sobe watermarked para `s3://snapli-watermarked/events/{eventId}/watermarked/`
   - Detecta faces com Rekognition (`DetectFaces`)
   - Indexa faces na coleção (`IndexFaces`)
5. **Callback**: `POST {API_CALLBACK_URL}` com header `x-lambda-secret`
   - Payload: `{ originalKey, watermarkedKey, faceCount, faceData, rekognitionFaceId, processingStatus }`
6. **DB atualizado**: API atualiza `processingStatus: 'completed'`, `watermarkedKey`, `faceCount`, `rekognitionFaceId`

## Monitoramento

```bash
# Logs em tempo real
aws logs tail /aws/lambda/snapli-image-processor --follow

# Ou via npm script
cd lambda && npm run logs
```

## Troubleshooting

**Erro: "Task timed out after X seconds"**
- Aumente o timeout (máx 15min, configurado em 5min)
- Imagens muito grandes — considere aumentar memória (mais memória = mais CPU)

**Erro: "Cannot find module 'sharp'"**
- Sharp deve ser instalado com flags linux: `npm install --os=linux --cpu=x64 --libc=glibc sharp`
- Verificar presença de `node_modules/@img/sharp-linux-x64/`

**Erro: "Access Denied" no S3**
- Verificar permissões da role `snapli-lambda-execution-role`

**Callback retorna 401**
- `LAMBDA_INTERNAL_SECRET` na Lambda deve bater com `LAMBDA_INTERNAL_SECRET` no `.env` da API Railway

**Rekognition error: "Collection not found"**
- Criar coleção: `POST /api/setup/rekognition-collection` ou via script `scripts/setup/setup-rekognition.js`

**`AWS_REGION` não funciona como env var**
- É variável reservada do Lambda runtime — remover das env vars configuradas no console
