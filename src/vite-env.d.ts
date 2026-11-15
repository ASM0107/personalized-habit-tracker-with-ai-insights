interface ImportMetaEnv {
  readonly VITE_GEMINI_API_KEY?: string;
  readonly VITE_REMOTE_SYNC_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
