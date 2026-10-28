/** Resolve runtime settings without copying credentials into logs or app responses. */
export function configFor(values: Record<string, string>, environment: Record<string, string | undefined> = process.env) {
  return (key: string, fallback: string): string => {
    if (key === 'OPENAI_API_KEY') {
      // Some agent shells inject OPENAI_API_KEY=not-needed. It must not mask
      // the real key saved for transcription and Wyn in config.json.
      return [environment[key], values[key]].find(v => typeof v === 'string' && /^sk-[A-Za-z0-9_-]{16,}$/.test(v)) ?? fallback;
    }
    return environment[key] ?? values[key] ?? fallback;
  };
}
