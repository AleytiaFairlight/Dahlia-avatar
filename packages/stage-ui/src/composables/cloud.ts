/** Uses the Cloud origin, which is Dahlia's server. The requests carry no account: the apps have no AIRI sign-in. */
export function useCloudFetch() {
  const baseUrl = new URL(import.meta.env.VITE_CLOUD_URL || 'https://dahlia.aleytia.moe')

  return (path: string, init?: RequestInit): Promise<Response> => {
    const url = new URL(path, baseUrl)
    if (url.origin !== baseUrl.origin || url.username || url.password)
      throw new Error('Cloud requests must use the configured Cloud origin')

    return fetch(url, { ...init, credentials: 'omit' })
  }
}
