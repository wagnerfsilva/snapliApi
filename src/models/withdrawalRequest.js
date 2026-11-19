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
            allowNull: true,
            references: {
                model: 'users',
                key: 'id'
            }
        },
        photographerId: {
            type: DataTypes.UUID,
            allowNull: true,
            references: { model: 'users', key: 'id' }
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
            comment: 'Observação do beneficiário ao solicitar o resgate'
        },
        pixKey: {
            type: DataTypes.STRING,
            allowNull: true,
            comment: 'Cópia da chave PIX do beneficiário no momento da solicitação de resgate'
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
        validate: {
            oneBeneficiary() {
                if (Boolean(this.organizerId) === Boolean(this.photographerId)) {
                    throw new Error('O resgate deve possuir exatamente um beneficiário');
                }
            }
        },
        indexes: [
            {
                fields: ['eventId']
            },
            {
                fields: ['organizerId']
            },
            {
                fields: ['photographerId']
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
        WithdrawalRequest.belongsTo(models.User, { foreignKey: 'photographerId', as: 'photographer' });

        WithdrawalRequest.belongsTo(models.User, {
            foreignKey: 'processedBy',
            as: 'processedByUser'
        });
    };

    return WithdrawalRequest;
};
