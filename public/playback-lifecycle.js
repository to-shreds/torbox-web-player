// One foreground playback choice at a time. Slow work from an older choice may
// settle, but cannot reopen a player, replace a newer choice, or hide its status.
export class LatestPlaybackAction {
  constructor() { this.current = null; }
  cancel() { this.current?.controller.abort(); this.current = null; }
  begin() {
    this.cancel();
    const controller = new AbortController();
    const action = {
      controller, signal: controller.signal,
      current: () => this.current === action && !controller.signal.aborted,
      check: () => { if (!action.current()) throw new DOMException('Playback cancelled.', 'AbortError'); },
      finish: () => { if (this.current === action) this.current = null; }
    };
    this.current = action;
    return action;
  }
}
