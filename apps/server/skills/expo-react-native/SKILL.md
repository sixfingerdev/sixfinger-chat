---
name: expo-react-native
description: Work on Expo / React Native mobile apps (Android and iOS) with TypeScript: add screens, navigation with expo-router, components, styles and fixes, and verify them without a phone using type checks and a web export. Use when the user mentions Expo, React Native, a mobile app, an Android or iOS app, expo-router or a screen/component of an existing mobile project. Do not use for plain web pages (static-web-app) or Vite web apps (vite-react-app).
triggers: [expo, react native, mobil uygulama, mobile app, android uygulaması, ios uygulaması, ekran ekle, screen, expo-router, navigation, bileşen, component, apk, telefon uygulaması, flatlist, safe area, klavye, keyboard, tab bar, drawer, native, metro]
---

# Expo / React Native

## When to use
- The repo has an Expo app (`app.json` / `app.config.*` + `expo` in package.json) or the user asks for a new mobile app/screen.

## When NOT to use
- Web-only work. A build for the user's phone (an APK/IPA) cannot be produced here: say so honestly and give the command they run on their machine (`eas build` / `npx expo run:android`).

## Workflow (existing Expo project)
1. **Orient** (one `bash` call): `cat package.json | head -40; ls; ls app src 2>/dev/null; cat app.json | head -30`. Find: router type (`app/` directory = expo-router, otherwise react-navigation), where components, theme and API helpers live, styling approach (StyleSheet, a theme object, NativeWind).
2. **Follow the project's conventions**: same file layout, same components (`Button`, `Text`), same theme tokens. Read one similar existing screen with `read` before writing a new one.
3. `todo` plan for 3+ steps: route/screen file, components, state/data, navigation entry (link/tab), typecheck, web export check.
4. **expo-router rules**: a file under `app/` is a route (`app/settings.tsx` -> `/settings`, `app/[id].tsx` -> dynamic, `app/(tabs)/` -> group). Default-export the screen component. Register custom stack options in `app/_layout.tsx` when the project lists screens explicitly. Navigate with `router.push('/path')` or `<Link href="/path">`.
5. Write TypeScript components with `StyleSheet.create` (or the project's style system). Handle: loading, empty and error states.
6. **Verify without a device** (run in the app directory, installs may take minutes: `timeout_seconds` 600 or `background=true` + `job_output`):
   - Types: `npx tsc --noEmit` -> must print nothing.
   - Lint if configured: `npx eslint <changed files>`.
   - Bundle check: `npx expo export --platform web --output-dir /tmp/expo-web` (confirms every import resolves and the bundle builds). If native-only modules break the web build, say that web export failed for that reason and rely on tsc.
   - Pure logic: test with `node`/`vitest` if the project has it.
7. Tell the user what you could NOT test (touch gestures, keyboard behavior, real device performance, native permissions).

## New project
`npx create-expo-app@latest <name> --template default` (needs network; if blocked, stop and tell the user). Then `cd <name> && npx tsc --noEmit`. Do not run `npm run reset-project` unless the user wants the blank template. Keep the first version to one working screen.

## Common pitfalls (check these first when something is wrong)
- **Safe area**: wrap screens in `SafeAreaView` from `react-native-safe-area-context` or use `useSafeAreaInsets()`; bottom inset for fixed bars.
- **Keyboard**: inputs near the bottom need `KeyboardAvoidingView` (behavior `padding` on iOS, `height` on Android) or the project's keyboard helper.
- **Lists**: use `FlatList` with `keyExtractor`; never `ScrollView` + `map` for long lists. Memoize `renderItem` for big lists.
- **Styles**: no CSS. Units are numbers (dp). `flex: 1` on containers; `flexDirection` defaults to `column`. Text must be inside `<Text>`.
- **Platform differences**: `Platform.OS`, `Platform.select`. Shadows: iOS `shadow*`, Android `elevation`.
- **Imports**: images/fonts via `require('./x.png')` / `expo-font`; native modules need `npx expo install <pkg>` (picks the compatible version) instead of `npm install`.
- **State**: `useState`/`useReducer`; share state with a small store (zustand if the project uses it) rather than prop drilling through 4+ levels.
- **Async**: always handle rejected promises (`try/catch`) and show an error state; avoid state updates after unmount.
- **Expo Go limits**: custom native code needs a dev build; stay with Expo SDK modules unless the project already has them.

## Rules / Do not
- Do not edit `android/` or `ios/` folders by hand unless the user asks (they are generated).
- Do not add a navigation library when expo-router or react-navigation is already there.
- Do not leave `console.log` debug output or placeholder screens.
- Do not claim "works on device". Say "typechecks and the web bundle builds".

## Final answer
List the files you added/changed, how to see it (`npx expo start` then open on the phone/emulator, or the route path), what you verified (tsc, export) and what you could not (device behavior).
