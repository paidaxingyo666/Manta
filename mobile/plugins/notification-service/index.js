const { withXcodeProject, withEntitlementsPlist, withDangerousMod } = require('expo/config-plugins')
const { copyFileSync, mkdirSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')

/**
 * Adds the notification service extension that decrypts a push body.
 *
 * Expo prebuild regenerates ios/ from scratch, so the target cannot live in a
 * checked-in Xcode project — it has to be re-created on every prebuild, which
 * is what this does.
 */

const TARGET = 'NotificationService'
const APP_GROUP = 'group.cn.sh.manta.mobile'
const DEPLOYMENT_TARGET = '15.1'

/** Writes the extension's sources next to the app, where Xcode expects them. */
function withSourceFiles(config) {
  return withDangerousMod(config, [
    'ios',
    (cfg) => {
      const dir = join(cfg.modRequest.platformProjectRoot, TARGET)
      mkdirSync(dir, { recursive: true })
      copyFileSync(join(__dirname, 'NotificationService.swift'), join(dir, `${TARGET}.swift`))
      writeFileSync(
        join(dir, 'Info.plist'),
        `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleName</key><string>$(PRODUCT_NAME)</string>
  <key>CFBundleDisplayName</key><string>${TARGET}</string>
  <key>CFBundleIdentifier</key><string>$(PRODUCT_BUNDLE_IDENTIFIER)</string>
  <key>CFBundlePackageType</key><string>XPC!</string>
  <key>CFBundleShortVersionString</key><string>$(MARKETING_VERSION)</string>
  <key>CFBundleVersion</key><string>$(CURRENT_PROJECT_VERSION)</string>
  <key>NSExtension</key><dict>
    <key>NSExtensionPointIdentifier</key><string>com.apple.usernotifications.service</string>
    <key>NSExtensionPrincipalClass</key><string>$(PRODUCT_MODULE_NAME).${TARGET}</string>
  </dict>
</dict></plist>
`
      )
      writeFileSync(
        join(dir, `${TARGET}.entitlements`),
        `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>com.apple.security.application-groups</key><array><string>${APP_GROUP}</string></array>
</dict></plist>
`
      )
      return cfg
    }
  ])
}

/** The app half of the share: without these the extension finds an empty keychain. */
function withAppEntitlements(config) {
  return withEntitlementsPlist(config, (cfg) => {
    // Only the app group. A keychain-access-groups entry naming an App Group
    // without the team prefix does not match the TEAMID.* in the provisioning
    // profile — and application-groups is already what authorises using that
    // identifier as a kSecAttrAccessGroup.
    cfg.modResults['com.apple.security.application-groups'] = [APP_GROUP]
    return cfg
  })
}

function withExtensionTarget(config) {
  return withXcodeProject(config, (cfg) => {
    const project = cfg.modResults
    const appVersion = config.version ?? '1.0.0'
    const appBuild = String(config.ios?.buildNumber ?? '1')
    if (project.pbxTargetByName(TARGET)) {
      return cfg
    }
    const group = project.addPbxGroup(
      [`${TARGET}.swift`, 'Info.plist', `${TARGET}.entitlements`],
      TARGET,
      TARGET
    )
    // Hang it off the project root so Xcode shows it beside the app.
    const groups = project.hash.project.objects.PBXGroup
    for (const key of Object.keys(groups)) {
      if (
        groups[key].name === undefined &&
        groups[key].path === undefined &&
        groups[key].children
      ) {
        groups[key].children.push({ value: group.uuid, comment: TARGET })
        break
      }
    }

    const target = project.addTarget(
      TARGET,
      'app_extension',
      TARGET,
      `${config.ios.bundleIdentifier}.${TARGET}`
    )
    project.addBuildPhase([`${TARGET}.swift`], 'PBXSourcesBuildPhase', 'Sources', target.uuid)
    project.addBuildPhase([], 'PBXResourcesBuildPhase', 'Resources', target.uuid)
    project.addBuildPhase([], 'PBXFrameworksBuildPhase', 'Frameworks', target.uuid)

    // Without these two the extension builds but never ships: nothing makes the
    // app depend on it, and nothing copies the .appex into the bundle. The
    // symptom is a push that arrives with the desktop's generic text forever,
    // because the target that would rewrite it was never installed.
    const appTarget = project.getFirstTarget()
    // addTargetDependency writes nothing unless both of these sections already
    // exist — and a fresh Expo project has neither, so the call is a silent
    // no-op. Creating them first is what makes it take effect.
    const objects = project.hash.project.objects
    objects.PBXTargetDependency = objects.PBXTargetDependency ?? {}
    objects.PBXContainerItemProxy = objects.PBXContainerItemProxy ?? {}
    project.addTargetDependency(appTarget.uuid, [target.uuid])
    // No embed phase here: xcode's addTarget already created one
    // (dstSubfolderSpec 13, PlugIns) on the app target. A second phase copying
    // the same .appex is a "Multiple commands produce" build failure, and
    // plutil -lint cannot see it.

    const configurations = project.pbxXCBuildConfigurationSection()
    for (const key of Object.keys(configurations)) {
      const build = configurations[key].buildSettings
      if (!build || build.PRODUCT_NAME !== `"${TARGET}"`) {
        continue
      }
      build.CODE_SIGN_ENTITLEMENTS = `"${TARGET}/${TARGET}.entitlements"`
      build.INFOPLIST_FILE = `"${TARGET}/Info.plist"`
      build.IPHONEOS_DEPLOYMENT_TARGET = DEPLOYMENT_TARGET
      build.SWIFT_VERSION = '5.0'
      build.TARGETED_DEVICE_FAMILY = '"1,2"'
      // Why explicit: the app's own signing settings do not cascade to a target
      // Expo did not create, and an unsigned extension fails the archive.
      build.CODE_SIGN_STYLE = 'Manual'
      // MARKETING_VERSION / CURRENT_PROJECT_VERSION exist on the app target but
      // not on one Expo did not create, so $(...) in the extension's Info.plist
      // expands to an empty string. App Store Connect rejects that, and Apple
      // requires the extension's version to match its host app's.
      build.MARKETING_VERSION = appVersion
      build.CURRENT_PROJECT_VERSION = appBuild
    }
    return cfg
  })
}

module.exports = (config) => withExtensionTarget(withAppEntitlements(withSourceFiles(config)))
