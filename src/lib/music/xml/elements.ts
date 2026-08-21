// Small helpers for editing the MusicXML tree. MusicXML fixes the order of a `<note>`'s
// children, so anything that creates one has to insert it in the right place rather than just
// appending it.

/** The order MusicXML requires for the children of `<note>`. */
export const NOTE_CHILD_ORDER = [
  "grace",
  "chord",
  "pitch",
  "unpitched",
  "rest",
  "duration",
  "tie",
  "instrument",
  "footnote",
  "level",
  "voice",
  "type",
  "dot",
  "accidental",
  "time-modification",
  "stem",
  "notehead",
  "notehead-text",
  "staff",
  "beam",
  "notations",
  "lyric",
  "play",
] as const;

/** The text of the first `tagName` descendant, or null if there is none. */
export function textOf(parent: Element | null | undefined, tagName: string): string | null {
  return parent?.getElementsByTagName(tagName)[0]?.textContent ?? null;
}

export function removeChildren(parent: Element, tagName: string): void {
  for (const child of Array.from(parent.getElementsByTagName(tagName))) child.remove();
}

/**
 * Adds `child` to `parent` before the first existing child that has to come after it. Tags
 * missing from `order` sort to the front, which keeps unexpected markup where it already was.
 */
export function insertOrdered(parent: Element, child: Element, order: readonly string[]): void {
  const position = order.indexOf(child.tagName);
  const successor = Array.from(parent.children).find(
    (existing) => order.indexOf(existing.tagName) > position,
  );

  if (successor) parent.insertBefore(child, successor);
  else parent.appendChild(child);
}

/** Sets the text of `parent`'s first `tagName` child, creating the child if it is missing. */
export function setChildText(
  parent: Element,
  tagName: string,
  text: string,
  order?: readonly string[],
): Element {
  let child = parent.getElementsByTagName(tagName)[0];

  if (!child) {
    child = parent.ownerDocument.createElement(tagName);
    if (order) insertOrdered(parent, child, order);
    else parent.appendChild(child);
  }

  child.textContent = text;
  return child;
}

export function isRest(note: Element): boolean {
  return note.getElementsByTagName("rest").length > 0;
}
