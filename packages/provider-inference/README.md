# Provider Inference

`@proj-airi/provider-inference` owns the runtime-neutral parts of the apps' providers: the provider definition
types, the generation protocols, the validators, and the Sherpaw transcription definition. The package runs in
Node.js and Browser runtimes.

Dahlia's apps talk only to Dahlia's server, so AIRI's catalog of third-party provider definitions (OpenAI,
Anthropic, ElevenLabs, VOICEVOX, Ollama and the others) is deleted. `portableProviderDefinitions` holds only
"no speech" (`speech-noop`). Dahlia's own chat provider lives in `stage-ui` (`libs/providers/providers/dahlia`).

Do not use this package for provider configuration persistence, Vue views, Pinia state or Electron-native
providers. Those concerns remain in `@proj-airi/stage-ui`.

## Use

```ts
import { getDefinedProvider, listProviders } from '@proj-airi/provider-inference'

const noSpeech = getDefinedProvider('speech-noop')
const providers = listProviders()
```

The root entry exports Sherpaw model presets and a definition factory. Vite plugins can use `@proj-airi/provider-inference/sherpaw-transcription/models` to load only model metadata. The presets include stable IDs, languages, recognizer types, pinned revisions, and artifact URLs. Neither entry downloads or loads model files.

`createSherpawTranscriptionDefinition` owns recognition, Worker cleanup, and the first model choice.
The host supplies exposed models, a Worker URL, a fetch function, and the current interface language.
The host also reports whether it runs on mobile. Chinese and English default to X-ASR on desktop and Paraformer on mobile.
`stage-ui` supplies these resources and adds the Hearing settings view.

## Verify

Run the package checks from the workspace root:

```text
pnpm -F @proj-airi/provider-inference typecheck
pnpm -F @proj-airi/provider-inference test:node
pnpm -F @proj-airi/provider-inference test:browser
pnpm -F @proj-airi/provider-inference build
```

## Generation protocols

A chat provider's configuration can accept `api: 'chat-completions' | 'responses'`. `compatibleProtocols` defaults
to `chat-completions`, `openAIProtocols` to `responses`. Saved protocol choices take precedence.

`ProviderDefinition` owns configuration and instance creation. `getGenerationProvider(instance)` adapts SDK Chat instances at that boundary.
`GenerationProvider.generation(model, options)` selects a protocol and returns its request configuration.
Core-agent receives this single interface and projects context directly into the selected protocol.
Protocol defaults and native tools remain provider-owned policy. The validation probe uses the selected protocol.
`generationProtocolDefinitions` owns the display metadata for every protocol.
Provider schemas use `generationProtocolOptions` to keep selector labels consistent.
Adding a protocol requires a request type and a matching metadata entry. TypeScript reports an incomplete registry or provider request switch.

Generation validation uses the configured model before consulting the endpoint model list.
