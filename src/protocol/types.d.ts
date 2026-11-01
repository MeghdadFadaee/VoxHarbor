export type ProtocolCommand =
  | { type: 'connect'; csrf: string; connectionId: string; heartbeat?: boolean }
  | { type: 'command'; csrf: string; requestId: number; command: ClientCommand }
  | { type: 'ping'; csrf: string; nonce: number }
  | { type: 'disconnect'; csrf: string }
  | { type: 'audio_state'; csrf: string; inputMuted: boolean; outputMuted: boolean };
export type ClientCommand =
  | { type: 'join_channel'; channelId: number; password?: string }
  | { type: 'subscribe'; channelId: number; subscribed: boolean }
  | { type: 'nickname'; name: string }
  | { type: 'away'; away: boolean; message?: string }
  | { type: 'text_message'; target: 'channel' | 'server' | 'private'; channelId?: number; clientId?: number; clientUid?: string; message: string }
  | { type: 'poke'; clientId: number; clientUid?: string; message: string };
export type Channel = { id: number; parentId: number; name: string; order: number; subscribed: boolean; codec: number; passwordProtected: boolean; topic: string };
export type Participant = { id: number; channelId: number; name: string; inputMuted: boolean; outputMuted: boolean; awayMessage: string | null; uid: string | null };
export type ProtocolEvent =
  | { type: 'ts3_connection_saved'; preferences: unknown }
  | { type: 'ts3_pong'; nonce: number }
  | { type: 'ts3_command_result'; requestId: number; ok: boolean; code?: string; serverError?: number; missingPermission?: number }
  | { type: 'ts3_message'; target: 'channel' | 'server' | 'private' | 'poke'; clientId: number; targetClientId?: number; channelId?: number; name: string; message: string }
  | { type: 'ts3_status'; status: 'connecting' | 'connected' | 'reconnecting' | 'disconnected' | 'session_limit' | 'identity_level_increasing'; requiredLevel?: number }
  | { type: 'ts3_state'; sequence: number; ownClientId: number; server: { name: string }; channels: Channel[]; participants: Participant[] }
  | { type: 'ts3_identity'; uid: string; level: number }
  | { type: 'ts3_audio_status'; canSend: boolean; canReceive: boolean }
  | { type: 'ts3_error'; code: string; inconclusive?: boolean };
