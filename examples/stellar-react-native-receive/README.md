# Wraith Stellar — React Native Receive Example

Bare React Native example showing how to receive stealth payments using `@wraith-protocol/sdk-react/native`.

## Setup

### 1. Init the RN project

```bash
npx @react-native-community/cli init StellarReactNativeReceive --template @react-native-community/template
cd StellarReactNativeReceive
```

### 2. Copy these files in

```bash
cp -r path/to/sdk/examples/stellar-react-native-receive/* .
```

### 3. Install dependencies

```bash
npm install
cd ios && pod install && cd ..
```

### 4. Run

```bash
npx react-native run-ios
# or
npx react-native run-android
```

## Usage

1. Paste a 64-byte hex secret key (128 hex chars) into the input field.
2. Tap **Derive Stealth Keys** to generate your stealth keys and meta-address.
3. Share the meta-address with senders so they can send you stealth payments.
4. Use `useStellarAnnouncementScan` from `@wraith-protocol/sdk-react/native` to scan for incoming payments.

> The monorepo aliasing in `babel.config.js` and `metro.config.js` lets you import from the local SDK source. For a standalone app, replace these with published package versions.
