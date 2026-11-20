import assert from 'node:assert/strict';
import test from 'node:test';
import {
  chargingTitlePosition,
  measureTitleWidth,
  type TitleWidth
} from '../../src/v1/charging-title-layout';

type Position = { X: number; Y: number };

// Model the native centered text transform, independently of the compensation.
function firstDigitOrigin(position: Position, keyWidth: number, textWidth: number, angle: number): Position {
  const radians = angle * Math.PI / 180;
  return {
    X: (position.X - 1) * keyWidth / 100 - textWidth / 2 * Math.cos(radians),
    Y: position.Y * 60 / 100 - textWidth / 2 * Math.sin(radians)
  };
}

function assertSamePoint(actual: Position, expected: Position): void {
  assert.ok(Math.abs(actual.X - expected.X) < 1e-9, `X moved: ${expected.X} -> ${actual.X}`);
  assert.ok(Math.abs(actual.Y - expected.Y) < 1e-9, `Y moved: ${expected.Y} -> ${actual.Y}`);
}

test('charging keeps the digit origin fixed across values, key widths, rotations and suffix advances', () => {
  const digitWidths: Record<string, number> = { '0': 13, '45': 35, '100': 47 };
  for (const digits of ['0', '45', '100']) {
    for (const width of [60, 90, 120, 180]) {
      for (const angle of [0, 35, 90, -45]) {
        // Includes a percent wider than the bolt and a kerning-adjusted suffix.
        for (const percentAdvance of [7, 19.25, 35]) {
          const style = {
            width, fontSize: 28, font: 'Test font', titleRotate: angle,
            titlePos: { X: 63, Y: 47 }, showTitle: true
          };
          const original = structuredClone(style);
          const measure: TitleWidth = (text) => {
            if (text === digits) return digitWidths[digits];
            if (text === `${digits}%`) return digitWidths[digits] + percentAdvance;
            throw new Error(`Unexpected measurement: ${text}`);
          };
          const position = chargingTitlePosition(style, digits, measure);
          assert.ok(position);
          const normalOrigin = firstDigitOrigin(original.titlePos, width, digitWidths[digits] + percentAdvance, angle);
          const chargingOrigin = firstDigitOrigin(position, width, digitWidths[digits] + 28, angle);
          assertSamePoint(chargingOrigin, normalOrigin);
          assert.notStrictEqual(position, style.titlePos);
          assert.deepEqual(style, original);
          assert.deepEqual(chargingTitlePosition(style, digits, measure), position);
        }
      }
    }
  }
});

test('missing or invalid geometry and hidden text do not request a layout compensation', () => {
  const base = { width: 120, fontSize: 28, titlePos: { X: 50, Y: 50 } };
  const invalidStyles: Record<string, unknown>[] = [
    {}, { ...base, titlePos: undefined }, { ...base, titlePos: null },
    { ...base, titlePos: { X: NaN, Y: 50 } },
    { ...base, titlePos: { X: 50, Y: Infinity } },
    { ...base, titlePos: { X: '50', Y: 50 } },
    { ...base, width: undefined }, { ...base, width: '120' },
    { ...base, width: 0 }, { ...base, width: -60 },
    { ...base, width: NaN }, { ...base, width: Infinity },
    { ...base, showTitle: false }
  ];
  for (const style of invalidStyles) {
    const original = structuredClone(style);
    assert.equal(chargingTitlePosition(style, '45', () => {
      throw new Error('Invalid or hidden geometry should not need font measurement');
    }), undefined);
    assert.deepEqual(style, original);
  }
});

test('unavailable measurements, invalid angles and private non-center alignment preserve native placement', () => {
  const base = { width: 120, fontSize: 28, titlePos: { X: 50, Y: 50 } };
  for (const measure of [() => NaN, () => Infinity]) {
    assert.equal(chargingTitlePosition(base, '45', measure), undefined);
  }
  for (const titleRotate of [NaN, Infinity, -Infinity]) {
    assert.equal(chargingTitlePosition({ ...base, titleRotate }, '45', (text) => text.length * 12), undefined);
  }
  for (const titleAlign of ['left', 'right', 'start', 'end']) {
    assert.equal(chargingTitlePosition({ ...base, titleAlign }, '45', () => {
      throw new Error('Private alignment modes must not be measured');
    }), undefined);
  }
});

test('real canvas produces finite title measurements and preserves native digit origins', () => {
  for (const font of ['Arial', 'Consolas', 'Courier New']) {
    for (const digits of ['0', '45', '100']) {
      const style = { width: 120, fontSize: 28, font, titlePos: { X: 63, Y: 47 }, titleRotate: 35 };
      const normalWidth = measureTitleWidth(`${digits}%`, style);
      const digitWidth = measureTitleWidth(digits, style);
      assert.ok(Number.isFinite(normalWidth) && normalWidth > digitWidth);
      assert.ok(Number.isFinite(digitWidth) && digitWidth > 0);
      const position = chargingTitlePosition(style, digits);
      assert.ok(position);
      assertSamePoint(
        firstDigitOrigin(position, style.width, digitWidth + style.fontSize, style.titleRotate),
        firstDigitOrigin(style.titlePos, style.width, normalWidth, style.titleRotate)
      );
    }
  }
});

test('font measurement honors host aliases and generic browser font families', () => {
  const style = { fontSize: 28 };
  for (const [alias, explicit] of [
    ['Consola', 'Consolas'], ['sans-serif', 'Arial'],
    ['serif', 'Times New Roman'], ['monospace', 'Courier New']
  ]) {
    assert.equal(
      measureTitleWidth('45%', { ...style, font: alias }),
      measureTitleWidth('45%', { ...style, font: explicit }),
      `${alias} must use ${explicit} metrics`
    );
  }
});

test('the bundled SourceHanSansHWSC uses half-em ASCII widths without a system font dependency', () => {
  for (const fontSize of [12, 28, 37]) {
    for (const text of ['0', '45', '100', '0%', '45%', '100%']) {
      assert.equal(measureTitleWidth(text, { font: 'SourceHanSansHWSC', fontSize }), text.length * fontSize / 2);
    }
  }
});
