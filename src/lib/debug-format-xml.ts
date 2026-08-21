export default function formatXml(xmlString: string) {
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(xmlString, "text/xml");

  // Check for parsing errors
  const parserError = xmlDoc.getElementsByTagName("parsererror");
  if (parserError.length) {
    throw new Error("Invalid XML structure");
  }

  // Format by recursively processing nodes
  return formatNode(xmlDoc.documentElement, 0);
}

function formatNode(node: Element, level: number) {
  const indent = "  ".repeat(level);
  let result = `${indent}<${node.nodeName}`;

  // Append attributes
  for (let attr of node.attributes) {
    result += ` ${attr.name}="${attr.value}"`;
  }

  if (node.childNodes.length === 0) {
    return `${result} />\n`;
  }

  result += ">";

  // Handle child text or child elements
  if (node.childNodes.length === 1 && node.childNodes[0].nodeType === Node.TEXT_NODE) {
    result += `${node.childNodes[0].nodeValue}</${node.nodeName}>\n`;
  } else {
    result += "\n";
    for (let child of node.children) {
      if (child.nodeType === Node.ELEMENT_NODE) {
        result += formatNode(child, level + 1);
      }
    }
    result += `${indent}</${node.nodeName}>\n`;
  }

  return result;
}
