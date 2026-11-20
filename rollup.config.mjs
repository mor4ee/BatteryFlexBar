import commonjs from '@rollup/plugin-commonjs';
import json from '@rollup/plugin-json';
import nodeResolve from '@rollup/plugin-node-resolve';
import { copyFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const pluginDirectory = 'com.mor4ee.battery.plugin';
const nativeOutput = path.join(pluginDirectory, 'native', 'windows');

export default {
  input: '.v1-build/v1/plugin.js',
  external: ['@napi-rs/canvas'],
  output: {
    file: `${pluginDirectory}/backend/plugin.cjs`,
    format: 'cjs'
  },
  plugins: [
    json(),
    nodeResolve({ browser: false, exportConditions: ['node'], preferBuiltins: true }),
    commonjs(),
    {
      name: 'copy-windows-helper',
      writeBundle() {
        mkdirSync(nativeOutput, { recursive: true });
        for (const file of [
          'BatteryHidHelper.exe',
          'HidSharp.dll',
          'HidSharp.LICENSE.txt'
        ]) {
          copyFileSync(path.join('native', 'bin', file), path.join(nativeOutput, file));
        }
      }
    }
  ]
};
