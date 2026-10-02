# API Documentation - Snapli

API RESTful para o sistema Snapli de gerenciamento de fotos com reconhecimento facial.

**Base URL:** `http://localhost:3000/api`

**Content-Type:** `application/json` (exceto uploads)

---

## Video Pilot

Videos share the existing facial search, cart, PIX and paid-download workflow.
Existing photo uploads remain image-only; video uploads use separate multipart
endpoints. Enable videos only on the pilot event after setting its video prices.

Back up the database and apply migrations `20261002000001-add-video-foundation`
and `20261002000002-add-video-upload-state` before deploying the new API:

```sh
cd snapliApi
npm run migrate
```

Run this against staging first. The migration defaults existing media to `photo`
and existing events to `videoEnabled: false`. It also creates `media_faces`, with
RLS blocking direct public access, for frame-to-video facial indexing.
The application database role must retain its existing server-side RLS access.
Rollback removes video fields and face records; do not roll back after accepting
video purchases without first planning how to preserve those records.

### Event Video Pricing

Authenticated `POST /events` and `PUT /events/:id` accept:

```json
{
  "videoEnabled": true,
  "pricePerVideo": "20.00",
  "videoPricingPackages": [
    { "quantity": 3, "price": "50.00" },
    { "quantity": 5, "price": "75.00" }
  ],
  "allVideosPrice": "100.00"
}
```

Prices must be positive, with at most two decimal places. An enabled event must
have an individual video price. Packages accept integer quantities from 1 to
1000, with at most 100 configured packages. Optional prices and packages can be
cleared using `null`; omitted fields are preserved on partial updates.
`allVideosPrice` is a ceiling for the selected videos, not permission to download
other videos from the event. Photo packages and photo freebies do not apply to
videos. Photographers can update pricing only for their own events.

### Order Compatibility

`POST /orders` retains `items: [{ "photoId": "uuid" }]`. The ID references a row
in the existing `photos` table, whose `mediaType` is `photo` or `video`. The server
loads the type and price from the database; client prices and types are ignored.
Items are grouped by event and media type, and video packages use the lowest
available exact-quantity combination or configured ceiling. Video amounts are
distributed in whole cents across the purchased items.

Videos are accepted only with `processingStatus: completed`, a `previewKey`, an
active event, and valid enabled video pricing. Pending videos and duplicate IDs
are rejected before creating an order or PIX payment. Both types can be purchased
in one order; the response `order.totalAmount` is the authoritative PIX amount.

### Upload and Processing

Admin and photographer authentication is required. Photographers can operate
only on their own events. Requests and responses use the normal success envelope.

1. `POST /videos/uploads`: `{ eventId, filename, fileSize, mimeType }` returns
  `data: { id, partSize, partCount }`. Accepted files are MOV/MP4, up to 500 MiB
  (524288000 bytes), 120 seconds, H.264/HEVC, and 4096 pixels per dimension.
  Container, codec and duration are checked after transfer by FFprobe.
2. `PUT /videos/uploads/:id/parts/:partNumber`: raw `application/octet-stream`,
  exactly 8 MiB per part except the last. Returns `{ PartNumber, ETag }`.
  The browser persists the session locally; reselect the same file to resume.
3. `POST /videos/uploads/:id/complete`: `{ parts: [{ PartNumber, ETag }] }`.
  Completion validates S3 object size and queues the database job. It is idempotent.
4. `GET /videos/:id/status`: upload/processing status, error, face count and,
  when completed, marked poster and preview URLs. It never returns the original.
5. `DELETE /videos/uploads/:id`: abort an unfinished S3 multipart upload.
6. `POST /photos/:id/retry`: requeue a failed video with a completed upload.
  Running and completed video jobs cannot be retried.

The serial worker uses PostgreSQL row locks, a heartbeat and a 20-minute stale
lease. Interrupted jobs are attempted at most three times before requiring retry.
FFmpeg must be installed in the deployment image. `/api/health` exposes the Git
revision and `video.ready`; upload start returns 503 while the worker is unavailable.
Set `VIDEO_PROCESSING_ENABLED=false` to disable this worker.

Frames are sampled at 1 FPS and indexed in the existing Rekognition collection.
Face IDs map to video, timestamp and processing version in `media_faces`. Search
deduplicates videos, retaining maximum similarity and matched timestamps. It does
not guarantee independent-selfie accuracy or complete recall: faces need to be
detectable in sampled frames and AWS returns at most 4096 face matches per search.
Customers receive only the marked H.264/AAC SDR MP4 and marked poster before payment.
Original MOV/MP4 URLs use the existing paid, unexpired, order-bound download token.

Active processing and purchased videos cannot be deleted. Indexed face removal
requires `rekognition:DeleteFaces`; a denied removal preserves the database item.
IAM/S3 permissions must include multipart upload/abort plus existing original read,
marked-output write and Rekognition index/search permissions. Abandoned multipart
uploads require cancellation or an S3 lifecycle rule; no lifecycle rule is installed
automatically. This pilot runs FFmpeg beside the API and is not a bulk-upload
capacity certification. Enable one real event and monitor processing first.

### Focused Tests

```sh
cd snapliApi
npx jest scripts/test/video-*.test.js --runInBand --coverage=false
```

These tests use mocked database and payment services. They cover pricing,
configuration, photo-only and mixed orders, authorization and migration calls;
they do not validate a live PostgreSQL migration or real AWS processing.

### Local Video Preparation Validation

The local processing service now supports MOV/MP4 with HEVC or H.264, up to
120 seconds and 500 MiB (524288000 bytes).
FFmpeg must include libx264, AAC, zscale, tonemap and drawtext. HDR is tone mapped
to SDR, orientation is applied, frames are sampled at 1 FPS, and a marked H.264
preview and poster are created in an OS temporary directory. Recognition frames
are unmarked and must never be exposed as customer previews.

```sh
cd snapliApi
npx jest scripts/test/video-processing.test.js scripts/test/video-pricing.test.js --runInBand --coverage=false
node scripts/test/validate-video.js /path/to/video.MOV
```

The script verifies original SHA256 integrity, all JPEG dimensions/size,
orientation, preview duration, codecs and audio. It writes a local `report.json`.
It does not use the database, AWS or payment services by default.

An explicitly authorized AWS integration test can reuse that report:

```sh
node scripts/test/validate-video.js --rekognition /path/to/generated/report.json
```

This uploads frame images to a separate temporary Rekognition collection, never
the production collection. The account must permit CreateCollection,
DeleteCollection, IndexFaces and SearchFacesByImage. A deletion permission check
runs before any frame upload. Pending cleanup from a prior run blocks another
run. The positive control is a crop from an indexed frame, not an independent
selfie; the negative control is a blank image. Neither proves real-world recall
or matching of the intended participant. Results and cleanup status are saved
in `rekognition-report.json`; failed cleanup requires an authorized administrator.

Validation of `IMG_5416.MOV` on 2026-10-02 produced 90 frames, a 720x1280 H.264
SDR preview with AAC audio (18190415 bytes), and preserved the original hash.
Source: 89.636667 seconds, 510090617 bytes, HEVC/HDR, portrait after rotation.
Local processing took 202 seconds; this is not an AWS Lambda performance result.
The real AWS test indexed 228 face vectors in 67 of the 90 frames; a same-video
control matched at 99.9866%, and a blank image produced no face match. There were
90 IndexFaces and 2 SearchFacesByImage calls. Collection deletion was denied by
IAM, so the test is not fully cleaned up or certified end-to-end.
Pending collection: `snapli-video-validation-1790971157826-29d6a221`, us-east-1.
The collection must be removed by an account with DeleteCollection permission.

---

## 🔐 Autenticação

### POST /auth/login

Login de administrador.

**Body:**

```json
{
  "email": "fotografo@gmail.com",
  "password": "%65434343"
}
```

**Response 200:**

```json
{
  "success": true,
  "message": "Login realizado com sucesso",
  "data": {
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "user": {
      "id": "uuid",
      "email": "fotografo@gmail.com",
      "name": "Administrador",
      "role": "admin"
    }
  }
}
```

### GET /auth/me

Obter dados do usuário autenticado.

**Headers:** `Authorization: Bearer {token}`

**Response 200:**

```json
{
  "success": true,
  "data": {
    "user": { ... }
  }
}
```

### POST /auth/logout

Logout (lado do cliente remove o token).

**Headers:** `Authorization: Bearer {token}`

**Response 200:**

```json
{
  "success": true,
  "message": "Logout realizado com sucesso"
}
```

---

## 📅 Eventos

### GET /events

Listar eventos com filtros e paginação.

**Headers:** `Authorization: Bearer {token}`

**Query Parameters:**

- `page` (number): Página atual (padrão: 1)
- `limit` (number): Itens por página (padrão: 20)
- `search` (string): Busca em nome, descrição, localização
- `isActive` (boolean): Filtrar por status
- `startDate` (date): Data inicial
- `endDate` (date): Data final
- `sortBy` (string): Campo para ordenar (padrão: 'date')
- `sortOrder` (string): ASC ou DESC (padrão: 'DESC')

**Response 200:**

```json
{
  "success": true,
  "data": {
    "events": [
      {
        "id": "uuid",
        "name": "Casamento João e Maria",
        "date": "2026-01-15T00:00:00.000Z",
        "description": "Cerimônia e festa",
        "location": "Igreja Santa Maria",
        "isActive": true,
        "photoCount": 150,
        "createdBy": "uuid",
        "creator": {
          "id": "uuid",
          "name": "Admin",
          "email": "admin@snapli.com"
        }
      }
    ],
    "pagination": {
      "total": 10,
      "page": 1,
      "limit": 20,
      "totalPages": 1
    }
  }
}
```

### GET /events/:id

Obter detalhes de um evento.

**Headers:** `Authorization: Bearer {token}`

**Response 200:**

```json
{
  "success": true,
  "data": {
    "event": { ... }
  }
}
```

### POST /events

Criar novo evento.

**Headers:** `Authorization: Bearer {token}`

**Body:**

```json
{
  "name": "Nome do Evento",
  "date": "2026-02-15",
  "description": "Descrição opcional",
  "location": "Local opcional"
}
```

**Response 201:**

```json
{
  "success": true,
  "message": "Evento criado com sucesso",
  "data": {
    "event": { ... }
  }
}
```

### PUT /events/:id

Atualizar evento.

**Headers:** `Authorization: Bearer {token}`

**Body:**

```json
{
  "name": "Nome Atualizado",
  "date": "2026-02-15",
  "description": "Nova descrição",
  "location": "Novo local",
  "isActive": true
}
```

**Response 200:**

```json
{
  "success": true,
  "message": "Evento atualizado com sucesso",
  "data": {
    "event": { ... }
  }
}
```

### DELETE /events/:id

Excluir evento (só se não tiver fotos).

**Headers:** `Authorization: Bearer {token}`

**Response 200:**

```json
{
  "success": true,
  "message": "Evento excluído com sucesso"
}
```

### GET /events/:id/statistics

Obter estatísticas de um evento.

**Headers:** `Authorization: Bearer {token}`

**Response 200:**

```json
{
  "success": true,
  "data": {
    "event": { ... },
    "statistics": {
      "totalPhotos": 150,
      "processingStatuses": {
        "completed": 145,
        "processing": 3,
        "pending": 1,
        "failed": 1
      },
      "totalFaces": 450,
      "photosWithFaces": 140
    }
  }
}
```

---

## 📸 Fotos

### POST /photos/upload

Upload de fotos para um evento.

**Headers:**

- `Authorization: Bearer {token}`
- `Content-Type: multipart/form-data`

**Body (FormData):**

- `eventId` (string): UUID do evento
- `photos` (files): Múltiplas imagens

**Response 201:**

```json
{
  "success": true,
  "message": "10 foto(s) enviada(s) com sucesso",
  "data": {
    "uploaded": [
      {
        "id": "uuid",
        "filename": "IMG_001.jpg",
        "status": "success"
      }
    ],
    "errors": []
  }
}
```

### GET /photos/event/:eventId

Listar fotos de um evento.

**Headers:** `Authorization: Bearer {token}`

**Query Parameters:**

- `page` (number): Página (padrão: 1)
- `limit` (number): Limite (padrão: 50)
- `processingStatus` (string): Filtrar por status

**Response 200:**

```json
{
  "success": true,
  "data": {
    "photos": [
      {
        "id": "uuid",
        "eventId": "uuid",
        "originalFilename": "IMG_001.jpg",
        "width": 4000,
        "height": 3000,
        "fileSize": 2500000,
        "faceCount": 3,
        "processingStatus": "completed",
        "watermarkedUrl": "https://...",
        "thumbnailUrl": "https://...",
        "createdAt": "2026-01-21T..."
      }
    ],
    "pagination": { ... }
  }
}
```

### GET /photos/:id

Obter detalhes de uma foto.

**Headers:** `Authorization: Bearer {token}`

**Response 200:**

```json
{
  "success": true,
  "data": {
    "photo": {
      "id": "uuid",
      "event": {
        "id": "uuid",
        "name": "Evento Nome",
        "date": "2026-01-15"
      },
      ...
    }
  }
}
```

### GET /photos/:id/download

Gerar URL pré-assinada para download da original.

**Headers:** `Authorization: Bearer {token}`

**Response 200:**

```json
{
  "success": true,
  "data": {
    "downloadUrl": "https://s3.amazonaws.com/...",
    "expiresIn": 3600,
    "filename": "IMG_001.jpg"
  }
}
```

### POST /photos/:id/retry

Reprocessar foto com falha.

**Headers:** `Authorization: Bearer {token}`

**Response 200:**

```json
{
  "success": true,
  "message": "Reprocessamento iniciado"
}
```

### DELETE /photos/:id

Excluir foto.

**Headers:** `Authorization: Bearer {token}`

**Response 200:**

```json
{
  "success": true,
  "message": "Foto excluída com sucesso"
}
```

---

## 🔍 Busca

### POST /search/face

Buscar fotos por reconhecimento facial.

**Headers:** `Content-Type: multipart/form-data`

**Body (FormData):**

- `searchPhoto` (file): Imagem com o rosto

**Response 200:**

```json
{
  "success": true,
  "message": "15 foto(s) encontrada(s)",
  "data": {
    "photos": [
      {
        "id": "uuid",
        "similarity": 95.5,
        "event": {
          "id": "uuid",
          "name": "Evento",
          "date": "2026-01-15"
        },
        "watermarkedUrl": "https://...",
        "thumbnailUrl": "https://..."
      }
    ],
    "matchCount": 15,
    "searchedFaceDetected": true,
    "searchedFaceConfidence": 99.8
  }
}
```

**Response 400 (sem face detectada):**

```json
{
  "success": false,
  "message": "Nenhuma face detectada na imagem enviada. Por favor, envie uma foto com seu rosto visível."
}
```

### GET /search/event/:eventId

Buscar fotos de um evento (público).

**Query Parameters:**

- `page`, `limit`, `hasFaces` (boolean)

**Response 200:**

```json
{
  "success": true,
  "data": {
    "photos": [ ... ],
    "pagination": { ... }
  }
}
```

### GET /search/statistics

Obter estatísticas gerais do sistema.

**Response 200:**

```json
{
  "success": true,
  "data": {
    "totalPhotos": 1500,
    "photosWithFaces": 1400,
    "totalEvents": 10,
    "totalFaces": 4500
  }
}
```

---

## ❌ Códigos de Erro

| Código | Descrição                              |
| ------ | -------------------------------------- |
| 400    | Bad Request - Dados inválidos          |
| 401    | Unauthorized - Token inválido/expirado |
| 403    | Forbidden - Sem permissão              |
| 404    | Not Found - Recurso não encontrado     |
| 409    | Conflict - Duplicação                  |
| 500    | Internal Server Error                  |

**Formato de erro:**

```json
{
  "success": false,
  "message": "Mensagem de erro",
  "errors": [
    {
      "field": "email",
      "message": "Email inválido"
    }
  ]
}
```

---

## 🔑 Rate Limiting

- **Limite:** 100 requisições por 15 minutos por IP
- **Header de resposta:** `X-RateLimit-Limit`, `X-RateLimit-Remaining`

**Response 429:**

```json
{
  "success": false,
  "message": "Muitas requisições deste IP, tente novamente mais tarde."
}
```

---

## 📝 Notas

1. **Autenticação:** Todas as rotas `/admin/*` e `/photos/*` requerem token JWT
2. **Uploads:** Tamanho máximo por arquivo: 10MB
3. **Uploads:** Máximo de 50 arquivos por requisição
4. **Formatos aceitos:** JPEG, PNG, WebP
5. **URLs pré-assinadas:** Válidas por 1 hora
6. **Busca facial:** Limiar de similaridade padrão: 80%

---

## 🧪 Exemplos com cURL

### Login

```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"fotografo@gmail.com","password":"%65434343"}'
```

### Criar Evento

```bash
curl -X POST http://localhost:3000/api/events \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name":"Meu Evento",
    "date":"2026-02-15",
    "description":"Descrição"
  }'
```

### Upload de Fotos

```bash
curl -X POST http://localhost:3000/api/photos/upload \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -F "eventId=EVENT_UUID" \
  -F "photos=@foto1.jpg" \
  -F "photos=@foto2.jpg"
```

### Busca Facial

```bash
curl -X POST http://localhost:3000/api/search/face \
  -F "searchPhoto=@minha-foto.jpg"
```
