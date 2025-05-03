<script setup>
import {
  onMounted, onBeforeUnmount, ref, watch, reactive, computed,
  inject,
} from 'vue';
import {
  useResizeObserver, useBattery, useWindowFocus, useFullscreen, useMemory, useDevicesList,
} from '@vueuse/core';
import { useI18n } from 'vue-i18n';
import { fftSizes } from '../dict';
import { semitoneFromPitch, frequencyFromSemitone } from '../util';
import RomanNote from './RomanNote.vue';
import Semitone from './Semitone';

const { audioInputs: microphones } = useDevicesList();

function size(v) {
  const kb = v / 1024 / 1024;
  return `${kb.toFixed(2)} MB`;
}
const { isSupported: isMemorySupported, memory: memoryInfo } = useMemory();
const usedMemory = computed(() => {
  if (!isMemorySupported.value) return null;

  const used = memoryInfo?.value?.usedJSHeapSize;
  if (used) {
    return size(used);
  }

  return null;
});

const focused = useWindowFocus();

const { t } = useI18n({});

const battery = useBattery();
const batteryPercent = computed(() => Math.round(battery.level.value * 100));
const batteryFormat = new Intl.DurationFormat(undefined, { style: 'narrow' });
const batteryTime = computed(() => {
  const duration = {};
  let s = (battery.charging.value ? battery.chargingTime : battery.dischargingTime).value || 0;
  duration.seconds = Math.round(s % 60);
  s /= 60;
  duration.minutes = Math.round(s % 60);
  s /= 60;
  duration.hours = Math.round(s % 24);
  s /= 24;
  duration.days = Math.round(s % 30);

  return batteryFormat.format(duration);
});

function isSharp(note) {
  const noteIndex = note % 12;
  if (noteIndex === 1) return true;
  if (noteIndex === 3) return true;
  if (noteIndex === 6) return true;
  if (noteIndex === 8) return true;
  if (noteIndex === 10) return true;
  return false;
}

const audio = reactive({
  context: new AudioContext(),
  tail: null,
  semitoneFrom: 36,
  semitoneTo: 84,
});
audio.maxFreq = computed(() => (audio.context ? audio.context.sampleRate / 2 : 0));
audio.maxSemitone = computed(() => semitoneFromPitch(audio.maxFreq));
audio.semitonesCount = computed(() => audio.semitoneTo - audio.semitoneFrom);
audio.semitonesTotal = computed(() => audio.maxSemitone + 1);

watch(() => audio.maxSemitone, (v, old) => {
  if (old === v) return;
  if (audio.semitoneTo !== 0 || audio.semitoneTo === v) return;

  audio.semitoneTo = v;
}, { immediate: true });

let pianoOscillator = null;
let pianoOscillatorConnected = false;

const oscillators = [];

const source = reactive({
  echo: false,
  stream: null,
  tracks: [],
  source: null,
  analyser: null,
  type: null,
});

let canvasCtx = null;
let animationId = null;
const visual = reactive({
  drawerKey: null,
  prev: () => {},
  next: () => {},
  needsRoman: true,
});

function initCanvas(cnv, wrap) {
  const ctx = cnv.getContext('2d');

  const intendedWidth = wrap.clientWidth;
  cnv.setAttribute('width', intendedWidth);

  const intendedHeight = wrap.clientHeight;
  cnv.setAttribute('height', intendedHeight);

  ctx.clearRect(0, 0, cnv.width, cnv.height);

  return ctx;
}

const canvasWrap = ref();
const { toggle, isFullscreen } = useFullscreen(canvasWrap);
const canvas = ref();

const canvasWrapOriginal = ref();
const canvasOriginal = ref();
let originalCtx = null;

const canvasWrapAcf2p = ref();
const canvasAcf2p = ref();
let acf2pCtx = null;

// Implements the ACF2+ algorithm
function acf2p() {
  if (!originalCtx) {
    originalCtx = initCanvas(canvasOriginal.value, canvasWrapOriginal.value);
  }
  if (!acf2pCtx) {
    acf2pCtx = initCanvas(canvasAcf2p.value, canvasWrapAcf2p.value);
  }

  const bufferLength = source.analyser.frequencyBinCount;
  let buf = new Float32Array(bufferLength);

  source.analyser.getFloatTimeDomainData(buf);

  let SIZE = buf.length;

  // root mean square
  let rms = 0;
  for (let i = 0; i < SIZE; i += 1) {
    const val = buf[i];
    rms += val * val;
  }
  rms = Math.sqrt(rms / SIZE);
  // not enough signal
  if (rms < 0.01) {
    originalCtx.fillStyle = 'rgb(0, 0, 0)';
    originalCtx.fillRect(0, 0, canvasOriginal.value.width, canvasOriginal.value.height);

    originalCtx.fillStyle = 'white';
    originalCtx.font = '30px serif';
    originalCtx.fillText(
      `RMS: ${rms}`,
      10,
      30,
    );
    return -1;
  }

  // slice low borders
  let r1 = 0;
  let r2 = SIZE - 1;
  const thres = 0.2;
  for (let i = 0; i < SIZE / 2; i += 1) {
    if (Math.abs(buf[i]) < thres) {
      r1 = i;
      break;
    }
  }
  for (let i = 1; i < SIZE / 2; i += 1) {
    if (Math.abs(buf[SIZE - i]) < thres) {
      r2 = SIZE - i;
      break;
    }
  }

  // render sin
  originalCtx.fillStyle = 'rgb(0, 0, 0)';
  originalCtx.fillRect(0, 0, canvasOriginal.value.width, canvasOriginal.value.height);

  originalCtx.lineWidth = 2;
  originalCtx.strokeStyle = 'rgb(256, 256, 256)';

  originalCtx.beginPath();

  const sliceWidth = (canvasOriginal.value.width * 1.0) / SIZE;
  let x = 0;

  let bufAbsMax = 0;
  for (let i = 0; i < SIZE; i += 1) {
    const abs = Math.abs(buf[i]);
    if (abs > bufAbsMax) {
      bufAbsMax = buf[i];
    }
  }
  const sinRatio = canvasOriginal.value.height / bufAbsMax / 2;
  const halfHeight = canvasOriginal.value.height / 2;

  for (let i = 0; i < SIZE; i += 1) {
    const y = buf[i] * sinRatio + halfHeight;

    if (i === 0) {
      originalCtx.moveTo(x, y);
    } else {
      originalCtx.lineTo(x, y);
    }

    x += sliceWidth;
  }

  originalCtx.lineTo(canvasOriginal.value.width, 0);
  originalCtx.stroke();

  const itemOffset = canvasOriginal.value.width / bufferLength;
  originalCtx.fillStyle = 'red';
  originalCtx.fillRect(
    r1 * itemOffset,
    0,
    itemOffset,
    canvasOriginal.value.height,
  );
  originalCtx.fillRect(
    r2 * itemOffset,
    0,
    itemOffset,
    canvasOriginal.value.height,
  );

  originalCtx.fillStyle = 'white';
  originalCtx.font = '30px serif';
  originalCtx.fillText(
    `RMS: ${rms}`,
    10,
    30,
  );
  originalCtx.fillText(
    `x${sinRatio}`,
    10,
    60,
  );
  // end render sin

  buf = buf.slice(r1, r2);
  SIZE = buf.length;

  // smooth values
  const c = new Array(SIZE).fill(0);
  for (let i = 0; i < SIZE; i += 1) {
    for (let j = 0; j < SIZE - i; j += 1) {
      c[i] += buf[j] * buf[j + i];
    }
  }

  let d = 0;
  while (c[d] > c[d + 1]) {
    d += 1;
  }

  let maxval = -1;
  let maxpos = -1;
  for (let i = d; i < SIZE; i += 1) {
    if (c[i] > maxval) {
      maxval = c[i];
      maxpos = i;
    }
  }

  acf2pCtx.fillStyle = 'rgb(0, 0, 0)';
  acf2pCtx.fillRect(0, 0, canvasAcf2p.value.width, canvasAcf2p.value.height);

  const barWidth = canvasAcf2p.value.width / SIZE;
  const visibleBarWidth = barWidth - 1;
  x = barWidth;
  for (let i = 0; i < SIZE; i += 1) {
    const barHeight = (canvasAcf2p.value.height * c[i]) / c[0];

    acf2pCtx.fillStyle = `rgb(${barHeight + 200},${i + 180},203)`;
    acf2pCtx.fillRect(
      x,
      canvasAcf2p.value.height - barHeight,
      visibleBarWidth,
      barHeight,
    );

    x += barWidth;
  }

  acf2pCtx.fillStyle = 'white';
  acf2pCtx.fillRect(
    d * barWidth,
    0,
    barWidth,
    canvasAcf2p.value.height,
  );

  let T0 = maxpos;
  acf2pCtx.fillStyle = 'blue';
  acf2pCtx.fillRect(
    T0 * barWidth,
    0,
    barWidth,
    canvasAcf2p.value.height,
  );

  const x1 = c[T0 - 1];
  const x2 = c[T0];
  const x3 = c[T0 + 1];
  const a = (x1 + x3 - 2 * x2) / 2;
  if (a) {
    const b = (x3 - x1) / 2;
    T0 -= b / (2 * a);
    acf2pCtx.fillStyle = 'green';
    acf2pCtx.fillRect(
      T0 * barWidth,
      0,
      barWidth,
      canvasAcf2p.value.height,
    );
  }

  return audio.context.sampleRate / T0;
}

function stopStream(stream) {
  if (stream.getTracks) {
    stream.getTracks().forEach((track) => track.stop());
  }
}

function stopDrawing() {
  if (animationId) {
    cancelAnimationFrame(animationId);
    animationId = null;
  }
  visual.prev = visual.next;
  visual.next = () => {};
}

function resumeDrawing() {
  visual.next = visual.prev;
  if (!animationId) {
    visual.next();
  }
}

function enshureContext() {
  if (audio.context) {
    if (audio.context.state === 'suspended') {
      audio.context.resume();
    }
  }
}

const fps = ref(0);
const fpsEvery = ref(60);
const canvasEvery = ref(10);

if (typeof performance === 'undefined') {
  window.performance = {
    now() {
      return Date().valueOf();
    },
  };
}

let last = performance.now();
let ticks = 0;
let canvasTicks = 0;
const renders = 0;
function tick() {
  ticks += 1;
  canvasTicks += 1;
  if (ticks >= fpsEvery.value) {
    const now = performance.now();
    const diff = now - last;
    fps.value = Math.round(1000 / (diff / ticks));
    last = now;
    ticks = 0;

    return true;
  }

  return false;
}

function drawBars() {
  enshureContext();

  const bufferLength = source.analyser.frequencyBinCount;
  const dataArray = new Uint8Array(bufferLength);
  // const dataArray = new Float32Array(bufferLength);

  const currentSemitone = new Semitone(canvasCtx, t);

  const draw = () => {
    tick();
    animationId = requestAnimationFrame(visual.next);

    source.analyser.getByteFrequencyData(dataArray);
    // source.analyser.getFloatFrequencyData(dataArray);

    const currentPitch = acf2p();
    currentSemitone.setPitch(currentPitch);

    if (canvasTicks < canvasEvery.value) {
      return;
    }
    canvasTicks = 0;

    canvasCtx.fillStyle = 'rgb(0, 0, 0)';
    canvasCtx.fillRect(0, 0, canvas.value.width, canvas.value.height);

    const barWidth = canvas.value.width / bufferLength;
    const visibleBarWidth = barWidth - 1;
    let x = 0;

    for (let i = 0; i < bufferLength; i += 1) {
      const barHeight = (dataArray[i] * canvas.value.height) / 255;
      // const barHeight = (dataArray[i] - source.analyser.minDecibels) * 2;

      const pitch = (audio.maxFreq * i) / bufferLength;
      canvasCtx.fillStyle = pitch === currentPitch
        ? 'white' : `rgb(${barHeight + 200},${i + 180},203)`;
      canvasCtx.fillRect(
        x,
        canvas.value.height - barHeight,
        visibleBarWidth,
        barHeight,
      );

      x += barWidth;
    }

    currentSemitone.render();
  };

  visual.next = draw;
  draw();
}

function drawSin() {
  enshureContext();

  const bufferLength = source.analyser.fftSize;
  const dataArray = new Uint8Array(bufferLength);

  const currentSemitone = new Semitone(canvasCtx, t);

  const draw = () => {
    tick();
    animationId = requestAnimationFrame(visual.next);

    source.analyser.getByteTimeDomainData(dataArray);

    const currentPitch = acf2p();
    currentSemitone.setPitch(currentPitch);

    canvasCtx.fillStyle = 'rgb(0, 0, 0)';
    canvasCtx.fillRect(0, 0, canvas.value.width, canvas.value.height);

    canvasCtx.lineWidth = 2;
    canvasCtx.strokeStyle = 'rgb(256, 256, 256)';

    canvasCtx.beginPath();

    const sliceWidth = (canvas.value.width * 1.0) / bufferLength;
    let x = 0;

    for (let i = 0; i < bufferLength; i += 1) {
      const v = dataArray[i] / 128.0;
      const y = canvas.value.height - ((v * canvas.value.height) / 2);

      if (i === 0) {
        canvasCtx.moveTo(x, y);
      } else {
        canvasCtx.lineTo(x, y);
      }

      x += sliceWidth;
    }

    canvasCtx.lineTo(canvas.value.width, 0);
    canvasCtx.stroke();

    currentSemitone.render();
  };

  visual.next = draw;
  draw();
}

const piano = {
  whiteWidth: 0,
  whiteHeight: 0,
  heightOffset: 0,
  blackWidth: 0,
  blackHeight: 0,
  blackOffset: 0,
  blackEnd: 0,
};

function drawPiano() {
  enshureContext();

  const bufferLength = source.analyser.frequencyBinCount;
  const dataArray = new Uint8Array(bufferLength);

  const currentSemitone = new Semitone(canvasCtx, t);
  currentSemitone.setFillStyle('black');

  const draw = () => {
    tick();
    animationId = requestAnimationFrame(visual.next);

    source.analyser.getByteFrequencyData(dataArray);

    const currentPitch = acf2p();
    currentSemitone.setPitch(currentPitch);

    canvasCtx.fillStyle = 'rgb(100, 210, 240)';
    canvasCtx.fillRect(0, 0, canvas.value.width, canvas.value.height);

    piano.whiteWidth = (canvas.value.width * 12) / (audio.semitonesCount * 7);
    piano.whiteHeight = Math.min(canvas.value.height, piano.whiteWidth * 4);
    piano.heightOffset = canvas.value.height - piano.whiteHeight;

    piano.blackWidth = piano.whiteWidth / 1.5;
    piano.blackHeight = piano.whiteHeight * 0.7;
    piano.blackOffset = piano.whiteWidth / 2.5;
    piano.blackEnd = piano.heightOffset + piano.blackHeight;

    let sum = 0;
    let count = 0;
    let note = 0;
    let nextNote = audio.semitoneFrom;
    let widthOffset = 0;
    let i = Math.round((
      (Math.max(audio.semitoneFrom, 0)) * bufferLength
    ) / audio.semitonesTotal);
    let blackFill = null;
    let blackX = 0;
    const maxIndex = Math.round((
      (Math.min(audio.semitoneTo, audio.maxSemitone)) * bufferLength
    ) / audio.semitonesTotal);
    for (; i < maxIndex; i += 1) {
      sum += dataArray[i];
      count += 1;

      note = nextNote;
      nextNote = Math.round(((i + 1) * audio.semitonesTotal) / bufferLength);
      if (nextNote === note) continue;

      const v = sum / count;

      if (isSharp(note)) {
        blackFill = note === currentSemitone.semitone ? 'green' : `rgb(${v}, ${v}, ${v})`;
        blackX = widthOffset - piano.blackOffset;
      } else {
        canvasCtx.fillStyle = note === currentSemitone.semitone ? 'green' : `rgb(255, ${255 - v}, ${255 - v})`;
        canvasCtx.fillRect(
          widthOffset,
          piano.heightOffset,
          piano.whiteWidth - 2,
          piano.whiteHeight,
        );

        if (blackX) {
          canvasCtx.fillStyle = blackFill;
          canvasCtx.fillRect(
            blackX,
            piano.heightOffset,
            piano.blackWidth,
            piano.blackHeight,
          );
          blackX = 0;
        }

        widthOffset += piano.whiteWidth;
      }

      sum = 0;
      count = 0;
    }

    currentSemitone.render();
  };

  visual.next = draw;
  draw();
}

function bassSteps(n) {
  // TODO: formula
  switch (n) {
    case 1:
      return 1;
    case 2:
    case 3:
      return 2;
    case 4:
    case 5:
      return 3;
    case 6:
    case 7:
      return 4;
    case 8:
      return 5;
    case 9:
    case 10:
      return 6;
    case 11:
    case 12:
      return 7;
    case 13:
      return 8;
    case 14:
    case 15:
      return 9;
    case 16:
    case 17:
      return 10;
    case 18:
    case 19:
      return 11;
    case 20:
      return 12;
    default:
      return 0;
  }
}

function drawBass() {
  enshureContext();

  const maxTone = 60;
  const semitonesCount = 20;

  const clef = '𝄢';
  canvasCtx.font = '10px serif';
  const text = canvasCtx.measureText(clef);
  const clefRatio = text.actualBoundingBoxAscent === 8 ? 6 : 4.2;
  const clefOffset = text.actualBoundingBoxAscent - 8;

  const currentSemitone = new Semitone(canvasCtx, t);
  currentSemitone.setFillStyle('black');

  const draw = () => {
    tick();
    animationId = requestAnimationFrame(visual.next);

    const pitch = acf2p();
    currentSemitone.setPitch(pitch);

    const lineHeight = 3;
    const betweenHeight = canvas.value.height / 6;
    const step = betweenHeight / 2;
    const fontOffset = betweenHeight / 3;

    canvasCtx.fillStyle = 'white';
    canvasCtx.fillRect(0, 0, canvas.value.width, canvas.value.height);

    for (let offset = betweenHeight; offset < canvas.value.height; offset += betweenHeight) {
      canvasCtx.fillStyle = 'black';
      canvasCtx.fillRect(0, offset, canvas.value.width, lineHeight);
    }

    const clefFont = Math.floor((betweenHeight - lineHeight) * clefRatio);
    canvasCtx.font = `${clefFont}px serif`;
    canvasCtx.fillText(
      clef,
      lineHeight,
      (clefOffset * 6 + betweenHeight) * 2 + clefFont / 2 + fontOffset + lineHeight * 2,
    );

    if (!Number.isFinite(currentSemitone.semitone)) {
      return;
    }

    const n = maxTone - currentSemitone.semitone;
    if (n < 0 || n > semitonesCount) {
      return;
    }

    const sharp = isSharp(currentSemitone.semitone);
    const font = betweenHeight - lineHeight;
    const noteFont = font * 4;

    const steps = bassSteps(n);
    const pitchOffset = steps * step + lineHeight + fontOffset;
    if (sharp) {
      canvasCtx.font = `${font}px serif`;
      canvasCtx.fillText(
        '♯',
        canvas.value.width / 2,
        pitchOffset,
      );
    }
    canvasCtx.font = `${noteFont}px serif`;
    canvasCtx.fillText(
      '𝅝',
      canvas.value.width / 2 + font / 2,
      pitchOffset + clefOffset * 8,
    );

    currentSemitone.render();
  };

  visual.next = draw;
  draw();
}

function pause() {
  if (audio.context?.state !== 'suspened') {
    audio.context.suspend();
  }
}

function resume() {
  if (audio.context?.state !== 'running') {
    audio.context.resume();
  }
}

function drawOff() {
  canvasCtx.clearRect(0, 0, canvas.value.width, canvas.value.height);
  stopDrawing();
  pause();
}

function createWaveOscillator(semitone) {
  const len = 50;
  const real = new Float32Array(len);
  const imag = new Float32Array(len);
  real[0] = 0;
  imag[0] = 0;
  for (let i = 1, v = 1; i < len; i += 1, v = 1 / (i * i)) {
    real[i] = v;
    imag[i] = v;
  }
  const wave = audio.context.createPeriodicWave(real, imag, { disableNormalization: true });

  const oscillator = audio.context.createOscillator();
  oscillator.setPeriodicWave(wave);
  oscillator.frequency.setValueAtTime(frequencyFromSemitone(semitone), audio.context.currentTime);
  oscillator.start();

  return oscillator;
}

const drawers = {
  bass: drawBass,
  piano: drawPiano,
  bars: drawBars,
  sin: drawSin,
  off: drawOff,
};
visual.drawer = computed(() => drawers[visual.drawerKey]);

let getUserMedia = null;

async function getDisplayStream() {
  return navigator.mediaDevices
    .getDisplayMedia({
      audio: true,
      surfaceSwitching: 'include',
    });
}

async function getMicrophoneStream() {
  return getUserMedia({ video: false, audio: true });
}

const sources = {
  microphone: getMicrophoneStream,
  display: getDisplayStream,
};

async function startContext(stream) {
  if (!audio.context) {
    audio.context = new AudioContext();
  }

  source.source = audio.context.createMediaStreamSource(stream);

  source.stream = stream;
  source.tracks = stream.getTracks();

  const distortion = audio.context.createWaveShaper();
  source.source.connect(distortion);

  const analyser = audio.context.createAnalyser();
  // default: -100;
  analyser.minDecibels = -100;
  // max: 0 default: -30;
  analyser.maxDecibels = -5;
  // default: 0.8 min: 0 max: 1
  analyser.smoothingTimeConstant = 0.85;
  distortion.connect(analyser);
  // source.source.connect(analyser);
  source.analyser = analyser;

  audio.tail = source.source;
  // audio.tail = distortion;

  pianoOscillator = createWaveOscillator(42);

  // let oscillator = createWaveOscillator(50);
  // oscillator.connect(audio.context.destination);
  // oscillator.connect(source.analyser);
  // oscillators.push(oscillator);

  // oscillator = createWaveOscillator(53);
  // oscillator.connect(audio.context.destination);
  // oscillator.connect(source.analyser);
  // oscillators.push(oscillator);

  // oscillator = createWaveOscillator(56);
  // oscillator.connect(audio.context.destination);
  // oscillator.connect(source.analyser);
  // oscillators.push(oscillator);
}

async function start(sourceName) {
  if (source.stream) {
    stopStream(source.stream);
    source.stream = null;
  }

  source.type = sourceName;

  const stream = await sources[sourceName]();

  await startContext(stream);

  if (visual.drawer && !animationId) {
    visual.drawer();
  }
}
const { errors } = inject('$errors');

const media = reactive({
  allowed: true,
  secure: false,
  legacy: false,
  deviceChanged: false,
  error: null,
});

async function debug() {
  if (navigator?.mediaDevices?.getSupportedConstraints) {
    const supportedConstraints = navigator.mediaDevices.getSupportedConstraints();
    errors.value.push({
      message: 'mediaDevices supportedConstraints',
      context: { stack: JSON.stringify(supportedConstraints, null, 2) },
    });
  }
  if (navigator?.mediaDevices?.enumerateDevices) {
    const devices = await navigator.mediaDevices.enumerateDevices();
    errors.value.push({
      message: 'mediaDevices enumerateDevices',
      context: { stack: JSON.stringify(devices, null, 2) },
    });
  }
}

async function init() {
  canvasCtx = initCanvas(canvas.value, canvasWrap.value);

  if (!navigator.mediaDevices) {
    getUserMedia = navigator.getUserMedia
                         || navigator.webkitGetUserMedia
                         || navigator.mozGetUserMedia;
    if (!getUserMedia) {
      media.allowed = false;
    } else {
      media.legacy = true;
      getUserMedia = (constraints) => new Promise(
        (resolve, reject) => {
          getUserMedia.call(navigator, constraints, resolve, reject);
        },
      );
    }
  } else {
    getUserMedia = (constraints) => navigator.mediaDevices.getUserMedia(constraints);
    navigator.mediaDevices.ondevicechange = () => {
      media.deviceChanged = true;
    };
  }
  if (window.isSecureContext !== undefined) {
    media.secure = window.isSecureContext;
  }

  try {
    await start(Object.keys(sources)[0]);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error(e);
    switch (e.name) {
      case 'NotAllowedError':
      case 'NotFoundError':
        media.error = e.name;
        break;
      default:
        throw e;
    }
  }

  visual.drawerKey = 'bars';
}

function stop() {
  stopDrawing();
  if (source.stream) {
    stopStream(source.stream);
    source.stream = null;
  }
  if (audio.context) {
    if (audio.context.state !== 'closed') {
      audio.context.close();
    }
    audio.context = null;
  }
}

onMounted(init);
onBeforeUnmount(() => {
  stop();
});

watch(focused, (v, old) => {
  if (v === old) return;

  if (v) {
    resume();
    resumeDrawing();
  } else {
    stopDrawing();
    pause();
  }
});

watch(() => visual.drawer, (value, old) => {
  if (value === old) return;
  if (!source.analyser) return;

  if (animationId) {
    visual.next = value;
  } else {
    value();
  }
});

watch(() => source.echo, (value, old) => {
  if (value === old) return;
  if (!audio.tail) return;

  if (value) {
    const delay = audio.context.createDelay(3);
    audio.tail.connect(delay);
    audio.tail = delay;
    audio.tail.connect(audio.context.destination);
  } else {
    audio.tail.disconnect();
    audio.tail = source.source;
  }
});
function onCanvasResize() {
  const intendedWidth = canvasWrap.value.clientWidth;
  canvas.value.setAttribute('width', intendedWidth);

  const intendedHeight = canvasWrap.value.clientHeight;
  canvas.value.setAttribute('height', intendedHeight);
}
useResizeObserver(canvasWrap, onCanvasResize);
watch(isFullscreen, onCanvasResize);

function onMousemove(event) {
  const x = event.offsetX;
  const y = event.offsetY;

  let s = Math.round(
    ((x - piano.blackWidth) * 12) / (piano.whiteWidth * 7),
  ) + audio.semitoneFrom;
  if (isSharp(s)) {
    if (y > piano.blackEnd) {
      s -= 1;
    }
  }
  pianoOscillator.frequency.setValueAtTime(frequencyFromSemitone(s), audio.context.currentTime);
}

function onMousedown(event) {
  if (!audio.context) return;

  onMousemove(event);

  if (!pianoOscillatorConnected) {
    pianoOscillatorConnected = true;
    pianoOscillator.connect(audio.context.destination);
    pianoOscillator.connect(source.analyser);
  }

  canvas.value.addEventListener('mousemove', onMousemove);
}

function onMouseup() {
  if (!audio.context) return;

  if (pianoOscillatorConnected) {
    pianoOscillatorConnected = false;
    pianoOscillator.disconnect(audio.context.destination);
    pianoOscillator.disconnect(source.analyser);
  }

  canvas.value.removeEventListener('mousemove', onMousemove);
}

function onTouchmove(event) {
  const touches = event.changedTouches;
  const touch = touches[touches.length - 1];
  const x = touch.clientX;
  const y = touch.clientY;

  let s = Math.round(
    ((x - piano.blackWidth) * 12) / (piano.whiteWidth * 7),
  ) + audio.semitoneFrom;
  if (isSharp(s)) {
    if (y > piano.blackEnd) {
      s -= 1;
    }
  }
  pianoOscillator.frequency.setValueAtTime(frequencyFromSemitone(s), audio.context.currentTime);
}

function onTouchstart(event) {
  if (!audio.context) return;

  onTouchmove(event);

  if (!pianoOscillatorConnected) {
    pianoOscillatorConnected = true;
    pianoOscillator.connect(audio.context.destination);
    pianoOscillator.connect(source.analyser);
  }

  canvas.value.addEventListener('touchmove', onTouchmove);
}

function onTouchend() {
  if (!audio.context) return;

  if (pianoOscillatorConnected) {
    pianoOscillatorConnected = false;
    pianoOscillator.disconnect(audio.context.destination);
    pianoOscillator.disconnect(source.analyser);
  }

  canvas.value.removeEventListener('touchmove', onTouchmove);
}
</script>

<template>
  <header class="controls header">
    <span class="ma">
      🎵<strong>Audio Visializer</strong>
      <button type="button" @click="start('display')">
        🗔
        {{ t('buttons.start-display') }}
      </button>
      <button type="button" :disabled="source.type === 'microphone' && animationId" @click="start('microphone')">
        🎤
        {{ t('buttons.start-microphone') }}
        ({{ microphones.length }})
      </button>
      <button type="button" :disabled="!source.stream && !animationId" @click="stop">
        {{ t('buttons.stop') }}
      </button>
      <button type="button" :class="{ active: source.echo }" @click="source.echo = !source.echo">
        {{ t('buttons.echo') }}
      </button>
      <button type="button" @click="debug">
        {{ t('buttons.debug') }}
      </button>
    </span>
    <span class="ma">
      <span>{{ renders++ }}</span>
      <span>{{ fps }} fps</span>
      <span v-if="usedMemory">
        {{ usedMemory }}
      </span>
      <template v-if="battery.isSupported">
        <span>
          <b v-if="battery.charging">🔌</b>
          <b v-else>🔋</b>
          {{ batteryPercent }}% {{ batteryTime }}
        </span>
      </template>
      <label>
        <select v-model="$i18n.locale">
          <option v-for="lang in $i18n.availableLocales" :key="lang" :value="lang">
            {{ lang }}
          </option>
        </select>
      </label>
    </span>
  </header>
  <div class="controls ma">
    <span class="ma">
      {{ t('source') }} (stream)
      <span
        v-if="source.stream"
        class="status"
        :class="source.stream.active ? 'status_active' : 'status_inactive'"
      >
        {{ source.stream.active ? t('stream.active') : t('stream.inactive') }}
      </span>
    </span>
    <span
      v-for="track in source.tracks"
      :key="track.id"
      class="status ma"
      :class="track.enabled ? 'status_enabled' : 'status_muted'"
    >
      {{ track.label }}
      <button
        type="button"
        @click="track.enabled = !track.enabled"
      >{{ track.enabled ? t('track.buttons.mute') : t('track.buttons.unmute') }}</button>
    </span>
    <div v-if="!media.allowed" class="container">
      <span class="warning">
        {{ t('not-secure') }}
      </span>
    </div>
    <div v-if="!media.allowed && !media.isSecure" class="container">
      <span class="warning">
        {{ t('insecure-context') }}
      </span>
    </div>
    <div v-if="media.error" class="container">
      <span class="warning">
        {{ t(media.error) }}
      </span>
    </div>
  </div>
  <div class="controls ma">
    <span v-if="source.analyser" class="ma">
      <span><b
        :title="t('fast-fourier-transform')"
      >{{
        t('analyser.fast-fourier-transform-size')
      }}</b>: {{ source.analyser.fftSize }}</span>
      <button
        v-for="size in fftSizes"
        :key="size"
        type="button"
        :class="{ active: source.analyser.fftSize === size }"
        @click="source.analyser.fftSize = size; visual.next = visual.drawer"
      >{{ size }}</button>
    </span>
  </div>
  <div class="controls ma">
    <span class="ma">
      Audio Context
      <template v-if="audio.context">
        <span class="status" :class="`status_${audio.context.state}`">
          {{ audio.context.state }}
        </span>
        <button v-if="audio.context.state === 'running'" type="button" @click="pause">
          {{ t('audio-context.buttons.pause') }}
        </button>
        <button v-else type="button" @click="resume">
          {{ t('audio-context.buttons.resume') }}
        </button>
      </template>
      <span>Max: {{ audio.maxFreq }}{{ t('hertz') }}</span>
    </span>
    <span v-if="visual.drawerKey === 'piano'">
      🎹
      <button type="button" class="minus" @click="audio.semitoneFrom -= 1">-</button>
      <RomanNote v-if="visual.needsRoman" :note="audio.semitoneFrom" />
      <button type="button" class="plus" @click="audio.semitoneFrom += 1">+</button>
      —
      <button type="button" class="minus" @click="audio.semitoneTo -= 1">-</button>
      <RomanNote v-if="visual.needsRoman" :note="audio.semitoneTo" />
      <button type="button" class="plus" @click="audio.semitoneTo += 1">+</button>
      ({{ audio.semitonesCount }} {{ t('count-of-semitones') }})
      (<button type="button" class="note-button" @click="audio.semitoneFrom = 0">
        <RomanNote v-if="visual.needsRoman" :note="0" />
      </button>
      —
      <button type="button" class="note-button" @click="audio.semitoneTo = audio.maxSemitone">
        <RomanNote v-if="visual.needsRoman" :note="audio.maxSemitone" />
      </button>)
    </span>
  </div>
  <main>
    <div v-if="audio.context?.state" class="canvas-controls">
      <span class="drawers">
        <button
          v-for="drawer, key in drawers"
          :key="key"
          type="button"
          :disabled="key === visual.drawerKey"
          @click="visual.drawerKey = key"
        >
          {{ t(`drawers.${key}`) }}
        </button>
      </span>
      <button type="button" @click="toggle">
        &#x26F6;
      </button>
    </div>
    <div ref="canvasWrap" class="canvas-wrap">
      <canvas
        ref="canvas"
        @mousedown="onMousedown"
        @mouseup="onMouseup"
        @touchstart.passive="onTouchstart"
        @touchend.passive="onTouchend"
      />
    </div>
    <div ref="canvasWrapOriginal" class="canvas-wrap">
      <canvas ref="canvasOriginal" />
    </div>
    <div ref="canvasWrapAcf2p" class="canvas-wrap">
      <canvas ref="canvasAcf2p" />
    </div>
  </main>
</template>

<style lang="scss" scoped>
.status {
  &_active {
    color: red;
  }
  &_running {
    color: green;
  }
  &_inactive, &_suspended, &_muted {
    color: gray;
  }
}
.controls {
  padding: 0.75rem;
  border-bottom: 1px dashed gray;
}
.canvas-wrap {
  border: 1px solid gray;
  height: calc(50vh - 2rem);
}
.ma > *:not(:first-child) {
  margin-left: 0.5rem;
}
.ma > *:not(:last-child) {
  margin-right: 0.5rem;
}
.pitch {
  display: inline-flex;
  min-height: 2rem;
  justify-content: space-around;
  align-items: center;
}
.note, .cents, .hz {
  min-width: 3rem;
}
.octave {
  min-width: 9rem;
}
button.active {
  background-color: lightgray;
}
.plus, .minus {
  border-radius: 100%;
  margin: 0 0.1rem;
}
.plus {
  background-color: lightgreen;
}
.minus {
  background-color: pink;
}
.note-button {
  min-height: 2rem;
  border-radius: 100%;
  background-color: black;
  color: white;
}
.warning {
  border: solid 1px yellow;
  border-radius: 1rem;
  background-color: lightyellow;
  padding: 0.25rem;
}
main {
  padding-bottom: 3rem;
}
.container {
    display: flex;
    margin: 0.25rem;
}
.header {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: center;
}
</style>

<i18n lang="json">
{
    "en": {
      "not-secure": "No access to media devices. Ensure connection is HTTPS and browser has support for media devices",
      "insecure-context": "Insecure context",
      "NotAllowedError": "Allow access to media devices to record",
      "NotFoundError": "Requested device not found",
      "buttons": {
        "start-display": "Display",
        "start-microphone": "Mic",
        "stop": "Stop",
        "echo": "Echo",
        "debug": "Debug"
      },
      "stream": {
        "active": "Active",
        "inactive": "Inactive"
      },
      "track": {
        "buttons": {
          "mute": "Mute",
          "unmute": "Unmute"
        }
      },
      "analyser": {
        "fast-fourier-transform-size": "FFT Size"
      },
      "fast-fourier-transform": "Fast Fourier transform",
      "audio-context": {
        "buttons": {
          "pause": "Pause",
          "resume": "Resume"
        }
      },
      "hertz": "Hz",
      "count-of-semitones": "semitones",
      "source": "Source",
      "drawers": {
        "bass": "𝄢𝄚",
        "piano": "🎹Piano",
        "bars": "Bars",
        "sin": "Sin",
        "off": "Off"
      },
      "octaves": [
        "Dbl Contra", "Sub Contra", "Contra",
        "Great", "Small",
        "1 Line", "2 Line", "3 Line", "4 Line", "5 Line",
        "6 Line", "7 Line"
      ]
    },
    "ru": {
      "not-secure": "Нет доступа к медиа-устройствам. Убедитесь, что соединение защищено и браузер поддерживает медиа-устройства",
      "insecure-context": "Соединение незащищено",
      "NotAllowedError": "Для записи разрешите доступ к устройствам",
      "NotFoundError": "Запрашиваемое устройство не найдено",
      "buttons": {
        "start-display": "Экран",
        "start-microphone": "Микрофон",
        "stop": "Стоп",
        "echo": "Эхо",
        "debug": "Отладка"
      },
      "stream": {
        "active": "Активен",
        "inactive": "Неактивен"
      },
      "track": {
        "buttons": {
          "mute": "Приглушить",
          "unmute": "Вкл"
        }
      },
      "analyser": {
        "fast-fourier-transform-size": "Размер БПФ (FFT)"
      },
      "fast-fourier-transform": "Быстрые преобразования Фурье",
      "audio-context": {
        "buttons": {
          "pause": "Пауза",
          "resume": "Продолжить"
        }
      },
      "hertz": "Гц",
      "count-of-semitones": "полутонов",
      "source": "Источник",
      "drawers": {
        "bass": "𝄢𝄚",
        "piano": "🎹Пианино",
        "bars": "Столбики",
        "sin": "Синус",
        "off": "Выкл"
      },
      "octaves": [
        "Субсубконтроктава", "Субконтроктава", "Контроктава",
        "Большая октава", "Малая октава",
        "Первая октава", "Вторая октава", "Третья октава", "Четвёртая октава", "Пятая октава",
        "Шестая октава", "Седьмая октава"
      ]
    }
}
</i18n>
