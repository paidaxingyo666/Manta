import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const resolveExpoConfig = require('../../app.config.js')
const gradleHeap = require('../../plugins/android-gradle-heap.js')

describe('Android release Gradle heap', () => {
  it('is registered in the resolved Expo config', () => {
    const config = resolveExpoConfig({ config: { plugins: ['expo-router'] } })
    expect(config.plugins).toContain('./plugins/android-gradle-heap.js')
    expect(config.plugins).toContain('expo-router')
  })

  it('replaces the template heap rather than adding a second setting', () => {
    const out = gradleHeap.withGradleHeap([
      { type: 'property', key: 'org.gradle.jvmargs', value: '-Xmx2048m -XX:MaxMetaspaceSize=512m' },
      { type: 'property', key: 'android.useAndroidX', value: 'true' }
    ])
    expect(out.filter((item: { key?: string }) => item.key === 'org.gradle.jvmargs')).toEqual([
      { type: 'property', key: 'org.gradle.jvmargs', value: gradleHeap.JVM_ARGS }
    ])
    expect(out).toContainEqual({ type: 'property', key: 'android.useAndroidX', value: 'true' })
  })
})
