/**
 * @module 8va.ts
 * Automatically adds 8vas for really high/low notes to improve readability.
 */

import { constants } from "../constants";
import { textOf } from "./elements";

/** The highest note that is still comfortable to read on the treble staff. */
const DEFAULT_HIGHEST = "F6";
/** The lowest note that is still comfortable to read on the bass staff. */
const DEFAULT_LOWEST = "A1";

export interface OctaveShiftOptions {
  /** Anything strictly above this pitch is printed under an 8va. Defaults to `F6`. */
  highest?: string;
  /** Anything strictly below this pitch is printed under an 8vb. Defaults to `A1`. */
  lowest?: string;
  /**
   * Measure numbers that opt out of bridging two shifts over a single in-range note. A note in
   * one of these measures keeps the shifts on either side of it apart.
   */
  noMerge?: (number | string)[];
}

/**
 * Wraps the runs of notes that sit too far outside the staff in octave shifts, so that they are
 * printed an octave closer to the staff instead of on a pile of ledger lines.
 *
 * `<pitch>` always spells the sounding pitch in MusicXML, so the notes themselves are left
 * alone; only the `<direction>` elements marking the shift are added.
 *
 * Runs are collected per staff and voice. A rest inside a run keeps the shift going rather than
 * chopping it in two, and a chord only counts when every one of its members is out of range,
 * because half a chord cannot be shifted on its own. A run of a single note is left unshifted,
 * and notes the template already covers with an octave shift are left to the template.
 *
 * @returns How many shifts were added.
 */
export function addOctaveShifts(composition: Document, options: OctaveShiftOptions = {}): number {
  const highest = parsePitch(options.highest ?? DEFAULT_HIGHEST);
  const lowest = parsePitch(options.lowest ?? DEFAULT_LOWEST);
  const noMerge = new Set((options.noMerge ?? []).map(String));

  let added = 0;

  for (const part of Array.from(composition.getElementsByTagName("part"))) {
    const streams = collectEvents(part);
    const numbers = allocateNumbers(part, streams.size);
    let stream = 0;

    for (const events of streams.values()) {
      const number = numbers[stream++];

      for (const run of collectRuns(events, highest, lowest, noMerge)) {
        addShift(events, run, number);
        added++;
      }
    }
  }

  return added;
}

/** MusicXML only allows `number` 1 to 8 on a spanner. */
const MAX_SHIFT_NUMBER = 8;

/**
 * Picks a `number` for each stream of a part. A `number` is what pairs a shift's start with its
 * stop, so two shifts that overlap in time have to differ: a start that reuses the number of a
 * shift still open re-anchors it, and the pair collapses into a bracket that moves no notes.
 *
 * One stream can never overlap itself, so a number per stream is enough. The numbers the part
 * already uses are left alone, since the template's own shifts can run under ours.
 */
function allocateNumbers(part: Element, count: number): number[] {
  const taken = new Set(
    Array.from(part.getElementsByTagName("octave-shift"), (shift) =>
      Number(shift.getAttribute("number") ?? 1),
    ),
  );

  const free: number[] = [];
  for (let number = 1; number <= MAX_SHIFT_NUMBER; number++) {
    if (!taken.has(number)) free.push(number);
  }

  // With more streams than numbers to go around the tail has to share, which is still better
  // than dropping the shifts. Parts with that many voices in the extreme registers do not
  // really happen here.
  if (free.length === 0) free.push(1);

  return Array.from({ length: count }, (_, stream) => free[stream % free.length]);
}

/** One rhythmic slot: a note plus the chord members hanging off it. */
interface NoteEvent {
  /** The principal note first, then its chord members. */
  notes: Element[];
  staff: string;
  voice: string;
  /** The lowest and highest sounding pitches of the slot, or null when it is a rest. */
  range: [low: number, high: number] | null;
  /** Whether the template already puts this slot under an octave shift. */
  covered: boolean;
  /** The `number` of the measure the slot is written in. */
  measure: string;
}

/**
 * Splits a part's notes into slots, keyed by the staff and voice they belong to. Runs are only
 * looked for within one such stream, because notes of different voices overlap in time and a
 * shift can only cover a stretch of one line.
 */
function collectEvents(part: Element): Map<string, NoteEvent[]> {
  const streams = new Map<string, NoteEvent[]>();
  /** The staves the template currently has an octave shift open on. */
  const openShifts = new Set<string>();
  let previous: NoteEvent | null = null;

  for (const measure of Array.from(part.getElementsByTagName("measure"))) {
    const measureNumber = measure.getAttribute("number") ?? "";

    for (const element of Array.from(measure.children)) {
      if (element.tagName === "direction") {
        const shift = element.getElementsByTagName("octave-shift")[0];
        if (!shift) continue;

        const staff = textOf(element, "staff") ?? "1";
        if (shift.getAttribute("type") === "stop") openShifts.delete(staff);
        else openShifts.add(staff);
        continue;
      }

      if (element.tagName !== "note") continue;

      // A chord member shares the slot of the note it follows, and inherits its staff and voice.
      if (previous && element.getElementsByTagName("chord").length > 0) {
        previous.notes.push(element);
        previous.range = widen(previous.range, pitchOf(element));
        continue;
      }

      const staff = textOf(element, "staff") ?? "1";
      const voice = textOf(element, "voice") ?? "1";
      const event: NoteEvent = {
        notes: [element],
        staff,
        voice,
        range: widen(null, pitchOf(element)),
        covered: openShifts.has(staff),
        measure: measureNumber,
      };

      const key = `${staff}/${voice}`;
      const stream = streams.get(key);
      if (stream) stream.push(event);
      else streams.set(key, [event]);

      previous = event;
    }
  }

  return streams;
}

interface Run {
  direction: "up" | "down";
  /** The first and last slot of the stream the shift covers, both inclusive. */
  start: number;
  end: number;
}

/** The stretches of one stream that should be printed an octave closer to the staff. */
function collectRuns(
  events: NoteEvent[],
  highest: number,
  lowest: number,
  noMerge: Set<string>,
): Run[] {
  const runs: Run[] = [];
  let current: Run | null = null;

  const flush = () => {
    if (!current) return;

    // Trailing rests were only absorbed in the hope that the run carried on past them, so they
    // are handed back rather than left dangling under the shift.
    while (current.end > current.start && events[current.end].range === null) current.end--;

    // A shift over a single note is more clutter than the ledger lines it saves, so it is
    // dropped. A chord counts as the one note it is printed as.
    if (countNotes(events, current.start, current.end) > 1) runs.push(current);
    current = null;
  };

  for (let index = 0; index < events.length; index++) {
    const event = events[index];
    const direction = classify(event, highest, lowest);

    if (current) {
      // A rest is not out of range itself, but breaking the shift around it would only add
      // clutter, so the run reaches over it.
      if (
        direction === current.direction ||
        (direction === null && !event.covered && !event.range)
      ) {
        current.end = index;
        continue;
      }

      flush();
    }

    if (direction) current = { direction, start: index, end: index };
  }

  flush();

  return joinRuns(events, runs, noMerge);
}

/**
 * Merges the shifts that only a single note keeps apart. Stopping and restarting around one note
 * reads worse than carrying the shift over it, even though that note was in range on its own.
 *
 * The runs are already the short ones removed, so a note between two of them was surrounded by
 * enough music to be worth bridging. A note the template already shifts is never swallowed, and
 * neither is one written in a measure the template lists under `noMerge`.
 */
function joinRuns(events: NoteEvent[], runs: Run[], noMerge: Set<string>): Run[] {
  const joined: Run[] = [];

  for (const run of runs) {
    const previous = joined[joined.length - 1];

    if (previous && previous.direction === run.direction) {
      const gap = events.slice(previous.end + 1, run.start);

      if (
        gap.filter((event) => event.range !== null).length === 1 &&
        !gap.some((event) => event.covered || noMerge.has(event.measure))
      ) {
        previous.end = run.end;
        continue;
      }
    }

    joined.push(run);
  }

  return joined;
}

/** How many of the slots from `start` to `end`, both inclusive, sound rather than rest. */
function countNotes(events: NoteEvent[], start: number, end: number): number {
  let count = 0;
  for (let index = start; index <= end; index++) {
    if (events[index].range !== null) count++;
  }
  return count;
}

/**
 * Which way `event` has to be shifted to be readable, or null when it is in range, is a rest, or
 * is already covered by the template. A chord counts only when all of its members are out of
 * range, since the shift applies to the whole slot.
 */
function classify(event: NoteEvent, highest: number, lowest: number): "up" | "down" | null {
  if (event.covered || !event.range) return null;

  const [low, high] = event.range;

  // `down` shifts the printed notes down an octave from where they sound, which is an 8va.
  if (low > highest) return "down";
  if (high < lowest) return "up";
  return null;
}

/** Brackets `run` with the `<direction>` elements that start and stop its octave shift. */
function addShift(events: NoteEvent[], run: Run, number: number): void {
  const first = events[run.start];
  const last = events[run.end];
  const document = first.notes[0].ownerDocument;
  const placement = run.direction === "down" ? "above" : "below";

  const start = first.notes[0];
  start.parentNode!.insertBefore(
    createDirection(document, run.direction, placement, first, number),
    start,
  );

  // The stop belongs at the end of the last slot, which is just past its final chord member.
  const stop = last.notes[last.notes.length - 1];
  stop.parentNode!.insertBefore(
    createDirection(document, "stop", placement, last, number),
    stop.nextSibling,
  );
}

function createDirection(
  document: Document,
  type: "up" | "down" | "stop",
  placement: string,
  event: NoteEvent,
  number: number,
): Element {
  const direction = document.createElement("direction");
  direction.setAttribute("placement", placement);

  const directionType = document.createElement("direction-type");
  const shift = document.createElement("octave-shift");
  shift.setAttribute("type", type);
  shift.setAttribute("size", "8");
  shift.setAttribute("number", number.toString());
  directionType.appendChild(shift);
  direction.appendChild(directionType);

  // `<direction>` fixes the order of its children, so they are appended in it.
  appendText(direction, "voice", event.voice);
  appendText(direction, "staff", event.staff);

  return direction;
}

function appendText(parent: Element, tagName: string, text: string): void {
  const child = parent.ownerDocument.createElement(tagName);
  child.textContent = text;
  parent.appendChild(child);
}

/** The sounding pitch of a note in semitones, or null when it is a rest. */
function pitchOf(note: Element): number | null {
  const pitch = note.getElementsByTagName("pitch")[0];
  if (!pitch) return null;

  const step = constants.STANDARD_NOTE_NAMES.indexOf(textOf(pitch, "step") ?? "");
  const octave = Number(textOf(pitch, "octave"));

  if (step === -1 || !Number.isFinite(octave)) return null;

  return constants.C_MAJOR_SCALE[step] + Number(textOf(pitch, "alter") ?? 0) + octave * 12;
}

function widen(range: [number, number] | null, pitch: number | null): [number, number] | null {
  if (pitch === null) return range;
  if (!range) return [pitch, pitch];
  return [Math.min(range[0], pitch), Math.max(range[1], pitch)];
}

/** Parses a pitch such as `G6`, `Bb2` or `F#7` into semitones, matching `pitchOf`. */
function parsePitch(pitch: string): number {
  const match = /^([A-G])(#*|b*)(-?\d+)$/.exec(pitch.trim());
  if (!match) throw new Error(`[8va] "${pitch}" is not a pitch such as "G6" or "Bb2".`);

  const [, step, accidentals, octave] = match;
  const alter = accidentals.startsWith("b") ? -accidentals.length : accidentals.length;

  return (
    constants.C_MAJOR_SCALE[constants.STANDARD_NOTE_NAMES.indexOf(step)] + alter + +octave * 12
  );
}
