import 'react-native-get-random-values';
import { Buffer } from 'buffer';
import { AppRegistry } from 'react-native';
import App from './App';
import { name as appName } from './app.json';

if (typeof globalThis.Buffer === 'undefined') {
  globalThis.Buffer = Buffer;
}

AppRegistry.registerComponent(appName, () => App);
