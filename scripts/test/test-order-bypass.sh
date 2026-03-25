#!/bin/bash

# Test order creation with bypass payment

echo "🧪 Testando criação de pedido com bypass de pagamento..."
echo ""

# Get first 2 photos from database
PHOTO_IDS=$(psql -d snapli_db -t -c "SELECT id FROM photos WHERE processing_status = 'completed' LIMIT 2;" 2>/dev/null | tr '\n' ' ')

if [ -z "$PHOTO_IDS" ]; then
    echo "❌ Nenhuma foto encontrada no banco"
    echo "Execute o upload de fotos primeiro"
    exit 1
fi

# Convert to array
PHOTO_ARRAY=($PHOTO_IDS)
PHOTO_1=${PHOTO_ARRAY[0]// /}
PHOTO_2=${PHOTO_ARRAY[1]// /}

echo "📸 Usando fotos:"
echo "   1. $PHOTO_1"
echo "   2. $PHOTO_2"
echo ""

# Create order
echo "🛒 Criando pedido..."
echo ""

RESPONSE=$(curl -s -X POST http://localhost:3000/api/orders \
  -H "Content-Type: application/json" \
  -d "{
    \"customerName\": \"Teste Cliente\",
    \"customerEmail\": \"teste@snapli.com\",
    \"items\": [
      {\"photoId\": \"$PHOTO_1\"},
      {\"photoId\": \"$PHOTO_2\"}
    ],
    \"bypassPayment\": true
  }")

# Check if successful
if echo "$RESPONSE" | grep -q "\"success\":true"; then
    echo "✅ Pedido criado com sucesso!"
    echo ""
    echo "$RESPONSE" | python3 -m json.tool
    echo ""
    
    # Extract download token
    TOKEN=$(echo "$RESPONSE" | python3 -c "import sys, json; print(json.load(sys.stdin)['order']['downloadToken'])" 2>/dev/null)
    
    if [ -n "$TOKEN" ]; then
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        echo ""
        echo "🎉 PEDIDO PAGO AUTOMATICAMENTE (DEV MODE)"
        echo ""
        echo "🔗 Portal de Downloads:"
        echo "   http://localhost:5173/downloads/$TOKEN"
        echo ""
        echo "💡 Abra este link no navegador para ver suas fotos!"
        echo ""
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    fi
else
    echo "❌ Erro ao criar pedido:"
    echo ""
    echo "$RESPONSE" | python3 -m json.tool 2>/dev/null || echo "$RESPONSE"
fi
