# Fotow API

Backend API para o sistema Fotow - Gerenciamento de fotos de eventos com reconhecimento facial.

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
fotowApi/
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
git clone https://github.com/wagnerfsilva/fotowApi.git
cd fotowApi
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

### Downloads
- `GET /api/download/:token` - Portal de download
- `POST /api/download/:token/download` - Download das fotos

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
