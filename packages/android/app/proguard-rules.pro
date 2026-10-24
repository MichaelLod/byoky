-keepattributes *Annotation*
-keep class com.byoky.app.** { *; }

# OkHttp
-dontwarn okhttp3.**
-dontwarn okio.**
-keep class okhttp3.** { *; }
