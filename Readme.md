# MemeLoop Agent UI for TiddlyWiki

`$:/plugins/linonetwo/memeloop-agent-ui` brings the shared MemeLoop React chat
surface to TiddlyWiki and TidGi Desktop through `tw-react`.

It provides a full chat view, a responsive sidebar tab, agent/model selectors,
localized light/dark and RTL presentation, timeline paging, and atomic
Tiddler drag-and-drop attachments. Browser files are streamed in bounded chunks
to the Desktop attachment store before a run is prepared.

## Use

Install the plugin with its required `$:/plugins/linonetwo/tw-react` dependency,
then transclude the full view or add a widget directly:

```tid
<$memeloopAgentChat agentId="your-agent-instance-id" mode="full" />
```

The host bridge is intentionally narrow: it requires TidGi Desktop's
`window.service.agentInstance`, agent definitions, provider APIs, and the
corresponding observables. In a plain browser wiki, the widget displays a
localized configuration error rather than attempting a missing privileged call.

## Development

```sh
pnpm install --frozen-lockfile
pnpm run check
pnpm run lint
pnpm run test:unit
pnpm run build
```

Run `pnpm run dev` for the local wiki and `pnpm run test:playwright` for its
browser smoke tests. The production plugin JSON is written to `dist/`.
