import WebMscore from "webmscore";

export async function renderPdfFromXML(xml: string) {
  await WebMscore.ready;
  const score = await WebMscore.load("xml", new TextEncoder().encode(xml));
  return (await score.savePdf()) as Uint8Array<ArrayBuffer>;
}
