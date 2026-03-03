import SwiftUI

enum VertuTheme {
    static let gold = Color(red: 0.831, green: 0.686, blue: 0.216)
    static let goldLight = Color(red: 0.929, green: 0.851, blue: 0.478)
    static let goldDark = Color(red: 0.545, green: 0.451, blue: 0.125)
    static let black = Color(red: 0.039, green: 0.039, blue: 0.039)
    static let darkGray = Color(red: 0.102, green: 0.102, blue: 0.102)
    static let medGray = Color(red: 0.165, green: 0.165, blue: 0.165)
    static let lightGray = Color(red: 0.533, green: 0.533, blue: 0.533)
    static let white = Color(red: 0.961, green: 0.961, blue: 0.961)
    static let error = Color(red: 0.812, green: 0.400, blue: 0.475)
    static let success = Color(red: 0.298, green: 0.686, blue: 0.314)

    static func titleStyle() -> Font { .custom("Georgia", size: 28).weight(.light) }
    static func headingStyle() -> Font { .custom("Georgia", size: 20).weight(.regular) }
    static func bodyStyle() -> Font { .system(size: 15, weight: .regular, design: .default) }
    static func labelStyle() -> Font { .system(size: 12, weight: .medium, design: .default) }
}
