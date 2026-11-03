package com.byoky.app.runtime

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** The origin the bridge compares a page's frame with (the app's, from AppUrl). */
class AppBridgeOriginTest {

    @Test
    fun defaultPortsAreLeftOutAndOthersKept() {
        assertEquals("https://chat.example.com", AppBridge.originOf("https", "chat.example.com", -1))
        assertEquals("https://chat.example.com", AppBridge.originOf("https", "chat.example.com", 443))
        assertEquals("https://chat.example.com:8443", AppBridge.originOf("https", "chat.example.com", 8443))
        assertEquals("http://localhost", AppBridge.originOf("http", "localhost", 80))
        assertEquals("http://localhost:443", AppBridge.originOf("http", "localhost", 443))
    }

    @Test
    fun schemeAndHostAreLowercased() {
        assertEquals("https://chat.example.com", AppBridge.originOf("HTTPS", "Chat.Example.COM", -1))
    }

    @Test
    fun anIpv6HostKeepsItsBrackets() {
        assertEquals("https://[::1]:8443", AppBridge.originOf("https", "[::1]", 8443))
    }

    /** Nothing to compare: no origin, so never the app's. */
    @Test
    fun aUrlWithoutAHostHasNoOrigin() {
        assertNull(AppBridge.originOf("about", null, -1))
        assertNull(AppBridge.originOf(null, "chat.example.com", -1))
        assertNull(AppBridge.originOf("https", "", -1))
        // A non-web scheme never matches an https app origin.
        assertEquals("intent://scan", AppBridge.originOf("intent", "scan", -1))
    }
}
