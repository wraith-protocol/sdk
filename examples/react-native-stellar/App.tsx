import './polyfills';
import React, { useMemo } from 'react';
import { SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  deriveStealthKeys,
  generateStealthAddress,
  scanAnnouncements,
} from '@wraith-protocol/sdk/chains/stellar';

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

const sampleSignature = new Uint8Array(Array.from({ length: 64 }, (_, i) => i + 1));

const announcementsFixture = (stealthAddress: string, ephemeralPubKey: Uint8Array, viewTag: number) => [
  {
    schemeId: 1,
    stealthAddress,
    caller: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
    ephemeralPubKey: bytesToHex(ephemeralPubKey),
    metadata: `0x${bytesToHex(new Uint8Array([viewTag]))}`,
  },
];

export default function App() {
  const { keys, stealth, matches } = useMemo(() => {
    const keys = deriveStealthKeys(sampleSignature);
    const stealth = generateStealthAddress(keys.spendingPubKey, keys.viewingPubKey, new Uint8Array(32).fill(0x42));
    const announcements = announcementsFixture(stealth.stealthAddress, stealth.ephemeralPubKey, stealth.viewTag);
    const matches = scanAnnouncements(announcements, keys.viewingKey, keys.spendingPubKey, keys.spendingScalar);
    return { keys, stealth, matches };
  }, []);

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>Wraith React Native Stellar Example</Text>
        <View style={styles.card}>
          <Text style={styles.heading}>Derived Keys</Text>
          <Text style={styles.value}>Spending public key: {bytesToHex(keys.spendingPubKey)}</Text>
          <Text style={styles.value}>Viewing public key: {bytesToHex(keys.viewingPubKey)}</Text>
        </View>
        <View style={styles.card}>
          <Text style={styles.heading}>Generated Stealth Address</Text>
          <Text style={styles.value}>{stealth.stealthAddress}</Text>
          <Text style={styles.value}>View Tag: {stealth.viewTag}</Text>
        </View>
        <View style={styles.card}>
          <Text style={styles.heading}>Scan Result</Text>
          <Text style={styles.value}>Matches found: {matches.length}</Text>
          <Text style={styles.value}>{matches.length > 0 ? matches[0].stealthAddress : 'none'}</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0A1222',
  },
  content: {
    padding: 20,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: '#ffffff',
    marginBottom: 20,
  },
  card: {
    marginBottom: 16,
    padding: 16,
    backgroundColor: '#111C38',
    borderRadius: 12,
  },
  heading: {
    fontSize: 18,
    fontWeight: '700',
    color: '#E0E7FF',
    marginBottom: 8,
  },
  value: {
    color: '#C1C9FF',
    marginBottom: 4,
    fontSize: 14,
  },
});
