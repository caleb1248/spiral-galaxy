import WebMscore from 'webmscore';

await WebMscore.ready;

export async function renderPdfFromMidi(midiData: Uint8Array) {
  const score = await WebMscore.load('midi', midiData);
  (await score.metadata()).title = 'Spiral Galaxy';
  return score.savePdf() as Promise<Uint8Array<ArrayBuffer>>;
}
