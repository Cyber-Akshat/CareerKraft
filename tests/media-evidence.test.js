const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createMediaEvidenceProcessor, runProcess } = require('../media-evidence');

const ffmpegPath = require('ffmpeg-static');
const ffprobePath = require('ffprobe-static').path;
const VISUAL = 'The image shows a chart with January and February sales, labeled axes, and a visible summary.';
const SPEECH = 'This presentation compares January and February sales and explains the differences.';

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'careerkraft-media-'));
  t.after(async () => {
    const relative = path.relative(os.tmpdir(), root);
    assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative));
    await fs.rm(root, { recursive: true, force: true });
  });
  const processingDirectory = path.join(root, 'processing');
  return { root, processingDirectory };
}

function mockedRunner({ probe, failFrame = 0, failAudio = false, failValidation = false } = {}) {
  const calls = [];
  let frameCount = 0;
  const runner = async (executable, args, options) => {
    calls.push({ executable, args, options });
    if (executable === 'probe') return { stdout: JSON.stringify(probe), stderr: '' };
    if (args.includes('null')) {
      if (failValidation) throw new Error('Corrupt video frame.');
      return { stdout: '', stderr: '' };
    }
    const output = args.at(-1);
    if (output.endsWith('.mp3') && failAudio) throw new Error('Unreadable audio.');
    if (/frame-\d+\.png$/.test(output)) {
      frameCount += 1;
      await fs.writeFile(output, 'partial frame');
      if (frameCount === failFrame) throw new Error('Corrupt frame.');
    } else {
      await fs.writeFile(output, 'decoded media');
    }
    return { stdout: '', stderr: '' };
  };
  return { runner, calls };
}

const videoProbe = (audio = true, duration = 6) => ({
  format: { duration: String(duration) },
  streams: [{ codec_type: 'video', codec_name: 'h264', width: 320, height: 240 },
    ...(audio ? [{ codec_type: 'audio', codec_name: 'aac' }] : [])]
});

test('runProcess never invokes a shell and preserves metacharacters as one argument', async () => {
  const value = 'a; & echo nope $(whoami) `test`';
  const result = await runProcess(process.execPath, ['-e', 'process.stdout.write(process.argv[1])', value]);
  assert.equal(result.stdout, value);
  assert.equal(result.stderr, '');
});

test('runProcess kills timeouts and bounds combined diagnostic output', async () => {
  await assert.rejects(runProcess(process.execPath, ['-e', 'setTimeout(() => {}, 10000)'], { timeoutMs: 40 }), /timed out/);
  await assert.rejects(runProcess(process.execPath, ['-e', 'process.stdout.write("x".repeat(5000))'], { maxOutputBytes: 1024 }), /too much/);
  await assert.rejects(runProcess(process.execPath, ['-e', 'process.stderr.write("bad input");process.exit(2)']), /bad input/);
});

test('image is decoded before vision, and its original filename never reaches a process', async t => {
  const { root, processingDirectory } = await fixture(t);
  const original = path.join(root, 'private-upload');
  await fs.writeFile(original, 'original bytes');
  const { runner, calls } = mockedRunner({ probe: { streams: [{ codec_type: 'video', width: 80, height: 60 }] } });
  let seenImages;
  const processor = createMediaEvidenceProcessor({ processingDirectory, ffmpegPath: 'ffmpeg', ffprobePath: 'probe',
    runProcess: runner, analyseImagesWithLumia: async images => {
      seenImages = images;
      assert.equal(await fs.readFile(images[0].path, 'utf8'), 'decoded media');
      return VISUAL;
    } });
  const result = await processor({ path: original, fileName: 'design;$(secret).png', fileType: 'image', mimeType: 'image/png' });
  assert.equal(result.autoReviewable, true);
  assert.equal(result.metadata.visionAnalysed, true);
  assert.equal(result.metadata.width, 80);
  assert.equal(result.text, VISUAL);
  assert.equal(seenImages.length, 1);
  for (const call of calls) {
    assert.ok(call.args.includes('file,pipe'));
    assert.ok(!call.args.some(arg => arg.includes('design;') || arg === original));
    assert.ok(call.options.timeoutMs > 0);
  }
  assert.equal(await fs.readFile(original, 'utf8'), 'original bytes');
  assert.deepEqual(await fs.readdir(processingDirectory), []);
});

test('audio-only WebM is transcribed without inventing video observations', async t => {
  const { processingDirectory } = await fixture(t);
  const { runner, calls } = mockedRunner({ probe: { format: { duration: '12.5' }, streams: [{ codec_type: 'audio', codec_name: 'opus' }] } });
  const processor = createMediaEvidenceProcessor({ processingDirectory, ffmpegPath: 'ffmpeg', ffprobePath: 'probe', runProcess: runner,
    analyseImagesWithLumia: async () => assert.fail('Audio-only WebM must not request vision.'),
    transcribeAudioWithLumia: async (audioPath, name, mime) => {
      assert.equal(name, 'audio.mp3');
      assert.equal(mime, 'audio/mpeg');
      assert.equal(await fs.readFile(audioPath, 'utf8'), 'decoded media');
      return SPEECH;
    } });
  const result = await processor({ buffer: Buffer.from('private original'), fileName: 'recording.webm' });
  assert.equal(result.type, 'audio');
  assert.equal(result.autoReviewable, true);
  assert.equal(result.metadata.transcription, true);
  assert.equal(result.metadata.durationSeconds, 12.5);
  assert.match(result.text, /^AUDIO TRANSCRIPT\n\n/);
  assert.equal(calls.length, 2);
  assert.deepEqual(await fs.readdir(processingDirectory), []);
});

test('video combines actual audio and three explicitly timestamped visual samples', async t => {
  const { processingDirectory } = await fixture(t);
  const { runner, calls } = mockedRunner({ probe: videoProbe() });
  const processor = createMediaEvidenceProcessor({ processingDirectory, ffmpegPath: 'ffmpeg', ffprobePath: 'probe', runProcess: runner,
    transcribeAudioWithLumia: async () => SPEECH,
    analyseImagesWithLumia: async (images, context) => {
      assert.equal(images.length, 3);
      assert.match(context, /0.6, 3, 5.4 seconds/);
      return VISUAL;
    } });
  const result = await processor({ buffer: Buffer.from('private original'), fileName: 'demo.mp4' });
  assert.equal(result.autoReviewable, true);
  assert.equal(result.metadata.audioPresent, true);
  assert.equal(result.metadata.transcriptAvailable, true);
  assert.equal(result.metadata.visualAnalysisAvailable, true);
  assert.deepEqual(result.metadata.sampledFrameTimestamps, [0.6, 3, 5.4]);
  assert.match(result.text, /not every frame/);
  assert.match(result.text, /VIDEO AUDIO TRANSCRIPT/);
  assert.ok(calls.some(call => call.args.includes('null')), 'The whole video stream must decode successfully.');
  assert.deepEqual(await fs.readdir(processingDirectory), []);
});

test('silent video with no audio track needs only visual evidence and short clips use two frames', async t => {
  const { processingDirectory } = await fixture(t);
  const { runner } = mockedRunner({ probe: videoProbe(false, 2) });
  const processor = createMediaEvidenceProcessor({ processingDirectory, ffmpegPath: 'ffmpeg', ffprobePath: 'probe', runProcess: runner,
    transcribeAudioWithLumia: async () => assert.fail('No audio track exists.'),
    analyseImagesWithLumia: async images => { assert.equal(images.length, 2); return VISUAL; } });
  const result = await processor({ buffer: Buffer.from('private original'), fileName: 'silent.mov' });
  assert.equal(result.autoReviewable, true);
  assert.equal(result.metadata.audioPresent, false);
  assert.equal(result.metadata.sampledFrames, 2);
  assert.equal(result.metadata.transcriptAvailable, false);
});

test('video ignores attached cover art and maps the exact probed audio and video stream indices', async t => {
  const { processingDirectory } = await fixture(t);
  const probe = { format: { duration: '6' }, streams: [
    { index: 0, codec_type: 'video', codec_name: 'mjpeg', width: 10000, height: 10000, disposition: { attached_pic: 1 } },
    { index: 3, codec_type: 'video', codec_name: 'h264', width: 320, height: 240, disposition: { attached_pic: 0 } },
    { index: 7, codec_type: 'audio', codec_name: 'aac' }
  ] };
  const { runner, calls } = mockedRunner({ probe });
  const processor = createMediaEvidenceProcessor({ processingDirectory, ffmpegPath: 'ffmpeg', ffprobePath: 'probe', runProcess: runner,
    transcribeAudioWithLumia: async () => SPEECH, analyseImagesWithLumia: async () => VISUAL });
  const result = await processor({ buffer: Buffer.from('private original'), fileName: 'demo.mp4' });
  assert.equal(result.autoReviewable, true);
  assert.equal(result.metadata.width, 320);
  for (const call of calls.filter(call => call.executable === 'ffmpeg')) {
    const selected = call.args[call.args.indexOf('-map') + 1];
    assert.equal(selected, call.args.at(-1).endsWith('.mp3') ? '0:7' : '0:3');
  }
});

test('ambiguous tracks and unexpected video in audio uploads remain human review', async t => {
  for (const [fileName, probe] of [
    ['demo.mp4', { ...videoProbe(), streams: [...videoProbe().streams, { codec_type: 'video', width: 320, height: 240 }] }],
    ['demo.mp4', { ...videoProbe(), streams: [...videoProbe().streams, { codec_type: 'audio' }] }],
    ['speech.m4a', videoProbe()]
  ]) {
    const { processingDirectory } = await fixture(t);
    const { runner } = mockedRunner({ probe });
    const processor = createMediaEvidenceProcessor({ processingDirectory, ffmpegPath: 'ffmpeg', ffprobePath: 'probe', runProcess: runner,
      analyseImagesWithLumia: async () => assert.fail('Ambiguous tracks cannot reach Groq.'),
      transcribeAudioWithLumia: async () => assert.fail('Ambiguous tracks cannot reach Groq.') });
    const result = await processor({ buffer: Buffer.from('private original'), fileName });
    assert.equal(result.autoReviewable, false);
    assert.equal(result.metadata.processingFailed, true);
    assert.deepEqual(await fs.readdir(processingDirectory), []);
  }
});

test('audio may contain attached cover art without submitting that artwork as video', async t => {
  const { processingDirectory } = await fixture(t);
  const { runner, calls } = mockedRunner({ probe: { format: { duration: '5' }, streams: [
    { index: 0, codec_type: 'video', codec_name: 'mjpeg', disposition: { attached_pic: 1 } },
    { index: 1, codec_type: 'audio', codec_name: 'aac' }
  ] } });
  const processor = createMediaEvidenceProcessor({ processingDirectory, ffmpegPath: 'ffmpeg', ffprobePath: 'probe', runProcess: runner,
    transcribeAudioWithLumia: async () => SPEECH,
    analyseImagesWithLumia: async () => assert.fail('Album art must not become visual evidence.') });
  const result = await processor({ buffer: Buffer.from('private original'), fileName: 'speech.m4a' });
  assert.equal(result.autoReviewable, true);
  assert.equal(result.type, 'audio');
  const audioCall = calls.find(call => call.executable === 'ffmpeg');
  assert.equal(audioCall.args[audioCall.args.indexOf('-map') + 1], '0:1');
});

test('APNG and animated WebP are rejected even when the probe would omit frame counts', async t => {
  const png = Buffer.alloc(28);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(png);
  png.writeUInt32BE(8, 8);
  png.write('acTL', 12, 'ascii');
  png.writeUInt32BE(2, 16);
  const webp = Buffer.alloc(30);
  webp.write('RIFF', 0, 'ascii');
  webp.writeUInt32LE(22, 4);
  webp.write('WEBPVP8X', 8, 'ascii');
  webp.writeUInt32LE(10, 16);
  webp[20] = 0x02;
  for (const [fileName, buffer] of [['animation.png', png], ['animation.webp', webp]]) {
    const { processingDirectory } = await fixture(t);
    const processor = createMediaEvidenceProcessor({ processingDirectory, ffmpegPath: 'ffmpeg', ffprobePath: 'probe',
      runProcess: async () => assert.fail('Animated images should be detected before native processing.'),
      analyseImagesWithLumia: async () => assert.fail('A still sample must not stand in for an animation.') });
    const result = await processor({ buffer, fileName });
    assert.equal(result.autoReviewable, false);
    assert.equal(result.metadata.visionAnalysed, false);
    assert.deepEqual(await fs.readdir(processingDirectory), []);
  }
});

test('processing failures, unreadable speech and truncated results never auto-approve', async t => {
  for (const scenario of ['frame', 'audio', 'validation', 'vision', 'empty audio', 'truncated']) {
    await t.test(scenario, async t => {
      const { processingDirectory } = await fixture(t);
      const { runner } = mockedRunner({ probe: videoProbe(), failFrame: scenario === 'frame' ? 2 : 0,
        failAudio: scenario === 'audio', failValidation: scenario === 'validation' });
      const processor = createMediaEvidenceProcessor({ processingDirectory, ffmpegPath: 'ffmpeg', ffprobePath: 'probe', runProcess: runner,
        transcribeAudioWithLumia: async () => scenario === 'empty audio' ? '' : SPEECH,
        analyseImagesWithLumia: async () => {
          if (scenario === 'vision') throw new Error('Provider is unavailable.');
          return scenario === 'truncated' ? 'x'.repeat(25000) : VISUAL;
        } });
      const result = await processor({ buffer: Buffer.from('private original'), fileName: 'demo.mp4' });
      assert.equal(result.autoReviewable, false);
      assert.ok(result.text.length <= 20000);
      assert.deepEqual(await fs.readdir(processingDirectory), []);
    });
  }
});

test('oversized dimensions and excessive or unknown durations stop before provider calls', async t => {
  for (const probe of [videoProbe(false, 601), videoProbe(false, 0),
    { streams: [{ codec_type: 'video', width: 10000, height: 10000 }] },
    { streams: [{ codec_type: 'video', width: 100, height: 100, nb_frames: '12' }] }]) {
    const { processingDirectory } = await fixture(t);
    const { runner } = mockedRunner({ probe });
    const processor = createMediaEvidenceProcessor({ processingDirectory, ffmpegPath: 'ffmpeg', ffprobePath: 'probe', runProcess: runner,
      analyseImagesWithLumia: async () => assert.fail('Unsafe media cannot reach Groq.'),
      transcribeAudioWithLumia: async () => assert.fail('Unsafe media cannot reach Groq.') });
    const result = await processor({ buffer: Buffer.from('private original'), fileName: probe.format ? 'demo.mp4' : 'image.webp' });
    assert.equal(result.autoReviewable, false);
    assert.deepEqual(await fs.readdir(processingDirectory), []);
  }
});

test('real FFmpeg processes all supported media containers and rejects corrupt media', async t => {
  const { root, processingDirectory } = await fixture(t);
  const image = path.join(root, 'source.png');
  const audio = path.join(root, 'source.mp3');
  const video = path.join(root, 'source.mp4');
  await runProcess(ffmpegPath, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=blue:s=80x60', '-frames:v', '1', '-threads', '1', image]);
  await runProcess(ffmpegPath, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=0.3', '-threads', '1', audio]);
  await runProcess(ffmpegPath, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=blue:s=80x60:r=5:d=1',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-threads', '1', video]);
  const sources = [[image, 'design.png', 'image'], [audio, 'speech.mp3', 'audio'], [video, 'demo.mp4', 'video']];
  for (const extension of ['jpg', 'webp']) {
    const output = path.join(root, `source.${extension}`);
    await runProcess(ffmpegPath, ['-v', 'error', '-y', '-i', image, '-frames:v', '1', '-threads', '1', output]);
    sources.push([output, `design.${extension}`, 'image']);
  }
  for (const [extension, codec] of [['wav', 'pcm_s16le'], ['m4a', 'aac'], ['ogg', 'libvorbis'], ['webm', 'libopus']]) {
    const output = path.join(root, `speech.${extension}`);
    await runProcess(ffmpegPath, ['-v', 'error', '-y', '-i', audio, '-c:a', codec, '-threads', '1', output]);
    sources.push([output, `speech.${extension}`, 'audio']);
  }
  for (const [extension, videoCodec, audioCodec] of [['mov', 'libx264', 'aac'], ['webm', 'libvpx', 'libopus']]) {
    const output = path.join(root, `demo.${extension}`);
    await runProcess(ffmpegPath, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=blue:s=80x60:r=5:d=0.6',
      '-f', 'lavfi', '-i', 'sine=frequency=440:duration=0.6', '-c:v', videoCodec, '-c:a', audioCodec,
      '-pix_fmt', 'yuv420p', '-threads', '1', '-shortest', output]);
    sources.push([output, `demo.${extension}`, 'video']);
  }
  const providerCalls = [];
  const processor = createMediaEvidenceProcessor({ processingDirectory, ffmpegPath, ffprobePath,
    analyseImagesWithLumia: async images => {
      for (const image of images) {
        const data = await fs.readFile(image.path);
        assert.deepEqual([...data.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
      }
      providerCalls.push('vision');
      return VISUAL;
    }, transcribeAudioWithLumia: async audioPath => {
      assert.ok((await fs.stat(audioPath)).size > 100);
      providerCalls.push('audio');
      return SPEECH;
    } });
  for (const [sourcePath, fileName, expected] of sources) {
    const original = await fs.readFile(sourcePath);
    const result = await processor({ path: sourcePath, fileName });
    assert.equal(result.type, expected);
    assert.equal(result.autoReviewable, true, JSON.stringify(result));
    if (fileName === 'demo.mov' || fileName === 'demo.webm') {
      assert.equal(result.metadata.audioPresent, true);
      assert.equal(result.metadata.transcriptAvailable, true);
      assert.equal(result.metadata.visualAnalysisAvailable, true);
    }
    if (fileName === 'speech.webm') {
      assert.equal(result.metadata.transcription, true);
      assert.equal(result.metadata.visualAnalysisAvailable, false);
    }
    assert.deepEqual(await fs.readFile(sourcePath), original);
    assert.deepEqual(await fs.readdir(processingDirectory), []);
  }
  const count = providerCalls.length;
  const damaged = await processor({ buffer: Buffer.from('not an image'), fileName: 'broken.png' });
  assert.equal(damaged.autoReviewable, false);
  assert.equal(damaged.metadata.processingFailed, true);
  assert.equal(providerCalls.length, count);
  assert.deepEqual(await fs.readdir(processingDirectory), []);
});
