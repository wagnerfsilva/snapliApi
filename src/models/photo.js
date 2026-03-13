'use strict';

module.exports = (sequelize, DataTypes) => {
    const Photo = sequelize.define('Photo', {
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
        originalFilename: {
            type: DataTypes.STRING,
            allowNull: false
        },
        originalKey: {
            type: DataTypes.STRING,
            allowNull: false,
            comment: 'S3 key for original image in Bucket A'
        },
        watermarkedKey: {
            type: DataTypes.STRING,
            allowNull: false,
            comment: 'S3 key for watermarked image in Bucket B'
        },
        thumbnailKey: {
            type: DataTypes.STRING,
            allowNull: true,
            comment: 'S3 key for thumbnail in Bucket B'
        },
        width: {
            type: DataTypes.INTEGER,
            allowNull: true
        },
        height: {
            type: DataTypes.INTEGER,
            allowNull: true
        },
        fileSize: {
            type: DataTypes.INTEGER,
            allowNull: true,
            comment: 'File size in bytes'
        },
        mimeType: {
            type: DataTypes.STRING,
            allowNull: true
        },
        faceData: {
            type: DataTypes.JSONB,
            allowNull: true,
            comment: 'Face detection data including embeddings from Rekognition'
        },
        faceCount: {
            type: DataTypes.INTEGER,
            defaultValue: 0
        },
        rekognitionFaceId: {
            type: DataTypes.STRING,
            allowNull: true,
            comment: 'AWS Rekognition Face ID for searching'
        },
        metadata: {
            type: DataTypes.JSONB,
            allowNull: true,
            comment: 'Additional EXIF and custom metadata'
        },
        processingStatus: {
            type: DataTypes.ENUM('pending', 'processing', 'completed', 'failed'),
            defaultValue: 'pending'
        },
        processingError: {
            type: DataTypes.TEXT,
            allowNull: true
        },
        uploadedBy: {
            type: DataTypes.UUID,
            allowNull: false,
            references: {
                model: 'users',
                key: 'id'
            }
        }
    }, {
        tableName: 'photos',
        timestamps: true,
        indexes: [
            {
                fields: ['eventId']
            },
            {
                fields: ['processingStatus']
            },
            {
                fields: ['rekognitionFaceId']
            },
            {
                using: 'gin',
                fields: ['faceData']
            }
        ]
    });

    Photo.associate = function (models) {
        // Photo belongs to an Event
        Photo.belongsTo(models.Event, {
            foreignKey: 'eventId',
            as: 'event'
        });

        // Photo uploaded by User
        Photo.belongsTo(models.User, {
            foreignKey: 'uploadedBy',
            as: 'uploader'
        });

        // Photo can be in multiple OrderItems
        Photo.belongsToMany(models.Order, {
            through: models.OrderItem,
            foreignKey: 'photoId',
            as: 'orders'
        });
    };

    return Photo;
};
