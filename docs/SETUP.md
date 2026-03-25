# Guia de Setup Completo - Snapli

Este guia o levará passo a passo pela configuração completa do sistema Snapli.

## 📋 Pré-requisitos

- [ ] Node.js 18+ e npm instalados
- [ ] Conta AWS com acesso a S3, Rekognition e Lambda
- [ ] Conta Supabase (ou PostgreSQL próprio)
- [ ] Git instalado

## 🗄️ 1. Configurar Banco de Dados (Supabase)

### 1.1 Criar Projeto no Supabase

1. Acesse [supabase.com](https://supabase.com) e crie uma conta
2. Crie um novo projeto
3. Anote as credenciais:
   - Database Host
   - Database Name
   - Database User
   - Database Password
   - Database Port (geralmente 5432)

### 1.2 Configurar Backend

```bash
cd backend
cp .env.example .env
```

Edite o arquivo `.env` com suas credenciais do Supabase:

```env
DB_HOST=db.xxx.supabase.co
DB_PORT=5432
DB_NAME=postgres
DB_USER=postgres
DB_PASSWORD=sua-senha-aqui
```

### 1.3 Instalar Dependências e Executar Migrations

```bash
npm install
npm run migrate
npm run seed  # Cria usuário admin padrão
```

**Credenciais padrão do admin:**

- Email: `fotografo@gmail.com`
- Senha: `%65434343`

⚠️ **IMPORTANTE:** Altere essas credenciais em produção!

## ☁️ 2. Configurar AWS

### 2.1 Criar Usuário IAM

1. Acesse AWS Console → IAM
2. Crie um novo usuário com acesso programático
3. Anexe as seguintes políticas:
   - `AmazonS3FullAccess`
   - `AmazonRekognitionFullAccess`
   - ou crie uma política customizada mais restritiva
4. Anote:
   - Access Key ID
   - Secret Access Key

### 2.2 Criar Buckets S3

**Bucket A - Originais (Privado):**

```bash
aws s3 mb s3://snapli-originals --region us-east-1
```

Configurar política (privado, apenas backend acessa):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Deny",
      "Principal": "*",
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::snapli-originals/*",
      "Condition": {
        "StringNotEquals": {
          "aws:PrincipalArn": "arn:aws:iam::YOUR_ACCOUNT_ID:user/YOUR_IAM_USER"
        }
      }
    }
  ]
}
```

**Bucket B - Watermarked (Público para leitura):**

```bash
aws s3 mb s3://snapli-watermarked --region us-east-1
```

Configurar CORS e política pública:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "PublicReadGetObject",
      "Effect": "Allow",
      "Principal": "*",
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::snapli-watermarked/*"
    }
  ]
}
```

CORS Configuration:

```json
[
  {
    "AllowedHeaders": ["*"],
    "AllowedMethods": ["GET"],
    "AllowedOrigins": ["*"],
    "ExposeHeaders": []
  }
]
```

### 2.3 Criar Coleção no Rekognition

Execute após iniciar o backend:

```bash
# Via API (recomendado)
curl -X POST http://localhost:3000/api/setup/create-collection \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN"

# Ou via AWS CLI
aws rekognition create-collection \
  --collection-id snapli-faces \
  --region us-east-1
```

### 2.4 Atualizar Backend .env

Adicione as credenciais AWS no arquivo `backend/.env`:

```env
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=sua-access-key
AWS_SECRET_ACCESS_KEY=sua-secret-key
S3_BUCKET_ORIGINAL=snapli-originals
S3_BUCKET_WATERMARKED=snapli-watermarked
REKOGNITION_COLLECTION_ID=snapli-faces
REKOGNITION_SIMILARITY_THRESHOLD=80
```

## 🔧 3. Configurar Lambda

### 3.1 Instalar Dependências Lambda

```bash
cd lambda
npm install
```

### 3.2 Criar Função Lambda

No AWS Console:

1. Vá em Lambda → Create function
2. Configure:
   - Nome: `snapli-image-processor`
   - Runtime: Node.js 18.x
   - Architecture: x86_64
   - Memory: 1024 MB
   - Timeout: 5 minutes

3. Adicione variáveis de ambiente:

```
AWS_REGION=us-east-1
WATERMARKED_BUCKET=snapli-watermarked
REKOGNITION_COLLECTION_ID=snapli-faces
WATERMARK_TEXT=SNAPLI
WATERMARK_OPACITY=0.3
```

4. Configure IAM Role com permissões para:
   - S3 (GetObject, PutObject)
   - Rekognition (DetectFaces, IndexFaces)
   - CloudWatch Logs

### 3.3 Deploy da Função

```bash
cd lambda
zip -r function.zip .
aws lambda update-function-code \
  --function-name snapli-image-processor \
  --zip-file fileb://function.zip
```

### 3.4 Configurar S3 Trigger

No bucket `snapli-originals`:

1. Properties → Event notifications → Create event notification
2. Configure:
   - Name: `trigger-image-processing`
   - Event types: PUT, POST
   - Prefix: `events/`
   - Suffix: `.jpg,.jpeg,.png,.webp`
   - Destination: Lambda function `snapli-image-processor`

## 🖥️ 4. Iniciar Backend

```bash
cd backend
npm run dev
```

Teste a API:

```bash
curl http://localhost:3000/api/health
```

## 🎨 5. Configurar e Iniciar Frontend

```bash
cd frontend
npm install
cp .env.example .env
```

Edite `frontend/.env`:

```env
VITE_API_URL=http://localhost:3000/api
```

Iniciar desenvolvimento:

```bash
npm run dev
```

Acesse: `http://localhost:5173`

## ✅ 6. Testar o Sistema

### 6.1 Login Admin

1. Acesse: `http://localhost:5173/admin/login`
2. Login: `fotografo@gmail.com` / `%65434343`

### 6.2 Criar Evento

1. Vá em "Eventos" → "Novo Evento"
2. Preencha os dados do evento

### 6.3 Upload de Fotos

1. Vá em "Upload"
2. Selecione o evento
3. Arraste fotos para o upload
4. Aguarde o processamento

### 6.4 Testar Busca Facial

1. Acesse a home pública: `http://localhost:5173`
2. Clique em "Buscar Fotos"
3. Faça upload de uma foto com um rosto
4. Veja os resultados!

## 🚀 7. Deploy em Produção

### Backend (Sugestões)

**Opção 1: AWS EC2**

```bash
# Instalar dependências
sudo apt update
sudo apt install nodejs npm postgresql-client

# Clonar repositório
git clone <repo-url>
cd snapli/backend

# Configurar variáveis
cp .env.example .env
# Editar .env com valores de produção

# Instalar e iniciar
npm install
npm run migrate
npm start
```

**Opção 2: Railway/Render**

1. Conecte o repositório
2. Configure variáveis de ambiente
3. Deploy automático

### Frontend

**Vercel (Recomendado):**

```bash
cd frontend
npm run build

# Deploy
vercel --prod
```

Configure a variável `VITE_API_URL` com a URL do backend em produção.

### Lambda

Lambda já está no cloud, apenas garanta que:

- S3 trigger está ativo
- Variáveis de ambiente estão corretas
- Permissões IAM estão configuradas

## 🔒 8. Segurança Pós-Deploy

- [ ] Alterar senha do admin padrão
- [ ] Configurar HTTPS (obrigatório)
- [ ] Revisar permissões IAM (princípio do menor privilégio)
- [ ] Configurar backups do banco de dados
- [ ] Habilitar logging e monitoramento
- [ ] Configurar rate limiting em produção
- [ ] Revisar CORS para domínios específicos

## 📊 9. Monitoramento

### CloudWatch Logs

```bash
# Ver logs da Lambda
aws logs tail /aws/lambda/snapli-image-processor --follow
```

### Backend Logs

```bash
cd backend
tail -f logs/combined.log
```

### Métricas S3

- Monitore custos de armazenamento
- Verifique número de requisições

## 🆘 Troubleshooting

**Erro: "Cannot connect to database"**

- Verifique credenciais no .env
- Confirme que o IP está na whitelist do Supabase

**Erro: "AWS credentials not found"**

- Verifique AWS_ACCESS_KEY_ID e AWS_SECRET_ACCESS_KEY
- Teste com `aws s3 ls`

**Lambda não processa imagens**

- Verifique logs no CloudWatch
- Confirme que o trigger S3 está ativo
- Teste a função manualmente no console

**Busca facial não encontra fotos**

- Verifique se a coleção Rekognition foi criada
- Confirme que as faces foram indexadas
- Ajuste REKOGNITION_SIMILARITY_THRESHOLD

## 📚 Próximos Passos

- [ ] Implementar sistema de pagamento (Asaas)
- [ ] Adicionar notificações por email
- [ ] Criar dashboard de analytics
- [ ] Implementar testes automatizados
- [ ] Configurar CI/CD
- [ ] Adicionar compressão de imagens progressiva
- [ ] Implementar cache (Redis)

## 📞 Suporte

Para dúvidas e problemas:

- Abra uma issue no GitHub
- Consulte a documentação da API em `/docs`
- Verifique os logs de erro

---

**Parabéns! Seu sistema Snapli está pronto! 🎉**
