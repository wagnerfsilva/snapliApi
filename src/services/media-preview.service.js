'use strict';

const s3Service = require('./s3.service');

async function previewUrls(media, { includeVideoPreview = false } = {}) {
    if (media.mediaType === 'video') {
        const thumbnailUrl = media.thumbnailKey ? await s3Service.generatePresignedUrl(media.thumbnailKey, 'watermarked', 3600) : null;
        return {
            mediaType: 'video', durationMs: media.durationMs,
            thumbnailUrl, watermarkedUrl: thumbnailUrl,
            ...(includeVideoPreview ? { previewUrl: media.previewKey ? await s3Service.generatePresignedUrl(media.previewKey, 'watermarked', 3600) : null } : {})
        };
    }
    const watermarkedUrl = media.watermarkedKey ? await s3Service.generatePresignedUrl(media.watermarkedKey, 'watermarked', 3600) : null;
    return { mediaType: 'photo', watermarkedUrl, thumbnailUrl: watermarkedUrl, previewUrl: watermarkedUrl };
}

module.exports = { previewUrls };