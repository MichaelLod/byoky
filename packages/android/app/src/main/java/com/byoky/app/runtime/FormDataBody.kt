package com.byoky.app.runtime

import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.MultipartBody
import okhttp3.RequestBody.Companion.toRequestBody
import okio.Buffer
import org.json.JSONArray
import java.util.Base64

/**
 * Rebuilds a multipart/form-data body (audio transcription uploads and the
 * like) from the SDK's `bodyEncoding: "formdata"` serialization: a JSON array
 * of `{ name, value, type: "text" | "file", filename?, contentType? }`, file
 * values base64-encoded. Same format the extension's `reconstructBody`
 * reads (`SerializedFormDataEntry` in packages/core/src/types.ts).
 * Pure, unit-tested.
 */
object FormDataBody {

    class Encoded(val bytes: ByteArray, val contentType: String)

    private const val MAX_ENTRIES = 1_000

    /** Throws [IllegalArgumentException] when [serialized] isn't a valid entry list. */
    fun encode(serialized: String): Encoded {
        val entries = try { JSONArray(serialized) } catch (e: Exception) {
            throw IllegalArgumentException("Malformed form data")
        }
        require(entries.length() <= MAX_ENTRIES) { "Too many form fields" }
        val builder = MultipartBody.Builder().setType(MultipartBody.FORM)
        for (i in 0 until entries.length()) {
            val entry = entries.optJSONObject(i) ?: throw IllegalArgumentException("Malformed form data")
            val name = entry.opt("name") as? String ?: throw IllegalArgumentException("Malformed form data")
            val value = entry.opt("value") as? String ?: throw IllegalArgumentException("Malformed form data")
            when (entry.optString("type")) {
                "text" -> builder.addFormDataPart(name, value)
                "file" -> {
                    val bytes = try { Base64.getDecoder().decode(value) } catch (e: IllegalArgumentException) {
                        throw IllegalArgumentException("Malformed form data")
                    }
                    val type = (entry.opt("contentType") as? String)?.ifEmpty { null } ?: "application/octet-stream"
                    // A browser names an unnamed Blob part "blob".
                    val filename = (entry.opt("filename") as? String)?.ifEmpty { null } ?: "blob"
                    builder.addFormDataPart(name, filename, bytes.toRequestBody(type.toMediaTypeOrNull()))
                }
                else -> throw IllegalArgumentException("Malformed form data")
            }
        }
        if (entries.length() == 0) {
            // MultipartBody needs at least one part; an empty FormData sends an empty body.
            return Encoded(ByteArray(0), "multipart/form-data")
        }
        val body = builder.build()
        val buffer = Buffer()
        body.writeTo(buffer)
        return Encoded(buffer.readByteArray(), body.contentType().toString())
    }
}
