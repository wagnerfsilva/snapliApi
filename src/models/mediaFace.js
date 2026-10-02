'use strict';

module.exports = (sequelize, DataTypes) => {
    const MediaFace = sequelize.define('MediaFace', {
        faceId: { type: DataTypes.STRING, primaryKey: true },
        collectionId: { type: DataTypes.STRING, allowNull: false },
        photoId: {
            type: DataTypes.UUID,
            allowNull: false,
            references: { model: 'photos', key: 'id' }
        },
        timestampMs: { type: DataTypes.INTEGER, allowNull: false, validate: { min: 0 } },
        processingVersion: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1, validate: { min: 1 } },
        confidence: { type: DataTypes.FLOAT, allowNull: true },
        boundingBox: { type: DataTypes.JSONB, allowNull: true }
    }, {
        tableName: 'media_faces',
        timestamps: false,
        indexes: [{ fields: ['photoId', 'processingVersion'] }, { fields: ['collectionId'] }]
    });
    MediaFace.associate = models => {
        MediaFace.belongsTo(models.Photo, { foreignKey: 'photoId', as: 'media', onDelete: 'CASCADE' });
    };
    return MediaFace;
};