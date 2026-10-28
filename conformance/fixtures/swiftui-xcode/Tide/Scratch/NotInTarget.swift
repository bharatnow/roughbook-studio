import SwiftUI

// In the folder but in no target: Xcode never compiles it, so the map never reads it.
struct NotInTarget: View {
    var body: some View {
        Text("Scratch")
    }
}
