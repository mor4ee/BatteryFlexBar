// Public FlexCLI 1.0.7 uses a legacy JSON assertion in the pack entry point.
// Normalize just that import in memory for supported Node releases.
import { registerHooks } from 'node:module';
const packUrl = import.meta.resolve('@eniac/flexcli/src/commands/pack.js');

registerHooks({
  load(url, context, next) {
    const loaded = next(url, context);
    if (url !== packUrl) return loaded;
    return {
      ...loaded,
      source: Buffer.from(loaded.source).toString().replace(
        "from '../assets/manifest_schema.json' assert",
        "from '../assets/manifest_schema.json' with"
      )
    };
  }
});

await import('@eniac/flexcli/src/index.js');
