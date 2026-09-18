function uniformDist(min = 0, max = 1) {
  return {
    random(len: number) {
      return Array.from({ length: len }, () => Math.random() * (max - min) + min);
    },
  };
}

function multiply(arr: number[], factor: number): number[] {
  for (let i = arr.length - 1; i >= 0; i--) {
    arr[i] *= factor;
  }
  return arr;
}

function add(arr: number[], value: number): number[] {
  for (let i = arr.length - 1; i >= 0; i--) {
    arr[i] += value;
  }
  return arr;
}
