const axios = require('axios');
const logger = require('../utils/logger');

// Configuração do cliente Asaas
const asaasClient = axios.create({
    baseURL: process.env.ASAAS_API_URL || 'https://sandbox.asaas.com/api/v3',
    headers: {
        'access_token': process.env.ASAAS_API_KEY,
        'Content-Type': 'application/json'
    }
});

/**
 * Cria ou busca um customer no Asaas
 */
const getOrCreateCustomer = async (customerName, customerEmail) => {
    try {
        // Busca customer pelo email
        const searchResponse = await asaasClient.get('/customers', {
            params: {
                email: customerEmail,
                limit: 1
            }
        });

        // Se encontrou, atualiza com CPF se não tiver
        if (searchResponse.data.data && searchResponse.data.data.length > 0) {
            const customer = searchResponse.data.data[0];

            // Se o customer não tem CPF, atualiza com um genérico
            if (!customer.cpfCnpj) {
                await asaasClient.put(`/customers/${customer.id}`, {
                    cpfCnpj: '24971563792' // CPF genérico para sandbox
                });
                logger.info('Customer atualizado com CPF', { customerId: customer.id });
            } else {
                logger.info('Customer encontrado no Asaas', { customerId: customer.id });
            }

            return customer.id;
        }

        // Se não encontrou, cria um novo com CPF
        const createResponse = await asaasClient.post('/customers', {
            name: customerName,
            email: customerEmail,
            cpfCnpj: '24971563792',  // CPF genérico para sandbox
            notificationDisabled: false
        });

        logger.info('Customer criado no Asaas', { customerId: createResponse.data.id });
        return createResponse.data.id;

    } catch (error) {
        logger.error('Erro ao buscar/criar customer no Asaas', {
            error: error.message,
            response: error.response?.data
        });
        throw error;
    }
};

/**
 * Cria uma cobrança PIX no Asaas
 */
const createPixPayment = async ({ customerName, customerEmail, amount, orderId, description }) => {
    try {
        // Em desenvolvimento, simula a resposta do Asaas
        if (process.env.NODE_ENV === 'development' && !process.env.ASAAS_API_KEY) {
            logger.info('Modo DEV: Simulando criação de cobrança PIX', { orderId, amount });

            return {
                id: `sim_${orderId}`,
                invoiceUrl: `https://sandbox.asaas.com/i/sim_${orderId}`,
                pixQrCode: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
                pixCopyPaste: '00020126580014br.gov.bcb.pix0136simulation-pix-code-here5204000053039865802BR5913FOTOW6009SAO PAULO62070503***6304XXXX',
                status: 'PENDING',
                dueDate: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
                expirationDate: new Date(Date.now() + 30 * 60 * 1000).toISOString()
            };
        }

        // Produção: Busca ou cria o customer
        const customerId = await getOrCreateCustomer(customerName, customerEmail);

        // Cria a cobrança PIX (sem payer, o CPF já está no customer)
        const response = await asaasClient.post('/payments', {
            customer: customerId,
            billingType: 'PIX',
            value: amount,
            dueDate: new Date().toISOString().split('T')[0], // Hoje
            description: description || `Pedido #${orderId} - Fotos Fotow`,
            externalReference: orderId,
            postalService: false
        });

        const payment = response.data;

        // Busca os dados do QR Code PIX
        const pixResponse = await asaasClient.get(`/payments/${payment.id}/pixQrCode`);
        const pixData = pixResponse.data;

        logger.info('Cobrança PIX criada com sucesso', {
            paymentId: payment.id,
            orderId,
            amount
        });

        // Garantir que o QR Code tenha o prefixo data:image
        let qrCodeImage = pixData.encodedImage;
        if (qrCodeImage && !qrCodeImage.startsWith('data:')) {
            qrCodeImage = `data:image/png;base64,${qrCodeImage}`;
        }

        return {
            id: payment.id,
            invoiceUrl: payment.invoiceUrl,
            pixQrCode: qrCodeImage, // QR Code em base64 com prefixo
            pixCopyPaste: pixData.payload, // Copia e cola
            status: payment.status,
            dueDate: payment.dueDate,
            expirationDate: pixData.expirationDate
        };

    } catch (error) {
        logger.error('Erro ao criar cobrança PIX no Asaas', {
            error: error.message,
            response: error.response?.data
        });
        throw new Error(`Erro ao criar pagamento PIX: ${error.response?.data?.errors?.[0]?.description || error.message}`);
    }
};

/**
 * Valida o status de um pagamento PIX no Asaas
 */
const validatePixPayment = async (paymentId) => {
    try {
        // Em desenvolvimento sem API key, simula validação
        if (process.env.NODE_ENV === 'development' && !process.env.ASAAS_API_KEY) {
            logger.info('Modo DEV: Simulando validação de pagamento', { paymentId });

            // Retorna que ainda está pendente (frontend fará polling)
            return {
                paid: false,
                status: 'PENDING',
                message: 'Aguardando pagamento (modo simulação)'
            };
        }

        // Produção: Consulta a API do Asaas
        const response = await asaasClient.get(`/payments/${paymentId}`);
        const payment = response.data;

        const isPaid = ['RECEIVED', 'CONFIRMED'].includes(payment.status);

        logger.info('Status do pagamento consultado', {
            paymentId,
            status: payment.status,
            isPaid
        });

        return {
            paid: isPaid,
            status: payment.status,
            paidAt: payment.confirmedDate || payment.paymentDate,
            message: isPaid ? 'Pagamento confirmado' : 'Aguardando pagamento'
        };

    } catch (error) {
        logger.error('Erro ao validar pagamento no Asaas', {
            error: error.message,
            paymentId
        });
        throw new Error(`Erro ao validar pagamento: ${error.message}`);
    }
};

/**
 * Confirma pagamento manualmente (apenas para testes em desenvolvimento)
 */
const confirmPixPaymentManually = async (paymentId) => {
    if (process.env.NODE_ENV !== 'development') {
        throw new Error('Confirmação manual só disponível em desenvolvimento');
    }

    logger.info('Confirmando pagamento manualmente (DEV)', { paymentId });

    return {
        paid: true,
        status: 'CONFIRMED',
        paidAt: new Date(),
        message: 'Pagamento confirmado manualmente (modo desenvolvimento)'
    };
};

/**
 * Webhook handler para receber notificações do Asaas
 */
const handleAsaasWebhook = async (webhookData) => {
    try {
        const { event, payment } = webhookData;

        logger.info('Webhook recebido do Asaas', {
            event,
            paymentId: payment.id,
            status: payment.status
        });

        // Processar eventos relevantes
        if (event === 'PAYMENT_RECEIVED' || event === 'PAYMENT_CONFIRMED') {
            return {
                processed: true,
                paymentId: payment.id,
                status: payment.status,
                externalReference: payment.externalReference // orderId
            };
        }

        return {
            processed: false,
            event
        };

    } catch (error) {
        logger.error('Erro ao processar webhook do Asaas', {
            error: error.message
        });
        throw error;
    }
};

module.exports = {
    createPixPayment,
    validatePixPayment,
    confirmPixPaymentManually,
    handleAsaasWebhook
};
