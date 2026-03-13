const logger = require('../utils/logger');

/**
 * Global error handler middleware
 */
const errorHandler = (err, req, res, next) => {
    logger.error('Error:', {
        message: err.message,
        stack: err.stack,
        path: req.path,
        method: req.method,
        body: req.body,
        query: req.query,
        params: req.params
    });

    // Sequelize validation error
    if (err.name === 'SequelizeValidationError') {
        return res.status(400).json({
            success: false,
            message: 'Erro de validação',
            errors: err.errors.map(e => ({
                field: e.path,
                message: e.message
            }))
        });
    }

    // Sequelize unique constraint error
    if (err.name === 'SequelizeUniqueConstraintError') {
        return res.status(409).json({
            success: false,
            message: 'Registro duplicado',
            errors: err.errors.map(e => ({
                field: e.path,
                message: `${e.path} já existe`
            }))
        });
    }

    // Sequelize foreign key error
    if (err.name === 'SequelizeForeignKeyConstraintError') {
        return res.status(400).json({
            success: false,
            message: 'Referência inválida'
        });
    }

    // Multer file upload error
    if (err.name === 'MulterError') {
        if (err.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({
                success: false,
                message: 'Arquivo muito grande'
            });
        }
        if (err.code === 'LIMIT_FILE_COUNT') {
            return res.status(400).json({
                success: false,
                message: 'Muitos arquivos'
            });
        }
        return res.status(400).json({
            success: false,
            message: 'Erro no upload do arquivo'
        });
    }

    // JWT errors (fallback)
    if (err.name === 'JsonWebTokenError') {
        return res.status(401).json({
            success: false,
            message: 'Token inválido'
        });
    }

    if (err.name === 'TokenExpiredError') {
        return res.status(401).json({
            success: false,
            message: 'Token expirado'
        });
    }

    // AWS SDK errors
    if (err.name === 'S3ServiceException' || err.$metadata) {
        return res.status(500).json({
            success: false,
            message: 'Erro no serviço de armazenamento'
        });
    }

    // Default error
    const statusCode = err.statusCode || 500;
    const message = process.env.NODE_ENV === 'production'
        ? 'Erro interno do servidor'
        : err.message;

    res.status(statusCode).json({
        success: false,
        message,
        ...(process.env.NODE_ENV !== 'production' && { stack: err.stack })
    });
};

/**
 * 404 handler
 */
const notFound = (req, res) => {
    res.status(404).json({
        success: false,
        message: 'Rota não encontrada'
    });
};

module.exports = {
    errorHandler,
    notFound
};
