const jwt = require('jsonwebtoken');
const jwtConfig = require('../config/jwt');
const { User } = require('../models');
const logger = require('../utils/logger');

/**
 * Authentication middleware - validates JWT token
 */
const authenticate = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;

        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({
                success: false,
                message: 'Token de autenticação não fornecido'
            });
        }

        const token = authHeader.substring(7);

        try {
            const decoded = jwt.verify(token, jwtConfig.secret, {
                issuer: jwtConfig.issuer,
                audience: jwtConfig.audience
            });

            // Find user
            const user = await User.findByPk(decoded.userId);

            if (!user || !user.isActive) {
                return res.status(401).json({
                    success: false,
                    message: 'Usuário não encontrado ou inativo'
                });
            }

            // Attach user to request
            req.user = user;
            req.userId = user.id;
            req.userRole = user.role;

            next();
        } catch (error) {
            if (error.name === 'TokenExpiredError') {
                return res.status(401).json({
                    success: false,
                    message: 'Token expirado'
                });
            }

            if (error.name === 'JsonWebTokenError') {
                return res.status(401).json({
                    success: false,
                    message: 'Token inválido'
                });
            }

            throw error;
        }
    } catch (error) {
        logger.error('Erro no middleware de autenticação:', error);
        return res.status(500).json({
            success: false,
            message: 'Erro ao validar autenticação'
        });
    }
};

/**
 * Authorization middleware - checks user role
 */
const authorize = (...allowedRoles) => {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({
                success: false,
                message: 'Autenticação necessária'
            });
        }

        if (!allowedRoles.includes(req.userRole)) {
            return res.status(403).json({
                success: false,
                message: 'Acesso negado. Permissões insuficientes.'
            });
        }

        next();
    };
};

/**
 * Optional authentication - doesn't fail if no token provided
 */
const optionalAuth = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;

        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return next();
        }

        const token = authHeader.substring(7);

        try {
            const decoded = jwt.verify(token, jwtConfig.secret, {
                issuer: jwtConfig.issuer,
                audience: jwtConfig.audience
            });

            const user = await User.findByPk(decoded.userId);

            if (user && user.isActive) {
                req.user = user;
                req.userId = user.id;
                req.userRole = user.role;
            }
        } catch (error) {
            // Silently fail for optional auth
        }

        next();
    } catch (error) {
        logger.error('Erro no middleware de autenticação opcional:', error);
        next();
    }
};

module.exports = {
    authenticate,
    authorize,
    optionalAuth
};
