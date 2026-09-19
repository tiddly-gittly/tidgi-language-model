import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';

const archivePath = resolve(process.cwd(), 'dist/$__plugins_linonetwo_memeloop-agent-ui.json');
const nodeRequire = createRequire(import.meta.url);
const dom = new JSDOM('<!doctype html><html><body></body></html>');
const archive = JSON.parse(readFileSync(archivePath, 'utf8'));
const tiddlers = JSON.parse(archive.text).tiddlers;
const components = tiddlers['$:/plugins/linonetwo/memeloop-agent-ui/components.js']?.text;

if (typeof components !== 'string') {
  throw new Error('components.js was not emitted into the MemeLoop Agent UI plugin archive');
}
if (!/require\((['"])react\1\)/u.test(components)) {
  throw new Error('components.js must keep React as an external require');
}
// A few dependencies safely inspect the singleton dispatcher at runtime. These
// markers identify React's own bundled hook implementation instead of those
// consumers of the external singleton.
for (
  const embeddedReactMarker of [
    'Invalid hook call. Hooks can only be called inside of the body of a function component.',
    'function resolveDispatcher()',
    'ReactSharedInternals',
    'ReactCurrentOwner',
  ]
) {
  if (components.includes(embeddedReactMarker)) {
    throw new Error(`components.js embeds React internals (${embeddedReactMarker}) instead of sharing tw-react's singleton`);
  }
}

const module = { exports: {} };
try {
  runInNewContext(components, {
    AbortController,
    DOMException,
    HTMLElement: dom.window.HTMLElement,
    Intl,
    Map,
    Object,
    Promise,
    ReadableStream,
    Set,
    TextEncoder,
    TransformStream,
    Uint8Array,
    URL,
    WritableStream,
    console,
    document: dom.window.document,
    module,
    exports: module.exports,
    queueMicrotask,
    require(specifier) {
      if (specifier === '$:/plugins/linonetwo/tw-react/widget.js') {
        return { widget: class Widget {} };
      }
      if (specifier === 'react' || specifier === 'react/jsx-runtime' || specifier === 'react-dom' || specifier === 'react-dom/client') {
        return nodeRequire(specifier);
      }
      throw new Error(`Unexpected external module in components.js smoke test: ${specifier}`);
    },
    window: dom.window,
  }, { filename: 'components.js', timeout: 5_000 });
} catch (error) {
  throw new Error(`components.js smoke test failed: ${error instanceof Error ? error.message : String(error)}`);
}

if (typeof module.exports.MemeLoopAgentChatWidget !== 'function') {
  throw new Error('components.js smoke test did not expose MemeLoopAgentChatWidget');
}
