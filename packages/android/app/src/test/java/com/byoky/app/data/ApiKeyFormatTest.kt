package com.byoky.app.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class ApiKeyFormatTest {

    @Test
    fun trimsSurroundingWhitespace() {
        assertEquals("sk-ant-abc123", ApiKeyFormat.normalize("  sk-ant-abc123\n"))
        assertEquals("sk-abc", ApiKeyFormat.normalize(" sk-abc\t"))
    }

    @Test
    fun acceptsEveryPrintableAsciiCharacter() {
        val all = (' '..'~').joinToString("").trim()
        assertEquals(all, ApiKeyFormat.normalize(all))
        assertEquals("", ApiKeyFormat.normalize(""))
    }

    @Test
    fun rejectsControlAndNonAsciiCharacters() {
        assertNull(ApiKeyFormat.normalize("sk-ant-​abc"))   // zero-width space
        assertNull(ApiKeyFormat.normalize("sk-ant-abc﻿"))   // byte-order mark
        assertNull(ApiKeyFormat.normalize("sk-ant-a\nbc"))
        assertNull(ApiKeyFormat.normalize("sk-ant-a\u0000bc"))
        assertNull(ApiKeyFormat.normalize("sk-ant-a\u007fbc"))
        assertNull(ApiKeyFormat.normalize("sk-ant-äbc"))
    }
}
