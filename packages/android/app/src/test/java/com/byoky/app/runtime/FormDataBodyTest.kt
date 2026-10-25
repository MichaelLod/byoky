package com.byoky.app.runtime

import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Base64

class FormDataBodyTest {

    @Test
    fun rebuildsTextAndFileParts() {
        val audio = byteArrayOf(0, 1, 2, -1)
        val serialized = """
            [{"name":"model","value":"whisper-1","type":"text"},
             {"name":"file","value":"${Base64.getEncoder().encodeToString(audio)}","type":"file","filename":"a.webm","contentType":"audio/webm"}]
        """.trimIndent()
        val encoded = FormDataBody.encode(serialized)
        assertTrue(encoded.contentType.startsWith("multipart/form-data; boundary="))
        val text = String(encoded.bytes, Charsets.ISO_8859_1)
        assertTrue(text.contains("Content-Disposition: form-data; name=\"model\""))
        assertTrue(text.contains("whisper-1"))
        assertTrue(text.contains("Content-Disposition: form-data; name=\"file\"; filename=\"a.webm\""))
        assertTrue(text.contains("Content-Type: audio/webm"))
        assertTrue(text.contains(String(audio, Charsets.ISO_8859_1)))
    }

    @Test
    fun unnamedFilesAreCalledBlobLikeInABrowser() {
        val encoded = FormDataBody.encode("[{\"name\":\"f\",\"value\":\"AA==\",\"type\":\"file\"}]")
        assertTrue(String(encoded.bytes, Charsets.ISO_8859_1).contains("filename=\"blob\""))
    }

    @Test(expected = IllegalArgumentException::class)
    fun rejectsMalformedInput() {
        FormDataBody.encode("{\"not\":\"a list\"}")
    }

    @Test(expected = IllegalArgumentException::class)
    fun rejectsBadBase64() {
        FormDataBody.encode("[{\"name\":\"f\",\"value\":\"%%%\",\"type\":\"file\"}]")
    }
}
