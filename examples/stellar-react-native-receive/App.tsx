import React, { useMemo, useState, useCallback } from 'react';
import {
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { useStellarStealthKeys, setPlatform } from '@wraith-protocol/sdk-react/native';
import { encodeStealthMetaAddress, bytesToHex } from '@wraith-protocol/sdk/chains/stellar';

function parseHex(hex: string): Uint8Array | null {
  const cleaned = hex.trim();
  if (!/^[0-9a-fA-F]+$/.test(cleaned) || cleaned.length % 2 !== 0) return null;
  const bytes = new Uint8Array(cleaned.length / 2);
  for (let i = 0; i < cleaned.length; i += 2) {
    bytes[i / 2] = parseInt(cleaned.substring(i, i + 2), 16);
  }
  return bytes;
}

export default function App() {
  const { keys, generate } = useStellarStealthKeys();
  const [input, setInput] = useState('');
  const [error, setError] = useState<string | null>(null);

  const handleDerive = useCallback(() => {
    setError(null);
    const trimmed = input.trim();
    if (!trimmed) {
      setError('Enter a 64-byte hex secret key.');
      return;
    }
    const bytes = parseHex(trimmed);
    if (!bytes) {
      setError('Invalid hex. Must be even-length hex string (128 chars).');
      return;
    }
    if (bytes.length !== 64) {
      setError(`Expected 64 bytes, got ${bytes.length}.`);
      return;
    }
    try {
      generate(bytes);
    } catch (e: any) {
      setError(e.message ?? 'Key derivation failed.');
    }
  }, [input, generate]);

  const metaAddress = keys && encodeStealthMetaAddress(keys.spendingPubKey, keys.viewingPubKey);

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>Wraith Stellar {'\u2014'} Receive</Text>

        <Text style={styles.label}>Secret Key (hex, 64 bytes)</Text>
        <TextInput
          style={styles.input}
          multiline
          value={input}
          onChangeText={setInput}
          placeholder="aa... (128 hex chars)"
          placeholderTextColor="#5A6B8C"
          autoCapitalize="none"
          autoCorrect={false}
        />

        <TouchableOpacity style={styles.button} onPress={handleDerive}>
          <Text style={styles.buttonText}>Derive Stealth Keys</Text>
        </TouchableOpacity>

        {error && (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        {keys && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Keys</Text>
            {[
              ['Spending Secret', bytesToHex(keys.spendingKey)],
              ['Spending Public', bytesToHex(keys.spendingPubKey)],
              ['Viewing Secret', bytesToHex(keys.viewingKey)],
              ['Viewing Public', bytesToHex(keys.viewingPubKey)],
              ['Spending Scalar', keys.spendingScalar.toString()],
            ].map(([label, val]) => (
              <View key={label} style={styles.row}>
                <Text style={styles.labelText}>{label}</Text>
                <Text style={styles.monoText} selectable>
                  {val}
                </Text>
              </View>
            ))}

            {metaAddress && (
              <View style={styles.metaBox}>
                <Text style={styles.labelText}>Stealth Meta-Address</Text>
                <Text style={styles.metaText} selectable>
                  {metaAddress}
                </Text>
              </View>
            )}
          </View>
        )}
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
    fontSize: 26,
    fontWeight: '700',
    color: '#ffffff',
    marginBottom: 24,
  },
  label: {
    color: '#C1C9FF',
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 8,
  },
  input: {
    backgroundColor: '#111C38',
    color: '#E0E7FF',
    fontFamily: 'monospace',
    fontSize: 14,
    borderRadius: 8,
    padding: 12,
    minHeight: 80,
    borderWidth: 1,
    borderColor: '#2A3A5E',
    marginBottom: 12,
  },
  button: {
    backgroundColor: '#4F6EF7',
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: 'center',
    marginBottom: 16,
  },
  buttonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
  },
  errorBox: {
    backgroundColor: '#3D1515',
    padding: 12,
    borderRadius: 8,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#6B2020',
  },
  errorText: {
    color: '#FF6B6B',
    fontSize: 14,
  },
  card: {
    backgroundColor: '#111C38',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#E0E7FF',
    marginBottom: 16,
  },
  row: {
    marginBottom: 12,
  },
  labelText: {
    color: '#8892B0',
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 4,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  monoText: {
    color: '#C1C9FF',
    fontFamily: 'monospace',
    fontSize: 13,
    lineHeight: 20,
  },
  metaBox: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#2A3A5E',
  },
  metaText: {
    color: '#C1C9FF',
    fontFamily: 'monospace',
    fontSize: 13,
    lineHeight: 20,
    backgroundColor: '#0A1222',
    padding: 10,
    borderRadius: 6,
    overflow: 'hidden',
  },
});
