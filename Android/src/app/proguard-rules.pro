# ProGuard rules for Vertu Edge
#
# Standard Android keep rules. Add project-specific rules below.

# Keep the application class and its subclasses.
-keep class com.google.ai.edge.gallery.** { *; }

# Keep data classes used with serialization / reflection.
-keepclassmembers class com.google.ai.edge.gallery.data.** {
    <fields>;
    <init>(...);
}

# Keep Kotlin metadata so reflection-based serialization works correctly.
-keepattributes *Annotation*, Signature, InnerClasses, EnclosingMethod

# Keep Kotlin coroutines.
-keepclassmembers class kotlinx.coroutines.** { *; }
-dontwarn kotlinx.coroutines.**

# Keep Hilt entry points and generated components.
-keep class dagger.hilt.** { *; }
-keep class javax.inject.** { *; }
-keep @dagger.hilt.android.HiltAndroidApp class * { *; }
-keep @dagger.hilt.InstallIn class * { *; }
-keep @javax.inject.Singleton class * { *; }

# Keep Protobuf lite classes.
-keep class com.google.protobuf.** { *; }
-dontwarn com.google.protobuf.**

# Keep Firebase Analytics.
-keep class com.google.firebase.** { *; }
-dontwarn com.google.firebase.**

# Keep AppAuth / OpenID Connect library.
-keep class net.openid.appauth.** { *; }
-dontwarn net.openid.appauth.**

# Keep LiteRT / TFLite inference classes.
-keep class org.tensorflow.** { *; }
-dontwarn org.tensorflow.**
-keep class com.google.ai.edge.litert.** { *; }
-dontwarn com.google.ai.edge.litert.**

# Keep Gson serialization.
-keepattributes Signature
-keepclassmembers,allowobfuscation class * {
    @com.google.gson.annotations.SerializedName <fields>;
}

# Keep WorkManager workers.
-keep class * extends androidx.work.Worker { *; }
-keep class * extends androidx.work.ListenableWorker { *; }

# Suppress warnings from libraries that use internal APIs.
-dontwarn sun.misc.**
-dontwarn java.lang.invoke.**
