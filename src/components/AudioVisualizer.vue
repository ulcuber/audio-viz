<script setup>
import {
  onMounted, onBeforeUnmount, ref, watch, reactive, computed,
} from 'vue';

import { useResizeObserver } from '@vueuse/core';

const fftSizes = [32768, 16384, 8192, 2048, 1024, 512, 256, 128];
const enNoteStringsSharp = [
  'C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B',
];
const romanNoteStringsSharp = [
  'До', 'До♯', 'Ре', 'Ре♯', 'Ми', 'Фа', 'Фа♯', 'Соль', 'Соль♯', 'Ля', 'Ля♯', 'Си',
];
const romanOcaves = [
  'Субсубконтроктава', 'Субконтроктава', 'Контроктава',
  'Большая октава', 'Малая октава',
  'Первая октава', 'Вторая октава', 'Третья октава', 'Четвёртая октава', 'Пятая октава',
];

function noteFromPitch(frequency) {
  const noteNum = 12 * (Math.log(frequency / 440) / Math.log(2));
  return Math.round(noteNum) + 69;
}

function frequencyFromNoteNumber(note) {
  return 440 * 2 ** ((note - 69) / 12);
}

function centsOffFromPitch(frequency, note) {
  return Math.floor(1200 * Math.log(frequency / frequencyFromNoteNumber(note)) / Math.log(2));
}

function isSharp(note) {
  const noteIndex = note % 12;
  if (noteIndex === 1) return true;
  if (noteIndex === 3) return true;
  if (noteIndex === 6) return true;
  if (noteIndex === 8) return true;
  if (noteIndex === 10) return true;
  return false;
}

function lcFirst(val) {
  return String(val).charAt(0).toLowerCase() + String(val).slice(1);
}

const audio = reactive({
  context: new AudioContext(),
  tail: null,
});
audio.maxFreq = computed(() => (audio.context ? audio.context.sampleRate / 2 : 0));
audio.maxNote = computed(() => noteFromPitch(audio.maxFreq));
audio.notesCount = computed(() => audio.maxNote + 1);

const source = reactive({
  echo: false,
  stream: null,
  tracks: [],
  source: null,
  analyser: null,
  pitch: -1,
  type: null,
});
source.note = computed(() => noteFromPitch(source.pitch));
source.noteName = computed(() => romanNoteStringsSharp[source.note % 12]);
source.enNoteName = computed(() => enNoteStringsSharp[source.note % 12]);

source.octave = computed(() => Math.round((source.note - 6) / 12));
source.octaveSub = computed(
  () => (source.octave < 3 ? 3 - source.octave : null),
);
source.octaveSup = computed(
  () => (source.octave > 4 ? source.octave - 4 : null),
);
source.octaveName = computed(
  () => romanOcaves[source.octave] || source.octave,
);
source.octaveNoteName = computed(
  () => (source.octave === 4 ? lcFirst(source.noteName) : source.noteName),
);

source.detune = computed(() => centsOffFromPitch(source.pitch, source.note));
source.semitonesDetune = computed(() => Math.floor(source.detune / 100));

const visual = reactive({
  animationId: null,
  canvasCtx: null,
  drawer: null,
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

  for (let i = 0; i < SIZE; i++) {
    const val = buf[i];
    rms += val * val;
  }
  rms = Math.sqrt(rms / SIZE);
  // not enough signal
  if (rms < 0.01) return -1;

  let r1 = 0;
  let r2 = SIZE - 1;
  const thres = 0.2;
  for (let i = 0; i < SIZE / 2; i++) {
    if (Math.abs(buf[i]) < thres) {
      r1 = i;
      break;
    }
  }
  for (let i = 1; i < SIZE / 2; i++) {
    if (Math.abs(buf[SIZE - i]) < thres) {
      r2 = SIZE - i;
      break;
    }
  }

  buf = buf.slice(r1, r2);
  SIZE = buf.length;

  const c = new Array(SIZE).fill(0);
  for (let i = 0; i < SIZE; i++) {
    for (let j = 0; j < SIZE - i; j++) {
      c[i] += buf[j] * buf[j + i];
    }
  }

  let d = 0;
  while (c[d] > c[d + 1]) {
    d++;
  }

  let maxval = -1;
  let maxpos = -1;
  for (let i = d; i < SIZE; i++) {
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

    const whiteWidth = Math.round((canvas.value.width * 12) / (audio.notesCount * 7));
    const whiteHeight = canvas.value.height / 2;

    const blackWidth = whiteWidth / 2;
    const blackHeight = whiteHeight * 0.7;

    let sum = 0;
    let count = 0;
    let note = 0;
    let nextNote = 1;
    for (let i = 0; i < bufferLength; i += 1) {
      sum += dataArray[i];
      count += 1;

      note = Math.round((i * audio.notesCount) / bufferLength);
      nextNote = Math.round(((i + 1) * audio.notesCount) / bufferLength);
      if (nextNote === note) continue;

      const v = sum / count;
      sum = 0;
      count = 0;

      const noteNum = Math.floor((note * 7 + 1) / 12);
      if (isSharp(note)) {
        visual.canvasCtx.fillStyle = note === source.note ? 'green' : `rgb(${v}, ${v}, ${v})`;
        visual.canvasCtx.fillRect(
          noteNum * whiteWidth + blackWidth,
          canvas.value.height - whiteHeight,
          blackWidth,
          blackHeight,
        );
      } else {
        visual.canvasCtx.fillStyle = note === source.note ? 'green' : `rgb(255, ${255 - v}, ${255 - v})`;
        visual.canvasCtx.fillRect(
          noteNum * whiteWidth + 1,
          canvas.value.height - whiteHeight,
          whiteWidth - 1,
          whiteHeight,
        );
      }
    }
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
  piano: drawPiano,
  bars: drawBars,
  sin: drawSin,
  off: drawOff,
};

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

  visual.drawer = drawPiano;
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
    </span>
  </div>
  <main>
    <div v-if="audio.context?.state" class="canvas-controls">
      <span class="drawers">
        <button
          v-for="drawer, name in drawers"
          :key="name"
          type="button"
          :disabled="drawer === visual.drawer"
          @click="visual.drawer = drawer"
        >
          {{ name }}
        </button>
      </span>
      <span>
        <span class="pitch">
          <span>{{ source.octaveName || '-' }}</span>
          <strong>{{
            source.octaveNoteName || '-'
          }}<sup v-if="source.octaveSup !== null">{{
            source.octaveSup
          }}</sup><sub v-if="source.octaveSub !== null">{{
            source.octaveSub
          }}</sub></strong>
          <span>{{ (source.enNoteName || '-') + String(source.octave + 1) }}</span>
          <span>{{ source.detune }}</span>
          <span>({{ source.semitonesDetune }})</span>
          <span>{{ Math.round((source.pitch + Number.EPSILON) * 10) / 10 }}Hz</span>
        </span>
      </span>
      <span>Max: {{ audio.maxFreq }}Hz</span>
    </div>
    <div ref="canvasWrap" class="canvas-wrap">
      <canvas ref="canvas" />
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
</style>
