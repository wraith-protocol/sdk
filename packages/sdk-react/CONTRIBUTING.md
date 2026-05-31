# Contributing to @wraith-protocol/sdk-react

## Development Setup

```bash
# Install dependencies from workspace root
pnpm install

# Build the SDK first (required dependency)
pnpm build

# Build the React package
pnpm build:react

# Run tests
pnpm test:react

# Run tests in watch mode
cd packages/sdk-react
pnpm test:watch
```

## Project Structure

```
packages/sdk-react/
├── src/
│   ├── index.ts                          # Public API exports
│   ├── types.ts                          # TypeScript types
│   ├── useStellarStealthKeys.ts          # Key derivation hook
│   ├── useStellarAnnouncementScan.ts     # Payment scanning hook
│   ├── useStellarSendStealthPayment.ts   # Payment sending hook
│   ├── useStellarName.ts                 # Name resolution hook
│   └── useStellarBalance.ts              # Balance fetching hook
├── test/
│   ├── setup.ts                          # Test configuration
│   └── *.test.tsx                        # Unit tests
├── package.json
├── tsconfig.json
├── tsup.config.ts                        # Build configuration
└── vitest.config.ts                      # Test configuration
```

## Design Principles

### 1. Standalone Hooks
Each hook is independent and doesn't require global state or providers. This keeps the API simple and composable.

### 2. React Strict Mode Safe
All hooks handle React 18 Strict Mode correctly:
- No side effects in render
- Proper cleanup in useEffect
- Ref-based guards against double-fire

### 3. Declarative State
Hooks return declarative state for UI rendering:
- `isLoading` / `isScanning` / `isResolving` for loading states
- `error` for error handling
- `refetch` / `reset` for user actions

### 4. Auto-polling with Control
Hooks that fetch data support:
- Configurable polling intervals
- Manual refetch
- Enable/disable control
- Automatic cleanup

### 5. Memoization
Expensive operations (key derivation, name resolution) are memoized and only re-run when inputs change.

## Testing Guidelines

### Unit Tests
- Test all hook states (idle, loading, success, error)
- Test React Strict Mode compatibility
- Test cleanup on unmount
- Test concurrent operation prevention
- Mock external dependencies (@wraith-protocol/sdk, @stellar/stellar-sdk)

### Example Test Structure
```tsx
describe('useMyHook', () => {
  it('should handle initial state', () => {
    // Test initial render
  });

  it('should handle success case', async () => {
    // Test successful operation
  });

  it('should handle errors', async () => {
    // Test error handling
  });

  it('should cleanup on unmount', () => {
    // Test cleanup
  });
});
```

## Adding New Hooks

1. Create hook file in `src/`
2. Define types in `src/types.ts`
3. Export from `src/index.ts`
4. Add comprehensive tests
5. Update README with usage example
6. Ensure bundle size stays under 5 KB gzipped

## Bundle Size

Target: ≤ 5 KB gzipped for Stellar-only usage

Check bundle size:
```bash
pnpm build:react
cd packages/sdk-react/dist
gzip -c index.js | wc -c
```

## Code Style

- Use TypeScript strict mode
- Prefer `useCallback` for functions passed to children
- Use `useRef` for mutable values that don't trigger re-renders
- Document complex logic with comments
- Keep hooks focused and single-purpose

## Common Patterns

### Preventing Concurrent Operations
```tsx
const operationRef = useRef(false);

const doOperation = useCallback(async () => {
  if (operationRef.current) return;
  
  operationRef.current = true;
  try {
    // ... operation
  } finally {
    operationRef.current = false;
  }
}, []);
```

### Cleanup on Unmount
```tsx
const mountedRef = useRef(true);

useEffect(() => {
  return () => {
    mountedRef.current = false;
  };
}, []);

// In async operations
if (!mountedRef.current) return;
```

### Debouncing
```tsx
const timerRef = useRef<NodeJS.Timeout | null>(null);

useEffect(() => {
  if (timerRef.current) {
    clearTimeout(timerRef.current);
  }

  timerRef.current = setTimeout(() => {
    // ... debounced operation
  }, delay);

  return () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }
  };
}, [dependency]);
```

## Release Process

1. Update version in `package.json`
2. Update CHANGELOG.md
3. Run tests: `pnpm test:react`
4. Build: `pnpm build:react`
5. Commit and tag
6. Publish: `pnpm publish --access public`
