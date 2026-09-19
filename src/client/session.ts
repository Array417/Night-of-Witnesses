export const SEAT_STORAGE_KEY = 'night-of-witnesses.seat.v1';

export interface SavedSeat {
  roomCode: string;
  seatToken: string;
}

export function loadSavedSeat(): SavedSeat | null {
  try {
    const raw = localStorage.getItem(SEAT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof parsed.roomCode === 'string' &&
      typeof parsed.seatToken === 'string'
    ) {
      return { roomCode: parsed.roomCode, seatToken: parsed.seatToken };
    }
  } catch {
    // Corrupted item, clear it
    clearSavedSeat();
  }
  return null;
}

export function saveSeat(roomCode: string, seatToken: string): void {
  try {
    const data: SavedSeat = { roomCode, seatToken };
    localStorage.setItem(SEAT_STORAGE_KEY, JSON.stringify(data));
  } catch {
    // Storage might be disabled or full
  }
}

export function clearSavedSeat(): void {
  try {
    localStorage.removeItem(SEAT_STORAGE_KEY);
  } catch {
    // Ignore
  }
}

export function getRoomCodeFromUrl(): string | null {
  try {
    const params = new URLSearchParams(window.location.search);
    const room = params.get('room');
    if (room && room.length === 6) {
      return room.toUpperCase();
    }
  } catch {
    // Ignore
  }
  return null;
}

export function setRoomCodeInUrl(roomCode: string | null): void {
  try {
    const url = new URL(window.location.href);
    if (roomCode) {
      url.searchParams.set('room', roomCode);
    } else {
      url.searchParams.delete('room');
    }
    window.history.replaceState({}, '', url.toString());
  } catch {
    // Ignore
  }
}
