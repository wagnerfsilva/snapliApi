'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { createReadStream } = require('node:fs');
const { createHash, randomUUID } = require('node:crypto');
const path = require('node:path');
const sharp = require('sharp');
const { prepareVideo, probe } = require('../../src/services/video-processing.service');

async function checksum(filePath) {
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(filePath)) hash.update(chunk);
    return hash.digest('hex');
}

async function main() {
    if (process.argv[2] === '--rekognition') {
        if (!process.argv[3]) throw new Error('Informe o report.json de uma validacao local concluida');
        return validateRekognition(process.argv[3]);
    }
    const input = process.argv[2];
    if (!input) throw new Error('Uso: node scripts/test/validate-video.js /caminho/arquivo.MOV');
    const originalHash = await checksum(input);
    console.log('Preparing full video locally; no AWS, database or payments are used.');
    const result = await prepareVideo(input);
    const preview = await probe(result.previewPath);
    const video = preview.streams.find(stream => stream.codec_type === 'video');
    assert.equal(video.codec_name, 'h264');
    assert.equal(video.pix_fmt, 'yuv420p');
    assert.equal(video.color_transfer, 'bt709');
    assert.equal(video.color_primaries, 'bt709');
    assert.ok(Math.max(video.width, video.height) <= 1280);
    assert.ok(Math.abs(Number(preview.format.duration) * 1000 - result.metadata.durationMs) < 500);
    assert.equal(video.width > video.height, result.metadata.width > result.metadata.height);
    assert.equal(Number(video.side_data_list?.find(data => data.rotation !== undefined)?.rotation ?? 0), 0);
    assert.equal(preview.streams.some(stream => stream.codec_type === 'audio'), result.metadata.hasAudio);
    if (result.metadata.hasAudio) assert.equal(preview.streams.find(stream => stream.codec_type === 'audio').codec_name, 'aac');
    const frames = [];
    for (const frame of result.frames) {
        const image = await sharp(frame.filePath).metadata();
        const stat = await fs.stat(frame.filePath);
        assert.equal(image.format, 'jpeg');
        assert.ok(Math.max(image.width, image.height) <= 1920);
        assert.equal(image.width > image.height, result.metadata.width > result.metadata.height);
        assert.ok(stat.size > 0 && stat.size < 5 * 1024 * 1024);
        assert.ok(frame.timestampMs < result.metadata.durationMs);
        const stats = await sharp(frame.filePath).stats();
        frames.push({ timestampMs: frame.timestampMs, bytes: stat.size, width: image.width, height: image.height, channelMeans: stats.channels.map(channel => channel.mean) });
    }
    const poster = await sharp(result.posterPath).metadata();
    assert.equal(poster.format, 'jpeg');
    assert.equal(await checksum(input), originalHash);
    const report = {
        source: path.basename(input),
        metadata: result.metadata,
        originalSha256: originalHash,
        originalUnchanged: true,
        sampleRate: result.sampleRate,
        frameCount: frames.length,
        processingSeconds: result.processingMs / 1000,
        preview: { filePath: result.previewPath, bytes: (await fs.stat(result.previewPath)).size, duration: Number(preview.format.duration), width: video.width, height: video.height, codec: video.codec_name, colorTransfer: video.color_transfer },
        posterPath: result.posterPath,
        frames,
        passed: ['source limits', 'full-duration frame sampling', 'JPEG dimensions and size', 'HDR to SDR conversion metadata', 'portrait orientation', 'H264 preview', 'audio preservation', 'preview duration', 'original SHA256 unchanged'],
        notValidated: ['AWS upload', 'Rekognition detection and matching', 'real PostgreSQL migration', 'customer-facing search and cart', 'PIX payment', 'authorized original download'],
        warning: 'Local media validation only; the end-to-end video feature is not implemented.'
    };
    const reportPath = path.join(result.directory, 'report.json');
    await fs.writeFile(reportPath, JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ ...report, frames: { count: frames.length, first: frames[0], last: frames.at(-1) }, reportPath }, null, 2));
}

async function validateRekognition(reportPath) {
    require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
    const { RekognitionClient, CreateCollectionCommand, IndexFacesCommand, SearchFacesByImageCommand, DeleteCollectionCommand } = require('@aws-sdk/client-rekognition');
    const localReport = JSON.parse(await fs.readFile(reportPath, 'utf8'));
    if (!localReport.originalUnchanged || localReport.sampleRate !== 1 || !localReport.frames?.length || localReport.frames.length > 120) {
        throw new Error('Teste AWS exige relatorio local valido com ate 120 frames a 1 FPS');
    }
    const collectionId = `snapli-video-validation-${Date.now()}-${randomUUID().slice(0, 8)}`;
    const region = process.env.AWS_REGION || 'us-east-1';
    const client = new RekognitionClient({ region });
    const directory = path.dirname(path.resolve(reportPath));
    const output = path.join(directory, 'rekognition-report.json');
    const previous = await fs.readFile(output, 'utf8').then(JSON.parse).catch(error => {
        if (error.code === 'ENOENT') return null;
        throw error;
    });
    if (previous?.collectionId && !previous.collectionDeleted) {
        throw new Error(`Limpeza AWS pendente para ${previous.collectionId}; nao sera criada outra colecao`);
    }
    const report = {
        region, collectionId, source: localReport.source, framesProcessed: 0,
        indexCalls: 0, searchCalls: 0, indexedFaces: 0, framesWithFaces: 0,
        frames: [], collectionDeleted: false, status: 'starting',
        limitation: 'Positive control is cropped from the indexed video, not an independent selfie. No accuracy or recall guarantee.'
    };
    let created = false;
    let cleanupDenied = false;
    let candidate = null;
    await fs.writeFile(output, JSON.stringify(report, null, 2));
    console.log(`AWS test in isolated collection ${collectionId}; never using production collection.`);
    try {
        await client.send(new CreateCollectionCommand({ CollectionId: collectionId }));
        created = true;
        try {
            await client.send(new DeleteCollectionCommand({ CollectionId: collectionId }));
        } catch (error) {
            if (error.name === 'AccessDeniedException') {
                cleanupDenied = true;
                report.cleanupError = error.message;
            }
            throw error;
        }
        created = false;
        await client.send(new CreateCollectionCommand({ CollectionId: collectionId }));
        created = true;
        for (let index = 0; index < localReport.frames.length; index++) {
            const filePath = path.join(directory, 'frames', `frame-${String(index).padStart(6, '0')}.jpg`);
            const bytes = await fs.readFile(filePath);
            if (bytes.length > 5 * 1024 * 1024) throw new Error('Frame excede limite Rekognition');
            report.indexCalls++;
            const result = await client.send(new IndexFacesCommand({
                CollectionId: collectionId,
                Image: { Bytes: bytes },
                ExternalImageId: `validation-frame-${index}`,
                MaxFaces: 100,
                QualityFilter: 'AUTO',
                DetectionAttributes: ['DEFAULT']
            }));
            const faces = result.FaceRecords ?? [];
            report.framesProcessed++;
            report.indexedFaces += faces.length;
            if (faces.length) report.framesWithFaces++;
            report.frames.push({ timestampMs: localReport.frames[index].timestampMs, faceCount: faces.length, unindexedCount: result.UnindexedFaces?.length ?? 0 });
            for (const record of faces) {
                const box = record.Face?.BoundingBox;
                if (!box) continue;
                const score = (record.FaceDetail?.Quality?.Sharpness ?? 0) * box.Width * box.Height;
                if (!candidate || score > candidate.score) {
                    candidate = { filePath, faceId: record.Face.FaceId, box, score, timestampMs: localReport.frames[index].timestampMs };
                }
            }
            if ((index + 1) % 15 === 0) console.log(`Indexed ${index + 1}/${localReport.frames.length} frames; ${report.indexedFaces} faces so far.`);
        }
        if (!candidate) throw new Error('Nenhum rosto indexavel encontrado neste video');
        const dimensions = await sharp(candidate.filePath).metadata();
        const left = Math.max(0, Math.floor(candidate.box.Left * dimensions.width));
        const top = Math.max(0, Math.floor(candidate.box.Top * dimensions.height));
        const width = Math.min(dimensions.width - left, Math.ceil(candidate.box.Width * dimensions.width));
        const height = Math.min(dimensions.height - top, Math.ceil(candidate.box.Height * dimensions.height));
        const control = await sharp(candidate.filePath).extract({ left, top, width, height }).resize({ width: 512, height: 512, fit: 'inside' }).jpeg().toBuffer();
        report.searchCalls++;
        const matches = await client.send(new SearchFacesByImageCommand({
            CollectionId: collectionId, Image: { Bytes: control }, FaceMatchThreshold: 92, MaxFaces: 4096
        }));
        const expectedMatch = matches.FaceMatches?.find(match => match.Face?.FaceId === candidate.faceId);
        assert.ok(expectedMatch, 'Rosto de controle nao encontrou seu registro indexado');
        report.positiveControl = {
            sourceTimestampMs: candidate.timestampMs,
            similarity: expectedMatch.Similarity,
            faceMatches: matches.FaceMatches.length,
            distinctVideoResults: new Set(matches.FaceMatches.map(() => localReport.source)).size
        };
        assert.equal(report.positiveControl.distinctVideoResults, 1);

        const blank = await sharp({ create: { width: 640, height: 640, channels: 3, background: { r: 128, g: 128, b: 128 } } }).jpeg().toBuffer();
        report.searchCalls++;
        try {
            const negative = await client.send(new SearchFacesByImageCommand({ CollectionId: collectionId, Image: { Bytes: blank }, FaceMatchThreshold: 92 }));
            assert.equal(negative.FaceMatches?.length ?? 0, 0);
            report.negativeControl = { noFaceMatched: true };
        } catch (error) {
            if (error.name !== 'InvalidParameterException') throw error;
            report.negativeControl = { noFaceMatched: true, errorName: error.name };
        }
        report.status = 'passed';
        report.recognitionPassed = true;
    } catch (error) {
        report.status = cleanupDenied ? 'cleanup_failed' : 'failed';
        report.error = error.message;
        throw error;
    } finally {
        if (created && !cleanupDenied) {
            try {
                await client.send(new DeleteCollectionCommand({ CollectionId: collectionId }));
                report.collectionDeleted = true;
            } catch (error) {
                report.status = 'cleanup_failed';
                report.cleanupError = error.message;
                console.error(`Collection cleanup failed: ${collectionId}. Manual cleanup required.`);
                process.exitCode = 1;
            }
        }
        report.indicativeImageCostUsd = (report.indexCalls + report.searchCalls) * 0.001;
        report.costNote = 'Estimate only; pricing not verified live. Excludes temporary face storage, retries and taxes.';
        await fs.writeFile(output, JSON.stringify(report, null, 2));
        console.log(JSON.stringify({ ...report, frames: { count: report.frames.length }, reportPath: output }, null, 2));
        client.destroy();
    }
}

if (require.main === module) {
    main().catch(error => {
        console.error(error.message);
        process.exitCode = 1;
    });
}

module.exports = { checksum, validateRekognition };