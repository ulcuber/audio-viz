import {
  lcFirst, semitoneFromPitch, centsOffFromPitch,
} from '../util';
import {
  romanNoteStringsSharp, enNoteStringsSharp,
} from '../dict';

export default class Semitone {
  constructor(canvasCtx, translate) {
    this.canvasCtx = canvasCtx;
    this.t = translate;

    this.setPitch(-1);

    this.needsRoman = true;
    this.fillStyle = 'white';

    this.maxCellWidth = 0;
    this.size = 30;
    this.canvasCtx.font = `${this.size}px serif`;
    let metrics = this.canvasCtx.measureText('Соль♯');
    this.maxCellWidth += metrics.width;
    this.canvasCtx.font = `${this.size/2}px serif`;
    metrics = this.canvasCtx.measureText('1');
    this.maxCellWidth += metrics.width;
  }

  setFillStyle(fillStyle) {
    this.fillStyle = fillStyle;
  }

  setPitch(pitch) {
    this.pitch = pitch;
    this.roundedPitch = Math.round((this.pitch + Number.EPSILON) * 10) / 10;
    this.semitone = semitoneFromPitch(pitch);

    this.semitoneName = romanNoteStringsSharp[this.semitone % 12];
    this.enSemitoneName = enNoteStringsSharp[this.semitone % 12];

    this.octave = Math.round((this.semitone - 6) / 12);
    this.octaveName = this.octave ? this.t(`octaves.${this.octave}`) : null;

    this.octaveSub = this.octave < 3 ? 3 - this.octave : null;
    this.octaveSup = this.octave > 4 ? this.octave - 4 : null;

    this.octaveSemitoneName = this.octave === 4 ? lcFirst(this.semitoneName) : this.semitoneName;

    this.detune = centsOffFromPitch(this.pitch, this.semitone);
    this.semitonesDetune = Math.floor(this.detune / 100);
  }

  render() {
    if (!this.octaveSemitoneName) return;

    const { size } = this;
    let xOffset = size;
    this.canvasCtx.fillStyle = this.fillStyle;
    let text = null;
    let metrics = null;

    if (this.needsRoman) {
      text = this.octaveSemitoneName;
      this.canvasCtx.font = `${size}px serif`;
      this.canvasCtx.fillText(text, xOffset, size);
      metrics = this.canvasCtx.measureText(text);
      xOffset += metrics.width;

      if (this.octaveSup) {
        text = this.octaveSup;
        this.canvasCtx.font = `${size / 2}px serif`;
        this.canvasCtx.fillText(text, xOffset, size / 2);
      } else if (this.octaveSub) {
        text = this.octaveSub;
        this.canvasCtx.font = `${size / 2}px serif`;
        this.canvasCtx.fillText(text, xOffset, size);
      }
      xOffset = this.maxCellWidth + 2 * size;

      text = this.enSemitoneName;
      this.canvasCtx.font = `${size}px serif`;
      this.canvasCtx.fillText(text, xOffset, size);
      xOffset += this.maxCellWidth + size;

      text = this.detune;
      this.canvasCtx.font = `${size}px serif`;
      this.canvasCtx.fillText(text, xOffset, size);
      xOffset += this.maxCellWidth + size;

      text = this.semitonesDetune;
      this.canvasCtx.font = `${size}px serif`;
      this.canvasCtx.fillText(text, xOffset, size);
      xOffset += this.maxCellWidth + size;

      text = this.roundedPitch;
      this.canvasCtx.font = `${size}px serif`;
      this.canvasCtx.fillText(text, xOffset, size);
    }
  }
}
