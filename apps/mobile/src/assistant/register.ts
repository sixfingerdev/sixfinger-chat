import { AppRegistry, Platform } from 'react-native';
import { AssistantRoot } from './AssistantRoot.tsx';

// Asistan penceresi (güç tuşu / karo): ana uygulamayla aynı React örneğinde ikinci kök bileşen.
if (Platform.OS === 'android') AppRegistry.registerComponent('SixfingerAssistant', () => AssistantRoot);
