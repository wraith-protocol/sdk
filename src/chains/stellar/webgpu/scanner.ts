/// <reference types="@webgpu/types" />

/**
 * WebGPUStellarScanner — batch view-tag prefilter + X25519 ECDH via WebGPU.
 *
 * Architecture:
 *   GPU pipeline: SHA-256 view-tag check + X25519 scalar mult for survivors
 *   CPU fallback: used when WebGPU is unavailable (Node.js, old browsers, SSR)
 *
 * The scanner handles only the first two gates of the scan hot-path:
 *   1. SHA-256 view-tag prefilter  (~255/256 rejection)
 *   2. X25519 shared-secret derivation for the ~0.4% that pass
 *
 * The caller is responsible for the remaining CPU-only steps (hashToScalar,
 * ed25519 point-add, Stellar address encode) on the small set of survivors.
 */

import { edwardsToMontgomeryPub, edwardsToMontgomeryPriv } from '@noble/curves/ed25519';
import { computeAnnouncementViewTag, computeSharedSecret } from '../stealth';

// ---------------------------------------------------------------------------
// WGSL shader source — inlined at build time.
// In a real browser build this would be imported via ?raw or bundled.
// ---------------------------------------------------------------------------

// We import the WGSL as a raw string. In Node/vitest this is skipped anyway
// because WebGPU is not available. In a browser build, the bundler (e.g. Vite)
// handles `?raw` imports. Here we use a dynamic require shim for tests.
function loadShaderSource(): string {
  // In environments where fs is available (Node.js tests), read the file.
  // In browsers the shader is expected to be injected by the bundler.
  try {
    // Only reached in Node test environments — WebGPU won't be available anyway
    // so this path exists purely for source-inspection tests.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require('fs') as typeof import('fs');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const path = require('path') as typeof import('path');
    return fs.readFileSync(path.join(__dirname, 'x25519.wgsl'), 'utf8');
  } catch {
    return '/* shader not available */';
  }
}

/** Returns true if WebGPU is available in the current environment. */
export function isWebGPUAvailable(): boolean {
  return typeof navigator !== 'undefined' && 'gpu' in navigator && navigator.gpu != null;
}

/**
 * Result of a batched GPU scan pass.
 * indices: the announcement indices that passed both view-tag and X25519 checks.
 */
export interface GpuScanResult {
  /** Indices of announcements that passed the GPU prefilter. */
  passingIndices: number[];
  /** True if the GPU path was used; false if CPU fallback ran. */
  usedGpu: boolean;
}

/** GPU pipeline + buffer state. Destroyed via destroy(). */
interface GpuState {
  device: GPUDevice;
  pipeline: GPUComputePipeline;
  paramsBuffer: GPUBuffer;
  viewPubX: Uint8Array; // 32-byte X25519 public key (Montgomery)
  viewPrivX: Uint8Array; // 32-byte X25519 private scalar (Montgomery)
}

export class WebGPUStellarScanner {
  private gpu: GpuState | null = null;
  private readonly viewingKey: Uint8Array;
  private readonly viewingPubKey: Uint8Array;

  private constructor(viewingKey: Uint8Array, viewingPubKey: Uint8Array) {
    this.viewingKey = viewingKey;
    this.viewingPubKey = viewingPubKey;
  }

  /**
   * Create a scanner. Returns null if WebGPU is unavailable.
   * Setup (adapter → device → pipeline) is done once here, amortised over
   * multiple scanViewTags() calls.
   */
  static async create(
    viewingKey: Uint8Array,
    viewingPubKey: Uint8Array,
  ): Promise<WebGPUStellarScanner | null> {
    const scanner = new WebGPUStellarScanner(viewingKey, viewingPubKey);
    if (!isWebGPUAvailable()) return null;

    try {
      await scanner.initGpu();
      return scanner;
    } catch {
      return null;
    }
  }

  private async initGpu(): Promise<void> {
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) throw new Error('No WebGPU adapter available');

    const device = await adapter.requestDevice();

    const shaderSource = loadShaderSource();
    const shaderModule = device.createShaderModule({ code: shaderSource });

    const pipeline = await device.createComputePipelineAsync({
      layout: 'auto',
      compute: { module: shaderModule, entryPoint: 'main' },
    });

    // Convert ed25519 keys to X25519 (Montgomery) form
    const viewPubX = edwardsToMontgomeryPub(this.viewingPubKey);
    const viewPrivX = edwardsToMontgomeryPriv(this.viewingKey);

    // Params uniform buffer: view_pub_x (32) + view_priv_x (32) + count (4) + pad (12) = 80 bytes
    const paramsBuffer = device.createBuffer({
      size: 80,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    // Write static key data (count will be written per-dispatch)
    const paramsData = new Uint8Array(80);
    paramsData.set(viewPubX, 0);
    paramsData.set(viewPrivX, 32);
    device.queue.writeBuffer(paramsBuffer, 0, paramsData);

    this.gpu = { device, pipeline, paramsBuffer, viewPubX, viewPrivX };
  }

  /**
   * Batch-scan N announcements using the GPU prefilter.
   *
   * @param ephemeralPubKeys  Array of N 32-byte ephemeral public keys (ed25519 compressed)
   * @param viewTags          Array of N view-tag bytes (0–255)
   * @returns GpuScanResult with passing indices and whether GPU was used
   */
  async scanViewTags(ephemeralPubKeys: Uint8Array[], viewTags: number[]): Promise<GpuScanResult> {
    const N = ephemeralPubKeys.length;
    if (N === 0) return { passingIndices: [], usedGpu: false };

    if (!this.gpu) {
      return this.cpuFallback(ephemeralPubKeys, viewTags);
    }

    try {
      return await this.gpuScan(ephemeralPubKeys, viewTags);
    } catch {
      // GPU error — fall back to CPU silently
      return this.cpuFallback(ephemeralPubKeys, viewTags);
    }
  }

  private async gpuScan(
    ephemeralPubKeys: Uint8Array[],
    viewTags: number[],
  ): Promise<GpuScanResult> {
    const { device, pipeline, paramsBuffer, viewPubX, viewPrivX } = this.gpu!;
    const N = ephemeralPubKeys.length;

    // ---- Ephemeral pubkeys buffer: N * 32 bytes ----
    // The keys arrive as ed25519 compressed points; convert to X25519 (Montgomery) form.
    const ephBuf = new Uint8Array(N * 32);
    for (let i = 0; i < N; i++) {
      const montPub = edwardsToMontgomeryPub(ephemeralPubKeys[i]);
      ephBuf.set(montPub, i * 32);
    }

    const ephBuffer = device.createBuffer({
      size: ephBuf.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(ephBuffer, 0, ephBuf);

    // ---- View tags buffer: ceil(N/4) u32s, packed u8 LE ----
    const tagWordCount = Math.ceil(N / 4);
    const tagData = new Uint32Array(tagWordCount);
    for (let i = 0; i < N; i++) {
      const shift = (i % 4) * 8;
      tagData[Math.floor(i / 4)] |= (viewTags[i] & 0xff) << shift;
    }
    const tagBuffer = device.createBuffer({
      size: tagData.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(tagBuffer, 0, tagData);

    // ---- Params: update count ----
    const paramsUpdate = new Uint8Array(80);
    paramsUpdate.set(viewPubX, 0);
    paramsUpdate.set(viewPrivX, 32);
    new DataView(paramsUpdate.buffer).setUint32(64, N, true);
    device.queue.writeBuffer(paramsBuffer, 0, paramsUpdate);

    // ---- Results buffer: N u32s (1 per announcement) ----
    const resultsByteLen = N * 4;
    const resultsBuffer = device.createBuffer({
      size: resultsByteLen,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    });
    const readbackBuffer = device.createBuffer({
      size: resultsByteLen,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });

    // ---- Bind group ----
    const bindGroup = device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: ephBuffer } },
        { binding: 1, resource: { buffer: tagBuffer } },
        { binding: 2, resource: { buffer: paramsBuffer } },
        { binding: 3, resource: { buffer: resultsBuffer } },
      ],
    });

    // ---- Dispatch ----
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(Math.ceil(N / 64));
    pass.end();
    encoder.copyBufferToBuffer(resultsBuffer, 0, readbackBuffer, 0, resultsByteLen);
    device.queue.submit([encoder.finish()]);

    // ---- Readback ----
    await readbackBuffer.mapAsync(GPUMapMode.READ);
    const resultData = new Uint32Array(readbackBuffer.getMappedRange().slice(0));
    readbackBuffer.unmap();

    // ---- Collect passing indices ----
    const passingIndices: number[] = [];
    for (let i = 0; i < N; i++) {
      if (resultData[i] !== 0) passingIndices.push(i);
    }

    // ---- Cleanup per-dispatch buffers ----
    ephBuffer.destroy();
    tagBuffer.destroy();
    resultsBuffer.destroy();
    readbackBuffer.destroy();

    return { passingIndices, usedGpu: true };
  }

  /** CPU fallback: runs the same view-tag logic as scan.ts */
  private cpuFallback(ephemeralPubKeys: Uint8Array[], viewTags: number[]): GpuScanResult {
    const passingIndices: number[] = [];
    for (let i = 0; i < ephemeralPubKeys.length; i++) {
      const computed = computeAnnouncementViewTag(ephemeralPubKeys[i], this.viewingPubKey);
      if (computed === viewTags[i]) {
        passingIndices.push(i);
      }
    }
    return { passingIndices, usedGpu: false };
  }

  /**
   * Release GPU resources. The scanner cannot be used after this.
   */
  destroy(): void {
    if (this.gpu) {
      this.gpu.paramsBuffer.destroy();
      this.gpu.device.destroy();
      this.gpu = null;
    }
  }
}
