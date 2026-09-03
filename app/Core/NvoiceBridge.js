/**
 * @Author      发光的神 (VoxShadow)
 * @Version     1.1.0 Beta
 * @Since       2026-08-01
 * @LastUpdated 2026-09-01
 * @Description Nvoice 语音识别桥接模块（NvoiceBridge）
 * @License     MIT
 */

const { ipcMain } = require('electron');
const path = require('path');
const NVOICE_PATH = path.join(__dirname, '..', 'Plugins', 'Nvoice');

let currentSender = null;
let inputStream = null;
let recognizer = null;
let stream = null;
let resampler = null;
let display = null;
let cpal = null;
let lastText = '';
let segmentIndex = 0;
let isRunning = false;

function initNvoiceBridge(windows) {
  ipcMain.on('nvoice-start', (event) => {
    if (isRunning) return;
    try {
      cpal = require(path.join(NVOICE_PATH, 'node_modules', 'node-cpal'));
      const sherpa_onnx = require(path.join(NVOICE_PATH, 'node_modules', 'sherpa-onnx-node'));

      currentSender = event.sender;
      const devices = cpal.getDevices();
      const inputDevices = [];
      for (const d of devices) {
        try {
          const cfg = cpal.getDefaultInputConfig(d.deviceId);
          inputDevices.push({ device: d, config: cfg });
        } catch (e) { }
      }
      if (inputDevices.length === 0) {
        event.sender.send('nvoice-error', '未找到输入设备');
        return;
      }
      const def = cpal.getDefaultInputDevice();
      const match = inputDevices.find(({ device }) => device.deviceId === def.deviceId);
      const { device, config } = match || inputDevices[0];

      const recConfig = {
        featConfig: { sampleRate: 16000, featureDim: 80 },
        modelConfig: {
          paraformer: {
            encoder: path.join(NVOICE_PATH, 'model', 'encoder.int8.onnx'),
            decoder: path.join(NVOICE_PATH, 'model', 'decoder.int8.onnx'),
          },
          tokens: path.join(NVOICE_PATH, 'model', 'tokens.txt'),
          numThreads: 0,
          provider: 'cpu',
          debug: 0,
        },
        decodingMethod: 'greedy_search',
        maxActivePaths: 4,
        enableEndpoint: true,
        rule1MinTrailingSilence: 2.4,
        rule2MinTrailingSilence: 1.2,
        rule3MinUtteranceLength: 20,
      };
      recognizer = new sherpa_onnx.OnlineRecognizer(recConfig);
      stream = recognizer.createStream();

      const nativeSampleRate = config.sampleRate;
      const nativeChannels = config.channels;
      const nativeFormat = config.sampleFormat;
      const targetSampleRate = recognizer.config.featConfig.sampleRate;

      resampler = new sherpa_onnx.LinearResampler(nativeSampleRate, targetSampleRate);
      display = new sherpa_onnx.Display(50);
      lastText = '';
      segmentIndex = 0;
      isRunning = true;

      inputStream = cpal.createStream(
        device.deviceId,
        true,
        { sampleRate: nativeSampleRate, channels: nativeChannels, format: nativeFormat },
        (data) => {
          try {
            const mono = toMono(data, nativeChannels);
            const resampled = resampler.resample(mono);
            stream.acceptWaveform({ sampleRate: targetSampleRate, samples: resampled });

            while (recognizer.isReady(stream)) {
              recognizer.decode(stream);
            }

            const isEndpoint = recognizer.isEndpoint(stream);
            let text = recognizer.getResult(stream).text;

            if (isEndpoint) {
              const tailPadding = new Float32Array(targetSampleRate * 0.4);
              stream.acceptWaveform({ samples: tailPadding, sampleRate: targetSampleRate });
              while (recognizer.isReady(stream)) {
                recognizer.decode(stream);
              }
              text = recognizer.getResult(stream).text;
              if (text.length > 0) {
                segmentIndex += 1;
                display.print(segmentIndex, text);
                if (currentSender && !currentSender.isDestroyed()) {
                  currentSender.send('nvoice-send', text);
                }
              }
              recognizer.reset(stream);
              lastText = '';
            } else if (text.length > 0 && lastText !== text) {
              lastText = text;
              if (currentSender && !currentSender.isDestroyed()) {
                currentSender.send('nvoice-text', text);
              }
            }
          } catch (e) {
            console.error('[NvoiceBridge] audio callback error:', e);
            if (currentSender && !currentSender.isDestroyed()) {
              currentSender.send('nvoice-error', '识别异常: ' + (e.message || String(e)));
            }
          }
        });

      event.sender.send('nvoice-started');
    } catch (e) {
      isRunning = false;
      console.error('[NvoiceBridge] start failed:', e);
      if (event.sender && !event.sender.isDestroyed()) {
        event.sender.send('nvoice-error', e.message || String(e));
      }
    }
  });

  ipcMain.on('nvoice-stop', () => {
    stopNvoice();
  });
}

function toMono(data, numChannels) {
  if (numChannels === 1) return data;
  const len = Math.floor(data.length / numChannels);
  const mono = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    let sum = 0;
    for (let ch = 0; ch < numChannels; ch++) {
      sum += data[i * numChannels + ch];
    }
    mono[i] = sum / numChannels;
  }
  return mono;
}

function stopNvoice() {
  if (inputStream) { try { cpal.closeStream(inputStream); } catch (_) { } inputStream = null; }
  if (stream) { try { stream.close(); } catch (_) { } stream = null; }
  if (recognizer) { try { recognizer.close(); } catch (_) { } recognizer = null; }
  resampler = null;
  display = null;
  cpal = null;
  currentSender = null;
  isRunning = false;
  lastText = '';
  segmentIndex = 0;
}

module.exports = { initNvoiceBridge };