# Arquitetura do Sistema Snapli

## 📐 Visão Geral

```
┌─────────────────────────────────────────────────────────────────┐
│                         CLIENTE (Navegador)                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────────┐              ┌──────────────────┐        │
│  │  Interface       │              │  Interface       │        │
│  │  Pública         │              │  Admin           │        │
│  │  (React)         │              │  (React)         │        │
│  └────────┬─────────┘              └────────┬─────────┘        │
│           │                                  │                   │
│           │        ┌────────────────────────┘                   │
│           │        │                                             │
└───────────┼────────┼─────────────────────────────────────────────┘
            │        │
            ▼        ▼
    ┌───────────────────────────┐
    │     API Backend           │
    │   (Node.js + Express)     │
    ├───────────────────────────┤
    │  • Autenticação JWT       │
    │  • CRUD Eventos           │
    │  • Upload Fotos           │
    │  • Busca Facial           │
    │  • Gestão de Pedidos      │
    └─────┬──────────┬──────────┘
          │          │
          │          └──────────────────┐
          ▼                             ▼
    ┌─────────────┐           ┌──────────────────┐
    │  Supabase   │           │   AWS Services   │
    │ (PostgreSQL)│           └──────────────────┘
    └─────────────┘                    │
                                       │
                  ┌────────────────────┼────────────────────┐
                  │                    │                     │
                  ▼                    ▼                     ▼
         ┌────────────────┐  ┌─────────────────┐  ┌────────────────┐
         │   S3 Bucket A  │  │   S3 Bucket B   │  │  Rekognition   │
         │   (Originals)  │  │ (Watermarked)   │  │   Collection   │
         │    [Private]   │  │    [Public]     │  │                │
         └────────┬───────┘  └─────────────────┘  └────────────────┘
                  │
                  │ (S3 Event Trigger)
                  │
                  ▼
         ┌────────────────┐
         │  Lambda        │
         │  Image         │
         │  Processor     │
         └────────────────┘
```

## 🔄 Fluxo de Upload e Processamento

```
Admin Interface
      │
      │ 1. Select Event & Photos
      ▼
  ┌──────────────┐
  │  Frontend    │
  └──────┬───────┘
         │ 2. POST /api/photos/upload
         │    (multipart/form-data)
         ▼
  ┌──────────────┐
  │   Backend    │─────► 3. Save to DB (status: pending)
  │   API        │
  └──────┬───────┘
         │ 4. Upload original to S3 Bucket A
         ▼
  ┌──────────────────────┐
  │  S3 Bucket A         │
  │  snapli-originals/    │
  │  events/{id}/        │
  │    originals/        │
  └──────┬───────────────┘
         │ 5. S3 Event Trigger (automático)
         ▼
  ┌───────────────────────────┐
  │  Lambda                   │
  │  snapli-image-processor   │
  ├───────────────────────────┤
  │  6. Download original     │
  │  7. Apply watermark (SVG) │
  │  8. Upload watermarked    │──► S3 Bucket B
  │  9. Detect faces          │◄──┐
  │ 10. Index faces           │   │ AWS Rekognition
  │ 11. POST /lambda-callback │───┘ (x-lambda-secret)
  └──────┬────────────────────┘
         │ 12. API atualiza DB
         │     processingStatus: completed
         │     watermarkedKey, faceCount, rekognitionFaceId
         ▼
  ┌──────────────────────┐
  │  S3 Bucket B         │
  │  snapli-watermarked/  │
  │  events/{id}/        │
  │    watermarked/      │
  └──────────────────────┘
```

## 🔍 Fluxo de Busca Facial

```
Cliente (sem login)
      │
      │ 1. Upload/Capture Photo
      ▼
  ┌──────────────┐
  │  Frontend    │
  │  (Public)    │
  └──────┬───────┘
         │ 2. POST /api/search/face
         │    (searchPhoto file)
         ▼
  ┌──────────────────────┐
  │   Backend API        │
  ├──────────────────────┤
  │  3. Receive image    │
  │  4. Call Rekognition │───┐
  └──────┬───────────────┘   │
         │                   │ 4a. SearchFacesByImage
         │                   │     (compare with collection)
         │                   │
         │ ◄─────────────────┘ 5. Return matches with
         │                        similarity scores
         │ 6. Query DB for photo IDs
         ▼
  ┌──────────────────────┐
  │   Supabase           │
  │  (PostgreSQL)        │
  └──────┬───────────────┘
         │ 7. Return photo metadata
         ▼
  ┌──────────────────────┐
  │   Backend API        │
  │  8. Build response   │
  │     with URLs from   │
  │     Bucket B         │
  └──────┬───────────────┘
         │ 9. Return results
         ▼
  ┌──────────────┐
  │  Frontend    │
  │  10. Display │◄──────┐
  │     Gallery  │       │ Images loaded from
  └──────────────┘       │ S3 Bucket B (public)
                         │ (watermarked versions)
```

## 🗄️ Modelo de Dados

```
┌─────────────────────┐
│      Users          │
├─────────────────────┤
│ id (PK)             │
│ email               │
│ password (hashed)   │
│ name                │
│ role (admin/client) │
│ isActive            │
│ lastLogin           │
└──────────┬──────────┘
           │ 1:N
           │ creates
           ▼
┌─────────────────────┐
│      Events         │
├─────────────────────┤
│ id (PK)             │
│ name                │
│ date                │
│ description         │
│ location            │
│ isActive            │
│ photoCount          │
│ createdBy (FK)      │
└──────────┬──────────┘
           │ 1:N
           │ contains
           ▼
┌─────────────────────┐
│      Photos         │
├─────────────────────┤
│ id (PK)             │
│ eventId (FK)        │
│ originalKey         │──► S3 Bucket A
│ watermarkedKey      │──► S3 Bucket B (set by Lambda)
│ width, height       │
│ fileSize            │
│ faceData (JSONB)    │
│ faceCount           │
│ rekognitionFaceId   │──► Rekognition Collection
│ processingStatus    │
│ uploadedBy (FK)     │
└──────────┬──────────┘
           │ N:M
           │ ordered_in
           ▼
┌─────────────────────┐        ┌─────────────────────┐
│    Order_Items      │◄──────►│      Orders         │
├─────────────────────┤  N:1   ├─────────────────────┤
│ id (PK)             │        │ id (PK)             │
│ orderId (FK)        │        │ userId (FK)         │
│ photoId (FK)        │        │ customerEmail       │
│ price               │        │ customerName        │
│ downloadUrl         │        │ status              │
│ downloadedAt        │        │ totalAmount         │
└─────────────────────┘        │ paymentId           │
                               │ paidAt              │
                               └─────────────────────┘
```

## 🪣 Estrutura dos Buckets S3

### Bucket A: snapli-originals (Privado)

```
snapli-originals/
└── events/
    └── {event-id}/
        └── originals/
            ├── {uuid-1}.jpg
            ├── {uuid-2}.jpg
            └── {uuid-3}.png
```

**Acesso:** Apenas backend via URLs pré-assinadas
**Uso:** Armazena imagens originais em alta resolução

### Bucket B: snapli-watermarked (Público)

```
snapli-watermarked/
└── events/
    └── {event-id}/
        └── watermarked/
            ├── {uuid-1}.jpg  (com marca d'água, gerada pela Lambda)
            ├── {uuid-2}.jpg
            └── {uuid-3}.jpg
```

**Acesso:** Público (CORS habilitado)
**Uso:** Servir previews com marca d'água (sem thumbnails — removidos)

## 🔐 Camadas de Segurança

### Nível 1: Frontend

- Validação de inputs
- Sanitização de dados
- HTTPS obrigatório
- CORS configurado

### Nível 2: Backend API

- JWT para autenticação
- Rate limiting (100 req/15min)
- Validação com express-validator
- Middleware de autorização por role
- Hash de senhas com bcrypt
- Helmet.js para headers de segurança

### Nível 3: Banco de Dados

- Conexão SSL/TLS
- Credenciais em variáveis de ambiente
- Prepared statements (Sequelize ORM)
- IP whitelist (Supabase)

### Nível 4: AWS

- IAM roles com menor privilégio
- Bucket A totalmente privado
- URLs pré-assinadas com expiração
- Encryption at rest (S3)
- VPC e Security Groups
- CloudWatch logging

## ⚡ Otimizações

### Performance

- **CDN:** CloudFront na frente do Bucket B
- **Caching:** Redis para queries frequentes
- **Lazy Loading:** Imagens carregadas sob demanda
- **Thumbnails:** Preview rápido antes da imagem completa
- **Compression:** Gzip/Brotli no backend
- **Connection Pooling:** Sequelize pool configurado

### Custos

- **S3 Intelligent-Tiering:** Move originais antigas para Glacier
- **Lambda:** Processamento sob demanda (pay-per-use)
- **Rekognition:** Apenas quando necessário
- **CDN:** Reduz requests diretos ao S3

### Escalabilidade

- **Backend:** Horizontal scaling com load balancer
- **Database:** Read replicas do Supabase
- **Lambda:** Auto-scaling automático
- **S3:** Infinitamente escalável
- **Queue:** SQS para processamento assíncrono (futuro)

## 📊 Monitoramento

### Métricas Principais

- Upload rate (fotos/hora)
- Processing time (Lambda)
- Search accuracy (similaridade média)
- API response time
- Error rate
- S3 storage usage
- Rekognition API calls

### Logs

- **Backend:** Winston → CloudWatch Logs
- **Lambda:** CloudWatch Logs
- **S3:** Access logs
- **API:** Request/Response logs

### Alertas

- Processing failures > 5%
- API latency > 2s
- S3 costs > threshold
- Database connections > 80%

## 🚀 Roadmap Técnico

### Fase 2: Pagamentos

- Integração Asaas
- Webhook handlers
- Gestão de pedidos
- Sistema de carrinho

### Fase 3: Escalabilidade

- Queue SQS para uploads
- CloudFront CDN
- Redis caching
- Multi-region

### Fase 4: Features Avançadas

- Machine Learning para agrupamento de fotos
- Reconhecimento de objetos/cenas
- Compressão adaptativa
- Geração de vídeos/slideshows

---

**Última atualização:** Janeiro 2026
