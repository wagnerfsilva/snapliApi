'use strict';

module.exports = (sequelize, DataTypes) => {
    const OrderItem = sequelize.define('OrderItem', {
        id: {
            type: DataTypes.UUID,
            defaultValue: DataTypes.UUIDV4,
            primaryKey: true
        },
        orderId: {
            type: DataTypes.UUID,
            allowNull: false,
            references: {
                model: 'orders',
                key: 'id'
            }
        },
        photoId: {
            type: DataTypes.UUID,
            allowNull: false,
            references: {
                model: 'photos',
                key: 'id'
            }
        },
        price: {
            type: DataTypes.DECIMAL(10, 2),
            allowNull: false,
            defaultValue: 0.00
        },
        downloadUrl: {
            type: DataTypes.TEXT,
            allowNull: true,
            comment: 'Pre-signed URL for download (generated after payment)'
        },
        downloadedAt: {
            type: DataTypes.DATE,
            allowNull: true
        },
        downloadCount: {
            type: DataTypes.INTEGER,
            defaultValue: 0
        }
    }, {
        tableName: 'order_items',
        timestamps: true,
        indexes: [
            {
                fields: ['orderId']
            },
            {
                fields: ['photoId']
            }
        ]
    });

    OrderItem.associate = function (models) {
        // OrderItem belongs to Order
        OrderItem.belongsTo(models.Order, {
            foreignKey: 'orderId',
            as: 'order'
        });

        // OrderItem belongs to Photo
        OrderItem.belongsTo(models.Photo, {
            foreignKey: 'photoId',
            as: 'photo'
        });
    };

    return OrderItem;
};
