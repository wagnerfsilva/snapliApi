# Fotow Lambda - Image Processing

Lambda function que processa imagens automaticamente quando são enviadas para o bucket S3 de originais.

## Funcionalidades

- **Detecção de faces** usando AWS Rekognition
- **Indexação de faces** na coleção do Rekognition para busca futura
- **Criação de versão com marca d'água** para preview
- **Geração de thumbnails** para melhor performance
- **Upload automático** para bucket de imagens processadas

## Deployment

### 1. Instalar dependências

```bash
npm install
```

### 2. Criar arquivo zip

```bash
zip -r function.zip .
```

### 3. Criar função Lambda no AWS Console

**Configurações básicas:**

- Runtime: Node.js 18.x
- Architecture: x86_64
- Memory: 1024 MB
- Timeout: 5 minutes
- Ephemeral storage: 1024 MB

**Variáveis de ambiente:**

```
AWS_REGION=us-east-1
WATERMARKED_BUCKET=fotow-watermarked
REKOGNITION_COLLECTION_ID=fotow-faces
WATERMARK_TEXT=FOTOW
WATERMARK_OPACITY=0.3
```

**Permissões IAM necessárias:**

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:GetObject", "s3:PutObject"],
      "Resource": [
        "arn:aws:s3:::fotow-originals/*",
        "arn:aws:s3:::fotow-watermarked/*"
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

### 4. Configurar S3 Trigger

No bucket `fotow-originals`, adicione um evento:

- Event type: `PUT`, `POST`
- Prefix: `events/`
- Suffix: `.jpg`, `.jpeg`, `.png`, `.webp`
- Destination: Lambda function `fotow-image-processor`

### 5. Deploy usando AWS CLI

```bash
# Upload do código
npm run deploy

# Ou manualmente:
aws lambda create-function \
  --function-name fotow-image-processor \
  --runtime nodejs18.x \
  --role arn:aws:iam::YOUR_ACCOUNT:role/lambda-execution-role \
  --handler index.handler \
  --zip-file fileb://function.zip \
  --timeout 300 \
  --memory-size 1024
```

## Fluxo de Processamento

1. **Upload**: Admin faz upload da imagem para `s3://fotow-originals/events/{eventId}/originals/`
2. **Trigger**: S3 aciona a função Lambda
3. **Download**: Lambda baixa a imagem original
4. **Processamento**:
   - Detecta faces com Rekognition
   - Indexa faces na coleção para busca
   - Cria versão com marca d'água (max 1920px)
   - Gera thumbnail (300x300px)
5. **Upload**: Envia imagens processadas para `s3://fotow-watermarked/`
6. **Conclusão**: Backend atualiza status no banco de dados

## Monitoramento

Verifique logs no CloudWatch:

```bash
aws logs tail /aws/lambda/fotow-image-processor --follow
```

## Testes Locais

Não é possível testar completamente localmente devido às dependências da AWS.
Use o AWS SAM para testes locais:

```bash
sam local invoke fotow-image-processor -e test-event.json
```

## Troubleshooting

**Erro: "Task timed out after X seconds"**

- Aumente o timeout da função
- Aumente a memória (mais memória = mais CPU)

**Erro: "Cannot find module 'sharp'"**

- Sharp precisa ser compilado para Lambda
- Use uma layer ou compile em ambiente Linux

**Erro: "Access Denied" no S3**

- Verifique as permissões IAM
- Confirme que os buckets existem

**Rekognition error: "Collection not found"**

- Crie a coleção primeiro usando o backend
- Execute: `POST /api/setup/rekognition-collection`
