import SwiftUI

struct LibraryHeader: View {
    let count: Int

    var body: some View {
        HStack {
            Text("Tracks")
            Spacer()
            Text(count, format: .number)
        }
        .padding()
    }
}
