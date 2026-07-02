#!/bin/bash
set -e

# We want our changes (the branch being rebased, --theirs) for:
git checkout --theirs pnpm-workspace.yaml pnpm-lock.yaml src/chains/stellar/index.ts src/chains/stellar/announcements.ts

# We want upstream's changes (the new base, --ours) for stealth and react-native, because they contain new logic we didn't touch
git checkout --ours src/chains/stellar/stealth.ts src/compat/react-native.ts

# We want to properly resolve test/chains/stellar/scan.test.ts (keep upstream's imports, keep our tests)
# Let's just use --theirs for scan.test.ts, since we completely refactored the tests for streaming!
git checkout --theirs test/chains/stellar/scan.test.ts

# Remove the deleted files
git rm src/chains/stellar/fee-estimation.ts test/chains/stellar/bench/stellar.bench.ts test/chains/stellar/fee-estimation.integration.test.ts test/chains/stellar/fee-estimation.test.ts

git add pnpm-workspace.yaml pnpm-lock.yaml src/chains/stellar/index.ts src/chains/stellar/announcements.ts src/chains/stellar/stealth.ts src/compat/react-native.ts test/chains/stellar/scan.test.ts

# Continue rebase
GIT_EDITOR=true git rebase --continue
