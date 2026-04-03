const { Order, OrderItem, Photo, Event } = require('../models');
const s3Service = require('../services/s3.service');
const emailService = require('../services/email.service');
const logger = require('../utils/logger');
const crypto = require('crypto');

/**
 * Generate download token for paid order
 */
exports.generateDownloadToken = async (req, res) => {
    try {
        const { orderId } = req.params;

        const order = await Order.findByPk(orderId, {
            include: [{
                model: OrderItem,
                as: 'items',
                include: [{
                    model: Photo,
                    as: 'photo'
                }]
            }]
        });

        if (!order) {
            return res.status(404).json({ error: 'Pedido não encontrado' });
        }

        // Only paid orders can have download tokens
        if (order.status !== 'paid' && order.status !== 'completed') {
            return res.status(400).json({ error: 'Pedido ainda não foi pago' });
        }

        // Generate token if not exists
        if (!order.downloadToken) {
            order.downloadToken = crypto.randomBytes(32).toString('hex');

            // Set expiration date (90 days from payment)
            if (!order.downloadExpiresAt) {
                const expiresAt = new Date();
                expiresAt.setDate(expiresAt.getDate() + 90);
                order.downloadExpiresAt = expiresAt;
            }

            await order.save();
        }

        res.json({
            downloadToken: order.downloadToken,
            downloadUrl: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/downloads/${order.downloadToken}`,
            expiresAt: order.downloadExpiresAt,
            itemCount: order.items.length
        });

    } catch (error) {
        logger.error('Erro ao gerar token de download:', error);
        res.status(500).json({ error: 'Erro ao gerar token de download' });
    }
};

/**
 * Get order details by download token (public route)
 */
exports.getOrderByToken = async (req, res) => {
    try {
        const { token } = req.params;

        const order = await Order.findOne({
            where: { downloadToken: token },
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
            return res.status(404).json({ error: 'Token inválido ou expirado' });
        }

        // Check if download period has expired
        if (order.downloadExpiresAt && new Date() > new Date(order.downloadExpiresAt)) {
            return res.status(410).json({
                error: 'Período de download expirado',
                expiredAt: order.downloadExpiresAt
            });
        }

        // Check if order is paid
        if (order.status !== 'paid' && order.status !== 'completed') {
            return res.status(403).json({ error: 'Pedido ainda não foi pago' });
        }

        // Format response
        const photos = await Promise.all(order.items.map(async (item) => {
            // Generate presigned URL for watermarked preview
            const previewUrl = await s3Service.generatePresignedUrl(
                item.photo.watermarkedKey,
                'watermarked',
                3600 // 1 hour
            );

            return {
                id: item.photo.id,
                photoId: item.photo.id,
                originalFilename: item.photo.originalFilename,
                width: item.photo.width,
                height: item.photo.height,
                fileSize: item.photo.fileSize,
                event: item.photo.event,
                price: item.price,
                downloadedAt: item.downloadedAt,
                downloadCount: item.downloadCount,
                previewUrl // Watermarked preview
            };
        }));

        res.json({
            order: {
                id: order.id,
                customerName: order.customerName,
                customerEmail: order.customerEmail,
                totalAmount: order.totalAmount,
                paidAt: order.paidAt,
                downloadExpiresAt: order.downloadExpiresAt,
                status: order.status
            },
            photos,
            photoCount: photos.length
        });

    } catch (error) {
        logger.error('Erro ao buscar pedido por token:', error);
        res.status(500).json({ error: 'Erro ao buscar pedido' });
    }
};

/**
 * Download original photo (public route with token)
 */
exports.downloadPhoto = async (req, res) => {
    try {
        const { token, photoId } = req.params;

        // Find order by token
        const order = await Order.findOne({
            where: { downloadToken: token },
            include: [{
                model: OrderItem,
                as: 'items',
                where: { photoId },
                include: [{
                    model: Photo,
                    as: 'photo'
                }]
            }]
        });

        if (!order) {
            return res.status(404).json({ error: 'Token inválido ou foto não encontrada' });
        }

        // Check if download period has expired
        if (order.downloadExpiresAt && new Date() > new Date(order.downloadExpiresAt)) {
            return res.status(410).json({ error: 'Período de download expirado' });
        }

        // Check if order is paid
        if (order.status !== 'paid' && order.status !== 'completed') {
            return res.status(403).json({ error: 'Pedido ainda não foi pago' });
        }

        const orderItem = order.items[0];
        const photo = orderItem.photo;

        // Generate presigned URL for original photo (1 hour expiration)
        // Include Content-Disposition: attachment to force browser download
        const downloadUrl = await s3Service.generatePresignedUrl(
            photo.originalKey,
            'original',
            3600, // 1 hour
            { downloadFilename: photo.originalFilename }
        );

        // Update download statistics
        orderItem.downloadCount = (orderItem.downloadCount || 0) + 1;
        if (!orderItem.downloadedAt) {
            orderItem.downloadedAt = new Date();
        }
        await orderItem.save();

        res.json({
            downloadUrl,
            filename: photo.originalFilename,
            expiresIn: 3600 // seconds
        });

    } catch (error) {
        logger.error('Erro ao gerar URL de download:', error);
        res.status(500).json({ error: 'Erro ao gerar URL de download' });
    }
};

/**
 * Download all photos as ZIP (future enhancement)
 */
exports.downloadAllPhotos = async (req, res) => {
    try {
        const { token } = req.params;

        // This is a placeholder for future ZIP download functionality
        res.status(501).json({
            message: 'Download em lote será implementado em breve',
            suggestion: 'Por favor, faça o download individual de cada foto'
        });

    } catch (error) {
        logger.error('Erro ao preparar download em lote:', error);
        res.status(500).json({ error: 'Erro ao preparar download' });
    }
};

/**
 * Resend download email
 */
exports.resendDownloadEmail = async (req, res) => {
    try {
        const { orderId } = req.params;

        const order = await Order.findByPk(orderId);

        if (!order) {
            return res.status(404).json({ error: 'Pedido não encontrado' });
        }

        if (!order.downloadToken) {
            return res.status(400).json({ error: 'Token de download não disponível' });
        }

        if (order.status !== 'paid' && order.status !== 'completed') {
            return res.status(400).json({ error: 'Pedido ainda não foi pago' });
        }

        await emailService.sendDownloadEmail(order);

        res.json({
            message: 'Email reenviado com sucesso',
            email: order.customerEmail
        });

    } catch (error) {
        logger.error('Erro ao reenviar email:', error);
        res.status(500).json({ error: 'Erro ao reenviar email', detail: error.message });
    }
};
