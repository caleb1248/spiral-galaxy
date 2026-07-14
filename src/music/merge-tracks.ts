// @ts-check
import { Midi } from '@tonejs/midi';

interface Note {
  /**
   * midi note
   */
  note: number;
  /**
   * duration in beats
   */
  duration: number;
}

export function generateMidiFile(
  clips: Note[][],
  options: {
    bpm: number;
    npb: number;
    names?: Array<string>;
    channels?: Array<number>;
  },
): Midi {
  const { bpm, npb, names = [], channels = [] } = options;

  const midi = new Midi();
  midi.header.name = 'Spiral Galaxy';

  for (let i = 0; i < clips.length; i++) {
    const clip = clips[i];
    const track = midi.addTrack();

    track.name = names[i] || `Track ${i + 1}`;

    if (channels[i] !== undefined) track.channel = channels[i];

    for (let step = 0; step < clip.length; step += 1) {
      if (!clip[step]) continue;
      track.addNote({
        midi: clip[step].note + 12, // notes are an octave lower for some reason, this is a temporary fix.
        ticks: step * (midi.header.ppq / npb),
        durationTicks: clip[step].duration * midi.header.ppq,
      });
    }
  }

  midi.header.tempos.push({
    bpm,
    ticks: 0,
  });

  midi.header.timeSignatures.push({
    ticks: 0,
    timeSignature: [5, 4],
  });

  console.log(midi.header.keySignatures); // logs [] (empty)

  midi.header.keySignatures.push({
    ticks: 0,
    key: 'Bb',
    scale: 'major',
  });

  midi.header.update();

  console.log(midi.header.keySignatures); // logs [{ ticks: 0, key: 'Bb', scale: 'major' }]

  return midi;
}
