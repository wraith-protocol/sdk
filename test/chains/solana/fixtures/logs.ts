/** Builders for Solana transaction-log and signature fixtures. */

export const ANNOUNCEMENT_EVENT_DISCRIMINATOR = [0xfa, 0xb0, 0x2a, 0xef, 0x3c, 0xad, 0x36, 0x88];

/** Options for {@link announcementEvent}. */
export interface AnnouncementEventOptions {
  schemeId?: number;
  stealthAddress?: Uint8Array;
  caller?: Uint8Array;
  ephemeralPubKey?: Uint8Array;
  metadata?: Uint8Array;
  /** Overrides the encoded metadata length, for adversarial fixtures. */
  metadataLength?: number;
}

/** Encodes a valid Anchor announcement event as a `Program data:` log line. */
export function announcementEvent(options: AnnouncementEventOptions = {}): string {
  const {
    schemeId = 1,
    stealthAddress = Uint8Array.from({ length: 32 }, () => 0x11),
    caller = Uint8Array.from({ length: 32 }, () => 0x22),
    ephemeralPubKey = Uint8Array.from({ length: 32 }, () => 0x33),
    metadata = Uint8Array.from([0x07]),
    metadataLength = metadata.length,
  } = options;

  const bytes = new Uint8Array(112 + metadata.length);
  bytes.set(ANNOUNCEMENT_EVENT_DISCRIMINATOR, 0);
  const view = new DataView(bytes.buffer);
  view.setUint32(8, schemeId, true);
  bytes.set(stealthAddress, 12);
  bytes.set(caller, 44);
  bytes.set(ephemeralPubKey, 76);
  view.setUint32(108, metadataLength, true);
  bytes.set(metadata, 112);

  return `Program data: ${Buffer.from(bytes).toString('base64')}`;
}

/** Encodes arbitrary bytes as a `Program data:` log line. */
export function programData(bytes: Uint8Array): string {
  return `Program data: ${Buffer.from(bytes).toString('base64')}`;
}
