import { CongestionAvoidance } from '@ndn/segmented-object';

export class LimitedCwnd extends CongestionAvoidance {
  constructor(
    private readonly inner: CongestionAvoidance,
    readonly maxCwnd = 3,
  ) {
    super(inner.cwnd);
    inner.addEventListener('cwndupdate', () => this.updateCwnd(Math.min(maxCwnd, inner.cwnd)));
  }
  override increase(now: number, rtt: number) {
    return this.inner.increase(now, rtt);
  }
  override decrease(now: number) {
    return this.inner.decrease(now);
  }
}
