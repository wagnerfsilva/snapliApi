const { Order, OrderItem, Photo, Event } = require('../models');
const emailService = require('../services/email.service');
const pixService = require('../services/pix.service');
const logger = require('../utils/logger');
const crypto = require('crypto');

/**
 * Create new order
 */
exports.createOrder = async (req, res) => {
    try {
        const { customerName, customerEmail, items, bypassPayment } = req.body;

        // Validations
        if (!customerName || !customerEmail || !items || items.length === 0) {
            return res.status(400).json({
                error: 'Nome, email e itens são obrigatórios'
            });
        }

        // Calculate total amount and validate photos
        let totalAmount = 0;
        const photoIds = items.map(item => item.photoId);

        const photos = await Photo.findAll({
            where: { id: photoIds },
            include: [{
                model: Event,
                as: 'event',
                attributes: ['id', 'name', 'pricePerPhoto', 'pricingPackages', 'allPhotosPrice']
            }]
        });

        if (photos.length !== items.length) {
            return res.status(404).json({ error: 'Algumas fotos não foram encontradas' });
        }

        // Validate all photos are from the same event
        const eventIds = [...new Set(photos.map(p => p.eventId))];
        if (eventIds.length > 1) {
            return res.status(400).json({
                error: 'Todas as fotos devem ser do mesmo evento'
            });
        }

        const event = photos[0].event;

        // Calculate price based on event pricing
        const itemCount = items.length;
        let appliedPrice = event.pricePerPhoto || 10; // Default price

        logger.info(`Calculando preço para ${itemCount} fotos`, {
            eventId: event.id,
            eventName: event.name,
            pricePerPhoto: event.pricePerPhoto,
            pricingPackages: event.pricingPackages,
            allPhotosPrice: event.allPhotosPrice,
            photoCount: event.photoCount
        });

        // Check for package discounts
        if (event.pricingPackages && Array.isArray(event.pricingPackages)) {
            const packages = event.pricingPackages
                .filter(pkg => itemCount >= pkg.quantity)
                .sort((a, b) => b.quantity - a.quantity);

            if (packages.length > 0) {
                appliedPrice = packages[0].price / packages[0].quantity;
                logger.info(`Aplicando preço de pacote: R$ ${appliedPrice}`, {
                    packageUsed: packages[0]
                });
            }
        }

        // Check for "all photos" discount
        if (event.allPhotosPrice && event.photoCount && itemCount >= event.photoCount) {
            totalAmount = event.allPhotosPrice;
            logger.info(`Aplicando preço de todas as fotos: R$ ${totalAmount}`);
        } else {
            totalAmount = itemCount * appliedPrice;
            logger.info(`Preço calculado: ${itemCount} × R$ ${appliedPrice} = R$ ${totalAmount}`);
        }

        // Create order
        const orderData = {
            customerName,
            customerEmail,
            status: 'pending',
            totalAmount
        };

        const order = await Order.create(orderData);

        // Create order items
        const orderItems = await Promise.all(
            items.map(item =>
                OrderItem.create({
                    orderId: order.id,
                    photoId: item.photoId,
                    price: appliedPrice
                })
            )
        );

        logger.info(`Pedido criado: ${order.id} - ${customerEmail}`);

        // Reload order with items for email
        const orderWithItems = await Order.findByPk(order.id, {
            include: [{
                model: OrderItem,
                as: 'items'
            }]
        });

        // Criar cobrança PIX no Asaas
        let pixPayment;
        try {
            pixPayment = await pixService.createPixPayment({
                customerName,
                customerEmail,
                amount: totalAmount,
                orderId: order.id,
                description: `Pedido #${order.id.substring(0, 8)} - ${items.length} foto(s)`
            });

            // Salvar dados do pagamento no pedido
            await order.update({
                paymentId: pixPayment.id,
                paymentMethod: 'PIX',
                paymentLink: pixPayment.invoiceUrl
            });

            logger.info('Cobrança PIX criada', {
                orderId: order.id,
                paymentId: pixPayment.id
            });

        } catch (error) {
            logger.error('Erro ao criar cobrança PIX', { error: error.message });
            // Continua mesmo se falhar (em dev mode sem API key configurada)
        }

        // Retornar pedido com dados do PIX
        return res.status(201).json({
            success: true,
            order: {
                id: order.id,
                customerName: order.customerName,
                customerEmail: order.customerEmail,
                status: order.status,
                totalAmount: order.totalAmount,
                itemCount: items.length,
                paymentId: pixPayment?.id,
                paymentLink: pixPayment?.invoiceUrl
            },
            payment: pixPayment ? {
                pixQrCode: pixPayment.pixQrCode,
                pixCopyPaste: pixPayment.pixCopyPaste,
                expiresAt: pixPayment.expirationDate
            } : null,
            message: 'Pedido criado. Realize o pagamento para liberar o download.'
        });

    } catch (error) {
        logger.error('Erro ao criar pedido:', error);
        res.status(500).json({ error: 'Erro ao criar pedido' });
    }
};

/**
 * Get order by ID
 */
exports.getOrder = async (req, res) => {
    try {
        const { orderId } = req.params;

        const order = await Order.findByPk(orderId, {
            include: [
                {
                    model: OrderItem,
                    as: 'items',
                    include: [{
                        model: Photo,
                        as: 'photo',
                        include: [{
                            model: Event,
                            as: 'event',
                            attributes: ['id', 'name', 'date']
                        }]
                    }]
                }
            ]
        });

        if (!order) {
            return res.status(404).json({ error: 'Pedido não encontrado' });
        }

        // Only allow access to own order or if admin
        // For now, return order (add authentication later if needed)

        res.json({
            order: {
                id: order.id,
                customerName: order.customerName,
                customerEmail: order.customerEmail,
                status: order.status,
                totalAmount: order.totalAmount,
                paidAt: order.paidAt,
                downloadToken: order.downloadToken,
                downloadExpiresAt: order.downloadExpiresAt,
                createdAt: order.createdAt
            },
            items: order.items.map(item => ({
                id: item.id,
                photoId: item.photoId,
                price: item.price,
                photo: {
                    id: item.photo.id,
                    originalFilename: item.photo.originalFilename,
                    event: item.photo.event
                }
            }))
        });

    } catch (error) {
        logger.error('Erro ao buscar pedido:', error);
        res.status(500).json({ error: 'Erro ao buscar pedido' });
    }
};

/**
 * List orders (admin only - add auth middleware later)
 */
exports.listOrders = async (req, res) => {
    try {
        const { status, limit = 50, offset = 0 } = req.query;

        const where = {};
        if (status) {
            where.status = status;
        }

        const orders = await Order.findAll({
            where,
            limit: parseInt(limit),
            offset: parseInt(offset),
            order: [['createdAt', 'DESC']],
            include: [
                {
                    model: OrderItem,
                    as: 'items',
                    attributes: ['id']
                }
            ]
        });

        res.json({
            orders: orders.map(order => ({
                id: order.id,
                customerName: order.customerName,
                customerEmail: order.customerEmail,
                status: order.status,
                totalAmount: order.totalAmount,
                itemCount: order.items.length,
                paidAt: order.paidAt,
                createdAt: order.createdAt
            })),
            total: orders.length
        });

    } catch (error) {
        logger.error('Erro ao listar pedidos:', error);
        res.status(500).json({ error: 'Erro ao listar pedidos' });
    }
};

/**
 * Valida status de pagamento PIX
 */
exports.validatePayment = async (req, res) => {
    try {
        const { orderId } = req.params;

        const order = await Order.findByPk(orderId);

        if (!order) {
            return res.status(404).json({ error: 'Pedido não encontrado' });
        }

        // Se já está pago, retorna sucesso
        if (order.status === 'paid') {
            return res.json({
                success: true,
                paid: true,
                order: {
                    id: order.id,
                    status: order.status,
                    paidAt: order.paidAt,
                    downloadToken: order.downloadToken,
                    downloadUrl: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/downloads/${order.downloadToken}`
                }
            });
        }

        // Consulta status no Asaas
        if (order.paymentId) {
            const paymentStatus = await pixService.validatePixPayment(order.paymentId);

            if (paymentStatus.paid) {
                // Atualiza pedido para pago
                order.status = 'paid';
                order.paidAt = paymentStatus.paidAt || new Date();
                order.downloadToken = crypto.randomBytes(32).toString('hex');
                order.downloadExpiresAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);
                await order.save();

                // Envia email com link de download
                await emailService.sendDownloadEmail(order);

                logger.info('Pagamento confirmado', {
                    orderId: order.id,
                    paymentId: order.paymentId
                });

                return res.json({
                    success: true,
                    paid: true,
                    order: {
                        id: order.id,
                        status: order.status,
                        paidAt: order.paidAt,
                        downloadToken: order.downloadToken,
                        downloadUrl: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/downloads/${order.downloadToken}`
                    }
                });
            }
        }

        // Ainda aguardando pagamento
        res.json({
            success: true,
            paid: false,
            message: 'Aguardando confirmação do pagamento'
        });

    } catch (error) {
        logger.error('Erro ao validar pagamento:', error);
        res.status(500).json({ error: 'Erro ao validar pagamento' });
    }
};

/**
 * Busca QR Code PIX de um pedido
 */
exports.getPixQrCode = async (req, res) => {
    try {
        const { orderId } = req.params;

        const order = await Order.findByPk(orderId);

        if (!order) {
            return res.status(404).json({ error: 'Pedido não encontrado' });
        }

        if (!order.paymentId) {
            return res.status(400).json({ error: 'Pedido sem pagamento associado' });
        }

        const pixData = await pixService.getPixQrCode(order.paymentId);

        res.json({
            success: true,
            payment: {
                pixQrCode: pixData.pixQrCode,
                pixCopyPaste: pixData.pixCopyPaste
            }
        });

    } catch (error) {
        logger.error('Erro ao buscar QR Code:', error);
        res.status(500).json({ error: 'Erro ao buscar QR Code' });
    }
};

/**
 * Webhook do Asaas para notificações de pagamento
 */
exports.asaasWebhook = async (req, res) => {
    try {
        const webhookData = req.body;

        logger.info('Webhook recebido do Asaas', { event: webhookData.event });

        const result = await pixService.handleAsaasWebhook(webhookData);

        if (result.processed && result.externalReference) {
            // Busca o pedido pelo ID
            const order = await Order.findByPk(result.externalReference);

            if (order && order.status !== 'paid') {
                // Atualiza pedido para pago
                order.status = 'paid';
                order.paidAt = new Date();
                order.downloadToken = crypto.randomBytes(32).toString('hex');
                order.downloadExpiresAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);
                await order.save();

                // Envia email com link de download
                await emailService.sendDownloadEmail(order);

                logger.info('Pedido atualizado via webhook', {
                    orderId: order.id,
                    paymentId: result.paymentId
                });
            }
        }

        // Sempre retorna 200 para o Asaas
        res.status(200).json({ received: true });

    } catch (error) {
        logger.error('Erro ao processar webhook:', error);
        res.status(200).json({ received: true }); // Retorna 200 mesmo com erro
    }
};

/**
 * Confirmação manual de pagamento (DEV MODE)
 */
exports.confirmPaymentManually = async (req, res) => {
    try {
        if (process.env.NODE_ENV !== 'development') {
            return res.status(403).json({
                error: 'Endpoint disponível apenas em desenvolvimento'
            });
        }

        const { orderId } = req.params;

        const order = await Order.findByPk(orderId);

        if (!order) {
            return res.status(404).json({ error: 'Pedido não encontrado' });
        }

        if (order.status === 'paid') {
            return res.status(400).json({ error: 'Pedido já está pago' });
        }

        // Confirma pagamento manualmente
        if (order.paymentId) {
            await pixService.confirmPixPaymentManually(order.paymentId);
        }

        order.status = 'paid';
        order.paidAt = new Date();
        order.downloadToken = crypto.randomBytes(32).toString('hex');
        order.downloadExpiresAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);
        await order.save();

        await emailService.sendDownloadEmail(order);

        logger.info('Pagamento confirmado manualmente (DEV)', {
            orderId: order.id
        });

        res.json({
            success: true,
            order: {
                id: order.id,
                status: order.status,
                paidAt: order.paidAt,
                downloadToken: order.downloadToken,
                downloadUrl: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/downloads/${order.downloadToken}`
            }
        });

    } catch (error) {
        logger.error('Erro ao confirmar pagamento:', error);
        res.status(500).json({ error: 'Erro ao confirmar pagamento' });
    }
};

/**
 * Simulate payment confirmation (DEV MODE ONLY)
 * This simulates what the Asaas webhook will do
 */
exports.simulatePayment = async (req, res) => {
    try {
        // Only allow in development
        if (process.env.NODE_ENV !== 'development') {
            return res.status(403).json({
                error: 'Endpoint disponível apenas em desenvolvimento'
            });
        }

        const { orderId } = req.params;

        const order = await Order.findByPk(orderId);

        if (!order) {
            return res.status(404).json({ error: 'Pedido não encontrado' });
        }

        if (order.status === 'paid') {
            return res.status(400).json({ error: 'Pedido já está pago' });
        }

        // Simulate payment confirmation
        order.status = 'paid';
        order.paidAt = new Date();
        order.downloadToken = crypto.randomBytes(32).toString('hex');
        order.downloadExpiresAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);
        await order.save();

        // Send download email
        await emailService.sendDownloadEmail(order);

        logger.info(`Pagamento simulado: ${order.id}`);

        res.json({
            success: true,
            order: {
                id: order.id,
                status: order.status,
                downloadToken: order.downloadToken,
                downloadUrl: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/downloads/${order.downloadToken}`
            },
            message: 'Pagamento simulado com sucesso'
        });

    } catch (error) {
        logger.error('Erro ao simular pagamento:', error);
        res.status(500).json({ error: 'Erro ao simular pagamento' });
    }
};
