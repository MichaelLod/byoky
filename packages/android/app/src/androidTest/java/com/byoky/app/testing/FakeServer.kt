package com.byoky.app.testing

import android.content.Context
import com.byoky.app.data.VaultPrefs
import com.byoky.app.data.WalletStore
import java.io.BufferedInputStream
import java.net.InetAddress
import java.net.ServerSocket
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.atomic.AtomicInteger
import kotlin.concurrent.thread

/**
 * One-connection-per-request HTTP/1.1 server on [host] (127.0.0.1 unless
 * given): a provider for the instrumented tests, reached through an Ollama or
 * LM Studio credential at [base] (the app allows cleartext to loopback). No
 * network or real keys needed.
 */
class FakeServer(host: String = "127.0.0.1") : AutoCloseable {
    data class Request(val line: String, val headers: Map<String, String>, val body: ByteArray)

    /** The answer to every request; with [hold], none: the connection stays open until the client closes it. */
    data class Reply(val contentType: String, val body: ByteArray, val status: Int = 200, val hold: Boolean = false)

    @Volatile var reply = Reply("application/json", "{}".toByteArray())
    val requests = CopyOnWriteArrayList<Request>()
    private val closed = AtomicInteger()

    /** Held requests whose client went away (the upstream call was cancelled). */
    val closedByClient: Int get() = closed.get()
    private val socket = ServerSocket(0, 16, InetAddress.getByName(host))
    val base = "http://${if (':' in host) "[$host]" else host}:${socket.localPort}"

    init {
        thread(isDaemon = true) {
            while (!socket.isClosed) {
                val client = try { socket.accept() } catch (_: Exception) { break }
                // Each connection on its own thread, so a held one blocks nothing else.
                thread(isDaemon = true) {
                    try {
                        client.use { c -> serve(c) }
                    } catch (_: Exception) {
                    }
                }
            }
        }
    }

    private fun serve(c: java.net.Socket) {
        val input = BufferedInputStream(c.getInputStream())
        val line = readLine(input)
        val headers = mutableMapOf<String, String>()
        while (true) {
            val h = readLine(input)
            if (h.isEmpty()) break
            val i = h.indexOf(':')
            if (i > 0) headers[h.substring(0, i).trim().lowercase()] = h.substring(i + 1).trim()
        }
        val length = headers["content-length"]?.toIntOrNull() ?: 0
        val body = ByteArray(length)
        var read = 0
        while (read < length) {
            val n = input.read(body, read, length - read)
            if (n < 0) break
            read += n
        }
        requests += Request(line, headers, body)
        val r = reply
        if (r.hold) {
            try {
                while (input.read() >= 0) { /* until the client hangs up */ }
            } catch (_: Exception) {
            }
            closed.incrementAndGet()
            return
        }
        val out = c.getOutputStream()
        out.write(("HTTP/1.1 ${r.status} OK\r\nContent-Type: ${r.contentType}\r\n" +
            "Content-Length: ${r.body.size}\r\nConnection: close\r\n\r\n").toByteArray())
        out.write(r.body)
        out.flush()
    }

    private fun readLine(input: BufferedInputStream): String {
        val sb = StringBuilder()
        while (true) {
            val b = input.read()
            if (b < 0 || b == '\n'.code) break
            if (b != '\r'.code) sb.append(b.toChar())
        }
        return sb.toString()
    }

    override fun close() = socket.close()
}

/** A wallet store with nothing in it: the plain state and the encrypted prefs removed. */
fun clearWalletState(context: Context) {
    context.getSharedPreferences(VaultPrefs.PLAIN_STATE_FILE, Context.MODE_PRIVATE).edit().clear().commit()
    try { context.deleteSharedPreferences(WalletStore.ENCRYPTED_PREFS_FILE) } catch (_: Throwable) {}
}
