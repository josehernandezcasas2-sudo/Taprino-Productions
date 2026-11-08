// Placeholder pictures for the rig: posters, stills and video frames drawn
// from an SVG with sharp (the app's own dependency) when it is there, else
// a tiny fixed JPEG so callers that sniff for JPEG still get one.
import { createRequire } from 'node:module';
import path from 'node:path';
import { REPO_DIR } from './config.mjs';

let sharp = null;
try {
  sharp = createRequire(path.join(REPO_DIR, 'package.json'))('sharp');
} catch (err) {
  sharp = null;
}

// 1×1 grey JPEG.
const TINY_JPEG = Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==', 'base64');

const esc = (s) => String(s).replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[c]));

function hue(text) {
  let h = 0;
  for (const ch of String(text)) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
}

export function svgCard({ width, height, title, kicker = 'STUDIO TAPA RIG' }) {
  const h = hue(title);
  const size = Math.round(Math.min(width, height) / 9);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${h},55%,28%)"/><stop offset="1" stop-color="hsl(${(h + 40) % 360},60%,12%)"/></linearGradient></defs>
  <rect width="100%" height="100%" fill="url(#g)"/>
  <text x="50%" y="${Math.round(height * 0.12)}" fill="#ff8c42" font-family="monospace" font-size="${Math.round(size * 0.45)}" text-anchor="middle">${esc(kicker)}</text>
  <text x="50%" y="52%" fill="#ffffff" font-family="sans-serif" font-weight="700" font-size="${size}" text-anchor="middle">${esc(title)}</text>
</svg>`;
}

export async function jpegCard(opts) {
  if (!sharp) return TINY_JPEG;
  try {
    return await sharp(Buffer.from(svgCard(opts))).jpeg({ quality: 70 }).toBuffer();
  } catch (err) {
    return TINY_JPEG;
  }
}

export const hasSharp = () => Boolean(sharp);
