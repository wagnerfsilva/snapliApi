# 📥 Sistema de Downloads - Fotow

## 🎯 Visão Geral

O sistema de downloads permite que clientes que compraram fotos acessem e baixem suas imagens em alta resolução sem marca d'água através de um portal exclusivo.

## 🔐 Segurança

- **Token Único**: Cada pedido pago recebe um token único de 64 caracteres
- **Expiração**: Links válidos por 90 dias após pagamento
- **URLs Pré-assinadas**: Downloads diretos do S3 com URLs temporárias (1h)
- **Sem Autenticação**: Cliente não precisa criar conta, apenas acessar link

## 🚀 Fluxo Completo

### 1. Criação do Pedido

```javascript
// Cliente finaliza compra
POST /api/orders
{
  "customerName": "Nome Cliente",
  "customerEmail": "cliente@email.com",
  "items": [{ "photoId": "uuid", "price": 10.00 }]
}
```

### 2. Após Pagamento Confirmado

```javascript
// Sistema gera token automaticamente
order.downloadToken = crypto.randomBytes(32).toString("hex");
order.downloadExpiresAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);
order.status = "paid";
await order.save();

// Envia email com link
emailService.sendDownloadEmail(order);
```

### 3. Cliente Acessa Portal

```
https://fotow.com/downloads/{token}
```

### 4. Download das Fotos

- **Preview**: Fotos com marca d'água (do bucket watermarked)
- **Download**: Foto original em alta resolução (bucket original)
- **Rastreamento**: Contador de downloads por foto

## 📡 API Endpoints

### Rotas Públicas (sem autenticação)

#### GET /api/downloads/:token

Retorna detalhes do pedido e lista de fotos

**Response:**

```json
{
  "order": {
    "id": "uuid",
    "customerName": "Cliente Teste",
    "customerEmail": "teste@fotow.com",
    "totalAmount": "15.00",
    "paidAt": "2026-01-22T15:17:58.144Z",
    "downloadExpiresAt": "2026-04-22T15:17:58.145Z",
    "status": "paid"
  },
  "photos": [
    {
      "id": "uuid",
      "originalFilename": "foto.jpg",
      "width": 1600,
      "height": 1200,
      "fileSize": 533387,
      "event": { "name": "Evento X" },
      "price": "5.00",
      "downloadCount": 0,
      "previewUrl": "https://..." // URL pré-assinada com marca d'água
    }
  ],
  "photoCount": 3
}
```

#### GET /api/downloads/:token/photo/:photoId

Gera URL de download para foto original

**Response:**

```json
{
  "downloadUrl": "https://s3.amazonaws.com/...", // URL pré-assinada (1h)
  "filename": "foto.jpg",
  "expiresIn": 3600
}
```

### Rotas Protegidas (requer autenticação admin)

#### POST /api/downloads/generate/:orderId

Gera token de download manualmente

#### POST /api/downloads/resend/:orderId

Reenvia email com link de download

## 💻 Frontend - Portal de Downloads

### Componente: DownloadPortalPage

**Localização:** `/frontend/src/pages/DownloadPortalPage.jsx`

**Rota:** `/downloads/:token`

**Funcionalidades:**

- ✅ Exibe informações do pedido
- ✅ Mostra contador de dias restantes
- ✅ Grid de fotos com preview (marca d'água)
- ✅ Download individual de cada foto
- ✅ Rastreamento de downloads por foto
- ✅ Feedback visual de fotos já baixadas
- ✅ Alertas quando próximo da expiração

**Estados de Erro:**

- `404`: Token inválido ou expirado
- `410`: Período de download expirou
- `403`: Pedido ainda não foi pago

## 🧪 Testes

### Criar Pedido de Teste

```bash
cd backend
node test-download-flow.js
```

Isso cria um pedido com:

- 3 fotos
- Status: paid
- Token gerado
- Expiração: 90 dias

### Testar API

```bash
# Buscar pedido por token
curl http://localhost:3000/api/downloads/{TOKEN}

# Gerar URL de download
curl http://localhost:3000/api/downloads/{TOKEN}/photo/{PHOTO_ID}
```

### Testar Frontend

```
http://localhost:5173/downloads/{TOKEN}
```

## 📧 Sistema de Email

**Arquivo:** `/backend/src/services/email.service.js`

### Emails Automáticos:

1. **Confirmação de Pedido** (`sendOrderConfirmation`)
   - Enviado após criar pedido
   - Inclui link de pagamento (Asaas)
   - Status: pending

2. **Link de Download** (`sendDownloadEmail`)
   - Enviado após pagamento confirmado
   - Inclui token e link para portal
   - Status: paid

### Modo Desenvolvimento

Emails são logados no console (não enviados):

```javascript
logger.info("📧 Email (DEV MODE):", { to, subject, text });
```

### Modo Produção

Configure variáveis de ambiente:

```env
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=seu-email@gmail.com
SMTP_PASS=sua-senha
SMTP_FROM=noreply@fotow.com
```

## 🗄️ Banco de Dados

### Tabela: orders

```sql
ALTER TABLE orders ADD COLUMN downloadToken VARCHAR(255) UNIQUE;
CREATE INDEX orders_download_token_idx ON orders (downloadToken);
```

### Migration

```bash
npx sequelize-cli db:migrate
```

**Arquivo:** `20260122000002-add-download-token-to-orders.js`

## 🔄 Integração com Asaas

Quando implementar webhook do Asaas:

```javascript
// webhook: payment.confirmed
async function handlePaymentConfirmed(payment) {
  const order = await Order.findOne({
    where: { paymentId: payment.id },
  });

  // Gerar token
  order.downloadToken = crypto.randomBytes(32).toString("hex");
  order.downloadExpiresAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);
  order.status = "paid";
  order.paidAt = new Date();
  await order.save();

  // Enviar email
  await emailService.sendDownloadEmail(order);
}
```

## ⚙️ Configurações

### Duração do Token

```javascript
// 90 dias (padrão)
const expiresAt = new Date();
expiresAt.setDate(expiresAt.getDate() + 90);
```

### Duração das URLs Pré-assinadas

```javascript
// 1 hora (padrão)
const url = await s3Service.generatePresignedUrl(key, bucket, 3600);
```

### Downloads Ilimitados

Não há limite de downloads durante o período de validade.

## 🎨 UI/UX

### Portal de Downloads

- **Design**: Responsivo, mobile-first
- **Cores**: Sistema de cores do Tailwind
- **Icons**: Lucide React
- **Grid**: Adaptativo (1/2/3 colunas)
- **Preview**: Aspect ratio 16:9
- **Feedback**: Loading states, success badges

### Alertas

- ⚠️ **7 dias ou menos**: Alerta amarelo
- ✅ **Download realizado**: Badge verde
- 🔒 **Expirado**: Tela de erro

## 📊 Métricas

O sistema rastreia:

- `downloadCount`: Quantas vezes cada foto foi baixada
- `downloadedAt`: Primeira vez que foi baixada
- Útil para analytics e suporte

## 🔮 Melhorias Futuras

### Download em Lote (ZIP)

```javascript
// Endpoint: GET /api/downloads/:token/zip
// Status atual: 501 Not Implemented
exports.downloadAllPhotos = async (req, res) => {
  // TODO: Gerar ZIP com todas as fotos
  // Usar biblioteca como 'archiver'
  // Upload temporário no S3
  // Retornar URL pré-assinada
};
```

### Notificações de Expiração

- Email 7 dias antes da expiração
- Email 1 dia antes da expiração
- Opção de renovar período

### Dashboard do Cliente

- Histórico de pedidos
- Todas as fotos compradas
- Re-download facilitado

## 🛠️ Troubleshooting

### Token não funciona

1. Verificar se pedido está pago
2. Verificar expiração
3. Checar logs do backend

### Erro ao gerar URL

1. Verificar credenciais AWS
2. Confirmar bucket permissions
3. Validar que foto existe no S3

### Email não chega

1. Modo DEV: Verificar console logs
2. Modo PROD: Validar credenciais SMTP
3. Checar spam/lixeira

## 📝 Logs

```bash
# Backend logs
tail -f /tmp/fotow-backend.log

# Logs específicos de downloads
grep "download" /tmp/fotow-backend.log
```

## ✅ Checklist de Deploy

- [ ] Migration rodada em produção
- [ ] Variáveis de ambiente configuradas
- [ ] SMTP configurado e testado
- [ ] Buckets S3 com permissões corretas
- [ ] Frontend compilado com URL correta
- [ ] Webhook Asaas configurado
- [ ] Emails de teste enviados e recebidos
- [ ] Portal testado em diferentes dispositivos
- [ ] Período de expiração definido
- [ ] Monitoramento de erros ativo

---

## 📞 Suporte

Para problemas com downloads:

- Email: suporte@fotow.com
- Incluir: Token, email do pedido, screenshot do erro
