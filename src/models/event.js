'use strict';

module.exports = (sequelize, DataTypes) => {
    const Event = sequelize.define('Event', {
        id: {
            type: DataTypes.UUID,
            defaultValue: DataTypes.UUIDV4,
            primaryKey: true
        },
        name: {
            type: DataTypes.STRING,
            allowNull: false
        },
        date: {
            type: DataTypes.DATE,
            allowNull: false
        },
        description: {
            type: DataTypes.TEXT,
            allowNull: true
        },
        location: {
            type: DataTypes.STRING,
            allowNull: true
        },
        isActive: {
            type: DataTypes.BOOLEAN,
            defaultValue: true
        },
        photoCount: {
            type: DataTypes.INTEGER,
            defaultValue: 0
        },
        createdBy: {
            type: DataTypes.UUID,
            allowNull: false,
            references: {
                model: 'users',
                key: 'id'
            }
        },
        pricePerPhoto: {
            type: DataTypes.DECIMAL(10, 2),
            allowNull: true,
            defaultValue: 5.00,
            comment: 'Preço por foto individual'
        },
        pricingPackages: {
            type: DataTypes.JSON,
            allowNull: true,
            defaultValue: null,
            comment: 'Array de pacotes: [{quantity: 5, price: 4.00}, {quantity: 10, price: 7.00}]'
        },
        allPhotosPrice: {
            type: DataTypes.DECIMAL(10, 2),
            allowNull: true,
            defaultValue: null,
            comment: 'Preço para comprar todas as fotos do evento'
        }
    }, {
        tableName: 'events',
        timestamps: true,
        indexes: [
            {
                fields: ['date']
            },
            {
                fields: ['isActive']
            }
        ]
    });

    Event.associate = function (models) {
        // Event belongs to a User (creator)
        Event.belongsTo(models.User, {
            foreignKey: 'createdBy',
            as: 'creator'
        });

        // Event has many Photos
        Event.hasMany(models.Photo, {
            foreignKey: 'eventId',
            as: 'photos',
            onDelete: 'CASCADE'
        });
    };

    return Event;
};
