export class RoomQueue {
  private readonly pending = new Map<string, Promise<unknown>>();

  async drain(): Promise<void> { await Promise.allSettled([...this.pending.values()]); }

  run<Result>(roomCode: string, operation: () => Promise<Result>): Promise<Result> {
    const previous = this.pending.get(roomCode) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(operation);
    this.pending.set(roomCode, current);
    void current.finally(() => {
      if (this.pending.get(roomCode) === current) this.pending.delete(roomCode);
    }).catch(() => undefined);
    return current;
  }
}
