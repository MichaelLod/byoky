package com.byoky.app.data

import org.junit.Assert.assertEquals
import org.junit.Test

class SecretCacheTest {

    @Test
    fun eachCiphertextIsDecryptedOnce() {
        val cache = SecretCache()
        var calls = 0
        val decrypt = { enc: String -> calls++; "plain-$enc" }
        repeat(5) { assertEquals("plain-a", cache.get("a", decrypt)) }
        assertEquals(1, calls)
        // A rewritten key has a new ciphertext: decrypted again, new value.
        assertEquals("plain-b", cache.get("b", decrypt))
        assertEquals(2, calls)
    }

    @Test
    fun clearingForgetsEveryKey() {
        val cache = SecretCache()
        var calls = 0
        val decrypt = { enc: String -> calls++; "plain-$enc" }
        cache.get("a", decrypt)
        cache.get("b", decrypt)
        cache.clear()
        assertEquals(0, cache.size)
        cache.get("a", decrypt)
        assertEquals(3, calls)
    }

    @Test
    fun removingOneKeepsTheOthers() {
        val cache = SecretCache()
        cache.get("a") { "1" }
        cache.get("b") { "2" }
        cache.remove("a")
        assertEquals(1, cache.size)
        assertEquals("2", cache.get("b") { error("cached") })
    }

    @Test
    fun aFailedDecryptCachesNothing() {
        val cache = SecretCache()
        runCatching { cache.get("a") { throw IllegalStateException("bad tag") } }
        assertEquals(0, cache.size)
    }
}
