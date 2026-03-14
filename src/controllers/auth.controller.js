const jwt = require('jsonwebtoken');
const { User } = require('../models');
const jwtConfig = require('../config/jwt');
const logger = require('../utils/logger');

class AuthController {
    /**
     * Login
     */
    async login(req, res, next) {
        try {
            const { email, password } = req.body;

            // Find user
            const user = await User.findOne({ where: { email } });

            if (!user) {
                return res.status(401).json({
                    success: false,
                    message: 'Email ou senha inválidos'
                });
            }

            // Check if user is active
            if (!user.isActive) {
                return res.status(401).json({
                    success: false,
                    message: 'Usuário inativo'
                });
            }

            // Validate password
            const isValidPassword = await user.validatePassword(password);

            if (!isValidPassword) {
                return res.status(401).json({
                    success: false,
                    message: 'Email ou senha inválidos'
                });
            }

            // Update last login
            await user.update({ lastLogin: new Date() });

            // Generate JWT token
            const token = jwt.sign(
                {
                    userId: user.id,
                    email: user.email,
                    role: user.role
                },
                jwtConfig.secret,
                {
                    expiresIn: jwtConfig.expiresIn,
                    issuer: jwtConfig.issuer,
                    audience: jwtConfig.audience
                }
            );

            logger.info(`Login bem-sucedido: ${user.email}`);

            res.json({
                success: true,
                message: 'Login realizado com sucesso',
                data: {
                    token,
                    user: user.toJSON()
                }
            });
        } catch (error) {
            logger.error('Login error:', { message: error.message, name: error.name, stack: error.stack });
            res.status(500).json({ success: false, debug_error: error.message, debug_name: error.name });
        }
    }

    /**
     * Get current user
     */
    async me(req, res, next) {
        try {
            res.json({
                success: true,
                data: {
                    user: req.user.toJSON()
                }
            });
        } catch (error) {
            next(error);
        }
    }

    /**
     * Logout (client-side token removal)
     */
    async logout(req, res, next) {
        try {
            logger.info(`Logout: ${req.user.email}`);

            res.json({
                success: true,
                message: 'Logout realizado com sucesso'
            });
        } catch (error) {
            next(error);
        }
    }

    /**
     * Change password
     */
    async changePassword(req, res, next) {
        try {
            const { currentPassword, newPassword } = req.body;
            const user = req.user;

            // Validate current password
            const isValidPassword = await user.validatePassword(currentPassword);

            if (!isValidPassword) {
                return res.status(400).json({
                    success: false,
                    message: 'Senha atual incorreta'
                });
            }

            // Update password
            await user.update({ password: newPassword });

            logger.info(`Senha alterada: ${user.email}`);

            res.json({
                success: true,
                message: 'Senha alterada com sucesso'
            });
        } catch (error) {
            next(error);
        }
    }
}

module.exports = new AuthController();
