<script setup>
import {
  onMounted, onBeforeUnmount, ref, watch, reactive, computed,
} from 'vue';
import { useResizeObserver } from '@vueuse/core';
import {
  romanOctaves, romanNoteStringsSharp, enNoteStringsSharp, fftSizes,
  drawersNamesRu,
} from '../dict';
import { semitoneFromPitch, centsOffFromPitch, frequencyFromSemitone } from '../util';
import RomanNote from './RomanNote.vue';

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

let oscillator = null;
let oscillatorConnected = false;

const source = reactive({
  echo: false,
  stream: null,
  tracks: [],
  source: null,
  analyser: null,
  pitch: -1,
  type: null,
});
source.note = computed(() => semitoneFromPitch(source.pitch));
source.noteName = computed(() => romanNoteStringsSharp[source.note % 12]);
source.enNoteName = computed(() => enNoteStringsSharp[source.note % 12]);

source.octave = computed(() => Math.round((source.note - 6) / 12));
source.octaveName = computed(
  () => romanOctaves[source.octave] || source.octave,
);

source.detune = computed(() => centsOffFromPitch(source.pitch, source.note));
source.semitonesDetune = computed(() => Math.floor(source.detune / 100));

const visual = reactive({
  animationId: null,
  canvasCtx: null,
  drawerKey: null,
  next: () => {},
});

const canvasWrap = ref();
const canvas = ref();

// Implements the ACF2+ algorithm
function acf2p() {
  const bufferLength = source.analyser.frequencyBinCount;
  let buf = new Float32Array(bufferLength);

  source.analyser.getFloatTimeDomainData(buf);

  let SIZE = buf.length;
  let rms = 0;

  for (let i = 0; i < SIZE; i += 1) {
    const val = buf[i];
    rms += val * val;
  }
  rms = Math.sqrt(rms / SIZE);
  // not enough signal
  if (rms < 0.01) return -1;

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

  buf = buf.slice(r1, r2);
  SIZE = buf.length;

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

  let T0 = maxpos;

  const x1 = c[T0 - 1];
  const x2 = c[T0];
  const x3 = c[T0 + 1];
  const a = (x1 + x3 - 2 * x2) / 2;
  if (a) {
    const b = (x3 - x1) / 2;
    T0 -= b / (2 * a);
  }

  return audio.context.sampleRate / T0;
}

function stopStream(stream) {
  if (stream.getTracks) {
    stream.getTracks().forEach((track) => track.stop());
  }
}

function stopDrawing() {
  if (visual.animationId) {
    cancelAnimationFrame(visual.animationId);
    visual.animationId = null;
  }
  visual.next = () => {};
}

function enshureContext() {
  if (audio.context) {
    if (audio.context.state === 'suspended') {
      audio.context.resume();
    }
  }
}

function drawBars() {
  enshureContext();

  const bufferLength = source.analyser.frequencyBinCount;
  // const dataArray = new Uint8Array(bufferLength);
  const dataArray = new Float32Array(bufferLength);

  const draw = () => {
    visual.animationId = requestAnimationFrame(visual.next);

    // source.analyser.getByteFrequencyData(dataArray);
    source.analyser.getFloatFrequencyData(dataArray);

    source.pitch = acf2p();

    visual.canvasCtx.fillStyle = 'rgb(0, 0, 0)';
    visual.canvasCtx.fillRect(0, 0, canvas.value.width, canvas.value.height);

    const barWidth = canvas.value.width / bufferLength;
    let x = 0;

    for (let i = 0; i < bufferLength; i += 1) {
      // const barHeight = dataArray[i];
      const barHeight = dataArray[i] - source.analyser.minDecibels;

      visual.canvasCtx.fillStyle = `rgb(${barHeight + 200},${i + 180},203)`;
      visual.canvasCtx.fillRect(
        x,
        canvas.value.height - barHeight,
        barWidth,
        barHeight,
      );

      x += barWidth + 1;
    }
  };

  visual.next = draw;
  draw();
}

function drawSin() {
  enshureContext();

  const bufferLength = source.analyser.fftSize;
  const dataArray = new Uint8Array(bufferLength);

  const draw = () => {
    visual.animationId = requestAnimationFrame(visual.next);

    source.analyser.getByteTimeDomainData(dataArray);

    source.pitch = acf2p();

    visual.canvasCtx.fillStyle = 'rgb(0, 0, 0)';
    visual.canvasCtx.fillRect(0, 0, canvas.value.width, canvas.value.height);

    visual.canvasCtx.lineWidth = 2;
    visual.canvasCtx.strokeStyle = 'rgb(256, 256, 256)';

    visual.canvasCtx.beginPath();

    const sliceWidth = (canvas.value.width * 1.0) / bufferLength;
    let x = 0;

    for (let i = 0; i < bufferLength; i += 1) {
      const v = dataArray[i] / 128.0;
      const y = canvas.value.height - ((v * canvas.value.height) / 2);

      if (i === 0) {
        visual.canvasCtx.moveTo(x, y);
      } else {
        visual.canvasCtx.lineTo(x, y);
      }

      x += sliceWidth;
    }

    visual.canvasCtx.lineTo(canvas.value.width, 0);
    visual.canvasCtx.stroke();
  };

  visual.next = draw;
  draw();
}

const piano = reactive({
});
piano.whiteWidth = computed(() => (canvas.value.width * 12) / (audio.semitonesCount * 7));
piano.whiteHeight = computed(() => Math.min(canvas.value.height, piano.whiteWidth * 4));
piano.heightOffset = computed(() => canvas.value.height - piano.whiteHeight);

piano.blackWidth = computed(() => piano.whiteWidth / 1.5);
piano.blackHeight = computed(() => piano.whiteHeight * 0.7);
piano.blackOffset = computed(() => piano.whiteWidth / 2.5);
piano.blackEnd = computed(() => piano.heightOffset + piano.blackHeight);

function drawPiano() {
  enshureContext();

  const bufferLength = source.analyser.frequencyBinCount;
  const dataArray = new Uint8Array(bufferLength);

  const draw = () => {
    visual.animationId = requestAnimationFrame(visual.next);

    source.analyser.getByteFrequencyData(dataArray);

    source.pitch = acf2p();

    visual.canvasCtx.fillStyle = 'rgb(100, 210, 240)';
    visual.canvasCtx.fillRect(0, 0, canvas.value.width, canvas.value.height);

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
        blackFill = note === source.note ? 'green' : `rgb(${v}, ${v}, ${v})`;
        blackX = widthOffset - piano.blackOffset;
      } else {
        visual.canvasCtx.fillStyle = note === source.note ? 'green' : `rgb(255, ${255 - v}, ${255 - v})`;
        visual.canvasCtx.fillRect(
          widthOffset,
          piano.heightOffset,
          piano.whiteWidth - 2,
          piano.whiteHeight,
        );

        if (blackX) {
          visual.canvasCtx.fillStyle = blackFill;
          visual.canvasCtx.fillRect(
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
  visual.canvasCtx.font = '10px serif';
  const text = visual.canvasCtx.measureText(clef);
  const clefK = text.actualBoundingBoxAscent === 8 ? 6 : 4.2;
  const clefOffset = text.actualBoundingBoxAscent - 8;

  const draw = () => {
    visual.animationId = requestAnimationFrame(visual.next);

    source.pitch = acf2p();

    const semitone = semitoneFromPitch(source.pitch);

    const lineHeight = 3;
    const betweenHeight = canvas.value.height / 6;
    const step = betweenHeight / 2;
    const fontOffset = betweenHeight / 3;

    visual.canvasCtx.fillStyle = 'white';
    visual.canvasCtx.fillRect(0, 0, canvas.value.width, canvas.value.height);

    for (let offset = betweenHeight; offset < canvas.value.height; offset += betweenHeight) {
      visual.canvasCtx.fillStyle = 'black';
      visual.canvasCtx.fillRect(0, offset, canvas.value.width, lineHeight);
    }

    const clefFont = Math.floor((betweenHeight - lineHeight) * clefK);
    visual.canvasCtx.font = `${clefFont}px serif`;
    visual.canvasCtx.fillText(
      clef,
      lineHeight,
      (clefOffset * 6 + betweenHeight) * 2 + clefFont / 2 + fontOffset + lineHeight * 2,
    );

    if (!Number.isFinite(semitone)) {
      return;
    }

    const n = maxTone - semitone;
    if (n < 0 || n > semitonesCount) {
      return;
    }

    const sharp = isSharp(semitone);
    const font = betweenHeight - lineHeight;
    const noteFont = font * 4;

    const steps = bassSteps(n);
    const pitchOffset = steps * step + lineHeight + fontOffset;
    if (sharp) {
      visual.canvasCtx.font = `${font}px serif`;
      visual.canvasCtx.fillText(
        '♯',
        canvas.value.width / 2,
        pitchOffset,
      );
    }
    visual.canvasCtx.font = `${noteFont}px serif`;
    visual.canvasCtx.fillText(
      '𝅝',
      canvas.value.width / 2 + font / 2,
      pitchOffset + clefOffset * 8,
    );
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
  visual.canvasCtx.clearRect(0, 0, canvas.value.width, canvas.value.height);
  stopDrawing();
  pause();
}

const drawers = {
  bass: drawBass,
  piano: drawPiano,
  bars: drawBars,
  sin: drawSin,
  off: drawOff,
};
visual.drawer = computed(() => drawers[visual.drawerKey]);

async function getDisplayStream() {
  const stream = await navigator.mediaDevices
    .getDisplayMedia({
      audio: true,
      surfaceSwitching: 'include',
    });

  return stream;
}

async function getMicrophoneStream() {
  const stream = await navigator.mediaDevices.getUserMedia({ video: false, audio: true });

  return stream;
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
  source.analyser = analyser;

  audio.tail = source.source;

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

  oscillator = audio.context.createOscillator();
  // oscillator.type = 'sine';
  oscillator.setPeriodicWave(wave);
  oscillator.frequency.setValueAtTime(frequencyFromSemitone(42), audio.context.currentTime);
  oscillator.start();
}

async function initCanvas() {
  visual.canvasCtx = canvas.value.getContext('2d');

  const intendedWidth = canvasWrap.value.clientWidth;
  canvas.value.setAttribute('width', intendedWidth);

  const intendedHeight = canvasWrap.value.clientHeight;
  canvas.value.setAttribute('height', intendedHeight);

  visual.canvasCtx.clearRect(0, 0, canvas.value.width, canvas.value.height);
}

async function start(sourceName) {
  if (source.stream) {
    stopStream(source.stream);
    source.stream = null;
  }

  source.type = sourceName;

  const stream = await sources[sourceName]();

  await startContext(stream);

  if (visual.drawer && !visual.animationId) {
    visual.drawer();
  }
}

async function init() {
  await initCanvas();

  start(Object.keys(sources)[0]);

  visual.drawerKey = 'bass';
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

watch(() => visual.drawer, (value, old) => {
  if (value === old) return;
  if (!source.analyser) return;

  if (visual.animationId) {
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

useResizeObserver(canvasWrap, () => {
  const intendedWidth = canvasWrap.value.clientWidth;
  canvas.value.setAttribute('width', intendedWidth);

  const intendedHeight = canvasWrap.value.clientHeight;
  canvas.value.setAttribute('height', intendedHeight);
});

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
  oscillator.frequency.setValueAtTime(frequencyFromSemitone(s), audio.context.currentTime);
}

function onMousedown(event) {
  onMousemove(event);

  if (!oscillatorConnected) {
    oscillatorConnected = true;
    oscillator.connect(audio.context.destination);
    oscillator.connect(source.analyser);
  }

  canvas.value.addEventListener('mousemove', onMousemove);
}

function onMouseup() {
  if (oscillatorConnected) {
    oscillatorConnected = false;
    oscillator.disconnect(audio.context.destination);
    oscillator.disconnect(source.analyser);
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
  oscillator.frequency.setValueAtTime(frequencyFromSemitone(s), audio.context.currentTime);
}

function onTouchstart(event) {
  onTouchmove(event);

  if (!oscillatorConnected) {
    oscillatorConnected = true;
    oscillator.connect(audio.context.destination);
    oscillator.connect(source.analyser);
  }

  canvas.value.addEventListener('touchmove', onTouchmove);
}

function onTouchend() {
  if (oscillatorConnected) {
    oscillatorConnected = false;
    oscillator.disconnect(audio.context.destination);
    oscillator.disconnect(source.analyser);
  }

  canvas.value.removeEventListener('touchmove', onTouchmove);
}
</script>

<template>
  <header class="controls ma">
    <strong>Audio Visializer</strong>
    <button type="button" @click="start('display')">
      Start display
    </button>
    <button type="button" :disabled="source.type === 'microphone' && visual.animationId" @click="start('microphone')">
      Start microphone
    </button>
    <button type="button" :disabled="!source.stream && !visual.animationId" @click="stop">
      Stop
    </button>
    <button type="button" :class="{ active: source.echo }" @click="source.echo = !source.echo">
      Echo
    </button>
  </header>
  <div class="controls ma">
    <span class="ma">
      Source (stream)
      <span
        v-if="source.stream"
        class="status"
        :class="source.stream.active ? 'status_active' : 'status_inactive'"
      >
        {{ source.stream.active ? 'Active' : 'Inactive' }}
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
      >{{ track.enabled ? 'Mute' : 'Muted' }}</button>
    </span>
  </div>
  <div class="controls ma">
    <span v-if="source.analyser" class="ma">
      <span><b title="Fast Fourier Transform">FFT size</b>: {{ source.analyser.fftSize }}</span>
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
          Pause
        </button>
        <button v-else type="button" @click="resume">
          Resume
        </button>
      </template>
      <span>Max: {{ audio.maxFreq }}Hz</span>
    </span>
    <span v-if="visual.drawerKey === 'piano'">
      <button type="button" class="minus" @click="audio.semitoneFrom -= 1">-</button>
      <RomanNote :note="audio.semitoneFrom" />
      <button type="button" class="plus" @click="audio.semitoneFrom += 1">+</button>
      —
      <button type="button" class="minus" @click="audio.semitoneTo -= 1">-</button>
      <RomanNote :note="audio.semitoneTo" />
      <button type="button" class="plus" @click="audio.semitoneTo += 1">+</button>
      ({{ audio.semitonesCount }} semitones)
      (<button type="button" class="note-button" @click="audio.semitoneFrom = 0">
        <RomanNote :note="0" />
      </button>
      —
      <button type="button" class="note-button" @click="audio.semitoneTo = audio.maxSemitone">
        <RomanNote :note="audio.maxSemitone" />
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
          {{ drawersNamesRu[key] }}
        </button>
      </span>
      <span>
        <span class="pitch">
          <span>{{ source.octaveName || '-' }}</span>
          <RomanNote :note="source.note" />
          <span>{{ (source.enNoteName || '-') + String(source.octave + 1) }}</span>
          <span>{{ source.detune }}</span>
          <span>({{ source.semitonesDetune }})</span>
          <span>{{ Math.round((source.pitch + Number.EPSILON) * 10) / 10 }}Hz</span>
        </span>
      </span>
    </div>
    <div ref="canvasWrap" class="canvas-wrap">
      <canvas
        ref="canvas"
        @mousedown="onMousedown"
        @mouseup="onMouseup"
        @touchstart="onTouchstart"
        @touchend="onTouchend"
      />
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
  padding: 0.5rem;
  border-bottom: 1px dashed gray;
  margin-bottom: 1rem;
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
  min-width: 20rem;
  min-height: 2rem;
  justify-content: space-around;
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
</style>
