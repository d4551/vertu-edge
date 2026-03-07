#!/usr/bin/env ruby
# frozen_string_literal: true

require "fileutils"
require "rubygems"

gem "xcodeproj", ">= 1.27.0"
require "xcodeproj"

ROOT_DIR = File.expand_path("..", __dir__)
IOS_DIR = File.join(ROOT_DIR, "iOS", "VertuEdge")
PROJECT_NAME = "VertuEdgeHost"
PROJECT_PATH = File.join(IOS_DIR, "#{PROJECT_NAME}.xcodeproj")
WORKSPACE_PATH = File.join(IOS_DIR, "VertuEdge.xcworkspace", "contents.xcworkspacedata")
APP_DIR = File.join(IOS_DIR, "VertuEdgeHostApp")
APP_SOURCE = File.join(APP_DIR, "VertuEdgeHostApp.swift")
PACKAGE_REFERENCE_PATH = "."

abort("Missing host app source at #{APP_SOURCE}") unless File.exist?(APP_SOURCE)

FileUtils.rm_rf(PROJECT_PATH)

project = Xcodeproj::Project.new(PROJECT_PATH)
project.root_object.attributes["LastSwiftUpdateCheck"] = "1620"
project.root_object.attributes["LastUpgradeCheck"] = "1620"

app_group = project.main_group.find_subpath("VertuEdgeHostApp", true)
app_file = app_group.new_file("VertuEdgeHostApp.swift")

target = project.new_target(:application, PROJECT_NAME, :ios, "17.0")
target.product_name = PROJECT_NAME
target.add_file_references([app_file])

project.build_configurations.each do |configuration|
  configuration.build_settings["CLANG_ENABLE_MODULES"] = "YES"
  configuration.build_settings["SWIFT_VERSION"] = "5.0"
  configuration.build_settings["SUPPORTED_PLATFORMS"] = "iphoneos iphonesimulator"
  configuration.build_settings["TARGETED_DEVICE_FAMILY"] = "1,2"
end

target.build_configurations.each do |configuration|
  configuration.build_settings["CODE_SIGN_STYLE"] = "Automatic"
  configuration.build_settings["CURRENT_PROJECT_VERSION"] = "1"
  configuration.build_settings["DEVELOPMENT_TEAM"] = ""
  configuration.build_settings["GENERATE_INFOPLIST_FILE"] = "YES"
  configuration.build_settings["INFOPLIST_KEY_UIApplicationSceneManifest_Generation"] = "YES"
  configuration.build_settings["INFOPLIST_KEY_UIApplicationSupportsIndirectInputEvents"] = "YES"
  configuration.build_settings["INFOPLIST_KEY_UILaunchScreen_Generation"] = "YES"
  configuration.build_settings["INFOPLIST_KEY_UISupportedInterfaceOrientations_iPhone"] =
    "UIInterfaceOrientationPortrait UIInterfaceOrientationLandscapeLeft UIInterfaceOrientationLandscapeRight"
  configuration.build_settings["IPHONEOS_DEPLOYMENT_TARGET"] = "17.0"
  configuration.build_settings["LD_RUNPATH_SEARCH_PATHS"] = ["$(inherited)", "@executable_path/Frameworks"]
  configuration.build_settings["MARKETING_VERSION"] = "1.0"
  configuration.build_settings["PRODUCT_BUNDLE_IDENTIFIER"] = "com.vertu.edge.ios.host"
  configuration.build_settings["PRODUCT_NAME"] = "$(TARGET_NAME)"
  configuration.build_settings["SUPPORTED_PLATFORMS"] = "iphoneos iphonesimulator"
  configuration.build_settings["SWIFT_EMIT_LOC_STRINGS"] = "YES"
  configuration.build_settings["SWIFT_VERSION"] = "5.0"
  configuration.build_settings["TARGETED_DEVICE_FAMILY"] = "1,2"
  next unless configuration.name == "Release"

  configuration.build_settings["SWIFT_COMPILATION_MODE"] = "wholemodule"
end

package_reference = project.new(Xcodeproj::Project::Object::XCLocalSwiftPackageReference)
package_reference.relative_path = PACKAGE_REFERENCE_PATH
project.root_object.package_references << package_reference

package_dependency = project.new(Xcodeproj::Project::Object::XCSwiftPackageProductDependency)
package_dependency.package = package_reference
package_dependency.product_name = "VertuEdgeUI"
target.package_product_dependencies << package_dependency

package_build_file = project.new(Xcodeproj::Project::Object::PBXBuildFile)
package_build_file.product_ref = package_dependency
target.frameworks_build_phase.files << package_build_file

project.save

scheme = Xcodeproj::XCScheme.new
scheme.add_build_target(target)
scheme.set_launch_target(target)
scheme.launch_action.build_configuration = "Debug"
scheme.profile_action.build_configuration = "Release"
scheme.archive_action.build_configuration = "Release"
scheme.analyze_action.build_configuration = "Debug"
scheme.save_as(PROJECT_PATH, PROJECT_NAME, true)

workspace_contents = <<~XML
  <?xml version="1.0" encoding="UTF-8"?>
  <Workspace
     version = "1.0">
     <FileRef
        location = "group:#{PROJECT_NAME}.xcodeproj">
     </FileRef>
     <FileRef
        location = "group:Package.swift">
     </FileRef>
  </Workspace>
XML

File.write(WORKSPACE_PATH, workspace_contents)
