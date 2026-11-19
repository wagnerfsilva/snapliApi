const service = require('../services/order-photo-update.service');
const logger = require('../utils/logger');

exports.preview = async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: 'Envie uma foto de referência.' });
        const data = await service.preview(req.params.orderId, req.params.eventId, req.userId, req.file.buffer);
        return res.json({ success: true, data });
    } catch (error) {
        logger.error('Erro ao preparar atualização de fotos do pedido', { orderId: req.params.orderId, error: error.message });
        return res.status(error.statusCode || 500).json({
            error: error.statusCode ? error.message : 'Erro ao buscar novas fotos.'
        });
    }
};

exports.confirm = async (req, res) => {
    try {
        const data = await service.confirm(req.params.orderId, req.params.eventId, req.userId, req.body.previewToken, req.body.photoIds);
        logger.info('Fotos adicionadas ao pedido sem alteração financeira', {
            orderId: req.params.orderId, eventId: req.params.eventId, adminId: req.userId, addedCount: data.addedCount
        });
        return res.json({ success: true, data });
    } catch (error) {
        logger.error('Erro ao confirmar atualização de fotos do pedido', { orderId: req.params.orderId, error: error.message });
        return res.status(error.statusCode || 500).json({
            error: error.statusCode ? error.message : 'Erro ao adicionar novas fotos.'
        });
    }
};
