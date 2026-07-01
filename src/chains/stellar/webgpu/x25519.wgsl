// =============================================================================
// x25519.wgsl — Stellar stealth scanner compute shader
//
// Per-invocation (one announcement per thread):
//   1. SHA-256 view-tag prefilter (public data only)
//   2. X25519 scalar multiplication (only for tag-passing entries)
//   3. Compare derived shared-secret first byte as secondary filter output
//
// Bindings:
//   @group(0) @binding(0) — ephemeral_pubkeys : array<u32>  (N * 8 u32s, LE)
//   @group(0) @binding(1) — view_tags         : array<u32>  (ceil(N/4) u32s, packed u8s)
//   @group(0) @binding(2) — params            : Params uniform
//   @group(0) @binding(3) — results           : array<u32>  (ceil(N/32) u32s, bitmask)
//
// Workgroup size: 64 threads. Dispatch ceil(N/64) workgroups.
// =============================================================================

// ---------------------------------------------------------------------------
// Uniforms
// ---------------------------------------------------------------------------

struct Params {
    // Viewing public key in Montgomery (X25519) form — 8 x u32 LE limbs
    view_pub_x  : array<u32, 8>,
    // Viewing private scalar in Montgomery (X25519) form — 8 x u32 LE limbs
    view_priv_x : array<u32, 8>,
    // Total number of announcements
    count       : u32,
    _pad0       : u32,
    _pad1       : u32,
    _pad2       : u32,
}

@group(0) @binding(0) var<storage, read>       ephemeral_pubkeys : array<u32>;
@group(0) @binding(1) var<storage, read>       view_tags         : array<u32>;
@group(0) @binding(2) var<uniform>             params            : Params;
@group(0) @binding(3) var<storage, read_write> results           : array<u32>;

// ---------------------------------------------------------------------------
// SHA-256 — round constants K
// ---------------------------------------------------------------------------

fn sha256_k(i: u32) -> u32 {
    // All 64 SHA-256 round constants
    var k = array<u32, 64>(
        0x428a2f98u, 0x71374491u, 0xb5c0fbcfu, 0xe9b5dba5u,
        0x3956c25bu, 0x59f111f1u, 0x923f82a4u, 0xab1c5ed5u,
        0xd807aa98u, 0x12835b01u, 0x243185beu, 0x550c7dc3u,
        0x72be5d74u, 0x80deb1feu, 0x9bdc06a7u, 0xc19bf174u,
        0xe49b69c1u, 0xefbe4786u, 0x0fc19dc6u, 0x240ca1ccu,
        0x2de92c6fu, 0x4a7484aau, 0x5cb0a9dcu, 0x76f988dau,
        0x983e5152u, 0xa831c66du, 0xb00327c8u, 0xbf597fc7u,
        0xc6e00bf3u, 0xd5a79147u, 0x06ca6351u, 0x14292967u,
        0x27b70a85u, 0x2e1b2138u, 0x4d2c6dfcu, 0x53380d13u,
        0x650a7354u, 0x766a0abbu, 0x81c2c92eu, 0x92722c85u,
        0xa2bfe8a1u, 0xa81a664bu, 0xc24b8b70u, 0xc76c51a3u,
        0xd192e819u, 0xd6990624u, 0xf40e3585u, 0x106aa070u,
        0x19a4c116u, 0x1e376c08u, 0x2748774cu, 0x34b0bcb5u,
        0x391c0cb3u, 0x4ed8aa4au, 0x5b9cca4fu, 0x682e6ff3u,
        0x748f82eeu, 0x78a5636fu, 0x84c87814u, 0x8cc70208u,
        0x90befffau, 0xa4506cebu, 0xbef9a3f7u, 0xc67178f2u
    );
    return k[i];
}

// SHA-256 rotate-right
fn rotr32(x: u32, n: u32) -> u32 {
    return (x >> n) | (x << (32u - n));
}

// SHA-256 Sigma0, Sigma1, sigma0, sigma1
fn sha_S0(x: u32) -> u32 { return rotr32(x, 2u)  ^ rotr32(x, 13u) ^ rotr32(x, 22u); }
fn sha_S1(x: u32) -> u32 { return rotr32(x, 6u)  ^ rotr32(x, 11u) ^ rotr32(x, 25u); }
fn sha_s0(x: u32) -> u32 { return rotr32(x, 7u)  ^ rotr32(x, 18u) ^ (x >> 3u); }
fn sha_s1(x: u32) -> u32 { return rotr32(x, 17u) ^ rotr32(x, 19u) ^ (x >> 10u); }

// SHA-256 Ch and Maj
fn sha_ch(x: u32, y: u32, z: u32) -> u32  { return (x & y) ^ (~x & z); }
fn sha_maj(x: u32, y: u32, z: u32) -> u32 { return (x & y) ^ (x & z) ^ (y & z); }

// ---------------------------------------------------------------------------
// SHA-256 — single 64-byte block (512-bit) compress.
// Input: 16 x u32 big-endian words.
// Returns: 8-word digest.
// ---------------------------------------------------------------------------

fn sha256_compress(w_in: array<u32, 16>, h_in: array<u32, 8>) -> array<u32, 8> {
    // Message schedule — expand 16 words to 64
    var w: array<u32, 64>;
    for (var i = 0u; i < 16u; i++) { w[i] = w_in[i]; }
    for (var i = 16u; i < 64u; i++) {
        w[i] = sha_s1(w[i - 2u]) + w[i - 7u] + sha_s0(w[i - 15u]) + w[i - 16u];
    }

    var a = h_in[0]; var b = h_in[1]; var c = h_in[2]; var d = h_in[3];
    var e = h_in[4]; var f = h_in[5]; var g = h_in[6]; var h = h_in[7];

    for (var i = 0u; i < 64u; i++) {
        let t1 = h + sha_S1(e) + sha_ch(e, f, g) + sha256_k(i) + w[i];
        let t2 = sha_S0(a) + sha_maj(a, b, c);
        h = g; g = f; f = e; e = d + t1;
        d = c; c = b; b = a; a = t1 + t2;
    }

    var h_out: array<u32, 8>;
    h_out[0] = h_in[0] + a; h_out[1] = h_in[1] + b;
    h_out[2] = h_in[2] + c; h_out[3] = h_in[3] + d;
    h_out[4] = h_in[4] + e; h_out[5] = h_in[5] + f;
    h_out[6] = h_in[6] + g; h_out[7] = h_in[7] + h;
    return h_out;
}

// ---------------------------------------------------------------------------
// SHA-256 of exactly (prefix_len + 64) bytes where the prefix is the
// "wraith:stellar:view-tag:v2:" string (27 bytes) followed by 32-byte
// R_eph and 32-byte V_viewing = 91 bytes total → two 512-bit blocks.
//
// Block 1 (bytes 0..63):  prefix[0..27] || R_eph[0..31] || V_viewing[0..4]
// Block 2 (bytes 64..90): V_viewing[5..31] || padding
//
// Padding rule: append 0x80, then zeros, then 64-bit big-endian bit-length.
// Total message length = 91 bytes = 728 bits.
// Block 2 carries bytes 64..90 (27 bytes of data) + pad.
// ---------------------------------------------------------------------------

// The ASCII bytes of "wraith:stellar:view-tag:v2:" (27 bytes)
// w  r  a  i  t  h  :  s  t  e  l  l  a  r  :  v  i  e  w  -  t  a  g  :  v  2  :
// 77 72 61 69 74 68 3a 73 74 65 6c 6c 61 72 3a 76 69 65 77 2d 74 61 67 3a 76 32 3a
// Packed into 7 big-endian u32 words (28 bytes, last byte = first byte of R_eph):
//   word0 = 0x77726169  (w r a i)
//   word1 = 0x74683a73  (t h : s)
//   word2 = 0x74656c6c  (t e l l)
//   word3 = 0x61723a76  (a r : v)
//   word4 = 0x6965772d  (i e w -)
//   word5 = 0x7461673a  (t a g :)
//   word6 = 0x76323a00  (v 2 : _) — last byte filled from R_eph[0]

fn sha256_view_tag(r_eph: array<u32, 8>, v_view: array<u32, 8>) -> u32 {
    // Initial hash values (SHA-256 IV)
    var iv: array<u32, 8>;
    iv[0] = 0x6a09e667u; iv[1] = 0xbb67ae85u; iv[2] = 0x3c6ef372u; iv[3] = 0xa54ff53au;
    iv[4] = 0x510e527fu; iv[5] = 0x9b05688cu; iv[6] = 0x1f83d9abu; iv[7] = 0x5be0cd19u;

    // ---- Block 1: bytes 0..63 ----
    // Prefix occupies bytes 0..26 (27 bytes).
    // r_eph occupies bytes 27..58 (32 bytes).
    // v_view[0..4] occupies bytes 59..63 (5 bytes → first 5 bytes of v_view).
    //
    // r_eph and v_view arrive as little-endian u32 limbs (from the buffer).
    // SHA-256 message schedule words are big-endian.
    // Helper: convert LE u32 limb to BE u32 word.

    // Byte layout → word indices:
    // w[ 0] bytes  0.. 3: prefix[0..3]   = "wrai" = 0x77726169
    // w[ 1] bytes  4.. 7: prefix[4..7]   = "th:s" = 0x74683a73
    // w[ 2] bytes  8..11: prefix[8..11]  = "tell" = 0x74656c6c
    // w[ 3] bytes 12..15: prefix[12..15] = "ar:v" = 0x61723a76
    // w[ 4] bytes 16..19: prefix[16..19] = "iew-" = 0x6965772d
    // w[ 5] bytes 20..23: prefix[20..23] = "tag:" = 0x7461673a
    // w[ 6] bytes 24..27: prefix[24..26]="v2:" + r_eph_byte[0]
    // w[ 7] bytes 28..31: r_eph bytes 1..4
    // w[ 8] bytes 32..35: r_eph bytes 5..8
    // w[ 9] bytes 36..39: r_eph bytes 9..12
    // w[10] bytes 40..43: r_eph bytes 13..16
    // w[11] bytes 44..47: r_eph bytes 17..20
    // w[12] bytes 48..51: r_eph bytes 21..24
    // w[13] bytes 52..55: r_eph bytes 25..28
    // w[14] bytes 56..59: r_eph bytes 29..31 + v_view byte[0]
    // w[15] bytes 60..63: v_view bytes 1..4

    // Extract individual bytes from LE limbs of r_eph and v_view
    // r_eph[k] = limb k, bytes [4k..4k+3] LE → byte b_j = (r_eph[j/4] >> (8*(j%4))) & 0xff
    let re0 = r_eph[0]; let re1 = r_eph[1]; let re2 = r_eph[2]; let re3 = r_eph[3];
    let re4 = r_eph[4]; let re5 = r_eph[5]; let re6 = r_eph[6]; let re7 = r_eph[7];
    let vv0 = v_view[0]; let vv1 = v_view[1];

    // Macro-inline byte extraction: byte j of r_eph = (re[j>>2] >> ((j&3)*8)) & 0xff
    // Word 6: "v2:" + r_eph[0]
    let w6 = (0x76323a00u) | ((re0) & 0xffu);
    // Word 7: r_eph bytes 1,2,3,4 in BE
    let w7 = (((re0 >> 8u) & 0xffu) << 24u) | (((re0 >> 16u) & 0xffu) << 16u)
           | (((re0 >> 24u) & 0xffu) << 8u)  | ((re1) & 0xffu);
    // Word 8: r_eph bytes 5,6,7,8
    let w8 = (((re1 >> 8u) & 0xffu) << 24u) | (((re1 >> 16u) & 0xffu) << 16u)
           | (((re1 >> 24u) & 0xffu) << 8u)  | ((re2) & 0xffu);
    // Word 9: r_eph bytes 9,10,11,12
    let w9 = (((re2 >> 8u) & 0xffu) << 24u) | (((re2 >> 16u) & 0xffu) << 16u)
           | (((re2 >> 24u) & 0xffu) << 8u)  | ((re3) & 0xffu);
    // Word 10: r_eph bytes 13,14,15,16
    let w10 = (((re3 >> 8u) & 0xffu) << 24u) | (((re3 >> 16u) & 0xffu) << 16u)
            | (((re3 >> 24u) & 0xffu) << 8u)  | ((re4) & 0xffu);
    // Word 11: r_eph bytes 17,18,19,20
    let w11 = (((re4 >> 8u) & 0xffu) << 24u) | (((re4 >> 16u) & 0xffu) << 16u)
            | (((re4 >> 24u) & 0xffu) << 8u)  | ((re5) & 0xffu);
    // Word 12: r_eph bytes 21,22,23,24
    let w12 = (((re5 >> 8u) & 0xffu) << 24u) | (((re5 >> 16u) & 0xffu) << 16u)
            | (((re5 >> 24u) & 0xffu) << 8u)  | ((re6) & 0xffu);
    // Word 13: r_eph bytes 25,26,27,28
    let w13 = (((re6 >> 8u) & 0xffu) << 24u) | (((re6 >> 16u) & 0xffu) << 16u)
            | (((re6 >> 24u) & 0xffu) << 8u)  | ((re7) & 0xffu);
    // Word 14: r_eph bytes 29,30,31 + v_view byte 0
    let w14 = (((re7 >> 8u) & 0xffu) << 24u) | (((re7 >> 16u) & 0xffu) << 16u)
            | (((re7 >> 24u) & 0xffu) << 8u)  | ((vv0) & 0xffu);
    // Word 15: v_view bytes 1,2,3,4
    let w15 = (((vv0 >> 8u) & 0xffu) << 24u) | (((vv0 >> 16u) & 0xffu) << 16u)
            | (((vv0 >> 24u) & 0xffu) << 8u)  | ((vv1) & 0xffu);

    var blk1: array<u32, 16>;
    blk1[0]  = 0x77726169u;  // "wrai"
    blk1[1]  = 0x74683a73u;  // "th:s"
    blk1[2]  = 0x74656c6cu;  // "tell"
    blk1[3]  = 0x61723a76u;  // "ar:v"
    blk1[4]  = 0x6965772du;  // "iew-"
    blk1[5]  = 0x7461673au;  // "tag:"
    blk1[6]  = w6;
    blk1[7]  = w7;
    blk1[8]  = w8;
    blk1[9]  = w9;
    blk1[10] = w10;
    blk1[11] = w11;
    blk1[12] = w12;
    blk1[13] = w13;
    blk1[14] = w14;
    blk1[15] = w15;

    let h1 = sha256_compress(blk1, iv);

    // ---- Block 2: bytes 64..90 + padding ----
    // v_view bytes 5..31 = 27 bytes at positions 64..90
    // v_view[1] upper 3 bytes (bytes 5,6,7), then limbs 2..7 (24 bytes) = 27 bytes total
    // Then 0x80 pad byte at position 91, zeros, then 64-bit length = 728 = 0x2D8 at end
    let vv2 = v_view[2]; let vv3 = v_view[3];
    let vv4 = v_view[4]; let vv5 = v_view[5];
    let vv6 = v_view[6]; let vv7 = v_view[7];

    // block2 word 0: v_view bytes 5,6,7,8  (relative offsets within v_view)
    // v_view byte 5 = (vv1>>8)&0xff, byte 6=(vv1>>16)&0xff, byte 7=(vv1>>24)&0xff, byte 8=(vv2)&0xff
    let b2w0 = (((vv1 >> 8u) & 0xffu) << 24u) | (((vv1 >> 16u) & 0xffu) << 16u)
             | (((vv1 >> 24u) & 0xffu) << 8u)  | ((vv2) & 0xffu);
    // word 1: v_view bytes 9..12
    let b2w1 = (((vv2 >> 8u) & 0xffu) << 24u) | (((vv2 >> 16u) & 0xffu) << 16u)
             | (((vv2 >> 24u) & 0xffu) << 8u)  | ((vv3) & 0xffu);
    // word 2: v_view bytes 13..16
    let b2w2 = (((vv3 >> 8u) & 0xffu) << 24u) | (((vv3 >> 16u) & 0xffu) << 16u)
             | (((vv3 >> 24u) & 0xffu) << 8u)  | ((vv4) & 0xffu);
    // word 3: v_view bytes 17..20
    let b2w3 = (((vv4 >> 8u) & 0xffu) << 24u) | (((vv4 >> 16u) & 0xffu) << 16u)
             | (((vv4 >> 24u) & 0xffu) << 8u)  | ((vv5) & 0xffu);
    // word 4: v_view bytes 21..24
    let b2w4 = (((vv5 >> 8u) & 0xffu) << 24u) | (((vv5 >> 16u) & 0xffu) << 16u)
             | (((vv5 >> 24u) & 0xffu) << 8u)  | ((vv6) & 0xffu);
    // word 5: v_view bytes 25..28
    let b2w5 = (((vv6 >> 8u) & 0xffu) << 24u) | (((vv6 >> 16u) & 0xffu) << 16u)
             | (((vv6 >> 24u) & 0xffu) << 8u)  | ((vv7) & 0xffu);
    // word 6: v_view bytes 29..31 + 0x80 pad
    // byte 29=(vv7>>8), byte 30=(vv7>>16), byte 31=(vv7>>24), then 0x80
    let b2w6 = (((vv7 >> 8u) & 0xffu) << 24u) | (((vv7 >> 16u) & 0xffu) << 16u)
             | (((vv7 >> 24u) & 0xffu) << 8u)  | 0x80u;
    // words 7..13: zero padding
    // word 14: high 32 bits of bit-length = 0 (message < 2^32 bits)
    // word 15: low  32 bits of bit-length = 728 = 0x000002D8
    var blk2: array<u32, 16>;
    blk2[0]  = b2w0;
    blk2[1]  = b2w1;
    blk2[2]  = b2w2;
    blk2[3]  = b2w3;
    blk2[4]  = b2w4;
    blk2[5]  = b2w5;
    blk2[6]  = b2w6;
    blk2[7]  = 0u;
    blk2[8]  = 0u;
    blk2[9]  = 0u;
    blk2[10] = 0u;
    blk2[11] = 0u;
    blk2[12] = 0u;
    blk2[13] = 0u;
    blk2[14] = 0u;
    blk2[15] = 0x000002D8u;  // 728 bits

    let h2 = sha256_compress(blk2, h1);

    // Return the first byte of the digest (big-endian, so high byte of h2[0])
    return (h2[0] >> 24u) & 0xffu;
}

// ---------------------------------------------------------------------------
// Curve25519 field arithmetic mod p = 2^255 - 19
// Representation: 8 x u32 little-endian limbs (256-bit value).
// Each limb holds 32 bits. Overflow during intermediate ops is handled
// by carry propagation and final reduction.
// ---------------------------------------------------------------------------

// Field element type alias (WGSL doesn't have typedefs, we use array<u32,8>)

// Zero and one
fn fe_zero() -> array<u32, 8> {
    return array<u32, 8>(0u, 0u, 0u, 0u, 0u, 0u, 0u, 0u);
}
fn fe_one() -> array<u32, 8> {
    return array<u32, 8>(1u, 0u, 0u, 0u, 0u, 0u, 0u, 0u);
}

// Conditional swap: if swap==1, exchange a and b; else leave unchanged.
// Constant-time via masking.
fn fe_cswap(a: ptr<function, array<u32,8>>, b: ptr<function, array<u32,8>>, sw: u32) {
    let mask = select(0u, 0xFFFFFFFFu, sw != 0u);
    for (var i = 0u; i < 8u; i++) {
        let t = mask & ((*a)[i] ^ (*b)[i]);
        (*a)[i] ^= t;
        (*b)[i] ^= t;
    }
}

// fe_add: c = (a + b) mod p  — carry-propagating addition then reduce.
// Since p = 2^255 - 19, and values are < p < 2^255, sum < 2^256.
// We do a 256-bit add with carry, then check if result >= p and subtract.
fn fe_add(a: array<u32, 8>, b: array<u32, 8>) -> array<u32, 8> {
    var c: array<u32, 8>;
    var carry: u32 = 0u;
    for (var i = 0u; i < 8u; i++) {
        let s = a[i] + b[i] + carry;
        // detect carry: if s < a[i] (without carry) or s == 0 with carry input
        carry = select(0u, 1u, s < a[i] + carry || (a[i] + carry < a[i]));
        // simpler: use 64-bit trick via two adds
        let lo1 = a[i] + b[i];
        let c1  = select(0u, 1u, lo1 < a[i]);
        let lo2 = lo1 + carry;
        let c2  = select(0u, 1u, lo2 < lo1);
        c[i]  = lo2;
        carry = c1 + c2;
    }
    // carry now holds the 2^256 bit. If set, result = 2^256 + r ≡ r + 2*19 (but
    // we only need mod 2^255-19). Simpler: if top bit set, subtract p.
    // Subtract p = 2^255-19 if c >= p.
    // Since p's top bit is bit 255 (byte 31 bit 7), and our result is 8 x u32:
    // We need c[7] bit 31 to be 0 for a valid < 2^255 field element.
    // If carry==1 or c[7] >= 0x80000000, reduce by adding 19 (since p = 2^255-19,
    // c - p = c - 2^255 + 19 = (c with top bit cleared) + 19).
    let need_reduce = carry | (c[7] >> 31u);
    if (need_reduce != 0u) {
        // clear top bit and add 19
        c[7] &= 0x7FFFFFFFu;
        var cr: u32 = 19u;
        for (var i = 0u; i < 8u; i++) {
            let s = c[i] + cr;
            cr = select(0u, 1u, s < c[i]);
            c[i] = s;
        }
    }
    return c;
}

// fe_sub: c = (a - b) mod p
fn fe_sub(a: array<u32, 8>, b: array<u32, 8>) -> array<u32, 8> {
    // Compute a - b + 2p to ensure positivity.
    // 2p = 2*(2^255-19) = 2^256 - 38.  As 8 x u32: limbs are all 0xFFFFFFFF except
    // limb 0 = 0xFFFFFFD6 (= -38 mod 2^32 = 0xFFFFFFFF - 37) and the 2^256 carry
    // is absorbed. Actually easier: subtract with borrow, then conditionally add p.
    var c: array<u32, 8>;
    var borrow: u32 = 0u;
    for (var i = 0u; i < 8u; i++) {
        let ai = a[i];
        let bi = b[i] + borrow;
        borrow = select(0u, 1u, bi < b[i] || ai < bi);  // simplified below
        // proper:
        let need_borrow = select(0u, 1u, ai < b[i] + borrow);
        c[i] = ai - b[i] - borrow;
        borrow = need_borrow;
    }
    // if borrow==1, result went negative; add p back
    if (borrow != 0u) {
        // add p = 2^255 - 19
        var cr: u32 = 0xFFFFFFEDu;  // -19 mod 2^32 = 0xFFFFFFFF - 18 = 0xFFFFFFED
        // p as limbs: [0xFFFFFFED, 0xFFFFFFFF, ..., 0xFFFFFFFF, 0x7FFFFFFF]
        let p_limbs = array<u32, 8>(
            0xFFFFFFEDu, 0xFFFFFFFFu, 0xFFFFFFFFu, 0xFFFFFFFFu,
            0xFFFFFFFFu, 0xFFFFFFFFu, 0xFFFFFFFFu, 0x7FFFFFFFu
        );
        var carry2: u32 = 0u;
        for (var i = 0u; i < 8u; i++) {
            let lo1 = c[i] + p_limbs[i];
            let ca1 = select(0u, 1u, lo1 < c[i]);
            let lo2 = lo1 + carry2;
            let ca2 = select(0u, 1u, lo2 < lo1);
            c[i]   = lo2;
            carry2 = ca1 + ca2;
        }
    }
    return c;
}

// fe_mul: c = (a * b) mod p  — schoolbook 8x8 multiply then reduce mod 2^255-19.
// We accumulate into a 16-limb product, then fold the top 8 limbs back using
// 2^256 ≡ 2*19 = 38 (mod p), or equivalently 2^255 ≡ 19 (mod p).
fn fe_mul(a: array<u32, 8>, b: array<u32, 8>) -> array<u32, 8> {
    // 16-limb accumulator (each limb may exceed 32 bits during accumulation).
    // We use two u32 per slot: lo and hi.
    var prod_lo: array<u32, 16>;
    var prod_hi: array<u32, 16>;  // overflow bits

    for (var i = 0u; i < 8u; i++) {
        for (var j = 0u; j < 8u; j++) {
            // 32x32 -> 64-bit product
            let ai = a[i];
            let bj = b[j];
            // Split into 16-bit halves to avoid overflow
            let a_lo = ai & 0xFFFFu;
            let a_hi = ai >> 16u;
            let b_lo = bj & 0xFFFFu;
            let b_hi = bj >> 16u;
            let ll = a_lo * b_lo;
            let lh = a_lo * b_hi;
            let hl = a_hi * b_lo;
            let hh = a_hi * b_hi;
            // Combine: full 64-bit = ll + (lh+hl)<<16 + hh<<32
            let mid = lh + hl;
            let mid_lo = mid << 16u;
            let mid_hi = (mid >> 16u) + select(0u, 1u, mid_lo < lh << 16u);
            let lo64_lo = ll + mid_lo;
            let lo64_carry = select(0u, 1u, lo64_lo < ll);
            let lo64_hi = hh + mid_hi + lo64_carry;
            // Add to prod[i+j]
            let k = i + j;
            let new_lo = prod_lo[k] + lo64_lo;
            let c1 = select(0u, 1u, new_lo < prod_lo[k]);
            prod_lo[k] = new_lo;
            let new_hi = prod_hi[k] + lo64_hi + c1;
            prod_hi[k] = new_hi;
        }
    }

    // Propagate carries within prod_lo / prod_hi into a clean 16-limb u32 array
    var p16: array<u32, 16>;
    var carry: u32 = 0u;
    for (var i = 0u; i < 16u; i++) {
        let s = prod_lo[i] + carry;
        let c2 = select(0u, 1u, s < prod_lo[i]);
        p16[i] = s;
        carry = prod_hi[i] + c2;
    }
    // carry after 16 limbs should be 0 for correct inputs < p

    // Reduce: fold limbs 8..15 using 2^256 ≡ 38 (mod p).
    // Actually: x = lo8 + hi8 * 2^256 ≡ lo8 + hi8 * 38 (mod p)
    // Then fold again since hi8*38 may push us past 8 limbs once.
    var lo: array<u32, 8>;
    for (var i = 0u; i < 8u; i++) { lo[i] = p16[i]; }

    // Multiply p16[8..15] by 38 and add to lo
    var carry2: u32 = 0u;
    for (var i = 0u; i < 8u; i++) {
        let hi_limb = p16[i + 8u];
        // hi_limb * 38
        let hlo = (hi_limb & 0xFFFFu) * 38u;
        let hhi = (hi_limb >> 16u) * 38u;
        let prod_word_lo = hlo + (hhi << 16u);
        let prod_word_hi = (hhi >> 16u) + select(0u, 1u, prod_word_lo < hlo);
        // add to lo[i] with carry
        let s1 = lo[i] + prod_word_lo + carry2;
        let c3 = select(0u, 1u, s1 < lo[i]);
        lo[i]  = s1;
        carry2 = prod_word_hi + c3;
    }
    // carry2 now holds overflow past 256 bits. Since p = 2^255-19, 2^256 ≡ 38 (mod p).
    // carry2 * 2^256 ≡ carry2 * 38.  carry2 is small (< 40), so multiply and add.
    let extra = carry2 * 38u;
    var carry3: u32 = extra;
    for (var i = 0u; i < 8u; i++) {
        let s = lo[i] + carry3;
        carry3 = select(0u, 1u, s < lo[i]);
        lo[i] = s;
        if (carry3 == 0u) { break; }
    }
    // Final conditional reduction: if lo >= p, subtract p
    // Check: top bit of lo[7] set?
    if ((lo[7] >> 31u) != 0u) {
        lo[7] &= 0x7FFFFFFFu;
        var cr4: u32 = 19u;
        for (var i = 0u; i < 8u; i++) {
            let s = lo[i] + cr4;
            cr4 = select(0u, 1u, s < lo[i]);
            lo[i] = s;
            if (cr4 == 0u) { break; }
        }
    }
    return lo;
}

// fe_sqr: c = a^2 mod p  (same as fe_mul(a, a), could be optimised but keep simple)
fn fe_sqr(a: array<u32, 8>) -> array<u32, 8> {
    return fe_mul(a, a);
}

// fe_inv: modular inverse via Fermat's little theorem: a^(p-2) mod p
// p-2 = 2^255 - 21.  Use the addition-chain from RFC 7748 / djb's curve25519.
fn fe_inv(z: array<u32, 8>) -> array<u32, 8> {
    // Standard addition chain for p-2 = 2^255 - 21
    var z2   = fe_sqr(z);            // z^2
    var z9   = fe_sqr(fe_sqr(fe_sqr(z2)));
    z9 = fe_mul(z9, z);              // z^9 (via z^8 * z)
    var z11  = fe_mul(z9, z2);       // z^11
    var z2_5_0 = fe_mul(fe_sqr(z11), z9); // z^(2^5-1)
    // Build up to z^(2^255-21) using square-and-multiply
    var t  = z2_5_0;
    var t2 = fe_sqr(t);
    for (var i = 1u; i < 5u; i++) { t2 = fe_sqr(t2); }
    var z2_10_0 = fe_mul(t2, t);
    t = z2_10_0;
    t2 = fe_sqr(t);
    for (var i = 1u; i < 10u; i++) { t2 = fe_sqr(t2); }
    var z2_20_0 = fe_mul(t2, t);
    t = z2_20_0;
    t2 = fe_sqr(t);
    for (var i = 1u; i < 20u; i++) { t2 = fe_sqr(t2); }
    t2 = fe_mul(t2, t);
    for (var i = 0u; i < 10u; i++) { t2 = fe_sqr(t2); }
    var z2_40_0 = fe_mul(t2, z2_10_0);
    t = z2_40_0;
    t2 = fe_sqr(t);
    for (var i = 1u; i < 40u; i++) { t2 = fe_sqr(t2); }
    t2 = fe_mul(t2, t);
    for (var i = 0u; i < 40u; i++) { t2 = fe_sqr(t2); }
    t2 = fe_mul(t2, z2_40_0);
    for (var i = 0u; i < 10u; i++) { t2 = fe_sqr(t2); }
    t2 = fe_mul(t2, z2_10_0);
    for (var i = 0u; i < 5u; i++)  { t2 = fe_sqr(t2); }
    return fe_mul(t2, z2_5_0);
}

// ---------------------------------------------------------------------------
// X25519 scalar multiplication (RFC 7748 §5 Montgomery ladder)
// Input:  scalar k (32 bytes LE, already clamped), u-coord of base point (32 bytes LE)
// Output: u-coord of k*u (32 bytes LE as 8 x u32)
// ---------------------------------------------------------------------------

fn x25519_scalarmult(k: array<u32,8>, u: array<u32,8>) -> array<u32,8> {
    // Clamp is already applied before calling (done in main)
    var x1 = u;
    var x2 = fe_one();
    var z2 = fe_zero();
    var x3 = u;
    var z3 = fe_one();
    var swap: u32 = 0u;

    // a24 = 121665
    let a24 = array<u32,8>(121665u, 0u, 0u, 0u, 0u, 0u, 0u, 0u);

    // Iterate bits 254 down to 0
    for (var i_outer = 0u; i_outer < 8u; i_outer++) {
        let limb_idx = 7u - i_outer;
        var limb = k[limb_idx];
        var bit_start: u32 = 32u;
        if (i_outer == 0u) { bit_start = 31u; } // skip bit 255 (always 0 after clamp)

        for (var bit = bit_start; bit > 0u; bit--) {
            let k_t = (limb >> (bit - 1u)) & 1u;
            swap ^= k_t;
            fe_cswap(&x2, &x3, swap);
            fe_cswap(&z2, &z3, swap);
            swap = k_t;

            let A  = fe_add(x2, z2);
            let AA = fe_sqr(A);
            let B  = fe_sub(x2, z2);
            let BB = fe_sqr(B);
            let E  = fe_sub(AA, BB);
            let C  = fe_add(x3, z3);
            let D  = fe_sub(x3, z3);
            let DA = fe_mul(D, A);
            let CB = fe_mul(C, B);
            x3 = fe_sqr(fe_add(DA, CB));
            z3 = fe_mul(x1, fe_sqr(fe_sub(DA, CB)));
            x2 = fe_mul(AA, BB);
            z2 = fe_mul(E, fe_add(AA, fe_mul(a24, E)));
        }
    }

    fe_cswap(&x2, &x3, swap);
    fe_cswap(&z2, &z3, swap);

    return fe_mul(x2, fe_inv(z2));
}

// ---------------------------------------------------------------------------
// Helper: load 8 x u32 limbs from storage buffer at byte offset (in u32 units)
// ---------------------------------------------------------------------------

fn load_fe(buf: ptr<storage, array<u32>, read>, base: u32) -> array<u32,8> {
    return array<u32,8>(
        buf[base],     buf[base+1u], buf[base+2u], buf[base+3u],
        buf[base+4u], buf[base+5u], buf[base+6u], buf[base+7u]
    );
}

// ---------------------------------------------------------------------------
// Clamp a Curve25519 scalar (RFC 7748 §5)
// Operates on 8 x u32 LE limbs.
// ---------------------------------------------------------------------------

fn clamp_scalar(k: array<u32,8>) -> array<u32,8> {
    var c = k;
    c[0] &= 0xFFFFFFF8u;   // clear bits 0,1,2 of byte 0  (limb 0 low byte)
    c[7] &= 0x7FFFFFFFu;   // clear bit 255 (bit 31 of limb 7)
    c[7] |= 0x40000000u;   // set   bit 254 (bit 30 of limb 7)
    return c;
}

// ---------------------------------------------------------------------------
// Main compute entry point
// ---------------------------------------------------------------------------

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let idx = gid.x;
    if (idx >= params.count) { return; }

    // Load this thread's ephemeral pubkey (8 u32 limbs = 32 bytes, LE)
    let eph_base = idx * 8u;
    let eph = load_fe(&ephemeral_pubkeys, eph_base);

    // Load stored view tag for this announcement (packed: 4 tags per u32, LE byte order)
    let tag_word = view_tags[idx / 4u];
    let tag_shift = (idx % 4u) * 8u;
    let stored_tag = (tag_word >> tag_shift) & 0xffu;

    // Compute SHA-256 view-tag from public data
    let computed_tag = sha256_view_tag(eph, params.view_pub_x);

    // Result bitmask index
    let word_idx = idx / 32u;
    let bit_idx  = idx % 32u;

    if (computed_tag != stored_tag) {
        // Tag mismatch — clear bit (it may already be 0, but ensure it)
        // No atomics needed here if each thread writes to its own bit atomically
        // We use atomicAnd to clear: result[word_idx] &= ~(1 << bit_idx)
        // WGSL requires atomic storage for atomicAnd. We'll write 0 to a separate
        // per-element results array instead (simpler, avoids atomic type requirement).
        results[idx] = 0u;
        return;
    }

    // View tag passed — perform X25519 ECDH
    let priv_scalar = clamp_scalar(params.view_priv_x);
    let shared = x25519_scalarmult(priv_scalar, eph);

    // Output the first byte of the shared secret as a secondary match signal.
    // The host CPU handles final hashToScalar + point-add + address comparison.
    // Non-zero result means "candidate for full CPU check".
    results[idx] = 1u | (shared[0] << 8u);  // low bit = passed, bits 8..15 = shared[0]
}
