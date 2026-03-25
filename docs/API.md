# API Documentation - Snapli

API RESTful para o sistema Snapli de gerenciamento de fotos com reconhecimento facial.

**Base URL:** `http://localhost:3000/api`

**Content-Type:** `application/json` (exceto uploads)

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
