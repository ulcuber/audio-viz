<script setup>
import { computed } from 'vue';
import { romanNoteStringsSharp } from '../dict';
import { lcFirst } from '../util';

const props = defineProps({
  note: { type: Number, required: true },
});

const noteName = computed(() => romanNoteStringsSharp[props.note % 12]);
const octave = computed(() => Math.round((props.note - 6) / 12));

const octaveSub = computed(
  () => (octave.value < 3 ? 3 - octave.value : null),
);
const octaveSup = computed(
  () => (octave.value > 4 ? octave.value - 4 : null),
);
const octaveNoteName = computed(
  () => (octave.value === 4 ? lcFirst(noteName.value) : noteName.value),
);
</script>

<template>
  <strong>{{
    octaveNoteName || '-'
  }}<sup v-if="octaveSup !== null">{{
    octaveSup
  }}</sup><sub v-if="octaveSub !== null">{{
    octaveSub
  }}</sub></strong>
</template>
