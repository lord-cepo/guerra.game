export function createBrowserRuntime() {
  const shieldFrames = Array.from({ length: 7 }, (_, index) => `./assets/shield-${index}.png`).map(url => {
    const image = new Image();
    image.src = url;
    return image;
  });
  const slash = new Image();
  slash.src = './assets/slash.png';
  const skull = new Image();
  skull.src = './assets/skull.png';
  const assetsReady = Promise.all([
    ...shieldFrames.map(image => image.decode().catch(() => undefined)),
    skull.decode().catch(() => undefined),
  ]);
  let busyOperationCount = 0;

  async function withBusyCursor<T>(operation: () => Promise<T>): Promise<T> {
    busyOperationCount += 1;
    document.documentElement.classList.add('app-busy');
    document.documentElement.setAttribute('aria-busy', 'true');
    try {
      return await operation();
    } finally {
      busyOperationCount -= 1;
      if (busyOperationCount === 0) {
        document.documentElement.classList.remove('app-busy');
        document.documentElement.removeAttribute('aria-busy');
      }
    }
  }

  async function readApiJson<T>(response: Response, endpoint: string): Promise<T> {
    const body = await response.text();
    try {
      return JSON.parse(body) as T;
    } catch {
      const contentType = response.headers.get('content-type') ?? 'unknown content type';
      const preview = body.trim().replace(/\s+/g, ' ').slice(0, 80) || '(empty response)';
      throw new Error(`${endpoint} returned ${response.status} (${contentType}), not JSON: ${preview}`);
    }
  }

  return { assetsReady, withBusyCursor, readApiJson };
}
