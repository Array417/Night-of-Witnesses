import { useEffect, useMemo, useState } from 'react';
import { GameClient, type ConnectionStatus } from './net.ts';
import type { PlayerProjection } from '../shared/state.ts';
import { audioManager } from './audio/manager.ts';
import { useAuth } from './auth.tsx';
import * as session from './session.ts';

export function useGame() {
  const { user, refresh } = useAuth();
  const client = useMemo(() => new GameClient(), [user?.id]);
  const [projection, setProjection] = useState<PlayerProjection | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>('disconnected');
  const [error, setError] = useState('');
  useEffect(() => {
    setProjection(null); setError('');
    if (!user) return;
    client.setEvents({
      onProjection: next => { setProjection(next); setError(''); audioManager.syncAmbience({ hasActiveRoom: true }); },
      onStatusChange: setStatus,
      onError: (code, message) => { setError(message); if (code === 'AUTH_REQUIRED') void refresh(); },
      onRoomClosed: () => { setProjection(null); audioManager.syncAmbience({ hasActiveRoom: false }); },
    });
    window.__NOW__ = { GameClient, session, client };
    client.connect();
    return () => { client.setEvents({}); client.disconnect(); audioManager.syncAmbience({ hasActiveRoom: false }); };
  }, [client, user?.id, refresh]);
  return { client, projection, status, error, setError };
}
