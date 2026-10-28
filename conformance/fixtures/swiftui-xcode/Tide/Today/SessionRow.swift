import SwiftUI

struct SessionRow: View {
    let session: Session

    var body: some View {
        HStack {
            Text(session.title)
            Spacer()
            Text("\(session.length) today").foregroundStyle(.secondary)
        }
    }
}
