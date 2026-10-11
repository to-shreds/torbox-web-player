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

// Short-lived, session-local preparations. A canceled waiter never launches a
// late Play, and clearing the scope aborts its background API work as well.
export class PlaybackPreparationCache {
  constructor({ now = Date.now, ttlMs = 60000, maxEntries = 8 } = {}) {
    Object.assign(this, { now, ttlMs, maxEntries }); this.rows = new Map();
  }
  delete(key) { const row=this.rows.get(key);row?.controller.abort();this.rows.delete(key); }
  clear() { for(const key of this.rows.keys())this.delete(key); }
  cancelPending() { for(const [key,row] of this.rows)if(!row.finished)this.delete(key); }
  get(key, load, { signal } = {}) {
    if(signal?.aborted)return Promise.reject(signal.reason || new DOMException('Playback cancelled.', 'AbortError'));
    let row=this.rows.get(key);
    if(row && row.until<=this.now()){this.delete(key);row=null;}
    if(!row){
      while(this.rows.size>=this.maxEntries)this.delete(this.rows.keys().next().value);
      const controller=new AbortController();row={controller,finished:false,background:false,waiters:0,until:this.now()+this.ttlMs};
      const current=row;
      row.promise=Promise.resolve().then(()=>load(controller.signal)).then(value=>{
        if(controller.signal.aborted)throw controller.signal.reason;
        current.finished=true;current.until=this.now()+this.ttlMs;return value;
      }).catch(error=>{if(this.rows.get(key)===current)this.rows.delete(key);throw error;});
      this.rows.set(key,row);
    }
    if(!signal){row.background=true;return row.promise;}
    return new Promise((resolve,reject)=>{
      let waiting=true;row.waiters++;
      const release=()=>{if(waiting){waiting=false;row.waiters--;signal.removeEventListener('abort',stop);}};
      const stop=()=>{release();if(!row.finished&&!row.background&&!row.waiters&&this.rows.get(key)===row)this.delete(key);reject(signal.reason || new DOMException('Playback cancelled.', 'AbortError'));};
      signal.addEventListener('abort',stop,{once:true});
      row.promise.then(value=>{release();if(signal.aborted)stop();else resolve(value);},error=>{release();reject(error);});
    });
  }
}
