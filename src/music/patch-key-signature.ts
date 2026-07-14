import { parseMidi, writeMidi } from 'midi-file';

/**
 * The key signature doesn't get picked up by webmscore when set in the header.
 * To fix this, we add the key signature into an instrumental track.
 * This approach is used because it works with our current setup, but it creates a lot of overhead.
 * In the future, we will migrate away from @tonejs/midi and use midi-file directly, which will eliminate the overhead of reparsing and rewriting the midi file.
 */
export function patchKeySignature(file: Uint8Array<ArrayBuffer>) {
  const midi = parseMidi(file);
  midi.tracks[1].splice(1, 0, {
    deltaTime: 0,
    type: 'keySignature',
    key: -1,
    scale: 1,
  });

  return new Uint8Array(writeMidi(midi));
}
