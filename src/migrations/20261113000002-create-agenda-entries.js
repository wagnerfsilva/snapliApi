'use strict';

module.exports = {
    async up(queryInterface, Sequelize) {
        await queryInterface.sequelize.transaction(async transaction => {
            await queryInterface.createTable('agenda_entries', {
                id: {
                    type: Sequelize.UUID,
                    defaultValue: Sequelize.UUIDV4,
                    primaryKey: true
                },
                userId: {
                    type: Sequelize.UUID,
                    allowNull: false,
                    references: { model: 'users', key: 'id' },
                    onUpdate: 'CASCADE',
                    onDelete: 'CASCADE'
                },
                title: { type: Sequelize.STRING(255), allowNull: false },
                date: { type: Sequelize.DATEONLY, allowNull: false },
                description: { type: Sequelize.TEXT, allowNull: false, defaultValue: '' },
                createdAt: {
                    type: Sequelize.DATE,
                    allowNull: false,
                    defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
                },
                updatedAt: {
                    type: Sequelize.DATE,
                    allowNull: false,
                    defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
                }
            }, { transaction });
            await queryInterface.addIndex('agenda_entries', ['userId', 'date'], { transaction });
            await queryInterface.sequelize.query(
                'ALTER TABLE agenda_entries ENABLE ROW LEVEL SECURITY;', { transaction }
            );
            await queryInterface.sequelize.query(
                'ALTER TABLE agenda_entries FORCE ROW LEVEL SECURITY;', { transaction }
            );
            await queryInterface.sequelize.query(`
                CREATE POLICY "block_public_access" ON agenda_entries
                AS RESTRICTIVE FOR ALL USING (false) WITH CHECK (false);
            `, { transaction });
        });
    },

    async down(queryInterface) {
        await queryInterface.dropTable('agenda_entries');
    }
};
