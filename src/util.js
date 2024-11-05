export function lcFirst(val) {
  return String(val).charAt(0).toLowerCase() + String(val).slice(1);
}

export function semitoneFromPitch(frequency) {
  const noteNum = 12 * (Math.log(frequency / 440) / Math.log(2));
  return Math.round(noteNum) + 69;
}

export function frequencyFromSemitone(note) {
  return 440 * 2 ** ((note - 69) / 12);
}

const OCTAVE_CENTS = 1200;

export function centsOffFromPitch(frequency, note) {
  return Math.floor(
    (
      OCTAVE_CENTS * Math.log(frequency / frequencyFromSemitone(note))
    ) / Math.log(2),
  );
}
