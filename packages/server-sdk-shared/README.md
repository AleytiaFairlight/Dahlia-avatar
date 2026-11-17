# @proj-airi/server-sdk-shared

Eventa contracts of the chat WebSocket. Dahlia's server (`src/Dahlia.Avatar/Gateway/ChatSync.cs`) speaks them at
`/api/ws/v2/chat`, and the apps' chat sync (`packages/stage-ui/src/libs/chat-sync`) uses them.

## Usage

```shell
ni @proj-airi/server-sdk-shared -D
pnpm i @proj-airi/server-sdk-shared -D
```

```typescript
import type { WireMessage } from '@proj-airi/server-sdk-shared'

import { newMessages, pullMessages, sendMessages } from '@proj-airi/server-sdk-shared'
```

The package uses Eventa `1.0.0-beta.15`. Its WebSocket adapter accepts beta.13
`id/type/payload` envelopes and sends these fields with current envelopes.

`/ws/chat` keeps query-token authentication for deployed clients. `/ws/v2/chat`
authenticates after the WebSocket opens with `chat:authenticate`.

## License

[MIT](../../LICENSE)
