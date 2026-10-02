'use strict';

const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');

const execute = promisify(execFile);
const MAX_VIDEO_BYTES = 500 * 1024 * 1024;
const MAX_DURATION_MS = 120000;

async function run(binary, args) {
    return execute(binary, args, { timeout: 15 * 60 * 1000, maxBuffer: 8 * 1024 * 1024 });
}

async function probe(filePath) {
    const { stdout } = await run('ffprobe', ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', filePath]);
    return JSON.parse(stdout);
}

function validateVideoMetadata(metadata, fileSize) {
    const video = metadata.streams?.find(stream => stream.codec_type === 'video');
    const seconds = Number(metadata.format?.duration);
    if (!Number.isSafeInteger(fileSize) || fileSize <= 0 || fileSize > MAX_VIDEO_BYTES) {
        throw new Error('Video excede o limite de 500 MiB ou possui tamanho invalido');
    }
    if (!video || !['h264', 'hevc'].includes(video.codec_name)) {
        throw new Error('Video deve usar H.264 ou HEVC');
    }
    if (!metadata.format?.format_name?.split(',').includes('mov')) {
        throw new Error('Conteiner de video deve ser MOV ou MP4');
    }
    if (!Number.isFinite(seconds) || seconds <= 0 || seconds * 1000 > MAX_DURATION_MS) {
        throw new Error('Video deve ter duracao de ate 120 segundos');
    }
    if (!Number.isInteger(video.width) || !Number.isInteger(video.height) || video.width < 2 || video.height < 2 || video.width > 4096 || video.height > 4096) {
        throw new Error('Resolucao de video invalida ou superior a 4K');
    }
    const rotation = Number(video.side_data_list?.find(data => data.rotation !== undefined)?.rotation ?? video.tags?.rotate ?? 0);
    if (!Number.isFinite(rotation) || rotation % 90 !== 0) throw new Error('Rotacao de video invalida');
    const verticalRotation = Math.abs(rotation % 180) === 90;
    return {
        durationMs: Math.round(seconds * 1000),
        fileSize,
        codec: video.codec_name,
        width: verticalRotation ? video.height : video.width,
        height: verticalRotation ? video.width : video.height,
        rotation,
        hdr: ['arib-std-b67', 'smpte2084'].includes(video.color_transfer),
        colorTransfer: video.color_transfer ?? null,
        hasAudio: metadata.streams.some(stream => stream.codec_type === 'audio')
    };
}

function sampleTimestamps(durationMs, sampleRate = 1) {
    if (!Number.isInteger(durationMs) || durationMs <= 0 || durationMs > MAX_DURATION_MS) {
        throw new Error('Duracao de amostragem invalida');
    }
    if (![0.5, 1, 2].includes(sampleRate)) throw new Error('Amostragem deve ser 0.5, 1 ou 2 FPS');
    return Array.from({ length: Math.ceil(durationMs * sampleRate / 1000) }, (_, index) => index * 1000 / sampleRate);
}

function imageFilter(metadata, maxDimension) {
    const scale = `scale=w='min(${maxDimension},iw)':h='min(${maxDimension},ih)':force_original_aspect_ratio=decrease:force_divisible_by=2`;
    const color = metadata.hdr
        ? 'zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=limited,format=yuv420p'
        : 'format=yuv420p';
    return `${scale},${color}`;
}

async function inspectVideo(filePath) {
    const absolutePath = path.resolve(filePath);
    if (!['.mov', '.mp4'].includes(path.extname(absolutePath).toLowerCase())) {
        throw new Error('Extensao de video deve ser MOV ou MP4');
    }
    const stat = await fs.stat(absolutePath);
    if (!stat.isFile() || stat.size > MAX_VIDEO_BYTES) throw new Error('Arquivo invalido ou maior que 500 MiB');
    return validateVideoMetadata(await probe(absolutePath), stat.size);
}

async function prepareVideo(filePath, { sampleRate = 1 } = {}) {
    const input = path.resolve(filePath);
    const metadata = await inspectVideo(input);
    const timestamps = sampleTimestamps(metadata.durationMs, sampleRate);
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'snapli-video-validation-'));
    const frameDirectory = path.join(directory, 'frames');
    await fs.mkdir(frameDirectory);
    const previewPath = path.join(directory, 'preview.mp4');
    const posterPath = path.join(directory, 'poster.jpg');
    const startedAt = Date.now();

    try {
        await run('ffmpeg', [
            '-hide_banner', '-loglevel', 'error', '-nostdin', '-threads', '2', '-i', input,
            '-map', '0:v:0', '-an', '-sn', '-dn',
            '-vf', `fps=fps=${sampleRate}:start_time=0:round=up,${imageFilter(metadata, 1920)}`,
            '-q:v', '2', '-start_number', '0', '-threads', '2', path.join(frameDirectory, 'frame-%06d.jpg')
        ]);

        const frameFiles = (await fs.readdir(frameDirectory)).filter(name => /^frame-\d{6}\.jpg$/.test(name)).sort();
        if (frameFiles.length !== timestamps.length) {
            throw new Error(`Amostragem incompleta: ${frameFiles.length} frames, esperado ${timestamps.length}`);
        }

        await run('ffmpeg', [
            '-hide_banner', '-loglevel', 'error', '-nostdin', '-threads', '2', '-i', input,
            '-map', '0:v:0', '-map', '0:a:0?', '-sn', '-dn', '-map_metadata', '-1',
            '-vf', `${imageFilter(metadata, 1280)},drawtext=text=SNAPLI:fontcolor=white@0.35:fontsize=48:x=(w-tw)/2:y=(h-th)/2:box=1:boxcolor=black@0.15:boxborderw=12`,
            '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '25', '-pix_fmt', 'yuv420p', '-threads', '2',
            '-r', '30', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', '-color_range', 'tv',
            '-c:a', 'aac', '-b:a', '96k', '-movflags', '+faststart', '-metadata:s:v:0', 'rotate=0', previewPath
        ]);

        await run('ffmpeg', [
            '-hide_banner', '-loglevel', 'error', '-nostdin', '-ss', String(metadata.durationMs / 2000),
            '-i', previewPath, '-map', '0:v:0', '-frames:v', '1', '-q:v', '2', posterPath
        ]);

        return {
            directory,
            input,
            metadata,
            sampleRate,
            processingMs: Date.now() - startedAt,
            previewPath,
            posterPath,
            frames: frameFiles.map((name, index) => ({ filePath: path.join(frameDirectory, name), timestampMs: timestamps[index] }))
        };
    } catch (error) {
        await fs.rm(directory, { recursive: true, force: true });
        throw error;
    }
}

module.exports = { inspectVideo, prepareVideo, probe, validateVideoMetadata, sampleTimestamps, imageFilter, MAX_VIDEO_BYTES, MAX_DURATION_MS };