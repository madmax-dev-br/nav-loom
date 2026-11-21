plugins { id("com.android.application"); id("org.jetbrains.kotlin.android"); id("org.jetbrains.kotlin.plugin.compose") }
val navloomTags = findProperty("navloom.tags")?.toString() != "false"
// -Pnavloom.buildDir=<dir> builds somewhere else, so a variant never overwrites app/build.
findProperty("navloom.buildDir")?.toString()?.let { layout.buildDirectory.set(file(it)) }
android {
 namespace = "dev.navloom.testapp"
 compileSdk = 35
 // -Pnavloom.tags=false builds the same app without Navloom tags or test tags (package dev.navloom.testapp.notags), as an app that declares no screen ids.
 defaultConfig { applicationId = if (navloomTags) "dev.navloom.testapp" else "dev.navloom.testapp.notags"; minSdk = 26; targetSdk = 35; versionCode = 2; versionName = "1.0.1"; buildConfigField("boolean", "NAVLOOM_TAGS", navloomTags.toString()) }
 buildFeatures { compose = true; buildConfig = true }
 compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
 kotlinOptions { jvmTarget = "17" }
}
dependencies {
 implementation(platform("androidx.compose:compose-bom:2025.05.01"))
 implementation("androidx.activity:activity-compose:1.10.1")
 implementation("androidx.compose.ui:ui")
 implementation("androidx.compose.ui:ui-tooling-preview")
 implementation("androidx.compose.material3:material3")
 implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.7")
 debugImplementation("androidx.compose.ui:ui-tooling")
}
