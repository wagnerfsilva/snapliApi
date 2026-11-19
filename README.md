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
- `POST /api/events` - Criar evento (admin ou fotógrafo)
- `GET /api/events/:id` - Detalhes do evento
- `PUT /api/events/:id` - Atualizar evento (admin ou fotógrafo com acesso, após aprovação)
- `PATCH /api/events/:id/approve` - Revisar e aprovar evento pendente (somente admin)
- `DELETE /api/events/:id` - Deletar evento (admin ou fotógrafo com acesso, após aprovação)

`GET /api/events` oculta eventos arquivados por padrão; use `?includeArchived=true` para listá-los.

#### Participantes, comissões e aprovação

Cada evento aceita um organizador opcional (`organizerId`, `organizerCommissionPercentage`) e um fotógrafo opcional (`photographerId`, `photographerCommissionPercentage`). Ambos os percentuais incidem sobre a mesma receita bruta paga do evento, com até duas casas decimais, de 0 a 100, e soma máxima de 100%. Com beneficiário selecionado, informe explicitamente o percentual, inclusive zero; sem beneficiário, o percentual fica nulo.

Eventos criados pelo admin são aprovados diretamente. Na criação por fotógrafo, a API impõe o vínculo ao próprio usuário, `approvalStatus=pending` e `isActive=false`, independentemente desses campos enviados no corpo. O fotógrafo pode propor as comissões, mas somente consultar o cadastro enquanto aguarda validação.

A aprovação é independente de ativo/inativo e arquivamento. O admin pode editar os dados pendentes e usar `PATCH /api/events/:id/approve` com os campos finais opcionais da edição. A API valida as comissões e os participantes ativos, salva as correções, registra `approvedBy`/`approvedAt` e aprova/ativa o evento em uma única transação. Não é possível aprovar pelo `PUT` ou apenas ativar um evento pendente.

Enquanto pendente, o evento não admite edição/exclusão pelo fotógrafo nem uploads, acesso operacional às mídias, buscas, checkout, cortesias ou inclusão de fotos em pedidos, inclusive por chamada direta e pelo uploader desktop. O admin pode revisar o cadastro, mas também precisa aprová-lo antes do uso operacional. Downloads de pedidos já existentes não mudam.

Fotógrafos acessam eventos criados por eles ou associados ao seu `photographerId`. Somente o vínculo de beneficiário dá direito a saldo e saque. Após aprovação, apenas admin pode alterar qualquer vínculo ou percentual de comissão; fotógrafos continuam editando os demais campos permitidos. Alterações de percentual recalculam todas as vendas do evento, não apenas vendas futuras.

Use `GET /api/events?approvalStatus=pending` ou `approved` para filtrar a aprovação. A listagem mantém `requestedAmount` para o organizador e acrescenta `photographerRequestedAmount`, `organizerBalance` e `photographerBalance`, com comissão e saldo calculados em centavos. A busca limitada de fotógrafos ativos para associação é `GET /api/users/search-photographers?q=...` (somente admin, mínimo de 2 caracteres).

**Publicação:** aplicar a migração `20261119000001-add-photographer-and-event-approval.js` pelo comando existente `npm run migrate`, no ambiente de destino, antes de iniciar a nova API; depois publicar o painel. Coordenar a troca de todas as instâncias para que código antigo não ignore a aprovação durante a transição. A migração libera os eventos existentes sem alterar seus estados ativo/inativo/arquivado nem suas comissões, não atribui fotógrafos e mantém os saques anteriores como organizador. Não preencher aprovador/data fictícios para o legado. A reversão é recusada se houver qualquer saque de fotógrafo, evitando apagar esse histórico.

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

#### Atualizar fotos de uma compra total (somente administrador)

No painel de vendas do evento, o botão **Buscar novas fotos** aparece somente para pedidos `paid`/`completed`, com data de pagamento, em evento ativo e não arquivado, cujo valor pago pelas fotos daquele evento corresponda ao preço atual de **Todas as fotos** (`allPhotosPrice`). A comparação usa centavos e o mesmo rateio proporcional dos itens usado na receita por evento; vídeos e outros eventos não contam para atingir o preço do pacote de fotos. Pedidos antigos são avaliados pela mesma regra de valor, pois não registram a modalidade de preço contratada.

- `POST /api/orders/:orderId/events/:eventId/photo-updates/preview`: enviar `searchPhoto` (JPG, PNG ou WebP, até 10 MB). Busca facial em todas as fotos processadas da pessoa no mesmo evento e ausentes do pedido, independentemente da data de inclusão das fotos (inclusive anteriores ao pagamento). A referência é usada em memória e não é salva.
- `POST /api/orders/:orderId/events/:eventId/photo-updates/confirm`: enviar `previewToken` e `photoIds` selecionados. A prévia assinada vale por 15 minutos e é vinculada ao administrador, pedido, evento e resultados encontrados. O administrador deve revisar a prévia antes de confirmar.

A confirmação revalida elegibilidade e disponibilidade em transação, bloqueia o pedido contra confirmações simultâneas e ignora fotos já incluídas. Os novos itens recebem preço zero: valor total, pagamento, preços anteriores, rateio financeiro, comissão, token e vencimento de download não mudam. O cliente usa o mesmo link, sem cobrança ou e-mail automático. A função não inclui vídeos e não estende o prazo de download.

### Downloads
- `GET /api/download/:token` - Portal de download
- `POST /api/download/:token/download` - Download das fotos

### Resgate de comissão

A comissão total do evento é arredondada para o centavo mais próximo antes de descontar os resgates pendentes, aprovados ou pagos. Por exemplo, R$ 599,358 passa a R$ 599,36. O saldo e a validação do resgate são calculados em centavos para permitir solicitar o valor integral exibido, sem diferenças de precisão.

Fotógrafo e organizador têm saldos independentes, calculados sobre a receita dos pedidos `paid`/`completed` com o rateio proporcional dos itens em pedidos de vários eventos. Cortesias e estornos não geram comissão. Cada solicitação possui exatamente um beneficiário (`organizerId` ou `photographerId`) e preserva sua chave PIX no momento da solicitação.

- `GET /api/withdrawals/balance/:eventId`: participante consulta apenas sua comissão no evento; admin pode selecionar `?commissionType=organizer` (padrão) ou `photographer`.
- `POST /api/withdrawals`: fotógrafo/organizador associado solicita `{eventId, amount, notes?}`; o perfil autenticado define a comissão, sem aceitar beneficiário arbitrário. Requer evento aprovado, chave PIX e saldo suficiente.
- `GET /api/withdrawals`: admin vê todas as solicitações; cada participante vê somente as próprias, inclusive históricas após troca de vínculo.
- `PATCH /api/withdrawals/:id/status`: admin aprova, rejeita ou marca como pago, mantendo as transições existentes.

Uma solicitação aberta é permitida por evento e tipo de comissão: fotógrafo e organizador podem ter uma cada, simultaneamente. Checagem de saldo/reserva e criação são serializadas pelo bloqueio do evento em transação. Saques de um tipo nunca reduzem o saldo do outro. Se o admin mudar o beneficiário ou percentual, os saques anteriores não são reescritos: continuam abatendo a respectiva comissão do evento, com disponível mínimo zero. Rejeitar um saque libera sua reserva. Os pagamentos continuam manuais; não há split nem transferência PIX automática.

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
