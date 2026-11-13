'use strict';

module.exports = (sequelize, DataTypes) => {
    const AgendaEntry = sequelize.define('AgendaEntry', {
        id: {
            type: DataTypes.UUID,
            defaultValue: DataTypes.UUIDV4,
            primaryKey: true
        },
        userId: {
            type: DataTypes.UUID,
            allowNull: false,
            references: { model: 'users', key: 'id' }
        },
        title: {
            type: DataTypes.STRING(255),
            allowNull: false
        },
        date: {
            type: DataTypes.DATEONLY,
            allowNull: false
        },
        description: {
            type: DataTypes.TEXT,
            allowNull: false,
            defaultValue: ''
        }
    }, {
        tableName: 'agenda_entries',
        timestamps: true,
        indexes: [{ fields: ['userId', 'date'] }]
    });

    AgendaEntry.associate = models => {
        AgendaEntry.belongsTo(models.User, { foreignKey: 'userId', as: 'user' });
    };

    return AgendaEntry;
};
