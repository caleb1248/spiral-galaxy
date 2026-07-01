import WebMscore from 'webmscore';

await WebMscore.ready;

export function exportPdf(midiData: Uint8Array) {
  return WebMscore.load('midi', midiData).then((score) => score.savePdf());
}
