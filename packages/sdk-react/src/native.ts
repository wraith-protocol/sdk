import { setPlatform } from './platform';
import { nativePlatform } from './platform-native';

setPlatform(nativePlatform);

export * from './hooks';
