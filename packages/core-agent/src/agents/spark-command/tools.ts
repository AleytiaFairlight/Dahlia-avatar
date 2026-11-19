import type { WebSocketEvents } from '@proj-airi/server-sdk'
import type { JsonSchema } from 'xsschema'
import type z from 'zod/v4'

import { rawTool } from '@xsai/tool'
import { nanoid } from 'nanoid'
import { toJsonSchema } from 'xsschema'

import {
  normalizeSparkCommandDestinations,
  normalizeSparkCommandGuidanceOptions,
  normalizeSparkCommandMetadata,
  normalizeSparkCommandPersona,
  normalizeSparkCommandStringList,
  normalizeSparkCommandStringValue,
  sparkCommandToolSchema,
} from './schema'

/** Options for the Spark Command LLM tool. */
export interface CreateSparkCommandToolOptions {
  /** Receives a protocol-ready `spark:command` event. */
  sendSparkCommand: (command: WebSocketEvents['spark:command']) => void
}

/**
 * Writes each `type` array as the `anyOf` of its types.
 *
 * Zod 4.6 writes a union of plain types as one array, `type: ['string', 'number', 'boolean', 'null']`, where zod 4.4
 * wrote `anyOf: [{ type: 'string' }, …]`. The tool keeps the `anyOf` form: OpenRouter's Gemini conversion dropped the
 * metadata properties of the array form but kept their `required` keys.
 */
function expandTypeArrays(schema: unknown): unknown {
  if (Array.isArray(schema))
    return schema.map(expandTypeArrays)
  if (!schema || typeof schema !== 'object')
    return schema

  // In a `properties` map, `type` is the schema of a property named "type", so it is expanded like the others.
  const { type, ...rest } = schema as Record<string, unknown>
  const next = Object.fromEntries(Object.entries(rest).map(([key, value]) => [key, expandTypeArrays(value)]))
  if (Array.isArray(type) && type.length > 1)
    return { ...next, anyOf: type.map(value => ({ type: value })) }
  return type === undefined ? next : { type: expandTypeArrays(type), ...next }
}

/**
 * Creates the LLM tool that emits one `spark:command` event.
 *
 * The caller owns transport delivery. This function creates provider-facing schemas,
 * normalizes the tool payload, and passes the resulting event to `sendSparkCommand`.
 */
export async function createSparkCommandTool(options: CreateSparkCommandToolOptions) {
  // Keep the generated JSON Schema provider-neutral. Each provider adapter
  // converts unsupported schema forms before it sends the request.
  const parameters = expandTypeArrays(await toJsonSchema(sparkCommandToolSchema)) as JsonSchema

  return [
    rawTool({
      name: 'builtIn_emitSparkCommand',
      description: 'Send a spark:command to one or more frontend-connected modules or sub-agents.',
      parameters,
      execute: async (rawPayload) => {
        const payload = rawPayload as z.infer<typeof sparkCommandToolSchema>
        const command = {
          id: nanoid(),
          eventId: nanoid(),
          parentEventId: payload.parentEventId ?? undefined,
          commandId: nanoid(),
          interrupt: payload.interrupt ?? false,
          priority: payload.priority ?? 'normal',
          intent: payload.intent ?? 'action',
          ack: payload.ack ?? undefined,
          guidance: payload.guidance
            ? {
                type: payload.guidance.type,
                persona: normalizeSparkCommandPersona(payload.guidance.persona ?? undefined),
                options: normalizeSparkCommandGuidanceOptions(payload.guidance.options),
              }
            : undefined,
          contexts: payload.contexts?.map(context => ({
            id: nanoid(),
            contextId: nanoid(),
            lane: normalizeSparkCommandStringValue(context.lane),
            ideas: normalizeSparkCommandStringList(context.ideas),
            hints: normalizeSparkCommandStringList(context.hints),
            strategy: context.strategy,
            text: context.text,
            destinations: normalizeSparkCommandDestinations(context.destinations),
            metadata: normalizeSparkCommandMetadata(context.metadata ?? undefined),
          })),
          destinations: payload.destinations,
        } satisfies WebSocketEvents['spark:command']

        options.sendSparkCommand(command)

        // `destinations` is absent on the broadcast path: the channel sender in
        // stores/ai/chat-llm/tool-resolver.ts deletes it, because an explicit empty array reaches
        // no peer. Guard the .join so we don't surface "Cannot read properties of undefined
        // (reading 'join')" back to the LLM after a successful send.
        const dests = Array.isArray(command.destinations) && command.destinations.length > 0
          ? command.destinations.join(', ')
          : 'all authenticated peers (broadcast)'
        return `spark:command sent (${command.commandId}) to ${dests}`
      },
    }),
  ]
}
