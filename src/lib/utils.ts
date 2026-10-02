import type { Hsva } from "./types";

function scale(
  min: number,
  max: number,
  targetMin: number,
  targetMax: number,
  numbers: number[],
): number[];

function scale(
  min: number,
  max: number,
  targetMin: number,
  targetMax: number,
  number: number,
): number;

function scale(
  min: number,
  max: number,
  targetMin: number,
  targetMax: number,
  numbers: number[] | number,
) {
  const scaleFactor = (targetMax - targetMin) / (max - min);

  if (typeof numbers === "number") {
    const scaledValue = (numbers - min) * scaleFactor + targetMin;
    return Math.max(targetMin, Math.min(targetMax, scaledValue));
  }

  for (let i = 0; i < numbers.length; i++) {
    const scaledValue = (numbers[i] - min) * scaleFactor + targetMin;
    numbers[i] = Math.max(targetMin, Math.min(targetMax, scaledValue));
  }

  return numbers;
}

/**
 * HSV → a packed 0xRRGGBB integer, the form Pixi's `color` options take.
 * Hue wraps, so callers are free to walk it past 360 or below 0.
 */
function hsvToHex({ h, s, v }: Hsva): number {
  const hue = (((h % 360) + 360) % 360) / 60;
  const chroma = clamp01(v) * clamp01(s);
  const second = chroma * (1 - Math.abs((hue % 2) - 1));
  const match = clamp01(v) - chroma;

  const [r, g, b] = (
    [
      [chroma, second, 0],
      [second, chroma, 0],
      [0, chroma, second],
      [0, second, chroma],
      [second, 0, chroma],
      [chroma, 0, second],
    ] as const
  )[Math.floor(hue) % 6];

  const byte = (channel: number) => Math.round((channel + match) * 255);
  return (byte(r) << 16) | (byte(g) << 8) | byte(b);
}

function clamp01(v: number) {
  return Math.max(0, Math.min(1, v));
}

function midiNote(note: number, octave: number): number {
  return note + octave * 12;
}

function downloadFile(contents: Uint8Array<ArrayBuffer>, filename: string, mimeType: string) {
  const blob = new File([contents], filename, { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function waitForImageToLoad(image: HTMLImageElement, src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    image.onload = () => {
      resolve();
    };

    image.onerror = () => reject(new Error("Failed to load image"));

    image.src = src;
  });
}

function findNearest(value: number, array: number[]): number {
  let nearest = array[0];
  let minDiff = Math.abs(value - array[0]);

  for (let i = 1; i < array.length; i++) {
    const diff = Math.abs(value - array[i]);
    if (diff < minDiff) {
      minDiff = diff;
      nearest = array[i];
    }
  }

  return nearest;
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.statusText}`);
  }

  return await response.text();
}

export { scale, downloadFile, hsvToHex, midiNote, waitForImageToLoad, findNearest, fetchText };
