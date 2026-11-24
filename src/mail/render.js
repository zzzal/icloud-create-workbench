import { parseDocument } from "htmlparser2";

const elements = new Set("a abbr address b blockquote br caption center code col colgroup dd del div dl dt em font h1 h2 h3 h4 h5 h6 hr i img ins li ol p pre s section small span strong sub sup table tbody td tfoot th thead tr u ul".split(" "));
const voidElements = new Set(["br", "col", "hr", "img"]);
const hiddenElements = new Set(["head", "script", "style", "iframe", "object", "template", "textarea", "noscript", "svg", "math"]);
const inlineImage = /^data:image\/(?:png|jpeg|gif|webp);base64,[a-z0-9+/=\s]+$/i;
const color = /^(?:#[a-f0-9]{3,8}|[a-z]{3,24}|rgba?\([0-9.,%\s]+\))$/i;
const size = /^(?:auto|0|\d{1,4}(?:\.\d{1,2})?(?:px|pt|em|rem|%))$/i;
const alignment = /^(?:left|right|center|justify|start|end)$/i;
const font = /^[\p{L}\p{N}\s,'"-]{1,120}$/u;
const spacing = /^(?:0|\d{1,3}(?:\.\d{1,2})?(?:px|pt|em|rem|%))(?:\s+(?:0|\d{1,3}(?:\.\d{1,2})?(?:px|pt|em|rem|%))){0,3}$/i;

const styles = new Map([
  ["background", color], ["background-color", color], ["color", color], ["border-color", color],
  ["width", size], ["max-width", size], ["border-width", size], ["border-radius", size], ["font-size", size],
  ["font-family", font], ["line-height", /^(?:normal|\d{1,3}(?:\.\d{1,2})?(?:px|pt|em|rem|%)?)$/i],
  ["font-style", /^(?:normal|italic|oblique)$/i], ["font-weight", /^(?:normal|bold|[1-9]00)$/i],
  ["margin", spacing], ["margin-top", size], ["margin-bottom", size],
  ["padding", spacing], ["padding-top", size], ["padding-bottom", size],
  ["text-align", alignment], ["vertical-align", /^(?:top|middle|bottom|baseline)$/i],
  ["text-decoration", /^(?:none|underline|line-through)$/i],
  ["border-style", /^(?:none|solid|dashed|dotted)$/i], ["border-collapse", /^(?:collapse|separate)$/i]
]);

const tableElements = new Set(["table", "tr", "td", "th", "col", "colgroup"]);
const tableAttributes = new Map([
  ["width", /^\d{1,4}%?$/], ["height", /^\d{1,4}$/], ["bgcolor", color],
  ["border", /^\d{1,2}$/], ["cellpadding", /^\d{1,2}$/], ["cellspacing", /^\d{1,2}$/],
  ["colspan", /^[1-9]\d?$/], ["rowspan", /^[1-9]\d?$/]
]);

const escapeHtml = value => value.replace(/[&<>"']/g, character =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]
);

function inlineStyles(value = "") {
  const result = [];
  for (const declaration of value.split(";")) {
    const colon = declaration.indexOf(":");
    if (colon < 0) continue;
    const property = declaration.slice(0, colon).trim().toLowerCase();
    const setting = declaration.slice(colon + 1).replace(/\s*!important\s*$/i, "").trim();
    if (styles.get(property)?.test(setting)) result.push(`${property}:${setting}`);
  }
  return result.join(";");
}

function attributes(tag, input) {
  const safe = {};
  const style = inlineStyles(input.style);
  if (style) safe.style = style;
  if (alignment.test(input.align)) safe.align = input.align;
  if (/^(?:ltr|rtl|auto)$/i.test(input.dir)) safe.dir = input.dir;
  if (input.title) safe.title = input.title;
  if (tag === "img") {
    safe.src = input.src.replace(/\s/g, "");
    safe.alt = input.alt || "";
    if (/^\d{1,4}$/.test(input.width)) safe.width = input.width;
    if (/^\d{1,4}$/.test(input.height)) safe.height = input.height;
  }
  if (tag === "font") {
    if (input.color && color.test(input.color)) safe.color = input.color;
    if (input.face && font.test(input.face)) safe.face = input.face;
    if (/^[1-7]$/.test(input.size)) safe.size = input.size;
  }
  if (tableElements.has(tag)) {
    for (const [name, rule] of tableAttributes) {
      if (input[name] && rule.test(input[name])) safe[name] = input[name];
    }
  }
  return Object.entries(safe).map(([name, value]) => ` ${name}="${escapeHtml(value)}"`).join("");
}

function render(node, depth) {
  if (depth > 80 || hiddenElements.has(node.name)) return "";
  if (node.type === "text") return escapeHtml(node.data);
  if (node.name === "img" && !inlineImage.test(node.attribs.src || "")) return escapeHtml(node.attribs.alt || "");
  const children = (node.children || []).map(child => render(child, depth + 1)).join("");
  if (!elements.has(node.name)) return children;
  const start = `<${node.name}${attributes(node.name, node.attribs)}>`;
  return voidElements.has(node.name) ? start : `${start}${children}</${node.name}>`;
}

export function renderMailHtml(html) {
  return html ? render(parseDocument(html), 0).trim() : "";
}
