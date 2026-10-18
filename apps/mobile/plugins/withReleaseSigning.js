const { withAppBuildGradle } = require('expo/config-plugins');

/**
 * Release APK'yı ortam değişkenlerindeki anahtarla imzalar (CI için). Değişkenler yoksa Expo'nun
 * varsayılan debug anahtarı kullanılır: APK kurulabilir ama mağaza için uygun olmaz.
 *   ANDROID_KEYSTORE_PATH, ANDROID_KEYSTORE_PASSWORD, ANDROID_KEY_ALIAS, ANDROID_KEY_PASSWORD
 */
module.exports = function withReleaseSigning(config) {
  return withAppBuildGradle(config, (cfg) => {
    let src = cfg.modResults.contents;
    if (src.includes('SIXFINGER_RELEASE_SIGNING')) return cfg;

    src = src.replace(
      /signingConfigs \{\n(\s+)debug \{/,
      `signingConfigs {\n$1// SIXFINGER_RELEASE_SIGNING\n$1release {\n$1    if (System.getenv('ANDROID_KEYSTORE_PATH')) {\n$1        storeFile file(System.getenv('ANDROID_KEYSTORE_PATH'))\n$1        storePassword System.getenv('ANDROID_KEYSTORE_PASSWORD')\n$1        keyAlias System.getenv('ANDROID_KEY_ALIAS')\n$1        keyPassword System.getenv('ANDROID_KEY_PASSWORD')\n$1    }\n$1}\n$1debug {`,
    );
    src = src.replace(
      /(release \{\n\s+\/\/ Caution![^\n]*\n\s+\/\/ see[^\n]*\n\s+)signingConfig signingConfigs\.debug/,
      `$1signingConfig System.getenv('ANDROID_KEYSTORE_PATH') ? signingConfigs.release : signingConfigs.debug`,
    );
    cfg.modResults.contents = src;
    return cfg;
  });
};
