'use strict';

module.exports = (sequelize, DataTypes) => {
    const Order = sequelize.define('Order', {
        id: {
            type: DataTypes.UUID,
            defaultValue: DataTypes.UUIDV4,
            primaryKey: true
        },
        userId: {
            type: DataTypes.UUID,
            allowNull: true,
            references: {
                model: 'users',
                key: 'id'
            },
            comment: 'Optional - clients may not have accounts'
        },
        customerEmail: {
            type: DataTypes.STRING,
            allowNull: false,
            validate: {
                isEmail: true
            }
        },
        customerName: {
            type: DataTypes.STRING,
            allowNull: false
        },
        status: {
            type: DataTypes.ENUM('pending', 'processing', 'paid', 'completed', 'cancelled', 'refunded'),
            defaultValue: 'pending',
            allowNull: false
        },
        totalAmount: {
            type: DataTypes.DECIMAL(10, 2),
            allowNull: false,
            defaultValue: 0.00
        },
        paymentMethod: {
            type: DataTypes.STRING,
            allowNull: true,
            comment: 'Future: Asaas payment method'
        },
        paymentId: {
            type: DataTypes.STRING,
            allowNull: true,
            comment: 'Future: Asaas payment ID'
        },
        paymentLink: {
            type: DataTypes.TEXT,
            allowNull: true,
            comment: 'Future: Asaas payment link'
        },
        paidAt: {
            type: DataTypes.DATE,
            allowNull: true
        },
        downloadExpiresAt: {
            type: DataTypes.DATE,
            allowNull: true,
            comment: 'Expiration date for download links'
        },
        downloadToken: {
            type: DataTypes.STRING,
            allowNull: true,
            unique: true,
            comment: 'Unique token for accessing download portal'
        },
        notes: {
            type: DataTypes.TEXT,
            allowNull: true
        }
    }, {
        tableName: 'orders',
        timestamps: true,
        indexes: [
            {
                fields: ['status']
            },
            {
                fields: ['customerEmail']
            },
            {
                fields: ['paidAt']
            },
            {
                fields: ['downloadToken']
            }
        ]
    });

    Order.associate = function (models) {
        // Order belongs to User (optional)
        Order.belongsTo(models.User, {
            foreignKey: 'userId',
            as: 'user'
        });

        // Order has many OrderItems
        Order.hasMany(models.OrderItem, {
            foreignKey: 'orderId',
            as: 'items',
            onDelete: 'CASCADE'
        });

        // Order has many Photos through OrderItems
        Order.belongsToMany(models.Photo, {
            through: models.OrderItem,
            foreignKey: 'orderId',
            as: 'photos'
        });
    };

    return Order;
};
