/** Classic token bucket: `capacity` burst, refilled at `perSecond`. */
export class TokenBucket {
  private readonly capacity: number;
  private readonly perMs: number;
  private tokens: number;
  private last: number;
  private readonly now: () => number;

  constructor(capacity: number, perSecond: number, now: () => number = Date.now) {
    this.capacity = capacity;
    this.perMs = perSecond / 1000;
    this.tokens = capacity;
    this.now = now;
    this.last = now();
  }

  take(cost = 1): boolean {
    const t = this.now();
    this.tokens = Math.min(this.capacity, this.tokens + (t - this.last) * this.perMs);
    this.last = t;
    if (this.tokens < cost) return false;
    this.tokens -= cost;
    return true;
  }
}
