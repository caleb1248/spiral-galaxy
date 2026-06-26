// @ts-check
import { Midi } from '@tonejs/midi';
import { clip } from 'scribbletune';

/**
 * @typedef {Object} Note
 * @property {number} Note.note
 * @property {number} Note.duration
 */

/**
 * Convert multiple Scribbletune clips into a Tone.js Midi object.
 *
 * @param {Note[][]} clips - Array of Scribbletune clips
 * @param {Object} options
 * @param {number | undefined} [options.bpm] - MIDI tempo
 * @param {Array<string>} [options.names] - Track names
 * @param {Array<number>} [options.channels] - MIDI channels
 * @returns {Midi}
 */
export function mergeTracks(clips, options = {}) {
  const { bpm = 120, names = [], channels = [] } = options;

  const bps = bpm / 60;

  const midi = new Midi();

  midi.header.setTempo(bpm);

  for (let i = 0; i < clips.length; i++) {
    const clip = clips[i];
    const track = midi.addTrack();

    track.name = names[i] || `Track ${i + 1}`;

    if (channels[i] !== undefined) track.channel = channels[i];

    for (let step = 0; step < clip.length; step += 1)
      track.addNote({
        midi: clip[step].note + 12, // notes are an octave lower for some reason, this is a temporary fix.
        time: step / (bps * 4),
        duration: clip[step].duration,
      });
  }

  return midi;
}
