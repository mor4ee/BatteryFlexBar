import { batteryDisplayStatus, batteryTitle, type BatteryMonitorState } from '../core/battery-state';
import type { V1BatteryKey } from './battery-runtime';
import { STATUS_ICON_FONT, UNAVAILABLE_GLYPH } from '../core/battery-icons';
import { chargingTitlePosition } from './charging-title-layout';

export const UNAVAILABLE_ICON = 'mdi mdi-power-plug-off';

/** Transient native draw state. Never persist these overrides into a user's style. */
export function batteryDrawKey(key: V1BatteryKey, state: BatteryMonitorState): V1BatteryKey {
  const title = batteryTitle(state);
  const status = batteryDisplayStatus(state);
  const style = { ...key.style };
  const rendered = { ...key, title, style };
  if (status !== 'charging' && status !== 'unavailable') return rendered;

  if (status === 'charging') {
    // The host loads MDI before drawing the native title. Its fallback supplies
    // only the lightning glyph; the user's font draws the digits. Native canvas
    // handles color, rotation and size for the whole title. Compensate for the
    // changed suffix width so centering does not move the digits themselves.
    const titlePos = chargingTitlePosition(style, String(state.snapshot?.battery.percent));
    if (titlePos) style.titlePos = titlePos;
    const titleFont = typeof style.font === 'string' && style.font.trim()
      ? style.font.trim() : 'sans-serif';
    style.font = `${titleFont}, "${STATUS_ICON_FONT}"`;
    return rendered;
  }

  // Replace only the native title, not the user's separate icon/emoji/image.
  // The title's size, position, rotation, color and visibility remain host-owned.
  // Explicit MDI avoids missing/private-use glyphs in the selected digit font.
  rendered.title = UNAVAILABLE_GLYPH;
  style.font = `"${STATUS_ICON_FONT}"`;
  return rendered;
}
