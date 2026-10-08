// Release builds produce one APK per CPU family plus a universal one, so people can download the
// smaller file that matches their phone:
//   app-arm64-v8a-release.apk     64-bit ARM (almost every phone since ~2017)
//   app-armeabi-v7a-release.apk   32-bit ARM (older or low-end phones)
//   app-universal-release.apk     every ABI the build includes; installs anywhere, largest
// android/ is generated (Continuous Native Generation), so the splits are added here.
const { withAppBuildGradle } = require('expo/config-plugins');

const MARKER = '// @generated with-abi-splits';

const BLOCK = `
${MARKER}
android {
    splits {
        abi {
            enable true
            reset()
            include "arm64-v8a", "armeabi-v7a"
            universalApk true
        }
    }
}
`;

/** Appends the splits block once; Gradle merges a second `android {}` block into the first. */
function addAbiSplits(gradle) {
  return gradle.includes(MARKER) ? gradle : `${gradle.trimEnd()}\n${BLOCK}`;
}

const withAbiSplits = (config) =>
  withAppBuildGradle(config, (mod) => {
    if (mod.modResults.language !== 'groovy') {
      throw new Error('with-abi-splits: expected a Groovy app/build.gradle');
    }
    mod.modResults.contents = addAbiSplits(mod.modResults.contents);
    return mod;
  });

module.exports = withAbiSplits;
module.exports.addAbiSplits = addAbiSplits;
