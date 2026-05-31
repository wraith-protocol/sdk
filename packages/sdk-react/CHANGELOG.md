# Changelog

All notable changes to @wraith-protocol/sdk-react will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2024-01-XX

### Added

- Initial release of @wraith-protocol/sdk-react
- `useStellarStealthKeys` - Derive stealth keys from wallet signature with memoization
- `useStellarAnnouncementScan` - Scan for stealth payments with auto-polling
- `useStellarSendStealthPayment` - Send stealth payments with declarative state
- `useStellarName` - Resolve Stellar names with debouncing and caching
- `useStellarBalance` - Fetch account balances with auto-polling
- Full TypeScript support with exported types
- React 18+ Strict Mode compatibility
- Comprehensive unit tests with @testing-library/react
- Example React application demonstrating all hooks
- Bundle size ≤ 5 KB gzipped for Stellar-only usage

### Notes

- React 18+ required
- Peer dependencies: @wraith-protocol/sdk, @stellar/stellar-sdk, react
- No global state library required - hooks are standalone
- React Native compatible (after SDK #15 lands)
