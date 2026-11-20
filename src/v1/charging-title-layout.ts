import type { SKRSContext2D } from '@napi-rs/canvas';

type Style = Record<string, unknown>;
type Position = { X: number; Y: number };
export type TitleWidth = (text: string, style: Style) => number;

let context: SKRSContext2D | null | undefined;
const widths = new Map<string, number>();

/** Measure only; drawing remains entirely in the native FlexDesigner renderer. */
export const measureTitleWidth: TitleWidth = (text, style) => {
  if (context === undefined) {
    try {
      // Documented built-in v1 module. Lazy loading keeps ordinary monitoring
      // independent of font measurement and avoids shipping a native addon.
      const { createCanvas } = require('@napi-rs/canvas') as typeof import('@napi-rs/canvas');
      context = createCanvas(1, 1).getContext('2d');
    } catch {
      context = null;
      console.warn('Battery: title measurement unavailable; using native title placement');
    }
  }
  if (!context) return NaN;
  // FlexDesigner's bundled "Consola" is the regular Consolas font, exposed
  // under a web-only alias. Canvas otherwise loads installed system/user fonts.
  const families = (String(style.font || '').trim() || 'sans-serif').split(',').map((family) => family.trim());
  const firstFamily = families[0].replace(/^["']|["']$/g, '').toLowerCase();
  // The other host-bundled text face has half-em ASCII advances. It isn't a
  // system font, but our numeric labels need no font file or glyph rasterizer.
  if (firstFamily === 'sourcehansanshwsc' && /^\d+%?$/.test(text)) {
    return text.length * Number(style.fontSize || 12) / 2;
  }
  const aliases: Record<string, string> = {
    consola: 'Consolas', 'sans-serif': 'Arial', serif: '"Times New Roman"', monospace: '"Courier New"'
  };
  const family = families.map((name) => aliases[name.replace(/^["']|["']$/g, '').toLowerCase()] || name).join(', ');
  const font = `${style.fontStyle || 'normal'} ${style.fontWeight || 'normal'} ${style.fontSize || 12}px ${family}`;
  const stretch = (style.fontStretch || 'normal') as SKRSContext2D['fontStretch'];
  const cacheKey = JSON.stringify([font, stretch, text]);
  const cached = widths.get(cacheKey);
  if (cached !== undefined) return cached;
  context.font = '12px Arial';
  context.font = font;
  context.fontStretch = stretch;
  const width = context.measureText(text).width;
  if (widths.size >= 256) widths.clear();
  widths.set(cacheKey, width);
  return width;
};

/** Keep the digits at the same native position as N%, despite a wider suffix. */
export function chargingTitlePosition(
  style: Style,
  digits: string,
  measure: TitleWidth = measureTitleWidth
): Position | undefined {
  const position = style.titlePos as Position | undefined;
  const width = style.width;
  if (!position || !Number.isFinite(position.X) || !Number.isFinite(position.Y)
    || typeof width !== 'number' || !Number.isFinite(width) || width <= 0
    || style.showTitle === false) return undefined;
  // The public v1 title API is centered. Private non-center host modes have
  // different layout semantics and are deliberately left untouched.
  if (style.titleAlign && style.titleAlign !== 'center') return undefined;

  const fontSize = typeof style.fontSize === 'number' && style.fontSize > 0 ? style.fontSize : 12;
  // MDI's lightning has exactly one em advance. Measuring the full N% title
  // minus N also includes any kerning at the original suffix boundary.
  const percentAdvance = measure(`${digits}%`, style) - measure(digits, style);
  const offset = (fontSize - percentAdvance) / 2;
  if (!Number.isFinite(offset)) return undefined;
  const angle = (typeof style.titleRotate === 'number' ? style.titleRotate : 0) * Math.PI / 180;
  if (!Number.isFinite(angle)) return undefined;
  return {
    X: position.X + offset * Math.cos(angle) * 100 / width,
    Y: position.Y + offset * Math.sin(angle) * 100 / 60
  };
}
