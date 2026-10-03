import { z } from 'zod';

export const MAX_SIGNAL_PAYLOAD_CHARS = 6000;
export const MAX_VOICE_PEERS = 5;

export type RtcSignalKind = 'offer' | 'answer' | 'ice';

export interface RtcSignalIncoming {
  fromPlayerId: string;
  kind: RtcSignalKind;
  payload: string;
}

const rtcSignalIncomingSchema = z.object({
  type: z.literal('rtc_signal'),
  fromPlayerId: z.string().min(1),
  kind: z.enum(['offer', 'answer', 'ice']),
  payload: z.string().max(MAX_SIGNAL_PAYLOAD_CHARS),
});

const iceCandidateInitSchema = z.object({
  candidate: z.string().min(1),
  sdpMid: z.string().nullable().optional(),
  sdpMLineIndex: z.number().nullable().optional(),
  usernameFragment: z.string().nullable().optional(),
});

export type SafeIceCandidateInit = z.infer<typeof iceCandidateInitSchema>;

const iceServerSchema = z.object({
  urls: z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]),
  username: z.string().optional(),
  credential: z.string().optional(),
});

const iceServersSchema = z.array(iceServerSchema).max(8);

const welcomeExtrasSchema = z.object({
  type: z.literal('welcome'),
  iceServers: z.unknown().optional(),
});

export function parseIncomingRtcSignal(value: unknown): RtcSignalIncoming | null {
  const result = rtcSignalIncomingSchema.safeParse(value);
  if (!result.success) return null;
  return {
    fromPlayerId: result.data.fromPlayerId,
    kind: result.data.kind,
    payload: result.data.payload,
  };
}

export function extractIceServers(raw: unknown): RTCIceServer[] {
  const extras = welcomeExtrasSchema.safeParse(raw);
  if (!extras.success) return [];
  const parsed = iceServersSchema.safeParse(extras.data.iceServers);
  if (!parsed.success) return [];
  return parsed.data.map((entry) => {
    const server: RTCIceServer = { urls: entry.urls };
    if (entry.username !== undefined) server.username = entry.username;
    if (entry.credential !== undefined) server.credential = entry.credential;
    return server;
  });
}

export function parseSafeIceCandidate(payload: string): SafeIceCandidateInit | null {
  if (payload.length === 0 || payload.length > MAX_SIGNAL_PAYLOAD_CHARS) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return null;
  }
  const result = iceCandidateInitSchema.safeParse(parsed);
  if (!result.success) return null;
  return result.data;
}

export function nativeErrorMessage(err: unknown): string {
  if (err instanceof Error && err.message.length > 0) return err.message;
  return '未知錯誤';
}
