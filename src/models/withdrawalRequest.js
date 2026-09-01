'use strict';

module.exports = (sequelize, DataTypes) => {
    const WithdrawalRequest = sequelize.define('WithdrawalRequest', {
        id: {
            type: DataTypes.UUID,
            defaultValue: DataTypes.UUIDV4,
            primaryKey: true
        },
        eventId: {
            type: DataTypes.UUID,
            allowNull: false,
            references: {
                model: 'events',
                key: 'id'
            }
        },
        organizerId: {
            type: DataTypes.UUID,
            allowNull: false,
            references: {
                model: 'users',
                key: 'id'
            }
        },
        amount: {
            type: DataTypes.DECIMAL(10, 2),
            allowNull: false
        },
        status: {
            type: DataTypes.ENUM('pending', 'approved', 'rejected', 'paid'),
            defaultValue: 'pending',
            allowNull: false
        },
        notes: {
            type: DataTypes.TEXT,
            allowNull: true,
            comment: 'Observação do organizador ao solicitar o resgate'
        },
        adminNotes: {
            type: DataTypes.TEXT,
            allowNull: true,
            comment: 'Observação do admin ao processar a solicitação'
        },
        processedBy: {
            type: DataTypes.UUID,
            allowNull: true,
            references: {
                model: 'users',
                key: 'id'
            }
        },
        processedAt: {
            type: DataTypes.DATE,
            allowNull: true
        }
    }, {
        tableName: 'withdrawal_requests',
        timestamps: true,
        indexes: [
            {
                fields: ['eventId']
            },
            {
                fields: ['organizerId']
            },
            {
                fields: ['status']
            }
        ]
    });

    WithdrawalRequest.associate = function (models) {
        WithdrawalRequest.belongsTo(models.Event, {
            foreignKey: 'eventId',
            as: 'event'
        });

        WithdrawalRequest.belongsTo(models.User, {
            foreignKey: 'organizerId',
            as: 'organizer'
        });

        WithdrawalRequest.belongsTo(models.User, {
            foreignKey: 'processedBy',
            as: 'processedByUser'
        });
    };

    return WithdrawalRequest;
};
