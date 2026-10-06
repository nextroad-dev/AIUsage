Pod::Spec.new do |s|
  s.name           = 'UsageOauthLoopback'
  s.version        = '1.0.0'
  s.summary        = 'One-shot loopback callback receiver for browser sign-in.'
  s.description    = 'Receives the provider redirect on 127.0.0.1 and hands it to the app scheme.'
  s.author         = 'Usage'
  s.homepage       = 'https://docs.expo.dev/modules/'
  s.platforms      = { :ios => '16.4' }
  s.swift_version  = '5.9'
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.source_files = "**/*.{h,m,swift}"
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
end
