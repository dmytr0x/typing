const MASK32 = 0xffffffff;
const MASK64 = (1n << 64n) - 1n;

const SHA512_K = [
  0x428a2f98d728ae22n, 0x7137449123ef65cdn, 0xb5c0fbcfec4d3b2fn, 0xe9b5dba58189dbbcn,
  0x3956c25bf348b538n, 0x59f111f1b605d019n, 0x923f82a4af194f9bn, 0xab1c5ed5da6d8118n,
  0xd807aa98a3030242n, 0x12835b0145706fben, 0x243185be4ee4b28cn, 0x550c7dc3d5ffb4e2n,
  0x72be5d74f27b896fn, 0x80deb1fe3b1696b1n, 0x9bdc06a725c71235n, 0xc19bf174cf692694n,
  0xe49b69c19ef14ad2n, 0xefbe4786384f25e3n, 0x0fc19dc68b8cd5b5n, 0x240ca1cc77ac9c65n,
  0x2de92c6f592b0275n, 0x4a7484aa6ea6e483n, 0x5cb0a9dcbd41fbd4n, 0x76f988da831153b5n,
  0x983e5152ee66dfabn, 0xa831c66d2db43210n, 0xb00327c898fb213fn, 0xbf597fc7beef0ee4n,
  0xc6e00bf33da88fc2n, 0xd5a79147930aa725n, 0x06ca6351e003826fn, 0x142929670a0e6e70n,
  0x27b70a8546d22ffcn, 0x2e1b21385c26c926n, 0x4d2c6dfc5ac42aedn, 0x53380d139d95b3dfn,
  0x650a73548baf63den, 0x766a0abb3c77b2a8n, 0x81c2c92e47edaee6n, 0x92722c851482353bn,
  0xa2bfe8a14cf10364n, 0xa81a664bbc423001n, 0xc24b8b70d0f89791n, 0xc76c51a30654be30n,
  0xd192e819d6ef5218n, 0xd69906245565a910n, 0xf40e35855771202an, 0x106aa07032bbd1b8n,
  0x19a4c116b8d2d0c8n, 0x1e376c085141ab53n, 0x2748774cdf8eeb99n, 0x34b0bcb5e19b48a8n,
  0x391c0cb3c5c95a63n, 0x4ed8aa4ae3418acbn, 0x5b9cca4f7763e373n, 0x682e6ff3d6b2b8a3n,
  0x748f82ee5defb2fcn, 0x78a5636f43172f60n, 0x84c87814a1f0ab72n, 0x8cc702081a6439ecn,
  0x90befffa23631e28n, 0xa4506cebde82bde9n, 0xbef9a3f7b2c67915n, 0xc67178f2e372532bn,
  0xca273eceea26619cn, 0xd186b8c721c0c207n, 0xeada7dd6cde0eb1en, 0xf57d4f7fee6ed178n,
  0x06f067aa72176fban, 0x0a637dc5a2c898a6n, 0x113f9804bef90daen, 0x1b710b35131c471bn,
  0x28db77f523047d84n, 0x32caab7b40c72493n, 0x3c9ebe0a15c9bebcn, 0x431d67c49c100d4cn,
  0x4cc5d4becb3e42b6n, 0x597f299cfc657e2an, 0x5fcb6fab3ad6faecn, 0x6c44198c4a475817n,
];

const rotr = (x, n) => ((x >> BigInt(n)) | (x << (64n - BigInt(n)))) & MASK64;
const shr = (x, n) => x >> BigInt(n);

function sha512Bytes(message) {
  const encoded =
    typeof message === "string" ? new TextEncoder().encode(message) : message;
  const bitLen = BigInt(encoded.length) * 8n;
  const withOne = encoded.length + 1;
  const paddedLen = Math.ceil((withOne + 16) / 128) * 128;
  const bytes = new Uint8Array(paddedLen);
  bytes.set(encoded);
  bytes[encoded.length] = 0x80;
  const view = new DataView(bytes.buffer);
  view.setUint32(paddedLen - 8, Number(bitLen >> 32n), false);
  view.setUint32(paddedLen - 4, Number(bitLen & 0xffffffffn), false);

  let h0 = 0x6a09e667f3bcc908n,
    h1 = 0xbb67ae8584caa73bn,
    h2 = 0x3c6ef372fe94f82bn,
    h3 = 0xa54ff53a5f1d36f1n,
    h4 = 0x510e527fade682d1n,
    h5 = 0x9b05688c2b3e6c1fn,
    h6 = 0x1f83d9abfb41bd6bn,
    h7 = 0x5be0cd19137e2179n;

  for (let offset = 0; offset < paddedLen; offset += 128) {
    const w = new Array(80);
    for (let i = 0; i < 16; i++) {
      const a = view.getUint32(offset + i * 8, false);
      const b = view.getUint32(offset + i * 8 + 4, false);
      w[i] = (BigInt(a) << 32n) | BigInt(b);
    }
    for (let i = 16; i < 80; i++) {
      const s0 = rotr(w[i - 15], 1) ^ rotr(w[i - 15], 8) ^ shr(w[i - 15], 7);
      const s1 = rotr(w[i - 2], 19) ^ rotr(w[i - 2], 61) ^ shr(w[i - 2], 6);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) & MASK64;
    }
    let a = h0,
      b = h1,
      c = h2,
      d = h3,
      e = h4,
      f = h5,
      g = h6,
      h = h7;
    for (let i = 0; i < 80; i++) {
      const S1 = rotr(e, 14) ^ rotr(e, 18) ^ rotr(e, 41);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + SHA512_K[i] + w[i]) & MASK64;
      const S0 = rotr(a, 28) ^ rotr(a, 34) ^ rotr(a, 39);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) & MASK64;
      h = g;
      g = f;
      f = e;
      e = (d + temp1) & MASK64;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) & MASK64;
    }
    h0 = (h0 + a) & MASK64;
    h1 = (h1 + b) & MASK64;
    h2 = (h2 + c) & MASK64;
    h3 = (h3 + d) & MASK64;
    h4 = (h4 + e) & MASK64;
    h5 = (h5 + f) & MASK64;
    h6 = (h6 + g) & MASK64;
    h7 = (h7 + h) & MASK64;
  }
  const out = new Uint8Array(64);
  const outView = new DataView(out.buffer);
  const words = [h0, h1, h2, h3, h4, h5, h6, h7];
  words.forEach((word, i) => {
    outView.setUint32(i * 8, Number(word >> 32n), false);
    outView.setUint32(i * 8 + 4, Number(word & 0xffffffffn), false);
  });
  return out;
}

export function sha512Hex(message) {
  return [...sha512Bytes(message)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function u32(value) {
  return value >>> 0;
}

export class PythonRandom {
  constructor(seed) {
    this.N = 624;
    this.M = 397;
    this.MATRIX_A = 0x9908b0df;
    this.UPPER = 0x80000000;
    this.LOWER = 0x7fffffff;
    this.mt = new Uint32Array(this.N);
    this.index = this.N + 1;
    this.seed(seed);
  }

  seed(seed) {
    const encoded = new TextEncoder().encode(String(seed));
    const digest = sha512Bytes(encoded);
    const payload = new Uint8Array(encoded.length + digest.length);
    payload.set(encoded);
    payload.set(digest, encoded.length);
    let n = 0n;
    for (const byte of payload) n = (n << 8n) + BigInt(byte);
    const bits = n === 0n ? 0 : n.toString(2).length;
    const nbytes = bits === 0 ? 1 : Math.ceil(bits / 8);
    const ba = new Uint8Array(nbytes);
    let tmp = n;
    for (let i = 0; i < nbytes; i++) {
      ba[i] = Number(tmp & 0xffn);
      tmp >>= 8n;
    }
    const keyused = Math.ceil(ba.length / 4);
    const key = new Uint32Array(keyused);
    for (let i = 0; i < ba.length; i++) key[(i / 4) | 0] |= ba[i] << ((i % 4) * 8);
    this._initByArray(key);
  }

  _initGenrand(s) {
    this.mt[0] = u32(s);
    for (let i = 1; i < this.N; i++) {
      this.mt[i] = u32(
        Math.imul(1812433253, this.mt[i - 1] ^ (this.mt[i - 1] >>> 30)) + i,
      );
    }
    this.index = this.N;
  }

  _initByArray(key) {
    this._initGenrand(19650218);
    let i = 1,
      j = 0;
    let k = this.N > key.length ? this.N : key.length;
    for (; k; k--) {
      this.mt[i] = u32(
        (this.mt[i] ^
          Math.imul(this.mt[i - 1] ^ (this.mt[i - 1] >>> 30), 1664525)) +
          key[j] +
          j,
      );
      i++;
      j++;
      if (i >= this.N) {
        this.mt[0] = this.mt[this.N - 1];
        i = 1;
      }
      if (j >= key.length) j = 0;
    }
    for (k = this.N - 1; k; k--) {
      this.mt[i] = u32(
        (this.mt[i] ^
          Math.imul(this.mt[i - 1] ^ (this.mt[i - 1] >>> 30), 1566083941)) - i,
      );
      i++;
      if (i >= this.N) {
        this.mt[0] = this.mt[this.N - 1];
        i = 1;
      }
    }
    this.mt[0] = 0x80000000;
  }

  _genrandInt32() {
    const mag01 = [0, this.MATRIX_A];
    if (this.index >= this.N) {
      let kk;
      for (kk = 0; kk < this.N - this.M; kk++) {
        const y = (this.mt[kk] & this.UPPER) | (this.mt[kk + 1] & this.LOWER);
        this.mt[kk] = this.mt[kk + this.M] ^ (y >>> 1) ^ mag01[y & 1];
      }
      for (; kk < this.N - 1; kk++) {
        const y = (this.mt[kk] & this.UPPER) | (this.mt[kk + 1] & this.LOWER);
        this.mt[kk] = this.mt[kk + (this.M - this.N)] ^ (y >>> 1) ^ mag01[y & 1];
      }
      const y = (this.mt[this.N - 1] & this.UPPER) | (this.mt[0] & this.LOWER);
      this.mt[this.N - 1] = this.mt[this.M - 1] ^ (y >>> 1) ^ mag01[y & 1];
      this.index = 0;
    }
    let y = this.mt[this.index++];
    y ^= y >>> 11;
    y ^= (y << 7) & 0x9d2c5680;
    y ^= (y << 15) & 0xefc60000;
    y ^= y >>> 18;
    return u32(y);
  }

  getrandbits(k) {
    if (k <= 32) return this._genrandInt32() >>> (32 - k);
    throw new Error("getrandbits only implemented for k <= 32");
  }

  randbelow(n) {
    if (n <= 0) throw new Error("empty sequence");
    const k = 32 - Math.clz32(n);
    let r = this.getrandbits(k);
    while (r >= n) r = this.getrandbits(k);
    return r;
  }

  choice(seq) {
    if (!seq.length) throw new Error("Cannot choose from an empty sequence");
    return seq[this.randbelow(seq.length)];
  }
}
