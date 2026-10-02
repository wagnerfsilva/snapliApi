'use strict';

const {
    CreateMultipartUploadCommand, UploadPartCommand, CompleteMultipartUploadCommand,
    AbortMultipartUploadCommand, HeadObjectCommand
} = require('@aws-sdk/client-s3');
const { s3Client, buckets } = require('../config/aws');
const { MAX_VIDEO_BYTES } = require('./video-processing.service');

const PART_SIZE = 8 * 1024 * 1024;

function validateUpload({ filename, fileSize, mimeType }) {
    if (typeof filename !== 'string' || filename.length > 255 || /[\r\n/\\]/.test(filename) || !/\.(mov|mp4)$/i.test(filename)) {
        throw new Error('Nome de video invalido; envie MOV ou MP4');
    }
    if (!Number.isSafeInteger(fileSize) || fileSize < 1 || fileSize > MAX_VIDEO_BYTES) {
        throw new Error('Video deve ter ate 500 MiB');
    }
    if (!['video/mp4', 'video/quicktime', 'application/octet-stream', ''].includes(mimeType ?? '')) {
        throw new Error('Formato de video invalido');
    }
    return /\.mov$/i.test(filename) ? 'video/quicktime' : 'video/mp4';
}

function validateParts(parts, fileSize) {
    const count = Math.ceil(fileSize / PART_SIZE);
    if (!Array.isArray(parts) || parts.length !== count) throw new Error('Upload incompleto');
    const sorted = [...parts].sort((first, second) => first.PartNumber - second.PartNumber);
    for (let index = 0; index < count; index++) {
        if (sorted[index]?.PartNumber !== index + 1 || typeof sorted[index]?.ETag !== 'string' || !sorted[index].ETag || sorted[index].ETag.length > 200) {
            throw new Error('Partes de upload invalidas');
        }
    }
    return sorted.map(({ PartNumber, ETag }) => ({ PartNumber, ETag }));
}

function client() {
    if (!s3Client || !buckets.original) throw new Error('S3 nao configurado');
    return s3Client;
}

async function start(key, mimeType) {
    const result = await client().send(new CreateMultipartUploadCommand({
        Bucket: buckets.original, Key: key, ContentType: mimeType, ServerSideEncryption: 'AES256'
    }));
    if (!result.UploadId) throw new Error('S3 nao retornou identificador de upload');
    return result.UploadId;
}

async function part(photo, partNumber, buffer) {
    const count = Math.ceil(photo.fileSize / PART_SIZE);
    if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > count) throw new Error('Numero de parte invalido');
    const expectedSize = partNumber === count ? photo.fileSize - PART_SIZE * (count - 1) : PART_SIZE;
    if (!Buffer.isBuffer(buffer) || buffer.length !== expectedSize) throw new Error('Tamanho de parte invalido');
    const result = await client().send(new UploadPartCommand({
        Bucket: buckets.original, Key: photo.originalKey, UploadId: photo.uploadId,
        PartNumber: partNumber, Body: buffer, ContentLength: buffer.length
    }));
    return { PartNumber: partNumber, ETag: result.ETag };
}

async function finish(photo, parts) {
    const sorted = validateParts(parts, photo.fileSize);
    try {
        await client().send(new CompleteMultipartUploadCommand({
            Bucket: buckets.original, Key: photo.originalKey, UploadId: photo.uploadId,
            MultipartUpload: { Parts: sorted }
        }));
    } catch (error) {
        if (error.name !== 'NoSuchUpload') throw error;
    }
    const head = await client().send(new HeadObjectCommand({ Bucket: buckets.original, Key: photo.originalKey }));
    if (head.ContentLength !== photo.fileSize) throw new Error('Tamanho do original nao corresponde ao upload');
}

async function cancel(photo) {
    try {
        await client().send(new AbortMultipartUploadCommand({
            Bucket: buckets.original, Key: photo.originalKey, UploadId: photo.uploadId
        }));
    } catch (error) {
        if (error.name !== 'NoSuchUpload') throw error;
    }
}

module.exports = { PART_SIZE, validateUpload, validateParts, start, part, finish, cancel };