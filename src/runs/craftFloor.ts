// The craft floor every iteration keeps (ROUGHBOOK-METHODS-PLAN.md, D3), as the backend's
// utils/compile/craftFloor.ts checks it: the same rules, read from the files on this machine.
// Each slip is named once per file, with how often, and is a warning, never a failure. A
// template (markup.ts) is read as markup, with the CSS in its <style> blocks and style attributes.
import { MARKUP, MARKUP_ATTRS, markupClassLists } from './markup.js';
import type { Finding } from './types.js';

const CODE = /\.(tsx|jsx|ts|js|mjs)$/i;
const CSS = /\.css$/i;

const PLACEHOLDER =
  /\blorem ipsum\b|\bdolor sit amet\b|\b(?:John|Jane) (?:Doe|Smith)\b|\bYour (?:Company|Name)\b|\bCompany Name\b/i;
const TRANSITION_ALL_CODE = /\btransition-all\b|transition\s*:\s*['"]?all\b/g;
const TRANSITION_ALL_CSS = /transition\s*:\s*all\b/g;
/** A tag's attributes, stepping over {expressions} two levels deep, so `onClick={() => {}}` stays inside. */
const ATTRS = String.raw`(?:[^>{}]|\{(?:[^{}]|\{[^{}]*\})*\})*`;
const IMG = new RegExp(String.raw`<img\b${ATTRS}>`, 'g');
const ICON_BUTTON = new RegExp(
  String.raw`<button\b(${ATTRS})>\s*(?:<[A-Za-z][\w.]*\b${ATTRS}\/>\s*)+<\/button>`,
  'g'
);
const MARKUP_IMG = new RegExp(String.raw`<img\b${MARKUP_ATTRS}>`, 'g');
/** An icon in a template: a self-closing tag, an inline <svg>, Liquid's icon snippet or Blade's @svg. */
const MARKUP_ICON = [
  String.raw`<[A-Za-z][\w.]*\b${MARKUP_ATTRS}\/>`,
  String.raw`<svg\b${MARKUP_ATTRS}>(?:(?!<\/svg>|<\/?button\b)[\s\S])*<\/svg>`,
  String.raw`\{%-?\s*(?:render|include)\s+['"][^'"]*icon[^'"]*['"][^%]*%\}`,
  String.raw`@svg\((?:[^()]|\([^()]*\))*\)`
].join('|');
const MARKUP_ICON_BUTTON = new RegExp(
  String.raw`<button\b(${MARKUP_ATTRS})>\s*(?:(?:${MARKUP_ICON})\s*)+<\/button>`,
  'g'
);
/** A template's button is named on itself or inside: an svg's <title> or an icon's label. */
const MARKUP_NAMED = /\baria-label(?:ledby)?\s*=|\btitle\s*=|<title\b/;
const CLASS_NAME = /className\s*=\s*(?:"([^"]*)"|'([^']*)'|\{`([^`]*)`\})/g;
const OUTLINE_CSS = /outline\s*:\s*(?:none|0)\b/g;

const count = (text: string, pattern: RegExp) => [...text.matchAll(pattern)].length;
const times = (n: number) => (n === 1 ? '1 time' : `${n} times`);

function codeFindings(file: string, text: string, markup: boolean): Finding[] {
  const findings: Finding[] = [];
  if (PLACEHOLDER.test(text)) {
    findings.push({
      code: 'PLACEHOLDER_COPY',
      message: `${file} has placeholder copy, such as lorem ipsum or a stand-in name like Jane Doe.`
    });
  }
  const transitions = count(text, TRANSITION_ALL_CODE);
  if (transitions) {
    findings.push({
      code: 'TRANSITION_ALL',
      message: `${file} transitions every property ${times(transitions)} (transition-all or transition: all); name the properties instead.`
    });
  }
  const images = [...text.matchAll(markup ? MARKUP_IMG : IMG)].filter(
    match => !/\balt\s*=/.test(match[0])
  ).length;
  if (images) {
    findings.push({
      code: 'IMG_WITHOUT_ALT',
      message: `${file} has ${images} img without alt text.`
    });
  }
  const buttons = markup
    ? [...text.matchAll(MARKUP_ICON_BUTTON)].filter(match => !MARKUP_NAMED.test(match[0])).length
    : [...text.matchAll(ICON_BUTTON)].filter(
        match => !/\baria-label(?:ledby)?\s*=|\btitle\s*=/.test(match[1] ?? '')
      ).length;
  if (buttons) {
    findings.push({
      code: 'ICON_BUTTON_UNNAMED',
      message: `${file} has ${buttons} icon-only button without an accessible name.`
    });
  }
  const classLists = markup
    ? markupClassLists(text)
    : [...text.matchAll(CLASS_NAME)].map(match => match[1] ?? match[2] ?? match[3] ?? '');
  const outlines =
    classLists.filter(
      classes =>
        /(?:^|\s)(?:focus:)?outline-none(?:\s|$)/.test(classes) &&
        !classes.includes('focus-visible:')
    ).length + (markup && !text.includes(':focus-visible') ? count(text, OUTLINE_CSS) : 0);
  if (outlines) {
    findings.push({
      code: 'OUTLINE_WITHOUT_FOCUS',
      message: `${file} removes the focus outline ${times(outlines)} without a focus-visible style.`
    });
  }
  return findings;
}

function cssFindings(file: string, text: string): Finding[] {
  const findings: Finding[] = [];
  const transitions = count(text, TRANSITION_ALL_CSS);
  if (transitions) {
    findings.push({
      code: 'TRANSITION_ALL',
      message: `${file} transitions every property ${times(transitions)} (transition-all or transition: all); name the properties instead.`
    });
  }
  const outlines = count(text, OUTLINE_CSS);
  if (outlines && !text.includes(':focus-visible')) {
    findings.push({
      code: 'OUTLINE_WITHOUT_FOCUS',
      message: `${file} removes the focus outline ${times(outlines)} without a focus-visible style.`
    });
  }
  return findings;
}

/** The craft floor's warnings for an iteration's files, file by file in the order given. */
export function craftFloorFindings(files: Map<string, string>): Finding[] {
  const findings: Finding[] = [];
  for (const [file, text] of files) {
    if (CODE.test(file)) findings.push(...codeFindings(file, text, false));
    else if (MARKUP.test(file)) findings.push(...codeFindings(file, text, true));
    else if (CSS.test(file)) findings.push(...cssFindings(file, text));
  }
  return findings;
}
