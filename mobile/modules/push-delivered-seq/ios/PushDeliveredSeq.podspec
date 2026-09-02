# Without this file expo-modules-autolinking finds the module and then discards
# it: resolveModuleAsync returns null when there is no podspec, so the module
# never reaches the Podfile or ExpoModulesProvider. requireOptionalNativeModule
# then returns null forever, the catch-up never learns what the extension
# already delivered, and every push is notified a second time on the next open.
Pod::Spec.new do |s|
  s.name           = 'PushDeliveredSeq'
  # Hardcoded: this module is local to the app and has no package.json to read.
  s.version        = '1.0.0'
  s.summary        = 'Reads how far a delivered push carried the notification counter'
  s.description    = s.summary
  s.license        = 'MIT'
  s.author         = 'Manta'
  s.homepage       = 'https://github.com/paidaxingyo666/Manta'
  s.platforms      = { :ios => '15.1' }
  s.swift_version  = '5.4'
  s.source         = { git: 'https://github.com/paidaxingyo666/Manta.git' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }

  s.source_files = "**/*.{h,m,swift}"
end
