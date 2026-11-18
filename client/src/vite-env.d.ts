/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** WebSocket endpoint of the relay server, e.g. wss://api.example.com/ws */
  readonly VITE_WS_URL?: string;
}
