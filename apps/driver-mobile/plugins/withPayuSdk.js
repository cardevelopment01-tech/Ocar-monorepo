const { withProjectBuildGradle, withAndroidManifest } = require('expo/config-plugins');

// payu-non-seam-less-react's android/build.gradle depends on the legacy coordinate
// `com.facebook.react:react-native:+`, which RN >= 0.71 no longer publishes (it is
// `react-android`). Substitute it project-wide so the SDK compiles against the app's RN. The SDK's transitive
// PhonePe IntentSDK also lives on a third-party Maven repo the app project must declare.
const MARKER = '// withPayuSdk';

function payuGradleBlock(rnVersion) {
  return `
${MARKER}
allprojects {
    repositories {
        maven { url 'https://phonepe.mycloudrepo.io/public/repositories/phonepe-intentsdk-android' }
    }
    configurations.all {
        resolutionStrategy.dependencySubstitution {
            substitute module('com.facebook.react:react-native') using module('com.facebook.react:react-android:${rnVersion}')
        }
    }
}
`;
}

function applyPayuGradle(contents, rnVersion) {
  return contents.includes(MARKER) ? contents : contents + payuGradleBlock(rnVersion);
}

// payu-checkout-pro-ui declares its own application@theme (OnePayuTheme); the app keeps AppTheme.
// The SDK's activities carry their own themes, so overriding the application-level one is safe.
function applyPayuManifest(manifest) {
  manifest.$['xmlns:tools'] = 'http://schemas.android.com/tools';
  const app = manifest.application[0];
  const replace = new Set((app.$['tools:replace'] || '').split(',').filter(Boolean));
  replace.add('android:theme');
  app.$['tools:replace'] = [...replace].join(',');
  return manifest;
}

function withPayuSdk(config) {
  const rnVersion = require('react-native/package.json').version;
  config = withProjectBuildGradle(config, (c) => {
    c.modResults.contents = applyPayuGradle(c.modResults.contents, rnVersion);
    return c;
  });
  return withAndroidManifest(config, (c) => {
    applyPayuManifest(c.modResults.manifest);
    return c;
  });
}

module.exports = withPayuSdk;
module.exports.applyPayuGradle = applyPayuGradle;
module.exports.applyPayuManifest = applyPayuManifest;
