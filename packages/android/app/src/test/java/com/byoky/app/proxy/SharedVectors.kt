package com.byoky.app.proxy

import org.json.JSONObject

/**
 * Test vectors shared with core and iOS, from packages/core/tests/vectors
 * (on the test classpath via sourceSets in app/build.gradle.kts).
 */
object SharedVectors {
    fun load(name: String): JSONObject {
        val stream = checkNotNull(SharedVectors::class.java.classLoader?.getResourceAsStream(name)) {
            "$name is not on the test classpath (see sourceSets in app/build.gradle.kts)"
        }
        return JSONObject(stream.bufferedReader().use { it.readText() })
    }
}
