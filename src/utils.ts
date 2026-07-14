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

  if (typeof numbers === 'number') {
    const scaledValue = (numbers - min) * scaleFactor + targetMin;
    return Math.max(targetMin, Math.min(targetMax, scaledValue));
  }

  for (let i = 0; i < numbers.length; i++) {
    const scaledValue = (numbers[i] - min) * scaleFactor + targetMin;
    numbers[i] = Math.max(targetMin, Math.min(targetMax, scaledValue));
  }

  return numbers;
}

export function midiNote(note: number, octave: number): number {
  return note + octave * 12;
}

export function downloadFile(
  contents: Uint8Array<ArrayBuffer>,
  filename: string,
  mimeType: string,
) {
  const blob = new File([contents], filename, { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export { scale };
