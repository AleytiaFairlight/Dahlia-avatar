/** Pricing category used by provider catalogue filters. */
export type ProviderPricing = 'free' | 'paid'

/** Deployment category used by provider catalogue filters. */
export type ProviderDeployment = 'local' | 'cloud'

/**
 * Represents catalogue attributes used by provider filtering UI.
 */
export interface ProviderAttributes {
  /** Price bucket shown by the provider source filter. */
  pricing?: ProviderPricing
  /** Runtime/deployment bucket shown by the provider source filter. */
  deployment?: ProviderDeployment
  /** Whether the provider should receive the existing recommended tag. */
  beginnerRecommended?: boolean
}

/** Minimal provider identity accepted by the attribute resolver. */
export interface ProviderAttributesInput {
  id?: string
}

// Dahlia: AIRI's catalog of third-party providers is deleted. Dahlia's providers and "no speech" have no catalogue tags.
const providerAttributesById = {
  'speech-noop': false,
} satisfies Record<string, ProviderAttributes | false>

/**
 * Normalizes provider attributes by dropping undefined fields.
 *
 * Before:
 * - `{ pricing: "paid", deployment: undefined }`
 *
 * After:
 * - `{ pricing: "paid" }`
 */
function compactProviderAttributes(metadata: ProviderAttributes): ProviderAttributes {
  return {
    ...(metadata.pricing ? { pricing: metadata.pricing } : {}),
    ...(metadata.deployment ? { deployment: metadata.deployment } : {}),
    ...(metadata.beginnerRecommended !== undefined ? { beginnerRecommended: metadata.beginnerRecommended } : {}),
  }
}

/**
 * Resolves the provider attributes used by settings filters.
 *
 * Use when:
 * - Rendering provider source cards.
 * - Selecting serializable metadata from a provider definition.
 *
 * Expects:
 * - `metadata.id` may identify a provider with catalogue metadata.
 *
 * Returns:
 * - Compact metadata with only meaningful tag fields.
 */
export function resolveProviderAttributes(
  metadata: ProviderAttributesInput = {},
): ProviderAttributes {
  if (!metadata.id)
    return {}

  const attributes = providerAttributesById[metadata.id as keyof typeof providerAttributesById]
  if (attributes === false)
    return {}
  if (attributes)
    return compactProviderAttributes(attributes)

  return {}
}
