/// <reference types="bun" />
import { stripDefaultXY } from './src/music/musicxml';
const text = await Bun.file('./test.musicxml').text();

function stripUnnecessaryAttributes(xml: string) {
  return xml
    .replace(/width="[^"]*"/g, '')
    .replace(/height="[^"]*"/g, '')
    .replace(/default-x="[^"]*"/g, '')
    .replace(/default-y="[^"]*"/g, '')
    .replace(/color="[^"]*"/g, '')
    .replace(/font-family="[^"]*"/g, '')
    .replace(/[ ]+\>/g, '>');
}

const stripped = stripUnnecessaryAttributes(text);

await Bun.write('./test-stripped.musicxml', stripped);
