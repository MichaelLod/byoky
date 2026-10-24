package com.byoky.app.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class AppUrlTest {

    private fun valid(input: String) = AppUrl.normalize(input) as AppUrl.Result.Valid

    private fun assertRejected(input: String) {
        assertTrue("expected $input to be rejected", AppUrl.normalize(input) is AppUrl.Result.Invalid)
    }

    @Test
    fun acceptsHttpsAndDerivesOriginAndName() {
        val r = valid("https://www.Example.com/chat?x=1#section")
        assertEquals("https://www.example.com/chat?x=1", r.url)
        assertEquals("https://www.example.com", r.origin)
        assertEquals("example.com", r.suggestedName)
    }

    @Test
    fun bareHostIsTreatedAsHttps() {
        val r = valid("app.example.com")
        assertEquals("https://app.example.com/", r.url)
        assertEquals("https://app.example.com", r.origin)
    }

    @Test
    fun bareHostWithPortIsTreatedAsHttps() {
        assertEquals("https://app.example.com:8443", valid("app.example.com:8443/x").origin)
    }

    @Test
    fun defaultPortIsDropped() {
        assertEquals("https://example.com", valid("https://example.com:443/").origin)
    }

    @Test
    fun rejectsNonHttpsSchemes() {
        assertRejected("http://example.com")
        assertRejected("ftp://example.com")
        assertRejected("javascript:alert(1)")
        assertRejected("data:text/html,hi")
        assertRejected("file:///sdcard/x.html")
        assertRejected("intent://example.com#Intent;end")
    }

    @Test
    fun rejectsCredentialsBlanksAndJunk() {
        assertRejected("https://user:pass@example.com")
        assertRejected("")
        assertRejected("   ")
        assertRejected("https://exa mple.com")
        assertRejected("https://")
        assertRejected("notadomain")
    }

    @Test
    fun originOfReturnsNullForNonHttps() {
        assertEquals("https://example.com", AppUrl.originOf("https://example.com/a"))
        assertNull(AppUrl.originOf("http://example.com/a"))
    }
}
