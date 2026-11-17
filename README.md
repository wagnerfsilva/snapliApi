# Snapli API

Backend API para o sistema Snapli - Gerenciamento de fotos de eventos com reconhecimento facial.

## 🏗️ Tecnologias

- **Runtime**: Node.js 18+
- **Framework**: Express.js
- **ORM**: Sequelize
- **Banco de Dados**: PostgreSQL (Supabase)
- **Armazenamento**: Amazon S3
- **IA**: AWS Rekognition
- **Processamento**: AWS Lambda

## 📋 Estrutura

```
snapliApi/
├── src/
│   ├── config/          # Configurações (AWS, DB, JWT)
│   ├── controllers/     # Controladores da API
│   ├── middleware/      # Middlewares (auth, upload, etc)
│   ├── migrations/      # Migrações do banco de dados
│   ├── models/          # Modelos Sequelize
│   ├── routes/          # Rotas da API
│   ├── seeders/         # Seeds do banco
│   ├── services/        # Serviços (S3, Rekognition, Email, etc)
│   └── utils/           # Utilitários
├── lambda/              # Funções Lambda para processamento
└── logs/                # Logs da aplicação
```

## 🚀 Instalação

### 1. Clone o repositório

```bash
git clone https://github.com/wagnerfsilva/snapliApi.git
cd snapliApi
```

### 2. Instale as dependências

```bash
npm install
```

### 3. Configure as variáveis de ambiente

```bash
cp .env.example .env
```

Edite o arquivo `.env` com suas credenciais:
- Supabase (PostgreSQL)
- AWS (S3 e Rekognition)
- JWT Secret

### 4. Execute as migrações

```bash
npm run migrate
```

### 5. (Opcional) Execute os seeds

```bash
npm run seed
```

### 6. Inicie o servidor

```bash
# Desenvolvimento
npm run dev

# Produção
npm start
```

## 📡 Endpoints Principais

### Autenticação
- `POST /api/auth/register` - Registro de usuário
- `POST /api/auth/login` - Login
- `GET /api/auth/me` - Dados do usuário autenticado

### Eventos
- `GET /api/events` - Listar eventos
- `POST /api/events` - Criar evento (admin)
- `GET /api/events/:id` - Detalhes do evento
- `PUT /api/events/:id` - Atualizar evento (admin)
- `DELETE /api/events/:id` - Deletar evento (admin)

`GET /api/events` oculta eventos arquivados por padrão; use `?includeArchived=true` para listá-los.

### Arquivamento de evento (script local, somente admin)

```bash
./arquivar-evento.sh <event-id>                 # mostra dados + se pode arquivar + pede confirmação
./arquivar-evento.sh <event-id> --dry-run       # só mostra, sem pedir confirmação nem alterar
```

O script pede para digitar o nome do evento para confirmar. Requer migração `archivedAt` aplicada e acesso ao banco/AWS (`.env`). O evento só é arquivado se o prazo de download de todos os pedidos pagos/cortesia já expirou (sem `downloadExpiresAt`: `paidAt`/`createdAt` + 90 dias) e não há pedido `pending`/`processing` criado há menos de 10 dias. O script remove do S3 todas as fotos, thumbs, previews e vídeos (e as faces do Rekognition), desativa o evento e grava `archivedAt`. Os registros do banco são mantidos, então métricas, dashboard e relatórios continuam contando o evento. É irreversível e pode ser re-executado após falha parcial.

### Fotos
- `POST /api/photos/upload` - Upload de fotos (admin)
- `GET /api/photos/event/:eventId` - Fotos do evento
- `DELETE /api/photos/:id` - Deletar foto (admin)

### Busca
- `POST /api/search` - Buscar fotos por reconhecimento facial
- `POST /api/search/camera` - Comparar foto da câmera

### Pedidos
- `POST /api/orders` - Criar pedido
- `GET /api/orders/:token` - Detalhes do pedido

O checkout bloqueia uma nova compra (`409`, código `RECENT_PURCHASE_OVERLAP`) quando o mesmo e-mail, ignorando espaços nas pontas e diferenças entre maiúsculas e minúsculas, já possui um pedido `paid` ou `completed` pago nos últimos 7 dias com pelo menos um dos mesmos arquivos. Como cada arquivo pertence a um evento, a comparação não bloqueia arquivos diferentes do mesmo evento nem compras de outros eventos. Adicionar arquivos novos ao carrinho não remove o bloqueio se ainda houver algum arquivo já comprado. O pedido inteiro é recusado antes de criar pedido, itens ou cobrança PIX; nenhum pedido ou pagamento anterior é alterado. O checkout exibe a mensagem retornada pela API.

PIX pendentes, pedidos em processamento, estornados, cancelados e cortesias não bloqueiam. O intervalo é contado a partir de `paidAt`, inclusive no limite de 7 dias. Esta regra não implementa atualização de compras anteriores nem impede múltiplos PIX pendentes.

### Downloads
- `GET /api/download/:token` - Portal de download
- `POST /api/download/:token/download` - Download das fotos

### Resgate de comissão

A comissão total do evento é arredondada para o centavo mais próximo antes de descontar os resgates pendentes, aprovados ou pagos. Por exemplo, R$ 599,358 passa a R$ 599,36. O saldo e a validação do resgate são calculados em centavos para permitir solicitar o valor integral exibido, sem diferenças de precisão.

## 🧪 Scripts Disponíveis

```bash
npm run dev              # Inicia servidor em modo desenvolvimento
npm start                # Inicia servidor em produção
npm run migrate          # Executa migrações
npm run migrate:undo     # Desfaz última migração
npm run seed             # Executa seeds
npm run seed:undo        # Desfaz seeds
```

## 🔐 Variáveis de Ambiente

Veja o arquivo `.env.example` para todas as variáveis necessárias.

## 📦 Deploy

Este projeto está configurado para deploy no Railway. As variáveis de ambiente devem ser configuradas no painel do Railway.

### Configuração Railway

1. Conecte o repositório GitHub
2. Configure as variáveis de ambiente
3. O Railway detectará automaticamente o `package.json` e fará o deploy

## 📄 Documentação

Para mais detalhes sobre a arquitetura e fluxos, veja:
- [Documentação da API](docs/API.md)
- [Arquitetura](docs/ARCHITECTURE.md)
- [Fluxo de Downloads](docs/DOWNLOADS.md)

## 📝 Licença

Propriedade privada - Todos os direitos reservados
