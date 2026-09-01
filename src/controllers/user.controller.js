const { User } = require('../models');
const { Op } = require('sequelize');
const logger = require('../utils/logger');

const SEARCH_RESULT_LIMIT = 8;
const CREATABLE_ROLES = ['fotografo', 'organizador'];

class UserController {
    /**
     * List all users (admin-only), optional ?role= filter.
     * Used only by the "Organizadores" management screen.
     */
    async getAll(req, res, next) {
        try {
            const { role, isActive } = req.query;

            const where = {};
            if (role) where.role = role;
            if (isActive !== undefined) where.isActive = isActive === 'true';

            const users = await User.findAll({
                where,
                attributes: ['id', 'name', 'email', 'role', 'isActive', 'lastLogin', 'createdAt'],
                order: [['name', 'ASC']]
            });

            res.json({
                success: true,
                data: { users }
            });
        } catch (error) {
            next(error);
        }
    }

    /**
     * Search organizadores by name/email — never lists all, requires a query term.
     * Used to populate the autocomplete field on the event form (admin + fotografo).
     */
    async searchOrganizers(req, res, next) {
        try {
            const { q } = req.query;

            const users = await User.findAll({
                where: {
                    role: 'organizador',
                    isActive: true,
                    [Op.or]: [
                        { name: { [Op.iLike]: `%${q}%` } },
                        { email: { [Op.iLike]: `%${q}%` } }
                    ]
                },
                attributes: ['id', 'name', 'email'],
                order: [['name', 'ASC']],
                limit: SEARCH_RESULT_LIMIT
            });

            res.json({
                success: true,
                data: { users }
            });
        } catch (error) {
            next(error);
        }
    }

    /**
     * Create a new user (admin-only). Role restricted to fotografo/organizador —
     * this endpoint can never create an admin account.
     */
    async create(req, res, next) {
        try {
            const { name, email, password, role } = req.body;

            if (!CREATABLE_ROLES.includes(role)) {
                return res.status(400).json({
                    success: false,
                    message: 'Role inválida. Permitido apenas: fotografo, organizador'
                });
            }

            const existing = await User.findOne({ where: { email } });
            if (existing) {
                return res.status(409).json({
                    success: false,
                    message: 'Já existe um usuário com este email'
                });
            }

            const user = await User.create({ name, email, password, role, isActive: true });

            logger.info(`Usuário criado: ${user.id} - ${user.email} (${user.role})`);

            res.status(201).json({
                success: true,
                message: 'Usuário criado com sucesso',
                data: { user: user.toJSON() }
            });
        } catch (error) {
            next(error);
        }
    }

    /**
     * Toggle isActive for a user (admin-only).
     */
    async toggleActive(req, res, next) {
        try {
            const { id } = req.params;

            const user = await User.findByPk(id);
            if (!user) {
                return res.status(404).json({
                    success: false,
                    message: 'Usuário não encontrado'
                });
            }

            await user.update({ isActive: !user.isActive });

            logger.info(`Usuário ${user.isActive ? 'ativado' : 'desativado'}: ${user.id} - ${user.email}`);

            res.json({
                success: true,
                message: `Usuário ${user.isActive ? 'ativado' : 'desativado'} com sucesso`,
                data: { user: user.toJSON() }
            });
        } catch (error) {
            next(error);
        }
    }
}

module.exports = new UserController();
