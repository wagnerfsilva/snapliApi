# Deploy do Fotow API no Railway

Este guia explica como fazer o deploy da API do Fotow no Railway.

## 📋 Pré-requisitos

1. Conta no Railway (https://railway.app)
2. Repositório GitHub conectado
3. Credenciais AWS (S3 e Rekognition)
4. Banco de dados PostgreSQL (pode usar o Railway Postgres)

## 🚀 Passo a Passo

### 1. Criar Novo Projeto no Railway

1. Acesse https://railway.app
2. Clique em "New Project"
3. Selecione "Deploy from GitHub repo"
4. Escolha o repositório `wagnerfsilva/fotowApi`

### 2. Adicionar PostgreSQL (se necessário)

Se você não estiver usando o Supabase:

1. No projeto, clique em "+ New"
2. Selecione "Database" > "PostgreSQL"
3. O Railway criará automaticamente um banco de dados

### 3. Configurar Variáveis de Ambiente

No painel do Railway, vá em "Variables" e adicione:

#### Servidor
```
PORT=3000
NODE_ENV=production
```

#### Banco de Dados (Supabase)
```
DB_HOST=db.your-project.supabase.co
DB_PORT=5432
DB_NAME=postgres
DB_USER=postgres
DB_PASSWORD=your-supabase-password
```

**OU** Banco de Dados (Railway Postgres - automático)
```
DATABASE_URL=${{Postgres.DATABASE_URL}}
```

#### JWT
```
JWT_SECRET=seu-secret-super-seguro-aqui
JWT_EXPIRES_IN=7d
```

#### AWS
```
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=sua-access-key
AWS_SECRET_ACCESS_KEY=sua-secret-key
S3_BUCKET_ORIGINAL=fotow-originals
S3_BUCKET_WATERMARKED=fotow-watermarked
REKOGNITION_COLLECTION_ID=fotow-faces
REKOGNITION_SIMILARITY_THRESHOLD=80
```

#### URLs
```
FRONTEND_URL=https://seu-dominio-frontend.railway.app
API_URL=https://seu-dominio-backend.railway.app
```

#### Configurações
```
WATERMARK_TEXT=FOTOW
WATERMARK_OPACITY=0.3
MAX_FILE_SIZE=10485760
MAX_FILES_PER_UPLOAD=50
```

### 4. Executar Migrações

Após o primeiro deploy, você precisa executar as migrações:

#### Opção 1: Via Railway CLI

```bash
# Instalar Railway CLI
npm i -g @railway/cli

# Login
railway login

# Conectar ao projeto
railway link

# Executar migrações
railway run npm run migrate

# (Opcional) Executar seeds
railway run npm run seed
```

#### Opção 2: Adicionar ao Build Command

No arquivo `railway.toml`, modifique o buildCommand:

```toml
[build]
buildCommand = "npm install && npm run migrate"
```

### 5. Verificar Deploy

Após o deploy:

1. Acesse a URL gerada pelo Railway
2. Teste o endpoint de health: `https://sua-url.railway.app/api/health`
3. Teste a autenticação: `POST https://sua-url.railway.app/api/auth/login`

### 6. Configurar Domínio Customizado (Opcional)

1. Vá em "Settings" no Railway
2. Em "Domains", clique em "Generate Domain" ou adicione um domínio customizado
3. Atualize a variável `API_URL` com o novo domínio

## 🔧 Troubleshooting

### Erro de Conexão com Banco de Dados

Verifique se:
- As credenciais do banco estão corretas
- O banco está acessível publicamente (se usar Supabase)
- As variáveis de ambiente estão configuradas corretamente

### Erro de AWS

Verifique se:
- As credenciais AWS estão corretas
- Os buckets S3 existem
- A coleção do Rekognition foi criada
- As políticas IAM permitem acesso aos serviços

### Logs

Para ver os logs:

```bash
railway logs
```

Ou no painel do Railway, vá em "Deployments" > selecione o deploy > "View Logs"

## 📊 Monitoramento

O Railway fornece métricas de:
- CPU
- Memória
- Rede
- Logs em tempo real

Acesse em "Metrics" no painel do projeto.

## 💰 Custos

O Railway tem um plano gratuito limitado. Para produção, considere:
- Starter Plan: $5/mês
- Custos adicionais por uso de recursos (CPU, RAM, Bandwidth)

## 🔄 Atualizações

O Railway automaticamente faz redeploy quando você faz push para a branch `main`:

```bash
git add .
git commit -m "Atualização"
git push origin main
```

## 🔗 Links Úteis

- [Railway Docs](https://docs.railway.app)
- [Railway CLI](https://docs.railway.app/develop/cli)
- [Railway Templates](https://railway.app/templates)
