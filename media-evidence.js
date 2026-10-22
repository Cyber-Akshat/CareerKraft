const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_TEXT_LENGTH = 20000;
const MAX_DURATION_SECONDS = 600;
const MAX_IMAGE_DIMENSION = 8192;
const MAX_IMAGE_PIXELS = 16000000;
const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp']);
const AUDIO_EXTENSIONS = new Set(['.mp3', '.wav', '.m4a', '.ogg']);
const VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.webm']);
const INPUT_FORMATS = {
  '.jpg': 'jpeg_pipe', '.jpeg': 'jpeg_pipe', '.png': 'png_pipe', '.webp': 'webp_pipe',
  '.mp3': 'mp3', '.wav': 'wav', '.m4a': 'mov', '.ogg': 'ogg',
  '.mp4': 'mov', '.mov': 'mov', '.webm': 'matroska'
};

// Keep the total number of media jobs bounded, including jobs waiting on Groq.
let activeJobs = 0;
const waitingJobs = [];
async function withMediaSlot(task) {
  if (activeJobs >= 2) {
    if (waitingJobs.length >= 8) throw new Error('Media processing is busy.');
    await new Promise(resolve => waitingJobs.push(resolve));
  } else {
    activeJobs += 1;
  }
  try {
    return await task();
  } finally {
    const next = waitingJobs.shift();
    if (next) next();
    else activeJobs -= 1;
  }
}

function runProcess(executable, args, { timeoutMs = 20000, maxOutputBytes = 262144, cwd } = {}) {
  return new Promise((resolve, reject) => {
    if (typeof executable !== 'string' || !executable || !Array.isArray(args) || args.some(arg => typeof arg !== 'string')) {
      reject(new Error('Invalid media processing command.'));
      return;
    }
    let child;
    try {
      child = spawn(executable, args, {
        shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], ...(cwd ? { cwd } : {})
      });
    } catch (error) {
      reject(error);
      return;
    }
    let stdout = '';
    let stderr = '';
    let outputBytes = 0;
    let failure = null;
    let settled = false;
    const fail = error => {
      if (!failure) failure = error;
      child.kill('SIGKILL');
    };
    const timer = setTimeout(() => fail(new Error('Media processing timed out.')), Math.max(1, timeoutMs));
    const collect = (chunk, isError) => {
      outputBytes += chunk.length;
      if (outputBytes > maxOutputBytes) {
        fail(new Error('Media processing produced too much diagnostic output.'));
        return;
      }
      if (isError) stderr += chunk.toString('utf8');
      else stdout += chunk.toString('utf8');
    };
    child.stdout.on('data', chunk => collect(chunk, false));
    child.stderr.on('data', chunk => collect(chunk, true));
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(result);
    };
    child.on('error', error => finish(failure || error));
    child.on('close', code => finish(failure || (code === 0 ? null : new Error(
      stderr.slice(-2000) || `Media process exited with ${code}.`
    )), { stdout, stderr }));
  });
}

function boundedText(value) {
  const text = typeof value === 'string'
    ? value.replace(/\u0000/g, '').replace(/\r\n?/g, '\n').replace(/\n{4,}/g, '\n\n\n').trim()
    : '';
  return { text: text.slice(0, MAX_TEXT_LENGTH), truncated: text.length > MAX_TEXT_LENGTH };
}

function safeDuration(probe, stream) {
  const duration = Number(probe.format?.duration ?? stream?.duration);
  if (!Number.isFinite(duration) || duration <= 0 || duration > MAX_DURATION_SECONDS) {
    throw new Error('Media duration is unavailable or exceeds the ten-minute processing limit.');
  }
  return duration;
}

function checkDimensions(stream) {
  const width = Number(stream?.width);
  const height = Number(stream?.height);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0 ||
      width > MAX_IMAGE_DIMENSION || height > MAX_IMAGE_DIMENSION || width * height > MAX_IMAGE_PIXELS) {
    throw new Error('Media dimensions exceed the processing limit.');
  }
  return { width, height };
}

function isAnimatedImage(buffer, extension) {
  if (extension === '.png' && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    for (let offset = 8; offset + 12 <= buffer.length;) {
      const length = buffer.readUInt32BE(offset);
      const next = offset + length + 12;
      if (next > buffer.length) break;
      if (buffer.toString('ascii', offset + 4, offset + 8) === 'acTL') return true;
      offset = next;
    }
  }
  if (extension === '.webp' && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') {
    for (let offset = 12; offset + 8 <= buffer.length;) {
      const length = buffer.readUInt32LE(offset + 4);
      const name = buffer.toString('ascii', offset, offset + 4);
      const next = offset + length + 8 + (length % 2);
      if (next > buffer.length) break;
      if (name === 'ANIM' || name === 'ANMF' || (name === 'VP8X' && length > 0 && (buffer[offset + 8] & 0x02))) return true;
      offset = next;
    }
  }
  return false;
}

function createMediaEvidenceProcessor(options = {}) {
  const processingDirectory = path.resolve(options.processingDirectory || path.join(__dirname, 'data', 'evidence-processing'));
  const execute = options.runProcess || runProcess;
  const ffmpegPath = options.ffmpegPath || require('ffmpeg-static');
  const ffprobePath = options.ffprobePath || require('ffprobe-static').path;
  const analyseImages = options.analyseImagesWithLumia || ((...args) => require('./media-groq').analyseImagesWithLumia(...args));
  const transcribeAudio = options.transcribeAudioWithLumia || ((...args) => require('./media-groq').transcribeAudioWithLumia(...args));

  const inputArgs = (extension, inputPath) => [
    '-protocol_whitelist', 'file,pipe', '-f', INPUT_FORMATS[extension], '-i', inputPath
  ];
  const ffmpegArgs = ['-hide_banner', '-nostdin', '-nostats', '-v', 'error', '-xerror', '-y', '-threads', '1'];
  async function assertOutput(outputPath) {
    const stat = await fs.stat(outputPath);
    if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_FILE_BYTES) throw new Error('Media processing output is empty or too large.');
  }
  async function probeFile(extension, inputPath) {
    const result = await execute(ffprobePath, [
      '-v', 'error', '-protocol_whitelist', 'file,pipe', '-f', INPUT_FORMATS[extension],
      '-show_entries', 'format=duration,format_name:stream=index,codec_type,codec_name,width,height,duration,nb_frames:stream_disposition=attached_pic',
      '-of', 'json', inputPath
    ], { timeoutMs: 15000 });
    const probe = JSON.parse(result.stdout);
    if (!Array.isArray(probe.streams) || !probe.streams.length) throw new Error('No readable media streams were found.');
    return probe;
  }
  async function makeAudio(extension, inputPath, scratchDirectory, streamIndex) {
    const outputPath = path.join(scratchDirectory, 'audio.mp3');
    await execute(ffmpegPath, [...ffmpegArgs, ...inputArgs(extension, inputPath),
      '-map', `0:${streamIndex}`, '-vn', '-ac', '1', '-ar', '16000', '-b:a', '64k', '-t', String(MAX_DURATION_SECONDS + 1),
      '-threads', '1', '-f', 'mp3', outputPath
    ], { timeoutMs: 45000 });
    await assertOutput(outputPath);
    return outputPath;
  }
  async function makeFrame(extension, inputPath, outputPath, streamIndex, timestamp = null) {
    await execute(ffmpegPath, [...ffmpegArgs,
      ...(timestamp === null ? [] : ['-ss', timestamp.toFixed(3)]),
      ...inputArgs(extension, inputPath), '-map', `0:${streamIndex}`, '-frames:v', '1', '-an',
      '-vf', 'scale=1280:1280:force_original_aspect_ratio=decrease', '-threads', '1', outputPath
    ], { timeoutMs: 20000 });
    await assertOutput(outputPath);
  }

  async function processFile(uploadedFile, type, extension, metadata) {
    let scratchDirectory;
    try {
      await fs.mkdir(processingDirectory, { recursive: true, mode: 0o700 });
      scratchDirectory = await fs.mkdtemp(path.join(processingDirectory, 'media-'));
      let buffer = uploadedFile.buffer;
      if (!Buffer.isBuffer(buffer)) {
        const stat = await fs.lstat(uploadedFile.path);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size <= 0 || stat.size > MAX_FILE_BYTES) {
          throw new Error('Invalid media upload.');
        }
        buffer = await fs.readFile(uploadedFile.path);
      }
      if (!buffer.length || buffer.length > MAX_FILE_BYTES) throw new Error('Invalid media upload size.');
      if (isAnimatedImage(buffer, extension)) throw new Error('Animated images require human review.');
      // Only generated, fixed filenames reach native processes; originals remain private and untouched.
      const inputPath = path.join(scratchDirectory, `source${extension}`);
      await fs.writeFile(inputPath, buffer, { flag: 'wx', mode: 0o600 });
      const probe = await probeFile(extension, inputPath);
      const videos = probe.streams.filter(stream => stream.codec_type === 'video' && !stream.disposition?.attached_pic);
      const audios = probe.streams.filter(stream => stream.codec_type === 'audio');
      if (videos.length > 1 || audios.length > 1) throw new Error('Multiple media tracks require human review.');
      const video = videos[0];
      const audio = audios[0];
      const streamIndex = stream => Number.isInteger(stream?.index) && stream.index >= 0 ? stream.index : probe.streams.indexOf(stream);

      if (IMAGE_EXTENSIONS.has(extension)) {
        if (!video || audio) throw new Error('The image does not contain a readable still image.');
        const dimensions = checkDimensions(video);
        if (Number(video.nb_frames) > 1) throw new Error('Animated images require human review.');
        const imagePath = path.join(scratchDirectory, 'image.png');
        await makeFrame(extension, inputPath, imagePath, streamIndex(video));
        const description = boundedText(await analyseImages([{ path: imagePath, mimeType: 'image/png' }],
          'one uploaded still image; describe only visible evidence, not whether it meets assessment criteria'));
        Object.assign(metadata, dimensions, { visionAnalysed: Boolean(description.text), truncated: description.truncated });
        return { type: 'image', text: description.text, autoReviewable: description.text.length >= 20 && !description.truncated, metadata };
      }

      // WebM can contain audio without any video stream. Probe the container before choosing a pipeline.
      if (AUDIO_EXTENSIONS.has(extension) || (extension === '.webm' && !video && audio)) {
        type = 'audio';
        if (!audio || video) throw new Error('The audio file has missing audio or an unexpected video track.');
        metadata.durationSeconds = safeDuration(probe, audio);
        const audioPath = await makeAudio(extension, inputPath, scratchDirectory, streamIndex(audio));
        const transcript = boundedText(await transcribeAudio(audioPath, 'audio.mp3', 'audio/mpeg'));
        const combined = boundedText(transcript.text ? `AUDIO TRANSCRIPT\n\n${transcript.text}` : '');
        Object.assign(metadata, { transcription: Boolean(transcript.text), transcriptAvailable: Boolean(transcript.text),
          truncated: transcript.truncated || combined.truncated });
        return { type, text: combined.text, autoReviewable: transcript.text.length >= 10 && !metadata.truncated, metadata };
      }

      if (!video) throw new Error('No video stream was found.');
      const dimensions = checkDimensions(video);
      const duration = safeDuration(probe, video);
      Object.assign(metadata, dimensions, { durationSeconds: duration, audioPresent: Boolean(audio) });
      // Decode the entire visual stream once so corruption between sampled frames cannot silently pass.
      await execute(ffmpegPath, [...ffmpegArgs, ...inputArgs(extension, inputPath), '-map', `0:${streamIndex(video)}`, '-an',
        '-t', String(MAX_DURATION_SECONDS + 1), '-threads', '1', '-f', 'null', '-'
      ], { timeoutMs: 45000 });
      let transcript = '';
      let transcriptFailed = false;
      if (audio) {
        try {
          const audioPath = await makeAudio(extension, inputPath, scratchDirectory, streamIndex(audio));
          const transcription = boundedText(await transcribeAudio(audioPath, 'video-audio.mp3', 'audio/mpeg'));
          transcript = transcription.text;
          metadata.truncated ||= transcription.truncated;
          // Silence can legitimately produce an empty transcript; an API/extraction failure is different.
        } catch {
          transcriptFailed = true;
        }
      }
      const percentages = duration < 4 ? [0.1, 0.5] : [0.1, 0.5, 0.9];
      const frames = [];
      for (let index = 0; index < percentages.length; index += 1) {
        const timestamp = duration * percentages[index];
        const framePath = path.join(scratchDirectory, `frame-${index + 1}.png`);
        await makeFrame(extension, inputPath, framePath, streamIndex(video), timestamp);
        frames.push({ path: framePath, mimeType: 'image/png' });
      }
      metadata.sampledFrames = frames.length;
      metadata.sampledFrameTimestamps = percentages.map(value => Number((duration * value).toFixed(3)));
      const observation = boundedText(await analyseImages(frames,
        `sampled video frames in chronological order at ${metadata.sampledFrameTimestamps.join(', ')} seconds; ` +
        'these samples do not show every frame or prove that events occurred elsewhere in the video'));
      metadata.truncated ||= observation.truncated;
      Object.assign(metadata, { transcriptAvailable: Boolean(transcript), visualAnalysisAvailable: Boolean(observation.text),
        processingFailed: transcriptFailed });
      const sections = [];
      if (transcript) sections.push(`VIDEO AUDIO TRANSCRIPT\n\n${transcript}`);
      if (observation.text) sections.push('VIDEO VISUAL SAMPLE\n\n' +
        `Observations cover ${frames.length} sampled frames at ${metadata.sampledFrameTimestamps.join(', ')} seconds, not every frame.\n\n` + observation.text);
      const text = boundedText(sections.join('\n\n'));
      metadata.truncated ||= text.truncated;
      return { type: 'video', text: text.text,
        autoReviewable: observation.text.length >= 20 && (!audio || transcript.length >= 10) && !transcriptFailed && !metadata.truncated, metadata };
    } catch {
      metadata.processingFailed = true;
      return { type, text: '', autoReviewable: false, metadata };
    } finally {
      if (scratchDirectory) {
        const relative = path.relative(processingDirectory, path.resolve(scratchDirectory));
        if (relative && !relative.startsWith('..') && !path.isAbsolute(relative)) {
          await fs.rm(scratchDirectory, { recursive: true, force: true }).catch(() => {});
        }
      }
    }
  }

  return async function processMediaEvidence(uploadedFile = {}) {
    const extension = path.extname(uploadedFile.fileName || uploadedFile.originalname || '').toLowerCase();
    const type = IMAGE_EXTENSIONS.has(extension) ? 'image' : AUDIO_EXTENSIONS.has(extension) ? 'audio' : 'video';
    const metadata = { ...(uploadedFile.metadata || {}), originalName: uploadedFile.fileName || uploadedFile.originalname || '',
      extension, visionAnalysed: false, transcriptAvailable: false, visualAnalysisAvailable: false, sampledFrames: 0,
      truncated: false, processingFailed: false };
    if (!IMAGE_EXTENSIONS.has(extension) && !AUDIO_EXTENSIONS.has(extension) && !VIDEO_EXTENSIONS.has(extension)) {
      return { type: uploadedFile.fileType || 'unsupported', text: '', autoReviewable: false, metadata };
    }
    try {
      return await withMediaSlot(() => processFile(uploadedFile, type, extension, metadata));
    } catch {
      return { type, text: '', autoReviewable: false, metadata: { ...metadata, processingFailed: true } };
    }
  };
}

module.exports = { createMediaEvidenceProcessor, runProcess };
