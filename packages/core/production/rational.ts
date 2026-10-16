import type { Exact } from '@autofactorio/contracts';

export class ComputationLimit extends Error {}
const gcd = (a: bigint, b: bigint): bigint => { while (b) { [a, b] = [b, a % b]; } return a < 0n ? -a : a; };
/** Decimal facts are converted once; all balances and pivot comparisons stay exact. */
export class Q {
  readonly n: bigint; readonly d: bigint;
  constructor(n: bigint | number, d: bigint | number = 1n) {
    let nn = BigInt(n), dd = BigInt(d);
    if (!dd) throw new Error('Zero denominator');
    if (dd < 0n) { nn = -nn; dd = -dd; }
    // Integers and zero are already reduced; avoid Euclidean work on every pivot cell.
    const g = dd === 1n ? 1n : nn === 0n ? dd : gcd(nn, dd); this.n = nn / g; this.d = dd / g;
    if (this.n.toString(2).length > 512 || this.d.toString(2).length > 512) throw new ComputationLimit('rational_bit_limit');
  }
  static from(v: number | Exact): Q {
    if (typeof v !== 'number') {
      if (!v || !/^-?\d{1,100}$/.test(v.numerator) || !/^\d{1,100}$/.test(v.denominator)) throw new Error('Invalid exact quantity');
      return new Q(BigInt(v.numerator), BigInt(v.denominator));
    }
    if (!Number.isFinite(v)) throw new Error('Nonfinite quantity');
    const [mantissa, exponent = '0'] = String(v).toLowerCase().split('e');
    const decimal = mantissa!.split('.'); const scale = (decimal[1]?.length ?? 0) - Number(exponent);
    const n = BigInt(decimal.join(''));
    return scale >= 0 ? new Q(n, 10n ** BigInt(scale)) : new Q(n * 10n ** BigInt(-scale));
  }
  add(q: Q) { return new Q(this.n * q.d + q.n * this.d, this.d * q.d); }
  sub(q: Q) { return new Q(this.n * q.d - q.n * this.d, this.d * q.d); }
  mul(q: Q) { return new Q(this.n * q.n, this.d * q.d); }
  div(q: Q) { return new Q(this.n * q.d, this.d * q.n); }
  neg() { return new Q(-this.n, this.d); }
  cmp(q: Q) { const n = this.n * q.d - q.n * this.d; return n < 0n ? -1 : n > 0n ? 1 : 0; }
  ceil() { return this.n / this.d + (this.n > 0n && this.n % this.d ? 1n : 0n); }
  number() { return Number(this.n) / Number(this.d); }
  json(): Exact { return { numerator: this.n.toString(), denominator: this.d.toString() }; }
}
export const ZERO = new Q(0), ONE = new Q(1);
export const sum = (values: Q[]) => values.reduce((a, b) => a.add(b), ZERO);
